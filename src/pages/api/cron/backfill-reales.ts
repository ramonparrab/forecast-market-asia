import { NextApiRequest, NextApiResponse } from 'next'
import { getServiceClient, updateActualTemperature, getPendingSnapshots, updateSnapshotActual } from '@/lib/supabase'
import { fetchStationMaxTemp } from '@/lib/station-weather'
import { fetchActualMaxTemp } from '@/lib/openmeteo'
import { CIUDADES_ASIA } from '@/lib/cities'

// Vercel: extender timeout a 120s — solo backfill, no forecast
export const config = { maxDuration: 120 }

/**
 * Vercel Cron Job dedicado a backfill de temperaturas reales.
 * Se ejecuta en múltiples horarios:
 *   - 02:30Z (10:30PM Caracas): después del cron 10PM
 *   - 03:30Z (11:30PM Caracas): después del cron 11PM
 *   - 17:00Z (1PM Caracas): después de que termina el día en Asia (16:00Z)
 *
 * Usa getServiceClient() para evitar problemas de RLS.
 * Filtra por 16:00Z (fin del día Asia) para no registrar parciales.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization
  const expectedSecret = process.env.CRON_SECRET || ''

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const cronHour = new Date().getUTCHours()
    console.log(`[BACKFILL-CRON] Iniciando (hora UTC: ${cronHour})...`)

    // Usar service client para evitar RLS
    const client = getServiceClient()
    if (!client) return res.status(500).json({ status: 'error', message: 'No service client' })

    // Obtener TODOS los registros sin temp_real (sin filtro de fecha UTC)
    // El filtro de tiempo se hace client-side con 16:00Z
    const { data: allPending, error: qErr } = await client
      .from('forecast_history' as any)
      .select('id, slug, ciudad, fecha_objetivo')
      .is('temp_real', null)
      .order('fecha_objetivo', { ascending: false } as any)
      .limit(200)

    if (qErr) {
      console.error('[BACKFILL-CRON] Query error:', qErr.message)
      return res.status(500).json({ status: 'error', message: qErr.message })
    }

    const allRecords = (allPending as any[]) ?? []

    // Filtrar: solo días que YA terminaron en Asia
    // El día en Asia (UTC+8) termina a las 16:00Z del fecha_objetivo
    const ahoraUtc = Date.now()
    const pendientes = allRecords.filter(r => {
      if (!r.fecha_objetivo) return true
      const finDiaAsia = new Date(r.fecha_objetivo + 'T16:00:00.000Z').getTime()
      return ahoraUtc >= finDiaAsia
    })

    console.log(`[BACKFILL-CRON] ${pendientes.length} registros listos para backfill (de ${allRecords.length} sin real)`)

    if (pendientes.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No hay registros pendientes con día Asia terminado',
        updated: 0,
      })
    }

    let backfilled = 0
    const errors: string[] = []

    // Procesar en paralelo (max 4 concurrentes)
    const CONCURRENCY = 4
    for (let i = 0; i < pendientes.length; i += CONCURRENCY) {
      const batch = pendientes.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (record) => {
          let tempReal = await fetchStationMaxTemp(record.slug, record.fecha_objetivo)
          if (tempReal === null) {
            const city = CIUDADES_ASIA.find(c => c.slug === record.slug)
            if (city?.lat && city?.lon) {
              tempReal = await fetchActualMaxTemp(city.lat, city.lon, record.fecha_objetivo)
            }
          }
          if (tempReal === null) return { record, ok: false }
          const ok = await updateActualTemperature(record.id, tempReal)
          return { record, tempReal, ok }
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) {
          backfilled++
          console.log(`[BACKFILL-CRON] ${r.value.record.slug} ${r.value.record.fecha_objetivo} → ${r.value.tempReal}°C`)
        } else if (r.status === 'fulfilled') {
          errors.push(`${r.value.record.slug} ${r.value.record.fecha_objetivo}: sin datos`)
        } else {
          errors.push(`Error: ${(r.reason as Error)?.message ?? 'unknown'}`)
        }
      }
    }

    // También actualizar snapshots pendientes
    console.log('[BACKFILL-CRON] Actualizando snapshots pendientes...')
    const pendingSnaps = await getPendingSnapshots()
    let snapsUpdated = 0
    for (const snap of pendingSnaps) {
      if (snap.fecha_objetivo >= new Date().toISOString().slice(0, 10)) continue
      const finDiaAsia = new Date(snap.fecha_objetivo + 'T16:00:00.000Z').getTime()
      if (ahoraUtc < finDiaAsia) continue
      const tempReal = await fetchStationMaxTemp(snap.slug, snap.fecha_objetivo)
        ?? (await fetchActualMaxTemp(
          CIUDADES_ASIA.find(c => c.slug === snap.slug)?.lat ?? 0,
          CIUDADES_ASIA.find(c => c.slug === snap.slug)?.lon ?? 0,
          snap.fecha_objetivo
        ))
      if (tempReal !== null) {
        const ok = await updateSnapshotActual(snap.slug, snap.fecha_objetivo, tempReal)
        if (ok) snapsUpdated++
      }
    }

    console.log(`[BACKFILL-CRON] Resultado: ${backfilled} forecast_history + ${snapsUpdated} snapshots, ${errors.length} errores`)
    return res.status(200).json({
      status: 'ok',
      message: `Backfill: ${backfilled} reales + ${snapsUpdated} snapshots, ${errors.length} errores`,
      updated: backfilled,
      snapshots_updated: snapsUpdated,
      errors: errors.length,
      details: errors,
    })
  } catch (error) {
    console.error('[BACKFILL-CRON] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
