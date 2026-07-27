import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeAllMejoras, computeCurrentForecast } from '@/lib/mejora-continua-engine'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export interface NowcastDay {
  fecha_objetivo: string
  temp_real: number | null
  temp_corregida_10pm: number | null
  temp_corregida_11pm: number | null
  hora_10pm: string | null
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

    const allSlugs = slugFilter ? [slugFilter] : CIUDADES_ASIA.map(c => c.slug)
    const slugNames = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))

    // ============ 1) Read ALL forecast_history (with and without temp_real) ============
    let fhQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_corregida, temp_real, error')

    if (slugFilter) {
      fhQuery = fhQuery.eq('slug', slugFilter)
    }
    fhQuery = fhQuery.order('fecha_objetivo', { ascending: true } as any)

    const { data: allFh } = await fhQuery
    if (!allFh || allFh.length === 0) return res.status(200).json({ ciudades: {} })

    // Separate historical (with temp_real) and pending (without temp_real) per slug
    const fhBySlug = new Map<string, { historical: any[]; pending: any | null }>()
    for (const r of allFh as any[]) {
      if (!fhBySlug.has(r.slug)) fhBySlug.set(r.slug, { historical: [], pending: null })
      const bucket = fhBySlug.get(r.slug)!
      if (r.temp_real != null) {
        bucket.historical.push(r)
      } else {
        // Keep only the latest pending record
        if (!bucket.pending || r.id > bucket.pending.id) {
          bucket.pending = r
        }
      }
    }

    // ============ 2) Build FH lookup: (slug|fecha) -> { tc, real } ============
    const fhMap = new Map<string, { tc: number; real: number | null }>()
    const slugPending = new Map<string, { fecha: string; tc: number }>()

    for (const [slug, bucket] of fhBySlug) {
      // Deduplicate historical: keep latest id per target
      const seen = new Map<string, any>()
      for (const r of bucket.historical) {
        const key = r.fecha_objetivo
        if (!seen.has(key) || r.id > seen.get(key).id) seen.set(key, r)
      }
      for (const [fecha, r] of seen) {
        fhMap.set(slug + '|' + fecha, { tc: r.temp_corregida, real: r.temp_real })
      }
      // Pending
      if (bucket.pending) {
        slugPending.set(slug, {
          fecha: bucket.pending.fecha_objetivo,
          tc: bucket.pending.temp_corregida,
        })
      }
    }

    // Filter by daysLimit
    const validTargets = new Map<string, string[]>()
    for (const [key, val] of fhMap) {
      const [slug, fecha] = key.split('|')
      const daysAgo = Math.floor((endDate.getTime() - new Date(fecha + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
      if (daysAgo >= 0 && daysAgo <= daysLimit) {
        if (!validTargets.has(slug)) validTargets.set(slug, [])
        validTargets.get(slug)!.push(fecha)
      }
    }
    // Also include pending targets
    for (const [slug, p] of slugPending) {
      if (!validTargets.has(slug)) validTargets.set(slug, [])
      if (!validTargets.get(slug)!.includes(p.fecha)) {
        fhMap.set(slug + '|' + p.fecha, { tc: p.tc, real: null })
        validTargets.get(slug)!.push(p.fecha)
      }
    }

    // ============ 3) Read daily_runs first record per (slug, fecha) ============
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, resultados')
      .gte('fecha_ejecucion', startDate.toISOString())
      .order('fecha_ejecucion', { ascending: true } as any)

    const drFirst = new Map<string, { id: number; fecha_ejecucion: string; tc: number }>()
    const drAllRecords = new Map<string, { id: number; fecha_ejecucion: string; tc: number }[]>()

    for (const run of (runs as any[]) ?? []) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue

      for (const slug of allSlugs) {
        const key = slug + '|' + fo
        if (!fhMap.has(key)) continue

        const cityData = parsed.find((c: any) => c.slug === slug)
        const tc = cityData?.forecast?.temp_corregida
        if (tc == null) continue
        const val = { id: run.id, fecha_ejecucion: run.fecha_ejecucion, tc: Number(tc) }

        if (!drFirst.has(key)) {
          drFirst.set(key, val)
         }
        if (!drAllRecords.has(key)) drAllRecords.set(key, [])
        drAllRecords.get(key)!.push(val)
      }
    }

    if (drFirst.size === 0) return res.status(200).json({ ciudades: {} })

    // ============ 4) Compute corrections using mejora-continua engine ============
    const slugCorrections = new Map<string, Map<string, number>>()

    for (const [slug, bucket] of fhBySlug) {
      const historical = bucket.historical
      if (historical.length === 0) continue

      // Deduplicate historical (keep latest id per target)
      const seen = new Map<string, any>()
      for (const r of historical) {
        if (!seen.has(r.fecha_objetivo) || r.id > seen.get(r.fecha_objetivo).id) {
          seen.set(r.fecha_objetivo, r)
        }
      }
      const sorted = Array.from(seen.values()).sort((a, b) =>
        a.fecha_objetivo.localeCompare(b.fecha_objetivo)
      )

      const corrections = new Map<string, number>()

      // computeAllMejoras for historical dates
      try {
        const result = computeAllMejoras(sorted, slugNames.get(slug) || slug)
        for (const d of result.dailyResults) {
          corrections.set(d.fecha, d.combinado.temp - d.temp_corregida)
        }
      } catch (e) {
        console.error('Error computing mejora for', slug, e)
      }

      // computeCurrentForecast for pending date
      if (bucket.pending) {
        try {
          const cf = computeCurrentForecast(sorted, {
            slug,
            temp_corregida: bucket.pending.temp_corregida,
            fecha_objetivo: bucket.pending.fecha_objetivo,
          } as any, slugNames.get(slug) || slug)
          if (cf) {
            corrections.set(bucket.pending.fecha_objetivo, cf.combinado - bucket.pending.temp_corregida)
          }
        } catch (e) {
          console.error('Error computing current forecast for', slug, e)
        }
      }

      slugCorrections.set(slug, corrections)
    }

    // ============ 5) Build final results ============
    const ciudades: Record<string, NowcastCityResult> = {}

    for (const [slug, fechas] of validTargets) {
      const resultDays: NowcastDay[] = []
      const corrections = slugCorrections.get(slug) || new Map()

      for (const fecha of fechas) {
        const key = slug + '|' + fecha
        const first = drFirst.get(key)
        const fhVal = fhMap.get(key)
        if (!first || !fhVal) continue

        const tcFirst = first.tc
        const tcLast = fhVal.tc
        const tempReal = fhVal.real

        const correction = corrections.get(fecha) ?? 0
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
          fecha_objetivo: fecha,
          temp_real: tempReal,
          temp_corregida_10pm: round2(tcFirst),
          temp_corregida_11pm: round2(tcLast),
          hora_10pm: first.fecha_ejecucion,
          combinado_10pm: round2(combFirst),
          combinado_11pm: round2(combLast),
          error_10pm: errorFirst,
          error_11pm: errorLast,
          gana,
        })
      }

      if (resultDays.length === 0) continue

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
    }

    return res.status(200).json({ ciudades })
  } catch (error) {
    console.error('[backtest-nowcast]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
