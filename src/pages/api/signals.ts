import { NextApiRequest, NextApiResponse } from 'next'
import { buildSignalsPackage, CitySignal } from '@/lib/signals-engine'
import { runDailyAnalysis } from '@/lib/forecast-engine'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' })
  }

  const format = (req.query.format as string) || 'json'

  try {
    // Run fresh analysis directly (avoids self-request issues on serverless)
    const caracasOffset = -4 * 60
    const nowCaracas = new Date(new Date().getTime() + caracasOffset * 60000)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    const fechaObjetivo = nowCaracas.toISOString().slice(0, 10)
    const analysis = await runDailyAnalysis(fechaObjetivo)

    // Use historical errors already collected by runDailyAnalysis
    const historicalErrors: Record<string, number[]> = analysis.historicalErrors

    // Map cities to input format
    const cities = analysis.cities.map(c => ({
      ciudad: c.ciudad,
      slug: c.slug,
      exito_pct: c.exito_pct,
      exito_pct_integer: c.exito_pct_integer,
      forecast: c.forecast,
      volatilidad: c.forecast.volatilidad ?? 0,
      spread: Math.max(...Object.values(c.forecast.ensemble_raw)) - Math.min(...Object.values(c.forecast.ensemble_raw)),
      consenso: c.forecast.consenso,
      nowcast: c.nowcast,
      weather: c.forecast.weather,
      totalRecords: c.totalRecords,
    }))

    const globalMetrics = {
      accuracy_pct: analysis.global_metrics?.accuracy_pct ?? 0,
      overall_mae: analysis.global_metrics?.overall_mae ?? 0,
      total_muestras: analysis.global_metrics?.total_muestras ?? 0,
    }

    const recommendations = analysis.recommendations.map(r => ({
      slug: r.slug,
      edge: r.edge,
      ia_pct: r.ia_pct,
      mkt_pct: r.mkt_pct,
    }))

    // Determine if this data is from CRON (10PM) or fresh analysis
    const isCron = analysis.message?.includes('Cron') ?? false

    const signalsPackage = buildSignalsPackage(
      cities, globalMetrics, recommendations,
      historicalErrors, analysis.fecha_objetivo, isCron
    )

    if (format === 'csv') {
      const csv = buildCSV(signalsPackage.signals)
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="signals-${analysis.fecha_objetivo}.csv"`)
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
