import { NextApiRequest, NextApiResponse } from 'next'
import { runDailyAnalysis } from '@/lib/forecast-engine'
import { saveDailyRun, saveForecastRecords } from '@/lib/supabase'
import { CIUDADES_ASIA } from '@/lib/cities'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const fechaObjetivo = req.query.fecha as string || req.body?.fecha
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const defaultFecha = tomorrow.toISOString().slice(0, 10)

    const fecha = fechaObjetivo || defaultFecha
    const result = await runDailyAnalysis(fecha, true)

    // Save to Supabase (fire-and-forget for manual runs)
    const records = result.cities.map(city => ({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fecha,
      ciudad: city.ciudad,
      slug: city.slug,
      temp_pronosticada: city.forecast.temp_ponderada,
      temp_corregida: city.forecast.temp_corregida,
      temp_real: null,
      error: null,
      modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
      consenso: city.forecast.consenso,
    }))

    await Promise.all([
      saveForecastRecords(records),
      saveDailyRun({
        fecha_ejecucion: result.fecha,
        fecha_objetivo: fecha,
        resultados: result.cities,
        recomendaciones: result.recommendations,
        total_asignado: result.total_allocated,
      }),
    ])

    return res.status(200).json(result)
  } catch (error) {
    console.error('Forecast API error:', error)
    return res.status(500).json({
      error: 'Error ejecutando análisis',
      details: (error as Error).message,
    })
  }
}
