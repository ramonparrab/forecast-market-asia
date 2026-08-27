import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, Cell, ReferenceLine
} from 'recharts'
import { CIUDADES_ASIA } from '@/lib/cities'

const CITY_COLORS: Record<string, string> = {
  seoul: '#3b82f6',
  beijing: '#ef4444',
  shanghai: '#f59e0b',
  'hong-kong': '#10b981',
  tokyo: '#8b5cf6',
  shenzhen: '#ec4899',
  wuhan: '#06b6d4',
  chongqing: '#f97316',
  chengdu: '#84cc16',
  singapore: '#e879f9',
}

const PERIODS = [
  { key: '30', label: '30 días' },
  { key: '60', label: '60 días' },
  { key: '90', label: '90 días' },
  { key: '180', label: '180 días' },
  { key: 'all', label: 'Todo' },
]

type CityMetrics = {
  ciudad: string
  slug: string
  mae: number
  rmse: number
  bias: number
  accuracy_within_1c: number
  max_error: number
  muestras: number
}

type BacktestData = {
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
  resultados: { fecha: string; ciudad: string; slug: string; temp_corregida: number; temp_real: number; error: number; run_type_ganadora: string }[]
  evolucion_diaria: { fecha: string; mae_diario: number; mae_7d: number }[]
  period: number | 'all'
}

export default function BacktestChart() {
  const [period, setPeriod] = useState('90')
  const [data, setData] = useState<BacktestData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/backtest?days=${period}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => {
        if (j.data) setData(j.data)
        else setError(j.error || 'Sin datos')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [period])

  // Chart data for deviation per city per day
  const chartData = useMemo(() => {
    if (!data) return []
    const byDate = new Map<string, Record<string, any>>()
    for (const d of data.resultados) {
      if (selectedCity && d.slug !== selectedCity) continue
      if (!byDate.has(d.fecha)) byDate.set(d.fecha, { fecha: d.fecha })
      byDate.get(d.fecha)![d.slug] = +d.error.toFixed(2)
    }
    return Array.from(byDate.values()).sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [data, selectedCity])

  const slugs = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.resultados.map(d => d.slug)))
  }, [data])

  if (loading) {
    return (
      <div className="card text-center py-16">
        <div className="mb-3 text-3xl animate-pulse">📊</div>
        <p className="text-gray-400 text-sm">Cargando backtest...</p>
      </div>
    )
  }

  if (error || !data || data.total_muestras === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-red-400 text-sm">⚠️ {error || 'No hay datos verificados en forecast_snapshot'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header + Period selector */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">📊 Backtest (datos RESUMEN)</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Basado en forecast_snapshot · {data.total_dias} días · {data.total_muestras} muestras · {data.total_ciudades} ciudades
            </p>
          </div>
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => { setPeriod(p.key); setSelectedCity(null) }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  period === p.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-gray-400 hover:text-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Global summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard label="MAE Global" value={`${data.overall_mae}°C`} desc="Error absoluto medio" color="text-blue-400" />
        <MiniCard label="RMSE" value={`${data.overall_rmse}°C`} desc="Raíz error cuadrático" color="text-amber-400" />
        <MiniCard label="±1°C" value={`${data.overall_accuracy_1c}%`} desc="Aciertos" color="text-emerald-400" />
        <MiniCard label="Bias" value={`${data.overall_bias > 0 ? '+' : ''}${data.overall_bias}°C`} desc={data.overall_bias > 0.2 ? 'Sobreestima' : data.overall_bias < -0.2 ? 'Subestima' : 'Neutral'} color={Math.abs(data.overall_bias) < 0.3 ? 'text-emerald-400' : 'text-red-400'} />
      </div>

      {/* Best / Worst banner */}
      <div className="rounded-xl bg-gradient-to-r from-blue-600/10 to-emerald-600/10 border border-blue-500/20 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-gray-300">🏆 <strong className="text-emerald-400">{data.mejores_ciudades.join(', ')}</strong></span>
          <span className="text-gray-500">|</span>
          <span className="text-gray-300">⚠️ <strong className="text-red-400">{data.peores_ciudades.join(', ')}</strong></span>
          <span className="text-gray-500">|</span>
          <span className="text-gray-400">Winner: 10PM vs 11PM (forecast_snapshot)</span>
        </div>
      </div>

      {/* MAE por ciudad - Bar chart */}
      <div className="card">
        <h3 className="mb-3 text-sm font-medium text-gray-400">MAE por ciudad</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.por_ciudad.map(c => ({ ...c, mae: Number(c.mae) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: 11 }} labelStyle={{ color: '#94a3b8' }} />
              <Bar dataKey="mae" radius={[4, 4, 0, 0]}>
                {data.por_ciudad.map((c) => (
                  <Cell key={c.slug} fill={CITY_COLORS[c.slug] ?? '#6b7280'} />
                ))}
              </Bar>
              <ReferenceLine y={1} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '±1°C', fill: '#f59e0b', fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Deviation chart with city selector */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">
            Desviación diaria (pronóstico − real)
          </h3>
          {selectedCity && (
            <button onClick={() => setSelectedCity(null)} className="text-xs text-blue-400 hover:text-blue-300">↻ Ver todas</button>
          )}
        </div>
        {/* City chips */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {slugs.map(slug => {
            const city = CIUDADES_ASIA.find(c => c.slug === slug)
            const name = city?.nombre ?? slug
            const color = CITY_COLORS[slug] ?? '#6b7280'
            const isActive = selectedCity === slug
            return (
              <button
                key={slug}
                onClick={() => setSelectedCity(isActive ? null : slug)}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium border transition-all ${
                  isActive
                    ? 'text-white border-transparent'
                    : 'text-gray-400 border-gray-700 bg-slate-800/60 hover:text-gray-200 hover:border-gray-500'
                }`}
                style={isActive ? { backgroundColor: color, borderColor: color } : undefined}
              >
                {name}
              </button>
            )
          })}
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="fecha" stroke="#475569" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
              <YAxis stroke="#475569" tick={{ fontSize: 10 }} tickFormatter={v => `${v > 0 ? '+' : ''}${v}°`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: 11 }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
              <ReferenceLine y={1} stroke="#10b981" strokeDasharray="2 4" strokeOpacity={0.4} />
              <ReferenceLine y={-1} stroke="#10b981" strokeDasharray="2 4" strokeOpacity={0.4} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="line" iconSize={12} />
              {(selectedCity ? [selectedCity] : slugs).map(slug => {
                const city = CIUDADES_ASIA.find(c => c.slug === slug)
                const name = city?.nombre ?? slug
                return (
                  <Bar
                    key={slug}
                    dataKey={slug}
                    name={name}
                    fill={CITY_COLORS[slug] ?? '#6b7280'}
                    opacity={selectedCity ? 0.9 : 0.5}
                    radius={[2, 2, 0, 0]}
                  />
                )
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] text-gray-600 text-center">
          Barra en 0 = perfecto · Líneas verdes = ±1°C · Datos de forecast_snapshot (winner 10PM/11PM)
        </p>
      </div>

      {/* Evolución del error (MAE diario + media 7d) */}
      {data.evolucion_diaria.length > 1 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Evolución del MAE diario</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.evolucion_diaria}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: 11 }} labelStyle={{ color: '#94a3b8' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="mae_diario" fill="#3b82f6" name="MAE diario" radius={[2, 2, 0, 0]} opacity={0.6} />
                <Line type="monotone" dataKey="mae_7d" stroke="#10b981" strokeWidth={2} dot={false} name="MAE (media 7d)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* City cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.por_ciudad.map(city => {
          const accuracyColor = city.accuracy_within_1c >= 40 ? 'text-emerald-400' : city.accuracy_within_1c >= 25 ? 'text-amber-400' : 'text-red-400'
          const maeColor = city.mae <= 1.5 ? 'text-emerald-400' : city.mae <= 2.5 ? 'text-amber-400' : 'text-red-400'
          return (
            <div
              key={city.slug}
              className="rounded-xl bg-slate-900/50 border border-gray-700/30 p-4 cursor-pointer hover:border-gray-600/50 transition"
              onClick={() => setSelectedCity(selectedCity === city.slug ? null : city.slug)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CITY_COLORS[city.slug] ?? '#6b7280' }} />
                  <h4 className="font-semibold text-white">{city.ciudad}</h4>
                </div>
                <span className={`text-xs font-medium ${maeColor}`}>{city.mae}°C MAE</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-gray-500">RMSE:</span> <span className="text-gray-300">{city.rmse}°C</span></div>
                <div><span className="text-gray-500">Bias:</span> <span className="text-gray-300">{city.bias > 0 ? '+' : ''}{city.bias}°</span></div>
                <div><span className="text-gray-500">±1°C:</span> <span className={accuracyColor}>{city.accuracy_within_1c}%</span></div>
                <div><span className="text-gray-500">Max error:</span> <span className="text-red-400">{city.max_error}°C</span></div>
                <div className="col-span-2"><span className="text-gray-500">Muestras:</span> <span className="text-gray-400">{city.muestras} días</span></div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Tabla de datos: Pronóstico vs Real */}
      {data.resultados.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-400">
              Datos individuales — Pronóstico vs Real
              <span className="ml-2 text-[10px] text-gray-600">({data.resultados.length} registros)</span>
            </h3>
            <span className="text-[10px] text-emerald-400 flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              Última fecha con real: {data.resultados.reduce((max, r) => r.fecha > max ? r.fecha : max, data.resultados[0]?.fecha ?? '')}
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs text-gray-400">
              <thead className="sticky top-0 bg-slate-800">
                <tr className="text-left text-gray-500 border-b border-gray-700/30">
                  <th className="p-2">Fecha</th>
                  <th className="p-2">Ciudad</th>
                  <th className="p-2 text-right">Pronóstico</th>
                  <th className="p-2 text-right text-emerald-400">Real</th>
                  <th className="p-2 text-right">Error</th>
                </tr>
              </thead>
              <tbody>
                {[...data.resultados]
                  .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.ciudad.localeCompare(b.ciudad))
                  .map((r, i) => (
                    <tr key={`bt-row-${i}`} className="border-t border-gray-700/30 hover:bg-slate-800/50">
                      <td className="p-2 text-gray-300">{r.fecha.slice(5)}</td>
                      <td className="p-2 text-gray-300">{r.ciudad}</td>
                      <td className="p-2 text-right text-blue-300 font-mono">{r.temp_corregida.toFixed(1)}°C</td>
                      <td className="p-2 text-right text-emerald-400 font-mono font-medium">{r.temp_real.toFixed(1)}°C</td>
                      <td className={`p-2 text-right font-mono ${Math.abs(r.error) <= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.error > 0 ? '+' : ''}{r.error.toFixed(2)}°
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Interpretación */}
      <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 p-4 text-xs text-gray-500">
        <p className="font-medium text-gray-400 mb-2">📖 Interpretación</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><strong className="text-gray-400">MAE:</strong> Error absoluto medio en °C.</div>
          <div><strong className="text-gray-400">RMSE:</strong> Penaliza errores grandes. Si RMSE &gt; MAE×1.5 hay outliers.</div>
          <div><strong className="text-gray-400">Acierto ±1°C:</strong> % de días con error ≤ 1°C.</div>
          <div><strong className="text-gray-400">Bias:</strong> Error sistemático. Positivo = sobre-estimamos.</div>
          <div className="sm:col-span-2"><strong className="text-gray-400">Fuente:</strong> forecast_snapshot (winner 10PM/11PM) — misma data que RESUMEN.</div>
        </div>
      </div>
    </div>
  )
}

function MiniCard({ label, value, desc, color }: { label: string; value: string; desc: string; color: string }) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-gray-700/30 p-4 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-600 mt-0.5">{desc}</p>
    </div>
  )
}
