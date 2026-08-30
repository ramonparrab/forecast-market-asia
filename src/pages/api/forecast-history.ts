import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { DailyAnalysis, CityAnalysis, BetRecommendation } from '@/types'
import { computeGlobalMetrics, getHistoricalAccuracy } from '@/lib/supabase'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const fecha = req.query.fecha as string
  const action = req.query.action as string

  if (action === 'dates') {
    const client = createClient(supabaseUrl, supabaseKey)

    // Fuentes de fechas: daily_runs (datos completos) + forecast_snapshot (pronóstico actual)
    const [drRes, snapRes] = await Promise.all([
      client
        .from('daily_runs' as any)
        .select('fecha_objetivo')
        .order('fecha_objetivo', { ascending: false } as any)
        .limit(90),
      client
        .from('forecast_snapshot' as any)
        .select('fecha_objetivo')
        .lt('temp_real', null as any)
        .order('fecha_objetivo', { ascending: false } as any)
        .limit(90),
    ])

    const dates: string[] = []
    for (const r of (drRes.data as any[]) ?? []) {
      if (!dates.includes(r.fecha_objetivo)) dates.push(r.fecha_objetivo)
    }
    for (const r of (snapRes.data as any[]) ?? []) {
      if (!dates.includes(r.fecha_objetivo)) dates.push(r.fecha_objetivo)
    }
    dates.sort((a, b) => b.localeCompare(a))
    return res.status(200).json({ dates })
  }

  if (!fecha) return res.status(400).json({ error: 'Se requiere ?fecha=YYYY-MM-DD' })

  const client = createClient(supabaseUrl, supabaseKey)

  // ============ Fallback: cuando no hay daily_run, usar forecast_snapshot ============
  // El cron guarda forecast_snapshot además de daily_runs. Si daily_runs falló
  // (ej. error en INSERT), forecast_snapshot tiene los datos esenciales
  // para que el Resumen pueda mostrar la página.
  const { data, error } = await client
    .from('daily_runs' as any)
    .select('*')
    .eq('fecha_objetivo', fecha)
    .order('fecha_ejecucion', { ascending: false } as any)
    .limit(1)

  if (data && (data as any[]).length > 0) {
    const row = (data as any[])[0]
    return buildAnalysisFromDailyRun(row, res)
  }

  // ============ FALLBACK: construir desde forecast_snapshot ============
  console.log(`[forecast-history] No daily_run para ${fecha}, intentando fallback a forecast_snapshot`)
  const { data: snaps, error: snapErr } = await client
    .from('forecast_snapshot' as any)
    .select('*')
    .eq('fecha_objetivo', fecha)
    .order('run_type_ganadora', { ascending: false } as any)
    .limit(1)

  if (snapErr) {
    return res.status(500).json({ error: snapErr.message })
  }
  if (!snaps || (snaps as any[]).length === 0) {
    return res.status(404).json({ error: `No hay pronóstico guardado para ${fecha}` })
  }

  const snap = (snaps as any[])[0]
  return buildAnalysisFromSnapshot(snap, fecha, client, res)
}

// ============ Helpers ============

async function buildAnalysisFromDailyRun(row: any, res: NextApiResponse) {
  let resultados: CityAnalysis[]
  let recomendaciones: BetRecommendation[]

  try {
    resultados = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : row.resultados
    recomendaciones = typeof row.recomendaciones === 'string' ? JSON.parse(row.recomendaciones) : row.recomendaciones
  } catch {
    return res.status(500).json({ error: 'Error parsing saved forecast data' })
  }

  if (!resultados || !Array.isArray(resultados) || resultados.length === 0) {
    return res.status(404).json({ error: `No hay datos de pronóstico para ${row.fecha_objetivo} (cities vacío)` })
  }

  return buildAnalysisFromData(resultados, recomendaciones, row.fecha_ejecucion, row.fecha_objetivo, row.total_asignado ?? 0, res)
}

async function buildAnalysisFromSnapshot(
  snap: any,
  fecha: string,
  client: any,
  res: NextApiResponse
) {
  const { data: snapCities } = await client
    .from('forecast_snapshot' as any)
    .select('slug, ciudad, temp_pronosticada, temp_corregida, modelo_ganador, run_type_ganadora, consenso')
    .eq('fecha_objetivo', fecha)
    .order('run_type_ganadora', { ascending: false } as any)

  const snapMap = new Map<string, any>()
  for (const sc of (snapCities as any[]) ?? []) {
    if (!snapMap.has(sc.slug)) {
      snapMap.set(sc.slug, sc)
    }
  }

  const resultados: CityAnalysis[] = CIUDADES_ASIA.map(c => {
    const sc = snapMap.get(c.slug)
    if (!sc) {
      return {
        ciudad: c.nombre,
        slug: c.slug,
        contratos: [],
        forecast: {
          temp_ponderada: 25,
          temp_corregida: 25,
          temp_corregida_base: 25,
          modelo_activo: 'ENSEMBLE',
          consenso: '-',
          ensemble_raw: {},
        },
        arbitraje: { desvio: 0, nivel: '-' },
        nowcast: { activo: false, peso_observacion: 0, temp_observada: null, estacion: c.estacion, hora_local: 0 },
        exito_pct: 50,
        exito_pct_integer: 50,
        explicacion: `Sin datos de snapshot para ${c.nombre}`,
      }
    }

    const prevSnap = snapMap.get(c.slug)
    const tempPron = sc?.temp_pronosticada ?? prevSnap?.temp_pronosticada ?? 25
    const tempCorr = sc?.temp_corregida ?? prevSnap?.temp_corregida ?? 25
    const modelo = sc?.modelo_ganador ?? prevSnap?.modelo_ganador ?? 'ENSEMBLE'
    const consenso = sc?.consenso ?? prevSnap?.consenso ?? '-'

    return {
      ciudad: c.nombre,
      slug: c.slug,
      contratos: [],
      forecast: {
        temp_ponderada: tempPron,
        temp_corregida: tempCorr,
        temp_corregida_base: tempPron,
        modelo_activo: modelo,
        consenso: consenso,
        ensemble_raw: {},
      } as any,
      arbitraje: { desvio: 0, nivel: '-' },
      nowcast: { activo: false, peso_observacion: 0, temp_observada: null, estacion: c.estacion, hora_local: 0 },
      exito_pct: 50,
      exito_pct_integer: 50,
      explicacion: `Pronóstico ${modelo} (${c.nombre}): ${tempCorr}°C (desde forecast_snapshot)`,
    }
  }).filter(c => c !== null)

  return buildAnalysisFromData(
    resultados,
    [],
    snap.created_at ?? new Date().toISOString(),
    fecha,
    0,
    res,
  )
}

async function buildAnalysisFromData(
  ciudades: CityAnalysis[],
  recomendaciones: BetRecommendation[],
  fechaEjecucion: string,
  fechaObjetivo: string,
  totalAsignado: number,
  res: NextApiResponse,
) {
  // Recalcular exito_pct usando Bayesian formula
  const globalMetrics = await computeGlobalMetrics()
  const globalAccuracyPct = globalMetrics?.accuracy_pct ?? 50

  const histMap = await Promise.all(
    ciudades.map(async city => {
      const hist = await getHistoricalAccuracy(city.slug)
      let exitoPct: number
      if (hist.muestras >= 5) {
        const priorStrength = 10
        exitoPct = Math.round(
          (hist.accuracy * hist.muestras + globalAccuracyPct * priorStrength)
          / (hist.muestras + priorStrength)
        )
      } else {
        exitoPct = Math.round(globalAccuracyPct)
      }
      if (city.forecast.weather?.code === 3) {
        exitoPct = Math.max(10, exitoPct - 1)
      }
      return { slug: city.slug, exitoPct }
    })
  )
  for (const { slug, exitoPct } of histMap) {
    const city = ciudades.find((c: any) => c.slug === slug)!
    city.exito_pct = exitoPct
    city.exito_pct_integer = exitoPct
  }

  const analysis: DailyAnalysis = {
    fecha: fechaEjecucion,
    fecha_objetivo: fechaObjetivo,
    message: `Pronóstico del ${new Date(fechaEjecucion).toLocaleDateString('es-ES', { timeZone: 'America/Caracas' })}`,
    cities: ciudades,
    recommendations: recomendaciones,
    total_allocated: totalAsignado,
    global_metrics: null,
    arbitrage_alerts: [],
    historicalErrors: {},
  }

  return res.status(200).json(analysis)
}
