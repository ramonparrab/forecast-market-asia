/**
 * Test del MÍNIMO $1 POR ESCALÓN (Polymarket no acepta órdenes < $1).
 * Verifica que NINGÚR plan devuelto por calcularLadderEmpirica /
 * calcularLadderGauss contenga un escalón con monto < $1, para cualquier
 * bankroll (incluido el bankroll efectivo reducido por régimen TRANSICIÓN).
 */
import { calcularLadderEmpirica, calcularLadderGauss, LadderContractPrice, LadderPlan } from '../src/lib/ladder'

// Contratos realistas: ancla cara + vecinos + colas baratas (patrón típico Polymarket)
const contracts: Record<number, LadderContractPrice> = {
  26: { precio: 0.02, si: 2, no: 98 },
  27: { precio: 0.10, si: 10, no: 90 },
  28: { precio: 0.35, si: 35, no: 65 },
  29: { precio: 0.38, si: 38, no: 62 }, // ← ancla (pronóstico 28.8 → 29)
  30: { precio: 0.10, si: 10, no: 90 },
  31: { precio: 0.02, si: 2, no: 98 },
}

const hist: Record<number, number> = { 0: 50, 1: 25, [-1]: 20, 2: 5 }
const nHist = 40
const valor = 28.8 // ancla en 29
const sd = 1.2

let fallos = 0

function revisar(etiqueta: string, plan: LadderPlan): void {
  if (plan.escalones.length === 0) {
    const msg = plan.motivo_no_bet ? `NO-BET: ${plan.motivo_no_bet}` : 'sin escalones'
    console.log(`  [${etiqueta}] ${msg}`)
    return
  }
  const bajo = plan.escalones.filter(e => e.monto < 1.0)
  const pass = bajo.length === 0
  if (!pass) {
    fallos++
    console.log(`  [${etiqueta}] ✗✗✗ ESCALÓN BAJO $1: ${JSON.stringify(bajo.map(e => ({ temp: e.temp, monto: e.monto })))}`)
  } else {
    const detalle = plan.escalones.map(e => `${e.temp}°:$${e.monto.toFixed(2)}${e.ancla ? '(ancla)' : ''}`).join(' ')
    console.log(`  [${etiqueta}] ✓ todos ≥ $1 → ${detalle}`)
  }
}

console.log('=== MÍNIMO $1 — LADDER EMPÍRICA (camino principal) ===')
for (const b of [1, 2, 3, 5, 10, 20, 50]) {
  const plan = calcularLadderEmpirica(valor, hist, nHist, sd, b, contracts, false)
  revisar(`bankroll $${b}`, plan)
}

console.log('\n=== MÍNIMO $1 — bankroll EFECTIVO régimen TRANSICIÓN (×0.5) ===')
for (const solicitado of [2, 4, 10, 30]) {
  const plan = calcularLadderEmpirica(valor, hist, nHist, sd, solicitado * 0.5, contracts, true)
  revisar(`solicitado $${solicitado} → efectivo $${(solicitado * 0.5).toFixed(0)}`, plan)
}

console.log('\n=== MÍNIMO $1 — LADDER GAUSS (fallback con poco historial) ===')
for (const b of [1, 2, 5, 10]) {
  const plan = calcularLadderGauss(valor, sd, b, contracts)
  revisar(`bankroll $${b}`, plan)
}

console.log('\n=== CASOS EXTREMO ===')
// Ancla barata (0.02) en mercado de precios altos: su monto proporcional no llega a $1 → NO-BET con minBankroll
const extremos: Record<number, LadderContractPrice> = {
  28: { precio: 0.55, si: 55, no: 45 },
  29: { precio: 0.02, si: 2, no: 98 }, // ← ancla baratísima (pronóstico 28.9 → 29)
  30: { precio: 0.40, si: 40, no: 60 },
}
const planExt = calcularLadderEmpirica(28.9, { 0: 70, 1: 15, [-1]: 15 }, 30, 1.0, 10, extremos, false)
revisar('ancla $0.02 con bankroll $10', planExt)

// Sin contratos cotizados → sin_contratos, no plan roto
const vacio = calcularLadderEmpirica(valor, hist, nHist, sd, 10, {}, false)
console.log(`  [priceMap vacío] ${vacio.escalones.length === 0 ? '✓ sin escalones' : '✗ ESCALONES INESPERADOS'}`)

console.log(`\n${fallos === 0 ? '✅ TODOS LOS PLANES RESPETAN EL MÍNIMO DE $1' : `❌ ${fallos} CASOS CON ESCALONES < $1`}`)
process.exit(fallos === 0 ? 0 : 1)
