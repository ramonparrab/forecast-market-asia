// Statistical utilities (no external deps needed)

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

export function std(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  const sqDiffs = arr.map(v => (v - m) ** 2)
  return Math.sqrt(sqDiffs.reduce((s, v) => s + v, 0) / (arr.length - 1))
}

export function boxMullerRandom(mean = 0, stddev = 1): number {
  let u1 = 0, u2 = 0
  while (u1 === 0) u1 = Math.random()
  while (u2 === 0) u2 = Math.random()
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return z * stddev + mean
}

export function gaussSample(meanVal: number, stddev: number, n: number): number[] {
  const samples: number[] = []
  for (let i = 0; i < n; i++) {
    samples.push(boxMullerRandom(meanVal, stddev))
  }
  return samples
}

export function logistic(x: number): number {
  return 1.0 / (1.0 + Math.exp(-x))
}

export function plattsCalibrate(rawProbs: number[], alpha: number, beta: number): number[] {
  return rawProbs.map(p => {
    const logit = Math.log(p / (1 - p + 1e-10))
    return logistic(alpha * logit + beta)
  })
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
