import { BetRecommendation } from '@/types'

const BANKROLL_DIARIO = 10.0
const KELLY_FRACTION = 0.25
const MAX_PER_BET = 5.0
const MIN_PER_BET = 1.0
const MIN_EDGE = 6.0
const MAX_BANKROLL_PCT = 0.10

/**
 * Kelly criterion fractional bet sizing.
 * f* = (p * odds - q) / odds  (fractional Kelly)
 */
export function kellyBetSize(
  probIA: number,
  probMkt: number,
  bankroll: number
): number {
  const p = probIA / 100
  const q = 1 - p
  // Fair odds from market
  const odds = 1 / (probMkt / 100)

  // Full Kelly: f* = (p * odds - q) / odds
  let f = (p * odds - q) / odds

  // Truncate extreme values
  f = Math.max(0, Math.min(f, MAX_BANKROLL_PCT))

  // Fractional Kelly
  return f * KELLY_FRACTION * bankroll
}

/**
 * Calculate allocation distribution for $10 daily budget.
 */
export function calculateAllocation(
  recommendations: BetRecommendation[],
  presupuesto: number = BANKROLL_DIARIO
): BetRecommendation[] {
  // Filter candidates
  const candidates = recommendations.filter(r => {
    const edgeOk = r.edge > MIN_EDGE
    const consensoOk = r.consenso === 'MUY FUERTE' || r.consenso === 'FUERTE'
    const arbOk = r.arbitraje !== 'ALTO'
    return edgeOk && consensoOk && arbOk
  })

  if (candidates.length === 0) return []

  // Weight by edge * consensus factor * arb penalty * exito_pct
  for (const r of candidates) {
    let peso = r.edge
    if (r.consenso === 'MUY FUERTE') peso *= 1.4
    if (r.consenso === 'FUERTE') peso *= 1.2
    if (r.arbitraje === 'ALTO') peso *= 0.7
    if (r.exito_pct) peso *= (r.exito_pct / 50)
    r.peso = peso
  }

  const totalPeso = candidates.reduce((s, r) => s + (r.peso ?? 0), 0)
  if (totalPeso === 0) return []

  // Proportional allocation
  for (const r of candidates) {
    r.monto = (r.peso! / totalPeso) * presupuesto
    // Clamp
    r.monto = Math.max(MIN_PER_BET, Math.min(MAX_PER_BET, r.monto))
    r.monto = Math.round(r.monto * 100) / 100
  }

  // Scale down if total exceeds budget
  let totalAsignado = candidates.reduce((s, r) => s + r.monto, 0)
  if (totalAsignado > presupuesto) {
    const factor = presupuesto / totalAsignado
    for (const r of candidates) {
      r.monto = Math.round(r.monto * factor * 100) / 100
    }
  }

  return candidates.sort((a, b) => b.monto - a.monto)
}

/**
 * Dummy implementation of calculateAllocationDiario for compatibility.
 */
export function calcularAllocationDiario(
  recomendaciones: BetRecommendation[],
  presupuestoMax: number = BANKROLL_DIARIO
): BetRecommendation[] {
  return calculateAllocation(recomendaciones, presupuestoMax)
}
