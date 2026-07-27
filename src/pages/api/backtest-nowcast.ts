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

    // ============ 1) forecast_history = canonical source for 11PM + temp_real ============
    let fhQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_corregida, temp_real, error')
      .not('temp_real', 'is', null)

    if (slugFilter) {
      fhQuery = fhQuery.eq('slug', slugFilter)
    }

    const { data: fhRecords } = await fhQuery
    if (!fhRecords || fhRecords.length === 0) return res.status(200).json({ ciudades: {} })

    // Deduplicate FH: keep latest id per (slug, fecha_objetivo)
    const fhBySlug = new Map<string, Map<string, any>>()
    for (const r of fhRecords as any[]) {
      if (!fhBySlug.has(r.slug)) fhBySlug.set(r.slug, new Map())
      const byDate = fhBySlug.get(r.slug)!
      if (!byDate.has(r.fecha_objetivo) || r.id > byDate.get(r.fecha_objetivo).id) {
        byDate.set(r.fecha_objetivo, r)
      }
    }

    const allSlugs = slugFilter ? [slugFilter] : CIUDADES_ASIA.map(c => c.slug)
    const slugNames = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))

    // ============ 2) Build lookup: (slug, fecha_objetivo) -> FH temp_corregida ============
    const fhTc = new Map<string, number>()
    const fhReals = new Map<string, number>()
    for (const [slug, byDate] of fhBySlug) {
      for (const [fecha, r] of byDate) {
        const key = slug + '|' + fecha
        fhTc.set(key, r.temp_corregida)
        fhReals.set(key, r.temp_real)
      }
    }

    // Filter targets within daysLimit
    const validTargets = new Map<string, string[]>() // slug -> fecha[]
    for (const [key] of fhTc) {
      const [slug, fecha] = key.split('|')
      const objDate = new Date(fecha + 'T12:00:00')
      const daysAgo = Math.floor((endDate.getTime() - objDate.getTime()) / (1000 * 60 * 60 * 24))
      if (daysAgo >= 0 && daysAgo <= daysLimit) {
        if (!validTargets.has(slug)) validTargets.set(slug, [])
        validTargets.get(slug)!.push(fecha)
      }
    }

    // ============ 3) Read daily_runs: get FIRST record per (slug, fecha_objetivo) ============
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, resultados')
      .gte('fecha_ejecucion', startDate.toISOString())
      .order('fecha_ejecucion', { ascending: true } as any)

    // Map: (slug|fecha) -> first record from daily_runs
    const drFirst = new Map<string, { id: number; fecha_ejecucion: string; tc: number }>()

    for (const run of (runs as any[]) ?? []) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue

      for (const slug of allSlugs) {
        const key = slug + '|' + fo
        if (drFirst.has(key)) continue // already have first record for this pair
        if (!fhTc.has(key)) continue // not a target we care about

        const cityData = parsed.find((c: any) => c.slug === slug)
        const tc = cityData?.forecast?.temp_corregida
        if (tc != null) {
          drFirst.set(key, {
            id: run.id,
            fecha_ejecucion: run.fecha_ejecucion,
            tc: Number(tc),
          })
        }
      }
    }

    if (drFirst.size === 0) return res.status(200).json({ ciudades: {} })

    // ============ 4) Compute mejora corrections from FH (same as mejora-continua) ============
    const slugCorrections = new Map<string, Map<string, number>>()

    for (const [slug, records] of fhBySlug) {
      const sorted = Array.from(records.values()).sort((a, b) =>
        a.fecha_objetivo.localeCompare(b.fecha_objetivo)
      )
      try {
        const result = computeAllMejoras(sorted, slugNames.get(slug) || slug)
        const corrections = new Map<string, number>()
        for (const d of result.dailyResults) {
          corrections.set(d.fecha, d.combinado.temp - d.temp_corregida)
        }
        slugCorrections.set(slug, corrections)
      } catch (e) {
        console.error('Error computing mejora for', slug, e)
      }
    }

    // ============ 5) Build results ============
    const ciudades: Record<string, NowcastCityResult> = {}

    for (const [slug, fechas] of validTargets) {
      const resultDays: NowcastDay[] = []
      const corrections = slugCorrections.get(slug) || new Map()

      for (const fecha of fechas) {
        const key = slug + '|' + fecha
        const first = drFirst.get(key)
        if (!first) continue

        const tcFirst = first.tc
        const tcLast = fhTc.get(key)!
        const tempReal = fhReals.get(key) ?? null

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
          hora_11pm: null,
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
