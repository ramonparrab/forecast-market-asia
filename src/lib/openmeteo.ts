import { ModelTemps } from '@/types'
import { MODELOS_CLIMATICOS } from './cities'

const OPENMETEO_BASE = 'https://api.open-meteo.com/v1/forecast'

export async function fetchWeatherModels(
  lat: number,
  lon: number,
  fechaISO: string,
  modelos?: string[]
): Promise<ModelTemps> {
  const toTry = modelos ?? MODELOS_CLIMATICOS
  const results: ModelTemps = {}

  // Open-Meteo supports querying multiple models in one call
  const modelsParam = toTry.join(',')
  const url = `${OPENMETEO_BASE}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&temperature_unit=celsius&start_date=${fechaISO}&end_date=${fechaISO}&models=${modelsParam}`

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()

    for (const model of toTry) {
      const hourly = data[model]?.hourly?.temperature_2m
      if (hourly && Array.isArray(hourly) && hourly.length > 0) {
        results[model] = Math.max(...hourly)
      }
    }
  } catch (e) {
    console.warn('Open-Meteo error:', (e as Error).message)
  }

  return results
}
