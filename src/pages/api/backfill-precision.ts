import { NextApiRequest, NextApiResponse } from 'next'
import { CIUDADES_ASIA, MODELOS_CLIMATICOS } from '@/lib/cities'
import { computeEnsemble } from '@/lib/ensemble'
import { updateForecastPrecision, computeGlobalMetrics } from '@/lib/supabase'

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive'
const API_DELAY_MS = 350

interface ParsedDay {
  fecha: string
  models: Record<string, number>
}

async function fetchForecasts(city: { slug: string; lat: number; lon: number }, start: string, end: string): Promise<ParsedDay[]> {
  const models = MODELOS_CLIMATICOS.join(',')
  const url = `${FORECAST_BASE}?latitude=${city.lat}&longitude=${city.lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${start}&end_date=${end}&timezone=auto&models=${models}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!resp.ok) throw new Error(`Forecast HTTP ${resp.status}`)
  const data = await resp.json()
  const times: string[] = data.daily?.time ?? []
  const days: ParsedDay[] = []
  for (let t = 0; t < times.length; t++) {
    const models: Record<string, number> = {}
    for (const model of MODELOS_CLIMATICOS) {
      const vals = data.daily?.[`temperature_2m_max_${model}`]
      if (vals?.[t] != null) models[model] = vals[t]
    }
    if (Object.keys(models).length > 0) days.push({ fecha: times[t], models })
  }
  return days
}

async function fetchActuals(city: { slug: string; lat: number; lon: number }, start: string, end: string): Promise<Record<string, number>> {
  const url = `${ARCHIVE_BASE}?latitude=${city.lat}&longitude=${city.lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${start}&end_date=${end}&timezone=auto`
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!resp.ok) throw new Error(`Archive HTTP ${resp.status}`)
  const data = await resp.json()
  const map: Record<string, number> = {}
  const times: string[] = data.daily?.time ?? []
  const temps: number[] = data.daily?.temperature_2m_max ?? []
  for (let i = 0; i < times.length; i++) {
    if (temps[i] != null) map[times[i]] = temps[i]
  }
  return map
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 60, 30), 365)
    const endDate = new Date()
    endDate.setDate(endDate.getDate() - 1)
    const startDate = new Date(endDate)
    startDate.setDate(startDate.getDate() - days + 1)
    const startStr = startDate.toISOString().slice(0, 10)
    const endStr = endDate.toISOString().slice(0, 10)

    let totalUpdated = 0
    let totalSkipped = 0
    let totalErrors = 0
    const citySummary: Record<string, { updated: number; mae: number; accuracy: number }> = {}

    for (const city of CIUDADES_ASIA) {
      try {
        const [forecastDays, actuals] = await Promise.all([
          fetchForecasts(city, startStr, endStr),
          fetchActuals(city, startStr, endStr),
        ])
        await sleep(API_DELAY_MS)

        const sorted = forecastDays.sort((a, b) => a.fecha.localeCompare(b.fecha))
        const trainErrors: { error: number }[] = []
        let updated = 0
        const errors: number[] = []

        for (const day of sorted) {
          const actual = actuals[day.fecha]
          if (actual == null) continue

          const forecast = computeEnsemble({
            slug: city.slug,
            mes: new Date(day.fecha + 'T12:00:00').getMonth() + 1,
            modelsRaw: day.models,
            recentErrors: trainErrors,
            recentModelErrors: {},
          })

          const correctError = actual - forecast.temp_corregida
          errors.push(Math.abs(correctError))

          const ok = await updateForecastPrecision(city.slug, day.fecha, forecast.temp_ponderada, forecast.temp_corregida, correctError)
          if (ok) {
            updated++
            totalUpdated++
          } else {
            totalSkipped++
          }

          trainErrors.push({ error: actual - forecast.temp_ponderada })
        }

        const cityMae = errors.length > 0 ? Math.round(errors.reduce((s, v) => s + v, 0) / errors.length * 100) / 100 : 0
        const cityAcc = errors.length > 0 ? Math.round(errors.filter(e => e <= 1).length / errors.length * 10000) / 100 : 0
        citySummary[city.slug] = { updated, mae: cityMae, accuracy: cityAcc }
      } catch (e) {
        console.error(`Error processing ${city.slug}:`, (e as Error).message)
        totalErrors++
      }
    }

    const metrics = await computeGlobalMetrics()

    return res.status(200).json({
      status: 'ok',
      message: `Backfill precisión completado: ${totalUpdated} actualizados, ${totalSkipped} saltados, ${totalErrors} errores`,
      total_updated: totalUpdated,
      total_skipped: totalSkipped,
      total_errors: totalErrors,
      rango: `${startStr} a ${endStr}`,
      por_ciudad: citySummary,
      global_metrics: metrics ? {
        overall_mae: metrics.overall_mae,
        overall_rmse: metrics.overall_rmse,
        overall_bias: metrics.overall_bias,
        accuracy_pct: metrics.accuracy_pct,
        total_muestras: metrics.total_muestras,
        por_ciudad: metrics.por_ciudad,
      } : null,
    })
  } catch (error) {
    console.error('[BACKFILL-PRECISION] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
