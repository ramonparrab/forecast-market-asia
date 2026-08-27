import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
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
  modelo_ganador_10pm: string | null
  modelo_ganador_11pm: string | null
  combinado_10pm: number | null
  combinado_11pm: number | null
  error_10pm: number | null
  error_11pm: number | null
  gana: '10PM' | '11PM' | 'EMPATE' | '10PM/11PM' | null
  pred_gana?: '10PM' | '11PM' | null
  pred_acierto?: boolean | null
  /** true si los valores vienen de snapshots guardados (estables) */
  estable: boolean
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

  if (month !== 7 && month !== 8) return '11PM'
  if (Math.abs(diff) < 0.3) return '10PM'
  if (diff > 1.5) return '11PM'
  if (tc10 >= 36 && diff < -0.3 && trend !== null) {
    if (trend > 0.5) return '10PM'
    return '11PM'
  }
  if (tc10 >= 36 && diff < -0.3) return '11PM'
  return '10PM'
}

interface RunSnapshot {
  id: number
  fecha_ejecucion: string
  tc: number           // temp_corregida FINAL (con modelo ganador)
  modelo_ganador: string | null
  dist: number
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

    // ============ 1) forecast_history: solo para temp_real (filtro + límite alto para evitar corte 1000) ============
    const bnSince = new Date()
    bnSince.setDate(bnSince.getDate() - 120)
    let fhQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_real')
      .not('temp_real', 'is', null as any)
      .gte('fecha_objetivo', bnSince.toISOString().slice(0, 10))
      .order('id', { ascending: false } as any)
      .limit(5000)
    if (slugFilter) fhQuery = fhQuery.eq('slug', slugFilter)
    const { data: fhRecords } = await fhQuery

    const realMap: Record<string, { real: number; id: number }> = {}
    for (const r of (fhRecords as any[]) ?? []) {
      const key = r.slug + '|' + r.fecha_objetivo
      const prev = realMap[key]
      if (!prev || r.id > prev.id) {
        realMap[key] = { real: r.temp_real, id: r.id }
      }
    }

    // ============ 2) daily_runs: SNAPSHOTS GUARDADOS ============
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, resultados')
      .gte('fecha_ejecucion', startDate.toISOString())
      .order('fecha_ejecucion', { ascending: true } as any)

    const run10pm: Record<string, RunSnapshot> = {}
    const run11pm: Record<string, RunSnapshot> = {}
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
        if (!cityData?.forecast) continue

        // Usar temp_corregida FINAL (con modelo ganador aplicado)
        const tc = cityData.forecast.temp_corregida
        if (tc == null) continue

        const entry: RunSnapshot = {
          id: run.id,
          fecha_ejecucion: run.fecha_ejecucion,
          tc: Number(tc),
          modelo_ganador: cityData.forecast.modelo_activo ?? null,
          dist: 0,
        }

        // Determinar 10PM/11PM por timestamp
        // 10PM Caracas = 02:00Z, 11PM Caracas = 03:00Z
        // Punto medio 02:30Z como divisor
        const midpoint = cronTs10 + 30 * 60 * 1000
        if (runTs >= cronTs10 - 60 * 60 * 1000 && runTs < midpoint) {
          const dist = Math.abs(runTs - cronTs10)
          const prev = run10pm[key]
          if (!prev || dist < prev.dist) {
            run10pm[key] = { ...entry, dist }
          }
        } else if (runTs >= midpoint && runTs < cronTs11 + 90 * 60 * 1000) {
          const dist = Math.abs(runTs - cronTs11)
          const prev = run11pm[key]
          if (!prev || dist < prev.dist) {
            run11pm[key] = { ...entry, dist }
          }
        }
      }
    }

    if (Object.keys(run10pm).length === 0 && Object.keys(run11pm).length === 0) {
      return res.status(200).json({ ciudades: {} })
    }

    // ============ 3) Fechas válidas ============
    const validTargets: Record<string, string[]> = {}
    const addFecha = (slug: string, fecha: string) => {
      if (!validTargets[slug]) validTargets[slug] = []
      if (validTargets[slug].indexOf(fecha) === -1) validTargets[slug].push(fecha)
    }
    for (const key of allRunKeys) {
      const [slug, fecha] = key.split('|')
      const daysAgo = Math.floor((endDate.getTime() - new Date(fecha + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
      if (daysAgo >= -1 && daysAgo <= daysLimit) addFecha(slug, fecha)
    }

    // ============ 4) Resultados finales — VALORES ESTABLES ============
    const ciudades: Record<string, NowcastCityResult> = {}

    Object.keys(validTargets).forEach(slug => {
      const fechas = validTargets[slug]
      const resultDays: NowcastDay[] = []

      for (let fi = 0; fi < fechas.length; fi++) {
        const fecha = fechas[fi]
        const key = slug + '|' + fecha
        const r10 = run10pm[key]
        const r11 = run11pm[key]
        const tempReal = realMap[key]?.real ?? null

        if (!r10 && !r11) continue

        const tc10 = r10?.tc ?? null
        const tc11 = r11?.tc ?? null
        const estable = (r10?.tc != null && r11?.tc != null)

        let error10: number | null = null
        let error11: number | null = null
        let gana: NowcastDay['gana'] = null

        if (tempReal !== null) {
          if (tc10 !== null) error10 = round2(Math.abs(tc10 - tempReal))
          if (tc11 !== null) error11 = round2(Math.abs(tc11 - tempReal))

          const rReal = roundInt(tempReal)
          const a10 = tc10 !== null && roundInt(tc10) === rReal
          const a11 = tc11 !== null && roundInt(tc11) === rReal

          if (a10 && a11) gana = '10PM/11PM'
          else if (a10 && !a11) gana = '10PM'
          else if (!a10 && a11) gana = '11PM'
        }

        const [pY, pM, pD] = fecha.split('-').map(Number)
        const prevDate = new Date(pY, pM - 1, pD - 1)
        const prevKey = slug + '|' + prevDate.getFullYear() + '-' +
          String(prevDate.getMonth() + 1).padStart(2, '0') + '-' +
          String(prevDate.getDate()).padStart(2, '0')
        const prevReal = realMap[prevKey]?.real ?? null
        const predGana = (tc10 != null && tc11 != null)
          ? computeRecommendation(tc10, tc11, fecha, slug, prevReal)
          : null
        let predAcierto: boolean | null = null
        if (predGana && gana === '10PM/11PM') predAcierto = true
        else if (predGana && gana) predAcierto = predGana === gana
        else if (predGana && gana === null && tempReal !== null) predAcierto = false

        resultDays.push({
          fecha_objetivo: fecha,
          temp_real: tempReal,
          temp_corregida_10pm: tc10,
          temp_corregida_11pm: tc11,
          hora_10pm: r10?.fecha_ejecucion ?? null,
          hora_11pm: r11?.fecha_ejecucion ?? null,
          modelo_ganador_10pm: r10?.modelo_ganador ?? null,
          modelo_ganador_11pm: r11?.modelo_ganador ?? null,
          combinado_10pm: tc10,
          combinado_11pm: tc11,
          error_10pm: error10,
          error_11pm: error11,
          gana,
          pred_gana: predGana || undefined,
          pred_acierto: predAcierto ?? undefined,
          estable,
        })
      }

      if (resultDays.length === 0) return
      resultDays.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

      let g10 = 0, g11 = 0, emp = 0
      let sumErr10 = 0, sumErr11 = 0, countErr = 0

      for (const d of resultDays) {
        if (d.gana === '10PM' || d.gana === '10PM/11PM') g10++
        if (d.gana === '11PM' || d.gana === '10PM/11PM') g11++
        if (d.gana === '10PM/11PM') emp++
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
