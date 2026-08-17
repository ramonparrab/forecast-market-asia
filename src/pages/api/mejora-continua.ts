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

    // Con la migracion 006, hay 2 registros por (slug, fecha_objetivo): 10PM y 11PM.
    // Para backtesting de MC, usamos forecast_snapshot (valores bloqueados) cuando existe,
    // sino caemos a forecast_history con dedup por run_type.
    //
    // Primero intentamos leer de forecast_snapshot para datos historicos
    const { data: snapshots } = await client
      .from('forecast_snapshot' as any)
      .select('fecha_objetivo, slug, ciudad, temp_pronosticada, temp_corregida, temp_real, error, modelos_usados, consenso')
      .not('temp_real', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    // Mapear snapshots por slug
    const snapBySlug = new Map<string, any[]>()
    for (const r of (snapshots as any[]) ?? []) {
      if (!snapBySlug.has(r.slug)) snapBySlug.set(r.slug, [])
      snapBySlug.get(r.slug)!.push(r)
    }

    // Si hay snapshots suficientes, usarlos como fuente principal
    const useSnapshots = (snapshots as any[])?.length > 5

    let query = client
      .from('forecast_history' as any)
      .select('id, fecha_objetivo, slug, ciudad, temp_pronosticada, temp_corregida, temp_real, error, modelos_usados, consenso, run_type')
      .not('temp_real', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    if (slugFilter && slugFilter !== 'todas') {
      query = query.eq('slug', slugFilter)
    }

    const { data: rawRecords, error } = await query

    if (error) return res.status(500).json({ error: error.message })

    const bySlug = new Map<string, any[]>()

    if (useSnapshots) {
      // Usar snapshots como fuente principal (valores bloqueados)
      for (const [slug, snapRecords] of Array.from(snapBySlug.entries())) {
        if (slugFilter && slugFilter !== 'todas' && slug !== slugFilter) continue
        bySlug.set(slug, snapRecords)
      }
    } else {
      // Fallback: usar forecast_history con dedup inteligente
      for (const r of (rawRecords as any[]) ?? []) {
        if (!bySlug.has(r.slug)) bySlug.set(r.slug, [])
        bySlug.get(r.slug)!.push(r)
      }

      // Dedup: por cada (slug, fecha_objetivo), preferir 11PM, luego 10PM, luego mayor id
      for (const [slug, records] of Array.from(bySlug.entries())) {
        const seen = new Map<string, any>()
        for (const r of records) {
          const key = r.fecha_objetivo
          const existing = seen.get(key)
          // Preferir 11PM sobre 10PM sobre otros
          const rPriority = r.run_type === '11PM' ? 2 : r.run_type === '10PM' ? 1 : 0
          const ePriority = existing?.run_type === '11PM' ? 2 : existing?.run_type === '10PM' ? 1 : 0
          if (!existing || rPriority > ePriority || (rPriority === ePriority && r.id > existing.id)) {
            seen.set(key, r)
          }
        }
        const sorted = Array.from(seen.values()).sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))
        bySlug.set(slug, sorted)
      }
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

      // Fetch current pending forecast: usar temp_pronosticada (cruda) como base para MC,
      // ya que el engine aplica station/range/boost encima. Si usamos temp_corregida del
      // snapshot (que ya incluye MC), se duplicaria la correccion.
      let currentQuery = client
        .from('forecast_snapshot' as any)
        .select('fecha_objetivo, temp_pronosticada, temp_corregida, run_type_ganadora, modelo_ganador')
        .eq('slug', slug)
        .is('temp_real', null)
        .order('fecha_objetivo', { ascending: false } as any)
        .limit(1)

      const { data: currentRaw } = await currentQuery

      if ((currentRaw as any[])?.length) {
        const c = (currentRaw as any[])[0]
        // Si hay temp_pronosticada, usarla como base cruda para el engine.
        // Si no existe, mantener temp_corregida como fallback.
        const baseTemp = c.temp_pronosticada ?? c.temp_corregida
        result.currentForecast = computeCurrentForecast(records, {
          slug,
          temp_corregida: baseTemp,
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
