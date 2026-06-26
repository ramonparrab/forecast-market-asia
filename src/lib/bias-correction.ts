import { getEstacion } from './cities'
import { HistoricalRecord } from '@/types'

// Static initial biases from 3-year backtest (fallback when no history exists)
const SESGOS_INICIALES: Record<string, Record<string, number>> = {
  beijing:     { Invierno: 0.8975, Otoño: 0.7959, Primavera: 0.9013, Verano: 0.6336 },
  chengdu:     { Invierno: 0.8127, Otoño: 0.7313, Primavera: 0.8257, Verano: 1.0290 },
  chongqing:   { Invierno: 0.8361, Otoño: 0.7502, Primavera: 0.9015, Verano: 0.7730 },
  'hong-kong': { Invierno: 0.9213, Otoño: 0.7974, Primavera: 0.7893, Verano: 0.7446 },
  seoul:       { Invierno: 0.7205, Otoño: 0.7132, Primavera: 0.7271, Verano: 0.8140 },
  shanghai:    { Invierno: 0.8020, Otoño: 0.8804, Primavera: 0.7341, Verano: 0.8045 },
  shenzhen:    { Invierno: 0.7759, Otoño: 0.7440, Primavera: 0.7905, Verano: 0.7998 },
  tokyo:       { Invierno: 0.7943, Otoño: 0.8630, Primavera: 0.7397, Verano: 0.8896 },
  wuhan:       { Invierno: 0.8727, Otoño: 0.7840, Primavera: 0.6502, Verano: 0.9067 },
}

// Exponential moving average factor (higher = more weight on recent)
const EMA_ALPHA = 0.3

// Minimum samples before we trust dynamic bias over static
const MIN_SAMPLES_DYNAMIC = 10

export function getStaticBias(slug: string, mes: number): number {
  const estacion = getEstacion(mes)
  return SESGOS_INICIALES[slug]?.[estacion] ?? 0.8
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

  // Take most recent errors up to maxSamples
  const recent = recentErrors.slice(-maxSamples)
  const errors = recent.map(r => r.error)

  // EMA
  let ema = errors[0]
  for (let i = 1; i < errors.length; i++) {
    ema = EMA_ALPHA * errors[i] + (1 - EMA_ALPHA) * ema
  }

  // Blend with static bias when not enough data
  const weight = Math.min(1, recentErrors.length / 50)
  return weight * ema + (1 - weight) * staticBias
}

/**
 * Compute adaptive model weights based on recent performance.
 * Models with lower MAE get higher weight.
 */
export function computeAdaptiveWeights(
  modelosDisponibles: string[],
  recentModelErrors: Record<string, number[]>
): Record<string, number> {
  if (!recentModelErrors || Object.keys(recentModelErrors).length === 0) {
    // Default weights
    const w: Record<string, number> = {}
    modelosDisponibles.forEach(m => { w[m] = 1 / modelosDisponibles.length })
    return w
  }

  // Compute MAE per model
  const maes: Record<string, number> = {}
  for (const [model, errors] of Object.entries(recentModelErrors)) {
    if (errors.length > 0) {
      maes[model] = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length
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
      weights[model] = 0.5 // unknown model gets low weight
    }
  }

  // Normalize
  const total = Object.values(weights).reduce((s, v) => s + v, 0)
  for (const model of Object.keys(weights)) {
    weights[model] /= total
  }

  return weights
}
