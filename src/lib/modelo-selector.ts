import { HistoricalRecord } from '@/types'
import { computeCurrentForecast } from './mejora-continua-engine'
import { kalmanNextBias, estimateKalmanR, KALMAN_Q } from './kalman-engine'

export type ModeloActivo = 'MEJORA CONTINUA' | 'KALMAN'

/**
 * DEFAULT_MAP — fallback estático validado sobre 609 días.
 * Solo se usa si no hay suficiente historia para evaluar dinámicamente.
 */
const DEFAULT_MAP: Record<string, ModeloActivo> = {
  seoul: 'KALMAN',
  beijing: 'KALMAN',
  shanghai: 'KALMAN',
  'hong-kong': 'KALMAN',
  shenzhen: 'KALMAN',
  singapore: 'KALMAN',
  tokyo: 'MEJORA CONTINUA',
  wuhan: 'MEJORA CONTINUA',
  chongqing: 'MEJORA CONTINUA',
  chengdu: 'MEJORA CONTINUA',
}

// Cache de la selección por ejecución (se recalcula cada corrida del cron)
let _selectionCache: Record<string, { modelo: ModeloActivo; mae_kalman: number; mae_mc: number; reason: string }> | null = null

/**
 * seleccionarMejorModelo — elige dinámicamente KALMAN vs MEJORA CONTINUA por ciudad.
 *
 * Walk-forward sin look-ahead: para cada día histórico con temp_real,
 * simula lo que KALMAN y MC habrían predicho usando SOLO datos anteriores.
 * Compara MAE de los últimos N días y elige el mejor.
 *
 * @param history  Registros históricos con temp_real y error (ordenados por fecha_objetivo ASC)
 * @param slug     Slug de la ciudad
 * @param window   Días recientes a evaluar (default 60)
 * @param minDays  Mínimo de días para confiar en la selección (si menos, usa DEFAULT_MAP)
 */
export function seleccionarMejorModelo(
  history: HistoricalRecord[],
  slug: string,
  window = 60,
  minDays = 20
): { modelo: ModeloActivo; mae_kalman: number; mae_mc: number; reason: string } {
  // Return cache if available (same execution cycle)
  if (_selectionCache && _selectionCache[slug]) {
    return _selectionCache[slug]
  }

  const validos = history.filter(
    r => r.temp_real !== null && r.error !== null
  ) as (HistoricalRecord & { temp_real: number; error: number })[]
  validos.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

  // Si no hay suficientes datos, usar el default
  if (validos.length < minDays) {
    const fallback = DEFAULT_MAP[slug] ?? 'KALMAN'
    const result = { modelo: fallback, mae_kalman: 0, mae_mc: 0, reason: `Pocos datos (${validos.length} < ${minDays}), usando default: ${fallback}` }
    cacheResult(slug, result)
    return result
  }

  // Walk-forward: para cada día i, simular predicción con datos [0..i-1]
  const kalmanErrors: number[] = []
  const mcErrors: number[] = []

  // Solo evaluar los últimos `window` días
  const evalWindow = validos.slice(-window)
  const startIdx = validos.length - evalWindow.length

  for (let i = 0; i < evalWindow.length; i++) {
    const dayRecord = evalWindow[i]
    const globalIdx = startIdx + i
    // Datos de entrenamiento: todo lo anterior a este día
    const trainData = validos.slice(0, globalIdx)
    if (trainData.length < 5) continue // Necesitamos al menos 5 días para entrenar

    const baseTemp = dayRecord.temp_corregida

    // --- Simular KALMAN ---
    const trainErrors = trainData.map(r => r.error)
    const R = estimateKalmanR(trainErrors)
    const kalmanBias = kalmanNextBias(trainErrors, KALMAN_Q, R)
    const kalmanPred = baseTemp + kalmanBias
    const kalmanErr = Math.abs(dayRecord.temp_real - kalmanPred)
    kalmanErrors.push(kalmanErr)

    // --- Simular MEJORA CONTINUA ---
    try {
      const mcResult = computeCurrentForecast(trainData, {
        slug,
        fecha_objetivo: dayRecord.fecha_objetivo,
        fecha_ejecucion: '',
        ciudad: '',
        temp_pronosticada: baseTemp,
        temp_corregida: baseTemp,
        temp_real: null,
        error: null,
        modelos_usados: 0,
        consenso: '',
      } as HistoricalRecord, '')
      const mcPred = mcResult?.combinado ?? baseTemp
      const mcErr = Math.abs(dayRecord.temp_real - mcPred)
      mcErrors.push(mcErr)
    } catch {
      // Si MC falla, asumir error igual al base
      mcErrors.push(Math.abs(dayRecord.error))
    }
  }

  if (kalmanErrors.length < 10) {
    const fallback = DEFAULT_MAP[slug] ?? 'KALMAN'
    const result = { modelo: fallback, mae_kalman: 0, mae_mc: 0, reason: `Walk-forward insuficiente (${kalmanErrors.length} < 10), usando default: ${fallback}` }
    cacheResult(slug, result)
    return result
  }

  const maeK = kalmanErrors.reduce((s, e) => s + e, 0) / kalmanErrors.length
  const maeMC = mcErrors.reduce((s, e) => s + e, 0) / mcErrors.length
  const diff = Math.abs(maeK - maeMC)
  const diffPct = diff / Math.max(maeK, maeMC) * 100

  let modelo: ModeloActivo
  let reason: string

  // Elegir el de menor MAE; si están muy cerca (<5% diferencia), mantener el anterior (estabilidad)
  const prevDefault = DEFAULT_MAP[slug] ?? 'KALMAN'
  if (diffPct < 5) {
    modelo = prevDefault
    reason = `Empate (${diffPct.toFixed(1)}% dif < 5%): KALMAN=${maeK.toFixed(3)} MC=${maeMC.toFixed(3)}, mantiene ${prevDefault}`
  } else if (maeK < maeMC) {
    modelo = 'KALMAN'
    reason = `KALMAN gana: MAE ${maeK.toFixed(3)} vs MC ${maeMC.toFixed(3)} (${diffPct.toFixed(1)}% mejor)`
  } else {
    modelo = 'MEJORA CONTINUA'
    reason = `MC gana: MAE ${maeMC.toFixed(3)} vs KALMAN ${maeK.toFixed(3)} (${diffPct.toFixed(1)}% mejor)`
  }

  const result = { modelo, mae_kalman: round2(maeK), mae_mc: round2(maeMC), reason }
  cacheResult(slug, result)
  return result
}

/** Limpia el cache de selección (llamar al inicio de cada corrida del cron) */
export function clearModelSelectionCache(): void {
  _selectionCache = null
}

/** Obtiene el cache completo de selecciones (para logging) */
export function getModelSelectionCache(): Record<string, { modelo: ModeloActivo; mae_kalman: number; mae_mc: number; reason: string }> {
  return _selectionCache ?? {}
}

function cacheResult(slug: string, result: { modelo: ModeloActivo; mae_kalman: number; mae_mc: number; reason: string }) {
  if (!_selectionCache) _selectionCache = {}
  _selectionCache[slug] = result
}



/**
 * getModeloActivo — usa el cache de selección dinámica si existe,
 * sino cae al default estático.
 */
export function getModeloActivo(slug: string): ModeloActivo {
  if (_selectionCache && _selectionCache[slug]) {
    return _selectionCache[slug].modelo
  }
  return DEFAULT_MAP[slug] ?? 'KALMAN'
}

/**
 * Nombre descriptivo del pipeline real aplicado por ciudad:
 *   KALMAN      -> filtro Kalman 1D (bias adaptativo)
 *   chongqing   -> combinado_estandar: estación + rango + boost (único MC combinado)
 *   resto MC    -> pipeline adaptativo solo-estación
 */
export function getModeloNombre(slug: string, modelo?: string): string {
  if (slug === 'seoul') return 'ICON+Kalman'
  if (slug === 'hong-kong') return 'BestMatch+Kalman'
  const m = (modelo ?? getModeloActivo(slug)) as ModeloActivo
  if (m === 'KALMAN') return 'Kalman 1D'
  if (slug === 'chongqing') return 'Combinado'
  return 'St·Adapt'
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Calcula el valor final del pronóstico aplicando el modelo ganador de la ciudad.
 * Usa únicamente historia previa (sin look-ahead): errores y temp_real ya confirmados.
 * @param slug          slug de la ciudad
 * @param nombre        nombre mostrado
 * @param tempBase      base = pronóstico actual del ensemble (temp_corregida)
 * @param history       registros históricos de la ciudad con temp_real y error
 */
export function aplicarModeloGanador(
  slug: string,
  nombre: string,
  tempBase: number,
  history: HistoricalRecord[],
  fechaObjetivo: string
): { temp: number; modelo: ModeloActivo; bias: number; muestras: number } {
  const validos = history.filter(
    r => r.temp_real !== null && r.error !== null
  ) as (HistoricalRecord & { temp_real: number; error: number })[]
  validos.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

  const muestras = validos.length
  // getModeloActivo ahora usa el cache de seleccionarMejorModelo() si fue llamado antes
  const modelo = getModeloActivo(slug)

  let temp = tempBase

  if (modelo === 'KALMAN') {
    if (muestras > 0) {
      const errors = validos.map(r => r.error)
      const R = estimateKalmanR(errors)
      const bias = kalmanNextBias(errors, KALMAN_Q, R)
      temp = tempBase + bias
    }
    return { temp: round2(temp), modelo, bias: round2(temp - tempBase), muestras }
  }

  // MEJORA CONTINUA — pipeline adaptativo por ciudad (estacion/range/boost)
  if (muestras > 0) {
    const cf = computeCurrentForecast(validos, {
      slug,
      fecha_objetivo: fechaObjetivo,
      fecha_ejecucion: '',
      ciudad: '',
      temp_pronosticada: tempBase,
      temp_corregida: tempBase,
      temp_real: null,
      error: null,
      modelos_usados: 0,
      consenso: '',
    } as HistoricalRecord, nombre)
    if (cf) temp = cf.combinado ?? tempBase
  }
  return { temp: round2(temp), modelo, bias: round2(temp - tempBase), muestras }
}

