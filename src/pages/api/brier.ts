import { NextApiRequest, NextApiResponse } from 'next'
import { computeBrier } from '@/lib/brier'

/**
 * GET /api/brier?dias=30|all
 *
 * Brier score del sistema vs el mercado de Polymarket, calculado sobre los
 * contratos guardados en daily_runs (prob_ia_norm y prob_mkt de cada corrida
 * 10PM/11PM) resueltos contra forecast_snapshot.temp_real.
 * Solo lectura. Cacheado 5 min en CDN.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const diasParam = req.query.dias as string | undefined
    const dias: number | 'all' =
      diasParam === 'all' ? 'all' : Math.max(7, Math.min(365, parseInt(diasParam || '30') || 30))

    const summary = await computeBrier(dias)

    return res
      .status(200)
      .setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
      .json(summary)
  } catch (error) {
    console.error('Brier API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
