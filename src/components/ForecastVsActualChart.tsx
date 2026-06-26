import { useState, useEffect, useCallback } from 'react'
import { ForecastVsActual } from '@/types'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Scatter, ReferenceLine, Cell
} from 'recharts'

interface Props {
  metrics: { total_muestras: number } | null
}

function formatFecha(f: string): string {
  const d = new Date(f + 'T12:00:00')
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

interface BacktestPoint {
  name: string
  pronosticado: number
  real: number
  error: number
  ciudad: string
}

export default function ForecastVsActualChart({ metrics }: Props) {
  const [data, setData] = useState<ForecastVsActual[]>([])
  const [selectedCity, setSelectedCity] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBacktest, setShowBacktest] = useState(false)
  const [backtestData, setBacktestData] = useState<BacktestPoint[]>([])
  const [btLoading, setBtLoading] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const slugParam = selectedCity !== 'all' ? `?slug=${selectedCity}` : ''
      const resp = await fetch(`/api/forecast-vs-actual${slugParam}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      if (json.status === 'ok') {
        setData(json.records || [])
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [selectedCity])

  const loadBacktest = useCallback(async () => {
    setBtLoading(true)
    try {
      // Try to fetch backtest results from the accumulated cache
      const resp = await fetch('/api/backtest', { signal: AbortSignal.timeout(10000) })
      if (resp.ok) {
        const json = await resp.json()
        if (json?.data?.resultados) {
          const points: BacktestPoint[] = json.data.resultados.map((r: any) => ({
            name: `${r.ciudad} ${formatFecha(r.fecha)}`,
            pronosticado: r.temp_corregida,
            real: r.temp_real,
            error: r.error,
            ciudad: r.ciudad,
          }))
          setBacktestData(points)
        }
      }
    } catch { /* silent */ }
    setBtLoading(false)
  }, [])

  useEffect(() => {
    if (showBacktest && backtestData.length === 0) loadBacktest()
  }, [showBacktest, backtestData.length, loadBacktest])

  const cities = Array.from(new Set(data.map(d => d.ciudad))).sort()

  // Group by date for the evolution chart
  const byDate: Record<string, { fecha: string; pronosticado: number; real: number; error: number; count: number }> = {}
  for (const d of data) {
    if (!byDate[d.fecha_objetivo]) {
      byDate[d.fecha_objetivo] = { fecha: d.fecha_objetivo, pronosticado: 0, real: 0, error: 0, count: 0 }
    }
    byDate[d.fecha_objetivo].pronosticado += d.temp_corregida
    byDate[d.fecha_objetivo].real += d.temp_real
    byDate[d.fecha_objetivo].error += Math.abs(d.error)
    byDate[d.fecha_objetivo].count++
  }
  const evolutionData = Object.values(byDate)
    .map(d => ({
      fecha: d.fecha,
      pronosticado: Math.round((d.pronosticado / d.count) * 100) / 100,
      real: Math.round((d.real / d.count) * 100) / 100,
      error: Math.round((d.error / d.count) * 100) / 100,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  // Per-city scatter: forecasted vs actual (live data)
  const scatterData = data.map(d => ({
    name: `${d.ciudad} ${formatFecha(d.fecha_objetivo)}`,
    pronosticado: d.temp_corregida,
    real: d.temp_real,
    error: d.error,
    ciudad: d.ciudad,
  }))

  // Combined scatter (backtest shown as faint overlay)
  const combinedScatter = showBacktest
    ? [
        ...scatterData.map(d => ({ ...d, source: 'live' as const })),
        ...backtestData.map(d => ({ ...d, source: 'backtest' as const })),
      ]
    : scatterData.map(d => ({ ...d, source: 'live' as const }))

  // Best and worst predictions (live only)
  const best = [...data].sort((a, b) => Math.abs(a.error) - Math.abs(b.error)).slice(0, 3)
  const worst = [...data].sort((a, b) => Math.abs(b.error) - Math.abs(a.error)).slice(0, 3)

  const hasLive = data.length > 0
  const showEmpty = !hasLive && !showBacktest
  const showOnlyBacktest = !hasLive && showBacktest && backtestData.length > 0

  if (showEmpty) {
    return (
      <div className="card text-center text-gray-500 py-8">
        <div className="mb-3 text-5xl">📊</div>
        <p className="text-lg font-medium text-gray-400">Pronóstico vs Real</p>
        <p className="mt-1 text-sm">No hay datos de tiempo real aún.</p>
        <p className="mt-2 text-xs text-gray-600">
          <button onClick={() => setShowBacktest(true)} className="text-blue-400 hover:text-blue-300 underline">
            Activar datos de backtest
          </button>
          {' '}para ver comparación histórica simulada.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-white">📊 Pronóstico vs Real</h2>
          <select
            value={selectedCity}
            onChange={e => setSelectedCity(e.target.value)}
            className="rounded-lg bg-slate-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="all">Todas las ciudades</option>
            {cities.map(c => <option key={c} value={c.toLowerCase().replace(/\s+/g, '-')}>{c}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {/* Backtest toggle */}
          <button
            onClick={() => { setShowBacktest(!showBacktest); if (!showBacktest && backtestData.length === 0) loadBacktest() }}
            className={`text-xs border rounded-lg px-3 py-1.5 transition ${
              showBacktest
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                : 'border-gray-600 text-gray-400 hover:text-gray-300'
            }`}
          >
            {btLoading ? '⏳' : '🔵'} Backtest {showBacktest ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={async () => {
              setLoading(true)
              try {
                await fetch('/api/backfill', { method: 'POST' })
                await fetchData()
              } catch { /* ignore */ }
              setLoading(false)
            }}
            disabled={loading}
            className="text-xs text-amber-400 hover:text-amber-300 transition disabled:opacity-50 border border-amber-500/30 rounded-lg px-3 py-1.5"
          >
            📡 Cargar temps reales
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="text-xs text-blue-400 hover:text-blue-300 transition disabled:opacity-50"
          >
            {loading ? 'Cargando...' : '🔄 Refrescar'}
          </button>
        </div>
      </div>

      {/* Source badges */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        {hasLive && <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400"></span> Tiempo real ({data.length} registros)</span>}
        {showBacktest && backtestData.length > 0 && <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400/50"></span> Backtest ({backtestData.length} registros)</span>}
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">⚠️ {error}</div>
      )}

      {/* Resumen */}
      {(hasLive || showOnlyBacktest) && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">
              {hasLive ? data.filter(d => Math.abs(d.error) <= 2).length : '—'}
            </p>
            <p className="text-xs text-gray-400">
              Aciertos live (±2°C) {hasLive ? `de ${data.length}` : ''}
              {showBacktest && backtestData.length > 0 && (
                <span className="block text-blue-400">Backtest: {backtestData.filter(d => Math.abs(d.error) <= 2).length} de {backtestData.length}</span>
              )}
            </p>
          </div>
          <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">
              {hasLive ? (data.reduce((s, d) => s + Math.abs(d.error), 0) / data.length).toFixed(2) : '—'}°
            </p>
            <p className="text-xs text-gray-400">
              MAE live
              {showBacktest && backtestData.length > 0 && (
                <span className="block text-blue-400">
                  MAE backtest: {(backtestData.reduce((s, d) => s + Math.abs(d.error), 0) / backtestData.length).toFixed(2)}°
                </span>
              )}
            </p>
          </div>
          <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 text-center">
            {hasLive ? (
              <>
                <p className="text-2xl font-bold text-amber-400">
                  {data.reduce((s, d) => s + (d.error > 0 ? 1 : 0), 0) > data.reduce((s, d) => s + (d.error < 0 ? 1 : 0), 0)
                    ? 'Sobre-est.' : 'Sub-est.'}
                </p>
                <p className="text-xs text-gray-400">Sesgo dominante live</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-amber-400">—</p>
                <p className="text-xs text-gray-400">Sesgo dominante</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Evolution chart (live data) */}
      {evolutionData.length > 1 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">
            Evolución: Pronosticado vs Real (promedio por día)
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={evolutionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={v => formatFecha(v)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number, name: string) => [`${value.toFixed(1)}°C`, name]}
                />
                <Legend />
                <Line type="monotone" dataKey="pronosticado" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Pronosticado" />
                <Line type="monotone" dataKey="real" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Real" />
                <Bar dataKey="error" fill="#f59e0b" opacity={0.3} name="Error abs." />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Combined scatter: forecasted vs actual (live + optional backtest) */}
      {combinedScatter.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">
            Pronosticado vs Real
            {showBacktest && backtestData.length > 0 ? ' (Live + Backtest)' : ''}
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="pronosticado" stroke="#64748b" tick={{ fontSize: 10 }} name="Pronosticado °C" type="number" domain={['auto', 'auto']} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} name="Real °C" type="number" domain={['auto', 'auto']} />
                <ReferenceLine x={0} stroke="#334155" />
                <ReferenceLine y={0} stroke="#334155" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number, name: string) => [`${value.toFixed(1)}°C`, name]}
                />
                <Legend />
                <Scatter data={combinedScatter} dataKey="real" fill="#10b981" name="Tiempo Real">
                  {combinedScatter.map((entry, idx) => (
                    <Cell key={idx} fill={entry.source === 'backtest' ? '#3b82f6' : '#10b981'} fillOpacity={entry.source === 'backtest' ? 0.3 : 0.8} />
                  ))}
                </Scatter>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Backtest-only scatter */}
      {showOnlyBacktest && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Pronosticado vs Real (Backtest)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={backtestData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="pronosticado" stroke="#64748b" tick={{ fontSize: 10 }} name="Pronosticado °C" type="number" domain={['auto', 'auto']} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} name="Real °C" type="number" domain={['auto', 'auto']} />
                <ReferenceLine x={0} stroke="#334155" />
                <ReferenceLine y={0} stroke="#334155" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number, name: string) => [`${value.toFixed(1)}°C`, name]}
                />
                <Legend />
                <Scatter dataKey="real" fill="#3b82f6" fillOpacity={0.5} name="Backtest" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Best & Worst predictions (live data) */}
      {hasLive && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card">
            <h3 className="mb-3 text-sm font-medium text-emerald-400">🏆 Mejores pronósticos (Live)</h3>
            <div className="space-y-2">
              {best.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 text-xs">
                  <span className="text-gray-300">{d.ciudad}</span>
                  <span className="text-gray-500">{formatFecha(d.fecha_objetivo)}</span>
                  <span className="text-blue-300">{d.temp_corregida.toFixed(1)}°C</span>
                  <span className="text-gray-500">→</span>
                  <span className="text-emerald-400">{d.temp_real.toFixed(1)}°C</span>
                  <span className="font-semibold text-emerald-400">{d.error > 0 ? '+' : ''}{d.error.toFixed(2)}°</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h3 className="mb-3 text-sm font-medium text-red-400">⚠️ Peores pronósticos (Live)</h3>
            <div className="space-y-2">
              {worst.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 text-xs">
                  <span className="text-gray-300">{d.ciudad}</span>
                  <span className="text-gray-500">{formatFecha(d.fecha_objetivo)}</span>
                  <span className="text-blue-300">{d.temp_corregida.toFixed(1)}°C</span>
                  <span className="text-gray-500">→</span>
                  <span className="text-emerald-400">{d.temp_real.toFixed(1)}°C</span>
                  <span className="font-semibold text-red-400">{d.error > 0 ? '+' : ''}{d.error.toFixed(2)}°</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Raw data table */}
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium text-gray-400 hover:text-gray-300">
          📋 Datos completos ({data.length + (showBacktest && backtestData.length > 0 ? backtestData.length : 0)} registros)
        </summary>
        <div className="mt-3 max-h-64 overflow-y-auto">
          <table className="w-full text-xs text-gray-400">
            <thead className="sticky top-0 bg-slate-800">
              <tr className="text-left">
                <th className="p-2">Fuente</th>
                <th className="p-2">Ciudad</th>
                <th className="p-2">Fecha</th>
                <th className="p-2">Pronóstico</th>
                <th className="p-2">Real</th>
                <th className="p-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={`live-${i}`} className="border-t border-gray-700/30 hover:bg-slate-800/50">
                  <td className="p-2"><span className="text-emerald-400">●</span></td>
                  <td className="p-2 text-gray-300">{d.ciudad}</td>
                  <td className="p-2">{formatFecha(d.fecha_objetivo)}</td>
                  <td className="p-2 text-blue-300">{d.temp_corregida.toFixed(1)}</td>
                  <td className="p-2 text-emerald-400">{d.temp_real.toFixed(1)}</td>
                  <td className={`p-2 font-mono ${Math.abs(d.error) <= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {d.error > 0 ? '+' : ''}{d.error.toFixed(2)}°
                  </td>
                </tr>
              ))}
              {showBacktest && backtestData.map((d, i) => (
                <tr key={`bt-${i}`} className="border-t border-gray-700/30 hover:bg-slate-800/50 opacity-70">
                  <td className="p-2"><span className="text-blue-400">◉</span></td>
                  <td className="p-2 text-gray-300">{d.ciudad}</td>
                  <td className="p-2">{d.name.split(' ').slice(1).join(' ')}</td>
                  <td className="p-2 text-blue-300">{d.pronosticado.toFixed(1)}</td>
                  <td className="p-2 text-emerald-400">{d.real.toFixed(1)}</td>
                  <td className={`p-2 font-mono ${Math.abs(d.error) <= 2 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {d.error > 0 ? '+' : ''}{d.error.toFixed(2)}°
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
