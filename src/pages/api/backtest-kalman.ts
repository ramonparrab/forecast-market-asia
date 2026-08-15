import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { PipelineStep } from '@/lib/mejora-continua-engine'
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
  cur_10pm: number | null
  cur_11pm: number | null
  cur_err_10pm: number | null
  cur_err_11pm: number | null
  cur_gana: '10PM' | '11PM' | '10PM/11PM' | null
  kal_10pm: number | null
  kal_11pm: number | null
  kal_err_10pm: number | null
  kal_err_11pm: number | null
  kal_gana: '10PM' | '11PM' | '10PM/11PM' | null
  mejor: 'actual' | 'kalman' | 'empate' | null
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
 * Computa la prediccion del modelo perdedor desde la base del ensemble.
 * station_bias = media simple de errores historicos
 * kalman_bias = filtro de Kalman 1D sobre mismos errores
 */
function computeAltPrediction(
  base: number,
  walkForwardErrors: number[]
  isKalman: boolean
): number | null {
  if (!walkForwardErrors || walkForwardErrors.length < 3) return null

  if (isKalman) {
    const R = estimateKalmanR(walkForwardErrors)
    const bias = kalmanNextBias(walkForwardErrors, KALMAN_Q, R)
    return round2(base + bias)
  } else {
    const bias = walkForwardErrors.reduce((s, e) => s + e, 0) / walkForwardErrors.length
    return round2(base + bias)
  }
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

    // ============ 1) forecast_history completa ============
    // Necesitamos: temp_pronosticada (base ensemble), temp_corregida (ganador),
    // temp_real, error, run_type
    const fhWhere = slugFilter
      ? (q: any) => q.eq('slug', slugFilter).gte('fecha_objetivo', startDate.toISOString())
      : (q: any) => q.gte('fecha_objetivo', startDate.toISOString())

    const { data: fhAll } = await client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_real, temp_pronosticada, temp_corregida, error, run_type')
      .gte('fecha_objetivo', startDate.toISOString())
      .order('fecha_objetivo', { ascending: true } as any)
      .limit(10000)

    // ============ 2) forecast_snapshot: modelo_ganador por (slug, fecha, run_type) ============
    const { data: snapshots } = await client
      .from('forecast_snapshot' as any)
      .select('slug, fecha_objetivo, modelo_ganador, run_type_ganadora')
      .gte('fecha_objetivo', startDate.toISOString())
    const snapModelo: Record<string, Record<string, string>> = {}
    for (const s of (snapshots as any[]) ?? []) {
      const k = s.slug + '|' + s.fecha_objetivo + '|' + s.run_type_ganadora
      snapModelo[k] = s.modelo_ganador
    }

    // ============ 3) Build walk-forward errors y Kalman metadata ============
    const baseBySlugFecha: Record<string, number> = {}  // slug|fecha -> temp_pronosticada
    const walkForward: Record<string, number[]> = {}       // slug|fecha -> errors anteriores
    const slugKalMeta: Record<string, { q: number; r: number; ultimo_bias: number }> = {}
    const errorsBySlug: Record<string, { fecha: string; error: number; base: number }[]> = {}

    for (const r of (fhAll as any[]) ?? []) {
      const base = r.temp_pronosticada
      if (base == null) continue
      const slug = r.slug as string
      const fecha = r.fecha_objetivo as string
      if (!baseBySlugFecha[slug]) baseBySlugFecha[slug] = {}
      baseBySlugFecha[slug][fecha] = base
      if (!errorsBySlug[slug]) errorsBySlug[slug] = []
      errorsBySlug[slug].push({ fecha, error: r.error, base })
    }
    for (const slug of allSlugs) {
      const items = (errorsBySlug[slug] || []).sort((a, b) => a.fecha.localeCompare(b.fecha))
      const errors = items.map(i => i.error)
      // Walk-forward errors
      for (let i = 0; i < items.length; i++) {
        walkForward[slug + '|' + items[i].fecha] = items.slice(0, i).map(x => x.error)
      }
      // Kalman meta
      if (errors.length >= 5) {
        const R = estimateKalmanR(errors)
        const ultimoBias = kalmanNextBias(errors, KALMAN_Q, R)
        slugKalMeta[slug] = { q: KALMAN_Q, r: round2(R), ultimo_bias: round2(ultimoBias) }
      } else {
        slugKalMeta[slug] = { q: KALMAN_Q, r: 1.65, ultimo_bias: 0 }
      }
    }

    // ============ 4) Para cada (slug, fecha_objetivo) con temp_real, computar ambos modelos ============
    // Usar temp_pronosticada como base (ensemble crudo, sin sesgo) y
    // walk-forward errors para calcular las correcciones de MC y Kalman.
    const resultadoPorFecha: Record<string, {
      fecha: string, real: number,
      modelo_10pm: string | null, modelo_11pm: string | null,
      ganadorTemp_10pm: number | null, ganadorTemp_11pm: number | null,
      cur_10pm: number | null, cur_11pm: number | null,
      kal_10pm: number | null, kal_11pm: number | null,
    }> = {}

    for (const r of (fhAll as any[]) ?? []) {
      if (r.temp_real == null) continue
      const slug = r.slug as string
      const fecha = r.fecha_objetivo as string
      const key = slug + '|' + fecha
      const prev = resultadoPorFecha[key]
      if (!prev || r.id > prev.id) {
        const modeloGanador = snapModelo[key + '|' + (r.run_type || '11PM')] ?? null
        const base = baseBySlugFecha[slug]?.[fecha]
        if (base == null) continue
        const wfKey = slug + '|' + fecha
        const wfErrors = walkForward[wfKey] || []

        const modeloEsKalman = modeloGanador === 'KALMAN'
        const modeloGanador10 = snapModelo[key + '|10PM'] ?? modeloGanador
        const modeloGanador11 = snapModelo[key + '|11PM'] ?? modeloGanador

        // Ganador temp: el temp_corregida del registro (ya corregido por el modelo ganador)
        const ganadorTemp = r.temp_corregida
        // Perdedor temp: computado desde la base ensemble + bias del otro modelo
        const perdedorTemp = computeAltPrediction(base, wfErrors, !modeloEsKalman)

        if (prev.modelo_ganador_10pm === modeloGanador10 || !prev.modelo_ganador_10pm) {
          resultadoPorFecha[key] = {
            fecha, real: r.temp_real,
            modelo_10pm: modeloGanador10,
            modelo_11pm: modeloGanador11,
            ganadorTemp_10pm: ganadorTemp,
            ganadorTemp_11pm: ganadorTemp,
            cur_10pm: modeloEsKalman ? perdedorTemp : ganadorTemp,
            cur_11pm: modeloEsKalman ? perdedorTemp : ganadorTemp,
            kal_10pm: modeloEsKalman ? ganadorTemp : perdedorTemp,
            kal_11pm: modeloEsKalman ? ganadorTemp : perdedorTemp,
          }
        }
      }
    }

    // ============ 5) Metadata del modelo actual (de forecast_snapshot) ============
    const slugModelo: Record<string, string> = {}
    for (const [k, modelos] of Object.entries(snapModelo)) {
      // Preferir 11PM si existe, sino la primera disponible
      slugModelo[k] = modelos['11PM'] || modelos['10PM'] || ''
    }
    // Pendientes
    const pendingSet = new Set<string>()
    for (const r of (fhAll as any[]) ?? []) {
      if (r.temp_real == null) pendingSet.add(r.slug + '|' + r.fecha_objetivo)
    }
    const validFechas: Record<string, string[]> = {}
    for (const [k] of Object.keys(resultadoPorFecha)) {
      const [slug, fecha] = k.split('|')
      const daysAgo = Math.floor((endDate.getTime() - new Date(fecha + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
      if (daysAgo >= -1 && daysAgo <= daysLimit) {
        if (!validFechas[slug]) validFechas[slug] = []
        validFechas[slug].push(fecha)
      }
    }
    for (const key of pendingSet) {
      const [slug, fecha] = key.split('|')
      if (!validFechas[slug]) validFechas[slug] = []
      validFechas[slug].push(fecha)
    }

    // ============ 6) Construir resultados finales ============
    const ciudades: Record<string, KalmanCityResult> = {}

    for (const [slug, fechas] of Object.entries(validFechas)) {
      const resultDays: KalmanDay[] = []
      for (const fecha of fechas) {
        const key = slug + '|' + fecha
        const d = resultadoPorFecha[key]
        if (!d) continue

        const tempReal = d.real
        const modelo10 = d.modelo_10pm
        const modelo11 = d.modelo_11pm
        const ganadorTemp10 = d.ganadorTemp_10pm
        const ganadorTemp11 = d.ganadorTemp_11pm
        const cur10 = d.cur_10pm
        const cur11 = d.cur_11pm
        const kal10 = d.kal_10pm
        const kal11 = d.kal_11pm

        let curErr10: number | null = null
        let curErr11: number | null = null
        let kalErr10: number | null = null
        let kalErr11: number | null = null
        let curGana: KalmanDay['cur_gana'] = null
        let kalGana: KalmanDay['kal_gana'] = null
        let mejor: KalmanDay['mejor'] = null
        const estable = (cur10 != null && kal10 != null) || (cur11 != null && kal11 != null)

        if (tempReal !== null) {
          if (cur10 !== null) curErr10 = round2(Math.abs(cur10 - tempReal))
          if (cur11 !== null) curErr11 = round2(Math.abs(cur11 - tempReal))
          if (kal10 !== null) kalErr10 = round2(Math.abs(kal10 - tempReal))
          if (kal11 !== null) kalErr11 = round2(Math.abs(kal11 - tempReal))
          const rReal = roundInt(tempReal)
          curGana = ganaDe(
            cur10 !== null && roundInt(cur10) === rReal,
            cur11 !== null && roundInt(cur11) === rReal
          )
          kalGana = ganaDe(
            kal10 !== null && roundInt(kal10) === rReal,
            kal11 !== null && roundInt(kal11) === rReal
          )
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
          hora_10pm: modelo10 ? modelo10 : null,
          hora_11pm: modelo11 ? modelo11 : null,
          modelo_ganador_10pm: modelo10,
          modelo_ganador_11pm: modelo11,
          cur_10pm: cur10, cur_11pm: cur11,
          cur_err_10pm: curErr10, cur_err_11pm: curErr11,
          cur_gana: curGana,
          kal_10pm: kal10, kal_11pm: kal11,
          kal_err_10pm: kalErr10, kal_err_11pm: kalErr11,
          kal_gana: kalGana,
          mejor, estable,
        })
      }

      if (resultDays.length === 0) continue
      resultDays.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

      let curMae = 0, kalMae = 0, cntErr = 0
      let curHits = 0, kalHits = 0
      let cur10c = 0, cur11c = 0, curAmbos = 0
      let kal10c = 0, kal11c = 0, kalAmbos = 0
      let pendientes = 0

      for (const day of resultDays) {
        if (day.temp_real === null) { pendientes++; continue }
        const curRef = day.cur_err_11pm !== null ? day.cur_err_11pm : day.cur_err_10pm
        const kalRef = day.kal_err_11pm !== null ? day.kal_err_11pm : day.kal_err_10pm
        if (curRef !== null && kalRef !== null) {
          curMae += curRef
          kalMae += kalRef
          cntErr++
        }
        if (day.cur_gana) {
          curHits++
          if (day.cur_gana === '10PM/11PM') curAmbos++
          else if (day.cur_gana === '10PM') cur10c++
          else cur11c++
        }
        if (day.kal_gana) {
          kalHits++
          if (day.kal_gana === '10PM/11PM') kalAmbos++
          else if (day.kal_gana === '10PM') kal10c++
          else kal11c++
        }
      }

      ciudades[slug] = {
        slug,
        nombre: slugNames[slug] || slug,
        modelo_actual: slugModelo[slug] || '',
        pipeline_actual: [],
        kalman: slugKalMeta[slug] || { q: KALMAN_Q, r: 1.65, ultimo_bias: 0 },
        days: resultDays,
        cur_mae: cntErr > 0 ? round2(curMae / cntErr) : null,
        kal_mae: cntErr > 0 ? round2(kalMae / cntErr) : null,
        cur_hits: curHits, kal_hits: kalHits,
        cur_gana_10pm: cur10c, cur_gana_11pm: cur11c, cur_ambos: curAmbos,
        kal_gana_10pm: kal10c, kal_gana_11pm: kal11c, kal_ambos: kalAmbos,
        total_dias: resultDays.filter(d => d.temp_real !== null).length,
        pendientes,
      }
    }

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
