import { ModelTemps, ForecastResult } from '@/types'
import { std, mean } from './math-utils'
import { computeDynamicBias, computeAdaptiveWeights } from './bias-correction'
import { getEstacion } from './cities'

interface EnsembleInput {
  slug: string
  mes: number
  modelsRaw: ModelTemps
  recentErrors: { error: number }[]
  recentModelErrors: Record<string, number[]>
  backtestBiasCorrection?: number // second-order correction from 180-day backtest
}

export function computeEnsemble(input: EnsembleInput): ForecastResult {
  const { slug, mes, modelsRaw, recentErrors, recentModelErrors } = input

  const modelos = Object.keys(modelsRaw)
  const numModelos = modelos.length

  if (numModelos < 2) {
    return {
      temp_ponderada: 21.0,
      temp_corregida: 21.0,
      volatilidad: 2.0,
      consenso: 'FALLBACK',
      ensemble_raw: modelsRaw,
      sesgo_aplicado: 0,
    }
  }

  // Adaptive weights based on historical model performance
  const adaptiveWeights = computeAdaptiveWeights(modelos, recentModelErrors)

  // Weighted temperature
  let tempPonderada = 0
  let pesoTotal = 0
  for (const model of modelos) {
    const w = adaptiveWeights[model] ?? (1 / numModelos)
    tempPonderada += modelsRaw[model] * w
    pesoTotal += w
  }
  tempPonderada /= pesoTotal

  // Dynamic bias correction
  const sesgo = computeDynamicBias(slug, mes, recentErrors)
  let tempCorregida = Math.max(0, tempPonderada - sesgo)

  // Second-order correction from 180-day backtest
  // backtestBiasCorrection = mean(actual - forecast). Positive = we under-predicted → add temp
  if (input.backtestBiasCorrection !== undefined && Math.abs(input.backtestBiasCorrection) >= 0.15) {
    tempCorregida = Math.max(0, tempCorregida + input.backtestBiasCorrection)
  }

  // Spread & volatility
  const temps = Object.values(modelsRaw)
  const spread = Math.max(...temps) - Math.min(...temps)
  const stdDev = std(temps)
  const volatilidad = Math.max(0.9, Math.min(stdDev * 1.75, 5.2))

  // Consensus
  let consenso: string
  if (numModelos >= 5 && spread <= 1.8) {
    consenso = 'MUY FUERTE'
  } else if (numModelos >= 3 && spread <= 2.8) {
    consenso = 'FUERTE'
  } else if (numModelos >= 2 && spread <= 3.5) {
    consenso = 'ACEPTABLE'
  } else {
    consenso = 'DEBIL'
  }

  return {
    temp_ponderada: Math.round(tempPonderada * 100) / 100,
    temp_corregida: Math.round(tempCorregida * 100) / 100,
    volatilidad,
    consenso,
    ensemble_raw: modelsRaw,
    sesgo_aplicado: Math.round(sesgo * 100) / 100,
  }
}
