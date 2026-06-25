import { createClient } from '@supabase/supabase-js'
import { HistoricalRecord, DailyRun, GlobalMetrics } from '@/types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
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

export async function computeGlobalMetrics(): Promise<GlobalMetrics | null> {
  const history = await getHistoricalRecords(1000)
  const withActuals = history.filter(r => r.temp_real !== null && r.error !== null)

  if (withActuals.length < 3) return null

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

  const within2 = withActuals.filter(r => Math.abs(r.error!) <= 2).length
  const accuracyPct = Math.round((within2 / withActuals.length) * 10000) / 100

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
