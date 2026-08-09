export interface Escalon {
  temp: number
  p_ia: number
  p_mkt: number
  edge: number
  monto: number
  pago_si_gana: number
}

export interface LadderPlan {
  inversion: number
  sd: number
  escalones: Escalon[]
  probabilidad_ganar: number
  ev: number
  peor_caso: number
  sin_contratos: boolean
}

export const EDGE_MIN = 0.03
export const MONTO_MIN = 0.5

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
 * LADDER BETTING — construye la escalera de apuestas sobre contratos exactos.
 * Distribución: gaussiana centrada en temp_corregida (engine 10PM/11PM) con
 * σ según régimen. Entra cada entero con edge = P(IA) - precio >= EDGE_MIN.
 * Monto por escalón ∝ Kelly normalizado × bankroll. P(ganar algo) = Σ P(IA) de escalones.
 */
export function calcularLadder(
  corregida: number,
  sd: number,
  bankroll: number,
  priceMap: Record<number, number>
): LadderPlan {
  const temps = Object.keys(priceMap)
    .map(Number)
    .sort((a, b) => a - b)
    .filter(k => priceMap[k] >= 0.01 && priceMap[k] <= 0.95)

  if (temps.length === 0) {
    return { inversion: 0, sd, escalones: [], probabilidad_ganar: 0, ev: 0, peor_caso: 0, sin_contratos: true }
  }

  const probs = new Map<number, number>()
  for (const k of temps) probs.set(k, probGaussInt(k, corregida, sd))

  // Escalones candidatos con edge >= EDGE_MIN
  let rungs = temps
    .map(k => ({ k, p: probs.get(k) as number, precio: priceMap[k], edge: (probs.get(k) as number) - priceMap[k] }))
    .filter(r => r.p >= 0.01 && r.edge >= EDGE_MIN)

  if (rungs.length === 0) {
    return { inversion: 0, sd, escalones: [], probabilidad_ganar: 0, ev: 0, peor_caso: 0, sin_contratos: false }
  }

  // Montos Kelly normalizados a bankroll, con mínimo por escalón
  let ws = rungs.map(r => ({ k: r.k, p: r.p, precio: r.precio, edge: r.edge, w: Math.max(0, kellyShare(r.p, r.precio)) }))
  let sumW = ws.reduce((s, x) => s + x.w, 0)

  if (sumW <= 0) {
    return { inversion: 0, sd, escalones: [], probabilidad_ganar: 0, ev: 0, peor_caso: 0, sin_contratos: false }
  }

  let montos = ws.map(x => ({ ...x, monto: (bankroll * x.w) / sumW }))

  // Quitar escalones que queden bajo el mínimo y re-normalizar
  const bajoMinimo = montos.some(m => m.monto > 0 && m.monto < MONTO_MIN)
  if (bajoMinimo && montos.length > 1) {
    montos = montos.filter(m => m.monto >= MONTO_MIN)
    if (montos.length) {
      const s2 = montos.reduce((s, x) => s + x.monto, 0)
      montos = montos.map(m => ({ ...m, monto: (bankroll * m.monto) / s2 }))
    }
  }

  // Ajuste fino: que la suma sea exactamente bankroll (el excedente va al mayor edge)
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
    p_mkt: round2(m.precio),
    edge: round2(m.edge * 100),
    monto: round2(m.monto),
    pago_si_gana: round2(m.monto / m.precio),
  }))

  const probabilidad_ganar = round2(montos.reduce((s, m) => s + m.p, 0))
  const inversion = round2(montos.reduce((s, m) => s + m.monto, 0))
  const ev = round2(montos.reduce((s, m) => s + m.p * (m.monto / m.precio), 0) - inversion)

  return { inversion, sd, escalones, probabilidad_ganar, ev, peor_caso: round2(-inversion), sin_contratos: false }
}