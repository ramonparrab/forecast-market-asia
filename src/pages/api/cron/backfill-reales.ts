import { NextApiRequest, NextApiResponse } from 'next'
import { getRecordsWithoutActuals, updateActualTemperature } from '@/lib/supabase'
import { fetchStationMaxTemp } from '@/lib/station-weather'
import { fetchActualMaxTemp } from '@/lib/openmeteo'

// Vercel: extender timeout a 120s — solo backfill, no forecast
export const config = { maxDuration: 120 }

/**
 * Vercel Cron Job dedicado a backfill de temperaturas reales.
 * Se ejecuta 30 min después del cron principal como red de seguridad.
 * Si el cron principal (daily.ts) ya registró los reales, este no encuentra
 * registros pendientes y termina rápidamente.
 *
 * vercel.json: { "crons": [{ "path": "/api/cron/backfill-reales", "schedule": "30 2 * * *" }] }
 * Horario: 02:30 UTC = 10:30 PM Caracas
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization
  const expectedSecret = process.env.CRON_SECRET || ''

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    console.log('[BACKFILL-CRON] Iniciando backfill de seguridad...')
    const pendingRecords = await getRecordsWithoutActuals(50)
    console.log(`[BACKFILL-CRON] ${pendingRecords.length} registros pendientes`)

    if (pendingRecords.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No hay registros pendientes — el cron principal ya registró los reales',
        updated: 0,
      })
    }

    let backfilled = 0
    const errors: string[] = []

    // Procesar en paralelo (max 4 concurrentes)
    const CONCURRENCY = 4
    for (let i = 0; i < pendingRecords.length; i += CONCURRENCY) {
      const batch = pendingRecords.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (record) => {
          let tempReal = await fetchStationMaxTemp(record.slug, record.fecha_objetivo)
          if (tempReal === null && record.lat && record.lon) {
            tempReal = await fetchActualMaxTemp(record.lat, record.lon, record.fecha_objetivo)
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

    console.log(`[BACKFILL-CRON] Resultado: ${backfilled} actualizados, ${errors.length} errores`)
    return res.status(200).json({
      status: 'ok',
      message: `Backfill de seguridad: ${backfilled} actualizados, ${errors.length} errores`,
      updated: backfilled,
      errors: errors.length,
      details: errors,
    })
  } catch (error) {
    console.error('[BACKFILL-CRON] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
