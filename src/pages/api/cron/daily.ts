import { NextApiRequest, NextApiResponse } from 'next'
import { runDailyAnalysis } from '@/lib/forecast-engine'
import { saveDailyRun, saveForecastRecords, getRecordsWithoutActuals, updateActualTemperature, getHistoricalRecords, saveBacktestBias } from '@/lib/supabase'
import { fetchActualMaxTemp } from '@/lib/openmeteo'
import { CIUDADES_ASIA } from '@/lib/cities'
import { computeBacktestBiasFromResults } from '@/lib/backtest-bias'

/**
 * Vercel Cron Job - runs at 2:00 AM UTC (10:00 PM Caracas UTC-4)
 * vercel.json: { "crons": [{ "path": "/api/cron/daily", "schedule": "0 2 * * *" }] }
 * 
 * Pipeline completo:
 * 1. Backfill: fetch temperaturas reales de registros pendientes (día anterior)
 * 2. Forecast: ejecuta análisis para mañana
 * 3. Guarda: resultados en Supabase (forecast_history + daily_runs)
 * 4. Report: logs de aciertos/errores del día anterior
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization
  const expectedSecret = process.env.CRON_SECRET || ''

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // ===== STEP 1: Backfill actual temps for pending records =====
    console.log('[CRON] Backfilling actual temperatures...')
    const pendingRecords = await getRecordsWithoutActuals(50)
    let backfilled = 0
    const backfillErrors: string[] = []

    for (const record of pendingRecords) {
      if (!record.lat || !record.lon) {
        backfillErrors.push(`${record.slug} ${record.fecha_objetivo}: no lat/lon`)
        continue
      }
      const tempReal = await fetchActualMaxTemp(record.lat, record.lon, record.fecha_objetivo)
      if (tempReal === null) {
        backfillErrors.push(`${record.slug} ${record.fecha_objetivo}: Open-Meteo sin datos`)
        continue
      }
      const ok = await updateActualTemperature(record.id, tempReal)
      if (ok) backfilled++
      else backfillErrors.push(`${record.slug} ${record.fecha_objetivo}: error al guardar`)
    }

    console.log(`[CRON] Backfill: ${backfilled} actualizados, ${backfillErrors.length} errores`)

    // ===== STEP 2: Update backtest bias from forecast_history =====
    console.log('[CRON] Updating backtest bias from historical records...')
    const allHistory = await getHistoricalRecords(1000)
    const withActuals = allHistory.filter(r => r.temp_real !== null && r.error !== null)
    if (withActuals.length >= 5) {
      const biasData = withActuals.map(r => ({
        fecha: r.fecha_objetivo || r.fecha_ejecucion.slice(0, 10),
        ciudad: r.ciudad,
        slug: r.slug,
        temp_pronosticada: r.temp_pronosticada,
        temp_corregida: r.temp_corregida,
        temp_real: r.temp_real!,
        error: r.error!,
        modelos_usados: r.modelos_usados,
        consenso: r.consenso,
        sesgo_aplicado: 0,
      }))
      const biasEntries = computeBacktestBiasFromResults(biasData)
      await saveBacktestBias(biasEntries)
      console.log(`[CRON] Backtest bias updated: ${biasEntries.length} entries from ${withActuals.length} records`)
    } else {
      console.log(`[CRON] Not enough records for bias (${withActuals.length}), skipping`)
    }

    // ===== STEP 3: Run forecast for tomorrow =====
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const fechaObjetivo = tomorrow.toISOString().slice(0, 10)

    console.log(`[CRON] Running daily analysis for ${fechaObjetivo}`)
    const result = await runDailyAnalysis(fechaObjetivo, true)

    // ===== STEP 3: Save to Supabase =====
    const records = result.cities.map(city => ({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fechaObjetivo,
      ciudad: city.ciudad,
      slug: city.slug,
      temp_pronosticada: city.forecast.temp_ponderada,
      temp_corregida: city.forecast.temp_corregida,
      temp_real: null,
      error: null,
      modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
      consenso: city.forecast.consenso,
    }))
    await saveForecastRecords(records)

    await saveDailyRun({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fechaObjetivo,
      resultados: result.cities,
      recomendaciones: result.recommendations,
      total_asignado: result.total_allocated,
    })

    console.log(`[CRON] Saved ${records.length} city forecasts + daily run to Supabase`)

    return res.status(200).json({
      status: 'ok',
      message: `Pipeline completado: ${backfilled} reales backfilled, ${records.length} pronósticos guardados para ${fechaObjetivo}`,
      backfill: { updated: backfilled, errors: backfillErrors.length },
      forecast: { cities: records.length, recommendations: result.recommendations.length, total_allocated: result.total_allocated },
    })
  } catch (error) {
    console.error('[CRON] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
