import { getEstacion } from './cities'
import { HistoricalRecord } from '@/types'

// Static initial biases — zeroed out; dynamic bias takes over quickly with MIN_SAMPLES_DYNAMIC=3
const SESGOS_INICIALES: Record<string, Record<string, number>> = {
  beijing:     { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
  chengdu:     { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
  chongqing:   { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
  'hong-kong': { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
  seoul:       { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
  shanghai:    { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
  shenzhen:    { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
  tokyo:       { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
  wuhan:       { Invierno: 0, Otoño: 0, Primavera: 0, Verano: 0 },
}

// Exponential moving average factor (higher = more weight on recent)
const EMA_ALPHA = 0.3

// Minimum samples before we trust dynamic bias over static (lower = faster adaptation)
const MIN_SAMPLES_DYNAMIC = 3

export function getStaticBias(slug: string, mes: number): number {
  const estacion = getEstacion(mes)
  return SESGOS_INICIALES[slug]?.[estacion] ?? 0
}

/**
 * Compute dynamic bias using exponential moving average of recent errors.
 * If insufficient history, falls back to static seasonal bias.
 */
export function computeDynamicBias(
  slug: string,
  mes: number,
  recentErrors: { error: number }[],
  maxSamples = 30
): number {
  const staticBias = getStaticBias(slug, mes)

  if (!recentErrors || recentErrors.length < MIN_SAMPLES_DYNAMIC) {
    return staticBias
  }

  // Take most recent errors, reverse to chronological order (old→new)
  const chrono = recentErrors.slice(0, maxSamples).reverse()
  const errors = chrono.map(r => r.error)

  // EMA from old to new: newest errors get highest weight
  let ema = errors[0]
  for (let i = 1; i < errors.length; i++) {
    ema = EMA_ALPHA * errors[i] + (1 - EMA_ALPHA) * ema
  }

  // Full weight at 20 samples (converges faster)
  const weight = Math.min(1, recentErrors.length / 20)
  return weight * ema + (1 - weight) * staticBias
}

/**
 * Compute adaptive model weights based on recent performance.
 * Uses EWMA (Exponentially Weighted Moving Average) to weight recent errors more heavily.
 * Models with lower EWMA-weighted MAE get higher weight.
 */
export function computeAdaptiveWeights(
  modelosDisponibles: string[],
  recentModelErrors: Record<string, number[]>
): Record<string, number> {
  if (!recentModelErrors || Object.keys(recentModelErrors).length === 0) {
    const w: Record<string, number> = {}
    modelosDisponibles.forEach(m => { w[m] = 1 / modelosDisponibles.length })
    return w
  }

  // EWMA decay factor: higher = more weight on recent errors
  const EWMA_ALPHA = 0.15

  // Compute EWMA-weighted MAE per model
  const maes: Record<string, number> = {}
  for (const [model, errors] of Object.entries(recentModelErrors)) {
    if (errors.length > 0) {
      const absErrors = errors.map(e => Math.abs(e))
      // EWMA: recent errors decay exponentially
      let ewma = absErrors[0]
      for (let i = 1; i < absErrors.length; i++) {
        ewma = EWMA_ALPHA * absErrors[i] + (1 - EWMA_ALPHA) * ewma
      }
      maes[model] = ewma
    }
  }

  if (Object.keys(maes).length === 0) {
    const w: Record<string, number> = {}
    modelosDisponibles.forEach(m => { w[m] = 1 / modelosDisponibles.length })
    return w
  }

  // Convert MAE to weights (inverse: lower MAE = higher weight)
  const weights: Record<string, number> = {}
  for (const model of modelosDisponibles) {
    if (maes[model] !== undefined) {
      weights[model] = 1 / (maes[model] + 0.1) // avoid division by zero
    } else {
      weights[model] = 0.5
    }
  }

  // Normalize
  const total = Object.values(weights).reduce((s, v) => s + v, 0)
  for (const model of Object.keys(weights)) {
    weights[model] /= total
  }

  return weights
}
