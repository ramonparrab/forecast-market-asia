import { NextApiRequest, NextApiResponse } from 'next'
import { runDailyAnalysis } from '@/lib/forecast-engine'
import { saveDailyRun, saveForecastRecords, getRecordsWithoutActuals, updateActualTemperature, getHistoricalRecords, saveBacktestBias, upsertForecastSnapshot, updateSnapshotActual } from '@/lib/supabase'
import { fetchStationMaxTemp } from '@/lib/station-weather'
import { fetchActualMaxTemp } from '@/lib/openmeteo'
import { CIUDADES_ASIA } from '@/lib/cities'
import { computeBacktestBiasFromResults } from '@/lib/backtest-bias'
import { getModelSelectionCache } from '@/lib/modelo-selector'

// Vercel: extender timeout a 300s (5 min) — el backfill secuencial + forecast necesitan tiempo
export const config = { maxDuration: 300 }

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
    // ===== Determinar si es corrida de 10PM o 11PM Caracas =====
    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    const caracasHour = nowCaracas.getUTCHours()
    const runLabel = caracasHour >= 22 || caracasHour < 1
      ? (caracasHour >= 23 || caracasHour < 1 ? '11PM' : '10PM')
      : `${caracasHour}:00`
    console.log(`[CRON] === CORRIDA ${runLabel} CARACAS === Fecha: ${nowCaracas.toISOString().slice(0, 10)} ${nowCaracas.toISOString().slice(11, 16)} Caracas`)

    // ===== STEP 1: Backfill actual temps for pending records (PARALELO) =====
    console.log('[CRON] Backfilling actual temperatures...')
    const pendingRecords = await getRecordsWithoutActuals(50)
    console.log(`[CRON] Found ${pendingRecords.length} pending records without actuals`)
    let backfilled = 0
    const backfillErrors: string[] = []

    // Process all cities in parallel (max 4 concurrent) instead of sequentially
    const CONCURRENCY = 4
    for (let i = 0; i < pendingRecords.length; i += CONCURRENCY) {
      const batch = pendingRecords.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (record) => {
          // Try Polymarket settlement → TWC/HKO → Open-Meteo
          let tempReal = await fetchStationMaxTemp(record.slug, record.fecha_objetivo)
          if (tempReal === null && record.lat && record.lon) {
            tempReal = await fetchActualMaxTemp(record.lat, record.lon, record.fecha_objetivo)
          }
          if (tempReal === null) {
            return { record, tempReal: null as number | null, ok: false }
          }
          const ok = await updateActualTemperature(record.id, tempReal)
          return { record, tempReal, ok }
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.ok && r.value.tempReal !== null) {
            backfilled++
            console.log(`[CRON] Backfilled ${r.value.record.slug} ${r.value.record.fecha_objetivo} → ${r.value.tempReal}°C`)
          } else {
            backfillErrors.push(`${r.value.record.slug} ${r.value.record.fecha_objetivo}: sin datos de estación`)
          }
        } else {
          backfillErrors.push(`Error: ${(r.reason as Error)?.message ?? 'unknown'}`)
        }
      }
    }

    console.log(`[CRON] Backfill: ${backfilled} actualizados, ${backfillErrors.length} errores`)
    if (backfillErrors.length > 0) {
      console.log(`[CRON] Backfill errors: ${backfillErrors.join('; ')}`)
    }

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

    // ===== STEP 3: Run forecast for tomorrow (Caracas timezone) =====
    // nowCaracas ya fue calculado arriba para el runLabel
    const tomorrowCaracas = new Date(nowCaracas.getTime())
    tomorrowCaracas.setDate(tomorrowCaracas.getDate() + 1)
    const fechaObjetivo = tomorrowCaracas.toISOString().slice(0, 10)

    console.log(`[CRON] Running daily analysis for ${fechaObjetivo}`)
    const result = await runDailyAnalysis(fechaObjetivo, true)

    // ===== STEP 3: Save to Supabase =====
    const records = result.cities.map(city => ({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fechaObjetivo,
      ciudad: city.ciudad,
      slug: city.slug,
      // Guardamos la BASE del ensemble en forecast_history para que MC/Kalman
      // sigan entrenándose con el error crudo. El valor corregido por el modelo
      // ganador queda en daily_runs (resultados) para mostrar al usuario.
      temp_pronosticada: city.forecast.temp_ponderada,
      temp_corregida: city.forecast.temp_corregida_base ?? city.forecast.temp_corregida,
      temp_real: null,
      error: null,
      modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
      consenso: city.forecast.consenso,
    }))
    // Guardar con run_type para que 10PM y 11PM coexistan
    await saveForecastRecords(records, runLabel)

    // ===== STEP 3b: Respaldo 10PM desde corrida 11PM =====
    // Si el cron de 10PM (2:00Z) no ejecutó, el de 11PM guarda también como 10PM.
    // El upsert (slug, fecha_objetivo, run_type) evita duplicados si 10PM ya existe.
    if (runLabel === '11PM') {
      console.log('[CRON] Guardando respaldo 10PM por si faltó la corrida de 2:00Z...')
      await saveForecastRecords(records, '10PM')
    }

    await saveDailyRun({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fechaObjetivo,
      resultados: result.cities,
      recomendaciones: result.recommendations,
      total_asignado: result.total_allocated,
      run_type: runLabel as '10PM' | '11PM',
    })

    // ===== STEP 4: Upsert forecast_snapshot (pronóstico ganador bloqueado) =====
    console.log(`[CRON] Upserting forecast snapshots (${runLabel})...`)
    const modelCache = getModelSelectionCache()
    for (const city of result.cities) {
      const sel = modelCache[city.slug]
      await upsertForecastSnapshot({
        fecha_objetivo: fechaObjetivo,
        slug: city.slug,
        ciudad: city.ciudad,
        run_type_ganadora: runLabel as '10PM' | '11PM',
        modelo_ganador: sel?.modelo ?? 'ENSEMBLE',
        temp_pronosticada: city.forecast.temp_ponderada,
        temp_corregida: city.forecast.temp_corregida,
        temp_ponderada: city.forecast.temp_ponderada,
        consenso: city.forecast.consenso,
        modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
        temp_10pm: runLabel === '10PM' ? city.forecast.temp_corregida : null,
        temp_11pm: runLabel === '11PM' ? city.forecast.temp_corregida : null,
        modelo_10pm: runLabel === '10PM' ? (sel?.modelo ?? 'ENSEMBLE') : null,
        modelo_11pm: runLabel === '11PM' ? (sel?.modelo ?? 'ENSEMBLE') : null,
        temp_real: null,
        error: null,
      })
    }

    // ===== STEP 5: Backfill temp_real en snapshots existentes =====
    const { getPendingSnapshots } = await import('@/lib/supabase')
    const pendingSnaps = await getPendingSnapshots()
    let snapBackfilled = 0
    for (const snap of pendingSnaps) {
      if (snap.fecha_objetivo >= new Date().toISOString().slice(0, 10)) continue
      const tempReal = await fetchStationMaxTemp(snap.slug, snap.fecha_objetivo)
        ?? (await fetchActualMaxTemp(
          CIUDADES_ASIA.find(c => c.slug === snap.slug)?.lat ?? 0,
          CIUDADES_ASIA.find(c => c.slug === snap.slug)?.lon ?? 0,
          snap.fecha_objetivo
        ))
      if (tempReal !== null) {
        const ok = await updateSnapshotActual(snap.slug, snap.fecha_objetivo, tempReal)
        if (ok) snapBackfilled++
      }
    }
    if (snapBackfilled > 0) {
      console.log(`[CRON] Snapshot backfill: ${snapBackfilled} actualizados`)
    }

    console.log(`[CRON] Saved ${records.length} city forecasts + daily run + snapshots to Supabase`)

    // Log selección de modelo por ciudad
    const modelEntries = Object.entries(modelCache)
    if (modelEntries.length > 0) {
      console.log(`[CRON] Selección dinámica de modelo (${runLabel}):`)
      for (const [slug, sel] of modelEntries) {
        console.log(`  ${slug}: ${sel.modelo} (KALMAN MAE=${sel.mae_kalman}, MC MAE=${sel.mae_mc}) — ${sel.reason}`)
      }
      const changed = modelEntries.filter(([slug, sel]) => {
        const prev = slug === 'tokyo' || slug === 'wuhan' || slug === 'chongqing' || slug === 'chengdu' ? 'MEJORA CONTINUA' : 'KALMAN'
        return sel.modelo !== prev
      })
      if (changed.length > 0) {
        console.log(`[CRON] ⚠️ ${changed.length} ciudad(es) cambiaron de modelo vs default: ${changed.map(([s, v]) => `${s}→${v.modelo}`).join(', ')}`)
      }
    }

    return res.status(200).json({
      status: 'ok',
      message: `Pipeline completado (${runLabel}): ${backfilled} reales backfilled, ${records.length} pronósticos guardados para ${fechaObjetivo}`,
      run_type: runLabel,
      backfill: { updated: backfilled, errors: backfillErrors.length },
      forecast: { cities: records.length, recommendations: result.recommendations.length, total_allocated: result.total_allocated },
      model_selection: modelCache,
    })
  } catch (error) {
    console.error('[CRON] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
