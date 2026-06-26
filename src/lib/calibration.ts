import { logistic } from './math-utils'

/**
 * Pool Adjacent Violators Algorithm (PAVA) for isotonic regression.
 * 
 * Finds the monotonic-increasing step function that minimizes
 * sum((y_i - f(x_i))^2) subject to f(x_i) <= f(x_j) for x_i < x_j.
 * 
 * O(n) time, O(n) space. No external dependencies.
 */
export function isotonicRegressionPAVA(
  y: number[]
): { fitted: number[]; blocks: [number, number][] } {
  const n = y.length
  if (n === 0) return { fitted: [], blocks: [] }
  if (n === 1) return { fitted: [y[0]], blocks: [[0, 0]] }

  const blocks: { sum: number; cnt: number; start: number; end: number }[] =
    y.map((v, i) => ({ sum: v, cnt: 1, start: i, end: i }))

  let i = 0
  while (i < blocks.length - 1) {
    const cur = blocks[i]
    const nxt = blocks[i + 1]
    const curMean = cur.sum / cur.cnt
    const nxtMean = nxt.sum / nxt.cnt

    if (curMean > nxtMean) {
      blocks[i] = {
        sum: cur.sum + nxt.sum,
        cnt: cur.cnt + nxt.cnt,
        start: cur.start,
        end: nxt.end,
      }
      blocks.splice(i + 1, 1)
      i = Math.max(0, i - 1)
    } else {
      i++
    }
  }

  const fitted: number[] = new Array(n)
  const blockRanges: [number, number][] = []
  for (const blk of blocks) {
    const mean = blk.sum / blk.cnt
    for (let j = blk.start; j <= blk.end; j++) {
      fitted[j] = mean
    }
    blockRanges.push([blk.start, blk.end])
  }

  return { fitted, blocks: blockRanges }
}

export interface CalibrationBin {
  n: number
  predictedMean: number
  actualWinRate: number
  confMin: number
  confMax: number
}

export interface CalibrationResult {
  status: string
  nPredictions: number
  nBins: number
  nBlocks: number
  ece: number
  bins: CalibrationBin[]
  adjustmentPoints: { confMin: number; confMax: number; ratio: number }[]
}

/**
 * Isotonic calibration using PAVA. Groups predictions into bins,
 * fits monotonic function, returns calibration curve.
 * Superior to Platt scaling because it does NOT assume a sigmoid shape.
 */
export function isotonicCalibrate(
  predictions: { confidence: number; outcome: number }[],
  nBins: number = 10
): CalibrationResult {
  if (predictions.length < 10) {
    return {
      status: 'insufficient_data',
      nPredictions: predictions.length,
      nBins: 0, nBlocks: 0, ece: 0,
      bins: [], adjustmentPoints: [],
    }
  }

  const sorted = [...predictions].sort((a, b) => a.confidence - b.confidence)
  const n = sorted.length
  const binSize = Math.max(1, Math.floor(n / nBins))
  const bins: CalibrationBin[] = []

  for (let i = 0; i < n; i += binSize) {
    const batch = sorted.slice(i, i + binSize)
    if (batch.length < 2) continue
    const confs = batch.map(p => p.confidence)
    const outcomes = batch.map(p => p.outcome)
    bins.push({
      n: batch.length,
      predictedMean: confs.reduce((s, v) => s + v, 0) / confs.length,
      actualWinRate: outcomes.reduce((s, v) => s + v, 0) / outcomes.length,
      confMin: Math.min(...confs),
      confMax: Math.max(...confs),
    })
  }

  if (bins.length < 2) {
    return {
      status: 'insufficient_bins',
      nPredictions: n,
      nBins: bins.length, nBlocks: 0, ece: 0,
      bins, adjustmentPoints: [],
    }
  }

  const yVals = bins.map(b => b.actualWinRate)
  const { fitted, blocks } = isotonicRegressionPAVA(yVals)

  const totalSamples = bins.reduce((s, b) => s + b.n, 0)
  const ece = bins.reduce((s, b, i) => s + b.n * Math.abs(b.actualWinRate - fitted[i]), 0) / totalSamples

  const adjustmentPoints = bins.map((b, i) => ({
    confMin: b.confMin,
    confMax: b.confMax,
    ratio: fitted[i] / b.predictedMean,
  }))

  return {
    status: 'isotonic_pava',
    nPredictions: n,
    nBins: bins.length,
    nBlocks: blocks.length,
    ece: Math.round(ece * 10000) / 100,
    bins,
    adjustmentPoints,
  }
}

/**
 * Apply isotonic adjustment to a raw confidence.
 */
export function applyIsotonicAdjustment(
  calibration: CalibrationResult,
  rawConfidence: number
): number {
  if (calibration.status !== 'isotonic_pava' || calibration.adjustmentPoints.length === 0) {
    return rawConfidence
  }

  const conf = rawConfidence > 1 ? rawConfidence / 100 : rawConfidence

  for (const pt of calibration.adjustmentPoints) {
    if (conf >= pt.confMin && conf <= pt.confMax) {
      const cal = conf * pt.ratio
      return Math.max(0.01, Math.min(0.95, cal))
    }
  }

  const nearest = calibration.adjustmentPoints.reduce((best, pt) =>
    Math.abs(pt.confMin - conf) < Math.abs(best.confMin - conf) ? pt : best
  )
  const cal = conf * nearest.ratio
  return Math.max(0.01, Math.min(0.95, cal))
}

/**
 * Platt scaling calibration using historical prediction errors.
 */
export function calibrateProbabilities(
  rawProbs: number[],
  alpha: number = 1.0,
  beta: number = 0.0
): number[] {
  if (rawProbs.length === 0) return []

  return rawProbs.map(p => {
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
