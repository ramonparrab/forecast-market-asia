import { HistoricalRecord } from '@/types'
import { computeCurrentForecast } from './mejora-continua-engine'
import { kalmanNextBias, estimateKalmanR, KALMAN_Q } from './kalman-engine'

/**
 * Modelo ganador por ciudad — validado sobre 609 días de historia real (sin look-ahead):
 *   KALMAN: seoul, beijing, shanghai, hong-kong, shenzhen, singapore
 *   MEJORA CONTINUA: tokyo, wuhan, chongqing, chengdu
 * MAE global: Actual 1.138 | MC 0.969 | KALMAN 0.950
 */
export type ModeloActivo = 'MEJORA CONTINUA' | 'KALMAN'

export const MODELO_POR_CIUDAD: Record<string, ModeloActivo> = {
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

export function getModeloActivo(slug: string): ModeloActivo {
  return MODELO_POR_CIUDAD[slug] ?? 'MEJORA CONTINUA'
}

/**
 * Nombre descriptivo del pipeline real aplicado por ciudad:
 *   KALMAN      -> filtro Kalman 1D (bias adaptativo)
 *   chongqing   -> combinado_estandar: estación + rango + boost (único MC combinado)
 *   resto MC    -> pipeline adaptativo solo-estación
 */
export function getModeloNombre(slug: string, modelo?: string): string {
  const m = (modelo ?? getModeloActivo(slug)) as ModeloActivo
  if (m === 'KALMAN') return 'Kalman 1D'
  if (slug === 'chongqing') return 'Combinado'
  return 'St·Adapt'
}

export function round2(v: number): number {
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

export const MODELO_COLORS: Record<ModeloActivo, { badge: string; short: string }> = {
  'MEJORA CONTINUA': { badge: 'bg-emerald-500/15 border border-emerald-400/30 text-emerald-300', short: 'MC' },
  KALMAN: { badge: 'bg-cyan-500/15 border border-cyan-400/30 text-cyan-300', short: 'KAL' },
}