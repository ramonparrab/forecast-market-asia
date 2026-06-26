import { NextApiRequest, NextApiResponse } from 'next'
import { runBacktest } from '@/lib/backtest-engine'
import { getAccumulatedBacktest, saveBacktestChunk, saveBacktestBias } from '@/lib/supabase'
import { computeBacktestBiasFromResults } from '@/lib/backtest-bias'

let inMemoryCache: { data: any; ts: number } | null = null
const CACHE_TTL = 300_000

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Try Supabase cache first
    const cached = await getAccumulatedBacktest(180)
    if (cached) {
      return res.status(200).json({ status: 'ok', cached: true, data: cached })
    }
    // Fall back to in-memory
    if (inMemoryCache && (Date.now() - inMemoryCache.ts) < CACHE_TTL) {
      return res.status(200).json({ status: 'ok', cached: true, ...inMemoryCache.data })
    }
    return res.status(200).json({ status: 'ok', cached: false, data: null })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const totalDays = Math.min(parseInt(req.query.days as string || '90'), 365)
    const chunkSize = 30 // process 30 days per chunk to stay within timeout
    
    // Check if we have accumulated data in Supabase
    const existing = await getAccumulatedBacktest(totalDays)
    if (existing && existing.total_muestras > 0) {
      return res.status(200).json({
        status: 'ok',
        cached: true,
        data: existing,
      })
    }

    // Process chunks until we have enough days
    let combinedResults: any[] = []
    let processedDays = 0

    for (let offset = 0; offset < totalDays; offset += chunkSize) {
      const chunkDays = Math.min(chunkSize, totalDays - offset)
      
      const chunkResult = await runBacktest(chunkDays, offset)
      combinedResults.push(...chunkResult.resultados)
      processedDays += chunkDays

      // Save chunk to Supabase for future requests
      await saveBacktestChunk(chunkDays, offset, chunkResult)
    }

    // Compute bias from ALL results and save to Supabase
    const biasEntries = computeBacktestBiasFromResults(combinedResults)
    await saveBacktestBias(biasEntries)

    // Get final combined result
    const finalResult = await getAccumulatedBacktest(totalDays)
    
    if (finalResult) {
      inMemoryCache = { data: { data: finalResult }, ts: Date.now() }
      return res.status(200).json({ status: 'ok', cached: false, data: finalResult })
    }

    return res.status(500).json({ status: 'error', message: 'No results generated' })
  } catch (error) {
    console.error('[BACKTEST] Error:', error)
    return res.status(500).json({
      status: 'error',
      message: (error as Error).message,
    })
  }
}
