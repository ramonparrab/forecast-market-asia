import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from '@/lib/cities'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const days = req.query.days === 'all' ? null : Number(req.query.days) || 30
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'No Supabase' })

    const client = createClient(supabaseUrl, supabaseKey)

    // Build query with optional date filter
    let query = client
      .from('forecast_history' as any)
      .select('slug, fecha_objetivo, temp_corregida, temp_real, error')
      .not('temp_real', 'is', null)
      .not('temp_corregida', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    if (days) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      query = query.gte('fecha_objetivo', cutoff.toISOString().slice(0, 10))
    }

    const { data: records, error: dbError } = await query
    if (dbError) throw new Error(dbError.message)

    const rows = (records ?? []) as any[]
    const slugToName: Record<string, string> = {}
    for (const c of CIUDADES_ASIA) slugToName[c.slug] = c.nombre

    // Dedup: keep one record per slug+fecha (prefer latest by id if duplicates)
    const seen = new Set<string>()
    const deduped = rows.filter(r => {
      const key = `${r.slug}_${r.fecha_objetivo}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Daily data for chart: { fecha, slug, ciudad, error }
    const daily = deduped.map(r => ({
      fecha: r.fecha_objetivo,
      slug: r.slug,
      ciudad: slugToName[r.slug] ?? r.slug,
      temp_corregida: r.temp_corregida,
      temp_real: r.temp_real,
      error: r.error ?? (r.temp_corregida - r.temp_real),
    }))

    // Per-city aggregation
    const bySlug = new Map<string, any[]>()
    for (const d of daily) {
      if (!bySlug.has(d.slug)) bySlug.set(d.slug, [])
      bySlug.get(d.slug)!.push(d)
    }

    const perCity = Array.from(bySlug.entries()).map(([slug, recs]) => {
      const errors = recs.map(r => r.error)
      const absErrors = errors.map(e => Math.abs(e))
      const mae = absErrors.reduce((s, v) => s + v, 0) / absErrors.length
      const rmse = Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / errors.length)
      const bias = errors.reduce((s, v) => s + v, 0) / errors.length
      const within1 = absErrors.filter(e => e <= 1).length
      const accuracy = (within1 / absErrors.length) * 100
      const bestDay = recs.reduce((best, r) => Math.abs(r.error) < Math.abs(best.error) ? r : best, recs[0])
      const worstDay = recs.reduce((worst, r) => Math.abs(r.error) > Math.abs(worst.error) ? r : worst, recs[0])
      return {
        slug,
        ciudad: slugToName[slug] ?? slug,
        mae: +mae.toFixed(2),
        rmse: +rmse.toFixed(2),
        bias: +bias.toFixed(2),
        accuracy_pct: +accuracy.toFixed(1),
        muestras: recs.length,
        best_day: { fecha: bestDay.fecha, error: +bestDay.error.toFixed(2) },
        worst_day: { fecha: worstDay.fecha, error: +worstDay.error.toFixed(2) },
      }
    })

    // Sort: most precise first (lower MAE)
    perCity.sort((a, b) => a.mae - b.mae)

    // Global summary
    const allErrors = daily.map(d => d.error)
    const allAbs = allErrors.map(e => Math.abs(e))
    const global = {
      mae: +(allAbs.reduce((s, v) => s + v, 0) / allAbs.length).toFixed(2),
      rmse: +Math.sqrt(allErrors.reduce((s, v) => s + v * v, 0) / allErrors.length).toFixed(2),
      bias: +(allErrors.reduce((s, v) => s + v, 0) / allErrors.length).toFixed(2),
      accuracy_pct: +((allAbs.filter(e => e <= 1).length / allAbs.length) * 100).toFixed(1),
      total: daily.length,
      dias: new Set(daily.map(d => d.fecha)).size,
    }

    return res.status(200).json({ daily, perCity, global, period: days ?? 'all' })
  } catch (error) {
    console.error('Precision API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
