import { useState, useEffect, useCallback } from 'react'
import Layout from '@/components/Layout'
import CityCard from '@/components/CityCard'
import ForecastTable from '@/components/ForecastTable'
import AllocationPanel from '@/components/AllocationPanel'
import MetricsChart from '@/components/MetricsChart'
import ArbitragePanel from '@/components/ArbitragePanel'
import { DailyAnalysis, GlobalMetrics } from '@/types'

type View = 'dashboard' | 'table' | 'metrics' | 'arbitrage'

export default function Home() {
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null)
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<View>('dashboard')
  const [lastUpdated, setLastUpdated] = useState<string>('')

  // Fetch historical metrics on load
  useEffect(() => {
    fetchMetrics()
  }, [])

  async function fetchMetrics() {
    try {
      const resp = await fetch('/api/metrics')
      if (resp.ok) {
        const data = await resp.json()
        if (data && data.overall_mae !== undefined) {
          setMetrics(data)
        }
      }
    } catch {
      // silent fail
    }
  }

  const runAnalysis = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/forecast', { method: 'POST' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data: DailyAnalysis = await resp.json()
      setAnalysis(data)
      setLastUpdated(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      // Refresh metrics
      await fetchMetrics()
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

  const views: { key: View; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { key: 'table', label: 'Tabla', icon: '📊' },
    { key: 'metrics', label: 'Precisión', icon: '📈' },
    { key: 'arbitrage', label: 'Arbitraje', icon: '🔍' },
  ]

  return (
    <Layout lastUpdated={lastUpdated}>
      {/* Controls */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {loading ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                Analizando...
              </>
            ) : (
              <>
                <span>🔄</span>
                Ejecutar Análisis
              </>
            )}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            Hora Caracas: <span className="text-gray-400">{caracasTime}</span>
            {analysis && analysis.fecha_objetivo && (
              <> · Pronóstico para: <span className="font-semibold text-blue-400">{analysis.fecha_objetivo}</span></>
            )}
            {analysis && analysis.cities.length > 0 && (
              <> · {analysis.cities.length} ciudades · {analysis.recommendations.length} recom.</>
            )}
          </p>
        </div>

        {/* View switcher */}
        <div className="flex gap-1 rounded-lg bg-slate-800 p-1">
          {views.map(v => (
            <button
              key={v.key}
              onClick={() => setActiveView(v.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                activeView === v.key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {/* No data state */}
      {!analysis && !loading && !error && (
        <div className="card py-16 text-center">
          <div className="mb-4 text-5xl">🌤️</div>
          <h2 className="mb-2 text-xl font-semibold text-white">Forecast Market · Asia</h2>
          <p className="mb-4 text-gray-400">
            Pronóstico para <span className="font-medium text-blue-400">{new Date(Date.now() + 86400000).toISOString().slice(0, 10)}</span> · 9 ciudades asiáticas
          </p>
          <p className="mb-6 text-sm text-gray-500">
            Ejecuta a las 10PM Caracas. Compara la temperatura máxima pronosticada contra los precios de cierre de Polymarket.
          </p>
          <button onClick={runAnalysis} className="btn-primary">
            🚀 Comenzar Análisis
          </button>
        </div>
      )}

      {/* Dashboard View */}
      {activeView === 'dashboard' && analysis && (
        <div className="space-y-6">
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
      {activeView === 'table' && analysis && (
        <ForecastTable data={analysis} />
      )}

      {/* Metrics View */}
      {activeView === 'metrics' && (
        <MetricsChart metrics={metrics} />
      )}

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
