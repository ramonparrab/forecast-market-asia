import { NextApiRequest, NextApiResponse } from 'next'
import { getRecordsWithoutActuals, updateActualTemperature } from '@/lib/supabase'
import { fetchStationMaxTemp } from '@/lib/station-weather'

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

  try {
    const limit = parseInt(req.query.limit as string || '50')
    const records = await getRecordsWithoutActuals(limit)

    if (records.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No hay registros pendientes por actualizar',
        updated: 0,
        total: 0,
      })
    }

    console.log(`[BACKFILL] Fetching actual temps for ${records.length} records...`)

    let updated = 0
    let errors = 0
    const results: { slug: string; fecha: string; temp_real: number | null; error: string | null }[] = []

    for (const record of records) {
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

    return res.status(200).json({
      status: 'ok',
      message: `Backfill completado: ${updated} actualizados, ${errors} errores`,
      updated,
      errors,
      total: records.length,
      results,
    })
  } catch (error) {
    console.error('[BACKFILL] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
