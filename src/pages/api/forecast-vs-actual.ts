import { NextApiRequest, NextApiResponse } from 'next'
import { getForecastVsActual } from '@/lib/supabase'

/**
 * GET /api/forecast-vs-actual
 * Returns forecast vs actual temperature data for the comparison chart.
 * Optional query param: ?slug=tokyo (to filter by city)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const slug = req.query.slug as string | undefined
    const limit = parseInt(req.query.limit as string || '100')
    const data = await getForecastVsActual(slug, limit)

    return res.status(200).json({
      status: 'ok',
      total: data.length,
      records: data,
    })
  } catch (error) {
    console.error('Forecast vs Actual API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
