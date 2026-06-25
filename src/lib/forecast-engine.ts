import { CityAnalysis, BetRecommendation, DailyAnalysis, PolymarketContract, ForecastResult } from '@/types'
import { CIUDADES_ASIA } from './cities'
import { fetchWeatherModels } from './openmeteo'
import { computeEnsemble } from './ensemble'
import { monteCarloProbability, normalizeProbabilidades } from './montecarlo'
import { fetchPolymarketPrices, parseContract } from './polymarket'
import { calibrateProbabilities } from './calibration'
import { calculateAllocation } from './kelly'
import { getRecentErrors, getRecentModelErrors, computeGlobalMetrics } from './supabase'

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
  fetchPrices: boolean
): Promise<{ cityAnalysis: CityAnalysis | null; recommendations: BetRecommendation[] }> {
  // 1. Weather models
  const ensembleRaw = await fetchWeatherModels(city.lat, city.lon, fechaISO)
  if (Object.keys(ensembleRaw).length === 0) {
    return { cityAnalysis: null, recommendations: [] }
  }

  // 2. Ensemble with biases
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
  })

  // 3. Polymarket prices
  let contracts: PolymarketContract[] = []
  if (fetchPrices) {
    contracts = await fetchPolymarketPrices(city.slug, fechaObjetivo)
  }
  if (contracts.length === 0) {
    contracts = getMockContracts(city.slug)
  }

  // 4. Monte Carlo
  for (const p of contracts) {
    const parsed = p.tipo ? p : parseContract(p.texto)
    p.tipo = parsed.tipo
    p.valor = parsed.valor

    p.prob_ia_raw = Math.round(
      monteCarloProbability(forecast.ensemble_raw, forecast.temp_corregida, forecast.volatilidad, SIMULACIONES, parsed.tipo, parsed.valor) * 10000
    ) / 10000
  }

  // 5. Normalize + calibrate
  const normalized = normalizeProbabilidades(contracts.map(c => c.prob_ia_raw!))
  const calibrated = calibrateProbabilities(normalized, 1.0, 0.0)
  for (let i = 0; i < contracts.length; i++) {
    contracts[i].prob_ia_norm = calibrated[i]
  }

  // 6. Arbitrage
  const arb = detectArbitrage(contracts)

  // 7. Recommendations
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
    }
  })

  return {
    cityAnalysis: {
      ciudad: city.nombre,
      slug: city.slug,
      contratos: contracts,
      forecast,
      arbitraje: arb,
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

  const fechaISO = now.toISOString().slice(0, 10)
  const targetMonth = new Date(fechaObjetivo).getMonth() + 1

  // Pre-load history (parallel)
  const [recentModelErrors, globalMetrics] = await Promise.all([
    getRecentModelErrors(30),
    computeGlobalMetrics(),
  ])

  // Analyze all cities in parallel
  const results = await Promise.all(
    CIUDADES_ASIA.map(city =>
      analyzeCity(city, fechaISO, fechaObjetivo, targetMonth, recentModelErrors, fetchPrices)
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
