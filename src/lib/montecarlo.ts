import { ModelTemps } from '@/types'
import { boxMullerRandom } from './math-utils'

/**
 * Monte Carlo simulation with ensemble member sampling + Gaussian noise.
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
    // Fallback: pure Gaussian
    for (let i = 0; i < sims; i++) {
      muestras.push(boxMullerRandom(tempCorregida, volatilidad))
    }
  } else {
    for (let i = 0; i < sims; i++) {
      const base = modelosTemps[Math.floor(Math.random() * modelosTemps.length)]
      const ruido = boxMullerRandom(0, volatilidad * 0.6)
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
