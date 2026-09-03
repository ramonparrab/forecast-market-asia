import { NextApiRequest, NextApiResponse } from 'next'
import { runDailyAnalysis } from '@/lib/forecast-engine'
import { CityAnalysis, DailyAnalysis } from '@/types'
import { getClient } from '@/lib/supabase'
import { saveDailyRun, saveForecastRecords, upsertForecastSnapshot } from '@/lib/supabase'
import { getModelSelectionCache } from '@/lib/modelo-selector'

/**
 * GET  /api/forecast?fecha=YYYY-MM-DD — SOLO LECTURA de lo guardado por el cron.
 *        Sirve el último daily_runs de esa fecha (10PM/11PM). No ejecuta el
 *        pipeline, no llama APIs externas, NO escribe en la BD.
 *
 * POST /api/forecast { fecha?, persist_backup? } — análisis manual bajo demanda
 *        (botón "Actualizar"). Ejecuta runDailyAnalysis y responde el resultado
 *        PARA VISUALIZACIÓN.
 *
 *        MODO BACKUP (persist_backup=true, pedido del usuario sep-2026):
 *        el botón puede ESCRIBIR el slot nocturno que el cron dejó vacío para
 *        que la página "no se quede en blanco". Prioridad del AUTOMÁTICO:
 *          · 22:00–22:59 Caracas → slot '10PM' del día D+1: si está VACÍO lo
 *            llena; si el cron ya escribió, lo REFRESCA solo si el live salió
 *            completo (sin ciudades degradadas) — nunca degrada lo guardado.
 *          · 23:00–23:59 o 00:00–05:59 Caracas → slot '11PM': se llena SOLO si
 *            está VACÍO (el 11PM es el registro final de la noche; si ya existe,
 *            no se toca). En la ventana 00-05, si se pide el día D+1 pero el
 *            11PM de HOY está vacío, el análisis se redirige a HOY.
 *          · Resto del día → NUNCA escribe (el cron aún no debía correr).
 *        El cron automático siempre gana: sus UPSERT idempotentes pisan lo que
 *        el botón haya escrito cuando dispare (~22:21/23:21 por latencia Hobby).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // "Mañana Caracas" = día objetivo del cron (mismo criterio que daily.ts)
  const caracasOffset = -4 * 60 * 60000
  const nowCaracas = new Date(Date.now() + caracasOffset)
  nowCaracas.setDate(nowCaracas.getDate() + 1)
  const defaultFecha = nowCaracas.toISOString().slice(0, 10)
  const fecha = (req.query.fecha as string || req.body?.fecha || defaultFecha).slice(0, 10)

  try {
    if (req.method === 'GET') {
      // ===== LECTURA PURA: lo que guardó el cron =====
      const client = getClient()
      if (!client) return res.status(500).json({ error: 'Supabase no configurado' })

      const { data, error } = await (client.from('daily_runs' as any) as any)
        .select('id, fecha_ejecucion, fecha_objetivo, resultados, recomendaciones, total_asignado, run_type')
        .eq('fecha_objetivo', fecha)
        .order('fecha_ejecucion', { ascending: false })
        .limit(2)

      if (error) {
        return res.status(500).json({ error: 'Error leyendo daily_runs', details: error.message })
      }
      if (!data || data.length === 0) {
        return res.status(404).json({
          error: 'Sin datos guardados para esa fecha',
          fecha,
          hint: 'Los datos los registra el cron 10PM/11PM Caracas (/api/cron/daily). Usa POST para un análisis en vivo sin guardado.',
        })
      }

      // Preferir 11PM (más reciente); fallback 10PM
      const chosen = (data as any[]).find(r => r.run_type === '11PM') ?? (data as any[])[0]
      const parseRun = (row: any): DailyAnalysis => {
        const parsedCities: CityAnalysis[] = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : row.resultados
        const parsedRecs = typeof row.recomendaciones === 'string' ? JSON.parse(row.recomendaciones) : row.recomendaciones
        return {
          fecha: row.fecha_ejecucion,
          fecha_objetivo: row.fecha_objetivo,
          message: `Corrida ${row.run_type ?? 'cron'} del ${new Date(row.fecha_ejecucion).toLocaleString('es-ES', { timeZone: 'America/Caracas' })} Caracas`,
          cities: parsedCities ?? [],
          recommendations: parsedRecs ?? [],
          total_allocated: row.total_asignado ?? 0,
          global_metrics: null,
          arbitrage_alerts: [],
          historicalErrors: {},
        } as DailyAnalysis
      }
      return res.status(200).json(parseRun(chosen))
    }

    // ===== Decidir el modo BACKUP ANTES de ejecutar el análisis =====
    // (si hay redirección de fecha — 11PM tardío — hay que analizar la fecha
    // correcta desde el principio, no solo etiquetar la escritura)
    const persistBackup =
      req.body?.persist_backup === true || req.query.persist_backup === '1'
    const cNow = new Date(Date.now() + caracasOffset)
    const cHour = cNow.getUTCHours()
    const tomorrowC = new Date(cNow.getTime())
    tomorrowC.setDate(tomorrowC.getDate() + 1)
    const todayStr = cNow.toISOString().slice(0, 10)
    const tomorrowStr = tomorrowC.toISOString().slice(0, 10)

    let slot: '10PM' | '11PM' | null = null
    let expectedTarget: string | null = null
    if (cHour === 22) {
      slot = '10PM'
      expectedTarget = tomorrowStr
    } else if (cHour === 23 || cHour <= 5) {
      slot = '11PM'
      expectedTarget = cHour === 23 ? tomorrowStr : todayStr
    }

    let backupInfo: Record<string, unknown> = { write: false }
    let fechaFinal = fecha

    if (persistBackup) {
      const client0 = getClient()
      if (!client0) {
        backupInfo = { write: false, reason: 'Supabase no configurado' }
      } else if (!slot) {
        backupInfo = {
          write: false,
          reason: `Ahora son las ${String(cHour).padStart(2, '0')}:xx Caracas. El pronóstico oficial de la noche lo escribe el cron automático (22:00, 22:30, 23:00 y 23:30 Caracas). Esta corrida es en vivo y NO modifica la base de datos: ves el estado actual del modelo para visualizar, y el próximo registro quedará guardado solo cuando el cron dispare.`,
        }
      } else {
        // ¿El cron ya escribió el slot esperado?
        const { data: slotRows } = await (client0.from('daily_runs' as any) as any)
          .select('id, run_type')
          .eq('fecha_objetivo', expectedTarget!)
          .eq('run_type', slot)
          .limit(1)
        const slotLleno = !!(slotRows && (slotRows as any[]).length > 0)

        // Ventana 00-05 pidiendo D+1 pero el 11PM de HOY está vacío → redirigir
        if (
          slot === '11PM' && cHour <= 5 && fecha === tomorrowStr && todayStr !== tomorrowStr &&
          !slotLleno && expectedTarget === todayStr
        ) {
          const { data: hoyRows } = await (client0.from('daily_runs' as any) as any)
            .select('id')
            .eq('fecha_objetivo', todayStr)
            .eq('run_type', '11PM')
            .limit(1)
          if (!hoyRows || (hoyRows as any[]).length === 0) {
            fechaFinal = todayStr
            backupInfo = { write: true, redirected: true, slot, target: todayStr, action: 'fill' }
          } else {
            backupInfo = { write: false, reason: `El 11PM de hoy (${todayStr}) ya lo guardó el cron — no se toca (prioridad del automático).` }
          }
        } else if (fecha === expectedTarget) {
          if (slotLleno) {
            if (slot === '11PM') {
              backupInfo = { write: false, reason: `El 11PM de ${expectedTarget} ya lo guardó el cron — registro final de la noche, no se toca.`, slot, target: expectedTarget }
            } else {
              // 10PM existente: refrescar SOLO si el live saldrá completo (se
              // verifica tras el análisis); se marca como candidato a refresh
              backupInfo = { write: true, pending_refresh: true, slot, target: expectedTarget, action: 'refresh' }
            }
          } else {
            backupInfo = { write: true, slot, target: expectedTarget, action: 'fill' }
          }
        } else {
          backupInfo = { write: false, reason: `La fecha pedida (${fecha}) no es el objetivo del slot ${slot} (${expectedTarget}) — no se escribe en otros días.`, slot, target: expectedTarget }
        }
      }
    }

    // ===== POST: análisis manual en vivo (backup condicional) =====
    const result = await runDailyAnalysis(fechaFinal, true)

    // ===== Ejecutar la escritura de backup si procede =====
    if (persistBackup && backupInfo.write) {
      const target = backupInfo.target as string
      const runSlot = backupInfo.slot as '10PM' | '11PM'
      // Para refresh del 10PM: exigir live completo (nunca degradar lo guardado)
      const degraded = result.cities.some(
        c => {
          const keys = Object.keys(c.forecast.ensemble_raw ?? {})
          return keys.length === 0 || keys.every(k => k === 'twc' || k === 'owm')
        }
      )
      const minModels = Math.min(
        ...result.cities.map(c => Object.keys(c.forecast.ensemble_raw ?? {}).length)
      )
      if (backupInfo.pending_refresh && (degraded || minModels < 4)) {
        backupInfo = {
          write: false,
          reason: `Live degradado (${minModels} modelos mín.) — se conserva intacta la corrida ${runSlot} del cron (prioridad del automático).`,
          slot: runSlot,
          target,
        }
      } else {
        const records = result.cities.map(city => ({
          fecha_ejecucion: result.fecha,
          fecha_objetivo: target,
          ciudad: city.ciudad,
          slug: city.slug,
          // Misma convención que el cron: base del ensemble para que
          // MC/Kalman sigan entrenando con el error crudo
          temp_pronosticada: city.forecast.temp_ponderada,
          temp_corregida: city.forecast.temp_corregida_base ?? city.forecast.temp_corregida,
          temp_real: null,
          error: null,
          modelos_usados: Object.keys(city.forecast.ensemble_raw || {}).length,
          consenso: city.forecast.consenso,
        }))
        const okHist = await saveForecastRecords(records, runSlot)
        const runId = await saveDailyRun({
          fecha_ejecucion: result.fecha,
          fecha_objetivo: target,
          resultados: result.cities,
          recomendaciones: result.recommendations,
          total_asignado: result.total_allocated,
          run_type: runSlot,
        })
        // Snapshots: marcar el temp/modelo del slot correspondiente
        const modelCache = getModelSelectionCache()
        const snapResults = await Promise.allSettled(
          result.cities.map(city => {
            const sel = modelCache[city.slug]
            return upsertForecastSnapshot({
              fecha_objetivo: target,
              slug: city.slug,
              ciudad: city.ciudad,
              run_type_ganadora: runSlot,
              modelo_ganador: sel?.modelo ?? 'ENSEMBLE',
              temp_pronosticada: city.forecast.temp_ponderada,
              temp_corregida: city.forecast.temp_corregida,
              temp_ponderada: city.forecast.temp_ponderada,
              consenso: city.forecast.consenso,
              modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
              temp_10pm: runSlot === '10PM' ? city.forecast.temp_corregida : null,
              temp_11pm: runSlot === '11PM' ? city.forecast.temp_corregida : null,
              modelo_10pm: runSlot === '10PM' ? (sel?.modelo ?? 'ENSEMBLE') : null,
              modelo_11pm: runSlot === '11PM' ? (sel?.modelo ?? 'ENSEMBLE') : null,
              temp_real: null,
              error: null,
            })
          })
        )
        const snapsOk = snapResults.filter(r => r.status === 'fulfilled' && r.value).length
        backupInfo = {
          write: okHist && runId != null,
          slot: runSlot,
          target,
          action: backupInfo.action,
          redirected: backupInfo.redirected,
          daily_run_id: runId,
          history: okHist,
          snapshots: snapsOk,
          reason: okHist && runId != null
            ? `Slot ${runSlot} de ${target} ${backupInfo.action === 'refresh' ? 'refrescado' : 'llenado'} por el botón Actualizar (${result.cities.length} ciudades, mín ${minModels} modelos). El cron automático lo pisará con su UPSERT si aún no ha disparado.`
            : 'Escritura de backup falló (ver logs del servidor).',
        }
      }
    }
    ;(result as any).backup_write = backupInfo
    if (fechaFinal !== fecha) (result as any).redirected_from = fecha

    // Alinearse con lo que guardó el cron si ya existe (misma temp_corregida
    // que verá el usuario en TOMAR DECISION) — ANTES de responder.
    try {
      const client = getClient()
      if (client) {
        const { data } = await (client.from('daily_runs' as any) as any)
          .select('resultados')
          .eq('fecha_objetivo', fecha)
          .order('fecha_ejecucion', { ascending: false })
          .limit(1)
        const savedCities: CityAnalysis[] | null =
          data && (data as any[]).length > 0
            ? (typeof (data as any[])[0].resultados === 'string' ? JSON.parse((data as any[])[0].resultados) : (data as any[])[0].resultados)
            : null
        if (savedCities) {
          const savedMap = new Map(savedCities.map(c => [c.slug, c.forecast?.temp_corregida]))
          for (const city of result.cities) {
            const saved = savedMap.get(city.slug)
            if (saved !== undefined) city.forecast.temp_corregida = saved
          }
        }
      }
    } catch { /* no saved cron data */ }

    return res.status(200).json(result)
  } catch (error) {
    console.error('Forecast API error:', error)
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Error ejecutando análisis',
        details: (error as Error).message,
      })
    }
  }
}
