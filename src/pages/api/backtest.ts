import { NextApiRequest, NextApiResponse } from 'next'
import { runBacktest } from '@/lib/backtest-engine'
import { getAccumulatedBacktest, saveBacktestChunk, saveBacktestBias, runBacktestFromHistory } from '@/lib/supabase'
import { computeBacktestBiasFromResults, setBiasCache } from '@/lib/backtest-bias'

let inMemoryCache: { data: any; ts: number } | null = null
const CACHE_TTL = 300_000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    if (inMemoryCache && (Date.now() - inMemoryCache.ts) < CACHE_TTL) {
      return res.status(200).json({ status: 'ok', cached: true, data: inMemoryCache.data.data })
    }
    // Try forecast_history (grows automatically each day)
    try {
      const fromHistory = await runBacktestFromHistory(180)
      if (fromHistory) {
        inMemoryCache = { data: { data: fromHistory }, ts: Date.now() }
        return res.status(200).json({ status: 'ok', cached: true, data: fromHistory, source: 'forecast_history' })
      }
    } catch { /* ignore */ }
    // Fallback: Supabase backtest_results cache
    try {
      const cached = await getAccumulatedBacktest(180)
      if (cached) {
        inMemoryCache = { data: { data: cached }, ts: Date.now() }
        return res.status(200).json({ status: 'ok', cached: true, data: cached, source: 'backtest_results' })
      }
    } catch { /* table may not exist yet */ }
    return res.status(200).json({ status: 'ok', cached: false, data: null, source: 'none' })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const totalDays = Math.min(parseInt(req.query.days as string || '90'), 365)
    const chunkSize = Math.min(30, totalDays)
    const offset = parseInt(req.query.offset as string || '0')

    // Try forecast_history first (grows automatically)
    const fromHistory = await runBacktestFromHistory(totalDays)
    if (fromHistory && fromHistory.total_muestras >= 10) {
      // Compute bias from history and update cache
      try {
        const biasEntries = computeBacktestBiasFromResults(fromHistory.resultados)
        await saveBacktestBias(biasEntries)
        const biasMap: Record<string, number> = {}
        for (const e of biasEntries) {
          if (e.muestras >= 3 && Math.abs(e.bias) >= 0.15) {
            biasMap[e.slug] = e.bias
          }
        }
        if (Object.keys(biasMap).length > 0) setBiasCache(biasMap)
      } catch { /* best effort */ }
      inMemoryCache = { data: { data: fromHistory }, ts: Date.now() }
      return res.status(200).json({
        status: 'ok',
        cached: false,
        source: 'forecast_history',
        data: fromHistory,
      })
    }

    // Fallback: run live backtest from Open-Meteo API
    const result = await runBacktest(chunkSize, offset)
    if (result.resultados.length >= 5) {
      const biasEntries = computeBacktestBiasFromResults(result.resultados)
      const biasMap: Record<string, number> = {}
      for (const e of biasEntries) {
        if (e.muestras >= 3 && Math.abs(e.bias) >= 0.15) {
          biasMap[e.slug] = e.bias
        }
      }
      if (Object.keys(biasMap).length > 0) setBiasCache(biasMap)
      try {
        await saveBacktestChunk(chunkSize, offset, result)
        await saveBacktestBias(biasEntries)
      } catch { /* tables may not exist yet */ }
    }
    inMemoryCache = { data: { data: result }, ts: Date.now() }
    return res.status(200).json({
      status: 'ok',
      cached: false,
      source: 'openmeteo_api',
      data: result,
    })
  } catch (error) {
    console.error('[BACKTEST] Error:', error)
    return res.status(500).json({
      status: 'error',
      message: (error as Error).message,
    })
  }
}
