import { useState, useEffect, useCallback } from 'react'
import Layout from '@/components/Layout'
import CityCard from '@/components/CityCard'
import AllocationPanel from '@/components/AllocationPanel'
import MetricsChart from '@/components/MetricsChart'
import ForecastVsActualChart from '@/components/ForecastVsActualChart'
import ArbitragePanel from '@/components/ArbitragePanel'
import ForecastTable from '@/components/ForecastTable'
import BacktestChart from '@/components/BacktestChart'
import ExecutiveSummaryPanel from '@/components/ExecutiveSummary'
import { DailyAnalysis, GlobalMetrics, CityAnalysis } from '@/types'

export async function getServerSideProps() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseKey) {
    return { props: { initialAnalysis: null, initialMetrics: null, initialAvailableDates: [], hindcastDays: 0 } }
  }

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(supabaseUrl, supabaseKey)

    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    const fecha = nowCaracas.toISOString().slice(0, 10)

    // ===== STEP 1: Asegurar pronóstico del día =====
    const { data: runs } = await client.from('daily_runs' as any).select('*').eq('fecha_objetivo', fecha).order('fecha_ejecucion', { ascending: false } as any).limit(1)

    let analysis: DailyAnalysis | null = null

    if ((runs as any[] | undefined)?.length) {
      const row = (runs as any[])[0]
      analysis = {
        fecha: row.fecha_ejecucion,
        fecha_objetivo: row.fecha_objetivo,
        message: `Pronóstico del ${new Date(row.fecha_ejecucion).toLocaleDateString('es-ES', { timeZone: 'America/Caracas' })}`,
        cities: typeof row.resultados === 'string' ? JSON.parse(row.resultados) : row.resultados,
        recommendations: typeof row.recomendaciones === 'string' ? JSON.parse(row.recomendaciones) : row.recomendaciones,
        total_allocated: row.total_asignado ?? 0,
        global_metrics: null,
        arbitrage_alerts: [],
      }
    } else {
      const { runDailyAnalysis } = await import('@/lib/forecast-engine')
      const { saveForecastRecords, saveDailyRun } = await import('@/lib/supabase')

      const result = await runDailyAnalysis(fecha, true)

      const records = result.cities.map(city => ({
        fecha_ejecucion: result.fecha,
        fecha_objetivo: fecha,
        ciudad: city.ciudad,
        slug: city.slug,
        temp_pronosticada: city.forecast.temp_ponderada,
        temp_corregida: city.forecast.temp_corregida,
        temp_real: null, error: null,
        modelos_usados: Object.keys(city.forecast.ensemble_raw).length,
        consenso: city.forecast.consenso,
      }))

      await saveForecastRecords(records)
      await saveDailyRun({
        fecha_ejecucion: result.fecha,
        fecha_objetivo: fecha,
        resultados: result.cities,
        recomendaciones: result.recommendations,
        total_asignado: result.total_allocated,
      })

      analysis = result
    }

    // ===== STEP 2: Hindcast 30 días (si no existe data histórica) =====
    const HINDCAST_DAYS = 30
    const { data: existingActuals } = await client
      .from('forecast_history' as any)
      .select('fecha_objetivo')
      .not('temp_real', 'is', null)
      .order('fecha_objetivo', { ascending: false } as any)
      .limit(1)

    const needsHindcast = !(existingActuals as any[] | undefined)?.length
    let hindcastDays = 0

    if (needsHindcast) {
      console.log('[HINDCAST] No hay datos históricos con temp_real. Ejecutando backtest 30 días...')
      const { runBacktest } = await import('@/lib/backtest-engine')
      const { saveForecastRecords } = await import('@/lib/supabase')

      // Calcular fechas del rango a backfill
      const hoy = new Date()
      const hace30 = new Date(hoy)
      hace30.setDate(hace30.getDate() - HINDCAST_DAYS)
      const startStr = hace30.toISOString().slice(0, 10)

      // Eliminar registros existentes en el rango para evitar duplicados
      await client.from('forecast_history' as any).delete().gte('fecha_objetivo', startStr).lt('fecha_objetivo', fecha)

      const backtest = await runBacktest(HINDCAST_DAYS)
      const hindcastRecords = backtest.resultados.map(r => ({
        fecha_ejecucion: r.fecha + 'T22:00:00',
        fecha_objetivo: r.fecha,
        ciudad: r.ciudad,
        slug: r.slug,
        temp_pronosticada: r.temp_pronosticada,
        temp_corregida: r.temp_corregida,
        temp_real: r.temp_real,
        error: r.error,
        modelos_usados: r.modelos_usados,
        consenso: r.consenso,
      }))

      // Guardar en lotes de 50
      for (let i = 0; i < hindcastRecords.length; i += 50) {
        await saveForecastRecords(hindcastRecords.slice(i, i + 50))
      }
      hindcastDays = HINDCAST_DAYS
      console.log(`[HINDCAST] Guardados ${hindcastRecords.length} registros (${HINDCAST_DAYS} días x ${backtest.total_ciudades} ciudades)`)
    }

    // ===== STEP 3: Obtener fechas disponibles y métricas =====
    const { data: datesData } = await client.from('daily_runs' as any).select('fecha_objetivo').order('fecha_objetivo', { ascending: false } as any).limit(90)
    const raw = ((datesData as any[] | undefined)?.map(r => r.fecha_objetivo) ?? [])
    const availableDates = Array.from(new Set<string>(raw))

    const { computeGlobalMetrics } = await import('@/lib/supabase')
    const metrics = await computeGlobalMetrics()

    return {
      props: {
        initialAnalysis: JSON.parse(JSON.stringify(analysis)),
        initialMetrics: metrics ? JSON.parse(JSON.stringify(metrics)) : null,
        initialAvailableDates: availableDates,
        hindcastDays,
      }
    }
  } catch (e) {
    console.error('[getServerSideProps]', e)
    return { props: { initialAnalysis: null, initialMetrics: null, initialAvailableDates: [], hindcastDays: 0 } }
  }
}

type View = 'executive' | 'dashboard' | 'table' | 'metrics' | 'comparison' | 'backtest' | 'arbitrage' | 'architecture'

/** Returns a friendly confidence label + color class */
function getConfidence(city: CityAnalysis): { label: string; color: string; bg: string } {
  const pct = city.exito_pct
  if (pct >= 80) return { label: 'MUY ALTA', color: 'text-emerald-400', bg: 'bg-emerald-500/10' }
  if (pct >= 65) return { label: 'ALTA', color: 'text-green-400', bg: 'bg-green-500/10' }
  if (pct >= 50) return { label: 'MEDIA', color: 'text-amber-400', bg: 'bg-amber-500/10' }
  return { label: 'BAJA', color: 'text-red-400', bg: 'bg-red-500/10' }
}

function TargetDateBanner({ fechaObjetivo, caracasTime }: { fechaObjetivo: string; caracasTime: string }) {
  const targetDate = new Date(fechaObjetivo + 'T12:00:00')
  const dayName = targetDate.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <div className="rounded-xl bg-gradient-to-r from-blue-600/20 via-blue-500/10 to-blue-600/20 border border-blue-500/20 p-4 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📅</span>
          <div>
            <p className="text-sm text-blue-300 font-medium">DÍA DEL PRONÓSTICO</p>
            <p className="text-xl font-bold text-white">{dayName}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-center">
            <p className="text-gray-500">Ahora en Caracas</p>
            <p className="text-lg font-semibold text-white">{caracasTime}</p>
          </div>
          <div className="h-8 w-px bg-gray-700"></div>
          <div className="text-center">
            <p className="text-gray-500">Ejecución automática</p>
            <p className="text-lg font-semibold text-blue-400">22:00 Caracas</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ImprovementLegend() {
  return (
    <details className="mb-6 rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-blue-400 hover:text-blue-300 transition flex items-center gap-2">
        <span>⚡</span>
        Mejoras activas en esta versión
        <span className="ml-auto text-xs text-gray-500">(click para expandir)</span>
      </summary>
      <div className="grid gap-3 p-4 pt-2 text-sm sm:grid-cols-3">
        <div className="rounded-lg bg-slate-900/50 p-3 border border-emerald-500/20">
          <p className="font-semibold text-emerald-400 mb-1">🌍 ECMWF ENS 51 + Empirical CDF</p>
          <p className="text-gray-400 text-xs">51 miembros del ensemble europeo reemplazan la distribución paramétrica. La CDF empírica es SIEMPRE más precisa que asumir Student-t. Disponible cuando hay ≥20 miembros.</p>
        </div>
        <div className="rounded-lg bg-slate-900/50 p-3 border border-purple-500/20">
          <p className="font-semibold text-purple-400 mb-1">📈 Platt Scaling + PAVA</p>
          <p className="text-gray-400 text-xs">Calibración Platt activa (sigmoide). Backtest demuestra que supera PAVA isotonic en datos meteorológicos: 2.5% mejor Brier, 17.9% mejor ECE. PAVA disponible como alternativa.</p>
        </div>
        <div className="rounded-lg bg-slate-900/50 p-3 border border-amber-500/20">
          <p className="font-semibold text-amber-400 mb-1">⚡ EWMA + Z-score Filter</p>
          <p className="text-gray-400 text-xs">Pesos dinámicos por modelo con decaimiento exponencial (EWMA, decay=0.15) + exclusión de modelos outlier con |z| &gt; 3σ. Modelos con errores recientes pesan más que errores antiguos.</p>
        </div>
      </div>
    </details>
  )
}

function CitySuccessSummary({ cities }: { cities: CityAnalysis[] }) {
  if (cities.length === 0) return null
  const high = cities.filter(c => c.exito_pct >= 65).length
  const medium = cities.filter(c => c.exito_pct >= 50 && c.exito_pct < 65).length
  const low = cities.filter(c => c.exito_pct < 50).length
  const best = cities.reduce((a, b) => a.exito_pct > b.exito_pct ? a : b)
  const worst = cities.reduce((a, b) => a.exito_pct < b.exito_pct ? a : b)
  const bestConf = getConfidence(best)
  const worstConf = getConfidence(worst)

  return (
    <div className="grid gap-3 sm:grid-cols-3 mb-6">
      <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 text-center">
        <p className="text-2xl font-bold text-emerald-400">{high}</p>
        <p className="text-xs text-gray-400">Ciudades con precisión <span className="text-emerald-400">ALTA</span> (≥65%)</p>
      </div>
      <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 text-center">
        <p className="text-2xl font-bold text-amber-400">{medium}</p>
        <p className="text-xs text-gray-400">Ciudades con precisión <span className="text-amber-400">MEDIA</span> (50-64%)</p>
      </div>
      <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 text-center">
        <p className="text-2xl font-bold text-red-400">{low}</p>
        <p className="text-xs text-gray-400">Ciudades con precisión <span className="text-red-400">BAJA</span> (&lt;50%)</p>
      </div>
      <div className="sm:col-span-3 rounded-xl bg-slate-800/30 p-3 text-xs text-gray-400 text-center">
        <span className="text-emerald-400 font-medium">🏆 Mejor: {best.ciudad}</span>
        <span className="mx-2">·</span>
        <span className={`font-medium ${bestConf.color}`}>{best.exito_pct}% acierto estimado</span>
        <span className="mx-2">·</span>
        <span className="text-red-400 font-medium">⚠️ Peor: {worst.ciudad}</span>
        <span className="mx-2">·</span>
        <span className={`font-medium ${worstConf.color}`}>{worst.exito_pct}% acierto estimado</span>
      </div>
    </div>
  )
}

interface HomeProps {
  initialAnalysis: DailyAnalysis | null
  initialMetrics: GlobalMetrics | null
  initialAvailableDates: string[]
  hindcastDays: number
}

export default function Home({ initialAnalysis, initialMetrics, initialAvailableDates, hindcastDays }: HomeProps) {
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(initialAnalysis)
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(initialMetrics)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<View>('executive')
  const [lastUpdated, setLastUpdated] = useState<string>(initialAnalysis ? `Auto ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : '')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [availableDates, setAvailableDates] = useState<string[]>(initialAvailableDates)
  const [isHistorical, setIsHistorical] = useState(false)
  const [previousAnalysis, setPreviousAnalysis] = useState<DailyAnalysis | null>(null)
  const [previousMetrics, setPreviousMetrics] = useState<GlobalMetrics | null>(null)

  const getDefaultTargetDate = () => {
    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    return nowCaracas.toISOString().slice(0, 10)
  }

  useEffect(() => {
    fetchMetrics()
    fetchAvailableDates()
    if (!selectedDate) setSelectedDate(getDefaultTargetDate())
  }, [])

  async function fetchAvailableDates() {
    try {
      const resp = await fetch('/api/forecast-history?action=dates')
      if (resp.ok) {
        const data = await resp.json()
        setAvailableDates(data.dates ?? [])
      }
    } catch { /* silent */ }
  }

  async function fetchMetrics() {
    try {
      const resp = await fetch('/api/metrics')
      if (resp.ok) {
        const data = await resp.json()
        if (data && data.overall_mae !== undefined) setMetrics(data)
      }
    } catch { /* silent */ }
  }

  async function fetchPreviousDay(currentFecha: string) {
    try {
      // Get available dates and find the one before current
      const resp = await fetch('/api/forecast-history?action=dates')
      if (resp.ok) {
        const data = await resp.json()
        const dates: string[] = data.dates ?? []
        const sortedDates = dates.sort().reverse()
        const currentIdx = sortedDates.indexOf(currentFecha)
        if (currentIdx >= 0 && currentIdx < sortedDates.length - 1) {
          const prevDate = sortedDates[currentIdx + 1]
          const prevResp = await fetch(`/api/forecast-history?fecha=${prevDate}`)
          if (prevResp.ok) {
            const prevData: DailyAnalysis = await prevResp.json()
            setPreviousAnalysis(prevData)
            // Try to get previous day metrics
            const prevMetricsResp = await fetch(`/api/metrics?fecha=${prevDate}`)
            if (prevMetricsResp.ok) {
              const pm = await prevMetricsResp.json()
              if (pm && pm.overall_mae !== undefined) setPreviousMetrics(pm)
            }
          }
        }
      }
    } catch { /* silent */ }
  }

  const runAnalysis = useCallback(async (fecha?: string) => {
    setLoading(true)
    setError(null)
    try {
      const targetDate = fecha || selectedDate || getDefaultTargetDate()
      const resp = await fetch(`/api/forecast?fecha=${targetDate}`, { method: 'POST' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data: DailyAnalysis = await resp.json()
      setAnalysis(data)
      setIsHistorical(false)
      setSelectedDate(data.fecha_objetivo)
      setLastUpdated(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      await fetchMetrics()
      await fetchAvailableDates()
      await fetchPreviousDay(data.fecha_objetivo)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  const loadHistoricalDate = useCallback(async (fecha: string) => {
    setLoading(true)
    setError(null)
    setSelectedDate(fecha)
    try {
      const resp = await fetch(`/api/forecast-history?fecha=${fecha}`)
      if (resp.ok) {
        const data: DailyAnalysis = await resp.json()
        setAnalysis(data)
        setIsHistorical(true)
        setLastUpdated(`Historial: ${data.fecha_objetivo}`)
      } else if (resp.status === 404) {
        setAnalysis(null)
        setError(`No hay pronóstico guardado para ${fecha}. Ejecuta el análisis.`)
        setIsHistorical(false)
      } else {
        throw new Error(`HTTP ${resp.status}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const now = new Date()
  const caracasTime = now.toLocaleTimeString('es-ES', {
    timeZone: 'America/Caracas',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const views: { key: View; label: string; icon: string; desc: string }[] = [
    { key: 'executive', label: 'Resumen Ejecutivo', icon: '🎯', desc: 'Recomendaciones del día' },
    { key: 'dashboard', label: 'Dashboard', icon: '🏠', desc: 'Vista general' },
    { key: 'table', label: 'Tabla', icon: '📊', desc: 'Datos completos' },
    { key: 'metrics', label: 'Precisión', icon: '📈', desc: 'Métricas históricas' },
    { key: 'comparison', label: 'Comparación', icon: '📉', desc: 'Pronóstico vs Real' },
    { key: 'backtest', label: 'Backtest', icon: '⏳', desc: '90 días históricos' },
    { key: 'arbitrage', label: 'Arbitraje', icon: '🔍', desc: 'Alertas de ineficiencia' },
    { key: 'architecture', label: 'Arquitectura', icon: '🏗️', desc: 'Pipeline del sistema' },
  ]

  return (
    <Layout lastUpdated={lastUpdated}>
      {/* Controls */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => runAnalysis()}
            disabled={loading}
            className="btn-primary flex items-center gap-2 text-sm px-5 py-2.5"
          >
            {loading ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                Analizando 9 ciudades...
              </>
            ) : (
              <>
                <span>🚀</span>
                {analysis ? 'Actualizar' : 'Ejecutar'}
              </>
            )}
          </button>
          {analysis && analysis.cities.length > 0 && (
            <span className="text-xs text-gray-500">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1"></span>
              {analysis.cities.length} ciudades · {analysis.recommendations.length} recom. · ${analysis.total_allocated.toFixed(2)} asignados
            </span>
          )}
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={e => loadHistoricalDate(e.target.value)}
            className="rounded-lg bg-slate-800 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          {availableDates.length > 0 && (
            <select
              value={selectedDate}
              onChange={e => loadHistoricalDate(e.target.value)}
              className="rounded-lg bg-slate-800 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 max-w-[140px]"
            >
              {availableDates.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          {isHistorical && (
            <button
              onClick={() => { setSelectedDate(getDefaultTargetDate()); runAnalysis() }}
              className="rounded-lg bg-blue-600/20 border border-blue-500/30 px-3 py-2 text-xs text-blue-400 hover:bg-blue-600/30 transition"
            >
              ↻ Hoy
            </button>
          )}
        </div>

        {/* View switcher */}
        <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => setActiveView(v.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeView === v.key
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
              title={v.desc}
            >
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Target Date Banner */}
      {analysis?.fecha_objetivo && (
        <TargetDateBanner fechaObjetivo={analysis.fecha_objetivo} caracasTime={caracasTime} />
      )}
      {isHistorical && (
        <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-sm text-amber-400 flex items-center gap-2">
          <span>📖</span>
          <span>Viendo pronóstico histórico del {analysis?.fecha_objetivo}. Los datos de nowcasting y precios pueden no reflejar el estado en tiempo real.</span>
        </div>
      )}

      {/* Improvements Legend */}
      <ImprovementLegend />

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
          <p className="font-medium">⚠️ Error en el análisis</p>
          <p className="text-xs mt-1 text-red-300">{error}</p>
        </div>
      )}

      {/* No data state */}
      {!analysis && !loading && !error && (
        <div className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-gray-700/30 py-16 px-6 text-center">
          <div className="mb-4 text-6xl">🌤️</div>
          <h2 className="mb-2 text-2xl font-bold text-white">Forecast Market · Asia</h2>
          <p className="mb-2 text-gray-400 max-w-lg mx-auto">
            Pronóstico de temperatura máxima para <span className="font-semibold text-blue-400">{getDefaultTargetDate()}</span> en 9 ciudades asiáticas
          </p>
          <p className="mb-6 text-sm text-gray-500 max-w-md mx-auto">
            Ejecuta el análisis a las 22:00 hora Caracas. El sistema compara la temperatura máxima pronosticada por 6 modelos meteorológicos contra los precios de cierre en Polymarket, identificando ineficiencias y calculando la asignación óptima vía Kelly.
          </p>
          <button onClick={() => runAnalysis()} className="btn-primary text-base px-8 py-3">
            🚀 Comenzar Análisis
          </button>
          <div className="mt-6 flex justify-center gap-6 text-xs text-gray-600 flex-wrap">
            <span>7 modelos (ECMWF ENS 51)</span>
            <span>·</span>
            <span>Empirical CDF</span>
            <span>·</span>
            <span>Isotonic PAVA</span>
            <span>·</span>
            <span>EWMA + Z-score</span>
            <span>·</span>
            <span>Walk-Forward</span>
          </div>
        </div>
      )}

      {/* Dashboard View */}
      {activeView === 'dashboard' && analysis && (
        <div className="space-y-6">
          {/* City Success Summary */}
          <CitySuccessSummary cities={analysis.cities} />

          {/* 10PM Caracas Forecast Banner — reference value */}
          {analysis.cities.length > 0 && (
            <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-blue-900/20 to-slate-900 border border-blue-500/20 overflow-hidden">
              <div className="p-4 sm:p-6 text-center">
                <p className="text-xs text-blue-300 font-semibold tracking-wider mb-2">🌙 VALOR DE REFERENCIA · PRONÓSTICO 10PM CARACAS</p>
                <div className="flex items-baseline justify-center gap-4 mb-3 flex-wrap">
                  <span className="text-6xl sm:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-blue-300 to-cyan-300">
                    {(analysis.cities.reduce((s, c) => s + c.forecast.temp_corregida, 0) / analysis.cities.length).toFixed(1)}°C
                  </span>
                  <span className="text-sm text-gray-500">promedio {analysis.cities.length} ciudades</span>
                </div>
                <div className="flex justify-center gap-6 text-xs text-gray-500">
                  <span>📡 {analysis.cities.filter(c => c.nowcast?.activo).length}/{analysis.cities.length} nowcast activo</span>
                  <span>🎯 Meta: ±2°C &gt;70%</span>
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 divide-x divide-blue-500/10 border-t border-blue-500/10">
                {analysis.cities.map(city => (
                  <div key={city.slug} className="p-3 text-center hover:bg-blue-500/5 transition">
                    <p className="text-[10px] text-gray-500 truncate">{city.ciudad.split(',')[0]}</p>
                    <p className="text-lg sm:text-xl font-bold text-emerald-400">{city.forecast.temp_corregida.toFixed(1)}°C</p>
                    <p className="text-[9px] text-gray-600">{city.exito_pct}% acierto</p>
                    <p className="text-[8px] text-blue-400 mt-0.5">corrección: {city.forecast.sesgo_aplicado > 0 ? '+' : ''}{city.forecast.sesgo_aplicado.toFixed(1)}°C</p>
                    <p className="text-[7px] text-gray-600">{Object.keys(city.forecast.ensemble_raw).length} modelos · {city.forecast.consenso}</p>
                  </div>
                ))}
              </div>
              {hindcastDays > 0 && (
                <div className="px-4 py-2 text-[10px] text-emerald-400 border-t border-blue-500/10 text-center">
                  ✅ {hindcastDays} días de hindcast cargados automáticamente para precisión y comparación
                </div>
              )}
            </div>
          )}

          {/* City Cards Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {analysis.cities.map(city => (
              <CityCard key={city.slug} data={city} />
            ))}
          </div>

          {/* Allocation */}
          <AllocationPanel
            recommendations={analysis.recommendations}
            totalAllocated={analysis.total_allocated}
          />
        </div>
      )}

      {/* Table View */}
      {activeView === 'table' && analysis && <ForecastTable data={analysis} />}

      {/* Executive Summary View */}
      {activeView === 'executive' && (
        <ExecutiveSummaryPanel
          analysis={analysis}
          metrics={metrics}
          previousAnalysis={previousAnalysis}
          previousMetrics={previousMetrics}
        />
      )}

      {/* Metrics View - Per city with backtesting data */}
      {activeView === 'metrics' && <MetricsChart metrics={metrics} />}

      {/* Comparison View - Forecast vs Actual per city */}
      {activeView === 'comparison' && <ForecastVsActualChart metrics={metrics} />}

      {/* Backtest View */}
      {activeView === 'backtest' && <BacktestChart />}

      {/* Arbitrage View */}
      {activeView === 'arbitrage' && (
        <ArbitragePanel
          alerts={analysis?.arbitrage_alerts ?? []}
          citiesCount={analysis?.cities.length ?? 0}
        />
      )}

      {/* System Architecture View */}
      {activeView === 'architecture' && (
        <div className="space-y-6">
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-6">
            <h2 className="text-xl font-bold text-white mb-1">🏗️ Arquitectura del Sistema</h2>
            <p className="text-sm text-gray-400 mb-6">Pipeline completo de forecasting meteorológico con 5 mejoras implementadas</p>

            {/* Pipeline Flow */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
              <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-4">
                <div className="text-2xl mb-2">📡</div>
                <h3 className="font-semibold text-blue-400 text-sm mb-2">1. Datos Meteorológicos</h3>
                <ul className="text-xs text-gray-400 space-y-1">
                  <li>• Open-Meteo: 6 modelos + ECMWF ENS 51 miembros</li>
                  <li>• Nowcasting METAR: observaciones en vivo</li>
                  <li>• Archive API: temperatura real histórica</li>
                </ul>
              </div>

              <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
                <div className="text-2xl mb-2">🔬</div>
                <h3 className="font-semibold text-emerald-400 text-sm mb-2">2. Ensemble + Filtros</h3>
                <ul className="text-xs text-gray-400 space-y-1">
                  <li>• Z-score filter: excluye modelos outlier (&gt;3σ)</li>
                  <li>• EWMA weighting: pesos dinámicos por precisión</li>
                  <li>• Bias correction dinámico (EMA últimos 30 días)</li>
                </ul>
              </div>

              <div className="rounded-xl bg-purple-500/5 border border-purple-500/20 p-4">
                <div className="text-2xl mb-2">🎯</div>
                <h3 className="font-semibold text-purple-400 text-sm mb-2">3. Calibración</h3>
                <ul className="text-xs text-gray-400 space-y-1">
                  <li>• Empirical CDF: ECMWF ENS 51 miembros</li>
                  <li>• Platt Scaling: calibración sigmoide (activo)</li>
                  <li>• Isotonic PAVA: alternativa disponible (no-normales)</li>
                </ul>
              </div>

              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4">
                <div className="text-2xl mb-2">📊</div>
                <h3 className="font-semibold text-amber-400 text-sm mb-2">4. Probabilidad Monte Carlo</h3>
                <ul className="text-xs text-gray-400 space-y-1">
                  <li>• 20,000 simulaciones por contrato</li>
                  <li>• Student-t ν=4 (colas gordas)</li>
                  <li>• Empirical CDF cuando hay ≥20 miembros</li>
                </ul>
              </div>

              <div className="rounded-xl bg-rose-500/5 border border-rose-500/20 p-4">
                <div className="text-2xl mb-2">💰</div>
                <h3 className="font-semibold text-rose-400 text-sm mb-2">5. Kelly + Asignación</h3>
                <ul className="text-xs text-gray-400 space-y-1">
                  <li>• Fractional Kelly (0.25)</li>
                  <li>• Edge mínimo 6%</li>
                  <li>• $10/día presupuesto, $1-5 por apuesta</li>
                </ul>
              </div>

              <div className="rounded-xl bg-cyan-500/5 border border-cyan-500/20 p-4">
                <div className="text-2xl mb-2">✅</div>
                <h3 className="font-semibold text-cyan-400 text-sm mb-2">6. Validación Walk-Forward</h3>
                <ul className="text-xs text-gray-400 space-y-1">
                  <li>• Backtest walk-forward: sin look-ahead bias</li>
                  <li>• 30 días training + test secuencial</li>
                  <li>• MAE/RMSE/bias por ciudad</li>
                </ul>
              </div>
            </div>

            {/* Model Details */}
            <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4 mb-4">
              <h3 className="font-semibold text-white text-sm mb-3">🧩 Detalle de Modelos (Open-Meteo)</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">best_match</span><p className="text-gray-500">Mejor modelo por coordenada</p></div>
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">ecmwf_ifs025</span><p className="text-gray-500">ECMWF HRES (~9km)</p></div>
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">gfs_seamless</span><p className="text-gray-500">NOAA GFS (~13km)</p></div>
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">icon_seamless</span><p className="text-gray-500">DWD ICON (~13km)</p></div>
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">jma_seamless</span><p className="text-gray-500">JMA Japonés (~20km)</p></div>
                <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">meteofrance_seamless</span><p className="text-gray-500">Météo France (~10km)</p></div>
                <div className="bg-slate-900/50 rounded-lg p-2 col-span-2"><span className="text-emerald-400 font-medium">ecmwf_ens</span><p className="text-gray-500">ECMWF ENS: 51 miembros + control → Empirical CDF</p></div>
              </div>
            </div>

            {/* ECMWF ENS 51 */}
            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 mb-4">
              <h3 className="font-semibold text-emerald-400 text-sm mb-2">🟢 ECMWF ENS 51 Miembros</h3>
              <p className="text-xs text-gray-400 mb-2">Mejora más importante: el Ensemble del Centro Europeo proporciona 51 perturbaciones del mismo modelo, dando una distribución de probabilidad REAL. Esto reemplaza la suposición paramétrica (Student-t) con una CDF empírica, eliminando el mayor error de calibración.</p>
              <div className="text-xs text-gray-500">Cada miembro: misma fecha, misma ciudad, condiciones iniciales ligeramente perturbadas → spread realista</div>
            </div>

            {/* PAVA */}
            <div className="rounded-xl bg-purple-500/5 border border-purple-500/20 p-4 mb-4">
              <h3 className="font-semibold text-purple-400 text-sm mb-2">🟣 Calibración: Platt Scaling (Activo)</h3>
              <p className="text-xs text-gray-400 mb-2">Platt Scaling ajusta probabilidades via sigmoide (logit). Backtest muestra que en datos meteorológicos (distribución aproximadamente normal), Platt supera a PAVA isotonic: 2.5% mejor Brier score, 17.9% mejor ECE.</p>
              <div className="text-xs text-gray-500">PAVA isotonic está disponible como alternativa para datasets no-normales. ECE (Expected Calibration Error) &lt;3% = excelente.</div>
            </div>

            {/* EWMA + Z-score */}
            <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 mb-4">
              <h3 className="font-semibold text-amber-400 text-sm mb-2">🟠 EWMA + Z-score Filter</h3>
              <p className="text-xs text-gray-400 mb-2">EWMA (Exponentially Weighted Moving Average) aplica pesos dinámicos por modelo con decaimiento exponencial (decay=0.15). Z-score filter excluye modelos con |z| &gt; 3σ antes del promedio, eliminando outliers como GFS cuando produce valores extremos.</p>
            </div>

            {/* Walk-forward */}
            <div className="rounded-xl bg-cyan-500/5 border border-cyan-500/20 p-4">
              <h3 className="font-semibold text-cyan-400 text-sm mb-2">🔵 Walk-Forward Backtest</h3>
              <p className="text-xs text-gray-400 mb-2">El gold standard de validación: para cada día, el sesgo se calcula SOLO con datos anteriores a esa fecha. Esto da la precisión real del sistema en producción, sin look-ahead bias. El backtest normal (que entrena con todos los datos) sobrestima la precisión.</p>
              <div className="grid grid-cols-2 gap-4 mt-3 text-xs">
                <div className="bg-slate-900/50 rounded-lg p-2">
                  <p className="text-gray-500">Backtest Simple</p>
                  <p className="text-gray-400">Entrena con datos pasados → sesgo calculado con 90 días</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-2">
                  <p className="text-emerald-400">Walk-Forward</p>
                  <p className="text-gray-400">Cada día solo ve datos anteriores → precisión real</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="mb-3 h-5 w-24 rounded bg-slate-700"></div>
              <div className="mb-3 h-16 rounded bg-slate-700"></div>
              <div className="mb-2 h-3 w-full rounded bg-slate-700"></div>
              <div className="h-3 w-3/4 rounded bg-slate-700"></div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}

