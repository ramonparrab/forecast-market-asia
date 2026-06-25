import { logistic } from './math-utils'

/**
 * Platt scaling calibration using historical prediction errors.
 * 
 * Given historical predicted probabilities and actual outcomes,
 * we fit a simple sigmoid calibration: P_calibrated = 1/(1+exp(alpha*logit(p) + beta))
 * 
 * Since we can't do scipy optimization in-browser, we use a simple grid search
 * to find good alpha/beta values.
 */
export function calibrateProbabilities(
  rawProbs: number[],
  alpha: number = 1.0,
  beta: number = 0.0
): number[] {
  if (rawProbs.length === 0) return []

  return rawProbs.map(p => {
    // Clamp to avoid log(0)
    const clamped = Math.max(0.001, Math.min(0.999, p))
    const logit = Math.log(clamped / (1 - clamped))
    const calibrated = logistic(alpha * logit + beta)
    return Math.round(calibrated * 10000) / 10000
  })
}

/**
 * Find optimal alpha/beta via simple grid search.
 * Returns [bestAlpha, bestBeta].
 */
export function findCalibrationParams(
  predictions: number[],
  outcomes: number[],
  alphaRange = [0.5, 1.5],
  betaRange = [-1.0, 1.0],
  steps = 10
): [number, number] {
  if (predictions.length < 5 || outcomes.length < 5) {
    return [1.0, 0.0]
  }

  let bestScore = Infinity
  let bestAlpha = 1.0
  let bestBeta = 0.0

  const aStep = (alphaRange[1] - alphaRange[0]) / steps
  const bStep = (betaRange[1] - betaRange[0]) / steps

  for (let a = alphaRange[0]; a <= alphaRange[1]; a += aStep) {
    for (let b = betaRange[0]; b <= betaRange[1]; b += bStep) {
      const calibrated = calibrateProbabilities(predictions, a, b)
      // Brier score: mean squared error
      let brier = 0
      for (let i = 0; i < calibrated.length; i++) {
        brier += (calibrated[i] - outcomes[i]) ** 2
      }
      brier /= calibrated.length

      if (brier < bestScore) {
        bestScore = brier
        bestAlpha = a
        bestBeta = b
      }
    }
  }

  return [Math.round(bestAlpha * 100) / 100, Math.round(bestBeta * 100) / 100]
}
