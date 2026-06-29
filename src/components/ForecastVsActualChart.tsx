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
  fecha: string
}

export default function ForecastVsActualChart({ metrics }: Props) {
  const [data, setData] = useState<ForecastVsActual[]>([])
  const [selectedCity, setSelectedCity] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBacktest, setShowBacktest] = useState(true)
  const [backtestData, setBacktestData] = useState<BacktestPoint[]>([])
  const [btLoading, setBtLoading] = useState(false)

  // Load data on mount
  useEffect(() => {
    fetchData()
    loadBacktest()
  }, [])

  async function fetchData() {
    setLoading(true)
    setError(null)
    try {
      const slugParam = selectedCity !== 'all' ? `?slug=${selectedCity}` : ''
      const resp = await fetch(`/api/forecast-vs-actual${slugParam}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      if (json.status === 'ok') setData(json.records || [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [selectedCity])

  const loadBacktest = useCallback(async () => {
    setBtLoading(true)
    try {
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
            fecha: r.fecha,
          }))
          setBacktestData(points)
        }
      }
    } catch { /* silent */ }
    setBtLoading(false)
  }, [])

  const cities = Array.from(new Set(data.map(d => d.ciudad))).sort()
  const btCities = Array.from(new Set(backtestData.map(d => d.ciudad))).sort()
  const allCities = Array.from(new Set([...cities, ...btCities])).sort()

  // --- LIVE data processing ---

  // Group by date for the evolution chart (live data)
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

  // Per-city live metrics
  const liveByCity: Record<string, { errors: number[]; pronosticados: number[]; reales: number[] }> = {}
  for (const d of data) {
    if (!liveByCity[d.ciudad]) liveByCity[d.ciudad] = { errors: [], pronosticados: [], reales: [] }
    liveByCity[d.ciudad].errors.push(d.error)
    liveByCity[d.ciudad].pronosticados.push(d.temp_corregida)
    liveByCity[d.ciudad].reales.push(d.temp_real)
  }

  // Per-city backtest metrics
  const btByCity: Record<string, { errors: number[] }> = {}
  for (const d of backtestData) {
    if (!btByCity[d.ciudad]) btByCity[d.ciudad] = { errors: [] }
    btByCity[d.ciudad].errors.push(d.error)
  }

  // Combined city metrics for table
  const cityMetrics = allCities.map(ciudad => {
    const l = liveByCity[ciudad]
    const b = btByCity[ciudad]
    const lErrors = l?.errors ?? []
    const bErrors = b?.errors ?? []
    const lMae = lErrors.length ? lErrors.reduce((s, e) => s + Math.abs(e), 0) / lErrors.length : null
    const bMae = bErrors.length ? bErrors.reduce((s, e) => s + Math.abs(e), 0) / bErrors.length : null
    const lBias = lErrors.length ? lErrors.reduce((s, e) => s + e, 0) / lErrors.length : null
    const bBias = bErrors.length ? bErrors.reduce((s, e) => s + e, 0) / bErrors.length : null
    const lAcc = lErrors.length ? lErrors.filter(e => Math.abs(e) <= 1).length / lErrors.length * 100 : null
    return {
      ciudad,
      live_mae: lMae, live_bias: lBias, live_n: lErrors.length, live_acc: lAcc,
      bt_mae: bMae, bt_bias: bBias, bt_n: bErrors.length,
      pron_prom: l?.pronosticados.length ? l.pronosticados.reduce((s, v) => s + v, 0) / l.pronosticados.length : null,
      real_prom: l?.reales.length ? l.reales.reduce((s, v) => s + v, 0) / l.reales.length : null,
    }
  })

  // Scatter data
  const scatterData = data.map(d => ({
    name: `${d.ciudad} ${formatFecha(d.fecha_objetivo)}`,
    pronosticado: d.temp_corregida,
    real: d.temp_real,
    error: d.error,
    ciudad: d.ciudad,
    source: 'live' as const,
  }))

  const btScatterData = showBacktest ? backtestData.map(d => ({
    ...d,
    source: 'backtest' as const,
  })) : []

  const combinedScatter = [...scatterData, ...btScatterData]

  // Best predictions (live)
  const best = [...data].sort((a, b) => Math.abs(a.error) - Math.abs(b.error)).slice(0, 3)
  const worst = [...data].sort((a, b) => Math.abs(b.error) - Math.abs(a.error)).slice(0, 3)

  const hasLive = data.length > 0
  const hasBt = backtestData.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-white">📊 Comparaci├│n por Ciudad</h2>
          {/* City selector */}
          <select
            value={selectedCity}
            onChange={e => setSelectedCity(e.target.value)}
            className="rounded-lg bg-slate-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
          >
            <option value="all">Todas las ciudades</option>
            {allCities.map(c => (
              <option key={c} value={c.toLowerCase().replace(/\s+/g, '-')}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {/* Backtest toggle */}
          {hasBt && (
            <button
              onClick={() => setShowBacktest(!showBacktest)}
              className={`text-xs border rounded-lg px-3 py-1.5 transition ${
                showBacktest
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                  : 'border-gray-600 text-gray-400 hover:text-gray-300'
              }`}
            >
              {btLoading ? '⏳' : '🔵'} Backtest {showBacktest ? 'ON' : 'OFF'}
            </button>
          )}
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
            📡 Cargar temps
          </button>
          <button onClick={fetchData} disabled={loading} className="text-xs text-blue-400 hover:text-blue-300 transition disabled:opacity-50">
            {loading ? 'Cargando...' : '🔄'}
          </button>
        </div>
      </div>

      {/* Source badges */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        {hasLive && <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400"></span> Live ({data.length} regs)</span>}
        {hasBt && <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400/60"></span> Backtest ({backtestData.length} regs)</span>}
        {!hasLive && !hasBt && <span className="text-gray-600">Sin datos. Ejecuta backtest desde Precisión.</span>}
      </div>

      {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">⚠️ {error}</div>}

      {/* Per-city metrics table */}
      {cityMetrics.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">M├®tricas por ciudad</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-gray-400">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-700/30">
                  <th className="p-2">Ciudad</th>
                  <th className="p-2">MAE Live</th>
                  <th className="p-2">MAE BT</th>
                  <th className="p-2">Bias Live</th>
                  <th className="p-2">Bias BT</th>
                  <th className="p-2">±1°C Live</th>
                  <th className="p-2">N Live</th>
                  <th className="p-2">N BT</th>
                  <th className="p-2">Pron├│st. prom.</th>
                  <th className="p-2">Real prom.</th>
                </tr>
              </thead>
              <tbody>
                {cityMetrics.map(r => (
                  <tr key={r.ciudad} className="border-t border-gray-700/30 hover:bg-slate-800/50">
                    <td className="p-2 text-gray-300 font-medium">{r.ciudad}</td>
                    <td className={`p-2 font-mono ${r.live_mae != null ? 'text-blue-400' : 'text-gray-600'}`}>
                      {r.live_mae != null ? r.live_mae.toFixed(2) + '┬░' : '—'}
                    </td>
                    <td className={`p-2 font-mono ${r.bt_mae != null ? 'text-blue-300' : 'text-gray-600'}`}>
                      {r.bt_mae != null ? r.bt_mae.toFixed(2) + '┬░' : '—'}
                    </td>
                    <td className={`p-2 font-mono ${r.live_bias != null ? (Math.abs(r.live_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-600'}`}>
                      {r.live_bias != null ? `${r.live_bias > 0 ? '+' : ''}${r.live_bias.toFixed(2)}┬░` : '—'}
                    </td>
                    <td className={`p-2 font-mono ${r.bt_bias != null ? (Math.abs(r.bt_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400') : 'text-gray-600'}`}>
                      {r.bt_bias != null ? `${r.bt_bias > 0 ? '+' : ''}${r.bt_bias.toFixed(2)}┬░` : '—'}
                    </td>
                    <td className="p-2 font-mono text-emerald-400">
                      {r.live_acc != null ? r.live_acc.toFixed(0) + '%' : '—'}
                    </td>
                    <td className="p-2 text-gray-500">{r.live_n || '—'}</td>
                    <td className="p-2 text-gray-500">{r.bt_n || '—'}</td>
                    <td className="p-2 text-blue-300 font-mono">{r.pron_prom != null ? r.pron_prom.toFixed(1) + '┬░' : '—'}</td>
                    <td className="p-2 text-emerald-400 font-mono">{r.real_prom != null ? r.real_prom.toFixed(1) + '┬░' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Scatter: forecasted vs actual */}
      {combinedScatter.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">
            Pronosticado vs Real
            {showBacktest && hasBt ? ` (${scatterData.length + btScatterData.length} pts)` : ` (${scatterData.length} pts)`}
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="pronosticado" stroke="#64748b" tick={{ fontSize: 10 }} name="Pronosticado ┬░C" type="number" domain={['auto', 'auto']} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} name="Real ┬░C" type="number" domain={['auto', 'auto']} />
                <ReferenceLine x={0} stroke="#334155" />
                <ReferenceLine y={0} stroke="#334155" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number) => [`${value.toFixed(1)}┬░C`, '']}
                  labelFormatter={(label) => label as string}
                />
                <Legend />
                <Scatter data={combinedScatter} dataKey="real" name="Puntos">
                  {combinedScatter.map((entry, idx) => (
                    <Cell key={idx} fill={entry.source === 'backtest' ? '#3b82f6' : '#10b981'} fillOpacity={entry.source === 'backtest' ? 0.3 : 0.8} />
                  ))}
                </Scatter>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex justify-center gap-4 text-[10px] text-gray-500">
            <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1"></span>Live</span>
            {showBacktest && hasBt && <span><span className="inline-block h-2 w-2 rounded-full bg-blue-400/60 mr-1"></span>Backtest</span>}
          </div>
        </div>
      )}

      {/* Evolution chart */}
      {evolutionData.length > 1 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Evoluci├│n diaria (Live, promedio por d├¡a)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={evolutionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={v => formatFecha(v)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number, name: string) => [`${value.toFixed(1)}┬░C`, name]}
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

      {/* Best/Worst (live) */}
      {hasLive && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card">
            <h3 className="mb-3 text-sm font-medium text-emerald-400">🏆 Mejores (Live)</h3>
            {best.map((d, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 text-xs mb-1">
                <span className="text-gray-300">{d.ciudad}</span>
                <span className="text-gray-500">{formatFecha(d.fecha_objetivo)}</span>
                <span className="text-blue-300">{d.temp_corregida.toFixed(1)}┬░C</span>
                <span className="text-gray-500">→</span>
                <span className="text-emerald-400">{d.temp_real.toFixed(1)}┬░C</span>
                <span className="font-semibold text-emerald-400">{d.error > 0 ? '+' : ''}{d.error.toFixed(2)}┬░</span>
              </div>
            ))}
          </div>
          <div className="card">
            <h3 className="mb-3 text-sm font-medium text-red-400">⚠️ Peores (Live)</h3>
            {worst.map((d, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 text-xs mb-1">
                <span className="text-gray-300">{d.ciudad}</span>
                <span className="text-gray-500">{formatFecha(d.fecha_objetivo)}</span>
                <span className="text-blue-300">{d.temp_corregida.toFixed(1)}┬░C</span>
                <span className="text-gray-500">→</span>
                <span className="text-emerald-400">{d.temp_real.toFixed(1)}┬░C</span>
                <span className="font-semibold text-red-400">{d.error > 0 ? '+' : ''}{d.error.toFixed(2)}┬░</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw data table */}
      {(hasLive || hasBt) && (
        <details className="card">
          <summary className="cursor-pointer text-sm font-medium text-gray-400 hover:text-gray-300">
            📋 Datos ({data.length + (showBacktest ? backtestData.length : 0)} registros)
          </summary>
          <div className="mt-3 max-h-64 overflow-y-auto">
            <table className="w-full text-xs text-gray-400">
              <thead className="sticky top-0 bg-slate-800">
                <tr className="text-left">
                  <th className="p-2">#</th>
                  <th className="p-2">Ciudad</th>
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Pron├│stico</th>
                  <th className="p-2">Real</th>
                  <th className="p-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d, i) => (
                  <tr key={`live-${i}`} className="border-t border-gray-700/30 hover:bg-slate-800/50">
                    <td className="p-2 text-emerald-400">●</td>
                    <td className="p-2 text-gray-300">{d.ciudad}</td>
                    <td className="p-2">{formatFecha(d.fecha_objetivo)}</td>
                    <td className="p-2 text-blue-300">{d.temp_corregida.toFixed(1)}</td>
                    <td className="p-2 text-emerald-400">{d.temp_real.toFixed(1)}</td>
                    <td className={`p-2 font-mono ${Math.abs(d.error) <= 1 ? 'text-emerald-400' : 'text-red-400'}`}>{d.error > 0 ? '+' : ''}{d.error.toFixed(2)}┬░</td>
                  </tr>
                ))}
                {showBacktest && backtestData.map((d, i) => (
                  <tr key={`bt-${i}`} className="border-t border-gray-700/30 hover:bg-slate-800/50 opacity-70">
                    <td className="p-2 text-blue-400">◉</td>
                    <td className="p-2 text-gray-300">{d.ciudad}</td>
                    <td className="p-2">{formatFecha(d.fecha)}</td>
                    <td className="p-2 text-blue-300">{d.pronosticado.toFixed(1)}</td>
                    <td className="p-2 text-emerald-400">{d.real.toFixed(1)}</td>
                    <td className={`p-2 font-mono ${Math.abs(d.error) <= 1 ? 'text-emerald-400' : 'text-red-400'}`}>{d.error > 0 ? '+' : ''}{d.error.toFixed(2)}┬░</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}
