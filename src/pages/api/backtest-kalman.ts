import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeAllMejoras, PipelineStep } from '@/lib/mejora-continua-engine'
import { kalmanNextBias, estimateKalmanR, KALMAN_Q } from '@/lib/kalman-engine'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export interface KalmanDay {
  fecha_objetivo: string
  temp_real: number | null
  hora_10pm: string | null
  hora_11pm: string | null
  modelo_ganador_10pm: string | null
  modelo_ganador_11pm: string | null
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
  /** true si los valores vienen de snapshots guardados (estables) */
  estable: boolean
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

/**
 * Extrae de un daily_run parseado los valores cur (MC) y kal (Kalman)
 * usando los snapshots GUARDADOS (temp_corregida = ganador, temp_corregida_alt = perdedor).
 * Esto hace que los valores sean ESTABLES — no se recalculan.
 */
function extractModelValues(cityData: any): {
  cur: number | null      // MC prediction
  kal: number | null      // Kalman prediction
  modelo_ganador: string | null
} {
  if (!cityData?.forecast) return { cur: null, kal: null, modelo_ganador: null }
  const f = cityData.forecast
  const ganador = f.modelo_activo ?? null
  const ganadorTemp = f.temp_corregida ?? null
  const perdedorTemp = f.temp_corregida_alt ?? null

  if (ganador === 'MEJORA CONTINUA') {
    return { cur: ganadorTemp, kal: perdedorTemp, modelo_ganador: ganador }
  } else if (ganador === 'KALMAN') {
    return { cur: perdedorTemp, kal: ganadorTemp, modelo_ganador: ganador }
  }
  // Sin modelo_activo (datos antiguos): usar temp_corregida como referencia
  return { cur: ganadorTemp, kal: ganadorTemp, modelo_ganador: null }
}

interface RunSnapshot {
  id: number
  fecha_ejecucion: string
  cur: number | null
  kal: number | null
  modelo_ganador: string | null
  dist: number
}

export async function computeBacktestKalman(daysLimit: number, slugFilter: string = ''): Promise<Record<string, KalmanCityResult>> {
  try {
    const client = createClient(supabaseUrl, supabaseKey)

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysLimit - 3)

    const allSlugs = slugFilter ? [slugFilter] : CIUDADES_ASIA.map(c => c.slug)
    const slugNames: Record<string, string> = {}
    CIUDADES_ASIA.forEach((c: any) => { slugNames[c.slug] = c.nombre })

    // ============ 1) forecast_history: solo para temp_real ============
    let fhQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_real')
      .not('temp_real', 'is', null as any)

    if (slugFilter) {
      fhQuery = fhQuery.eq('slug', slugFilter)
    }

    const { data: fhRecords } = await fhQuery
    // Lookup: (slug|fecha) -> { real, id } para ficar el último
    const realMap: Record<string, { real: number; id: number }> = {}
    for (const r of (fhRecords as any[]) ?? []) {
      const key = r.slug + '|' + r.fecha_objetivo
      const prev = realMap[key]
      if (!prev || r.id > prev.id) {
        realMap[key] = { real: r.temp_real, id: r.id }
      }
    }

    // ============ 2) forecast_history pendientes (para mostrar días futuros) ============
    let fhPendQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo')
      .is('temp_real', null as any)
    if (slugFilter) {
      fhPendQuery = fhPendQuery.eq('slug', slugFilter)
    }
    const { data: fhPending } = await fhPendQuery
    const pendingSet = new Set<string>()
    for (const r of (fhPending as any[]) ?? []) {
      pendingSet.add(r.slug + '|' + r.fecha_objetivo)
    }

    // ============ 3) daily_runs: EXTRAER SNAPSHOTS GUARDADOS ============
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, resultados, run_type')
      .gte('fecha_ejecucion', startDate.toISOString())
      .order('fecha_ejecucion', { ascending: true } as any)

    // Para cada (slug|fecha), guardar la corrida 10PM y 11PM por separado
    const run10pm: Record<string, RunSnapshot> = {}
    const run11pm: Record<string, RunSnapshot> = {}
    // También un mapa de TODAS las corridas para obtener fechas válidas
    const allRunKeys = new Set<string>()

    for (const run of (runs as any[]) ?? []) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue

      const cronTs10 = new Date(fo + 'T02:00:00.000Z').getTime()
      const cronTs11 = new Date(fo + 'T03:00:00.000Z').getTime()
      const runTs = new Date(run.fecha_ejecucion).getTime()

      for (const slug of allSlugs) {
        const key = slug + '|' + fo
        allRunKeys.add(key)

        const cityData = parsed.find((c: any) => c.slug === slug)
        if (!cityData) continue

        const { cur, kal, modelo_ganador } = extractModelValues(cityData)
        if (cur == null && kal == null) continue

        const entry: RunSnapshot = {
          id: run.id,
          fecha_ejecucion: run.fecha_ejecucion,
          cur,
          kal,
          modelo_ganador,
          dist: 0,
        }

        // Determinar si es corrida 10PM o 11PM
        // 10PM Caracas = 02:00Z, 11PM Caracas = 03:00Z
        // Usar run_type si está disponible, sino inferir por timestamp
        const rt = run.run_type
        if (rt === '10PM' || (!rt && runTs >= cronTs10 && runTs < cronTs11 + 30 * 60 * 1000)) {
          const dist = Math.abs(runTs - cronTs10)
          const prev = run10pm[key]
          if (!prev || dist < prev.dist) {
            run10pm[key] = { ...entry, dist }
          }
        } else if (rt === '11PM' || (!rt && runTs >= cronTs11 - 30 * 60 * 1000)) {
          const dist = Math.abs(runTs - cronTs11)
          const prev = run11pm[key]
          if (!prev || dist < prev.dist) {
            run11pm[key] = { ...entry, dist }
          }
        }
      }
    }

    if (Object.keys(run10pm).length === 0 && Object.keys(run11pm).length === 0) return {}

    // ============ 4) Fechas válidas ============
    const validTargets: Record<string, string[]> = {}
    const addFecha = (slug: string, fecha: string) => {
      if (!validTargets[slug]) validTargets[slug] = []
      if (validTargets[slug].indexOf(fecha) === -1) validTargets[slug].push(fecha)
    }
    for (const key of allRunKeys) {
      const [slug, fecha] = key.split('|')
      const daysAgo = Math.floor((endDate.getTime() - new Date(fecha + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
      if (daysAgo >= -1 && daysAgo <= daysLimit) {
        addFecha(slug, fecha)
      }
    }
    // Agregar pendientes
    for (const key of pendingSet) {
      const [slug, fecha] = key.split('|')
      addFecha(slug, fecha)
    }

    // ============ 5) Metadata del modelo actual (última corrida) ============
    const slugModelo: Record<string, string> = {}
    const slugPipeline: Record<string, PipelineStep[]> = {}
    const slugKalMeta: Record<string, { q: number; r: number; ultimo_bias: number }> = {}

    // Obtener modelo y pipeline de la última corrida
    const lastRuns = (runs as any[])?.filter((r: any) => r.fecha_objetivo)
    if (lastRuns?.length) {
      // Tomar la última corrida global
      const latestRun = lastRuns[lastRuns.length - 1]
      let latestParsed: any[]
      try { latestParsed = JSON.parse(latestRun.resultados) } catch { /* ignore */ }
      if (Array.isArray(latestParsed)) {
        for (const slug of allSlugs) {
          const cityData = latestParsed.find((c: any) => c.slug === slug)
          if (cityData?.forecast?.modelo_activo) {
            slugModelo[slug] = cityData.forecast.modelo_activo
          }
        }
      }
    }

    // Kalman meta: calcular del historical (solo para info actual)
    const { data: allFhForKalman } = await client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, error, temp_real')
      .not('error', 'is', null as any)
      .order('fecha_objetivo', { ascending: true } as any)
      .limit(5000)

    if (allFhForKalman) {
      const bySlug: Record<string, number[]> = {}
      for (const r of allFhForKalman as any[]) {
        if (!bySlug[r.slug]) bySlug[r.slug] = []
        bySlug[r.slug].push(r.error)
      }
      for (const slug of allSlugs) {
        const errors = bySlug[slug] || []
        if (errors.length >= 5) {
          const R = estimateKalmanR(errors)
          const ultimoBias = kalmanNextBias(errors, KALMAN_Q, R)
          slugKalMeta[slug] = { q: KALMAN_Q, r: round2(R), ultimo_bias: round2(ultimoBias) }
        } else {
          slugKalMeta[slug] = { q: KALMAN_Q, r: 1.65, ultimo_bias: 0 }
        }
      }
    }

    // ============ 6) Resultados finales — VALORES ESTABLES desde snapshots ============
    const ciudades: Record<string, KalmanCityResult> = {}

    Object.keys(validTargets).forEach(slug => {
      const fechas = validTargets[slug]
      const resultDays: KalmanDay[] = []

      for (let fi = 0; fi < fechas.length; fi++) {
        const fecha = fechas[fi]
        const key = slug + '|' + fecha
        const r10 = run10pm[key]
        const r11 = run11pm[key]
        const tempReal = realMap[key]?.real ?? null

        // Necesitamos al menos una corrida
        if (!r10 && !r11) continue

        const cur10 = r10?.cur ?? null
        const cur11 = r11?.cur ?? null
        const kal10 = r10?.kal ?? null
        const kal11 = r11?.kal ?? null

        let curErr10: number | null = null
        let curErr11: number | null = null
        let kalErr10: number | null = null
        let kalErr11: number | null = null
        let curGana: KalmanDay['cur_gana'] = null
        let kalGana: KalmanDay['kal_gana'] = null
        let mejor: KalmanDay['mejor'] = null

        // Verificar si tenemos valores estables (ambos modelos guardados)
        const estable = (r10?.cur != null && r10?.kal != null) || (r11?.cur != null && r11?.kal != null)

        if (tempReal !== null) {
          if (cur10 !== null) curErr10 = round2(Math.abs(cur10 - tempReal))
          if (cur11 !== null) curErr11 = round2(Math.abs(cur11 - tempReal))
          if (kal10 !== null) kalErr10 = round2(Math.abs(kal10 - tempReal))
          if (kal11 !== null) kalErr11 = round2(Math.abs(kal11 - tempReal))

          const rReal = roundInt(tempReal)
          curGana = ganaDe(cur10 !== null && roundInt(cur10) === rReal, cur11 !== null && roundInt(cur11) === rReal)
          kalGana = ganaDe(kal10 !== null && roundInt(kal10) === rReal, kal11 !== null && roundInt(kal11) === rReal)

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
          hora_10pm: r10?.fecha_ejecucion ?? null,
          hora_11pm: r11?.fecha_ejecucion ?? null,
          modelo_ganador_10pm: r10?.modelo_ganador ?? null,
          modelo_ganador_11pm: r11?.modelo_ganador ?? null,
          cur_10pm: cur10,
          cur_11pm: cur11,
          cur_err_10pm: curErr10,
          cur_err_11pm: curErr11,
          cur_gana: curGana,
          kal_10pm: kal10,
          kal_11pm: kal11,
          kal_err_10pm: kalErr10,
          kal_err_11pm: kalErr11,
          kal_gana: kalGana,
          mejor,
          estable,
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

    return ciudades
  } catch (error) {
    console.error('[backtest-kalman]', error)
    throw error
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const daysLimit = parseInt(req.query.dias as string || '60') || 60
    const slugFilter = (req.query.ciudad as string || '').trim()
    const ciudades = await computeBacktestKalman(daysLimit, slugFilter)
    return res.status(200).json({ ciudades })
  } catch (error) {
    console.error('[backtest-kalman]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
