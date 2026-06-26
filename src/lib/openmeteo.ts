import { ModelTemps } from '@/types'
import { MODELOS_CLIMATICOS } from './cities'

const OPENMETEO_BASE = 'https://api.open-meteo.com/v1/forecast'

/**
 * Fetch the ACTUAL maximum temperature for a past date.
 */
export async function fetchActualMaxTemp(
  lat: number,
  lon: number,
  fechaISO: string
): Promise<number | null> {
  try {
    const url = `${OPENMETEO_BASE}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${fechaISO}&end_date=${fechaISO}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const maxTemp = data?.daily?.temperature_2m_max?.[0]
    return maxTemp ?? null
  } catch (e) {
    console.warn(`Error fetching actual temp for ${fechaISO}:`, (e as Error).message)
    return null
  }
}

export interface WeatherModelsResult {
  models: ModelTemps
  ensembleMembers: number[]
}

/**
 * Fetch weather model forecasts AND ECMWF ENS 51 ensemble members.
 * 
 * ECMWF ENS provides 51 perturbed members + 1 control run, giving a real
 * probability distribution (empirical CDF) instead of assumed parametric.
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
  const url = `${OPENMETEO_BASE}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${fechaISO}&end_date=${fechaISO}&models=${modelsParam}`

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
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
  } catch (e) {
    console.warn(`Open-Meteo error for lat=${lat} lon=${lon}:`, (e as Error).message)
  }

  return { models: results, ensembleMembers }
}
