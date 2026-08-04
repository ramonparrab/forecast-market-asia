import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeAllMejoras, computeCurrentForecast, PipelineStep } from '@/lib/mejora-continua-engine'
import { kalmanBiasPredictions, kalmanNextBias, estimateKalmanR, KALMAN_Q } from '@/lib/kalman-engine'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export interface KalmanDay {
  fecha_objetivo: string
  temp_real: number | null
  hora_10pm: string | null
  // Modelo actual (mejora continua)
  cur_10pm: number | null
  cur_11pm: number | null
  cur_err_10pm: number | null
  cur_err_11pm: number | null
  cur_gana: '10PM' | '11PM' | '10PM/11PM' | null
  // Modelo Kalman 1D
  kal_10pm: number | null
  kal_11pm: number | null
  kal_err_10pm: number | null
  kal_err_11pm: number | null
  kal_gana: '10PM' | '11PM' | '10PM/11PM' | null
  // Qué modelo quedó más cerca del real (referencia: 11PM, si no 10PM)
  mejor: 'actual' | 'kalman' | 'empate' | null
}

export interface KalmanCityResult {
  slug: string
  nombre: string
  modelo_actual: string
  pipeline_actual: PipelineStep[]
  kalman: { q: number; r: number; ultimo_bias: number }
  days: KalmanDay[]
  cur_mae: number | null
  kal_mae: number | null
  cur_hits: number
  kal_hits: number
  cur_gana_10pm: number
  cur_gana_11pm: number
  cur_ambos: number
  kal_gana_10pm: number
  kal_gana_11pm: number
  kal_ambos: number
  total_dias: number
  pendientes: number
}

export interface BacktestKalmanResponse {
  ciudades: Record<string, KalmanCityResult>
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function roundInt(v: number): number {
  return Math.round(v + 0.05)
}

function ganaDe(a10: boolean, a11: boolean): KalmanDay['cur_gana'] {
  if (a10 && a11) return '10PM/11PM'
  if (a10 && !a11) return '10PM'
  if (!a10 && a11) return '11PM'
  return null
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

    // ============ 1) forecast_history (con y sin temp_real) ============
    let fhQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_corregida, temp_real, error')

    if (slugFilter) {
      fhQuery = fhQuery.eq('slug', slugFilter)
    }
    fhQuery = fhQuery.order('fecha_objetivo', { ascending: true } as any)

    const { data: allFh } = await fhQuery
    if (!allFh || allFh.length === 0) return res.status(200).json({ ciudades: {} })

    const fhBySlug: Record<string, { historical: any[]; pending: any[] }> = {}
    for (const r of allFh as any[]) {
      if (!fhBySlug[r.slug]) fhBySlug[r.slug] = { historical: [], pending: [] }
      const bucket = fhBySlug[r.slug]
      if (r.temp_real != null) {
        bucket.historical.push(r)
      } else {
        bucket.pending.push(r)
      }
    }

    // ============ 2) Lookup (slug|fecha) -> { tc, real } (último id por fecha) ============
    const fhMap: Record<string, { tc: number; real: number | null }> = {}

    Object.keys(fhBySlug).forEach(slug => {
      const bucket = fhBySlug[slug]
      const seen: Record<string, any> = {}
      bucket.historical.forEach((r: any) => {
        if (!seen[r.fecha_objetivo] || r.id > seen[r.fecha_objetivo].id) {
          seen[r.fecha_objetivo] = r
        }
      })
      Object.keys(seen).forEach(fecha => {
        fhMap[slug + '|' + fecha] = { tc: seen[fecha].temp_corregida, real: seen[fecha].temp_real }
      })
      const pendSeen: Record<string, any> = {}
      bucket.pending.forEach((r: any) => {
        if (!pendSeen[r.fecha_objetivo] || r.id > pendSeen[r.fecha_objetivo].id) {
          pendSeen[r.fecha_objetivo] = r
        }
      })
      Object.keys(pendSeen).forEach(fecha => {
        fhMap[slug + '|' + fecha] = { tc: pendSeen[fecha].temp_corregida, real: null }
      })
    })

    // ============ 3) Fechas válidas dentro de la ventana + pendientes ============
    const validTargets: Record<string, string[]> = {}
    Object.keys(fhMap).forEach(key => {
      const [slug, fecha] = key.split('|')
      const daysAgo = Math.floor((endDate.getTime() - new Date(fecha + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
      if (daysAgo >= 0 && daysAgo <= daysLimit) {
        if (!validTargets[slug]) validTargets[slug] = []
        if (validTargets[slug].indexOf(fecha) === -1) validTargets[slug].push(fecha)
      }
    })
    Object.keys(fhMap).forEach(key => {
      const [slug, fecha] = key.split('|')
      if (fhMap[key].real === null) {
        if (!validTargets[slug]) validTargets[slug] = []
        if (validTargets[slug].indexOf(fecha) === -1) validTargets[slug].push(fecha)
      }
    })

    // ============ 4) daily_runs: primer snapshot (10PM) ============
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
        // Usar la BASE del ensemble (temp_corregida_base) si existe: desde el deploy del
        // modelo ganador, daily_runs guarda el valor YA corregido; aquí se suma la
        // corrección MC/Kalman de nuevo, así que sin esto habría doble corrección.
        const tc = cityData?.forecast?.temp_corregida_base ?? cityData?.forecast?.temp_corregida
        if (tc == null) continue
        drFirst[key] = { id: run.id, fecha_ejecucion: run.fecha_ejecucion, tc: Number(tc) }
      }
    }

    if (Object.keys(drFirst).length === 0) return res.status(200).json({ ciudades: {} })

    // ============ 5) Correcciones: modelo actual + Kalman ============
    const slugCurCorrections: Record<string, Record<string, number>> = {}
    const slugKalCorrections: Record<string, Record<string, number>> = {}
    const slugKalMeta: Record<string, { q: number; r: number; ultimo_bias: number }> = {}
    const slugPipeline: Record<string, PipelineStep[]> = {}
    const slugModelo: Record<string, string> = {}

    Object.keys(fhBySlug).forEach(slug => {
      const bucket = fhBySlug[slug]
      if (bucket.historical.length === 0) return

      const seen: Record<string, any> = {}
      bucket.historical.forEach((r: any) => {
        if (!seen[r.fecha_objetivo] || r.id > seen[r.fecha_objetivo].id) {
          seen[r.fecha_objetivo] = r
        }
      })
      const sorted = Object.keys(seen).sort().map(f => seen[f])
      const nombre = slugNames[slug] || slug

      // --- Modelo actual (mejora continua) ---
      const curCorrections: Record<string, number> = {}
      try {
        const result = computeAllMejoras(sorted, nombre)
        slugPipeline[slug] = result.pipeline
        slugModelo[slug] = result.modelo
        for (let di = 0; di < result.dailyResults.length; di++) {
          const d = result.dailyResults[di]
          curCorrections[d.fecha] = d.combinado.temp - d.temp_corregida
        }
      } catch (e) {
        console.error('Error computing mejora for', slug, e)
      }

      // --- Kalman 1D ---
      const kalCorrections: Record<string, number> = {}
      const errors = sorted.map(r => r.error as number).filter(e => e !== null && !isNaN(e))
      const R = estimateKalmanR(errors)
      const kalPreds = kalmanBiasPredictions(errors, KALMAN_Q, R)
      // Alinear por fecha: predicción del filtro ANTES del error de ese día
      const kalByFecha: Record<string, number> = {}
      let fechaIdx = 0
      const fechasOrdenadas = Object.keys(seen).sort()
      for (const f of fechasOrdenadas) {
        kalByFecha[f] = kalPreds[fechaIdx]
        fechaIdx++
      }
      const ultimoBias = kalmanNextBias(errors, KALMAN_Q, R)
      slugKalMeta[slug] = { q: KALMAN_Q, r: round2(R), ultimo_bias: round2(ultimoBias) }

      // --- Pendientes (futuro): misma lógica que computeCurrentForecast ---
      bucket.pending.forEach((p: any) => {
        try {
          const cf = computeCurrentForecast(sorted, {
            slug,
            temp_corregida: p.temp_corregida,
            fecha_objetivo: p.fecha_objetivo,
          } as any, nombre)
          if (cf) curCorrections[p.fecha_objetivo] = cf.combinado - p.temp_corregida
        } catch (e) {
          console.error('Error computing current forecast for', slug, e)
        }
        kalCorrections[p.fecha_objetivo] = ultimoBias
      })

      // Merge: Kalman para días históricos + pendientes
      Object.keys(kalByFecha).forEach(f => { kalCorrections[f] = kalByFecha[f] })

      slugCurCorrections[slug] = curCorrections
      slugKalCorrections[slug] = kalCorrections
    })

    // ============ 6) Resultados finales ============
    const ciudades: Record<string, KalmanCityResult> = {}

    Object.keys(validTargets).forEach(slug => {
      const fechas = validTargets[slug]
      const resultDays: KalmanDay[] = []
      const curCorr = slugCurCorrections[slug] || {}
      const kalCorr = slugKalCorrections[slug] || {}

      for (let fi = 0; fi < fechas.length; fi++) {
        const fecha = fechas[fi]
        const key = slug + '|' + fecha
        const first = drFirst[key]
        const fhVal = fhMap[key]
        if (!first || !fhVal) continue

        const tcFirst = first.tc
        const tcLast = fhVal.tc
        const tempReal = fhVal.real

        const curCorrection = curCorr[fecha] ?? 0
        const kalCorrection = kalCorr[fecha] ?? 0

        const cur10 = tcFirst + curCorrection
        const cur11 = tcLast + curCorrection
        const kal10 = tcFirst + kalCorrection
        const kal11 = tcLast + kalCorrection

        let curErr10: number | null = null
        let curErr11: number | null = null
        let kalErr10: number | null = null
        let kalErr11: number | null = null
        let curGana: KalmanDay['cur_gana'] = null
        let kalGana: KalmanDay['kal_gana'] = null
        let mejor: KalmanDay['mejor'] = null

        if (tempReal !== null) {
          curErr10 = round2(Math.abs(cur10 - tempReal))
          curErr11 = round2(Math.abs(cur11 - tempReal))
          kalErr10 = round2(Math.abs(kal10 - tempReal))
          kalErr11 = round2(Math.abs(kal11 - tempReal))

          const rReal = roundInt(tempReal)
          curGana = ganaDe(roundInt(cur10) === rReal, roundInt(cur11) === rReal)
          kalGana = ganaDe(roundInt(kal10) === rReal, roundInt(kal11) === rReal)

          // Referencia para "mejor modelo": 11PM si existe, si no 10PM
          const curRef = curErr11 !== null ? curErr11 : curErr10
          const kalRef = kalErr11 !== null ? kalErr11 : kalErr10
          if (curRef !== null && kalRef !== null) {
            if (curRef < kalRef) mejor = 'actual'
            else if (kalRef < curRef) mejor = 'kalman'
            else mejor = 'empate'
          }
        }

        resultDays.push({
          fecha_objetivo: fecha,
          temp_real: tempReal,
          hora_10pm: first.fecha_ejecucion,
          cur_10pm: round2(cur10),
          cur_11pm: round2(cur11),
          cur_err_10pm: curErr10,
          cur_err_11pm: curErr11,
          cur_gana: curGana,
          kal_10pm: round2(kal10),
          kal_11pm: round2(kal11),
          kal_err_10pm: kalErr10,
          kal_err_11pm: kalErr11,
          kal_gana: kalGana,
          mejor,
        })
      }

      if (resultDays.length === 0) return
      resultDays.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

      let curMae = 0, kalMae = 0, cntErr = 0
      let curHits = 0, kalHits = 0
      let cur10c = 0, cur11c = 0, curAmbos = 0
      let kal10c = 0, kal11c = 0, kalAmbos = 0
      let pendientes = 0

      for (const d of resultDays) {
        if (d.temp_real === null) { pendientes++; continue }
        const curRef = d.cur_err_11pm !== null ? d.cur_err_11pm : d.cur_err_10pm
        const kalRef = d.kal_err_11pm !== null ? d.kal_err_11pm : d.kal_err_10pm
        if (curRef !== null && kalRef !== null) {
          curMae += curRef
          kalMae += kalRef
          cntErr++
        }
        if (d.cur_gana) {
          curHits++
          if (d.cur_gana === '10PM/11PM') curAmbos++
          else if (d.cur_gana === '10PM') cur10c++
          else cur11c++
        }
        if (d.kal_gana) {
          kalHits++
          if (d.kal_gana === '10PM/11PM') kalAmbos++
          else if (d.kal_gana === '10PM') kal10c++
          else kal11c++
        }
      }

      ciudades[slug] = {
        slug,
        nombre: slugNames[slug] || slug,
        modelo_actual: slugModelo[slug] || 'combinado_estandar',
        pipeline_actual: slugPipeline[slug] || [],
        kalman: slugKalMeta[slug] || { q: KALMAN_Q, r: 1.65, ultimo_bias: 0 },
        days: resultDays,
        cur_mae: cntErr > 0 ? round2(curMae / cntErr) : null,
        kal_mae: cntErr > 0 ? round2(kalMae / cntErr) : null,
        cur_hits: curHits,
        kal_hits: kalHits,
        cur_gana_10pm: cur10c,
        cur_gana_11pm: cur11c,
        cur_ambos: curAmbos,
        kal_gana_10pm: kal10c,
        kal_gana_11pm: kal11c,
        kal_ambos: kalAmbos,
        total_dias: resultDays.filter(d => d.temp_real !== null).length,
        pendientes,
      }
    })

    return res.status(200).json({ ciudades })
  } catch (error) {
    console.error('[backtest-kalman]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
