import { NextApiRequest, NextApiResponse } from 'next'
import { runDailyAnalysis } from '@/lib/forecast-engine'
import { CityAnalysis } from '@/types'
import { saveDailyRun, saveForecastRecords, upsertForecastSnapshot } from '@/lib/supabase'
import { CIUDADES_ASIA } from '@/lib/cities'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const fechaQuery = req.query.fecha as string || req.body?.fecha
    // Default to tomorrow in Caracas timezone (UTC-4): 
    // if it's 10pm Caracas (02:00 UTC+1d), "tomorrow" in Caracas is today+1 in Caracas
    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    const defaultFecha = nowCaracas.toISOString().slice(0, 10)
    const fecha = fechaQuery || defaultFecha
    const result = await runDailyAnalysis(fecha, true)

    // Preserve temp_corregida from the 10PM Caracas cron run if it exists
    try {
      const savedResp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/daily_runs?fecha_objetivo=eq.${fecha}&order=fecha_ejecucion.desc&limit=1`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''}` },
        signal: AbortSignal.timeout(5000),
      })
      if (savedResp.ok) {
        const savedRows = await savedResp.json()
        if (savedRows && savedRows.length > 0) {
          const savedCities: CityAnalysis[] = typeof savedRows[0].resultados === 'string' ? JSON.parse(savedRows[0].resultados) : savedRows[0].resultados
          const savedMap = new Map(savedCities.map(c => [c.slug, c.forecast.temp_corregida]))
          for (const city of result.cities) {
            const saved = savedMap.get(city.slug)
            if (saved !== undefined) city.forecast.temp_corregida = saved
          }
        }
      }
    } catch { /* no saved cron data — use freshly computed values */ }

    // Determinar run_type para corridas manuales
    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    const caracasHour = nowCaracas.getUTCHours()
    const runLabel = caracasHour >= 22 || caracasHour < 1
      ? (caracasHour >= 23 || caracasHour < 1 ? '11PM' : '10PM')
      : 'MANUAL'

    // Save to Supabase (fire-and-forget for manual runs)
    const records = result.cities.map(city => ({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fecha,
      ciudad: city.ciudad,
      slug: city.slug,
      // Base del ensemble en forecast_history (entrenamiento MC/Kalman estable);
      // el valor corregido por el modelo ganador se guarda en daily_runs.
      temp_pronosticada: city.forecast.temp_ponderada,
      temp_corregida: city.forecast.temp_corregida_base ?? city.forecast.temp_corregida,
      temp_real: null,
      error: null,
      modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
      consenso: city.forecast.consenso,
    }))

    const { getModelSelectionCache } = await import('@/lib/modelo-selector')
    const modelCache = getModelSelectionCache()

    await Promise.all([
      saveForecastRecords(records, runLabel),
      saveDailyRun({
        fecha_ejecucion: result.fecha,
        fecha_objetivo: fecha,
        resultados: result.cities,
        recomendaciones: result.recommendations,
        total_asignado: result.total_allocated,
        run_type: (runLabel === 'MANUAL' ? undefined : runLabel) as '10PM' | '11PM' | undefined,
      }),
      // Escribir snapshots para corridas manuales también
      ...result.cities.map(city => {
        const sel = modelCache[city.slug]
        return upsertForecastSnapshot({
          fecha_objetivo: fecha,
          slug: city.slug,
          ciudad: city.ciudad,
          run_type_ganadora: (runLabel === 'MANUAL' ? '11PM' : runLabel) as '10PM' | '11PM',
          modelo_ganador: sel?.modelo ?? 'ENSEMBLE',
          temp_pronosticada: city.forecast.temp_ponderada,
          temp_corregida: city.forecast.temp_corregida,
          temp_ponderada: city.forecast.temp_ponderada,
          consenso: city.forecast.consenso,
          modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
          temp_10pm: null,
          temp_11pm: null,
          modelo_10pm: null,
          modelo_11pm: null,
          temp_real: null,
          error: null,
        })
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
