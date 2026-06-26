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
  backtestBiasCorrection?: number
  ensembleMembers?: number[]
}

export function computeEnsemble(input: EnsembleInput): ForecastResult {
  const { slug, mes, modelsRaw, recentErrors, recentModelErrors, ensembleMembers } = input

  let modelos = Object.keys(modelsRaw)
  let numModelos = modelos.length

  if (numModelos < 2) {
    return {
      temp_ponderada: 21.0,
      temp_corregida: 21.0,
      volatilidad: 2.0,
      consenso: 'FALLBACK',
      ensemble_raw: modelsRaw,
      sesgo_aplicado: 0,
      ensemble_members: ensembleMembers,
    }
  }

  // Z-score anomaly filter: exclude models >3σ from ensemble mean
  if (numModelos >= 3) {
    const temps = modelos.map(m => modelsRaw[m])
    const m = mean(temps)
    const s = Math.max(std(temps), 0.5)
    const filtered: string[] = []
    for (const model of modelos) {
      const z = Math.abs(modelsRaw[model] - m) / s
      if (z <= 3.0) {
        filtered.push(model)
      }
    }
    if (filtered.length >= 2) {
      modelos = filtered
      numModelos = filtered.length
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

  if (input.backtestBiasCorrection !== undefined && Math.abs(input.backtestBiasCorrection) >= 0.15) {
    tempCorregida = Math.max(0, tempCorregida + input.backtestBiasCorrection)
  }

  // Spread & volatility (using Z-score filtered models)
  const filteredTemps = modelos.map(m => modelsRaw[m])
  const spread = Math.max(...filteredTemps) - Math.min(...filteredTemps)
  const stdDev = std(filteredTemps)
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
    ensemble_members: ensembleMembers,
  }
}

export function ensembleEmpiricalCDF(
  members: number[],
  threshold: number
): number {
  const n = members.length
  if (n === 0) return 0.5
  const countBelow = members.filter(m => m < threshold).length
  let p = countBelow / n
  p = Math.max(1 / (n + 1), Math.min(1 - 1 / (n + 1), p))
  return p
}

export function ensembleEmpiricalProbInRange(
  members: number[],
  low: number,
  high: number
): number {
  const n = members.length
  if (n === 0) return 0.5
  const countIn = members.filter(m => m >= low && m <= high).length
  let p = countIn / n
  p = Math.max(1 / (n + 1), Math.min(1 - 1 / (n + 1), p))
  return p
}
