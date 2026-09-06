import { NextApiRequest, NextApiResponse } from 'next'
import { computeShadowDuelo } from '@/lib/shadow'

/**
 * GET /api/shadow?dias=30|all
 *
 * MODO SOMBRA v2 — duelo de probabilidades: PRODUCCIÓN (prob_ia_norm de
 * daily_runs) vs SOMBRA v2 (receta congelada: centro único temp_corregida +
 * t(4)·σ=1.5 + regla de pago exacta, calculada al vuelo de forma analítica
 * y determinista) vs MERCADO (prob_mkt), puntuadas con Brier contra la
 * resolución real (forecast_snapshot.temp_real).
 *
 * SOLO LECTURA: no escribe en ninguna tabla, no usa service key, no toca
 * los cálculos de producción. Cacheado 5 min en CDN.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const diasParam = req.query.dias as string | undefined
    const dias: number | 'all' =
      diasParam === 'all' ? 'all' : Math.max(7, Math.min(365, parseInt(diasParam || '30') || 30))

    const summary = await computeShadowDuelo(dias)

    return res
      .status(200)
      .setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')
      .json(summary)
  } catch (error) {
    console.error('Shadow API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
