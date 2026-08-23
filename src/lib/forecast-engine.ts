import { CityAnalysis, BetRecommendation, DailyAnalysis, HistoricalRecord, PolymarketContract, ForecastResult } from '@/types'
import { CIUDADES_ASIA } from './cities'
import { fetchWeatherModels } from './openmeteo'
import { computeEnsemble } from './ensemble'
import { monteCarloProbability, normalizeProbabilidades } from './montecarlo'
import { fetchPolymarketPrices, parseContract, calculateEV, calculateLiquidity } from './polymarket'
import { calculateAllocation } from './kelly'
import { getRecentErrors, getRecentModelErrors, computeGlobalMetrics, getAllCalibrationPairs, getHistoricalAccuracy, getAllHistoricalErrors, getCityHistory } from './supabase'
import { nowcastTemperature } from './nowcaster'
import { loadBacktestBias } from './backtest-bias'
import { aplicarModeloGanador, seleccionarMejorModelo, clearModelSelectionCache, getModelSelectionCache } from './modelo-selector'

const SIMULACIONES = 20000

function detectArbitrage(contracts: PolymarketContract[]): { desvio: number; nivel: string } {
  const num = contracts.length
  if (num < 2) return { desvio: 0, nivel: `N/A (${num} contratos)` }
  const probs = contracts.map(c => c.prob_ia_norm ?? 0)
  const suma = probs.reduce((s, v) => s + v, 0)
  const desvio = Math.abs(suma - 1.0)
  if (num <= 3) return { desvio, nivel: `BAJO (solo ${num} contratos)` }
  if (desvio < 0.08) return { desvio, nivel: 'BAJO' }
  if (desvio < 0.18) return { desvio, nivel: 'MEDIO' }
  return { desvio, nivel: 'ALTO (Posible Arbitraje)' }
}

function getStatus(edge: number): string {
  if (edge > 8) return 'EXCELENTE'
  if (edge > 5) return 'BUENA'
  if (edge > 2) return 'NEUTRAL'
  return 'EVITAR'
}

async function analyzeCity(
  city: typeof CIUDADES_ASIA[number],
  fechaISO: string,
  fechaObjetivo: string,
  targetMonth: number,
  recentModelErrors: Record<string, number[]>,
  fetchPrices: boolean,
  backtestBiasCorrection: number | undefined,
  calibrationPairs: { slug: string; prediction: number; outcome: number }[],
  historicalAccuracy: { accuracy: number; muestras: number } | null,
  globalAccuracyPct: number,
  cityHistory: HistoricalRecord[]
): Promise<{ cityAnalysis: CityAnalysis | null; recommendations: BetRecommendation[] }> {
  // 1. Lanzar en paralelo: weather models, recentErrors y polymarket (no dependen entre sí)
  const [weatherModelsResult, recentErrors, contractsPre] = await Promise.all([
    fetchWeatherModels(city.lat, city.lon, fechaISO),
    getRecentErrors(city.slug, 30),
    fetchPrices ? fetchPolymarketPrices(city.slug, fechaObjetivo).catch(() => [] as PolymarketContract[]) : Promise.resolve([] as PolymarketContract[]),
  ])
  const ensembleRaw = weatherModelsResult.models
  const ensembleMembers = weatherModelsResult.ensembleMembers
  const weatherCode = weatherModelsResult.weatherCode
  const precipitation = weatherModelsResult.precipitation
  if (Object.keys(ensembleRaw).length === 0) {
    return { cityAnalysis: null, recommendations: [] }
  }

  // 2. Ensemble with biases + Z-score filter + empirical CDF
  const cityModelErrors: Record<string, number[]> = {}
  for (const [slug, errs] of Object.entries(recentModelErrors)) {
    if (slug === city.slug) cityModelErrors[slug] = errs
  }

  const forecast = computeEnsemble({
    slug: city.slug,
    mes: targetMonth,
    modelsRaw: ensembleRaw,
    recentErrors,
    recentModelErrors: cityModelErrors,
    backtestBiasCorrection,
    ensembleMembers,
    weatherCode,
    precipitation,
  })

  // 3. Nowcasting — blend live METAR observation into forecast
  const nowcastResult = await nowcastTemperature(city.slug, city.lat, city.lon, forecast.temp_corregida)
  const tempFinal = nowcastResult.temp
  // Apply dynamic bias correction AFTER nowcast
  const tempWithBias = tempFinal + (forecast.sesgo_aplicado ?? 0)
  forecast.temp_corregida = Math.round(Math.max(0, tempWithBias) * 100) / 100

  // 3b. Applying winner model per city (MC or KALMAN) to the LIVE forecast.
  // Note: the base (temp_corregida) is preserved in forecast.temp_corregida_base so
  // MC/KALMAN keep training on the raw ensemble error, while the LIVE value shown
  // to the user is overridden with the winner model's correction.
  const baseTemp = forecast.temp_corregida
  forecast.temp_corregida_base = baseTemp
  try {
    // cityHistory ya viene precargado desde runDailyAnalysis (con modelo dinámico seleccionado)
    if (cityHistory.length > 0) {
      const { temp, modelo, bias, muestras, temp_alt, modelo_alt, bias_alt } = aplicarModeloGanador(
        city.slug,
        city.nombre,
        baseTemp,
        cityHistory,
        fechaObjetivo
      )
      forecast.temp_corregida = temp
      forecast.modelo_activo = modelo
      forecast.sesgo_modelo = bias
      forecast.modelo_muestras = muestras
      // Guardar también la corrección del modelo perdedor para backtest estable
      forecast.temp_corregida_alt = temp_alt
      forecast.modelo_alt = modelo_alt
      forecast.sesgo_alt = bias_alt
    }
  } catch (e) {
    console.warn(`[${city.slug}] Skip winner-model (${(e as Error).message})`)
  }

  // 4. Polymarket prices (ya obtenidos en paralelo al inicio)
  let contracts: PolymarketContract[] = contractsPre

  // Calculate success probability using real historical accuracy
  let exitoPct: number
  if (historicalAccuracy && historicalAccuracy.muestras >= 5) {
    const priorStrength = 10
    exitoPct = Math.round(
      (historicalAccuracy.accuracy * historicalAccuracy.muestras + globalAccuracyPct * priorStrength)
      / (historicalAccuracy.muestras + priorStrength)
    )
  } else {
    exitoPct = Math.round(globalAccuracyPct)
  }
  // Weather penalty based on real data analysis (225 records):
  // Nublado (code 3) → MAE +0.13°C peor que global; Lluvia y tormenta NO penalizan
  const weather = forecast.weather
  let weatherPenalty = 0
  let weatherNote = ''
  if (weather) {
    if (weather.code === 3) { weatherPenalty = -1; weatherNote = 'Nublado — precisión ligeramente reducida' }
    if (weatherPenalty < 0) {
      exitoPct = Math.max(10, exitoPct + weatherPenalty)
    }
  }

  const modelosTemps = Object.values(forecast.ensemble_raw)
  const spread = modelosTemps.length > 0 ? Math.max(...modelosTemps) - Math.min(...modelosTemps) : 3
  const numModelos = modelosTemps.length
  const parts: string[] = []
  parts.push(`${numModelos} modelos meteorológicos`)
  if (nowcastResult.obsWeight > 0) {
    parts.push(`nowcasting activo (${(nowcastResult.obsWeight * 100).toFixed(0)}% peso observación)`)
  }
  parts.push(`consenso ${forecast.consenso.toLowerCase()}`)
  parts.push(`spread ${spread.toFixed(1)}°C entre modelos`)
  if (weather) parts.push(`${weather.icon} ${weather.label}`)
  const histSamples = historicalAccuracy?.muestras ?? 0
  const histInfo = histSamples >= 5
    ? `Precisión histórica real: ${exitoPct}% (${histSamples} registros).`
    : `Precisión histórica real: ${exitoPct}% (promedio global, pocos registros locales).`
  const explicacion = `${weatherNote ? weatherNote + '. ' : ''}Pronóstico basado en ${parts.join(', ')}. ${histInfo}`

  // 5. Probability: empirical CDF (ECMWF ENS 51) or Monte Carlo
  const useEmpirical = forecast.ensemble_members && forecast.ensemble_members.length >= 20
  for (const p of contracts) {
    const parsed = p.tipo ? p : parseContract(p.texto)
    p.tipo = parsed.tipo
    p.valor = parsed.valor

    if (useEmpirical) {
      const members = forecast.ensemble_members!
      const rawVal = parsed.valor
      let rawProb = 0
      if (parsed.tipo === 'inferior' && typeof rawVal === 'number') {
        const countBelow = members.filter(m => m < rawVal).length
        rawProb = Math.max(1 / (members.length + 1), Math.min(1 - 1 / (members.length + 1), countBelow / members.length))
      } else if (parsed.tipo === 'superior' && typeof rawVal === 'number') {
        const countAbove = members.filter(m => m > rawVal).length
        rawProb = Math.max(1 / (members.length + 1), Math.min(1 - 1 / (members.length + 1), countAbove / members.length))
      } else if (parsed.tipo === 'exacto') {
        const val = typeof rawVal === 'number' ? rawVal : 0
        const low = val - 0.5
        const highVal = val + 0.5
        const countIn = members.filter(m => m >= low && m <= highVal).length
        rawProb = Math.max(1 / (members.length + 1), Math.min(1 - 1 / (members.length + 1), countIn / members.length))
      } else if (parsed.tipo === 'rango' && Array.isArray(rawVal)) {
        const [low, highVal] = rawVal
        const countIn = members.filter(m => m >= low && m <= highVal).length
        rawProb = Math.max(1 / (members.length + 1), Math.min(1 - 1 / (members.length + 1), countIn / members.length))
      } else {
        rawProb = monteCarloProbability(forecast.ensemble_raw, forecast.temp_corregida, forecast.volatilidad, SIMULACIONES, parsed.tipo, parsed.valor)
      }
      p.prob_ia_raw = Math.round(rawProb * 10000) / 10000
    } else {
      p.prob_ia_raw = Math.round(
        monteCarloProbability(forecast.ensemble_raw, forecast.temp_corregida, forecast.volatilidad, SIMULACIONES, parsed.tipo, parsed.valor) * 10000
      ) / 10000
    }
  }

  // 6. Normalize + calibrate (Platt + Isotonic)
  const normalized = normalizeProbabilidades(contracts.map(c => c.prob_ia_raw!))

  // Find optimal Platt params from city-specific history
  // Calibración: pares sintéticos no son confiables para isotónico. Usar identity.
  const calibrated = normalized
  for (let i = 0; i < contracts.length; i++) {
    contracts[i].prob_ia_norm = calibrated[i]
  }

  // 7. Arbitrage
  const arb = detectArbitrage(contracts)

  // 7b. Calculate EV and liquidity for each contract
  for (const c of contracts) {
    const probIA = c.prob_ia_norm ?? 0
    const probMkt = c.prob_mkt / 100
    c.ev = calculateEV(probIA, probMkt)
    c.liquidity = calculateLiquidity(c.volume_24h, c.spread)
  }

  // 8. Recommendations
  const recs: BetRecommendation[] = contracts.map(p => {
    const iaPct = Math.round((p.prob_ia_norm ?? 0) * 10000) / 100
    const edge = Math.round((iaPct - p.prob_mkt) * 100) / 100
    return {
      ciudad: city.nombre,
      slug: city.slug,
      contrato: p.texto,
      tipo: p.tipo,
      mkt_pct: p.prob_mkt,
      ia_pct: iaPct,
      edge,
      ev_dollar: Math.round(edge * 0.1 * 100) / 100,
      temp_corregida: forecast.temp_corregida,
      consenso: forecast.consenso,
      arbitraje: arb.nivel,
      monto: 0,
      peso: 0,
      status: getStatus(edge),
      exito_pct: exitoPct,
      exito_pct_integer: exitoPct,
      explicacion,
    }
  })

  return {
    cityAnalysis: {
      ciudad: city.nombre,
      slug: city.slug,
      contratos: contracts,
      forecast,
      arbitraje: arb,
      nowcast: {
        activo: nowcastResult.obsWeight > 0,
        peso_observacion: nowcastResult.obsWeight,
        temp_observada: nowcastResult.observedTemp,
        estacion: nowcastResult.station,
        hora_local: (new Date().getUTCHours() + Math.round(city.lon / 15) + 24) % 24,
      },
      exito_pct: exitoPct,
      exito_pct_integer: exitoPct,
      explicacion,
      totalRecords: histSamples,
      // Aggregate liquidity & volume from contracts
      liquidity_avg: contracts.length > 0
        ? (['ALTA','MEDIA','BAJA'] as const).reduce((best, level) => {
            const count = contracts.filter(c => c.liquidity === level).length
            return count / contracts.length > 0.5 ? level : best
          }, 'BAJA' as const)
        : undefined,
      volume_total: contracts.reduce((s, c) => s + (c.volume_24h ?? 0), 0) || undefined,
      avg_spread: contracts.length > 0
        ? contracts.reduce((s, c) => s + (c.spread ?? 0.10), 0) / contracts.length
        : undefined,
    },
    recommendations: recs,
  }
}

export async function runDailyAnalysis(
  fechaObjetivo: string,
  fetchPrices: boolean = true
): Promise<DailyAnalysis> {
  const now = new Date()
  const fechaEjecucion = now.toISOString()

  const caracasOffset = -4 * 60
  const nowCaracas = new Date(now.getTime() + caracasOffset * 60000)
  const caracasTimeStr = `${nowCaracas.getUTCHours().toString().padStart(2, '0')}:${nowCaracas.getUTCMinutes().toString().padStart(2, '0')}`

  const targetMonth = new Date(fechaObjetivo).getMonth() + 1

  // Pre-load history (parallel)
  const [recentModelErrors, globalMetrics, backtestBias, calPairs, historicalErrors] = await Promise.all([
    getRecentModelErrors(30),
    computeGlobalMetrics(),
    loadBacktestBias(),
    getAllCalibrationPairs(),
    getAllHistoricalErrors(),
  ])
  const globalAccuracyPct = globalMetrics?.accuracy_pct ?? 50

  // Pre-load historical accuracy per city (full history, no time limit)
  const historicalAccuracyMap: Record<string, { accuracy: number; muestras: number }> = {}
  const cityHistoryMap: Record<string, HistoricalRecord[]> = {}
  await Promise.all(
    CIUDADES_ASIA.map(async city => {
      historicalAccuracyMap[city.slug] = await getHistoricalAccuracy(city.slug, 0)
      cityHistoryMap[city.slug] = await getCityHistory(city.slug)
    })
  )

  // ===== SELECCIÓN DINÁMICA DEL MODELO GANADOR POR CIUDAD =====
  // Walk-forward sobre últimos 60 días: compara MAE KALMAN vs MC sin look-ahead
  clearModelSelectionCache()
  const modelSelectionLog: string[] = []
  for (const city of CIUDADES_ASIA) {
    const hist = cityHistoryMap[city.slug] ?? []
    const selection = seleccionarMejorModelo(hist, city.slug)
    modelSelectionLog.push(`  ${city.slug}: ${selection.modelo} (${selection.reason})`)
  }
  console.log(`[MODEL SELECT] Selección dinámica de modelo por ciudad:\n${modelSelectionLog.join('\n')}`)

  // Analyze all cities in parallel — use fechaObjetivo for Open-Meteo API calls
  const results = await Promise.all(
    CIUDADES_ASIA.map(city =>
      analyzeCity(city, fechaObjetivo, fechaObjetivo, targetMonth, recentModelErrors, fetchPrices, backtestBias[city.slug], calPairs, historicalAccuracyMap[city.slug], globalAccuracyPct, cityHistoryMap[city.slug] ?? [])
    )
  )

  const cities: CityAnalysis[] = []
  const allRecommendations: BetRecommendation[] = []
  const arbitrageAlerts: string[] = []

  for (const r of results) {
    if (r.cityAnalysis) {
      cities.push(r.cityAnalysis)
      allRecommendations.push(...r.recommendations)
      if (r.cityAnalysis.arbitraje.nivel.includes('ALTO')) {
        arbitrageAlerts.push(`${r.cityAnalysis.ciudad}: ${r.cityAnalysis.arbitraje.nivel}`)
      }
    }
  }

  const recommendations = calculateAllocation(allRecommendations)
  const totalAllocated = recommendations.reduce((s, r) => s + r.monto, 0)

  return {
    fecha: fechaEjecucion,
    fecha_objetivo: fechaObjetivo,
    message: `Análisis completado para ${fechaObjetivo} a las ${caracasTimeStr} Caracas`,
    cities,
    recommendations,
    total_allocated: Math.round(totalAllocated * 100) / 100,
    global_metrics: globalMetrics,
    arbitrage_alerts: arbitrageAlerts,
    historicalErrors,
  }
}
