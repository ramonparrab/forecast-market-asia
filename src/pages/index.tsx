import { useState, useEffect, useCallback } from 'react'
import Layout from '@/components/Layout'
import CityCard from '@/components/CityCard'
import AllocationPanel from '@/components/AllocationPanel'
import CityMetricsPanel from '@/components/CityMetricsPanel'
import ComparisonPanel from '@/components/ComparisonPanel'
import ArbitragePanel from '@/components/ArbitragePanel'
import ForecastTable from '@/components/ForecastTable'
import BacktestChart from '@/components/BacktestChart'
import { DailyAnalysis, GlobalMetrics, CityAnalysis } from '@/types'

type View = 'dashboard' | 'table' | 'metrics' | 'comparison' | 'backtest' | 'arbitrage'

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
        <div className="rounded-lg bg-slate-900/50 p-3 border border-amber-500/20">
          <p className="font-semibold text-amber-400 mb-1">📊 Student-t ν=4</p>
          <p className="text-gray-400 text-xs">Distribución de colas más gordas que Gaussiana. Mejor calibración en eventos extremos de temperatura, donde Polymarket suele tener mayor error.</p>
        </div>
        <div className="rounded-lg bg-slate-900/50 p-3 border border-blue-500/20">
          <p className="font-semibold text-blue-400 mb-1">🌡️ Nowcasting METAR</p>
          <p className="text-gray-400 text-xs">Fusión de observaciones meteorológicas en vivo (METAR) con el ensemble. El peso de la observación sube de 0% a 80% durante el día, capturando la temperatura real.</p>
        </div>
        <div className="rounded-lg bg-slate-900/50 p-3 border border-emerald-500/20">
          <p className="font-semibold text-emerald-400 mb-1">🎯 Precisión por ciudad</p>
          <p className="text-gray-400 text-xs">Cálculo dinámico de % de acierto por ciudad basado en: cantidad de modelos, dispersión del ensemble, consenso entre modelos, y actividad de nowcasting.</p>
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

export default function Home() {
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null)
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<View>('dashboard')
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [availableDates, setAvailableDates] = useState<string[]>([])
  const [isHistorical, setIsHistorical] = useState(false)

  // Compute default target date (tomorrow in Caracas)
  const getDefaultTargetDate = () => {
    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    return nowCaracas.toISOString().slice(0, 10)
  }

  useEffect(() => { 
    fetchMetrics()
    fetchAvailableDates()
    setSelectedDate(getDefaultTargetDate())
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
    { key: 'dashboard', label: 'Dashboard', icon: '🏠', desc: 'Vista general' },
    { key: 'table', label: 'Tabla', icon: '📊', desc: 'Datos completos' },
    { key: 'metrics', label: 'Precisión', icon: '📈', desc: 'Métricas históricas' },
    { key: 'comparison', label: 'Comparación', icon: '📉', desc: 'Pronóstico vs Real' },
    { key: 'backtest', label: 'Backtest', icon: '⏳', desc: '90 días históricos' },
    { key: 'arbitrage', label: 'Arbitraje', icon: '🔍', desc: 'Alertas de ineficiencia' },
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
          <div className="mt-6 flex justify-center gap-6 text-xs text-gray-600">
            <span>6 modelos meteorológicos</span>
            <span>·</span>
            <span>20,000 simulaciones Monte Carlo</span>
            <span>·</span>
            <span>Student-t ν=4</span>
            <span>·</span>
            <span>Nowcasting en vivo</span>
          </div>
        </div>
      )}

      {/* Dashboard View */}
      {activeView === 'dashboard' && analysis && (
        <div className="space-y-6">
          {/* City Success Summary */}
          <CitySuccessSummary cities={analysis.cities} />

          {/* 10PM Caracas Forecast Banner */}
          {analysis.cities.length > 0 && (
            <div className="rounded-2xl bg-gradient-to-r from-blue-600/20 via-blue-500/10 to-emerald-600/20 border border-blue-500/20 p-6 text-center">
              <p className="text-sm text-blue-300 font-medium mb-1">🌙 PRONÓSTICO 10PM HORA CARACAS</p>
              <div className="flex items-center justify-center gap-6 flex-wrap">
                {analysis.cities.slice(0, 3).map(city => (
                  <div key={city.slug} className="text-center">
                    <p className="text-xs text-gray-400">{city.ciudad}</p>
                    <p className="text-3xl font-bold text-emerald-400">{city.forecast.temp_corregida.toFixed(1)}°C</p>
                  </div>
                ))}
                {analysis.cities.length > 3 && (
                  <div className="text-center">
                    <p className="text-xs text-gray-500">+{analysis.cities.length - 3} ciudades</p>
                    <p className="text-lg text-gray-300">ver abajo ↓</p>
                  </div>
                )}
              </div>
              <div className="mt-3 flex justify-center gap-4 text-xs text-gray-500">
                <span>📡 {analysis.cities.filter(c => c.nowcast?.activo).length}/{analysis.cities.length} nowcast activo</span>
                <span>🎯 Promedio: {(analysis.cities.reduce((s, c) => s + c.forecast.temp_corregida, 0) / analysis.cities.length).toFixed(1)}°C</span>
              </div>
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

      {/* Metrics View - Per city with backtesting data */}
      {activeView === 'metrics' && <CityMetricsPanel />}

      {/* Comparison View - Forecast vs Actual per city */}
      {activeView === 'comparison' && <ComparisonPanel />}

      {/* Backtest View */}
      {activeView === 'backtest' && <BacktestChart />}

      {/* Arbitrage View */}
      {activeView === 'arbitrage' && (
        <ArbitragePanel
          alerts={analysis?.arbitrage_alerts ?? []}
          citiesCount={analysis?.cities.length ?? 0}
        />
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
