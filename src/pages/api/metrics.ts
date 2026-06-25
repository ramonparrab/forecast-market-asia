import { NextApiRequest, NextApiResponse } from 'next'
import { computeGlobalMetrics } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const metrics = await computeGlobalMetrics()
    return res.status(200).json(metrics || { error: 'No hay suficientes datos históricos' })
  } catch (error) {
    console.error('Metrics API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
