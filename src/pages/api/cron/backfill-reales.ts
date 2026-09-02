import { NextApiRequest, NextApiResponse } from 'next'
import {
  startCronRun,
  finishCronRun,
  getRecordsWithoutActuals,
  updateActualTemperature,
  getPendingSnapshots,
  updateSnapshotActual,
} from '@/lib/supabase'
import { fetchStationMaxTemp } from '@/lib/station-weather'
import { fetchActualMaxTemp } from '@/lib/openmeteo'
import { CIUDADES_ASIA } from '@/lib/cities'

// Vercel: 300s de presupuesto (vercel.json functions + config export)
export const config = { maxDuration: 300 }

/**
 * Endpoint MANUAL de recuperación de temperaturas reales.
 *
 * ⚠️ NO está en vercel.json — el registro de reales es responsabilidad del cron
 * /api/cron/daily (10PM y 11PM Caracas), que además drena la cola de atrasadas
 * en cada corrida (30 más viejas por ejecución).
 *
 * Este endpoint existe para recuperaciones masivas puntuales, p.ej. el backlog
 * de julio (~87 filas sin temp_real). Ejecutar manualmente:
 *
 *   curl -X POST "https://forecast-market-asia.vercel.app/api/cron/backfill-reales" \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Procesa TODAS las filas pendientes OLDEST-FIRST (rompe el starvation de las
 * filas viejas) con fuentes: Polymarket settlement → TWC estación → Open-Meteo Archive.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization
  const expectedSecret = process.env.CRON_SECRET || ''

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const startedAt = Date.now()
  const logId = await startCronRun({ job: 'backfill-reales', run_type: null })

  try {
    console.log('[BACKFILL] Recuperación manual de reales (oldest-first)...')

    // Pendientes de forecast_history — las MÁS VIEJAS primero
    const pendientes = await getRecordsWithoutActuals(200, true)
    console.log(`[BACKFILL] ${pendientes.length} registros pendientes (oldest-first)`)

    let backfilled = 0
    const errors: string[] = []
    const actualizados: Record<string, number> = {}

    // Lotes de 10 en paralelo
    for (let i = 0; i < pendientes.length; i += 10) {
      const batch = pendientes.slice(i, i + 10)
      const results = await Promise.allSettled(
        batch.map(async (record) => {
          // Polymarket settlement → TWC estación → Open-Meteo Archive
          let tempReal = await fetchStationMaxTemp(record.slug, record.fecha_objetivo)
          if (tempReal === null) {
            const city = CIUDADES_ASIA.find(c => c.slug === record.slug)
            if (city?.lat && city?.lon) {
              tempReal = await fetchActualMaxTemp(city.lat, city.lon, record.fecha_objetivo)
            }
          }
          if (tempReal === null) return { record, ok: false, tempReal: null as number | null }
          const ok = await updateActualTemperature(record.id, tempReal)
          return { record, ok, tempReal }
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) {
          backfilled++
          actualizados[`${r.value.record.slug}@${r.value.record.fecha_objetivo}`] = r.value.tempReal!
          console.log(`[BACKFILL] ${r.value.record.slug} ${r.value.record.fecha_objetivo} → ${r.value.tempReal}°C`)
        } else if (r.status === 'fulfilled') {
          errors.push(`${r.value.record.slug} ${r.value.record.fecha_objetivo}: sin datos`)
        } else {
          errors.push(`Error: ${(r.reason as Error)?.message ?? 'unknown'}`)
        }
      }
    }

    // Snapshots pendientes — oldest-first, en paralelo
    const pendingSnaps = await getPendingSnapshots(true, 200)
    const snapsPendientes = pendingSnaps.filter(s => s.fecha_objetivo < new Date().toISOString().slice(0, 10))
    let snapsUpdated = 0
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
        if (r.status === 'fulfilled' && r.value) snapsUpdated++
      }
    }

    const status = backfilled + snapsUpdated > 0 ? (errors.length > 0 ? 'partial' : 'ok') : 'error'
    const duracionMs = Date.now() - startedAt
    const details = {
      registros_pendientes: pendientes.length,
      actualizados: backfilled,
      snapshots_pendientes: snapsPendientes.length,
      snapshots_actualizados: snapsUpdated,
      errores: errors.slice(0, 30),
      valores: actualizados,
      duration_ms: duracionMs,
    }
    await finishCronRun(logId, status, details)

    console.log(`[BACKFILL] Resultado: ${backfilled} forecast_history + ${snapsUpdated} snapshots (${errors.length} errores)`)
    return res.status(200).json({
      status,
      message: `Backfill: ${backfilled} reales + ${snapsUpdated} snapshots de ${pendientes.length + snapsPendientes.length} pendientes`,
      updated: backfilled,
      snapshots_updated: snapsUpdated,
      pending_remaining: Math.max(0, pendientes.length - backfilled),
      errors: errors.length,
      details: details,
    })
  } catch (error) {
    console.error('[BACKFILL] Error:', error)
    await finishCronRun(logId, 'error', { fatal: (error as Error).message, duration_ms: Date.now() - startedAt })
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
