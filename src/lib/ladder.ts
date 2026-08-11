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
  motivo_no_bet?: string
}

export const EDGE_MIN = 0.03
export const MONTO_MIN = 0.5
export const LIMITE_SUMA_PRECIOS = 0.95

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

  // Escalera NO-PERDER: montos proporcionales al % de cada contrato en Polymarket
  // (más dinero a los % más altos). Con Σ precios < 100% cada escalón paga
  // igual: bankroll / Σp > bankroll → NUNCA se pierde si el real cae en la escalera.
  const base = probs.map(x => ({ k: x.k, p: x.p, c: contracts[x.k], edge: x.p - contracts[x.k].precio, ancla: false, forzado: false }))
  let rungs = base.filter(r => r.p >= 0.01 && r.c.precio >= 0.01 && r.c.precio <= 0.95 && r.edge >= (ancla != null ? 0 : EDGE_MIN))
  if (ancla != null) {
    const rA = base.find(x => x.k === ancla)
    if (rA && rA.p >= 0.01 && rA.c.precio >= 0.01 && rA.c.precio <= 0.95) {
      // El pronóstico se marca SIEMPRE como ancla (no dropeable): aunque entre por
      // edge propio, la regla de viabilidad (Σ ≤ 95%) NO puede expulsarlo.
      const yaEnRungs = rungs.some(x => x.k === ancla)
      rungs = yaEnRungs ? rungs.map(r => (r.k === ancla ? { ...r, ancla: true } : r)) : [...rungs, { ...rA, ancla: true }]
    }
    for (const k of [ancla - 1, ancla + 1]) {
      const rV = base.find(x => x.k === k)
      if (rV && rV.p >= 0.15 && rV.c.precio >= 0.01 && rV.c.precio <= 0.95) {
        // Los vecinos ±1 con P≥15% se marcan SIEMPRE como cobertura (no dropeables),
        // aunque ya hayan entrado por edge propio: la regla Σ ≤ 95% no puede deshacerlos.
        const yaEnRungs = rungs.some(x => x.k === k)
        rungs = yaEnRungs ? rungs.map(r => (r.k === k && !r.forzado ? { ...r, forzado: true } : r)) : [...rungs, { ...rV, forzado: true }]
      }
    }
  }
  if (rungs.length === 0) return sinBase

  // Regla de viabilidad: si Σ precios > 95% no se puede garantizar no-perder con
  // todos; se descartan los escalones de peor valor (edge más bajo) que no sean
  // ancla/cobertura. Si ni aun así cabe → NO-BET (descartado el día).
  let sel = [...rungs]
  for (;;) {
    const sumP = sel.reduce((s, r) => s + r.c.precio, 0)
    if (sumP <= LIMITE_SUMA_PRECIOS) break
    const dropeables = sel.filter(r => !r.ancla && !r.forzado)
    if (!dropeables.length) {
      return { ...sinBase, motivo_no_bet: 'Σ precios de ancla+cobertura > 95% — imposible garantizar no-perder hoy. Día descartado.' }
    }
    const peor = dropeables.reduce((a, b) => (a.edge < b.edge ? a : b))
    sel = sel.filter(r => r !== peor)
  }
  if (sel.length === 0) return sinBase

  let sumP = sel.reduce((s, r) => s + r.c.precio, 0)
  // En modo NO-PERDER se mantienen TODOS los escalones seleccionados: un escalón
  // barato (1¢, monto $0.11) cubre otro resultado a precio de mercado — seguro gratis.
  const montos = sel.map(x => ({ ...x, monto: (bankroll * x.c.precio) / sumP }))

  const total = montos.reduce((s, x) => s + x.monto, 0)
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
  const inversion = round2(total)
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