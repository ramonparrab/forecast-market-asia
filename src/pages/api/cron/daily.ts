import { NextApiRequest, NextApiResponse } from 'next'
import {
  runDailyAnalysis,
} from '@/lib/forecast-engine'
import {
  saveDailyRun,
  saveForecastRecords,
  slotYaRegistrado,
  getRecordsWithoutActuals,
  updateActualTemperature,
  getHistoricalRecords,
  saveBacktestBias,
  upsertForecastSnapshot,
  updateSnapshotActual,
  getPendingSnapshots,
  startCronRun,
  finishCronRun,
  getActiveCronRun,
} from '@/lib/supabase'
import { fetchStationMaxTemp } from '@/lib/station-weather'
import { fetchActualMaxTemp } from '@/lib/openmeteo'
import { CIUDADES_ASIA } from '@/lib/cities'
import { computeBacktestBiasFromResults } from '@/lib/backtest-bias'
import { getModelSelectionCache } from '@/lib/modelo-selector'
import { resolveRunLabel, resolveFechaObjetivo, CARACAS_OFFSET_MS } from '@/lib/cron-slot'

// Vercel: 300s de presupuesto (doble vía: config export + vercel.json functions)
export const config = { maxDuration: 300 }

/**
 * ÚNICO cron de datos del proyecto (vercel.json — 4 horarios, 2 por slot):
 *   - 02:00 UTC = 10:00 PM Caracas  ┐ ambos → registro '10PM' (UPSERT: el
 *   - 02:30 UTC = 10:30 PM Caracas  ┘ segundo REFRESCA al primero)
 *   - 03:00 UTC = 11:00 PM Caracas  ┐ ambos → registro '11PM'
 *   - 03:30 UTC = 11:30 PM Caracas  ┘
 *
 * Redundancia doble por slot (pedido sep-2026): el cron de Hobby dispara
 * ~20-25 min tarde y a veces SE CAE entero (11PM del 2-sep nunca disparó).
 * Con 2 disparos por slot, si el primero falla el segundo llena; si ambos
 * corren, el segundo (más fresco) refresca el mismo registro vía UPSERT.
 *
 * ETIQUETA POR SCHEDULE, NO POR RELOJ: Vercel envía el header
 * x-vercel-cron-schedule con el schedule exacto que disparó la invocación
 * → 02:xx UTC = '10PM', 03:xx UTC = '11PM'. Así un retraso grande (p. ej.
 * el de 02:30 disparando a las 23:05 Caracas) NUNCA contamina el slot
 * siguiente. Sin header (trigger manual) se usa la hora de reloj Caracas.
 *
 * INMUTABILIDAD POST-11PM (fix 04-sep-2026): una corrida '10PM' NO muta su
 * slot si el '11PM' de la misma fecha ya está registrado (el refresh de las
 * 10:30 puede aterrizar 30-40 min tarde, después del 11PM — anoche pisó el
 * valor que el usuario ya había visto en TOMAR DECISION). El slot 10PM
 * VACÍO sí se puede llenar tarde (mejor valor tardío que hueco).
 *
 * Arquitectura por corrida (TODO AUTOMATIZADO, orden = criticidad):
 *   1. PRONÓSTICO para el día D+1 asiático (10 ciudades, paralelo) → BD
 *      (si hoy es 2-sep 10PM Caracas, el objetivo es el 3-sep en Asia)
 *   2. TEMPERATURA REAL del día D asiático recién CULMINADO (terminó 16:00Z,
 *      ~10h antes de esta corrida) → BD (comparativo + entrenamiento)
 *      Fuentes por ciudad: Polymarket settlement → TWC estación → Open-Meteo Archive
 *   3. DRENAJE de reales atrasadas (filas viejas sin temp_real, oldest-first)
 *   4. Recalcular sesgos (backtest_bias) con los nuevos errores
 *
 * Fiabilidad:
 *   - Semáforo Open-Meteo máx 4 concurrentes + reintentos (fix sep-2026)
 *   - Fallback TWC v3 por ciudad si Open-Meteo da 429 (cuota por IP compartido)
 *   - Guardados idempotentes (UPSERT por fecha_objetivo+slug+run_type)
 *   - cron_log (migration-008): estado visible ok/partial/error + detalles
 *   - Lock anti-solapamiento (los 4 disparos + manuales no se pisan)
 *   - Errores por paso NO tumban los demás pasos (respuestas parciales siguen siendo útiles)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization
  const expectedSecret = process.env.CRON_SECRET || ''

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const startedAt = Date.now()

  // ===== Determinar etiqueta de corrida: 10PM / 11PM Caracas =====
  // La lógica vive en src/lib/cron-slot.ts (testeada en scripts/test_cron_slot.ts):
  // etiqueta por SCHEDULE (header x-vercel-cron-schedule) y no por reloj.
  const nowCaracas = new Date(Date.now() + CARACAS_OFFSET_MS)
  const caracasHour = nowCaracas.getUTCHours()

  const schedHeader = String(req.headers['x-vercel-cron-schedule'] ?? '')
  const slotParam = String(req.query.slot ?? '')

  const { label: runLabel, via: triggerVia } = resolveRunLabel({ schedHeader, slotParam, caracasHour })
  const isLegitRun = runLabel === '10PM' || runLabel === '11PM'
  console.log(`[CRON] === CORRIDA ${runLabel} CARACAS === ${nowCaracas.toISOString().slice(0, 16).replace('T', ' ')} Caracas (vía ${triggerVia}${schedHeader ? `, schedule "${schedHeader}"` : ''})`)

  // ===== Lock anti-solapamiento (esperar hasta 45s si hay corrida activa) =====
  try {
    for (let w = 0; w < 3; w++) {
      const active = await getActiveCronRun('daily')
      if (!active) break
      console.log(`[CRON] Corrida activa id=${active.id} (${active.run_type}) — esperando 15s (${w + 1}/3)...`)
      if (w < 2) await new Promise(r => setTimeout(r, 15000))
      else {
        return res.status(200).json({
          status: 'skipped_overlap',
          message: `Otra corrida (id=${active.id}, ${active.run_type}) sigue activa — se omite esta invocación para no pisar datos.`,
        })
      }
    }
  } catch { /* cron_log no disponible — continuar sin lock */ }

  // ===== Registrar inicio en cron_log (si migration-008 está aplicada) =====
  const logId = await startCronRun({ job: 'daily', run_type: runLabel })

  const details: Record<string, unknown> = {
    run_type: runLabel,
    trigger: { via: triggerVia, schedule: schedHeader || null, caracas_hour: caracasHour },
  }

  try {
    // ============================================================
    // STEP 1 — PRONÓSTICO D+1 (lo más crítico, va primero)
    // ============================================================
    // "Mañana Caracas" = día asiático objetivo. Ej.: 2-sep 10PM Caracas → 3-sep Asia.
    // Corridas NOCTURNAS TARDÍAS (00-05 Caracas, cron retrasado o manual de
    // recuperación): el día objetivo es HOY Caracas (el día asiático ya comenzó
    // y su mercado aún no resuelve) — igual que el botón Actualizar backup.
    const fechaObjetivo = resolveFechaObjetivo(caracasHour, nowCaracas.getTime())

    // ===== INMUTABILIDAD POST-11PM (fix 04-sep-2026) =====
    // Anoche (03-sep) el sched "30 2 * * *" (refresh 10:30) disparó a las
    // 23:03:39 Caracas — 33 min de latencia Hobby — y su UPSERT pisó el slot
    // 10PM ya registrado a las 22:02/22:21, 2 minutos después de que el slot
    // 11PM existiera. El usuario lo vio en TOMAR DECISION como "el 11PM
    // modificó también el de las 10PM". Regla: corrida '10PM' + slot '11PM'
    // ya registrado + slot '10PM' ya con datos → NO se escribe nada del slot
    // (history, daily_runs ni snapshots); solo corren reales y bias.
    let frozen10pm = false
    if (isLegitRun && runLabel === '10PM') {
      const slot11Ya = await slotYaRegistrado(fechaObjetivo, '11PM')
      if (slot11Ya && (await slotYaRegistrado(fechaObjetivo, '10PM'))) {
        frozen10pm = true
        console.log(`[CRON] CONGELADO: corrida 10PM tardía (${nowCaracas.toISOString().slice(11, 16)}Z) y el slot 11PM de ${fechaObjetivo} ya existe — NO se pisa el 10PM ya registrado. Esta corrida solo procesa reales y bias.`)
      }
    }

    console.log(`[CRON] STEP 1: Pronóstico para ${fechaObjetivo} (día D+1 asiático)...`)
    const forecastInfo: Record<string, unknown> = { fecha_objetivo: fechaObjetivo }
    const forecastErrors: string[] = []

    const result = await runDailyAnalysis(fechaObjetivo, true)

    const records = result.cities.map(city => ({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fechaObjetivo,
      ciudad: city.ciudad,
      slug: city.slug,
      // Base del ensemble en forecast_history para que MC/Kalman sigan
      // entrenándose con el error crudo; el valor del modelo ganador vive en daily_runs.
      temp_pronosticada: city.forecast.temp_ponderada,
      temp_corregida: city.forecast.temp_corregida_base ?? city.forecast.temp_corregida,
      temp_real: null,
      error: null,
      modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
      consenso: city.forecast.consenso,
    }))

    // Guardar con run_type para que 10PM y 11PM coexistan (UPSERT idempotente)
    // Congelado → NO se toca el history del slot (el valor ya visto queda)
    const savedHistory = frozen10pm ? false : await saveForecastRecords(records, runLabel)
    if (!savedHistory && !frozen10pm) forecastErrors.push('saveForecastRecords falló')

    // Ciudades degradadas (sin ningún modelo Open-Meteo: quedaron en OWM o TWC
    // solas por 429) y faltantes
    const degradedCities = result.cities
      .filter(c => {
        const keys = Object.keys(c.forecast.ensemble_raw)
        return keys.length > 0 && !keys.some(k => k !== 'twc' && k !== 'owm')
      })
      .map(c => c.slug)
    const missingCities = CIUDADES_ASIA
      .map(c => c.slug)
      .filter(slug => !result.cities.some(c => c.slug === slug))
    if (degradedCities.length > 0) forecastErrors.push(`degradadas a 1 modelo OWM/TWC (Open-Meteo falló): ${degradedCities.join(', ')}`)
    if (missingCities.length > 0) forecastErrors.push(`sin datos: ${missingCities.join(', ')}`)

    // daily_runs + snapshots SOLO para corridas 10PM/11PM legítimas
    // (las manuales fuera de ventana no crean daily_runs — el decision-tab las ignora)
    // Congelado → se omiten TAMBIÉN (inmutabilidad post-11PM)
    let dailyRunId: number | null = null
    let snapshotsOk = 0
    let snapshotsFail = 0
    if (isLegitRun && !frozen10pm) {
      dailyRunId = await saveDailyRun({
        fecha_ejecucion: result.fecha,
        fecha_objetivo: fechaObjetivo,
        resultados: result.cities,
        recomendaciones: result.recommendations,
        total_asignado: result.total_allocated,
        run_type: runLabel,
      })
      if (!dailyRunId) forecastErrors.push('saveDailyRun falló')

      // Snapshots en paralelo (antes: loop secuencial de 10 round-trips)
      const modelCache = getModelSelectionCache()
      const snapResults = await Promise.allSettled(result.cities.map(city => {
        const sel = modelCache[city.slug]
        return upsertForecastSnapshot({
          fecha_objetivo: fechaObjetivo,
          slug: city.slug,
          ciudad: city.ciudad,
          run_type_ganadora: runLabel,
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
      }))
      for (const r of snapResults) {
        if (r.status === 'fulfilled' && r.value) snapshotsOk++
        else snapshotsFail++
      }
      if (snapshotsFail > 0) forecastErrors.push(`${snapshotsFail} snapshots fallaron`)

      // Log de selección de modelo por ciudad
      const modelEntries = Object.entries(modelCache)
      if (modelEntries.length > 0) {
        console.log(`[CRON] Selección dinámica de modelo (${runLabel}):`)
        for (const [slug, sel] of modelEntries) {
          console.log(`  ${slug}: ${sel.modelo} (KALMAN MAE=${sel.mae_kalman}, MC MAE=${sel.mae_mc}) — ${sel.reason}`)
        }
      }
      // Log resumido de ciudades
      for (const c of result.cities) {
        const ensKeys = Object.keys(c.forecast.ensemble_raw)
        const fullEnsemble = ensKeys.some(k => k !== 'twc' && k !== 'owm')
        console.log(`  ${c.slug}: ${c.forecast.temp_corregida}°C (${ensKeys.length} modelos)${fullEnsemble ? '' : ' [degradado 1 modelo]'}`)
      }
    } else if (frozen10pm) {
      console.log(`[CRON] daily_runs/snapshots/history del slot 10PM OMITIDOS: congelado (el 11PM de ${fechaObjetivo} ya está registrado)`)
    } else {
      console.log(`[CRON] Ejecución fuera de ventana (${runLabel}) — solo forecast_history, sin daily_runs/snapshots`)
    }

    forecastInfo.cities = result.cities.length
    forecastInfo.degraded_twc = degradedCities
    forecastInfo.missing = missingCities
    forecastInfo.saved_history = frozen10pm ? 'skipped_frozen_10pm' : savedHistory
    forecastInfo.frozen_10pm = frozen10pm
    forecastInfo.saved_daily_run_id = dailyRunId
    forecastInfo.snapshots_ok = snapshotsOk
    forecastInfo.snapshots_fail = snapshotsFail
    forecastInfo.recommendations = result.recommendations.length
    details.forecast = forecastInfo

    // ============================================================
    // STEP 2 — TEMPERATURAS REALES del día asiático recién CULMINADO
    // ============================================================
    // El día asiático D termina a las 16:00Z (medianoche UTC+8). A las 02:00Z/03:00Z
    // el día que acaba de terminar es D = (fecha UTC - 1) = "hoy" en Caracas.
    // Ej.: 2-sep 10PM Caracas → se registra la real del 2-sep (Asia ya la cerró).
    const realDay = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)
    console.log(`[CRON] STEP 2: Reales del día culminado ${realDay} + drenaje de atrasadas...`)

    const realesInfo: Record<string, unknown> = { dia: realDay }
    const realesErrors: string[] = []
    const actualizados: Record<string, number> = {}

    // Pendientes de forecast_history: día culminado + atrasadas viejas (oldest-first)
    const pendingRecords = await getRecordsWithoutActuals(120)
    const dayRecords = pendingRecords.filter(r => r.fecha_objetivo === realDay)
    const backlogRecords = pendingRecords
      .filter(r => r.fecha_objetivo < realDay)
      .sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))
      .slice(0, 30) // drenaje acotado por corrida — la cola de julio se recupera sola
    const toProcess = [...dayRecords, ...backlogRecords]
    realesInfo.pendientes_hoy = dayRecords.length
    realesInfo.backlog_procesadas = backlogRecords.length

    // Todas en paralelo en lotes de 10 (TWC ~0.4s/ciudad; PM ~50ms)
    let backfilled = 0
    for (let i = 0; i < toProcess.length; i += 10) {
      const batch = toProcess.slice(i, i + 10)
      const results = await Promise.allSettled(
        batch.map(async (record) => {
          // Polymarket settlement (fuente exacta de resolución) → TWC estación → Open-Meteo Archive
          let tempReal = await fetchStationMaxTemp(record.slug, record.fecha_objetivo)
          if (tempReal === null && record.lat && record.lon) {
            tempReal = await fetchActualMaxTemp(record.lat, record.lon, record.fecha_objetivo)
          }
          if (tempReal === null) return { record, tempReal: null as number | null, ok: false }
          const ok = await updateActualTemperature(record.id, tempReal)
          return { record, tempReal, ok }
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok && r.value.tempReal !== null) {
          backfilled++
          actualizados[`${r.value.record.slug}@${r.value.record.fecha_objetivo}`] = r.value.tempReal
        } else if (r.status === 'fulfilled') {
          realesErrors.push(`${r.value.record.slug} ${r.value.record.fecha_objetivo}: sin datos en PM/TWC/Archive`)
        } else {
          realesErrors.push(`Error: ${(r.reason as Error)?.message ?? 'unknown'}`)
        }
      }
    }
    console.log(`[CRON] Reales: ${backfilled} actualizadas (${dayRecords.length} del día + ${backlogRecords.length} backlog), ${realesErrors.length} sin datos`)
    realesInfo.actualizadas = backfilled
    realesInfo.valores = actualizados
    realesInfo.sin_datos = realesErrors.slice(0, 20)
    details.reales = realesInfo

    // Snapshots pendientes (para TOMAR DECISION) — en paralelo
    const pendingSnaps = await getPendingSnapshots(false, 80)
    const snapsPendientes = pendingSnaps.filter(s => s.fecha_objetivo < new Date().toISOString().slice(0, 10))
    let snapBackfilled = 0
    const snapPairs = snapsPendientes.map(snap => {
      const city = CIUDADES_ASIA.find(c => c.slug === snap.slug)
      return { snap, lat: city?.lat ?? 0, lon: city?.lon ?? 0 }
    })
    for (let i = 0; i < snapPairs.length; i += 10) {
      const batch = snapPairs.slice(i, i + 10)
      const results = await Promise.allSettled(
        batch.map(async ({ snap, lat, lon }) => {
          let tempReal = await fetchStationMaxTemp(snap.slug, snap.fecha_objetivo)
          if (tempReal === null && lat && lon) {
            tempReal = await fetchActualMaxTemp(lat, lon, snap.fecha_objetivo)
          }
          if (tempReal === null) return false
          return updateSnapshotActual(snap.slug, snap.fecha_objetivo, tempReal)
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) snapBackfilled++
      }
    }
    realesInfo.snapshots_actualizados = snapBackfilled
    realesInfo.snapshots_pendientes = snapsPendientes.length
    console.log(`[CRON] Snapshots con real: ${snapBackfilled} de ${snapsPendientes.length} pendientes`)

    // ============================================================
    // STEP 3 — Recalcular sesgos con los errores nuevos
    // ============================================================
    console.log('[CRON] STEP 3: Actualizando backtest bias...')
    const biasInfo: Record<string, unknown> = {}
    try {
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
        const biasSaved = await saveBacktestBias(biasEntries)
        biasInfo.entries = biasEntries.length
        biasInfo.saved = biasSaved
        console.log(`[CRON] Backtest bias: ${biasEntries.length} entradas (${biasSaved ? 'guardado' : 'ERROR al guardar'})`)
      } else {
        biasInfo.skipped = `solo ${withActuals.length} registros con real`
      }
    } catch (e) {
      biasInfo.error = (e as Error).message
    }
    details.bias = biasInfo

    // ============================================================
    // Cierre — cron_log + respuesta detallada (estado VERDADERO)
    // ============================================================
    const allErrors = [...forecastErrors, ...realesErrors]
    const forecastComplete = result.cities.length === CIUDADES_ASIA.length
    const status: 'ok' | 'partial' | 'error' = frozen10pm
      ? (realesErrors.length === 0 ? 'ok' : 'partial') // congelar es intencional, no es fallo
      : forecastComplete && savedHistory && realesErrors.length === 0
      ? 'ok'
      : result.cities.length === 0 && !savedHistory
        ? 'error'
        : 'partial'

    const duracionMs = Date.now() - startedAt
    details.duration_ms = duracionMs
    details.errors = allErrors.slice(0, 30)

    await finishCronRun(logId, status, details)

    return res.status(200).json({
      status,
      run_type: runLabel,
      fecha_objetivo: fechaObjetivo,
      real_del_dia_culminado: realDay,
      forecast: forecastInfo,
      reales: realesInfo,
      bias: biasInfo,
      duracion_ms: duracionMs,
      errores: allErrors.slice(0, 30),
      message: `${runLabel}: ${frozen10pm
        ? `slot 10PM de ${fechaObjetivo} CONGELADO (refresh tardío NO pisó el valor — el 11PM ya estaba registrado)`
        : `${result.cities.length}/10 ciudades pronosticadas para ${fechaObjetivo}`}, ${backfilled} reales registradas (día ${realDay} + backlog), ${snapBackfilled} snapshots`,
    })
  } catch (error) {
    console.error('[CRON] Error fatal:', error)
    await finishCronRun(logId, 'error', {
      ...details,
      fatal: (error as Error).message,
      duration_ms: Date.now() - startedAt,
    })
    return res.status(500).json({
      status: 'error',
      run_type: runLabel,
      message: (error as Error).message,
      duration_ms: Date.now() - startedAt,
    })
  }
}
