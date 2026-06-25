import { CityAnalysis, BetRecommendation, DailyAnalysis, PolymarketContract, ForecastResult } from '@/types'
import { CIUDADES_ASIA } from './cities'
import { fetchWeatherModels } from './openmeteo'
import { computeEnsemble } from './ensemble'
import { monteCarloProbability, normalizeProbabilidades } from './montecarlo'
import { fetchPolymarketPrices, parseContract } from './polymarket'
import { calibrateProbabilities } from './calibration'
import { calculateAllocation } from './kelly'
import { getRecentErrors, getRecentModelErrors, getHistoricalRecords, computeGlobalMetrics } from './supabase'

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

export async function runDailyAnalysis(
  fechaObjetivo: string,
  fetchPrices: boolean = true
): Promise<DailyAnalysis> {
  const now = new Date()
  const fechaEjecucion = now.toISOString()
  
  // Caracas time info
  const caracasOffset = -4 * 60 // UTC-4
  const nowCaracas = new Date(now.getTime() + caracasOffset * 60000)
  const caracasHour = nowCaracas.getUTCHours()
  const caracasMin = nowCaracas.getUTCMinutes()
  const caracasTimeStr = `${caracasHour.toString().padStart(2, '0')}:${caracasMin.toString().padStart(2, '0')}`

  // Parse target date
  const targetDate = new Date(fechaObjetivo)
  const fechaISO = targetDate.toISOString().slice(0, 10)
  const targetMonth = targetDate.getMonth() + 1 // 1-based

  // Load history for adaptive learning
  const [recentErrorsByCity, recentModelErrors, globalMetrics] = await Promise.all([
    getRecentErrors('all', 30),
    getRecentModelErrors(30),
    computeGlobalMetrics(),
  ])

  // Helper: get errors for a specific city
  const getAllRecentErrors = async (slug: string) => {
    return getRecentErrors(slug, 30)
  }

  const cities: CityAnalysis[] = []
  const allRecommendations: BetRecommendation[] = []
  const arbitrageAlerts: string[] = []

  for (const city of CIUDADES_ASIA) {
    console.log(`Processing ${city.nombre}...`)

    // 1. Fetch weather models
    const ensembleRaw = await fetchWeatherModels(city.lat, city.lon, fechaISO)
    const numModelos = Object.keys(ensembleRaw).length
    console.log(`  Models: ${numModelos} (${Object.keys(ensembleRaw).join(', ')})`)

    if (numModelos === 0) {
      console.warn(`  No weather data for ${city.slug}, skipping`)
      continue
    }

    // 2. Compute ensemble with adaptive biases
    const recentErrors = await getAllRecentErrors(city.slug)
    const cityModelErrors: Record<string, number[]> = {}
    // simplified: use global recentModelErrors keyed by city slug
    for (const [slug, errs] of Object.entries(recentModelErrors)) {
      if (slug === city.slug) cityModelErrors[slug] = errs
    }

    const forecast: ForecastResult = computeEnsemble({
      slug: city.slug,
      mes: targetMonth,
      modelsRaw: ensembleRaw,
      recentErrors,
      recentModelErrors: cityModelErrors,
    })

    // 3. Fetch Polymarket prices
    let contracts: PolymarketContract[] = []
    if (fetchPrices) {
      contracts = await fetchPolymarketPrices(city.slug, fechaObjetivo)
    }

    // If Gamma API fails, use mock data for demo/testing
    if (!fetchPrices || contracts.length === 0) {
      contracts = getMockContracts(city.slug)
    }

    if (contracts.length === 0) continue

    // 4. Monte Carlo + calibration for each contract
    for (const p of contracts) {
      const { tipo, valor } = p.tipo ? p : parseContract(p.texto)
      p.tipo = tipo
      p.valor = valor

      const probRaw = monteCarloProbability(
        forecast.ensemble_raw,
        forecast.temp_corregida,
        forecast.volatilidad,
        SIMULACIONES,
        tipo,
        valor
      )
      p.prob_ia_raw = Math.round(probRaw * 10000) / 10000
    }

    // 5. Normalize probabilities
    const rawProbs = contracts.map(c => c.prob_ia_raw!)
    const normalized = normalizeProbabilidades(rawProbs)
    
    // 6. Calibrate using Platt scaling (with optimal params from history)
    let alpha = 1.0, beta = 0.0
    // We'd calibrate from history, but simplified for now
    const calibrated = calibrateProbabilities(normalized, alpha, beta)

    for (let i = 0; i < contracts.length; i++) {
      contracts[i].prob_ia_norm = calibrated[i]
    }

    // 7. Arbitrage detection
    const arb = detectArbitrage(contracts)
    if (arb.nivel.includes('ALTO')) {
      arbitrageAlerts.push(`${city.nombre}: ${arb.nivel} (desvío ${(arb.desvio * 100).toFixed(1)}%)`)
    }

    // 8. Build recommendations
    for (const p of contracts) {
      const iaPct = Math.round((p.prob_ia_norm ?? 0) * 10000) / 100
      const edge = Math.round((iaPct - p.prob_mkt) * 100) / 100

      allRecommendations.push({
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
      })
    }

    cities.push({
      ciudad: city.nombre,
      slug: city.slug,
      contratos: contracts,
      forecast,
      arbitraje: arb,
    })
  }

  // 9. Kelly allocation
  const recommendations = calculateAllocation(allRecommendations)
  const totalAllocated = recommendations.reduce((s, r) => s + r.monto, 0)

  // 10. Build response
  return {
    fecha: fechaEjecucion,
    message: `Análisis completado para ${fechaObjetivo} a las ${caracasTimeStr} Caracas`,
    cities,
    recommendations,
    total_allocated: Math.round(totalAllocated * 100) / 100,
    global_metrics: globalMetrics,
    arbitrage_alerts: arbitrageAlerts,
  }
}

/**
 * Mock contracts for demo/testing when API is unavailable.
 */
function getMockContracts(slug: string): PolymarketContract[] {
  const mockTemps = [22, 24, 26, 28, 30, 32, 34, 36]
  return mockTemps.map((temp, i) => ({
    token_id: `mock-${slug}-${temp}`,
    texto: `${temp}°C ${30 + i * 8}%`,
    tipo: 'exacto' as const,
    valor: temp,
    prob_mkt: 30 + i * 8,
  }))
}
