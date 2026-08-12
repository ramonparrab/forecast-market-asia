import { NextApiRequest, NextApiResponse } from 'next'
import { recoverEnsembleFromDailyRuns, computeGlobalMetrics } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const result = await recoverEnsembleFromDailyRuns()

    const metrics = await computeGlobalMetrics()

    return res.status(200).json({
      status: 'ok',
      message: `Backfill ensemble completado: ${result.fixed} actualizados, ${result.skipped} sin ensemble_raw, ${result.errors} errores`,
      ...result,
      global_metrics: metrics ? {
        overall_mae: metrics.overall_mae,
        overall_rmse: metrics.overall_rmse,
        overall_bias: metrics.overall_bias,
        accuracy_pct: metrics.accuracy_pct,
        total_muestras: metrics.total_muestras,
        por_ciudad: metrics.por_ciudad,
      } : null,
    })
  } catch (error) {
    console.error('[BACKFILL-ENSEMBLE] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
