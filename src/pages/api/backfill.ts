import { NextApiRequest, NextApiResponse } from 'next'
import { getClient, updateActualTemperature, getPendingSnapshots, updateSnapshotActual } from '@/lib/supabase'
import { fetchStationMaxTemp } from '@/lib/station-weather'
import { fetchActualMaxTemp } from '@/lib/openmeteo'
import { CIUDADES_ASIA } from '@/lib/cities'

/**
 * POST /api/backfill
 * Fetches actual temperatures for historical forecast records
 * using Weather.com (TWC) data, the exact backend Polymarket resolves against
 * via Weather Underground. Falls back to Open-Meteo ERA5 for cities without station mapping.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth: permitir sin secret (para el botón CARGAR de la UI) o con secret (para el cron)
  const authHeader = req.headers.authorization
  const expectedSecret = process.env.CRON_SECRET || ''
  if (expectedSecret && authHeader) {
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  try {
    const limit = parseInt(req.query.limit as string || '100')

    // Todos los registros SIN real (a diferencia de getRecordsWithoutActuals, que omite
    // el día UTC actual — aquí SÍ queremos el día de hoy una vez que ya terminó en Asia).
    const client = getClient()
    if (!client) return res.status(500).json({ status: 'error', message: 'Supabase no configurado' })
    const { data } = await client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo')
      .is('temp_real', null)
      .order('fecha_objetivo', { ascending: false } as any)
      .limit(limit)
    const records = ((data as any[]) || []) as { id: number; slug: string; fecha_objetivo: string }[]

    // Guarda: solo se registran días que YA terminaron en Asia (Beijing UTC+8 termina
    // a las 16:00Z del día objetivo; Tokio/Seúl a las 15:00Z). Evita escribir el "real"
    // de un día en curso con la máxima parcial de Weather.com.
    const ahoraUtc = Date.now()
    const pendientes = records.filter(r => {
      if (!r.fecha_objetivo) return true
      const finDia = new Date(r.fecha_objetivo + 'T16:00:00.000Z').getTime()
      return ahoraUtc >= finDia
    })

    if (pendientes.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No hay registros pendientes por actualizar',
        updated: 0,
        total: 0,
      })
    }

    console.log(`[BACKFILL] Fetching actual temps for ${pendientes.length} records (${records.length - pendientes.length} en curso omitidos)...`)

    let updated = 0
    let errors = 0
    const results: { slug: string; fecha: string; temp_real: number | null; error: string | null }[] = []

    for (const record of pendientes) {
      // Try Polymarket settlement first, then TWC/HKO fallback (matches Polymarket resolution)
      const tempReal = await fetchStationMaxTemp(record.slug, record.fecha_objetivo)

      if (tempReal === null) {
        results.push({ slug: record.slug, fecha: record.fecha_objetivo, temp_real: null, error: 'No data from any source' })
        errors++
        continue
      }

      const success = await updateActualTemperature(record.id, tempReal)
      if (success) {
        updated++
        results.push({ slug: record.slug, fecha: record.fecha_objetivo, temp_real: tempReal, error: null })
      } else {
        results.push({ slug: record.slug, fecha: record.fecha_objetivo, temp_real: tempReal, error: 'Error al guardar en Supabase' })
        errors++
      }
    }

    // ===== También actualizar snapshots pendientes =====
    console.log('[BACKFILL] Actualizando snapshots pendientes...')
    const pendingSnaps = await getPendingSnapshots()
    let snapsUpdated = 0
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
        if (ok) snapsUpdated++
      }
    }
    console.log(`[BACKFILL] Snapshots: ${snapsUpdated} actualizados`)

    return res.status(200).json({
      status: 'ok',
      message: `Backfill completado: ${updated} forecast_history + ${snapsUpdated} snapshots, ${errors} errores`,
      updated,
      snapshots_updated: snapsUpdated,
      errors,
      total: pendientes.length,
      omitidos_en_curso: records.length - pendientes.length,
      results,
    })
  } catch (error) {
    console.error('[BACKFILL] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
