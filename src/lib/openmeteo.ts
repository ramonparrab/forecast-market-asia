import { ModelTemps } from '@/types'
import { MODELOS_CLIMATICOS } from './cities'

const OPENMETEO_BASE = 'https://api.open-meteo.com/v1/forecast'

/**
 * Fetch the ACTUAL maximum temperature for a past date.
 * Uses the best_match model as ground truth.
 */
export async function fetchActualMaxTemp(
  lat: number,
  lon: number,
  fechaISO: string
): Promise<number | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${fechaISO}&end_date=${fechaISO}`
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

export async function fetchWeatherModels(
  lat: number,
  lon: number,
  fechaISO: string,
  modelos?: string[]
): Promise<ModelTemps> {
  const toTry = modelos ?? MODELOS_CLIMATICOS
  const results: ModelTemps = {}

  const modelsParam = toTry.join(',')
  const url = `${OPENMETEO_BASE}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&temperature_unit=celsius&start_date=${fechaISO}&end_date=${fechaISO}&models=${modelsParam}`

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()

    // Open-Meteo returns model data inside hourly as temperature_2m_{model}
    const hourly = data.hourly || {}
    for (const model of toTry) {
      const key = `temperature_2m_${model}`
      const temps = hourly[key]
      if (temps && Array.isArray(temps) && temps.length > 0) {
        results[model] = Math.max(...temps)
      }
    }
  } catch (e) {
    console.warn(`Open-Meteo error for lat=${lat} lon=${lon}:`, (e as Error).message)
  }

  return results
}
