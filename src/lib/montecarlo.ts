import { ModelTemps } from '@/types'

/**
 * Student-t random sample (ν = 4 for fatter tails).
 * Bailey (1994) method: Z / sqrt(V/ν) where Z ~ N(0,1), V ~ χ²(ν)
 */
function studentTRandom(df: number = 4): number {
  let u1 = 0, u2 = 0
  while (u1 === 0) u1 = Math.random()
  while (u2 === 0) u2 = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)

  // χ² with ν degrees of freedom via Gamma(ν/2, 2)
  let chiSq = 0
  for (let i = 0; i < df; i++) {
    let u = 0
    while (u === 0) u = Math.random()
    chiSq += Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * Math.random()) ** 2
  }

  return z / Math.sqrt(chiSq / df)
}

/**
 * Monte Carlo simulation with ensemble member sampling + Student-t noise (ν=4).
 * Student-t produces fatter tails than Gaussian, better calibrating extreme
 * temperature events that Polymarket often misprices.
 */
export function monteCarloProbability(
  ensembleRaw: ModelTemps,
  tempCorregida: number,
  volatilidad: number,
  sims: number,
  tipo: 'exacto' | 'superior' | 'inferior' | 'rango',
  valor: number | [number, number]
): number {
  const modelosTemps = Object.values(ensembleRaw)
  const muestras: number[] = []

  if (modelosTemps.length === 0) {
    for (let i = 0; i < sims; i++) {
      muestras.push(tempCorregida + studentTRandom(4) * volatilidad)
    }
  } else {
    for (let i = 0; i < sims; i++) {
      const base = modelosTemps[Math.floor(Math.random() * modelosTemps.length)]
      // Student-t noise with ν=4 → fatter tails than Gaussian ×0.6
      const ruido = studentTRandom(4) * volatilidad * 0.6
      muestras.push(base + ruido)
    }
  }

  let hits: number
  switch (tipo) {
    case 'exacto': {
      const v = valor as number
      hits = muestras.filter(t => Math.abs(t - v) <= 0.5).length
      break
    }
    case 'superior': {
      const v = valor as number
      hits = muestras.filter(t => t >= v - 0.5).length
      break
    }
    case 'inferior': {
      const v = valor as number
      hits = muestras.filter(t => t <= v + 0.5).length
      break
    }
    case 'rango': {
      const [low, high] = valor as [number, number]
      hits = muestras.filter(t => (low - 0.5) <= t && t <= (high + 0.5)).length
      break
    }
    default:
      hits = 0
  }

  return hits / sims
}

/**
 * Normalize raw probabilities so they sum to 1.
 */
export function normalizeProbabilidades(rawProbs: number[]): number[] {
  const sum = rawProbs.reduce((s, v) => s + v, 0)
  if (sum === 0) return rawProbs.map(() => 1 / rawProbs.length)
  return rawProbs.map(p => p / sum)
}
