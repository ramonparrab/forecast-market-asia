/**
 * MODO SOMBRA v2 — duelo de probabilidades: PRODUCCIÓN vs SOMBRA vs MERCADO.
 *
 * QUÉ ES LA SOMBRA v2 (receta CONGELADA el 2026-09-06, no tocar):
 *   X = temp_corregida + T·σ,  T ~ t de Student(4),  σ = 1.5
 *   probs por contrato = diferencia de CDF con la REGLA DE PAGO EXACTA
 *   (redondeo a entero, la que paga Polymarket), normalizadas igual que
 *   producción (divide entre la suma de los contratos de la ciudad).
 *
 * La t(4) tiene CDF de forma cerrada (F(t) = 1/2 + (3/4)·s·(1 − s²/3),
 * s = t/√(t²+4)), así que NO hay Monte Carlo: el cálculo es exacto,
 * determinista y barato. Validado contra el backtest de 20k sims
 * (Brier global 0.1284 vs 0.1283 · skill +0.050 igual · mismos 5.053
 * contratos — scripts/shadow_analytic_check.js).
 *
 * RED LÍNEA: esta lib es 100% LECTURA (daily_runs + forecast_snapshot con
 * anon key, igual que brier.ts). NO escribe nada, NO toca montecarlo.ts,
 * NO cambia las probs de producción ni las decisiones. Solo compara.
 *
 * Backtest (fecha ≤ congelada): la σ=1.5 se eligió mirando ese histórico
 * (in-sample). "En vivo" (fecha > congelada) es el veredicto real
 * out-of-sample — la promoción a motor se decide SOLO con ese tramo.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from './cities'

// ==== RECETA CONGELADA — no tocar estos números ====
export const SHADOW_NOMBRE = 'Sombra v2 · centro único'
export const SHADOW_SIGMA = 1.5
export const SHADOW_DISTRIBUCION = 't(4)'
export const SHADOW_CENTRO = 'temp_corregida'
export const SHADOW_REGLA = 'pago exacto (redondeo, la que paga Polymarket)'
/** El día que se congeló la receta. fecha < congelada = backtest (in-sample) · fecha ≥ congelada = vivo (out-of-sample: creados tras el congelamiento, la σ nunca los vio). */
export const SHADOW_FECHA_CONGELADA = '2026-09-06'
/** Diferencia de prob que cuenta como "discordancia" entre producción y sombra */
export const DISCORDANCIA_UMBRAL = 0.05

// ==== Tipos del payload ====
export interface DueloAgg {
  n: number
  brier_prod: number | null
  brier_sombra: number | null
  brier_mkt: number | null
  /** brier_sombra − brier_prod · NEGATIVO = la sombra mejora */
  delta: number | null
  /** skill vs mercado (mkt − x)/mkt, > 0 = le gana al mercado */
  skill_prod: number | null
  skill_sombra: number | null
}

export interface DueloDia {
  fecha: string
  n: number
  brier_prod: number
  brier_sombra: number
  brier_mkt: number
  delta: number
}

export interface DueloCiudad extends DueloAgg {
  slug: string
  nombre: string
}

export interface DueloPendiente {
  fecha: string
  slot: string
  slug: string
  nombre: string
  tipo: string
  valor: string
  p_prod: number
  p_sombra: number
  p_mkt: number
  delta: number
  /** p − p_mkt de cada versión (señal EV relativa al precio de mercado) */
  ev_prod: number
  ev_sombra: number
}

export interface ShadowSummary {
  ok: boolean
  error?: string
  dias: number | 'all'
  n_contratos: number
  n_dias: number
  fecha_desde: string | null
  fecha_hasta: string | null
  receta: {
    nombre: string
    centro: string
    distribucion: string
    sigma: number
    regla: string
    congelada: string
  }
  global: DueloAgg
  por_slot: Record<string, DueloAgg>
  por_segmento: {
    backtest: DueloAgg | null
    vivo: DueloAgg | null
    /** contratos de fechas > congelada aún SIN resolver (esperando temp_real) */
    pendientes_vivo: number
  }
  por_dia: DueloDia[]
  por_ciudad: DueloCiudad[]
  stats: {
    discordantes: number
    pct_discordantes: number | null
    flips_ev: number
    abs_delta_medio: number | null
  }
  hoy: {
    fecha: string | null
    pendientes: DueloPendiente[]
  }
}

const EMPTY_AGG: DueloAgg = {
  n: 0, brier_prod: null, brier_sombra: null, brier_mkt: null,
  delta: null, skill_prod: null, skill_sombra: null,
}

function emptySummary(dias: number | 'all', error?: string): ShadowSummary {
  return {
    ok: false,
    error,
    dias,
    n_contratos: 0,
    n_dias: 0,
    fecha_desde: null,
    fecha_hasta: null,
    receta: {
      nombre: SHADOW_NOMBRE,
      centro: SHADOW_CENTRO,
      distribucion: SHADOW_DISTRIBUCION,
      sigma: SHADOW_SIGMA,
      regla: SHADOW_REGLA,
      congelada: SHADOW_FECHA_CONGELADA,
    },
    global: { ...EMPTY_AGG },
    por_slot: {},
    por_segmento: { backtest: null, vivo: null, pendientes_vivo: 0 },
    por_dia: [],
    por_ciudad: [],
    stats: { discordantes: 0, pct_discordantes: null, flips_ev: 0, abs_delta_medio: null },
    hoy: { fecha: null, pendientes: [] },
  }
}

// ==== Receta v2: CDF t(4) cerrada + probs por contrato ====

/** CDF de la t de Student con 4 grados de libertad (forma cerrada). */
function cdfT4(t: number): number {
  const s = t / Math.sqrt(t * t + 4)
  return 0.5 + 0.75 * s * (1 - (s * s) / 3)
}

/** P(X < x) para X = centro + σ·T4 */
function pMenor(x: number, centro: number): number {
  return cdfT4((x - centro) / SHADOW_SIGMA)
}

interface Contrato {
  tipo?: string
  valor?: number | [number, number]
  prob_ia_norm?: number
  prob_mkt?: number
}

/**
 * Prob del contrato bajo la receta v2 con la regla de pago EXACTA:
 * exacto V    : P(V−0.5 ≤ X < V+0.5)
 * superior V  : P(X ≥ V−0.5)
 * inferior V  : P(X < V+0.5)
 * rango [a,b] : P(a−0.5 ≤ X < b+0.5)
 */
function probSombra(tipo: string, valor: number | [number, number], centro: number): number | null {
  if (tipo === 'exacto') {
    const v = valor as number
    return pMenor(v + 0.5, centro) - pMenor(v - 0.5, centro)
  }
  if (tipo === 'superior') {
    const v = valor as number
    return 1 - pMenor(v - 0.5, centro)
  }
  if (tipo === 'inferior') {
    const v = valor as number
    return pMenor(v + 0.5, centro)
  }
  if (tipo === 'rango') {
    const [a, b] = valor as [number, number]
    return pMenor(b + 0.5, centro) - pMenor(a - 0.5, centro)
  }
  return null
}

/**
 * Probs SOMBRA v2 (receta congelada, analítica y determinista) para TODOS los
 * contratos de una corrida, normalizadas igual que producción. Única fuente
 * de verdad de la receta: la usan computeShadowDuelo (subpestaña del duelo) y
 * las columnas "P. CUBO" de TOMAR DECISIÓN (decision-tab).
 * Devuelve null si algún contrato no es puntuable (mismo criterio que el duelo).
 */
export function shadowProbsContratos(
  contratos: Array<{ tipo?: string | null; valor?: number | [number, number] | null }>,
  centro: number
): number[] | null {
  if (!Array.isArray(contratos) || contratos.length === 0 || isNaN(centro)) return null
  const raws: Array<number | null> = contratos.map(c =>
    c && c.tipo != null && c.valor != null ? probSombra(c.tipo, c.valor, centro) : null
  )
  if (raws.some(p => p == null)) return null
  return normalize(raws as number[])
}

/** Misma normalización que producción (montecarlo.ts) */
function normalize(raws: number[]): number[] {
  const sum = raws.reduce((s, v) => s + v, 0)
  if (sum === 0) return raws.map(() => 1 / raws.length)
  return raws.map(p => p / sum)
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
const r4 = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 10000)
const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000)

interface Row {
  fecha: string
  slot: string
  slug: string
  tipo: string
  p_prod: number
  p_sombra: number
  p_mkt: number
  o: number
}

function agg(sub: Row[]): DueloAgg {
  if (!sub.length) return { ...EMPTY_AGG }
  const brier_prod = mean(sub.map(r => (r.p_prod - r.o) ** 2))!
  const brier_sombra = mean(sub.map(r => (r.p_sombra - r.o) ** 2))!
  const brier_mkt = mean(sub.map(r => (r.p_mkt - r.o) ** 2))!
  return {
    n: sub.length,
    brier_prod: r4(brier_prod),
    brier_sombra: r4(brier_sombra),
    brier_mkt: r4(brier_mkt),
    delta: r4(brier_sombra - brier_prod),
    skill_prod: r3(brier_mkt > 0 ? (brier_mkt - brier_prod) / brier_mkt : null),
    skill_sombra: r3(brier_mkt > 0 ? (brier_mkt - brier_sombra) / brier_mkt : null),
  }
}

function getReadClient(): SupabaseClient | null {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key)
}

function valorLabel(tipo: string, valor: number | [number, number]): string {
  if (tipo === 'rango') {
    const [a, b] = valor as [number, number]
    return `${a}–${b}°C`
  }
  const v = valor as number
  if (tipo === 'superior') return `≥ ${v}°C`
  if (tipo === 'inferior') return `≤ ${v}°C`
  return `${v}°C`
}

/**
 * DUELO: calcula el Brier de producción (prob_ia_norm guardada), de la sombra
 * v2 (receta congelada, analítica) y del mercado (prob_mkt) sobre los mismos
 * contratos resueltos, con desglose por slot (10PM/11PM), por día, por ciudad,
 * segmento backtest/vivo y la tabla "hoy" sin resolver.
 * SOLO LECTURA — cero escrituras, cero service key.
 */
export async function computeShadowDuelo(dias: number | 'all' = 30): Promise<ShadowSummary> {
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
      .limit(1000)
    if (cutoff) snapQ = snapQ.gte('fecha_objetivo', cutoff)
    const { data: snaps, error: snapErr } = await snapQ
    if (snapErr) throw new Error(snapErr.message)

    const realMap = new Map<string, number>()
    for (const s of ((snaps as any[]) ?? [])) {
      const v = Number(s.temp_real)
      if (!isNaN(v)) realMap.set(`${s.slug}|${s.fecha_objetivo}`, v)
    }

    // 2) Corridas 10PM/11PM (la de id mayor por fecha+slot es el valor final)
    const runs: any[] = []
    let runOff = 0
    while (true) {
      let runQ = client
        .from('daily_runs' as any)
        .select('id, run_type, fecha_objetivo, resultados')
        .in('run_type', ['10PM', '11PM'])
        .order('id', { ascending: true } as any)
        .range(runOff, runOff + 999)
      if (cutoff) runQ = runQ.gte('fecha_objetivo', cutoff)
      const { data: page, error: runErr } = await runQ
      if (runErr) throw new Error(runErr.message)
      runs.push(...((page as any[]) ?? []))
      if (!page || page.length < 1000) break
      runOff += 1000
    }

    const finalRun = new Map<string, any>()
    let maxFecha: string | null = null
    for (const r of runs) {
      const k = `${r.fecha_objetivo}|${r.run_type}`
      const prev = finalRun.get(k)
      if (!prev || r.id > prev.id) finalRun.set(k, r)
      if (!maxFecha || r.fecha_objetivo > maxFecha) maxFecha = r.fecha_objetivo
    }

    // 3) Puntuar: resueltos (Brier) + pendientes de hoy (lado a lado)
    const rows: Row[] = []
    const pendientes: DueloPendiente[] = []
    const nameMap: Record<string, string> = {}
    for (const c of CIUDADES_ASIA as any[]) nameMap[c.slug] = c.nombre

    for (const [k, r] of finalRun) {
      const [fecha, slot] = k.split('|')
      let res: any[] | null = null
      try {
        res = typeof r.resultados === 'string' ? JSON.parse(r.resultados) : r.resultados
      } catch { continue }
      if (!Array.isArray(res)) continue

      for (const city of res as Array<{ slug?: string; contratos?: Contrato[]; forecast?: { temp_corregida?: number | string } }>) {
        if (!city.slug) continue
        const contratos = (city.contratos ?? []).filter(
          c => c.prob_ia_norm != null && c.prob_mkt != null && c.tipo != null && c.valor != null
        )
        if (!contratos.length) continue
        const f = city.forecast ?? {}
        if (f.temp_corregida == null) continue
        const centro = Number(f.temp_corregida)
        if (isNaN(centro)) continue

        // Receta v2 (analítica, exacta) + normalización como producción
        const norm = shadowProbsContratos(contratos, centro)
        if (!norm) continue

        const real = realMap.get(`${city.slug}|${fecha}`)
        if (real == null) {
          // Sin real → tabla "HOY" (solo la fecha objetivo más reciente)
          if (fecha === maxFecha) {
            contratos.forEach((c, i) => {
              const p_prod = Math.max(0, Math.min(1, c.prob_ia_norm!))
              const p_mkt = Math.max(0, Math.min(1, c.prob_mkt! / 100))
              const p_sombra = Math.max(0, Math.min(1, norm[i]))
              pendientes.push({
                fecha,
                slot,
                slug: city.slug!,
                nombre: nameMap[city.slug!] ?? city.slug!,
                tipo: c.tipo!,
                valor: valorLabel(c.tipo!, c.valor!),
                p_prod: r4(p_prod)!,
                p_sombra: r4(p_sombra)!,
                p_mkt: r4(p_mkt)!,
                delta: r4(p_sombra - p_prod)!,
                ev_prod: r4(p_prod - p_mkt)!,
                ev_sombra: r4(p_sombra - p_mkt)!,
              })
            })
          }
          continue
        }

        contratos.forEach((c, i) => {
          const o = outcomeReal(c.tipo!, c.valor!, real)
          if (o == null) return
          rows.push({
            fecha,
            slot,
            slug: city.slug || '?',
            tipo: c.tipo!,
            p_prod: Math.max(0, Math.min(1, c.prob_ia_norm!)),
            p_sombra: Math.max(0, Math.min(1, norm[i])),
            p_mkt: Math.max(0, Math.min(1, c.prob_mkt! / 100)),
            o,
          })
        })
      }
    }

    if (!rows.length) return emptySummary(dias)

    const fechas = [...new Set(rows.map(r => r.fecha))].sort()

    // 4) Agregados
    const porSlot: Record<string, DueloAgg> = {}
    for (const slot of ['10PM', '11PM']) {
      porSlot[slot] = agg(rows.filter(r => r.slot === slot))
    }

    // Segmentos: backtest (in-sample) vs vivo (out-of-sample)
    const rowsBack = rows.filter(r => r.fecha < SHADOW_FECHA_CONGELADA)
    const rowsVivo = rows.filter(r => r.fecha >= SHADOW_FECHA_CONGELADA)
    const pendientesVivo = pendientes.filter(p => p.fecha >= SHADOW_FECHA_CONGELADA).length

    // 5) Serie diaria
    const porFecha = new Map<string, Row[]>()
    for (const r of rows) {
      if (!porFecha.has(r.fecha)) porFecha.set(r.fecha, [])
      porFecha.get(r.fecha)!.push(r)
    }
    const porDia: DueloDia[] = []
    for (const fecha of Array.from(porFecha.keys()).sort()) {
      const sub = porFecha.get(fecha)!
      const a = agg(sub)
      if (a.brier_prod == null || a.brier_sombra == null || a.brier_mkt == null || a.delta == null) continue
      porDia.push({
        fecha,
        n: a.n,
        brier_prod: a.brier_prod,
        brier_sombra: a.brier_sombra,
        brier_mkt: a.brier_mkt,
        delta: a.delta,
      })
    }

    // 6) Por ciudad (ordenado por delta: la sombra más útil primero)
    const porCiudadSlug = new Map<string, Row[]>()
    for (const r of rows) {
      if (!porCiudadSlug.has(r.slug)) porCiudadSlug.set(r.slug, [])
      porCiudadSlug.get(r.slug)!.push(r)
    }
    const porCiudad: DueloCiudad[] = Array.from(porCiudadSlug.entries())
      .map(([slug, sub]) => ({ slug, nombre: nameMap[slug] ?? slug, ...agg(sub) }))
      .sort((a, b) => (a.delta ?? 9) - (b.delta ?? 9))

    // 7) Stats de discordancia (solo resueltos)
    const discordantes = rows.filter(r => Math.abs(r.p_sombra - r.p_prod) > DISCORDANCIA_UMBRAL).length
    const flips = rows.filter(
      r => (r.p_prod - r.p_mkt) * (r.p_sombra - r.p_mkt) < 0
    ).length
    const absDeltas = rows.map(r => Math.abs(r.p_sombra - r.p_prod))

    return {
      ok: true,
      dias,
      n_contratos: rows.length,
      n_dias: fechas.length,
      fecha_desde: fechas[0] ?? null,
      fecha_hasta: fechas[fechas.length - 1] ?? null,
      receta: {
        nombre: SHADOW_NOMBRE,
        centro: SHADOW_CENTRO,
        distribucion: SHADOW_DISTRIBUCION,
        sigma: SHADOW_SIGMA,
        regla: SHADOW_REGLA,
        congelada: SHADOW_FECHA_CONGELADA,
      },
      global: agg(rows),
      por_slot: porSlot,
      por_segmento: {
        backtest: rowsBack.length ? agg(rowsBack) : null,
        vivo: rowsVivo.length ? agg(rowsVivo) : null,
        pendientes_vivo: pendientesVivo,
      },
      por_dia: porDia,
      por_ciudad: porCiudad,
      stats: {
        discordantes,
        pct_discordantes: r3(discordantes / rows.length),
        flips_ev: flips,
        abs_delta_medio: r4(mean(absDeltas)),
      },
      hoy: { fecha: maxFecha, pendientes },
    }
  } catch (e) {
    return emptySummary(dias, (e as Error).message)
  }
}
