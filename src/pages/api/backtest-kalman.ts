import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { PipelineStep } from '@/lib/mejora-continua-engine'
import { kalmanBiasPredictions, kalmanNextBias, estimateKalmanR, KALMAN_Q, getKalmanQ } from '@/lib/kalman-engine'
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
 * Inferir run_type desde fecha_ejecucion cuando run_type es NULL.
 * 10PM Caracas = 02:00Z, 11PM Caracas = 03:00Z
 * Ventana generosa: 0-2Z → 10PM, 3-5Z → 11PM (permite retrasos del cron)
 */
function inferRunType(fechaEjecucion: string | null): '10PM' | '11PM' | null {
  if (!fechaEjecucion) return null
  const h = new Date(fechaEjecucion).getUTCHours()
  if (h >= 0 && h <= 2) return '10PM'
  if (h >= 3 && h <= 5) return '11PM'
  return null
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

    // ============ 1) Queries: forecast_snapshot + daily_runs en paralelo, forecast_history paginado ============
    // Nota: PostgREST tiene un máximo de 1000 filas por defecto. Cuando el dataset
    // supera ese límite, los registros más recientes quedan truncados y las temperaturas
    // reales de días recientes aparecen como null. Se usa paginación para evitarlo.
    const fhQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_real, temp_pronosticada, temp_corregida, error, run_type, created_at, fecha_ejecucion')
      .gte('fecha_objetivo', startDate.toISOString())
      .order('fecha_objetivo', { ascending: true } as any)
      .order('id', { ascending: true } as any)

    // Paginar forecast_history (máx 1000 por página) para capturar todos los registros
    const PAGE_SIZE = 1000
    let fhAll: any[] = []
    let pageFrom = 0
    while (true) {
      const { data: page, error: pageErr } = await fhQuery.range(pageFrom, pageFrom + PAGE_SIZE - 1)
      if (pageErr) throw pageErr
      if (!page || page.length === 0) break
      fhAll = fhAll.concat(page)
      if (page.length < PAGE_SIZE) break
      pageFrom += PAGE_SIZE
    }

    const [{ data: snapshots }, { data: dailyRuns }] = await Promise.all([
      client
        .from('forecast_snapshot' as any)
        .select('slug, fecha_objetivo, modelo_ganador, run_type_ganadora')
        .gte('fecha_objetivo', startDate.toISOString()),
      client
        .from('daily_runs' as any)
        .select('id, fecha_ejecucion, fecha_objetivo, resultados')
        .gte('fecha_ejecucion', startDate.toISOString())
        .order('fecha_ejecucion', { ascending: true } as any),
    ])

    // Mapear snapshots: modelo_ganador por (slug, fecha, run_type)
    const snapModelo: Record<string, string> = {}
    for (const s of (snapshots as any[]) ?? []) {
      const k = s.slug + '|' + s.fecha_objetivo + '|' + (s.run_type_ganadora || '')
      snapModelo[k] = s.modelo_ganador
    }

    const dailyRunBase: Record<string, number> = {} // key: "slug|fecha|10PM" o "slug|fecha|11PM"

    for (const run of (dailyRuns as any[]) ?? []) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue

      const cronTs10 = new Date(fo + 'T02:00:00.000Z').getTime()
      const cronTs11 = new Date(fo + 'T03:00:00.000Z').getTime()
      const runTs = new Date(run.fecha_ejecucion).getTime()
      // Punto de corte a los 50 min (no 30) para tolerar ejecuciones tardías del cron 10PM
      const cutoff10 = cronTs10 + 50 * 60 * 1000

      let runType: '10PM' | '11PM' | null = null
      if (runTs >= cronTs10 - 60 * 60 * 1000 && runTs < cutoff10) {
        runType = '10PM'
      } else if (runTs >= cutoff10 && runTs < cronTs11 + 90 * 60 * 1000) {
        runType = '11PM'
      }
      if (!runType) continue

      for (const slug of allSlugs) {
        const cityData = parsed.find((c: any) => c.slug === slug)
        if (!cityData?.forecast) continue
        // Usar temp_corregida_base (sin KALMAN del día de la corrida) para evitar
        // doble corrección de KALMAN en el walk-forward del backtest.
        // Fallback: temp_corregida para runs antiguos que no tienen _base.
        const base = cityData.forecast.temp_corregida_base ?? cityData.forecast.temp_corregida ?? cityData.forecast.temp_ponderada ?? null
        if (base === null) continue
        const key = slug + '|' + fo + '|' + runType
        dailyRunBase[key] = Number(base)
      }
    }

    // FALLBACK: forecast_history con run_type explícito para días donde la
    // clasificación por tiempo de daily_runs falló (crons fuera de ventana).
    // Esto recupera las temperaturas base correctas sin cambiar ningún cálculo.
    for (const r of (fhAll as any[]) ?? []) {
      const rt = r.run_type as string
      if (rt !== '10PM' && rt !== '11PM') continue
      const key = r.slug + '|' + r.fecha_objetivo + '|' + rt
      if (!dailyRunBase[key] && r.temp_pronosticada != null) {
        dailyRunBase[key] = Number(r.temp_pronosticada)
      }
    }

    // ============ 3) Build per-slug timelines ============
    // For each slug, collect ALL records sorted by fecha, id.
    // Then build walk-forward errors from the raw ensemble error (temp_real - temp_pronosticada).
    // Use one record per fecha for the walk-forward (prefer 11PM), but keep all records
    // for the day-by-day 10PM/11PM output.

    interface FhRecord {
      id: number
      slug: string
      fecha: string
      temp_real: number | null
      temp_pronosticada: number | null
      temp_corregida: number | null
      error: number | null
      run_type: string | null
      created_at: string | null
      fecha_ejecucion: string | null
    }

    const bySlug: Record<string, FhRecord[]> = {}
    for (const r of (fhAll as any[]) ?? []) {
      const slug = r.slug as string
      if (!bySlug[slug]) bySlug[slug] = []
      bySlug[slug].push({
        id: r.id,
        slug,
        fecha: r.fecha_objetivo,
        temp_real: r.temp_real,
        temp_pronosticada: r.temp_pronosticada,
        temp_corregida: r.temp_corregida,
        error: r.error,
        run_type: r.run_type,
        created_at: r.created_at,
        fecha_ejecucion: r.fecha_ejecucion,
      })
    }

    // ============ 4) Compute per-city results ============
    const ciudades: Record<string, KalmanCityResult> = {}

    for (const slug of allSlugs) {
      const records = (bySlug[slug] || []).sort((a, b) =>
        a.fecha.localeCompare(b.fecha) || a.id - b.id
      )

      if (records.length === 0) continue

      // --- 4a) Build deduplicated timeline for walk-forward errors ---
      // One record per fecha: prefer 11PM, then 10PM, then highest id
      const deduped: Map<string, FhRecord> = new Map()
      for (const r of records) {
        const prev = deduped.get(r.fecha)
        if (!prev) {
          deduped.set(r.fecha, r)
        } else {
          const pPrio = prev.run_type === '11PM' ? 2 : prev.run_type === '10PM' ? 1 : 0
          const rPrio = r.run_type === '11PM' ? 2 : r.run_type === '10PM' ? 1 : 0
          if (rPrio > pPrio || (rPrio === pPrio && r.id > prev.id)) {
            deduped.set(r.fecha, r)
          }
        }
      }
      const timeline = Array.from(deduped.values()).sort((a, b) => a.fecha.localeCompare(b.fecha))

      // Raw ensemble errors for walk-forward: temp_real - temp_pronosticada
      const rawErrors: (number | null)[] = []
      for (const r of timeline) {
        if (r.temp_real != null && r.temp_pronosticada != null) {
          rawErrors.push(r.temp_real - r.temp_pronosticada)
        } else {
          rawErrors.push(null)
        }
      }

      // Pre-compute Kalman R and metadata
      const validRawErrors = rawErrors.filter((e): e is number => e !== null)
      const R = estimateKalmanR(validRawErrors)
      const cityQ = getKalmanQ(slug)
      const ultimoBias = validRawErrors.length >= 5 ? kalmanNextBias(validRawErrors, cityQ, R) : 0

      // Pre-compute MC bias predictions (running mean) and Kalman bias predictions
      // For day i: MC bias = mean of rawErrors[0..i-1], Kalman bias = Kalman filter state before day i
      const mcBiases: number[] = []
      const kalBiases: number[] = []
      let sumErrors = 0
      let countErrors = 0
      // Run Kalman filter
      const kalPreds = kalmanBiasPredictions(validRawErrors, cityQ, R)
      let validIdx = 0
      for (let i = 0; i < timeline.length; i++) {
        if (rawErrors[i] !== null) {
          // MC: simple running mean of previous errors
          mcBiases.push(countErrors > 0 ? sumErrors / countErrors : 0)
          // Kalman: filter prediction before seeing this error
          kalBiases.push(kalPreds[validIdx] ?? 0)
          // Update running sum for next iteration
          sumErrors += rawErrors[i]!
          countErrors++
          validIdx++
        } else {
          mcBiases.push(countErrors > 0 ? sumErrors / countErrors : 0)
          kalBiases.push(validIdx > 0 ? kalPreds[validIdx - 1] ?? 0 : 0)
        }
      }

      // --- 4b) For each record with temp_real, compute MC and Kalman predictions ---
      // Group by fecha: collect 10PM and 11PM separately
      interface DayResult {
        fecha: string
        temp_real: number | null
        cur_10pm: number | null
        cur_11pm: number | null
        kal_10pm: number | null
        kal_11pm: number | null
        modelo_10pm: string | null
        modelo_11pm: string | null
      }

      const dayMap: Map<string, DayResult> = new Map()
      const fechaOrder: string[] = []

      for (const r of records) {
        const fecha = r.fecha
        if (!dayMap.has(fecha)) {
          dayMap.set(fecha, {
            fecha,
            temp_real: null,
            cur_10pm: null,
            cur_11pm: null,
            kal_10pm: null,
            kal_11pm: null,
            modelo_10pm: null,
            modelo_11pm: null,
          })
          fechaOrder.push(fecha)
        }
        const dr = dayMap.get(fecha)!
        dr.temp_real = r.temp_real

        // Inferir run_type desde fecha_ejecucion si es NULL
        const effectiveRunType = r.run_type || inferRunType(r.fecha_ejecucion)
        const is10pm = effectiveRunType === '10PM'
        const is11pm = effectiveRunType === '11PM'

        // Base temp: preferir daily_runs (datos reales sin corrupción del backup)
        // Si no hay en daily_runs, caer a forecast_pronosticada de forecast_history
        const drKey = slug + '|' + fecha + '|' + (effectiveRunType || '')
        const base = dailyRunBase[drKey] ?? r.temp_pronosticada
        if (base == null) continue

        // Find the index in the deduplicated timeline for this fecha
        // Si la fecha no está en timeline (día futuro sin temp_real), usar el último índice disponible
        let tlIdx = timeline.findIndex(t => t.fecha === fecha)
        if (tlIdx < 0) tlIdx = timeline.length - 1

        const mcBias = mcBiases[tlIdx]
        const kalBias = kalBiases[tlIdx]

        const mcPred = round2(base + mcBias)
        const kalPred = round2(base + kalBias)

        if (is10pm) {
          dr.cur_10pm = mcPred
          dr.kal_10pm = kalPred
          const snapKey = slug + '|' + fecha + '|10PM'
          dr.modelo_10pm = snapModelo[snapKey] ?? null
        } else if (is11pm) {
          dr.cur_11pm = mcPred
          dr.kal_11pm = kalPred
          const snapKey = slug + '|' + fecha + '|11PM'
          dr.modelo_11pm = snapModelo[snapKey] ?? null
        } else {
          // Sin run_type ni inferencia posible: asignar al que falte, o al 11PM por defecto
          if (dr.cur_11pm === null && dr.kal_11pm === null) {
            dr.cur_11pm = mcPred
            dr.kal_11pm = kalPred
            const snapKey = slug + '|' + fecha + '|11PM'
            dr.modelo_11pm = snapModelo[snapKey] ?? null
          } else if (dr.cur_10pm === null && dr.kal_10pm === null) {
            dr.cur_10pm = mcPred
            dr.kal_10pm = kalPred
            const snapKey = slug + '|' + fecha + '|10PM'
            dr.modelo_10pm = snapModelo[snapKey] ?? null
          }
        }
      }

      // --- 4b-extra) Completar dayMap con fechas de dailyRunBase que no se agregaron ---
      // Esto cubre días futuros que tienen datos en daily_runs pero no en forecast_history
      for (const [key, baseTemp] of Object.entries(dailyRunBase)) {
        if (!key.startsWith(slug + '|')) continue
        const parts = key.split('|')
        const fecha = parts[1]
        const rt = parts[2] as '10PM' | '11PM'
        if (!fecha || !dayMap.has(fecha)) {
          if (!dayMap.has(fecha)) {
            dayMap.set(fecha, {
              fecha,
              temp_real: null,
              cur_10pm: null,
              cur_11pm: null,
              kal_10pm: null,
              kal_11pm: null,
              modelo_10pm: null,
              modelo_11pm: null,
            })
            fechaOrder.push(fecha)
          }
        }
        const dr = dayMap.get(fecha)!
        // Usar el último bias disponible (mismo comportamiento que fechas sin timeline)
        const tlIdx = timeline.length - 1
        const mcBias = mcBiases[tlIdx] ?? 0
        const kalBias = kalBiases[tlIdx] ?? 0
        const mcPred = round2(baseTemp + mcBias)
        const kalPred = round2(baseTemp + kalBias)
        if (rt === '10PM' && dr.cur_10pm === null) {
          dr.cur_10pm = mcPred
          dr.kal_10pm = kalPred
        } else if (rt === '11PM' && dr.cur_11pm === null) {
          dr.cur_11pm = mcPred
          dr.kal_11pm = kalPred
        }
      }

      // --- 4c) Filter by date range and build final results ---
      const resultDays: KalmanDay[] = []
      let curMae = 0, kalMae = 0, cntErr = 0
      let curHits = 0, kalHits = 0
      let cur10c = 0, cur11c = 0, curAmbos = 0
      let kal10c = 0, kal11c = 0, kalAmbos = 0
      let pendientes = 0

      // Also get the latest modelo_actual from snapshots
      let modeloActual = 'combinado_estandar'
      const latestSnap = (snapshots as any[])?.filter((s: any) => s.slug === slug)
      if (latestSnap?.length) {
        const last11pm = latestSnap.filter((s: any) => s.run_type_ganadora === '11PM').pop()
        const last10pm = latestSnap.filter((s: any) => s.run_type_ganadora === '10PM').pop()
        modeloActual = last11pm?.modelo_ganador || last10pm?.modelo_ganador || modeloActual
      }

      for (const fecha of fechaOrder) {
        const dr = dayMap.get(fecha)
        if (!dr) continue

        const daysAgo = Math.floor((endDate.getTime() - new Date(fecha + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
        if (daysAgo < -1 || daysAgo > daysLimit) continue

        const tempReal = dr.temp_real

        let curErr10: number | null = null
        let curErr11: number | null = null
        let kalErr10: number | null = null
        let kalErr11: number | null = null
        let curGana: KalmanDay['cur_gana'] = null
        let kalGana: KalmanDay['kal_gana'] = null
        let mejor: KalmanDay['mejor'] = null
        const estable = (dr.cur_10pm != null && dr.kal_10pm != null) || (dr.cur_11pm != null && dr.kal_11pm != null)

        if (tempReal !== null) {
          if (dr.cur_10pm !== null) curErr10 = round2(Math.abs(dr.cur_10pm - tempReal))
          if (dr.cur_11pm !== null) curErr11 = round2(Math.abs(dr.cur_11pm - tempReal))
          if (dr.kal_10pm !== null) kalErr10 = round2(Math.abs(dr.kal_10pm - tempReal))
          if (dr.kal_11pm !== null) kalErr11 = round2(Math.abs(dr.kal_11pm - tempReal))
          const rReal = roundInt(tempReal)
          curGana = ganaDe(
            dr.cur_10pm !== null && roundInt(dr.cur_10pm) === rReal,
            dr.cur_11pm !== null && roundInt(dr.cur_11pm) === rReal
          )
          kalGana = ganaDe(
            dr.kal_10pm !== null && roundInt(dr.kal_10pm) === rReal,
            dr.kal_11pm !== null && roundInt(dr.kal_11pm) === rReal
          )
          const curRef = curErr11 !== null ? curErr11 : curErr10
          const kalRef = kalErr11 !== null ? kalErr11 : kalErr10
          if (curRef !== null && kalRef !== null) {
            if (curRef < kalRef) mejor = 'actual'
            else if (kalRef < curRef) mejor = 'kalman'
            else mejor = 'empate'
          }
        } else {
          pendientes++
        }

        resultDays.push({
          fecha_objetivo: fecha,
          temp_real: tempReal,
          hora_10pm: dr.modelo_10pm ?? null,
          hora_11pm: dr.modelo_11pm ?? null,
          modelo_ganador_10pm: dr.modelo_10pm,
          modelo_ganador_11pm: dr.modelo_11pm,
          cur_10pm: dr.cur_10pm, cur_11pm: dr.cur_11pm,
          cur_err_10pm: curErr10, cur_err_11pm: curErr11,
          cur_gana: curGana,
          kal_10pm: dr.kal_10pm, kal_11pm: dr.kal_11pm,
          kal_err_10pm: kalErr10, kal_err_11pm: kalErr11,
          kal_gana: kalGana,
          mejor, estable,
        })

        if (tempReal !== null) {
          const curRef = curErr11 !== null ? curErr11 : curErr10
          const kalRef = kalErr11 !== null ? kalErr11 : kalErr10
          if (curRef !== null && kalRef !== null) {
            curMae += curRef
            kalMae += kalRef
            cntErr++
          }
          if (curGana) {
            curHits++
            if (curGana === '10PM/11PM') curAmbos++
            else if (curGana === '10PM') cur10c++
            else cur11c++
          }
          if (kalGana) {
            kalHits++
            if (kalGana === '10PM/11PM') kalAmbos++
            else if (kalGana === '10PM') kal10c++
            else kal11c++
          }
        }
      }

      if (resultDays.length === 0) continue

      ciudades[slug] = {
        slug,
        nombre: slugNames[slug] || slug,
        modelo_actual: modeloActual,
        pipeline_actual: [],
        kalman: { q: KALMAN_Q, r: round2(R), ultimo_bias: round2(ultimoBias) },
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
