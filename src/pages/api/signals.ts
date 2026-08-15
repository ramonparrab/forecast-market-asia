import { NextApiRequest, NextApiResponse } from 'next'
import { buildSignalsPackage, CitySignal } from '@/lib/signals-engine'
import { createClient } from '@supabase/supabase-js'
import { getAllHistoricalErrors, computeGlobalMetrics } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' })
  }

  const format = (req.query.format as string) || 'json'

  try {
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ status: 'error', message: 'Supabase not configured' })
    }

    const client = createClient(supabaseUrl, supabaseKey)

    // Fecha objetivo: mañana en hora Caracas (igual que RESUMEN)
    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    const fecha = nowCaracas.toISOString().slice(0, 10)

    // Paralelizar: daily_runs + snapshots + errores históricos + métricas globales
    const [runsResult, ayerResult, snapshotsResult, historicalErrors, globalMetrics] = await Promise.all([
      // Query del día — obtener 10PM y 11PM por separado
      client.from('daily_runs' as any).select('*').eq('fecha_objetivo', fecha).order('fecha_ejecucion', { ascending: false } as any).limit(2),
      // Fallback: día anterior
      (() => {
        const yc = new Date(Date.now() + caracasOffset)
        return client.from('daily_runs' as any).select('*').eq('fecha_objetivo', yc.toISOString().slice(0, 10)).order('fecha_ejecucion', { ascending: false } as any).limit(1)
      })(),
      // Snapshots para elegir 10PM vs 11PM
      client.from('forecast_snapshot' as any).select('slug, run_type_ganadora').eq('fecha_objetivo', fecha).is('temp_real', null),
      // Errores históricos para bandas P5-P95
      getAllHistoricalErrors(),
      // Métricas globales
      computeGlobalMetrics(),
    ])

    const runs = (runsResult.data as any[] | undefined) ?? []
    const ayerData = (ayerResult.data as any[] | undefined) ?? []
    const snapshots = (snapshotsResult.data as any[] | undefined) ?? []

    // Elegir la corrida ganadora (misma lógica que RESUMEN en index.tsx)
    let chosenRun: any = null
    if (runs.length === 1) {
      chosenRun = runs[0]
    } else if (runs.length >= 2) {
      const snapWins: Record<string, number> = {}
      for (const s of snapshots) {
        snapWins[s.run_type_ganadora] = (snapWins[s.run_type_ganadora] ?? 0) + 1
      }
      const wins10 = snapWins['10PM'] ?? 0
      const wins11 = snapWins['11PM'] ?? 0
      const preferred = wins10 > wins11 ? '10PM' : '11PM'
      chosenRun = runs.find((r: any) => r.run_type === preferred) ?? runs[0]
    }
    if (!chosenRun && ayerData.length) {
      chosenRun = ayerData[0]
    }
    if (!chosenRun) {
      return res.status(404).json({ status: 'error', message: 'No hay corrida disponible para hoy ni ayer' })
    }

    // Parsear resultados y recomendaciones del daily_run elegido
    const parsedCities = typeof chosenRun.resultados === 'string'
      ? JSON.parse(chosenRun.resultados)
      : chosenRun.resultados
    const parsedRecs = typeof chosenRun.recomendaciones === 'string'
      ? JSON.parse(chosenRun.recomendaciones)
      : chosenRun.recomendaciones

    if (!parsedCities || !Array.isArray(parsedCities) || parsedCities.length === 0) {
      return res.status(404).json({ status: 'error', message: 'La corrida elegida no tiene ciudades' })
    }

    // Mapear al formato que espera buildSignalsPackage (CitySignalInput)
    const cities = parsedCities.map((c: any) => ({
      ciudad: c.ciudad,
      slug: c.slug,
      exito_pct: c.exito_pct ?? 0,
      exito_pct_integer: c.exito_pct_integer ?? 0,
      forecast: c.forecast,
      volatilidad: c.forecast?.volatilidad ?? 0,
      spread: c.forecast?.ensemble_raw
        ? Math.max(...Object.values(c.forecast.ensemble_raw as Record<string, number>)) - Math.min(...Object.values(c.forecast.ensemble_raw as Record<string, number>))
        : 0,
      consenso: c.forecast?.consenso ?? 'ACEPTABLE',
      nowcast: c.nowcast,
      weather: c.forecast?.weather,
      totalRecords: c.totalRecords,
    }))

    const recommendations = (parsedRecs ?? []).map((r: any) => ({
      slug: r.slug,
      edge: r.edge,
      ia_pct: r.ia_pct,
      mkt_pct: r.mkt_pct,
    }))

    const metrics = {
      accuracy_pct: globalMetrics?.accuracy_pct ?? 0,
      overall_mae: globalMetrics?.overall_mae ?? 0,
      total_muestras: globalMetrics?.total_muestras ?? 0,
    }

    // Determinar si es cron
    const isCron = !!(chosenRun.run_type)

    const signalsPackage = buildSignalsPackage(
      cities, metrics, recommendations,
      historicalErrors, chosenRun.fecha_objetivo, isCron
    )

    if (format === 'csv') {
      const csv = buildCSV(signalsPackage.signals)
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="signals-${chosenRun.fecha_objetivo}.csv"`)
      return res.status(200).send(csv)
    }

    return res.status(200).json(signalsPackage)
  } catch (error) {
    console.error('Signals API error:', error)
    return res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

function buildCSV(signals: CitySignal[]): string {
  const headers = [
    'ciudad', 'slug', 'pais', 'forecast_c', 'raw_ensemble_c', 'sesgo_aplicado',
    'banda_p5', 'banda_p95', 'banda_ancho',
    'prob_sobre_35c', 'prob_bajo_30c', 'prob_bajo_25c', 'prob_sobre_40c',
    'edge_pct', 'market_prob', 'model_prob',
    'confianza_label', 'confianza_score', 'precision_historica_pct', 'muestras_historicas',
    'consenso', 'nowcast_activo', 'clima', 'alerta_extrema',
    'recomendacion',
  ]
  const rows = signals.map(s => [
    s.ciudad, s.slug, s.pais, s.forecast_c.toFixed(1), s.raw_ensemble_c.toFixed(1), s.sesgo_aplicado.toFixed(2),
    s.band.p5.toFixed(2), s.band.p95.toFixed(2), s.band.bandWidth.toFixed(2),
    s.prob_sobre_35c ?? '', s.prob_bajo_30c ?? '', s.prob_bajo_25c ?? '', s.prob_sobre_40c ?? '',
    s.edge_pct?.toFixed(1) ?? '', s.market_prob ?? '', s.model_prob ?? '',
    s.confidence.label, s.confidence.score.toFixed(3), s.historical_accuracy_pct.toFixed(0), s.historical_samples,
    s.consenso, s.nowcast_activo ? 'SI' : 'NO', s.weather.label, s.extreme_alert ? `SI_${s.extreme_type}` : 'NO',
    s.recomendacion,
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))

  return [headers.join(','), ...rows].join('\n')
}
