import { NextApiRequest, NextApiResponse } from 'next'
import { getClient, getServiceClient } from '@/lib/supabase'
import { fetchStationMaxTemp } from '@/lib/station-weather'

/**
 * POST /api/backfill-all
 * Re-backfills ALL historical forecast records using Weather.com (TWC) data,
 * the exact backend Polymarket resolves against via Weather Underground.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const client = getServiceClient()
    if (!client) return res.status(500).json({ error: 'No Supabase client' })

    // Get all records with temp_corregida (any temp_real status)
    const { data, error } = await (client as any)
      .from('forecast_history')
      .select('id, slug, fecha_objetivo, temp_corregida')
      .not('temp_corregida', 'is', null)
      .order('fecha_objetivo', { ascending: false })
      .limit(500)

    if (error) return res.status(500).json({ error: error.message })
    if (!data || (data as any[]).length === 0) {
      return res.status(200).json({ message: 'No records found', total: 0 })
    }

    // Dedup by (slug, fecha_objetivo) — keep latest id
    const seen = new Map<string, any>()
    for (const r of (data as any[])) {
      const key = `${r.slug}|${r.fecha_objetivo}`
      if (!seen.has(key) || r.id > seen.get(key).id) {
        seen.set(key, r)
      }
    }

    const unique = Array.from(seen.values())
    console.log(`[BACKFILL-ALL] ${data.length} total records, ${unique.length} unique (slug, fecha) pairs`)

    let updated = 0
    let errors = 0
    const results: { slug: string; fecha: string; old_temp: number | null; new_temp: number | null; status: string }[] = []

    for (const record of unique) {
      // Fetch from Weather.com (TWC) — exact Polymarket/WU resolution source
      let tempReal = await fetchStationMaxTemp(record.slug, record.fecha_objetivo)

      if (tempReal === null) {
        results.push({ slug: record.slug, fecha: record.fecha_objetivo, old_temp: null, new_temp: null, status: 'no data' })
        errors++
        continue
      }

      // Update ALL records matching this (slug, fecha_objetivo)
      const newError = Math.round((tempReal - record.temp_corregida) * 100) / 100

      const { error: updateErr } = await (client as any)
        .from('forecast_history')
        .update({ temp_real: tempReal, error: newError })
        .eq('slug', record.slug)
        .eq('fecha_objetivo', record.fecha_objetivo)

      if (updateErr) {
        results.push({ slug: record.slug, fecha: record.fecha_objetivo, old_temp: null, new_temp: tempReal, status: `update error: ${updateErr.message}` })
        errors++
      } else {
        updated++
        results.push({ slug: record.slug, fecha: record.fecha_objetivo, old_temp: null, new_temp: tempReal, status: 'ok' })
      }
    }

    return res.status(200).json({
      status: 'ok',
      message: `Re-backfill completado: ${updated} actualizados, ${errors} errores`,
      updated,
      errors,
      total: unique.length,
      results,
    })
  } catch (error) {
    console.error('[BACKFILL-ALL] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
