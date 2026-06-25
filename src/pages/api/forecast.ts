import { NextApiRequest, NextApiResponse } from 'next'
import { runDailyAnalysis } from '@/lib/forecast-engine'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const fechaObjetivo = req.query.fecha as string || req.body?.fecha
    const today = new Date()
    // If no date provided, target tomorrow (since we run at 10PM for next day)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const defaultFecha = tomorrow.toISOString().slice(0, 10)

    const fecha = fechaObjetivo || defaultFecha
    const result = await runDailyAnalysis(fecha, true)

    return res.status(200).json(result)
  } catch (error) {
    console.error('Forecast API error:', error)
    return res.status(500).json({
      error: 'Error ejecutando análisis',
      details: (error as Error).message,
    })
  }
}
