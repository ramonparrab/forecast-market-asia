import { ModelTemps } from '@/types'
import { MODELOS_CLIMATICOS } from './cities'

const OPENMETEO_BASE = 'https://api.open-meteo.com/v1/forecast'
const OPENMETEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'

/**
 * Fetch the ACTUAL maximum temperature for a date.
 * For past dates, uses the Archive API (reliable historical data).
 * For today or future dates, uses the Forecast API.
 */
export async function fetchActualMaxTemp(
  lat: number,
  lon: number,
  fechaISO: string
): Promise<number | null> {
  const dateStr = fechaISO.slice(0, 10)
  const todayUTC = new Date().toISOString().slice(0, 10)
  const isPast = dateStr < todayUTC
  const baseUrl = isPast ? OPENMETEO_ARCHIVE : OPENMETEO_BASE
  const label = isPast ? 'Archive' : 'Forecast'

  try {
    const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${dateStr}&end_date=${dateStr}`
    console.log(`[Open-Meteo ${label}] ${dateStr} lat=${lat} lon=${lon}`)
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const maxTemp = data?.daily?.temperature_2m_max?.[0]
    if (maxTemp !== null && maxTemp !== undefined) {
      console.log(`[Open-Meteo ${label}] ${dateStr} → ${maxTemp}°C`)
    } else {
      console.warn(`[Open-Meteo ${label}] ${dateStr} → no data`)
    }
    return maxTemp ?? null
  } catch (e) {
    console.warn(`[Open-Meteo ${label}] Error for ${dateStr}:`, (e as Error).message)
    return null
  }
}

export interface WeatherModelsResult {
  models: ModelTemps
  ensembleMembers: number[]
  weatherCode: number
  precipitation: number
}

const WMO_LABELS: Record<number, { label: string; icon: string; severity: 'none' | 'low' | 'moderate' | 'severe' }> = {
  0:  { label: 'Despejado', icon: '☀️', severity: 'none' },
  1:  { label: 'Mayormente despejado', icon: '🌤', severity: 'none' },
  2:  { label: 'Parcialmente nublado', icon: '⛅', severity: 'none' },
  3:  { label: 'Nublado', icon: '☁️', severity: 'none' },
  45: { label: 'Niebla', icon: '🌫', severity: 'low' },
  48: { label: 'Niebla con escarcha', icon: '🌫', severity: 'low' },
  51: { label: 'Llovizna ligera', icon: '🌦', severity: 'low' },
  53: { label: 'Llovizna moderada', icon: '🌦', severity: 'low' },
  55: { label: 'Llovizna densa', icon: '🌧', severity: 'moderate' },
  56: { label: 'Llovizna helada ligera', icon: '🌧', severity: 'moderate' },
  57: { label: 'Llovizna helada densa', icon: '🌧', severity: 'moderate' },
  61: { label: 'Lluvia ligera', icon: '🌦', severity: 'low' },
  63: { label: 'Lluvia moderada', icon: '🌧', severity: 'moderate' },
  65: { label: 'Lluvia fuerte', icon: '🌧', severity: 'moderate' },
  66: { label: 'Lluvia helada ligera', icon: '🌧', severity: 'moderate' },
  67: { label: 'Lluvia helada fuerte', icon: '🌧', severity: 'severe' },
  71: { label: 'Nieve ligera', icon: '🌨', severity: 'moderate' },
  73: { label: 'Nieve moderada', icon: '❄️', severity: 'moderate' },
  75: { label: 'Nieve fuerte', icon: '❄️', severity: 'severe' },
  77: { label: 'Granos de nieve', icon: '❄️', severity: 'moderate' },
  80: { label: 'Chubascos ligeros', icon: '🌦', severity: 'low' },
  81: { label: 'Chubascos moderados', icon: '🌧', severity: 'moderate' },
  82: { label: 'Chubascos violentos', icon: '🌧', severity: 'severe' },
  85: { label: 'Chubascos de nieve ligeros', icon: '🌨', severity: 'moderate' },
  86: { label: 'Chubascos de nieve fuertes', icon: '❄️', severity: 'severe' },
  95: { label: 'Tormenta', icon: '⛈', severity: 'severe' },
  96: { label: 'Tormenta con granizo ligero', icon: '⛈', severity: 'severe' },
  99: { label: 'Tormenta con granizo fuerte', icon: '⛈', severity: 'severe' },
}

export function getWeatherInfo(code: number, precipitation: number): { label: string; icon: string; severity: 'none' | 'low' | 'moderate' | 'severe' } {
  const base = WMO_LABELS[code] ?? { label: 'Desconocido', icon: '❓', severity: 'none' as const }
  if (precipitation >= 25 && (code === 61 || code === 63 || code === 80 || code === 81)) {
    return { ...base, severity: 'severe' as const }
  }
  if (precipitation >= 10 && code >= 61 && code <= 67) {
    return { ...base, severity: 'moderate' as const }
  }
  return base
}

/**
 * Fetch weather model forecasts AND ECMWF ENS 51 ensemble members.
 * 
 * ECMWF ENS provides 51 perturbed members + 1 control run, giving a real
 * probability distribution (empirical CDF) instead of assumed parametric.
 * 
 * Includes retry logic for transient API failures.
 */
export async function fetchWeatherModels(
  lat: number,
  lon: number,
  fechaISO: string,
  modelos?: string[]
): Promise<WeatherModelsResult> {
  const toTry = modelos ?? MODELOS_CLIMATICOS
  const results: ModelTemps = {}
  const ensembleMembers: number[] = []

  const modelsParam = toTry.join(',')
  const baseUrl = `${OPENMETEO_BASE}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,weather_code,precipitation_sum,precipitation_probability_max&temperature_unit=celsius&start_date=${fechaISO}&end_date=${fechaISO}&models=${modelsParam}&timezone=auto`

  // Retry logic: try up to 3 times with exponential backoff
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(baseUrl, { signal: AbortSignal.timeout(20000) })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()

      const daily = data.daily || {}

      for (const model of toTry) {
        const key = `temperature_2m_max_${model}`
        const temps = daily[key]
        if (temps && Array.isArray(temps) && temps.length > 0 && temps[0] !== null) {
          results[model] = temps[0]
        }
      }

      for (const key of Object.keys(daily)) {
        if (key.startsWith('temperature_2m_max_member') && key.includes('ecmwf_ens')) {
          const vals = daily[key]
          if (vals && Array.isArray(vals) && vals.length > 0 && vals[0] !== null) {
            ensembleMembers.push(vals[0])
          }
        }
      }

      // Extract weather data (with models param, Open-Meteo returns model-specific fields)
      const weatherCode = daily.weather_code_best_match?.[0] ?? daily.weather_code?.[0] ?? 0
      const precipitation = daily.precipitation_sum_best_match?.[0] ?? daily.precipitation_sum?.[0] ?? 0

      // Success - if we got at least 1 model, return
      if (Object.keys(results).length > 0) {
        return { models: results, ensembleMembers, weatherCode, precipitation }
      }
    } catch (e) {
      lastError = e as Error
      console.warn(`Open-Meteo attempt ${attempt}/3 failed for lat=${lat} lon=${lon}:`, (e as Error).message)
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)) // backoff: 1s, 2s
      }
    }
  }

  // All attempts failed - return whatever we got (might be empty)
  if (Object.keys(results).length === 0) {
    console.error(`Open-Meteo FAILED for lat=${lat} lon=${lon} after 3 attempts:`, lastError?.message)
  }

  return { models: results, ensembleMembers, weatherCode: 0, precipitation: 0 }
}
