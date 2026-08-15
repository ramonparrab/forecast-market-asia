import { NextApiRequest, NextApiResponse } from 'next'

let cache: { data: any; ts: number } | null = null
const CACHE_TTL = 300_000 // 5 min

interface BacktestResult {
  fecha: string
  ciudad: string
  slug: string
  temp_corregida: number
  temp_real: number
  error: number
  run_type_ganadora: string
}

interface CityMetrics {
  ciudad: string
  slug: string
  mae: number
  rmse: number
  bias: number
  accuracy_within_1c: number
  max_error: number
  muestras: number
}

interface BacktestSummary {
  total_dias: number
  total_ciudades: number
  total_muestras: number
  overall_mae: number
  overall_rmse: number
  overall_bias: number
  overall_accuracy_1c: number
  por_ciudad: CityMetrics[]
  mejores_ciudades: string[]
  peores_ciudades: string[]
  resultados: BacktestResult[]
  evolucion_diaria: { fecha: string; mae_diario: number; mae_7d: number }[]
  period: number | 'all'
  timestamp: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const daysParam = req.query.days as string | undefined
  const days = daysParam === 'all' ? 'all' : Math.min(parseInt(daysParam || '90'), 730)

  const cacheKey = `${days}`
  if (cache && (Date.now() - cache.ts) < CACHE_TTL && (cache.data as any)?._ck === cacheKey) {
    return res.status(200).json({ status: 'ok', cached: true, data: cache.data })
  }

  try {
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({ status: 'ok', data: null, error: 'No Supabase config' })
    }

    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(supabaseUrl, supabaseKey)

    // Leer de forecast_snapshot (misma fuente que RESUMEN)
    // Solo registros verificados con temp_real
    let query = client
      .from('forecast_snapshot' as any)
      .select('fecha_objetivo, slug, ciudad, run_type_ganadora, modelo_ganador, temp_corregida, temp_ponderada, temp_real, error')
      .not('temp_real', 'is', null)
      .not('error', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    if (days !== 'all') {
      const since = new Date(Date.now() - (days as number) * 86400000).toISOString().slice(0, 10)
      query = query.gte('fecha_objetivo', since)
    }

    const { data, error } = await query

    if (error || !data || (data as any[]).length === 0) {
      return res.status(200).json({ status: 'ok', data: null, error: 'Sin datos verificados' })
    }

    const rows = data as any[]

    // Deduplicar: un registro por slug+fecha_objetivo (el más reciente por id si hay duplicados)
    const seen = new Map<string, any>()
    for (const r of rows) {
      const key = `${r.slug}|${r.fecha_objetivo}`
      const existing = seen.get(key)
      if (!existing || (r.id && existing.id && r.id > existing.id)) {
        seen.set(key, r)
      } else if (!existing) {
        seen.set(key, r)
      }
    }

    const unique = Array.from(seen.values())

    // Build results
    const resultados: BacktestResult[] = unique.map(r => ({
      fecha: r.fecha_objetivo,
      ciudad: r.ciudad,
      slug: r.slug,
      temp_corregida: r.temp_corregida,
      temp_real: r.temp_real,
      error: r.error,
      run_type_ganadora: r.run_type_ganadora ?? 'N/A',
    }))

    // Per-city metrics
    const byCity = new Map<string, BacktestResult[]>()
    for (const r of resultados) {
      if (!byCity.has(r.slug)) byCity.set(r.slug, [])
      byCity.get(r.slug)!.push(r)
    }

    const por_ciudad: CityMetrics[] = Array.from(byCity.entries()).map(([slug, results]) => {
      const errors = results.map(r => r.error)
      const absErrors = errors.map(Math.abs)
      const mae = round2(absErrors.reduce((s, v) => s + v, 0) / errors.length)
      const rmse = round2(Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / errors.length))
      const bias = round2(errors.reduce((s, v) => s + v, 0) / errors.length)
      const within1 = results.filter(r => Math.abs(r.error) <= 1).length
      const maxError = round2(Math.max(...absErrors))
      return {
        ciudad: results[0].ciudad,
        slug,
        mae, rmse, bias,
        accuracy_within_1c: round2(within1 / results.length * 100),
        max_error: maxError,
        muestras: results.length,
      }
    }).sort((a, b) => a.mae - b.mae)

    // Global metrics
    const allErrors = resultados.map(r => r.error)
    const allAbs = allErrors.map(Math.abs)
    const uniqueDates = new Set(resultados.map(r => r.fecha))

    const overall_mae = round2(allAbs.reduce((s, v) => s + v, 0) / allErrors.length)
    const overall_rmse = round2(Math.sqrt(allErrors.reduce((s, v) => s + v * v, 0) / allErrors.length))
    const overall_bias = round2(allErrors.reduce((s, v) => s + v, 0) / allErrors.length)
    const overall_accuracy_1c = round2(resultados.filter(r => Math.abs(r.error) <= 1).length / resultados.length * 100)

    // Evolución diaria (MAE por día + media móvil 7d)
    const byDate = new Map<string, number[]>()
    for (const r of resultados) {
      if (!byDate.has(r.fecha)) byDate.set(r.fecha, [])
      byDate.get(r.fecha)!.push(Math.abs(r.error))
    }
    const evolucion: { fecha: string; mae_diario: number; mae_7d: number }[] = Array.from(byDate.entries())
      .map(([fecha, errors]) => ({
        fecha,
        mae_diario: round2(errors.reduce((s, v) => s + v, 0) / errors.length),
        mae_7d: 0,
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    for (let i = 0; i < evolucion.length; i++) {
      const window = evolucion.slice(Math.max(0, i - 6), i + 1)
      evolucion[i].mae_7d = round2(window.reduce((s, w) => s + w.mae_diario, 0) / window.length)
    }

    const summary: BacktestSummary = {
      total_dias: uniqueDates.size,
      total_ciudades: byCity.size,
      total_muestras: resultados.length,
      overall_mae,
      overall_rmse,
      overall_bias,
      overall_accuracy_1c,
      por_ciudad,
      mejores_ciudades: por_ciudad.slice(0, 3).map(c => c.ciudad),
      peores_ciudades: por_ciudad.slice(-3).reverse().map(c => c.ciudad),
      resultados,
      evolucion_diaria: evolucion,
      period: days,
      timestamp: new Date().toISOString(),
    }

    const payload = { ...summary, _ck: cacheKey }
    cache = { data: payload, ts: Date.now() }

    return res.status(200).json({ status: 'ok', cached: false, data: summary, source: 'forecast_snapshot' })
  } catch (err) {
    console.error('[BACKTEST] Error:', err)
    return res.status(500).json({ status: 'error', message: (err as Error).message })
  }
}

function round2(n: number) { return Math.round(n * 100) / 100 }
