import { NextApiRequest, NextApiResponse } from 'next'
import { computeGlobalMetrics, getAccumulatedBacktest } from '@/lib/supabase'
import { AccuracyMetrics } from '@/types'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const [liveMetrics, backtestSummary] = await Promise.all([
      computeGlobalMetrics(),
      getAccumulatedBacktest(90).catch(() => null),
    ])

    // Build result from live metrics, or create a skeleton if none exist
    const result: Record<string, any> = liveMetrics ? { ...liveMetrics } : {
      overall_mae: 0, overall_rmse: 0, overall_bias: 0, brier_score: 0,
      total_muestras: 0, accuracy_pct: 0, por_ciudad: [], evolucion_diaria: [],
    }

    // Attach backtest data if available
    if (backtestSummary && backtestSummary.total_muestras > 0) {
      const porCiudadBacktest: AccuracyMetrics[] = backtestSummary.por_ciudad.map(c => ({
        ciudad: c.ciudad,
        slug: c.slug,
        mae: c.mae,
        rmse: c.rmse,
        bias: c.bias,
        muestras: c.muestras,
      }))

      result.backtest = {
        total_muestras: backtestSummary.total_muestras,
        overall_mae: backtestSummary.overall_mae,
        overall_rmse: backtestSummary.overall_rmse,
        overall_bias: backtestSummary.overall_bias,
        accuracy_2c: backtestSummary.overall_accuracy_2c,
        accuracy_1c: backtestSummary.overall_accuracy_1c,
        total_dias: backtestSummary.total_dias,
        por_ciudad: porCiudadBacktest,
      }
    }

    return res.status(200).json(result)
  } catch (error) {
    console.error('Metrics API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
