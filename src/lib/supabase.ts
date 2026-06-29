import { createClient } from '@supabase/supabase-js'
import { HistoricalRecord, DailyRun, GlobalMetrics, AccuracyMetrics } from '@/types'
import { CIUDADES_ASIA } from './cities'
import { BacktestSummary, BacktestDayResult, BacktestCityMetrics } from './backtest-engine'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

let supabase: ReturnType<typeof createClient> | null = null

function getClient() {
  if (!supabase && supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey)
  }
  return supabase
}

export async function saveDailyRun(run: DailyRun): Promise<number | null> {
  const client = getClient()
  if (!client) return null

  const { data, error } = await client
    .from('daily_runs' as any)
    .insert({
      fecha_ejecucion: run.fecha_ejecucion,
      fecha_objetivo: run.fecha_objetivo,
      resultados: JSON.stringify(run.resultados),
      recomendaciones: JSON.stringify(run.recomendaciones),
      total_asignado: run.total_asignado,
    } as any)
    .select('id')
    .single()

  if (error) {
    console.error('Error saving daily run:', error)
    return null
  }
  return (data as any)?.id ?? null
}

export async function saveForecastRecords(records: HistoricalRecord[]): Promise<void> {
  const client = getClient()
  if (!client || records.length === 0) return

  const { error } = await client
    .from('forecast_history' as any)
    .insert(records.map(r => ({
      fecha_ejecucion: r.fecha_ejecucion,
      fecha_objetivo: r.fecha_objetivo,
      ciudad: r.ciudad,
      slug: r.slug,
      temp_pronosticada: r.temp_pronosticada,
      temp_corregida: r.temp_corregida,
      temp_real: r.temp_real,
      error: r.error,
      modelos_usados: r.modelos_usados,
      consenso: r.consenso,
    })) as any)

  if (error) {
    console.error('Error saving forecast records:', error)
  }
}

export async function getRecentErrors(
  slug: string,
  limit = 30
): Promise<{ error: number }[]> {
  const client = getClient()
  if (!client) return []

  const q = client
    .from('forecast_history' as any)
    .select('error')
    .is('error', 'not.null' as any)
    .order('fecha_ejecucion', { ascending: false } as any)
    .limit(limit)

  if (slug !== 'all') {
    q.eq('slug', slug)
  }

  const { data, error } = await q

  if (error || !data) return []
  return (data as any).map((r: any) => ({ error: r.error }))
}

export async function getRecentModelErrors(
  limit = 30
): Promise<Record<string, number[]>> {
  const client = getClient()
  if (!client) return {}

  const { data, error } = await client
    .from('forecast_history' as any)
    .select('slug, error')
    .is('error', 'not.null' as any)
    .order('fecha_ejecucion', { ascending: false } as any)
    .limit(limit * 9)

  if (error || !data) return {}

  const grouped: Record<string, number[]> = {}
  for (const row of (data as any[])) {
    if (!grouped[row.slug]) grouped[row.slug] = []
    if (grouped[row.slug].length < limit) {
      grouped[row.slug].push(row.error)
    }
  }
  return grouped
}

export async function getLastDaysRecords(
  days = 30
): Promise<HistoricalRecord[]> {
  const client = getClient()
  if (!client) return []

  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceStr = since.toISOString()

  const { data, error } = await client
    .from('forecast_history' as any)
    .select('*')
    .gte('fecha_ejecucion', sinceStr)
    .order('fecha_ejecucion', { ascending: false } as any)

  if (error || !data) return []
  return (data as any) as HistoricalRecord[]
}

export async function getHistoricalRecords(
  limit = 100
): Promise<HistoricalRecord[]> {
  const client = getClient()
  if (!client) return []

  const { data, error } = await client
    .from('forecast_history' as any)
    .select('*')
    .order('fecha_ejecucion', { ascending: false } as any)
    .limit(limit)

  if (error || !data) return []
  return (data as any) as HistoricalRecord[]
}

export async function getDailyRuns(limit = 30): Promise<DailyRun[]> {
  const client = getClient()
  if (!client) return []

  const { data, error } = await client
    .from('daily_runs' as any)
    .select('*')
    .order('fecha_ejecucion', { ascending: false } as any)
    .limit(limit)

  if (error || !data) return []
  return (data as any) as DailyRun[]
}

export async function updateActualTemperature(
  recordId: number,
  tempReal: number
): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  // Get the forecast temp to compute error client-side
  const { data, error: fetchErr } = await (client
    .from('forecast_history' as any) as any)
    .select('temp_corregida')
    .eq('id', recordId)
    .single()

  if (fetchErr || !data) {
    console.error('Error fetching record for update:', fetchErr)
    return false
  }

  const tc = (data as any).temp_corregida
  const error = Math.round((tempReal - tc) * 100) / 100

  const { error: updateErr } = await (client
    .from('forecast_history' as any) as any)
    .update({ temp_real: tempReal, error })
    .eq('id', recordId)

  if (updateErr) {
    console.error('Error updating actual temp:', updateErr)
    return false
  }

  return true
}

export async function getRecordsWithoutActuals(
  limit = 50
): Promise<{ id: number; slug: string; ciudad: string; fecha_objetivo: string; lat: number; lon: number }[]> {
  const client = getClient()
  if (!client) return []

  const { data, error } = await client
    .from('forecast_history' as any)
    .select('id, slug, ciudad, fecha_objetivo')
    .is('temp_real', null)
    .not('fecha_objetivo', 'gte', new Date().toISOString().slice(0, 10))
    .order('fecha_objetivo', { ascending: false } as any)
    .limit(limit)

  if (error || !data) return []

  return (data as any[]).map((r: any) => {
    const city = CIUDADES_ASIA.find(c => c.slug === r.slug)
    return {
      id: r.id,
      slug: r.slug,
      ciudad: r.ciudad,
      fecha_objetivo: r.fecha_objetivo,
      lat: city?.lat ?? 0,
      lon: city?.lon ?? 0,
    }
  })
}

const ULTIMOS_DIAS = 30

export async function getForecastVsActual(
  slug?: string
): Promise<{ fecha_objetivo: string; ciudad: string; slug: string; temp_pronosticada: number; temp_corregida: number; temp_real: number; error: number }[]> {
  const client = getClient()
  if (!client) return []

  const since = new Date()
  since.setDate(since.getDate() - ULTIMOS_DIAS)
  const sinceStr = since.toISOString()

  let q = client
    .from('forecast_history' as any)
    .select('id, fecha_objetivo, ciudad, slug, temp_pronosticada, temp_corregida, temp_real, error')
    .not('temp_real', 'is', null)
    .gte('fecha_ejecucion', sinceStr)

  if (slug) {
    q = q.eq('slug', slug)
  }

  const { data, error } = await q
  if (error || !data) return []

  // Dedup: keep latest id per (slug, fecha_objetivo)
  const seen = new Map<string, any>()
  for (const r of (data as any[])) {
    const key = `${r.slug}|${r.fecha_objetivo}`
    if (!seen.has(key) || r.id > seen.get(key).id) {
      seen.set(key, r)
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.fecha_objetivo.localeCompare(a.fecha_objetivo)) as any[]
}

/**
 * GetAllCalibrationPairs — returns ALL historical forecasts with temp_real
 * (no time limit, no fetch limit) for Platt scaling grid search.
 * Deduped by (slug, fecha_objetivo) keeping latest id.
 * Transforms into (prediction, outcome) pairs where:
 *   prediction = confidence proxy based on error magnitude
 *   outcome   = 1 if |error| <= 1°C, else 0
 */
export async function getAllCalibrationPairs(): Promise<{ slug: string; prediction: number; outcome: number }[]> {
  const client = getClient()
  if (!client) return []

  const { data, error } = await client
    .from('forecast_history' as any)
    .select('id, slug, fecha_objetivo, error')
    .not('error', 'is', null)
    .order('id', { ascending: false } as any)

  if (error || !data) return []

  // Dedup by (slug, fecha_objetivo) — keep latest id
  const seen = new Map<string, any>()
  for (const r of (data as any[])) {
    const key = `${r.slug}|${r.fecha_objetivo}`
    if (!seen.has(key) || r.id > seen.get(key).id) {
      seen.set(key, r)
    }
  }

  const pairs: { slug: string; prediction: number; outcome: number }[] = []
  for (const r of seen.values()) {
    const absErr = Math.abs(r.error)
    // Confidence proxy: inverse of error, clamped to [0.05, 0.95]
    const prediction = Math.max(0.05, Math.min(0.95, 1 - absErr / 5))
    const outcome = absErr <= 1 ? 1 : 0
    pairs.push({ slug: r.slug, prediction: Math.round(prediction * 100) / 100, outcome })
  }

  return pairs
}

/**
 * getHistoricalAccuracy — returns per-city success rate within 1°C
 * using ALL available history (0 = all time, or specify days).
 */
export async function getHistoricalAccuracy(
  slug: string,
  days = 0
): Promise<{ accuracy: number; muestras: number }> {
  const client = getClient()
  if (!client) return { accuracy: 0, muestras: 0 }

  let q = client
    .from('forecast_history' as any)
    .select('id, slug, fecha_objetivo, error')
    .eq('slug', slug)
    .not('error', 'is', null)

  if (days > 0) {
    const since = new Date()
    since.setDate(since.getDate() - days)
    q = q.gte('fecha_ejecucion', since.toISOString())
  }

  const { data, error } = await q
  if (error || !data || (data as any[]).length === 0) return { accuracy: 0, muestras: 0 }

  // Dedup
  const seen = new Map<string, any>()
  for (const r of (data as any[])) {
    const key = `${r.slug}|${r.fecha_objetivo}`
    if (!seen.has(key) || r.id > seen.get(key).id) {
      seen.set(key, r)
    }
  }

  const records = Array.from(seen.values())
  const within1 = records.filter((r: any) => Math.abs(r.error) <= 1).length
  return {
    accuracy: Math.round((within1 / records.length) * 10000) / 100,
    muestras: records.length,
  }
}

// ===== Backtest Bias =====

export interface BacktestBiasEntry {
  slug: string
  mes: number
  bias: number
  mae: number
  muestras: number
}

export async function saveBacktestBias(entries: BacktestBiasEntry[]): Promise<void> {
  const client = getClient()
  if (!client || entries.length === 0) return

  // Upsert per slug+mes
  for (const e of entries) {
    const { error } = await (client
      .from('backtest_bias' as any) as any)
      .upsert({
        slug: e.slug,
        mes: e.mes,
        bias: Math.round(e.bias * 100) / 100,
        mae: Math.round(e.mae * 100) / 100,
        muestras: e.muestras,
        fecha_actualizacion: new Date().toISOString(),
      }, {
        onConflict: 'slug,mes',
      })
    if (error) console.error('Error saving backtest bias:', error)
  }
}

export async function getBacktestBias(): Promise<BacktestBiasEntry[]> {
  const client = getClient()
  if (!client) return []

  const { data, error } = await client
    .from('backtest_bias' as any)
    .select('*')
    .order('slug', { ascending: true } as any)

  if (error || !data) return []
  return (data as any) as BacktestBiasEntry[]
}

export async function saveBacktestChunk(dias: number, offset: number, summary: BacktestSummary): Promise<void> {
  const client = getClient()
  if (!client) return

  const { error } = await client
    .from('backtest_results' as any)
    .insert({
      total_dias: dias,
      total_muestras: summary.total_muestras,
      overall_mae: summary.overall_mae,
      overall_rmse: summary.overall_rmse,
      overall_bias: summary.overall_bias,
      overall_accuracy_1c: summary.overall_accuracy_1c,
      offset,
      por_ciudad: JSON.stringify(summary.por_ciudad),
      resultados: JSON.stringify(summary.resultados),
    } as any)

  if (error) console.error('Error saving backtest chunk:', error)
}

export async function getAccumulatedBacktest(limitDays = 180): Promise<BacktestSummary | null> {
  const client = getClient()
  if (!client) return null

  const { data, error } = await client
    .from('backtest_results' as any)
    .select('*')
    .order('timestamp', { ascending: false } as any)
    .limit(20)

  if (error || !data || (data as any[]).length === 0) return null

  const rows = (data as any[]).filter(r => (r.offset ?? 0) + (r.total_dias ?? 0) <= limitDays)
  if (rows.length === 0) return null

  // Combine all results
  const allResults: BacktestDayResult[] = []
  for (const row of rows) {
    const chunkResults: BacktestDayResult[] = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : (row.resultados ?? [])
    allResults.push(...chunkResults)
  }

  // Deduplicate by slug+fecha
  const seen = new Set<string>()
  const deduped: BacktestDayResult[] = []
  for (const r of allResults) {
    const key = `${r.slug}|${r.fecha}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(r)
    }
  }

  // Compute combined metrics
  return computeSummaryFromResults(deduped, limitDays)
}

/**
 * runBacktestFromHistory — reads ALL records from forecast_history with temp_real,
 * deduplicates, and computes backtest metrics. Grows automatically as new days are added.
 */
export async function runBacktestFromHistory(days: number = 180): Promise<BacktestSummary | null> {
  const client = getClient()
  if (!client) return null

  const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : '1970-01-01'

  const { data, error } = await client
    .from('forecast_history' as any)
    .select('id, fecha_ejecucion, fecha_objetivo, ciudad, slug, temp_pronosticada, temp_corregida, temp_real, error, modelos_usados, consenso')
    .not('temp_real', 'is', null)
    .not('error', 'is', null)
    .gte('fecha_objetivo', since)
    .order('id', { ascending: false } as any)

  if (error || !data) return null

  const seen = new Map<string, any>()
  for (const r of (data as any[])) {
    const key = `${r.slug}|${r.fecha_objetivo}`
    if (!seen.has(key) || r.id > seen.get(key).id) {
      seen.set(key, r)
    }
  }

  const results: BacktestDayResult[] = Array.from(seen.values()).map(r => ({
    fecha: r.fecha_objetivo,
    ciudad: r.ciudad,
    slug: r.slug,
    temp_pronosticada: r.temp_pronosticada,
    temp_corregida: r.temp_corregida,
    temp_real: r.temp_real,
    error: r.error,
    modelos_usados: r.modelos_usados ?? 0,
    consenso: r.consenso ?? 'N/A',
    sesgo_aplicado: r.temp_corregida - r.temp_pronosticada,
  }))

  if (results.length < 3) return null

  // Compute actual days covered (unique fechas)
  const uniqueDates = new Set(results.map(r => r.fecha))
  return computeSummaryFromResults(results, uniqueDates.size)
}

function computeSummaryFromResults(allResults: BacktestDayResult[], days: number): BacktestSummary {
  const byCity: Record<string, BacktestDayResult[]> = {}
  for (const r of allResults) {
    if (!byCity[r.slug]) byCity[r.slug] = []
    byCity[r.slug].push(r)
  }

  const cityMetrics: BacktestCityMetrics[] = Object.entries(byCity).map(([slug, results]) => {
    const errors = results.map(r => r.error)
    const absErrors = errors.map(Math.abs)
    const mae = Math.round(absErrors.reduce((s, v) => s + v, 0) / errors.length * 100) / 100
    const rmse = Math.round(Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / errors.length) * 100) / 100
    const bias = Math.round(errors.reduce((s, v) => s + v, 0) / errors.length * 100) / 100
    const within1 = results.filter(r => Math.abs(r.error) <= 1).length
    const maxError = Math.round(Math.max(...absErrors) * 100) / 100
    return {
      ciudad: results[0]?.ciudad ?? slug,
      slug,
      muestras: results.length,
      mae, rmse, bias,
      accuracy_within_1c: Math.round(within1 / results.length * 10000) / 100,
      max_error: maxError,
    }
  })

  const sorted = [...cityMetrics].sort((a, b) => a.mae - b.mae)
  const allErrors = allResults.map(r => r.error)
  const allAbs = allErrors.map(Math.abs)
  const overallMae = Math.round(allAbs.reduce((s, v) => s + v, 0) / allErrors.length * 100) / 100
  const overallBias = Math.round(allErrors.reduce((s, v) => s + v, 0) / allErrors.length * 100) / 100

  return {
    total_dias: days,
    total_ciudades: Object.keys(byCity).length,
    total_muestras: allResults.length,
    overall_mae: overallMae,
    overall_rmse: Math.round(Math.sqrt(allErrors.reduce((s, v) => s + v * v, 0) / allErrors.length) * 100) / 100,
    overall_bias: overallBias,
    overall_accuracy_1c: Math.round(allResults.filter(r => Math.abs(r.error) <= 1).length / allResults.length * 10000) / 100,
    por_ciudad: cityMetrics,
    mejores_ciudades: sorted.slice(0, 3).map(c => c.ciudad),
    peores_ciudades: sorted.slice(-3).reverse().map(c => c.ciudad),
    resultados: allResults,
    timestamp: new Date().toISOString(),
  }
}

export async function getCityMetrics(slug: string): Promise<{
  metrics: AccuracyMetrics | null
  improvement: { mejora_mae_pct: number; accuracy_pct: number; tendencia: string; impacto_proximo_pct: number; descripcion_impacto: string; ultima_mejora_fecha: string; ultima_mejora_desc: string } | null
  evolucion: { fecha: string; mae: number; rmse: number }[]
}> {
  const history = await getLastDaysRecords(ULTIMOS_DIAS)
  let withActuals = history.filter(r => r.slug === slug && r.temp_real !== null && r.error !== null)
  if (withActuals.length < 2) return { metrics: null, improvement: null, evolucion: [] }

  // Dedup by (slug, fecha_objetivo)
  const seen = new Map<string, any>()
  for (const r of withActuals) {
    const key = `${r.slug}|${r.fecha_objetivo || r.fecha_ejecucion.slice(0, 10)}`
    if (!seen.has(key)) { seen.set(key, r) }
  }
  withActuals = Array.from(seen.values())

  const errors = withActuals.map(r => r.error!)
  const absErrors = errors.map(Math.abs)
  const mae = Math.round(absErrors.reduce((s, v) => s + v, 0) / absErrors.length * 100) / 100
  const rmse = Math.round(Math.sqrt(errors.reduce((s, v) => s + v * v, 0) / errors.length) * 100) / 100
  const bias = Math.round(errors.reduce((s, v) => s + v, 0) / errors.length * 100) / 100
  const metrics: AccuracyMetrics = { ciudad: withActuals[0].ciudad, slug, mae, rmse, bias, muestras: withActuals.length }
  const within1 = withActuals.filter(r => Math.abs(r.error!) <= 1).length
  const accuracyPct = Math.round(within1 / withActuals.length * 100)
  // Daily evolution
  const byDate: Record<string, number[]> = {}
  for (const r of withActuals) {
    const fecha = r.fecha_objetivo || r.fecha_ejecucion.slice(0, 10)
    if (!fecha) continue
    if (!byDate[fecha]) byDate[fecha] = []
    byDate[fecha].push(r.error!)
  }
  const evolucion = Object.entries(byDate).map(([fecha, errs]) => {
    const absM = errs.map(Math.abs).reduce((s, v) => s + v, 0) / errs.length
    const rmseD = Math.sqrt(errs.map(e => e * e).reduce((s, v) => s + v, 0) / errs.length)
    return { fecha, mae: Math.round(absM * 100) / 100, rmse: Math.round(rmseD * 100) / 100 }
  }).sort((a, b) => a.fecha.localeCompare(b.fecha))
  const half = Math.floor(withActuals.length / 2)
  const recent = withActuals.slice(0, half)
  const older = withActuals.slice(half)
  const recentMae = recent.reduce((s, r) => s + Math.abs(r.error!), 0) / recent.length
  const olderMae = older.reduce((s, r) => s + Math.abs(r.error!), 0) / older.length
  const mejoraMaePct = olderMae > 0 ? Math.round((olderMae - recentMae) / olderMae * 100) : 0
  const impactoPct = Math.round(Math.min(Math.max((1 - mae) / 1 * 100, -20), 30))
  const improvement = {
    mejora_mae_pct: mejoraMaePct,
    accuracy_pct: accuracyPct,
    tendencia: mae <= 1.5 ? 'mejorando' : mae <= 2.5 ? 'estable' : 'empeorando',
    impacto_proximo_pct: impactoPct,
    descripcion_impacto: impactoPct > 5 ? `Mejora esperada ~${impactoPct}% en el próximo pronóstico por bias dinámico` : `Estable (~${impactoPct}%)`,
    ultima_mejora_fecha: withActuals[0].fecha_ejecucion.slice(0, 10),
    ultima_mejora_desc: `Último error: ${withActuals[0].error!.toFixed(2)}°C`,
  }
  return { metrics, improvement, evolucion }
}

export async function computeGlobalMetrics(): Promise<GlobalMetrics | null> {
  const history = await getLastDaysRecords(ULTIMOS_DIAS)
  let withActuals = history.filter(r => r.temp_real !== null && r.error !== null)

  if (withActuals.length < 3) return null

  // Dedup by (slug, fecha_objetivo)
  const seen = new Map<string, any>()
  for (const r of withActuals) {
    const key = `${r.slug}|${r.fecha_objetivo || r.fecha_ejecucion?.slice(0, 10)}`
    if (!seen.has(key)) { seen.set(key, r) }
  }
  withActuals = Array.from(seen.values())

  const errors = withActuals.map(r => r.error!)
  const absErrors = errors.map(Math.abs)
  const squaredErrors = errors.map(e => e * e)

  const mae = absErrors.reduce((s, v) => s + v, 0) / absErrors.length
  const rmse = Math.sqrt(squaredErrors.reduce((s, v) => s + v, 0) / squaredErrors.length)
  const bias = errors.reduce((s, v) => s + v, 0) / errors.length

  // Per city
  const byCity: Record<string, number[]> = {}
  for (const r of withActuals) {
    if (!byCity[r.slug]) byCity[r.slug] = []
    byCity[r.slug].push(r.error!)
  }

  const porCiudad = Object.entries(byCity).map(([slug, errs]) => {
    const m = errs.reduce((s, v) => s + v, 0) / errs.length
    const absM = errs.map(Math.abs).reduce((s, v) => s + v, 0) / errs.length
    const rmseC = Math.sqrt(errs.map(e => e * e).reduce((s, v) => s + v, 0) / errs.length)
    const city = withActuals.find(r => r.slug === slug)
    return {
      ciudad: city?.ciudad ?? slug,
      slug,
      mae: Math.round(absM * 100) / 100,
      rmse: Math.round(rmseC * 100) / 100,
      bias: Math.round(m * 100) / 100,
      muestras: errs.length,
    }
  })

  // Daily evolution
  const byDate: Record<string, number[]> = {}
  for (const r of withActuals) {
    const fecha = r.fecha_objetivo || r.fecha_ejecucion?.slice(0, 10)
    if (!fecha) continue
    if (!byDate[fecha]) byDate[fecha] = []
    byDate[fecha].push(r.error!)
  }

  const evolucion = Object.entries(byDate)
    .map(([fecha, errs]) => {
      const absM = errs.map(Math.abs).reduce((s, v) => s + v, 0) / errs.length
      const rmseD = Math.sqrt(errs.map(e => e * e).reduce((s, v) => s + v, 0) / errs.length)
      return { fecha, mae: Math.round(absM * 100) / 100, rmse: Math.round(rmseD * 100) / 100 }
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  const within1 = withActuals.filter(r => Math.abs(r.error!) <= 1).length
  const accuracyPct = Math.round((within1 / withActuals.length) * 10000) / 100

  return {
    overall_mae: Math.round(mae * 100) / 100,
    overall_rmse: Math.round(rmse * 100) / 100,
    overall_bias: Math.round(bias * 100) / 100,
    brier_score: 0,
    total_muestras: withActuals.length,
    accuracy_pct: accuracyPct,
    por_ciudad: porCiudad,
    evolucion_diaria: evolucion,
  }
}
