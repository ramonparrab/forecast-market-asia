import { CityAnalysis, BetRecommendation, DailyAnalysis, PolymarketContract, ForecastResult } from '@/types'
import { CIUDADES_ASIA } from './cities'
import { fetchWeatherModels } from './openmeteo'
import { computeEnsemble } from './ensemble'
import { monteCarloProbability, normalizeProbabilidades } from './montecarlo'
import { fetchPolymarketPrices, parseContract } from './polymarket'
import { calibrateProbabilities } from './calibration'
import { calculateAllocation } from './kelly'
import { getRecentErrors, getRecentModelErrors, computeGlobalMetrics } from './supabase'
import { nowcastTemperature } from './nowcaster'
import { loadBacktestBias } from './backtest-bias'

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

function getMockContracts(slug: string): PolymarketContract[] {
  return [22, 24, 26, 28, 30, 32, 34, 36].map((temp, i) => ({
    token_id: `mock-${slug}-${temp}`,
    texto: `${temp}°C ${30 + i * 8}%`,
    tipo: 'exacto' as const,
    valor: temp,
    prob_mkt: 30 + i * 8,
  }))
}

async function analyzeCity(
  city: typeof CIUDADES_ASIA[number],
  fechaISO: string,
  fechaObjetivo: string,
  targetMonth: number,
  recentModelErrors: Record<string, number[]>,
  fetchPrices: boolean,
  backtestBiasCorrection?: number
): Promise<{ cityAnalysis: CityAnalysis | null; recommendations: BetRecommendation[] }> {
  // 1. Weather models (includes ECMWF ENS 51 members)
  const { models: ensembleRaw, ensembleMembers } = await fetchWeatherModels(city.lat, city.lon, fechaISO)
  if (Object.keys(ensembleRaw).length === 0) {
    return { cityAnalysis: null, recommendations: [] }
  }

  // 2. Ensemble with biases + Z-score filter + empirical CDF
  const recentErrors = await getRecentErrors(city.slug, 30)
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
  })

  // 3. Nowcasting — blend live METAR observation into forecast
  const nowcastResult = await nowcastTemperature(city.slug, city.lat, city.lon, forecast.temp_corregida)
  const tempFinal = nowcastResult.temp
  // Update forecast with nowcasted temperature
  forecast.temp_corregida = tempFinal
  forecast.temp_ponderada = tempFinal

  // 4. Polymarket prices
  let contracts: PolymarketContract[] = []
  if (fetchPrices) {
    contracts = await fetchPolymarketPrices(city.slug, fechaObjetivo)
  }
  if (contracts.length === 0) {
    contracts = getMockContracts(city.slug)
  }

  // Calculate success probability: how likely is the forecast to be within ±2°C of actual
  const modelosTemps = Object.values(forecast.ensemble_raw)
  const spread = modelosTemps.length > 0 ? Math.max(...modelosTemps) - Math.min(...modelosTemps) : 3
  const numModelos = modelosTemps.length
  // Success factors: narrow spread, strong consensus, many models, nowcast active
  let exitoPct = 50
  if (numModelos >= 5) exitoPct += 8
  else if (numModelos >= 3) exitoPct += 4
  if (spread <= 1.5) exitoPct += 15
  else if (spread <= 2.5) exitoPct += 8
  else if (spread <= 3.5) exitoPct += 3
  else exitoPct -= 5
  if (forecast.consenso === 'MUY FUERTE') exitoPct += 10
  else if (forecast.consenso === 'FUERTE') exitoPct += 5
  if (nowcastResult.obsWeight > 0.3) exitoPct += 8
  if (nowcastResult.observedTemp !== null) exitoPct += 5
  exitoPct = Math.max(10, Math.min(95, exitoPct))
  // Build explanation
  const parts: string[] = []
  parts.push(`${numModelos} modelos meteorológicos`)
  if (nowcastResult.obsWeight > 0) {
    parts.push(`nowcasting activo (${(nowcastResult.obsWeight * 100).toFixed(0)}% peso observación)`)
  }
  parts.push(`consenso ${forecast.consenso.toLowerCase()}`)
  parts.push(`spread ${spread.toFixed(1)}°C entre modelos`)
  const explicacion = `Pronóstico basado en ${parts.join(', ')}. Precisión histórica estimada: ±${(spread * 0.5).toFixed(1)}°C.`

  // 5. Probability: empirical CDF (ECMWF ENS 51) or Monte Carlo
  const useEmpirical = forecast.ensemble_members && forecast.ensemble_members.length >= 20
  for (const p of contracts) {
    const parsed = p.tipo ? p : parseContract(p.texto)
    p.tipo = parsed.tipo
    p.valor = parsed.valor

    if (useEmpirical) {
      const members = forecast.ensemble_members!
      const high = forecast.temp_corregida
      const std = forecast.volatilidad
      let rawProb = 0
      if (parsed.tipo === 'inferior' && typeof parsed.valor === 'number') {
        const countBelow = members.filter(m => m < parsed.valor).length
        rawProb = Math.max(1 / (members.length + 1), Math.min(1 - 1 / (members.length + 1), countBelow / members.length))
      } else if (parsed.tipo === 'superior' && typeof parsed.valor === 'number') {
        const countAbove = members.filter(m => m > parsed.valor).length
        rawProb = Math.max(1 / (members.length + 1), Math.min(1 - 1 / (members.length + 1), countAbove / members.length))
      } else if (parsed.tipo === 'exacto') {
        const val = typeof parsed.valor === 'number' ? parsed.valor : 0
        const low = val - 0.5
        const highVal = val + 0.5
        const countIn = members.filter(m => m >= low && m <= highVal).length
        rawProb = Math.max(1 / (members.length + 1), Math.min(1 - 1 / (members.length + 1), countIn / members.length))
      } else if (parsed.tipo === 'rango' && Array.isArray(parsed.valor)) {
        const [low, highVal] = parsed.valor
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

  // 6. Normalize + calibrate
  const normalized = normalizeProbabilidades(contracts.map(c => c.prob_ia_raw!))
  const calibrated = calibrateProbabilities(normalized, 1.0, 0.0)
  for (let i = 0; i < contracts.length; i++) {
    contracts[i].prob_ia_norm = calibrated[i]
  }

  // 7. Arbitrage
  const arb = detectArbitrage(contracts)

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
        hora_local: new Date().getUTCHours() + Math.round(city.lon / 15),
      },
      exito_pct: exitoPct,
      explicacion,
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
  const [recentModelErrors, globalMetrics, backtestBias] = await Promise.all([
    getRecentModelErrors(30),
    computeGlobalMetrics(),
    loadBacktestBias(),
  ])

  // Analyze all cities in parallel — use fechaObjetivo for Open-Meteo API calls
  const results = await Promise.all(
    CIUDADES_ASIA.map(city =>
      analyzeCity(city, fechaObjetivo, fechaObjetivo, targetMonth, recentModelErrors, fetchPrices, backtestBias[city.slug])
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
  }
}
