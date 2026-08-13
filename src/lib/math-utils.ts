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
