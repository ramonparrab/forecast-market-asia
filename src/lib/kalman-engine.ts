/**
 * Kalman 1D — estimación adaptativa del bias de estación.
 *
 * Modelo: el bias real es un estado oculto que deriva lentamente (random walk).
 *   Estado:      xₜ = xₜ₋₁ + wₜ            wₜ ~ N(0, Q)   (deriva del bias)
 *   Observación: yₜ = xₜ + vₜ              vₜ ~ N(0, R)   (error diario = bias + ruido)
 *
 * Ciclo por día (sin look-ahead):
 *   Predicción:  x̂ = x, P̂ = P + Q
 *   Corrección:  temp_final = temp_corregida + x̂
 *   Actualización tras ver el error real:
 *     K = P̂ / (P̂ + R)
 *     x = x̂ + K·(error − x̂)
 *     P = (1 − K)·P̂
 *
 * La ganancia K ≈ sqrt(Q/R) en estado estable da ~7.8% de peso al error más reciente
 * (con Q=0.01, R=1.65), con decaimiento exponencial: memoria efectiva ~9 días.
 */

export const KALMAN_Q = 0.01

/**
 * Override de Q por ciudad — las que usan base de modelo único (HK=BestMatch, Seoul=ICON)
 * tienen más bias sistemático que el ensemble ponderado, y KALMAN necesita reaccionar más rápido.
 * Q=0.03 → K_ss ≈ sqrt(0.03/R), memoria ≈ 4-5 días (vs ~9 con Q=0.01).
 */
const CITY_Q: Record<string, number> = {
  'hong-kong': 0.03,
  seoul: 0.03,
}

/** Q efectivo para una ciudad: override si existe, sino el global */
export function getKalmanQ(slug: string): number {
  return CITY_Q[slug] ?? KALMAN_Q
}

/**
 * Estima R (varianza del ruido de observación) desde los errores históricos.
 * Mínimo de 0.3 para evitar filtros degenerados con pocas muestras.
 */
export function estimateKalmanR(errors: number[]): number {
  if (errors.length === 0) return 1.65
  const m = errors.reduce((a, b) => a + b, 0) / errors.length
  const v = errors.reduce((a, b) => a + (b - m) ** 2, 0) / errors.length
  return Math.max(v, 0.3)
}

/**
 * Bias predicho para CADA día i, usando solo los errores de días anteriores (i < i).
 * La predicción del día i es el estado del filtro ANTES de ver el error del día i.
 */
export function kalmanBiasPredictions(errors: number[], Q: number, R: number): number[] {
  let x = 0
  let P = R
  const preds: number[] = []
  for (const y of errors) {
    preds.push(x)
    const K = (P + Q) / (P + Q + R)
    x = x + K * (y - x)
    P = (1 - K) * (P + Q)
  }
  return preds
}

/**
 * Estado final del filtro tras procesar todos los errores históricos.
 * Bias a aplicar a un día pendiente (futuro): la mejor estimación actual.
 */
export function kalmanNextBias(errors: number[], Q: number, R: number): number {
  let x = 0
  let P = R
  for (const y of errors) {
    const K = (P + Q) / (P + Q + R)
    x = x + K * (y - x)
    P = (1 - K) * (P + Q)
  }
  return x
}
