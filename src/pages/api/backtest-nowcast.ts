import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeAllMejoras } from '@/lib/mejora-continua-engine'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export interface NowcastDay {
  fecha_objetivo: string
  temp_real: number | null
  temp_corregida_10pm: number | null
  temp_corregida_11pm: number | null
  hora_10pm: string | null
  hora_11pm: string | null
  combinado_10pm: number | null
  combinado_11pm: number | null
  error_10pm: number | null
  error_11pm: number | null
  gana: '10PM' | '11PM' | 'EMPATE' | null
}

export interface NowcastCityResult {
  slug: string
  nombre: string
  days: NowcastDay[]
  total_gana_10pm: number
  total_gana_11pm: number
  total_empate: number
  total_dias: number
  error_prom_10pm: number | null
  error_prom_11pm: number | null
}

export interface BacktestNowcastResponse {
  ciudades: Record<string, NowcastCityResult>
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const client = createClient(supabaseUrl, supabaseKey)
    const daysLimit = parseInt(req.query.dias as string || '60') || 60
    const slugFilter = (req.query.ciudad as string || '').trim()

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysLimit - 3)

    // Get ALL forecast_history records (without dedup) to find earliest vs latest per target
    let fhQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_corregida, temp_real, error, fecha_ejecucion')
      .gte('fecha_ejecucion', startDate.toISOString())

    if (slugFilter) {
      fhQuery = fhQuery.eq('slug', slugFilter)
    }

    const { data: rawRecords, error: fhError } = await fhQuery
    if (fhError) return res.status(500).json({ error: fhError.message })
    if (!rawRecords || rawRecords.length === 0) return res.status(200).json({ ciudades: {} })

    const allSlugs = slugFilter ? [slugFilter] : CIUDADES_ASIA.map(c => c.slug)
    const slugNames = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))

    // Group ALL records by (slug, fecha_objetivo) to find earliest and latest
    const groups = new Map<string, { id: number; temp_corregida: number; fecha_ejecucion: string }[]>()

    for (const r of (rawRecords as any[])) {
      if (!allSlugs.includes(r.slug)) continue
      const objDate = new Date(r.fecha_objetivo + 'T12:00:00')
      const daysAgo = Math.floor((endDate.getTime() - objDate.getTime()) / (1000 * 60 * 60 * 24))
      if (daysAgo < 0 || daysAgo > daysLimit) continue

      const key = `${r.slug}|${r.fecha_objetivo}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push({
        id: r.id,
        temp_corregida: r.temp_corregida,
        fecha_ejecucion: r.fecha_ejecucion,
      })
    }

    // Build per-slug comparison data from earliest vs latest record per target
    const bySlug = new Map<string, { fecha_objetivo: string; first: { id: number; temp_corregida: number; fecha_ejecucion: string }; last: { id: number; temp_corregida: number; fecha_ejecucion: string } }[]>()

    Array.from(groups.entries()).forEach(([key, entries]) => {
      if (entries.length < 2) return

      const [slug, fecha_objetivo] = key.split('|')
      entries.sort((a, b) => a.id - b.id)

      // Need at least 12h between first and last record
      const first = entries[0]
      const last = entries[entries.length - 1]
      const timeDiffMs = new Date(last.fecha_ejecucion).getTime() - new Date(first.fecha_ejecucion).getTime()
      if (timeDiffMs < 12 * 60 * 60 * 1000) return

      if (!bySlug.has(slug)) bySlug.set(slug, [])
      bySlug.get(slug)!.push({ fecha_objetivo, first, last })
    })

    if (bySlug.size === 0) return res.status(200).json({ ciudades: {} })

    // Get mejora corrections from deduplicated forecast_history (same as mejora-continua)
    let mejoraQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_corregida, temp_real, error')
      .not('temp_real', 'is', null)

    if (slugFilter) {
      mejoraQuery = mejoraQuery.eq('slug', slugFilter)
    }

    const { data: mejoraRecords } = await mejoraQuery

    const fhBySlug = new Map<string, any[]>()
    for (const r of (mejoraRecords as any[]) ?? []) {
      if (!fhBySlug.has(r.slug)) fhBySlug.set(r.slug, [])
      fhBySlug.get(r.slug)!.push(r)
    }

    const slugCorrections = new Map<string, Map<string, number>>()
    const slugReals = new Map<string, Map<string, number>>()

    Array.from(fhBySlug.entries()).forEach(([slug, records]) => {
      const seen = new Map<string, any>()
      for (const r of records) {
        const key = r.fecha_objetivo
        if (!seen.has(key) || r.id > seen.get(key).id) {
          seen.set(key, r)
        }
      }
      const sorted = Array.from(seen.values()).sort((a, b) =>
        a.fecha_objetivo.localeCompare(b.fecha_objetivo)
      )

      const reals = new Map<string, number>()
      for (const r of sorted) reals.set(r.fecha_objetivo, r.temp_real)
      slugReals.set(slug, reals)

      try {
        const result = computeAllMejoras(sorted, slugNames.get(slug) || slug)
        const corrections = new Map<string, number>()
        for (const d of result.dailyResults) {
          corrections.set(d.fecha, d.combinado.temp - d.temp_corregida)
        }
        slugCorrections.set(slug, corrections)
      } catch (e) {
        console.error(`Error computing mejora for ${slug}:`, e)
      }
    })

    // Build final results
    const ciudades: Record<string, NowcastCityResult> = {}

    Array.from(bySlug.entries()).forEach(([slug, days]) => {
      const corrections = slugCorrections.get(slug) || new Map()
      const reals = slugReals.get(slug) || new Map()

      const resultDays: NowcastDay[] = []

      for (const day of days) {
        const tempReal = reals.get(day.fecha_objetivo) ?? null
        const tcFirst = day.first.temp_corregida
        const tcLast = day.last.temp_corregida

        const correction = corrections.get(day.fecha_objetivo) ?? 0
        const combFirst = tcFirst + correction
        const combLast = tcLast + correction

        let errorFirst: number | null = null
        let errorLast: number | null = null
        let gana: NowcastDay['gana'] = null

        if (tempReal !== null) {
          errorFirst = round2(Math.abs(combFirst - tempReal))
          errorLast = round2(Math.abs(combLast - tempReal))

          const diff = errorLast - errorFirst
          if (Math.abs(diff) < 0.01) {
            gana = 'EMPATE'
          } else if (diff > 0) {
            gana = '10PM'
          } else {
            gana = '11PM'
          }
        }

        resultDays.push({
          fecha_objetivo: day.fecha_objetivo,
          temp_real: tempReal,
          temp_corregida_10pm: round2(tcFirst),
          temp_corregida_11pm: round2(tcLast),
          hora_10pm: day.first.fecha_ejecucion,
          hora_11pm: day.last.fecha_ejecucion,
          combinado_10pm: round2(combFirst),
          combinado_11pm: round2(combLast),
          error_10pm: errorFirst,
          error_11pm: errorLast,
          gana,
        })
      }

      if (resultDays.length === 0) return

      resultDays.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

      let g10 = 0, g11 = 0, emp = 0
      let sumErr10 = 0, sumErr11 = 0, countErr = 0

      for (const d of resultDays) {
        if (d.gana === '10PM') g10++
        else if (d.gana === '11PM') g11++
        else if (d.gana === 'EMPATE') emp++

        if (d.error_10pm !== null && d.error_11pm !== null) {
          sumErr10 += d.error_10pm
          sumErr11 += d.error_11pm
          countErr++
        }
      }

      ciudades[slug] = {
        slug,
        nombre: slugNames.get(slug) || slug,
        days: resultDays,
        total_gana_10pm: g10,
        total_gana_11pm: g11,
        total_empate: emp,
        total_dias: resultDays.length,
        error_prom_10pm: countErr > 0 ? round2(sumErr10 / countErr) : null,
        error_prom_11pm: countErr > 0 ? round2(sumErr11 / countErr) : null,
      }
    })

    return res.status(200).json({ ciudades })
  } catch (error) {
    console.error('[backtest-nowcast]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
