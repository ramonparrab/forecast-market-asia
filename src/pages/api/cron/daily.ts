import { NextApiRequest, NextApiResponse } from 'next'
import { runDailyAnalysis } from '@/lib/forecast-engine'

/**
 * Vercel Cron Job - runs at 2:00 AM UTC (10:00 PM Caracas UTC-4)
 * vercel.json: { "crons": [{ "path": "/api/cron/daily", "schedule": "0 2 * * *" }] }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret (optional but recommended)
  const authHeader = req.headers.authorization
  const expectedSecret = process.env.CRON_SECRET || ''

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Target tomorrow's date (run at 10PM for next day)
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const fechaObjetivo = tomorrow.toISOString().slice(0, 10)

    console.log(`[CRON] Running daily analysis for ${fechaObjetivo}`)
    const result = await runDailyAnalysis(fechaObjetivo, true)

    // Log summary
    console.log(`[CRON] Analysis complete: ${result.recommendations.length} recommendations, $${result.total_allocated} allocated`)

    return res.status(200).json({
      status: 'ok',
      message: `Daily analysis for ${fechaObjetivo} completed`,
      recommendations: result.recommendations.length,
      total_allocated: result.total_allocated,
      arbitrage_alerts: result.arbitrage_alerts.length,
    })
  } catch (error) {
    console.error('[CRON] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
