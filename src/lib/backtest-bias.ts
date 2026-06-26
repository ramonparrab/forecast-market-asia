import { getBacktestBias, getHistoricalRecords, getAccumulatedBacktest, saveBacktestBias, BacktestBiasEntry } from './supabase'
import { BacktestDayResult } from './backtest-engine'

// In-memory cache for bias (persists across requests within same serverless instance)
let cachedBias: Record<string, number> | null = null
let cacheTimestamp = 0
const BIAS_CACHE_TTL = 300_000 // 5 min

/** Force-set the bias cache (used by backtest API after computing bias) */
export function setBiasCache(bias: Record<string, number>) {
  cachedBias = bias
  cacheTimestamp = Date.now()
}

export async function loadBacktestBias(): Promise<Record<string, number>> {
  if (cachedBias && (Date.now() - cacheTimestamp) < BIAS_CACHE_TTL) {
    return cachedBias
  }
  // 1. Try Supabase backtest_bias table first
  let entries: BacktestBiasEntry[] = []
  try {
    entries = await getBacktestBias()
  } catch { /* table may not exist */ }

  // 2. Fall back to forecast_history if no backtest_bias entries
  if (!entries || entries.length === 0) {
    try {
      const history = await getHistoricalRecords(500)
      const withActuals = history.filter(r => r.temp_real !== null && r.error !== null)
      if (withActuals.length >= 5) {
        const mapped = withActuals.map(r => ({
          fecha: r.fecha_objetivo || r.fecha_ejecucion.slice(0, 10),
          ciudad: r.ciudad,
          slug: r.slug,
          temp_pronosticada: r.temp_pronosticada,
          temp_corregida: r.temp_corregida,
          temp_real: r.temp_real!,
          error: r.error!,
          modelos_usados: r.modelos_usados,
          consenso: r.consenso,
          sesgo_aplicado: 0,
        }))
        const biasEntries = computeBacktestBiasFromResults(mapped as any)
        if (biasEntries.length > 0) {
          entries = biasEntries
          try { await saveBacktestBias(biasEntries) } catch {}
        }
      }
    } catch {}
  }

  // 3. Fall back to accumulated backtest results from Supabase
  if (!entries || entries.length === 0) {
    try {
      const backtestData = await getAccumulatedBacktest(365)
      if (backtestData && backtestData.resultados.length >= 5) {
        const biasEntries = computeBacktestBiasFromResults(backtestData.resultados)
        if (biasEntries.length > 0) {
          entries = biasEntries
          try { await saveBacktestBias(biasEntries) } catch {}
        }
      }
    } catch {}
  }

  if (!entries || entries.length === 0) {
    cachedBias = {}
    cacheTimestamp = Date.now()
    return {}
  }

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

  cachedBias = result
  cacheTimestamp = Date.now()
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
