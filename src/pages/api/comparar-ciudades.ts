import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeAllMejoras, DiaComparacion } from '@/lib/mejora-continua-engine'

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

interface CityMetrics {
  slug: string
  nombre: string
  muestras: number
  mae_corregida: number
  mae_combinado: number
  mejora_mae_pct: number
  rmse_corregida: number
  rmse_combinado: number
  bias_corregida: number
  bias_combinado: number
  veces_mejor_combinado: number
  veces_mejor_pct: number
  mae_max_corregida: number
  mae_max_combinado: number
  error_estacion_bias: number
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })

  try {
    const client = createClient(supabaseUrl, supabaseKey)
    const slugs = ['wuhan', 'chongqing']

    // Fetch records and compute mejora for both cities
    const allMejoraResults: Record<string, { result: ReturnType<typeof computeAllMejoras>, slug: string }> = {}

    for (const slug of slugs) {
      const { data: records } = await client
        .from('forecast_history' as any)
        .select('id, fecha_objetivo, slug, temp_corregida, temp_real, error')
        .eq('slug', slug)
        .not('temp_real', 'is', null)
        .not('error', 'is', null)
        .order('fecha_objetivo', { ascending: true } as any)

      const nombre = slug.charAt(0).toUpperCase() + slug.slice(1)
      if (!records || !(records as any[]).length) {
        allMejoraResults[slug] = { result: null as any, slug }
        continue
      }
      allMejoraResults[slug] = { result: computeAllMejoras(records as any[], nombre), slug }
    }

    // Compute metrics per city
    const results: CityMetrics[] = []

    for (const slug of slugs) {
      const entry = allMejoraResults[slug]
      if (!entry?.result) {
        results.push({
          slug, nombre: slug.charAt(0).toUpperCase() + slug.slice(1),
          muestras: 0, mae_corregida: 0, mae_combinado: 0, mejora_mae_pct: 0,
          rmse_corregida: 0, rmse_combinado: 0,
          bias_corregida: 0, bias_combinado: 0,
          veces_mejor_combinado: 0, veces_mejor_pct: 0,
          mae_max_corregida: 0, mae_max_combinado: 0,
          error_estacion_bias: 0,
        })
        continue
      }

      const daily = entry.result.dailyResults
      if (daily.length === 0) {
        results.push({
          slug, nombre: slug.charAt(0).toUpperCase() + slug.slice(1),
          muestras: 0, mae_corregida: 0, mae_combinado: 0, mejora_mae_pct: 0,
          rmse_corregida: 0, rmse_combinado: 0,
          bias_corregida: 0, bias_combinado: 0,
          veces_mejor_combinado: 0, veces_mejor_pct: 0,
          mae_max_corregida: 0, mae_max_combinado: 0,
          error_estacion_bias: 0,
        })
        continue
      }

      let sumAbsCorr = 0, sumAbsComb = 0, sumSqCorr = 0, sumSqComb = 0
      let sumErrCorr = 0, sumErrComb = 0, vecesMejor = 0, maxAbsCorr = 0, maxAbsComb = 0

      for (const d of daily) {
        const errCorr = d.temp_real - d.temp_corregida
        const errComb = d.combinado.error
        const absCorr = Math.abs(errCorr)
        const absComb = Math.abs(errComb)

        sumAbsCorr += absCorr; sumAbsComb += absComb
        sumSqCorr += errCorr * errCorr; sumSqComb += errComb * errComb
        sumErrCorr += errCorr; sumErrComb += errComb
        if (absComb < absCorr) vecesMejor++
        if (absCorr > maxAbsCorr) maxAbsCorr = absCorr
        if (absComb > maxAbsComb) maxAbsComb = absComb
      }

      const n = daily.length
      const maeCorr = sumAbsCorr / n
      const maeComb = sumAbsComb / n
      const mejoraPct = maeCorr > 0 ? ((maeCorr - maeComb) / maeCorr * 100) : 0

      results.push({
        slug,
        nombre: slug.charAt(0).toUpperCase() + slug.slice(1),
        muestras: n,
        mae_corregida: Math.round(maeCorr * 1000) / 1000,
        mae_combinado: Math.round(maeComb * 1000) / 1000,
        mejora_mae_pct: Math.round(mejoraPct * 10) / 10,
        rmse_corregida: Math.round(Math.sqrt(sumSqCorr / n) * 1000) / 1000,
        rmse_combinado: Math.round(Math.sqrt(sumSqComb / n) * 1000) / 1000,
        bias_corregida: Math.round((sumErrCorr / n) * 1000) / 1000,
        bias_combinado: Math.round((sumErrComb / n) * 1000) / 1000,
        veces_mejor_combinado: vecesMejor,
        veces_mejor_pct: Math.round(vecesMejor / n * 1000) / 10,
        mae_max_corregida: Math.round(maxAbsCorr * 1000) / 1000,
        mae_max_combinado: Math.round(maxAbsComb * 1000) / 1000,
        error_estacion_bias: Math.round(entry.result.estacion_bias_general * 1000) / 1000,
      })
    }

    // Build comparison
    const w = results.find(r => r.slug === 'wuhan')
    const c = results.find(r => r.slug === 'chongqing')

    let comparacion: any = null
    if (w && c && w.muestras > 0 && c.muestras > 0) {
      comparacion = {
        ventaja_mae_corregida: w.mae_corregida < c.mae_corregida ? 'Wuhan' : 'Chongqing',
        diff_mae_corregida: Math.round(Math.abs(w.mae_corregida - c.mae_corregida) * 1000) / 1000,
        ventaja_mae_combinado: w.mae_combinado < c.mae_combinado ? 'Wuhan' : 'Chongqing',
        diff_mae_combinado: Math.round(Math.abs(w.mae_combinado - c.mae_combinado) * 1000) / 1000,
        ventaja_mejora_pct: w.mejora_mae_pct > c.mejora_mae_pct ? 'Wuhan' : 'Chongqing',
        diff_mejora_pct: Math.round(Math.abs(w.mejora_mae_pct - c.mejora_mae_pct) * 10) / 10,
        ventaja_rmse_combinado: w.rmse_combinado < c.rmse_combinado ? 'Wuhan' : 'Chongqing',
        diff_rmse_combinado: Math.round(Math.abs(w.rmse_combinado - c.rmse_combinado) * 1000) / 1000,
        conclusion_corregida: w.mae_corregida < c.mae_corregida
          ? `Wuhan tiene mejor temperatura corregida cruda (MAE ${w.mae_corregida}°C vs ${c.mae_corregida}°C)`
          : `Chongqing tiene mejor temperatura corregida cruda (MAE ${c.mae_corregida}°C vs ${w.mae_corregida}°C)`,
        conclusion_combinado: w.mae_combinado < c.mae_combinado
          ? `Wuhan tiene mejor COMBINADO (MAE ${w.mae_combinado}°C vs ${c.mae_combinado}°C, mejora ${w.mejora_mae_pct}% vs ${c.mejora_mae_pct}%)`
          : `Chongqing tiene mejor COMBINADO (MAE ${c.mae_combinado}°C vs ${w.mae_combinado}°C, mejora ${c.mejora_mae_pct}% vs ${w.mejora_mae_pct}%)`,
      }
    }

    // Per-day comparison (only dates both cities have)
    let dailyComparison: any[] = []
    const wEntry = allMejoraResults['wuhan']?.result
    const cEntry = allMejoraResults['chongqing']?.result
    if (wEntry && cEntry) {
      const wDays = wEntry.dailyResults
      const cDays = cEntry.dailyResults
      const minLen = Math.min(wDays.length, cDays.length)
      for (let i = 0; i < minLen; i++) {
        dailyComparison.push({
          fecha: wDays[i].fecha,
          wuhan: {
            real: wDays[i].temp_real,
            corregida: wDays[i].temp_corregida,
            combinado: wDays[i].combinado.temp,
            error_corregida: Math.round((wDays[i].temp_real - wDays[i].temp_corregida) * 1000) / 1000,
            error_combinado: wDays[i].combinado.error,
          },
          chongqing: {
            real: cDays[i].temp_real,
            corregida: cDays[i].temp_corregida,
            combinado: cDays[i].combinado.temp,
            error_corregida: Math.round((cDays[i].temp_real - cDays[i].temp_corregida) * 1000) / 1000,
            error_combinado: cDays[i].combinado.error,
          },
        })
      }
    }

    return res.json({
      ciudades: results,
      comparacion,
      daily_comparison: dailyComparison.slice(-90),
      nota: 'Walk-forward: COMBINADO calculado con computeAllMejoras usando datos históricos previos a cada fecha.',
    })
  } catch (error) {
    console.error('[comparar-ciudades]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
