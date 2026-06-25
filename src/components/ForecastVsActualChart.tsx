import { useState, useEffect } from 'react'
import { ForecastVsActual } from '@/types'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Scatter, Cell, ReferenceLine
} from 'recharts'

interface Props {
  metrics: { total_muestras: number } | null
}

function formatFecha(f: string): string {
  const d = new Date(f + 'T12:00:00')
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

export default function ForecastVsActualChart({ metrics }: Props) {
  const [data, setData] = useState<ForecastVsActual[]>([])
  const [selectedCity, setSelectedCity] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  // Extract unique cities from data
  const cities = [...new Set(data.map(d => d.ciudad))].sort()

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

  // Per-city scatter: forecasted vs actual
  const scatterData = data.map(d => ({
    name: `${d.ciudad} ${formatFecha(d.fecha_objetivo)}`,
    pronosticado: d.temp_corregida,
    real: d.temp_real,
    error: d.error,
    ciudad: d.ciudad,
  }))

  // Best and worst predictions
  const sortedByError = [...data].sort((a, b) => Math.abs(b.error) - Math.abs(a.error))
  const best = [...data].sort((a, b) => Math.abs(a.error) - Math.abs(b.error)).slice(0, 3)
  const worst = sortedByError.slice(0, 3)

  if (!metrics || metrics.total_muestras < 1) {
    return (
      <div className="card text-center text-gray-500 py-8">
        <div className="mb-3 text-5xl">📊</div>
        <p className="text-lg font-medium text-gray-400">Pronóstico vs Real</p>
        <p className="mt-1 text-sm">No hay datos históricos con temperatura real registrada.</p>
        <p className="mt-2 text-xs text-gray-600">Ejecuta el análisis y luego usa el botón "Cargar temperaturas reales" para poblar los datos.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* City selector + refresh */}
      <div className="flex items-center justify-between">
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

      {error && (
        <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {/* Resumen de aciertos */}
      {data.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">
              {data.filter(d => Math.abs(d.error) <= 2).length}
            </p>
            <p className="text-xs text-gray-400">Aciertos (±2°C) de {data.length}</p>
          </div>
          <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">
              {(data.reduce((s, d) => s + Math.abs(d.error), 0) / data.length).toFixed(2)}°
            </p>
            <p className="text-xs text-gray-400">Error absoluto promedio (MAE)</p>
          </div>
          <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">
              {data.reduce((s, d) => s + (d.error > 0 ? 1 : 0), 0) > data.reduce((s, d) => s + (d.error < 0 ? 1 : 0), 0)
                ? 'Sobre-est.' : 'Sub-est.'}
            </p>
            <p className="text-xs text-gray-400">Sesgo dominante</p>
          </div>
        </div>
      )}

      {/* Evolution chart: forecast vs actual line chart */}
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

      {/* Scatter: forecasted vs actual per record */}
      {scatterData.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">
            Pronosticado vs Real por ciudad/fecha
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={scatterData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="pronosticado" stroke="#64748b" tick={{ fontSize: 10 }} name="Pronosticado °C" />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} name="Real °C" domain={['auto', 'auto']} />
                <ReferenceLine x={0} stroke="#334155" />
                <ReferenceLine y={0} stroke="#334155" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number, name: string) => [`${value.toFixed(1)}°C`, name]}
                />
                <Legend />
                <Scatter dataKey="real" fill="#10b981" name="Temp. Real" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Best & Worst predictions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-emerald-400">🏆 Mejores pronósticos</h3>
          <div className="space-y-2">
            {best.map((d, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 text-xs">
                <span className="text-gray-300">{d.ciudad}</span>
                <span className="text-gray-500">{formatFecha(d.fecha_objetivo)}</span>
                <span className="text-blue-300">{d.temp_corregida.toFixed(1)}°C</span>
                <span className="text-gray-500">→</span>
                <span className="text-emerald-400">{d.temp_real.toFixed(1)}°C</span>
                <span className="text-gray-500">error:</span>
                <span className={`font-semibold ${Math.abs(d.error) <= 1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {d.error > 0 ? '+' : ''}{d.error.toFixed(2)}°
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-red-400">⚠️ Peores pronósticos</h3>
          <div className="space-y-2">
            {worst.map((d, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-slate-900/50 p-2 text-xs">
                <span className="text-gray-300">{d.ciudad}</span>
                <span className="text-gray-500">{formatFecha(d.fecha_objetivo)}</span>
                <span className="text-blue-300">{d.temp_corregida.toFixed(1)}°C</span>
                <span className="text-gray-500">→</span>
                <span className="text-emerald-400">{d.temp_real.toFixed(1)}°C</span>
                <span className="text-gray-500">error:</span>
                <span className="font-semibold text-red-400">{d.error > 0 ? '+' : ''}{d.error.toFixed(2)}°</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Raw data table */}
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium text-gray-400 hover:text-gray-300">
          📋 Datos completos ({data.length} registros)
        </summary>
        <div className="mt-3 max-h-64 overflow-y-auto">
          <table className="w-full text-xs text-gray-400">
            <thead className="sticky top-0 bg-slate-800">
              <tr className="text-left">
                <th className="p-2">Ciudad</th>
                <th className="p-2">Fecha</th>
                <th className="p-2">Pronóstico</th>
                <th className="p-2">Corregido</th>
                <th className="p-2">Real</th>
                <th className="p-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i} className="border-t border-gray-700/30 hover:bg-slate-800/50">
                  <td className="p-2 text-gray-300">{d.ciudad}</td>
                  <td className="p-2">{formatFecha(d.fecha_objetivo)}</td>
                  <td className="p-2 text-blue-300">{d.temp_pronosticada.toFixed(1)}</td>
                  <td className="p-2 text-blue-400">{d.temp_corregida.toFixed(1)}</td>
                  <td className="p-2 text-emerald-400">{d.temp_real.toFixed(1)}</td>
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
