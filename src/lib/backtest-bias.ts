import { getBacktestBias, saveBacktestBias, BacktestBiasEntry } from './supabase'
import { BacktestDayResult } from './backtest-engine'
import { CIUDADES_ASIA } from './cities'

export async function loadBacktestBias(): Promise<Record<string, number>> {
  const entries = await getBacktestBias()
  if (entries.length === 0) return {}

  // Group by slug, take most recent month's bias
  const bySlug: Record<string, BacktestBiasEntry[]> = {}
  for (const e of entries) {
    if (!bySlug[e.slug]) bySlug[e.slug] = []
    bySlug[e.slug].push(e)
  }

  const result: Record<string, number> = {}
  const currentMonth = new Date().getMonth() + 1

  for (const [slug, biasEntries] of Object.entries(bySlug)) {
    // Find entry for current month, or nearest month
    let best = biasEntries[0]
    let bestDist = Infinity
    for (const e of biasEntries) {
      const dist = Math.abs(e.mes - currentMonth)
      if (dist < bestDist) {
        bestDist = dist
        best = e
      }
    }
    // Only apply if meaningful bias and sufficient samples
    if (best.muestras >= 5 && Math.abs(best.bias) >= 0.15) {
      result[slug] = best.bias
    }
  }

  return result
}

export function computeBacktestBiasFromResults(results: BacktestDayResult[]): BacktestBiasEntry[] {
  const bySlugMes: Record<string, { slug: string; mes: number; errors: number[] }> = {}

  for (const r of results) {
    const mes = new Date(r.fecha + 'T12:00:00').getMonth() + 1
    const key = `${r.slug}_${mes}`
    if (!bySlugMes[key]) {
      bySlugMes[key] = { slug: r.slug, mes, errors: [] }
    }
    bySlugMes[key].errors.push(r.error)
  }

  const entries: BacktestBiasEntry[] = []
  for (const { slug, mes, errors } of Object.values(bySlugMes)) {
    if (errors.length < 3) continue
    const bias = errors.reduce((s, v) => s + v, 0) / errors.length
    const mae = errors.reduce((s, v) => s + Math.abs(v), 0) / errors.length
    entries.push({
      slug,
      mes,
      bias: Math.round(bias * 100) / 100,
      mae: Math.round(mae * 100) / 100,
      muestras: errors.length,
    })
  }

  return entries
}
