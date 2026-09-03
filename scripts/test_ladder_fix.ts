/**
 * Test del fix de signo en calcularLadderEmpirica + roundInt.
 * Usa los histogramas REALES capturados de la API en vivo (sep-2026)
 * y verifica el mapeo corregido P(real=k) = hist[r-k].
 */
import { calcularLadderEmpirica, roundInt, histogramaEnteros, LadderContractPrice } from '../src/lib/ladder'

// Datos reales de la API en vivo (hist_error_entero en % → fracciones)
const CASOS: {
  city: string
  valor: number
  histPct: Record<number, number>
  contracts: Record<number, LadderContractPrice>
}[] = [
  {
    city: 'seoul',
    valor: 29.25,
    histPct: { 0: 54, 1: 35, 2: 4, [-2]: 4, [-1]: 8 },
    contracts: {
      28: { precio: 0.04, si: 4, no: 96 },
      29: { precio: 0.40, si: 40, no: 60 },
      30: { precio: 0.40, si: 40, no: 60 },
      31: { precio: 0.12, si: 12, no: 88 },
    },
  },
  {
    city: 'chengdu',
    valor: 32.49,
    histPct: { 0: 18, 1: 6, 2: 18, [-3]: 18, [-2]: 18, [-1]: 24 },
    contracts: {
      31: { precio: 0.08, si: 8, no: 92 },
      32: { precio: 0.50, si: 50, no: 50 },
      33: { precio: 0.20, si: 20, no: 80 },
      34: { precio: 0.18, si: 18, no: 82 },
    },
  },
  {
    city: 'wuhan',
    valor: 27.69,
    histPct: { 0: 11, 1: 11, 2: 7, [-2]: 11, [-1]: 59 },
    contracts: {
      26: { precio: 0.10, si: 10, no: 90 },
      27: { precio: 0.10, si: 10, no: 90 },
      28: { precio: 0.30, si: 30, no: 70 },
      29: { precio: 0.40, si: 40, no: 60 },
    },
  },
]

// 1) roundInt estándar
console.log('=== roundInt ===')
const casos = [[32.49, 32], [27.69, 28], [29.25, 29], [32.5, 33], [31.46, 31], [33.08, 33]]
let ok = true
for (const [v, esperado] of casos) {
  const got = roundInt(v)
  const pass = got === esperado
  ok = ok && pass
  console.log(`  roundInt(${v}) = ${got} (esperado ${esperado}) ${pass ? '✓' : '✗'}`)
}

// 2) histogramaEnteros autoconsistencia (redondeo estándar en ambos lados)
console.log('\n=== histogramaEnteros ===')
const hist = histogramaEnteros([30.49, 29.8, 28.2], [30, 30, 28], 10)
// e = round(30.49)-round(30) = 30-30 = 0 ; round(29.8)-round(30) = 30-30 = 0 ; round(28.2)-28 = 0
console.log('  hist de [30.49,29.8,28.2] vs [30,30,28]:', JSON.stringify(hist), '(esperado {0:3})')

// 3) Ladder empírica con signo corregido
console.log('\n=== calcularLadderEmpirica (signo corregido) ===')
for (const c of CASOS) {
  const hist: Record<number, number> = {}
  const n = Object.values(c.histPct).reduce((s, v) => s + v, 0)
  for (const [e, pct] of Object.entries(c.histPct)) {
    hist[Number(e)] = Math.round((pct / 100) * n) // reconstruye conteos
  }
  const plan = calcularLadderEmpirica(c.valor, hist, n, 1.0, 10, c.contracts, false)
  const r = roundInt(c.valor)
  console.log(`  ${c.city}: valor=${c.valor}, ancla r=${r}`)
  // verificación manual del mapeo
  for (const k of Object.keys(c.contracts).map(Number)) {
    const esperado = (hist[r - k] ?? 0) / n
    const esc = plan.escalones.find(e => e.temp === k)
    const got = esc ? esc.p_ia : null
    // escalones no incluidos → no verificables directo, verificamos los incluidos
    if (esc) {
      const pass = Math.abs(got! - esperado) < 0.015
      ok = ok && pass
      console.log(`    P(real=${k}) = ${got} (esperado hist[${r - k}]/n = ${esperado.toFixed(2)}) ${pass ? '✓' : '✗'}`)
    }
  }
  console.log(`    → escalones: ${plan.escalones.map(e => `${e.temp}°($${e.monto}, p_ia ${e.p_ia})`).join(' · ')}`)
  console.log(`    → inv=$${plan.inversion} P(ganar)=${plan.probabilidad_ganar} EV=$${plan.ev}`)
}

console.log(`\n${ok ? 'TODOS LOS CHECKS PASARON ✓' : 'HAY FALLOS ✗'}`)
process.exit(ok ? 0 : 1)
