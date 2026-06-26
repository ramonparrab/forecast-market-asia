import { NextApiRequest, NextApiResponse } from 'next'
import { getHistoricalRecords, getDailyRuns } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const limit = parseInt(req.query.limit as string) || 100
    const type = req.query.type as string || 'all'

    let history = await getHistoricalRecords(limit)
    let runs = await getDailyRuns(limit)

    if (type === 'forecasts') {
      return res.status(200).json({ history })
    } else if (type === 'runs') {
      return res.status(200).json({ runs })
    }

    return res.status(200).json({ history, runs })
  } catch (error) {
    console.error('History API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
