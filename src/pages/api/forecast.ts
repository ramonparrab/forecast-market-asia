import { NextApiRequest, NextApiResponse } from 'next'
import { runDailyAnalysis } from '@/lib/forecast-engine'
import { CityAnalysis, DailyAnalysis } from '@/types'
import { getClient } from '@/lib/supabase'

/**
 * GET  /api/forecast?fecha=YYYY-MM-DD — SOLO LECTURA de lo guardado por el cron.
 *        Sirve el último daily_runs de esa fecha (10PM/11PM). No ejecuta el
 *        pipeline, no llama APIs externas, NO escribe en la BD.
 *
 * POST /api/forecast { fecha? } — análisis manual bajo demanda (botón "Analizar").
 *        Ejecuta runDailyAnalysis y responde el resultado PARA VISUALIZACIÓN.
 *        NO ESCRIBE nada en la BD: los únicos escritores de daily_runs /
 *        forecast_history / forecast_snapshot son los crons 10PM/11PM.
 *        (Antes este endpoint escribía con run_type 'MANUAL' o etiquetas
 *        10PM/11PM según la hora del click — fuente de contaminación histórica
 *        y de consumo innecesario de la cuota de Open-Meteo.)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // "Mañana Caracas" = día objetivo del cron (mismo criterio que daily.ts)
  const caracasOffset = -4 * 60 * 60000
  const nowCaracas = new Date(Date.now() + caracasOffset)
  nowCaracas.setDate(nowCaracas.getDate() + 1)
  const defaultFecha = nowCaracas.toISOString().slice(0, 10)
  const fecha = (req.query.fecha as string || req.body?.fecha || defaultFecha).slice(0, 10)

  try {
    if (req.method === 'GET') {
      // ===== LECTURA PURA: lo que guardó el cron =====
      const client = getClient()
      if (!client) return res.status(500).json({ error: 'Supabase no configurado' })

      const { data, error } = await (client.from('daily_runs' as any) as any)
        .select('id, fecha_ejecucion, fecha_objetivo, resultados, recomendaciones, total_asignado, run_type')
        .eq('fecha_objetivo', fecha)
        .order('fecha_ejecucion', { ascending: false })
        .limit(2)

      if (error) {
        return res.status(500).json({ error: 'Error leyendo daily_runs', details: error.message })
      }
      if (!data || data.length === 0) {
        return res.status(404).json({
          error: 'Sin datos guardados para esa fecha',
          fecha,
          hint: 'Los datos los registra el cron 10PM/11PM Caracas (/api/cron/daily). Usa POST para un análisis en vivo sin guardado.',
        })
      }

      // Preferir 11PM (más reciente); fallback 10PM
      const chosen = (data as any[]).find(r => r.run_type === '11PM') ?? (data as any[])[0]
      const parseRun = (row: any): DailyAnalysis => {
        const parsedCities: CityAnalysis[] = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : row.resultados
        const parsedRecs = typeof row.recomendaciones === 'string' ? JSON.parse(row.recomendaciones) : row.recomendaciones
        return {
          fecha: row.fecha_ejecucion,
          fecha_objetivo: row.fecha_objetivo,
          message: `Corrida ${row.run_type ?? 'cron'} del ${new Date(row.fecha_ejecucion).toLocaleString('es-ES', { timeZone: 'America/Caracas' })} Caracas`,
          cities: parsedCities ?? [],
          recommendations: parsedRecs ?? [],
          total_allocated: row.total_asignado ?? 0,
          global_metrics: null,
          arbitrage_alerts: [],
          historicalErrors: {},
        } as DailyAnalysis
      }
      return res.status(200).json(parseRun(chosen))
    }

    // ===== POST: análisis manual en vivo (sin escritura en BD) =====
    const result = await runDailyAnalysis(fecha, true)

    // Alinearse con lo que guardó el cron si ya existe (misma temp_corregida
    // que verá el usuario en TOMAR DECISION) — ANTES de responder.
    try {
      const client = getClient()
      if (client) {
        const { data } = await (client.from('daily_runs' as any) as any)
          .select('resultados')
          .eq('fecha_objetivo', fecha)
          .order('fecha_ejecucion', { ascending: false })
          .limit(1)
        const savedCities: CityAnalysis[] | null =
          data && (data as any[]).length > 0
            ? (typeof (data as any[])[0].resultados === 'string' ? JSON.parse((data as any[])[0].resultados) : (data as any[])[0].resultados)
            : null
        if (savedCities) {
          const savedMap = new Map(savedCities.map(c => [c.slug, c.forecast?.temp_corregida]))
          for (const city of result.cities) {
            const saved = savedMap.get(city.slug)
            if (saved !== undefined) city.forecast.temp_corregida = saved
          }
        }
      }
    } catch { /* no saved cron data */ }

    return res.status(200).json(result)
  } catch (error) {
    console.error('Forecast API error:', error)
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Error ejecutando análisis',
        details: (error as Error).message,
      })
    }
  }
}
