import { NextApiRequest, NextApiResponse } from 'next'
import { runBacktest } from '@/lib/backtest-engine'

/**
 * POST /api/backtest?days=90
 * Ejecuta backtesting histórico: compara pronóstico vs real para los últimos N días.
 * 
 * GET /api/backtest
 * Retorna resultados de la última ejecución (desde memoria temporal).
 * 
 * El backtest es intensivo: ~18 llamadas a Open-Meteo en paralelo.
 * Tiempo estimado: 5-15 segundos.
 */

let cachedResult: any = null
let cachedTimestamp = 0
const CACHE_TTL_MS = 300_000 // 5 min

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    if (cachedResult && (Date.now() - cachedTimestamp) < CACHE_TTL_MS) {
      return res.status(200).json({ status: 'ok', cached: true, ...cachedResult })
    }
    return res.status(200).json({ status: 'ok', cached: false, data: null })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const days = Math.min(parseInt(req.query.days as string || '90'), 365)
    
    // Set timeout for the entire request
    const result = await runBacktest(days)

    // Cache in memory
    cachedResult = { data: result }
    cachedTimestamp = Date.now()

    return res.status(200).json({
      status: 'ok',
      cached: false,
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
