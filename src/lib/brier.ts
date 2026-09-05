/**
 * BRIER SCORE — calibración de las probabilidades del sistema vs el mercado.
 *
 * QUÉ MIDE: qué tan cerca estuvieron las probabilidades (prob_ia_norm) de la
 * resolución REAL. BS = media de (p − o)² por contrato. 0 = perfecto,
 * 0.25 = moneda al aire, 1 = siempre seguro y siempre equivocado.
 *
 * FUENTES:
 *   - daily_runs.resultados → contratos con prob_ia_norm (IA) y prob_mkt (mercado)
 *     de cada corrida 10PM/11PM (se toma la ÚLTIMA corrida de cada slot por día,
 *     que es el valor oficial que quedó en la base).
 *   - forecast_snapshot.temp_real → la temperatura real que resolvió el día.
 *
 * EVENTOS (resolución REAL de Polymarket — lo que PAGA, redondeo a entero):
 *   exacto V    : round(real) == V
 *   superior V  : round(real) >= V   ("V°C or higher")
 *   inferior V  : round(real) <= V   ("V°C or lower")
 *   rango [a,b] : a <= round(real) <= b
 *
 * IMPORTANTE: el Monte Carlo interno usa tolerancia ±1°C al calcular las probs,
 * pero aquí se puntúa contra el evento EXACTO que resuelve Polymarket, porque
 * este número es para decidir con dinero. La comparación IA vs mercado usa el
 * precio medio (prob_mkt) registrado en el MISMO instante de la corrida.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from './cities'

export interface BrierAgg {
  n: number
  brier_ia: number | null
  brier_mkt: number | null
  /** (mkt − ia) / mkt · > 0 = la IA le gana al mercado */
  skill: number | null
}

export interface BrierCalibBin {
  lo: number
  hi: number
  n: number
  /** frecuencia observada del evento en ese bin */
  p_obs: number
}

export interface BrierSemana {
  semana: string
  n: number
  brier_ia: number
  brier_mkt: number
  ganador: 'IA' | 'MERCADO' | 'EMPATE'
}

export interface BrierConfianza {
  n: number
  fallos: number
  tasa_fallo: number
}

export interface BrierSummary {
  ok: boolean
  error?: string
  dias: number | 'all'
  n_contratos: number
  n_dias: number
  fecha_desde: string | null
  fecha_hasta: string | null
  global: BrierAgg
  por_slot: Record<string, BrierAgg>
  por_tipo: Record<string, BrierAgg>
  por_ciudad: Array<BrierAgg & { slug: string; nombre: string }>
  calibracion: BrierCalibBin[]
  confianza_ia: BrierConfianza
  confianza_mkt: BrierConfianza
  semanas: BrierSemana[]
}

const EMPTY_AGG: BrierAgg = { n: 0, brier_ia: null, brier_mkt: null, skill: null }

function emptySummary(dias: number | 'all', error?: string): BrierSummary {
  return {
    ok: false,
    error,
    dias,
    n_contratos: 0,
    n_dias: 0,
    fecha_desde: null,
    fecha_hasta: null,
    global: { ...EMPTY_AGG },
    por_slot: {},
    por_tipo: {},
    por_ciudad: [],
    calibracion: [],
    confianza_ia: { n: 0, fallos: 0, tasa_fallo: 0 },
    confianza_mkt: { n: 0, fallos: 0, tasa_fallo: 0 },
    semanas: [],
  }
}

interface Contrato {
  tipo?: string
  valor?: number | [number, number]
  prob_ia_norm?: number
  prob_mkt?: number
}

interface CityResult {
  slug?: string
  contratos?: Contrato[]
}

/** o = 1 si el evento resolvió YES (regla de Polymarket: entero redondeado) */
function outcomeReal(tipo: string, valor: number | [number, number], real: number): number | null {
  const r = Math.round(real)
  if (tipo === 'exacto') return r === (valor as number) ? 1 : 0
  if (tipo === 'superior') return r >= (valor as number) ? 1 : 0
  if (tipo === 'inferior') return r <= (valor as number) ? 1 : 0
  if (tipo === 'rango') {
    const [a, b] = valor as [number, number]
    return r >= a && r <= b ? 1 : 0
  }
  return null
}

const mean = (a: number[]): number | null => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)

function agg(subset: Array<{ p_ia: number; p_mkt: number; o: number }>): BrierAgg {
  if (!subset.length) return { ...EMPTY_AGG }
  const brier_ia = mean(subset.map(r => (r.p_ia - r.o) ** 2))
  const brier_mkt = mean(subset.map(r => (r.p_mkt - r.o) ** 2))
  const skill = brier_mkt && brier_mkt > 0 ? (brier_mkt - brier_ia!) / brier_mkt : null
  return {
    n: subset.length,
    brier_ia: brier_ia == null ? null : Math.round(brier_ia * 10000) / 10000,
    brier_mkt: brier_mkt == null ? null : Math.round(brier_mkt * 10000) / 10000,
    skill: skill == null ? null : Math.round(skill * 1000) / 1000,
  }
}

function getReadClient(): SupabaseClient | null {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key)
}

/**
 * Calcula el resumen de Brier. `dias` = ventana (default 30) o 'all' para todo.
 * Solo LECTURA: no escribe en ninguna tabla.
 */
export async function computeBrier(dias: number | 'all' = 30): Promise<BrierSummary> {
  const client = getReadClient()
  if (!client) return emptySummary(dias, 'Sin credenciales de Supabase')

  try {
    const cutoff =
      dias === 'all'
        ? null
        : new Date(Date.now() - (dias as number) * 864e5).toISOString().slice(0, 10)

    // 1) Reales (forecast_snapshot)
    let snapQ = client
      .from('forecast_snapshot' as any)
      .select('slug, fecha_objetivo, temp_real')
      .not('temp_real', 'is', null as any)
      .order('fecha_objetivo', { ascending: true } as any)
      .limit(5000)
    if (cutoff) snapQ = snapQ.gte('fecha_objetivo', cutoff)
    const { data: snaps, error: snapErr } = await snapQ
    if (snapErr) throw new Error(snapErr.message)

    const realMap = new Map<string, number>()
    for (const s of ((snaps as any[]) ?? [])) {
      const v = Number(s.temp_real)
      if (!isNaN(v)) realMap.set(`${s.slug}|${s.fecha_objetivo}`, v)
    }

    // 2) Corridas 10PM/11PM (la de id mayor por fecha+slot es el valor final del slot)
    let runQ = client
      .from('daily_runs' as any)
      .select('id, run_type, fecha_objetivo, resultados')
      .in('run_type', ['10PM', '11PM'])
      .order('id', { ascending: true } as any)
      .limit(800)
    if (cutoff) runQ = runQ.gte('fecha_objetivo', cutoff)
    const { data: runs, error: runErr } = await runQ
    if (runErr) throw new Error(runErr.message)

    const finalRun = new Map<string, any>()
    for (const r of (runs as any[]) ?? []) {
      const k = `${r.fecha_objetivo}|${r.run_type}`
      const prev = finalRun.get(k)
      if (!prev || r.id > prev.id) finalRun.set(k, r)
    }

    // 3) Puntuar contratos
    const rows: Array<{ fecha: string; slot: string; slug: string; tipo: string; p_ia: number; p_mkt: number; o: number }> = []
    for (const [k, r] of finalRun) {
      const [fecha, slot] = k.split('|')
      let res: any[] | null = null
      try {
        res = typeof r.resultados === 'string' ? JSON.parse(r.resultados) : r.resultados
      } catch { continue }
      if (!Array.isArray(res)) continue
      for (const city of res as CityResult[]) {
        const real = realMap.get(`${city.slug}|${fecha}`)
        if (real == null) continue
        for (const c of city.contratos ?? []) {
          if (c.prob_ia_norm == null || c.prob_mkt == null || c.tipo == null || c.valor == null) continue
          const o = outcomeReal(c.tipo, c.valor, real)
          if (o == null) continue
          rows.push({
            fecha,
            slot,
            slug: city.slug || '?',
            tipo: c.tipo,
            p_ia: Math.max(0, Math.min(1, c.prob_ia_norm)),
            p_mkt: Math.max(0, Math.min(1, c.prob_mkt / 100)),
            o,
          })
        }
      }
    }

    if (!rows.length) return emptySummary(dias)

    const fechas = [...new Set(rows.map(r => r.fecha))].sort()

    // 4) Agregados
    const porSlot: Record<string, BrierAgg> = {}
    for (const slot of ['10PM', '11PM']) {
      porSlot[slot] = agg(rows.filter(r => r.slot === slot))
    }
    const porTipo: Record<string, BrierAgg> = {}
    for (const tipo of ['exacto', 'superior', 'inferior', 'rango']) {
      const sub = rows.filter(r => r.tipo === tipo)
      if (sub.length) porTipo[tipo] = agg(sub)
    }

    const nameMap: Record<string, string> = {}
    for (const c of CIUDADES_ASIA as any[]) nameMap[c.slug] = c.nombre
    const porCiudadSlug = new Map<string, typeof rows>()
    for (const r of rows) {
      if (!porCiudadSlug.has(r.slug)) porCiudadSlug.set(r.slug, [])
      porCiudadSlug.get(r.slug)!.push(r)
    }
    const porCiudad = Array.from(porCiudadSlug.entries())
      .map(([slug, sub]) => ({ slug, nombre: nameMap[slug] ?? slug, ...agg(sub) }))
      .sort((a, b) => (a.brier_ia ?? 9) - (b.brier_ia ?? 9))

    // 5) Calibración (bins de p_ia vs frecuencia observada)
    const bins: BrierCalibBin[] = []
    for (let i = 0; i < 10; i++) {
      const lo = i / 10, hi = (i + 1) / 10
      const sub = rows.filter(r => r.p_ia >= lo && (i === 9 ? r.p_ia <= 1 : r.p_ia < hi))
      if (sub.length >= 5) {
        const obs = mean(sub.map(r => r.o))!
        bins.push({ lo, hi, n: sub.length, p_obs: Math.round(obs * 1000) / 1000 })
      }
    }

    // 6) Fiabilidad en confianza alta (p ≥ 90%)
    const confIA = rows.filter(r => r.p_ia >= 0.9)
    const confMkt = rows.filter(r => r.p_mkt >= 0.9)
    const mkConf = (sub: typeof rows): BrierConfianza => {
      const fallos = sub.filter(r => r.o === 0).length
      return {
        n: sub.length,
        fallos,
        tasa_fallo: sub.length ? Math.round((fallos / sub.length) * 1000) / 1000 : 0,
      }
    }

    // 7) Evolución semanal (lunes ISO)
    const porSemana = new Map<string, typeof rows>()
    for (const r of rows) {
      const d = new Date(r.fecha + 'T00:00:00Z')
      const lunes = new Date(d)
      lunes.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
      const k = lunes.toISOString().slice(0, 10)
      if (!porSemana.has(k)) porSemana.set(k, [])
      porSemana.get(k)!.push(r)
    }
    const semanas: BrierSemana[] = []
    for (const k of Array.from(porSemana.keys()).sort()) {
      const sub = porSemana.get(k)!
      if (sub.length < 10) continue
      const a = agg(sub)
      if (a.brier_ia == null || a.brier_mkt == null) continue
      const diff = a.brier_mkt - a.brier_ia
      semanas.push({
        semana: k,
        n: sub.length,
        brier_ia: a.brier_ia,
        brier_mkt: a.brier_mkt,
        ganador: Math.abs(diff) < 0.002 ? 'EMPATE' : diff > 0 ? 'IA' : 'MERCADO',
      })
    }

    return {
      ok: true,
      dias,
      n_contratos: rows.length,
      n_dias: fechas.length,
      fecha_desde: fechas[0] ?? null,
      fecha_hasta: fechas[fechas.length - 1] ?? null,
      global: agg(rows),
      por_slot: porSlot,
      por_tipo: porTipo,
      por_ciudad: porCiudad,
      calibracion: bins,
      confianza_ia: mkConf(confIA),
      confianza_mkt: mkConf(confMkt),
      semanas,
    }
  } catch (e) {
    return emptySummary(dias, (e as Error).message)
  }
}
