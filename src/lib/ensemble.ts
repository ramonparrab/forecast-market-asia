import { ModelTemps, ForecastResult, WeatherCondition } from '@/types'
import { std, mean } from './math-utils'
import { computeDynamicBias, computeAdaptiveWeights } from './bias-correction'
import { getEstacion } from './cities'
import { getWeatherInfo } from './openmeteo'

interface EnsembleInput {
  slug: string
  mes: number
  modelsRaw: ModelTemps
  recentErrors: { error: number }[]
  recentModelErrors: Record<string, number[]>
  backtestBiasCorrection?: number
  ensembleMembers?: number[]
  weatherCode?: number
  precipitation?: number
}

export function computeEnsemble(input: EnsembleInput): ForecastResult {
  const { slug, mes, modelsRaw, recentErrors, recentModelErrors, ensembleMembers } = input

  let modelos = Object.keys(modelsRaw)
  let numModelos = modelos.length

  if (numModelos < 2) {
    // 0 modelos → último recurso (no debería llegar aquí: openmeteo.ts ya
    // aplica fallback TWC cuando Open-Meteo falla por completo)
    if (numModelos === 0) {
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
    // 1 solo modelo (p.ej. fallback TWC por 429 de Open-Meteo, o respuesta
    // parcial de la API) → ese modelo ES la base. Antes esto devolvía 21°C
    // hardcodeado: con un modelo válido en mano era basura para el pronóstico.
    const singleTemp = modelsRaw[modelos[0]]
    if (typeof singleTemp === 'number') {
      return buildSingleModelBase(input, singleTemp, 'FALLBACK 1 MODELO', false)
    }
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

  // Seoul special: ICON raw as base (ensemble is systematically ~3°C too low for Seoul;
  // ICON MAE 1.00° vs ensemble+KALMAN 1.51° over 429 days). KALMAN still applies on top.
  if (slug === 'seoul' && modelsRaw['icon_seamless'] != null && typeof modelsRaw['icon_seamless'] === 'number') {
    return buildSingleModelBase(input, modelsRaw['icon_seamless'], 'ICON BASE', true)
  }

  // Hong Kong special: Best Match raw as base (ensemble ~1.4°C too low for HK;
  // Best Match MAE 1.12° vs ensemble+KALMAN 1.31° over 429 days; 78% int exacta vs 22%).
  if (slug === 'hong-kong' && modelsRaw['best_match'] != null && typeof modelsRaw['best_match'] === 'number') {
    return buildSingleModelBase(input, modelsRaw['best_match'], 'BEST MATCH BASE', false)
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

  // Dynamic bias correction (applied after nowcast, so just track sesgo)
  const sesgo = computeDynamicBias(slug, mes, recentErrors)
  let tempCorregida = tempPonderada

  if (input.backtestBiasCorrection !== undefined && Math.abs(input.backtestBiasCorrection) >= 0.15) {
    tempCorregida = tempCorregida + input.backtestBiasCorrection
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

  let weather: WeatherCondition | undefined
  if (input.weatherCode !== undefined) {
    const info = getWeatherInfo(input.weatherCode, input.precipitation ?? 0)
    weather = { code: input.weatherCode, precipitation: input.precipitation ?? 0, ...info }
  }

  return {
    temp_ponderada: Math.round(tempPonderada * 100) / 100,
    temp_corregida: Math.round(tempCorregida * 100) / 100,
    volatilidad,
    consenso,
    ensemble_raw: modelsRaw,
    sesgo_aplicado: Math.round(sesgo * 100) / 100,
    ensemble_members: ensembleMembers,
    weather,
  }
}

/**
 * Build a ForecastResult using a single model's raw temperature as base.
 * Used for cities where the weighted ensemble is systematically biased.
 * KALMAN/MC still applies on top via forecast-engine.ts.
 */
function buildSingleModelBase(
  input: EnsembleInput,
  modelTemp: number,
  consensoLabel: string,
  isIconBase: boolean
): ForecastResult {
  const { modelsRaw, ensembleMembers } = input
  const allTemps = Object.values(modelsRaw).filter((v): v is number => typeof v === 'number')
  const vol = allTemps.length >= 2 ? Math.max(0.9, Math.min(std(allTemps) * 1.75, 5.2)) : 2.0
  let weather: WeatherCondition | undefined
  if (input.weatherCode !== undefined) {
    const info = getWeatherInfo(input.weatherCode, input.precipitation ?? 0)
    weather = { code: input.weatherCode, precipitation: input.precipitation ?? 0, ...info }
  }
  return {
    temp_ponderada: Math.round(modelTemp * 100) / 100,
    temp_corregida: Math.round(modelTemp * 100) / 100,
    volatilidad: vol,
    consenso: consensoLabel,
    ensemble_raw: modelsRaw,
    sesgo_aplicado: 0,
    ensemble_members: ensembleMembers,
    weather,
    icon_base: isIconBase || undefined,
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
