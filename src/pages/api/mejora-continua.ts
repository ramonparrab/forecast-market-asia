import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeAllMejoras, computeCurrentForecast, CityMejoraResult } from '@/lib/mejora-continua-engine'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const client = createClient(supabaseUrl, supabaseKey)
    const slugFilter = req.query.ciudad as string || ''
    const daysLimit = parseInt(req.query.dias as string || '0') || 0

    const ciudadMap = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))

    let query = client
      .from('forecast_history' as any)
      .select('id, fecha_objetivo, slug, ciudad, temp_pronosticada, temp_corregida, temp_real, error, modelos_usados, consenso')
      .not('temp_real', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    if (slugFilter && slugFilter !== 'todas') {
      query = query.eq('slug', slugFilter)
    }

    const { data: rawRecords, error } = await query

    if (error) return res.status(500).json({ error: error.message })

    const bySlug = new Map<string, any[]>()
    for (const r of (rawRecords as any[]) ?? []) {
      if (!bySlug.has(r.slug)) bySlug.set(r.slug, [])
      bySlug.get(r.slug)!.push(r)
    }

    // Deduplicate per slug by keeping latest id per fecha_objetivo
    for (const [slug, records] of Array.from(bySlug.entries())) {
      const seen = new Map<string, any>()
      for (const r of records) {
        const key = r.fecha_objetivo
        if (!seen.has(key) || r.id > seen.get(key).id) {
          seen.set(key, r)
        }
      }
      const sorted = Array.from(seen.values()).sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))
      bySlug.set(slug, sorted)
    }

    // Apply days limit
    if (daysLimit > 0) {
      for (const [slug, records] of Array.from(bySlug.entries())) {
        bySlug.set(slug, records.slice(-daysLimit))
      }
    }

    const ciudades: Record<string, CityMejoraResult> = {}

    for (const [slug, records] of Array.from(bySlug.entries())) {
      const nombre = ciudadMap.get(slug) || slug
      const result = computeAllMejoras(records, nombre)

      // Fetch current pending forecast for this city
      let currentQuery = client
        .from('forecast_history' as any)
        .select('fecha_objetivo, temp_corregida')
        .eq('slug', slug)
        .is('temp_real', null)
        .order('fecha_ejecucion', { ascending: false } as any)
        .limit(1)

      const { data: currentRaw } = await currentQuery

      if ((currentRaw as any[])?.length) {
        const c = (currentRaw as any[])[0]
        result.currentForecast = computeCurrentForecast(records, {
          slug,
          temp_corregida: c.temp_corregida,
        } as any, nombre)
      }

      ciudades[slug] = result
    }

    return res.status(200).json({ ciudades })
  } catch (error) {
    console.error('[mejora-continua]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
