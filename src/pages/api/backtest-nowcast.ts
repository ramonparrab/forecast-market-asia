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
  pred_gana?: '10PM' | '11PM' | null
  pred_acierto?: boolean | null
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

function roundInt(v: number): number {
  return Math.round(v + 0.05)
}

function computeRecommendation(
  tc10: number,
  tc11: number,
  fecha_objetivo: string,
  slug: string,
  prevReal: number | null,
): '10PM' | '11PM' | null {
  if (slug !== 'chongqing') return null

  const diff = tc11 - tc10
  const month = parseInt(fecha_objetivo.substring(5, 7), 10)
  const trend = prevReal != null ? tc10 - prevReal : null

  // Non-Jul/Aug: always 11PM
  if (month !== 7 && month !== 8) return '11PM'

  // Julio/Agosto:
  // |diff| < 0.3 → modelo estable, 10PM gana 70%
  if (Math.abs(diff) < 0.3) return '10PM'
  // diff > 1.5 → calentamiento rápido, 11PM gana 80%
  if (diff > 1.5) return '11PM'
  // tc10 >= 36 y 11PM cooler → depende de tendencia vs ayer
  if (tc10 >= 36 && diff < -0.3 && trend !== null) {
    if (trend > 0.5) return '10PM' // modelo calienta, 10PM alcanza
    return '11PM' // estable/enfría, 11PM corrige sesgo cálido
  }
  if (tc10 >= 36 && diff < -0.3) return '11PM'
  // Default Julio: 10PM
  return '10PM'
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
    const slugNames: Record<string, string> = {}
    CIUDADES_ASIA.forEach((c: any) => { slugNames[c.slug] = c.nombre })

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
    const fhBySlug: Record<string, { historical: any[]; pending: any | null }> = {}
    for (const r of allFh as any[]) {
      if (!fhBySlug[r.slug]) fhBySlug[r.slug] = { historical: [], pending: null }
      const bucket = fhBySlug[r.slug]
      if (r.temp_real != null) {
        bucket.historical.push(r)
      } else {
        if (!bucket.pending || r.id > bucket.pending.id) {
          bucket.pending = r
        }
      }
    }

    // ============ 2) Build FH lookup: (slug|fecha) -> { tc, real } ============
    const fhMap: Record<string, { tc: number; real: number | null }> = {}
    const slugPending: Record<string, { fecha: string; tc: number }> = {}

    Object.keys(fhBySlug).forEach(slug => {
      const bucket = fhBySlug[slug]
      // Deduplicate historical: keep latest id per target
      const seen: Record<string, any> = {}
      bucket.historical.forEach((r: any) => {
        if (!seen[r.fecha_objetivo] || r.id > seen[r.fecha_objetivo].id) {
          seen[r.fecha_objetivo] = r
        }
      })
      Object.keys(seen).forEach(fecha => {
        fhMap[slug + '|' + fecha] = { tc: seen[fecha].temp_corregida, real: seen[fecha].temp_real }
      })
      if (bucket.pending) {
        slugPending[slug] = { fecha: bucket.pending.fecha_objetivo, tc: bucket.pending.temp_corregida }
      }
    })

    // Filter by daysLimit
    const validTargets: Record<string, string[]> = {}
    Object.keys(fhMap).forEach(key => {
      const [slug, fecha] = key.split('|')
      const daysAgo = Math.floor((endDate.getTime() - new Date(fecha + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
      if (daysAgo >= 0 && daysAgo <= daysLimit) {
        if (!validTargets[slug]) validTargets[slug] = []
        validTargets[slug].push(fecha)
      }
    })
    // Also include pending targets
    Object.keys(slugPending).forEach(slug => {
      const p = slugPending[slug]
      if (!validTargets[slug]) validTargets[slug] = []
      if (validTargets[slug].indexOf(p.fecha) === -1) {
        fhMap[slug + '|' + p.fecha] = { tc: p.tc, real: null }
        validTargets[slug].push(p.fecha)
      }
    })

    // ============ 3) Read daily_runs first record per (slug, fecha) ============
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, resultados')
      .gte('fecha_ejecucion', startDate.toISOString())
      .order('fecha_ejecucion', { ascending: true } as any)

    const drFirst: Record<string, { id: number; fecha_ejecucion: string; tc: number }> = {}

    for (const run of (runs as any[]) ?? []) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue

      for (let si = 0; si < allSlugs.length; si++) {
        const slug = allSlugs[si]
        const key = slug + '|' + fo
        if (!fhMap[key]) continue
        if (drFirst[key]) continue

        const cityData = parsed.find((c: any) => c.slug === slug)
        const tc = cityData?.forecast?.temp_corregida
        if (tc == null) continue
        drFirst[key] = { id: run.id, fecha_ejecucion: run.fecha_ejecucion, tc: Number(tc) }
      }
    }

    if (Object.keys(drFirst).length === 0) return res.status(200).json({ ciudades: {} })

    // ============ 4) Compute corrections using mejora-continua engine ============
    const slugCorrections: Record<string, Record<string, number>> = {}

    Object.keys(fhBySlug).forEach(slug => {
      const bucket = fhBySlug[slug]
      if (bucket.historical.length === 0) return

      // Deduplicate historical (keep latest id per target)
      const seen: Record<string, any> = {}
      bucket.historical.forEach((r: any) => {
        if (!seen[r.fecha_objetivo] || r.id > seen[r.fecha_objetivo].id) {
          seen[r.fecha_objetivo] = r
        }
      })
      const sorted = Object.keys(seen).sort().map(f => seen[f])

      const corrections: Record<string, number> = {}

      // computeAllMejoras for historical dates
      try {
        const result = computeAllMejoras(sorted, slugNames[slug] || slug)
        for (let di = 0; di < result.dailyResults.length; di++) {
          const d = result.dailyResults[di]
          corrections[d.fecha] = d.combinado.temp - d.temp_corregida
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
          } as any, slugNames[slug] || slug)
          if (cf) {
            corrections[bucket.pending.fecha_objetivo] = cf.combinado - bucket.pending.temp_corregida
          }
        } catch (e) {
          console.error('Error computing current forecast for', slug, e)
        }
      }

      slugCorrections[slug] = corrections
    })

    // ============ 5) Build final results ============
    const ciudades: Record<string, NowcastCityResult> = {}

    Object.keys(validTargets).forEach(slug => {
      const fechas = validTargets[slug]
      const resultDays: NowcastDay[] = []
      const corrections = slugCorrections[slug] || {}

      for (let fi = 0; fi < fechas.length; fi++) {
        const fecha = fechas[fi]
        const key = slug + '|' + fecha
        const first = drFirst[key]
        const fhVal = fhMap[key]
        if (!first || !fhVal) continue

        const tcFirst = first.tc
        const tcLast = fhVal.tc
        const tempReal = fhVal.real

        const correction = corrections[fecha] ?? 0
        const combFirst = tcFirst + correction
        const combLast = tcLast + correction

        let errorFirst: number | null = null
        let errorLast: number | null = null
        let gana: NowcastDay['gana'] = null

        if (tempReal !== null) {
          errorFirst = round2(Math.abs(combFirst - tempReal))
          errorLast = round2(Math.abs(combLast - tempReal))

          const rReal = roundInt(tempReal)
          const r10 = roundInt(combFirst)
          const r11 = roundInt(combLast)
          const a10 = r10 === rReal
          const a11 = r11 === rReal

          if (a10 && a11) {
            gana = 'EMPATE'
          } else if (a10 && !a11) {
            gana = '10PM'
          } else if (!a10 && a11) {
            gana = '11PM'
          } else {
            gana = null
          }
        }

        const [pY, pM, pD] = fecha.split('-').map(Number)
        const prevDate = new Date(pY, pM - 1, pD - 1)
        const prevKey = slug + '|' + prevDate.getFullYear() + '-' +
          String(prevDate.getMonth() + 1).padStart(2, '0') + '-' +
          String(prevDate.getDate()).padStart(2, '0')
        const prevFhVal = fhMap[prevKey]
        const prevReal = prevFhVal?.real ?? null
        const predGana = computeRecommendation(tcFirst, tcLast, fecha, slug, prevReal)
        let predAcierto: boolean | null = null
        if (predGana && gana) {
          predAcierto = predGana === gana
        } else if (predGana && gana === null && tempReal !== null) {
          predAcierto = false
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
          pred_gana: predGana || undefined,
          pred_acierto: predAcierto ?? undefined,
        })
      }

      if (resultDays.length === 0) return

      resultDays.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

      let g10 = 0, g11 = 0, emp = 0
      let sumErr10 = 0, sumErr11 = 0, countErr = 0

      for (let di = 0; di < resultDays.length; di++) {
        const d = resultDays[di]
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
        nombre: slugNames[slug] || slug,
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
