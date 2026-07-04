import { NextApiRequest, NextApiResponse } from 'next'
import { getLastDaysRecords } from '@/lib/supabase'
import { CIUDADES_ASIA } from '@/lib/cities'

interface WeatherGroup {
  condition: string
  icon: string
  records: number
  mae: number
  rmse: number
  bias: number
  accuracy_05c: number
  mae_minus_global: number
  penalty_suggestion: number
}

interface CityWeatherPair {
  slug: string
  ciudad: string
  fecha_objetivo: string
  error: number
}

function categorize(code: number, precip: number): { condition: string; icon: string } {
  if (code >= 95 && code <= 99) return { condition: 'Tormenta', icon: '⛈' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { condition: 'Nieve', icon: '❄️' }
  if (code === 67 || code === 75 || code === 82) return { condition: 'Lluvia fuerte', icon: '🌧' }
  if ((code >= 61 && code <= 66) || (code >= 80 && code <= 81)) {
    return precip >= 10 ? { condition: 'Lluvia fuerte', icon: '🌧' } : { condition: 'Lluvia', icon: '🌦' }
  }
  if (code >= 55 && code <= 57) return { condition: 'Llovizna densa', icon: '🌧' }
  if (code >= 51 && code <= 53) return { condition: 'Llovizna', icon: '🌦' }
  if (code >= 45 && code <= 48) return { condition: 'Niebla', icon: '🌫' }
  if (code === 1 || code === 2) return { condition: 'Nubes', icon: '⛅' }
  if (code === 3) return { condition: 'Nublado', icon: '☁️' }
  return { condition: 'Despejado', icon: '☀️' }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[WeatherImpactAnalysis] Starting...')

  const records = await getLastDaysRecords(60)
  const withActuals = records.filter((r: any) => r.temp_real !== null && r.error !== null)
  console.log(`[WeatherImpactAnalysis] Fetched ${records.length} records, ${withActuals.length} have temp_real`)

  // Dedup by (slug, fecha_objetivo) — keep latest
  const seen = new Map<string, any>()
  for (const r of withActuals) {
    const key = `${r.slug}|${r.fecha_objetivo}`
    if (!seen.has(key) || r.id > seen.get(key).id) {
      seen.set(key, r)
    }
  }
  const deduped = Array.from(seen.values()) as CityWeatherPair[]
  console.log(`[WeatherImpactAnalysis] After dedup: ${deduped.length} records`)

  if (deduped.length === 0) {
    return res.status(200).json({ error: 'No hay datos históricos con temperatura real', records: 0, weather_impact: [] })
  }

  // Fetch weather for each city across its date range
  const weatherMap = new Map<string, { code: number; precipitation: number }>()

  for (const city of CIUDADES_ASIA) {
    const cityRecords = deduped.filter(r => r.slug === city.slug)
    if (cityRecords.length === 0) continue

    const dates = Array.from(new Set(cityRecords.map(r => r.fecha_objetivo))).sort()
    const startDate = dates[0]
    const endDate = dates[dates.length - 1]

    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${city.lat}&longitude=${city.lon}&start_date=${startDate}&end_date=${endDate}&daily=weather_code,precipitation_sum&timezone=auto`

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!resp.ok) {
        console.warn(`[WeatherImpactAnalysis] Open-Meteo Archive returned ${resp.status} for ${city.slug}`)
        continue
      }
      const data = await resp.json()
      if (data.daily) {
        for (let i = 0; i < data.daily.time.length; i++) {
          const date = data.daily.time[i]
          const code = data.daily.weather_code[i]
          const precip = data.daily.precipitation_sum[i] ?? 0
          weatherMap.set(`${city.slug}|${date}`, { code, precipitation: precip })
        }
      }
    } catch (e) {
      console.warn(`[WeatherImpactAnalysis] Failed for ${city.slug}:`, (e as Error).message)
    }
  }

  console.log(`[WeatherImpactAnalysis] Fetched weather for ${weatherMap.size} city-date pairs`)

  // Group by condition
  const groups: Record<string, { errors: number[]; cities: Set<string>; dates: Set<string> }> = {}

  for (const r of deduped) {
    const key = `${r.slug}|${r.fecha_objetivo}`
    const weather = weatherMap.get(key)
    if (!weather) continue

    const { condition, icon } = categorize(weather.code, weather.precipitation)
    const groupKey = `${icon} ${condition}`
    if (!groups[groupKey]) {
      groups[groupKey] = { errors: [], cities: new Set(), dates: new Set() }
    }
    groups[groupKey].errors.push(r.error)
    groups[groupKey].cities.add(r.ciudad)
    groups[groupKey].dates.add(r.fecha_objetivo)
  }

  // Compute global MAE for comparison
  const allErrors = deduped.map(r => r.error)
  const globalMAE = allErrors.reduce((s, v) => s + Math.abs(v), 0) / allErrors.length

  const weatherImpact: WeatherGroup[] = Object.entries(groups)
    .map(([groupKey, data]) => {
      const errs = data.errors
      const n = errs.length
      const mae = errs.reduce((s, v) => s + Math.abs(v), 0) / n
      const rmse = Math.sqrt(errs.reduce((s, v) => s + v * v, 0) / n)
      const bias = errs.reduce((s, v) => s + v, 0) / n
      const within05 = errs.filter(e => Math.abs(e) <= 0.5).length / n * 100
      const diff = mae - globalMAE
      // Only suggest penalty if MAE is worse than global
      const penalty = diff > 0.1 ? Math.round(Math.min(diff * 10, 15)) : 0

      return {
        condition: groupKey,
        icon: '',
        records: n,
        mae: Math.round(mae * 100) / 100,
        rmse: Math.round(rmse * 100) / 100,
        bias: Math.round(bias * 100) / 100,
        accuracy_05c: Math.round(within05 * 100) / 100,
        mae_minus_global: Math.round(diff * 100) / 100,
        penalty_suggestion: penalty,
      }
    })
    .sort((a, b) => b.mae - a.mae)

  return res.status(200).json({
    records: deduped.length,
    global_mae: Math.round(globalMAE * 100) / 100,
    global_accuracy_05c: Math.round(allErrors.filter(e => Math.abs(e) <= 0.5).length / allErrors.length * 10000) / 100,
    unique_dates: Array.from(new Set(deduped.map(r => r.fecha_objetivo))).length,
    unique_cities: Array.from(new Set(deduped.map(r => r.slug))).length,
    weather_impact: weatherImpact,
    note: 'Si mae_minus_global > 0, ese clima empeora la precisión. penalty_suggestion = % a restar del exito_pct.',
  })
}
