import { NextApiRequest, NextApiResponse } from 'next'
import { loadBacktestBias } from '@/lib/backtest-bias'
import { getBacktestBias } from '@/lib/supabase'

/**
 * GET /api/backtest-bias
 * Retorna el sesgo de backtest activo (per-city correction applied to forecasts).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const bias = await loadBacktestBias()

    // Also get raw entries from DB
    let entries: any[] = []
    try { entries = await getBacktestBias() } catch {}

    return res.status(200).json({
      status: 'ok',
      active_corrections: bias, // slug → bias°C
      entries,                  // all per-city per-month entries
      total_ciudades: Object.keys(bias).length,
    })
  } catch (error) {
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
