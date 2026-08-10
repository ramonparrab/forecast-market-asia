export interface Escalon {
  temp: number
  p_ia: number
  p_mkt: number
  si_pct: number
  no_pct: number
  edge: number
  edge_no: number
  monto: number
  pago_si_gana: number
  ancla: boolean
  forzado?: boolean
}

export interface LadderPlan {
  inversion: number
  sd: number
  escalones: Escalon[]
  probabilidad_ganar: number
  ev: number
  peor_caso: number
  sin_contratos: boolean
  empirica: boolean
}

export const EDGE_MIN = 0.03
export const MONTO_MIN = 0.5
export const ANCLA_FRACCION = 0.15
export const FORZADO_FRACCION = 0.1

export interface LadderContractPrice {
  precio: number
  si: number
  no: number
}

function erf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z))
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return z >= 0 ? y : -y
}

export function probGaussInt(k: number, mu: number, sd: number): number {
  return Math.max(0, 0.5 * (erf((k + 0.5 - mu) / (sd * Math.SQRT2)) - erf((k - 0.5 - mu) / (sd * Math.SQRT2))))
}

function kellyShare(p: number, precio: number): number {
  return (p - precio) / (1 - precio)
}

export function roundInt(v: number): number {
  return Math.round(v + 0.05)
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Histograma de desviación ENTERA por ciudad: e = roundInt(corregida) - roundInt(real).
 * Es el patrón empírico de "se aleja -1, pega, se aleja +2..." del mejor pronóstico.
 */
export function histogramaEnteros(
  corregidas: number[],
  reales: number[],
  maxMuestras = 60
): { hist: Record<number, number>; n: number } {
  const hist: Record<number, number> = {}
  const n = Math.min(corregidas.length, reales.length, maxMuestras)
  const desde = Math.max(0, corregidas.length - n)
  for (let i = desde; i < corregidas.length; i++) {
    const e = roundInt(corregidas[i]) - roundInt(reales[i])
    hist[e] = (hist[e] || 0) + 1
  }
  return { hist, n }
}

function construirPlan(
  probs: { k: number; p: number }[],
  bankroll: number,
  contracts: Record<number, LadderContractPrice>,
  sd: number,
  empirica: boolean,
  ancla: number | null = null
): LadderPlan {
  const sinBase: LadderPlan = { inversion: 0, sd, escalones: [], probabilidad_ganar: 0, ev: 0, peor_caso: 0, sin_contratos: false, empirica }

  // Escalera centrada: el pronóstico entero (ancla) SIEMPRE entra; el resto se
  // elige por MEJOR VALOR (edge >= 0 sobre los precios de Polymarket), para
  // maximizar la ganancia con máxima cobertura y casi nunca perder.
  const base = probs.map(x => ({ k: x.k, p: x.p, c: contracts[x.k], edge: x.p - contracts[x.k].precio, ancla: false, forzado: false }))
  let rungs = base.filter(r => r.p >= 0.01 && r.c.precio >= 0.01 && r.c.precio <= 0.95 && r.edge >= (ancla != null ? 0 : EDGE_MIN))
  if (ancla != null) {
    const rA = base.find(x => x.k === ancla)
    if (rA && rA.p >= 0.01 && rA.c.precio >= 0.01 && rA.c.precio <= 0.95 && !rungs.some(x => x.k === ancla)) {
      rungs.push({ ...rA, ancla: true })
    }
    // Cobertura: el vecino del pronóstico (r±1) con P(IA) ≥ 15% entra SIEMPRE,
    // aunque el mercado lo tenga caro (sin edge) — protege el "casi nunca pierda".
    for (const k of [ancla - 1, ancla + 1]) {
      const rV = base.find(x => x.k === k)
      if (rV && rV.p >= 0.15 && rV.c.precio >= 0.01 && rV.c.precio <= 0.95 && !rungs.some(x => x.k === k)) {
        rungs.push({ ...rV, forzado: true })
      }
    }
  }
  if (rungs.length === 0) return sinBase

  let ws = rungs.map(r => ({ ...r, w: Math.max(0, kellyShare(r.p, r.c.precio)) }))
  let sumW = ws.reduce((s, x) => s + x.w, 0)
  if (sumW <= 0) return sinBase

  let montos = ws.map(x => ({ ...x, monto: (bankroll * x.w) / sumW }))

  // Pisos: ancla (pronóstico) y cubiertos (r±1 forzados) mantienen monto mínimo
  // aunque su edge sea negativo.
  const piso = (m: any) =>
    m.ancla ? Math.max(MONTO_MIN, bankroll * ANCLA_FRACCION) : m.forzado ? Math.max(MONTO_MIN, bankroll * FORZADO_FRACCION) : 0
  for (let pass = 0; pass < 6; pass++) {
    const need = montos.find(m => !(m as any).subio && m.monto < piso(m))
    if (!need) break
    const deficit = piso(need) - need.monto
    const otros = montos.filter(m => m !== need && !(m as any).ancla && !(m as any).forzado && m.monto > 0)
    const sumOtros = otros.reduce((s, m) => s + m.monto, 0)
    if (sumOtros <= 0) break
    need.monto = piso(need)
    ;(need as any).subio = true
    for (const m of otros) m.monto = Math.max(0, m.monto - (deficit * m.monto) / sumOtros)
  }

  const bajoMinimo = montos.some(m => m.monto > 0 && m.monto < MONTO_MIN && !(m as any).ancla && !(m as any).forzado)
  if (bajoMinimo && montos.length > 1) {
    montos = montos.filter(m => (m as any).ancla || (m as any).forzado || m.monto >= MONTO_MIN)
    if (montos.length) {
      const s2 = montos.reduce((s, x) => s + x.monto, 0)
      montos = montos.map(m => ({ ...m, monto: (bankroll * m.monto) / s2 }))
    }
  }

  const total = montos.reduce((s, x) => s + x.monto, 0)
  if (Math.abs(total - bankroll) > 0.5 && montos.length) {
    const maxEdge = Math.max(...montos.map(m => m.edge))
    montos = montos.map(m =>
      m.edge === maxEdge && m.monto > 0 ? { ...m, monto: m.monto + (bankroll - total) } : m
    )
  }

  const escalones: Escalon[] = montos.map(m => ({
    temp: m.k,
    p_ia: round2(m.p),
    p_mkt: round2(m.c.precio),
    si_pct: m.c.si,
    no_pct: m.c.no,
    edge: round2(m.edge * 100),
    edge_no: round2(((1 - m.p) - m.c.no / 100) * 100),
    monto: round2(m.monto),
    pago_si_gana: round2(m.monto / m.c.precio),
    ancla: !!(m as any).ancla,
    forzado: !!(m as any).forzado,
  }))

  const probabilidad_ganar = round2(montos.reduce((s, m) => s + m.p, 0))
  const inversion = round2(montos.reduce((s, m) => s + m.monto, 0))
  const ev = round2(montos.reduce((s, m) => s + m.p * (m.monto / m.c.precio), 0) - inversion)

  return { inversion, sd, escalones, probabilidad_ganar, ev, peor_caso: round2(-inversion), sin_contratos: false, empirica }
}

/**
 * LADDER con distribución GAUSSIANA (épsilon σ según régimen).
 * Útil como fallback con poco historial.
 */
export function calcularLadderGauss(
  corregida: number,
  sd: number,
  bankroll: number,
  contracts: Record<number, LadderContractPrice>
): LadderPlan {
  const temps = Object.keys(contracts).map(Number).sort((a, b) => a - b)
  const probs = temps.map(k => ({ k, p: probGaussInt(k, corregida, sd) }))
  return construirPlan(probs, bankroll, contracts, sd, false, roundInt(corregida))
}

/**
 * LADDER EMPÍRICO por ciudad: distribución = histograma de desviación entera del
 * mejor modelo (KALMAN/MC) sobre el historial. En TRANSICIÓN se mezcla 50/50 con
 * gaussiana σ amplia para absorber frentes. En ESTABLE se usa el histograma puro.
 */
export function calcularLadderEmpirica(
  corregida: number,
  hist: Record<number, number>,
  nHist: number,
  sd: number,
  bankroll: number,
  contracts: Record<number, LadderContractPrice>,
  mezclaGauss: boolean
): LadderPlan {
  const r = roundInt(corregida)
  const temps = Object.keys(contracts).map(Number).sort((a, b) => a - b)
  const probs = temps.map(k => {
    const e = k - r
    const pEmp = nHist > 0 ? (hist[e] ?? 0) / nHist : 0
    const p = mezclaGauss ? 0.5 * pEmp + 0.5 * probGaussInt(k, corregida, sd) : pEmp
    return { k, p }
  })
  return construirPlan(probs, bankroll, contracts, sd, true, r)
}