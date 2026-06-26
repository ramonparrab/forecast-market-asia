/**
 * Backtest Engine
 * 
 * Procesa 90 días históricos: para cada día, fetch de 6 modelos meteorológicos
 * desde Open-Meteo, ejecuta el pipeline ensemble + bias, y compara contra
 * la temperatura real observada (archive API).
 * 
 * Eficiencia: 1 llamada forecast + 1 archive por ciudad = 18 llamadas totales
 * para los 90 días × 9 ciudades.
 */
import { CIUDADES_ASIA, MODELOS_CLIMATICOS } from './cities'
import { computeEnsemble } from './ensemble'

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive'

/** Sleep helper to respect Open-Meteo rate limits */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const API_DELAY_MS = 300

export interface BacktestDayResult {
  fecha: string
  ciudad: string
  slug: string
  temp_pronosticada: number
  temp_corregida: number
  temp_real: number
  error: number
  modelos_usados: number
  consenso: string
  sesgo_aplicado: number
}

export interface BacktestCityMetrics {
  ciudad: string
  slug: string
  muestras: number
  mae: number
  rmse: number
  bias: number
  accuracy_within_2c: number // %
  accuracy_within_1c: number // %
  max_error: number
}

export interface BacktestSummary {
  total_dias: number
  total_ciudades: number
  total_muestras: number
  overall_mae: number
  overall_rmse: number
  overall_bias: number
  overall_accuracy_2c: number
  overall_accuracy_1c: number
  por_ciudad: BacktestCityMetrics[]
  mejores_ciudades: string[]
  peores_ciudades: string[]
  resultados: BacktestDayResult[]
  timestamp: string
}

/**
 * Fetch actual daily max temps from archive API for a city/date range.
 * Returns a map: fecha → temp_real
 */
async function fetchActualsForCity(lat: number, lon: number, startDate: string, endDate: string): Promise<Record<string, number>> {
  const url = `${ARCHIVE_BASE}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${startDate}&end_date=${endDate}&timezone=auto`
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!resp.ok) throw new Error(`Archive HTTP ${resp.status}`)
  const data = await resp.json()
  const times: string[] = data?.daily?.time ?? []
  const temps: number[] = data?.daily?.temperature_2m_max ?? []
  const map: Record<string, number> = {}
  for (let i = 0; i < times.length; i++) {
    if (temps[i] !== null && temps[i] !== undefined) map[times[i]] = temps[i]
  }
  return map
}

/**
 * Fetch 6-model forecast data for a city over a date range.
 * Returns parsed per-day per-model max temps.
 */
interface ParsedForecastDay {
  fecha: string
  models: Record<string, number>
}

async function fetchForecastsForCity(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<ParsedForecastDay[]> {
  const modelsParam = MODELOS_CLIMATICOS.join(',')
  const url = `${FORECAST_BASE}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&temperature_unit=celsius&start_date=${startDate}&end_date=${endDate}&timezone=auto&models=${modelsParam}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!resp.ok) throw new Error(`Forecast HTTP ${resp.status}`)
  const data = await resp.json()

  const hourly = data.hourly || {}
  const times: string[] = hourly.time ?? []

  if (times.length === 0) return []

  // Group hourly data by day
  const days: Record<string, Record<string, number[]>> = {}
  for (let i = 0; i < times.length; i++) {
    const fecha = times[i].slice(0, 10)
    if (!days[fecha]) days[fecha] = {}
    for (const model of MODELOS_CLIMATICOS) {
      const key = `temperature_2m_${model}`
      const val = hourly[key]?.[i]
      if (val !== undefined && val !== null) {
        if (!days[fecha][model]) days[fecha][model] = []
        days[fecha][model].push(val)
      }
    }
  }

  // Compute daily max per model per day
  return Object.entries(days).map(([fecha, modelTemps]) => {
    const models: Record<string, number> = {}
    for (const [model, temps] of Object.entries(modelTemps)) {
      models[model] = Math.max(...temps)
    }
    return { fecha, models }
  })
}

export async function runBacktest(days: number = 90, offsetDays: number = 0): Promise<BacktestSummary> {
  const endDate = new Date()
  // End date = yesterday minus offset (don't include today, which is incomplete)
  endDate.setDate(endDate.getDate() - 1 - offsetDays)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days + 1)

  const startStr = startDate.toISOString().slice(0, 10)
  const endStr = endDate.toISOString().slice(0, 10)

  console.log(`[BACKTEST] Running ${days} days from ${startStr} to ${endStr} for ${CIUDADES_ASIA.length} cities`)

  // Fetch cities sequentially with delays to respect rate limits
  const cityResults: { slug: string; ciudad: string; forecastDays: ParsedForecastDay[]; actuals: Record<string, number> }[] = []
  for (const city of CIUDADES_ASIA) {
    try {
      const [forecastDays, actuals] = await Promise.all([
        fetchForecastsForCity(city.lat, city.lon, startStr, endStr),
        fetchActualsForCity(city.lat, city.lon, startStr, endStr),
      ])
      cityResults.push({ slug: city.slug, ciudad: city.nombre, forecastDays, actuals })
      await sleep(API_DELAY_MS)
    } catch (e) {
      console.warn(`[BACKTEST] Error fetching ${city.slug}:`, (e as Error).message)
    }
  }

  // Process each day for each city
  const allResults: BacktestDayResult[] = []

  for (const city of cityResults) {
    const { slug, ciudad, forecastDays, actuals } = city

    for (const day of forecastDays) {
      const actualTemp = actuals[day.fecha]
      if (actualTemp === undefined || Object.keys(day.models).length === 0) continue

      // Run the same ensemble pipeline
      const forecast = computeEnsemble({
        slug,
        mes: new Date(day.fecha + 'T12:00:00').getMonth() + 1,
        modelsRaw: day.models,
        recentErrors: [], // No historical errors for backtest
        recentModelErrors: {},
      })

      const error = Math.round((actualTemp - forecast.temp_corregida) * 100) / 100

      allResults.push({
        fecha: day.fecha,
        ciudad,
        slug,
        temp_pronosticada: forecast.temp_ponderada,
        temp_corregida: forecast.temp_corregida,
        temp_real: actualTemp,
        error,
        modelos_usados: Object.keys(day.models).length,
        consenso: forecast.consenso,
        sesgo_aplicado: forecast.sesgo_aplicado,
      })
    }
  }

  // Compute metrics per city
  const byCity: Record<string, BacktestDayResult[]> = {}
  for (const r of allResults) {
    if (!byCity[r.slug]) byCity[r.slug] = []
    byCity[r.slug].push(r)
  }

  const cityMetrics: BacktestCityMetrics[] = Object.entries(byCity).map(([slug, results]) => {
    const errors = results.map(r => r.error)
    const absErrors = errors.map(Math.abs)
    const mae = Math.round(absErrors.reduce((s, v) => s + v, 0) / errors.length * 100) / 100
    const rmse = Math.round(Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / errors.length) * 100) / 100
    const bias = Math.round(errors.reduce((s, v) => s + v, 0) / errors.length * 100) / 100
    const within2 = results.filter(r => Math.abs(r.error) <= 2).length
    const within1 = results.filter(r => Math.abs(r.error) <= 1).length
    const maxError = Math.round(Math.max(...absErrors) * 100) / 100

    return {
      ciudad: results[0]?.ciudad ?? slug,
      slug,
      muestras: results.length,
      mae,
      rmse,
      bias,
      accuracy_within_2c: Math.round(within2 / results.length * 10000) / 100,
      accuracy_within_1c: Math.round(within1 / results.length * 10000) / 100,
      max_error: maxError,
    }
  })

  // Overall metrics
  const allErrors = allResults.map(r => r.error)
  const allAbsErrors = allErrors.map(Math.abs)
  const overallMae = Math.round(allAbsErrors.reduce((s, v) => s + v, 0) / allErrors.length * 100) / 100
  const overallRmse = Math.round(Math.sqrt(allErrors.reduce((s, v) => s + v * v, 0) / allErrors.length) * 100) / 100
  const overallBias = Math.round(allErrors.reduce((s, v) => s + v, 0) / allErrors.length * 100) / 100
  const within2 = allResults.filter(r => Math.abs(r.error) <= 2).length
  const within1 = allResults.filter(r => Math.abs(r.error) <= 1).length

  // Best/worst cities by MAE
  const sorted = [...cityMetrics].sort((a, b) => a.mae - b.mae)
  const mejoresCiudades = sorted.slice(0, 3).map(c => c.ciudad)
  const peoresCiudades = sorted.slice(-3).reverse().map(c => c.ciudad)

  return {
    total_dias: days,
    total_ciudades: CIUDADES_ASIA.length,
    total_muestras: allResults.length,
    overall_mae: overallMae,
    overall_rmse: overallRmse,
    overall_bias: overallBias,
    overall_accuracy_2c: Math.round(within2 / allResults.length * 10000) / 100,
    overall_accuracy_1c: Math.round(within1 / allResults.length * 10000) / 100,
    por_ciudad: cityMetrics,
    mejores_ciudades: mejoresCiudades,
    peores_ciudades: peoresCiudades,
    resultados: allResults,
    timestamp: new Date().toISOString(),
  }
}
