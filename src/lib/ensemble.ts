import { ModelTemps, ForecastResult, WeatherCondition } from '@/types'
import { std, mean } from './math-utils'
import { computeDynamicBias, computeAdaptiveWeights } from './bias-correction'
import { getEstacion } from './cities'
import { getWeatherInfo } from './openmeteo'

// ============================================================================
// σ (VOLATILIDAD) — MEZCLA SPREAD + RMSE HISTÓRICO "B 30/70"
// ============================================================================
// IMPLEMENTADO sep-2026 tras backtest walk-forward (919 días-ciudad, mayo-sep
// 2026, bootstrap pareado n=8190 → mejora SIGNIFICATIVA en Brier/LogLoss).
//
// ANTES (A):      σ = std(modelos del día) × 1.75          → solo "opinión de hoy"
// AHORA (B 30/70): σ = √( 0.3·σ_spread² + 0.7·RMSE_30d² )  → + "cuánto fallamos de verdad"
//
// σ_spread = std(modelos)×1.75 (la que ya existía, clamp 0.9–5.2)
// RMSE_30d = error REAL de NUESTROS pronósticos de los últimos 30 días de esa
//            ciudad (columna `error` de forecast_history, calculada contra
//            temp_corregida FINAL → incluye Kalman/sesgo, i.e. es residual post-corrección)
//
// Hallazgo del backtest: el RMSE real era MENOR que σ de spread en 9/10
// ciudades → el sistema estaba SUB-calibrado (σ inflada, probabilidades blandas,
// edge regalado). Con la mezcla: Brier 0.1883→0.1862, LogLoss 0.5459→0.5378,
// fallo en p≥90%: 2.0%→1.5%, cobertura 80%: 84.9%→81.2% (nominal 80).
// En días de FRENTE (Δreal≥3°C, n=229) B también gana (Brier 0.1770→0.1741):
// el frente lo predice el CENTRO (modelos/Kalman), no la σ; el RMSE 30d ya
// viene inflado por frentes pasados; y el 30% de spread reacciona el mismo día.
//
// Constantes ajustables — SI SE CAMBIAN, re-corre
// scripts/backtest_volatilidad.py + significancia_volatilidad.py (repo local).
// ============================================================================
export const SIGMA_W_SPREAD = 0.3         // peso del spread de modelos (0.3 = 30%)
export const SIGMA_W_RMSE = 0.7           // peso del RMSE histórico (0.7 = 70%)  ← EL NÚMERO
export const SIGMA_RMSE_WINDOW = 30       // días de errores para el RMSE
export const SIGMA_RMSE_MIN_SAMPLES = 10  // mín. errores para activar mezcla; con menos → solo spread
export const SIGMA_MIN = 0.9              // clamp inferior de σ (°C)
export const SIGMA_MAX = 5.2              // clamp superior de σ (°C)

/**
 * Mezcla σ = √(W_SPREAD·σ_spread² + W_RMSE·RMSE²), clamped [0.9, 5.2].
 * Si hay < SIGMA_RMSE_MIN_SAMPLES errores reales → devuelve σ_spread pura
 * (comportamiento anterior, sin historia suficiente para confiar).
 */
export function computeSigmaMixed(
  sigmaSpread: number,
  recentErrors: { error: number }[]
): { sigma: number; rmse30d: number | null; sigmaSpread: number } {
  const errs = (recentErrors ?? [])
    .map(e => e?.error)
    .filter((e): e is number => typeof e === 'number' && Number.isFinite(e))
  if (errs.length < SIGMA_RMSE_MIN_SAMPLES) {
    return { sigma: sigmaSpread, rmse30d: null, sigmaSpread }
  }
  const rmse = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length)
  const mixed = Math.sqrt(
    SIGMA_W_SPREAD * sigmaSpread * sigmaSpread +
    SIGMA_W_RMSE * rmse * rmse
  )
  return {
    sigma: Math.max(SIGMA_MIN, Math.min(mixed, SIGMA_MAX)),
    rmse30d: Math.round(rmse * 100) / 100,
    sigmaSpread: Math.round(sigmaSpread * 100) / 100,
  }
}

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
  const sigmaSpread = Math.max(SIGMA_MIN, Math.min(stdDev * 1.75, SIGMA_MAX))
  // σ final: mezcla 30/70 spread + RMSE histórico de la ciudad (Mejora B 30/70)
  const { sigma: volatilidad, rmse30d, sigmaSpread: spreadC } = computeSigmaMixed(sigmaSpread, recentErrors)

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
    sigma_rmse_30d: rmse30d ?? undefined,
    sigma_spread: spreadC ?? undefined,
    sigma_formula: rmse30d != null
      ? `σ=√(${SIGMA_W_SPREAD}·${spreadC}² + ${SIGMA_W_RMSE}·${rmse30d}²)`
      : undefined,
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
  const sigmaSpread = allTemps.length >= 2
    ? Math.max(SIGMA_MIN, Math.min(std(allTemps) * 1.75, SIGMA_MAX))
    : 2.0
  // σ mixta también en bases de modelo único (Seúl ICON / HK BestMatch / fallback):
  // con 1 modelo el spread no existe → el RMSE histórico es la ÚNICA señal honesta.
  const { sigma: vol, rmse30d, sigmaSpread: spreadC } = computeSigmaMixed(sigmaSpread, input.recentErrors ?? [])
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
    sigma_rmse_30d: rmse30d ?? undefined,
    sigma_spread: spreadC ?? undefined,
    sigma_formula: rmse30d != null
      ? `σ=√(${SIGMA_W_SPREAD}·${spreadC}² + ${SIGMA_W_RMSE}·${rmse30d}²)`
      : undefined,
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
