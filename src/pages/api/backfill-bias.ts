import { NextApiRequest, NextApiResponse } from 'next'
import { getAllRecordsWithActuals, fixBiasSign, computeGlobalMetrics } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const records = await getAllRecordsWithActuals()

    if (records.length === 0) {
      return res.status(200).json({
        status: 'ok', message: 'No hay registros con temp_real', fixed: 0,
      })
    }

    let fixed = 0
    let skipped = 0
    let errors = 0
    const results: { id: number; slug: string; oldTc: number; newTc: number; oldError: number; newError: number }[] = []

    for (const r of records) {
      // Old system: temp_corregida_old = temp_pronosticada - sesgo
      // New system: temp_corregida_new = temp_pronosticada + sesgo
      // Derived: sesgo = temp_pronosticada - temp_corregida_old
      //          temp_corregida_new = 2 * temp_pronosticada - temp_corregida_old
      const oldTc = r.temp_corregida
      const newTc = Math.round((2 * r.temp_pronosticada - oldTc) * 100) / 100

      // Skip if no change (bias was 0, or nowcast override)
      if (Math.abs(newTc - oldTc) < 0.01) {
        skipped++
        continue
      }

      const newError = Math.round((r.temp_real - newTc) * 100) / 100
      const ok = await fixBiasSign(r.id, newTc, newError)

      if (ok) {
        fixed++
        results.push({ id: r.id, slug: r.slug, oldTc, newTc, oldError: r.error, newError })
      } else {
        errors++
      }
    }

    // Recompute global metrics after fix
    const metrics = await computeGlobalMetrics()

    return res.status(200).json({
      status: 'ok',
      message: `Backfill bias completado: ${fixed} fijados, ${skipped} sin cambios, ${errors} errores`,
      total_records: records.length,
      fixed,
      skipped,
      errors,
      results,
      global_metrics: metrics ? {
        overall_mae: metrics.overall_mae,
        overall_rmse: metrics.overall_rmse,
        overall_bias: metrics.overall_bias,
        accuracy_pct: metrics.accuracy_pct,
        total_muestras: metrics.total_muestras,
        por_ciudad: metrics.por_ciudad,
      } : null,
    })
  } catch (error) {
    console.error('[BACKFILL-BIAS] Error:', error)
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
