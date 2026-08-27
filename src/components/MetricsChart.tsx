import { useState, useEffect, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Legend
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
  { key: 'all', label: 'Todo' },
]

type PrecisionData = {
  daily: { fecha: string; slug: string; ciudad: string; error: number; temp_corregida?: number; temp_real?: number }[]
  perCity: {
    slug: string; ciudad: string; mae: number; rmse: number; bias: number
    accuracy_pct: number; muestras: number
    best_day: { fecha: string; error: number }; worst_day: { fecha: string; error: number }
  }[]
  global: { mae: number; rmse: number; bias: number; accuracy_pct: number; total: number; dias: number }
  period: number | 'all'
}

export default function MetricsChart() {
  const [period, setPeriod] = useState('30')
  const [data, setData] = useState<PrecisionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCity, setSelectedCity] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/precision?days=${period}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [period])

  // Chart data: pivot daily errors into rows per date
  const chartData = useMemo(() => {
    if (!data) return []
    const byDate = new Map<string, Record<string, any>>()
    for (const d of data.daily) {
      if (!byDate.has(d.fecha)) byDate.set(d.fecha, { fecha: d.fecha })
      byDate.get(d.fecha)![d.slug] = +d.error.toFixed(2)
    }
    return Array.from(byDate.values()).sort((a, b) => a.fecha.localeCompare(b.fecha))
  }, [data])

  // Slugs in data
  const slugs = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.daily.map(d => d.slug)))
  }, [data])

  if (loading) {
    return (
      <div className="card text-center py-16">
        <div className="mb-3 text-3xl animate-pulse">📈</div>
        <p className="text-gray-400 text-sm">Cargando precisión...</p>
      </div>
    )
  }

  if (error || !data || data.perCity.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-red-400 text-sm">⚠️ {error || 'No hay datos con temperatura real verificada'}</p>
      </div>
    )
  }

  const g = data.global

  return (
    <div className="space-y-5">
      {/* Header + Period selector */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">📈 Desviación del Pronóstico vs Real</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {g.dias} días · {g.total} registros · MAE global {g.mae}°C · {g.accuracy_pct}% dentro de ±1°C
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniCard label="MAE" value={`${g.mae}°C`} sub="Error absoluto medio" color="text-blue-400" />
        <MiniCard label="Sesgo" value={`${g.bias > 0 ? '+' : ''}${g.bias}°C`} sub={g.bias > 0.2 ? 'Sobreestima' : g.bias < -0.2 ? 'Subestima' : 'Neutral'} color={Math.abs(g.bias) < 0.3 ? 'text-emerald-400' : 'text-amber-400'} />
        <MiniCard label="±1°C" value={`${g.accuracy_pct}%`} sub="Aciertos" color="text-emerald-400" />
        <MiniCard label="RMSE" value={`${g.rmse}°C`} sub="Error cuadrático" color="text-amber-400" />
      </div>

      {/* Chart: city selector + all cities */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">
            Desviación diaria por ciudad
            <span className="text-gray-600 ml-2">(pronóstico − real)</span>
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
            <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="fecha"
                stroke="#475569"
                tick={{ fontSize: 9 }}
                tickFormatter={v => v.slice(5)}
              />
              <YAxis
                stroke="#475569"
                tick={{ fontSize: 10 }}
                tickFormatter={v => `${v > 0 ? '+' : ''}${v}°`}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: 11 }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value: number, name: string) => [`${value > 0 ? '+' : ''}${value}°C`, name]}
              />
              {/* ±1°C target band */}
              <ReferenceArea y1={-1} y2={1} fill="#10b981" fillOpacity={0.06} />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" />
              <ReferenceLine y={1} stroke="#10b981" strokeDasharray="2 4" strokeOpacity={0.4} />
              <ReferenceLine y={-1} stroke="#10b981" strokeDasharray="2 4" strokeOpacity={0.4} />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                iconType="line"
                iconSize={12}
              />
              {(selectedCity ? [selectedCity] : slugs).map(slug => {
                const city = CIUDADES_ASIA.find(c => c.slug === slug)
                const name = city?.nombre ?? slug
                const color = CITY_COLORS[slug] ?? '#6b7280'
                return (
                  <Line
                    key={slug}
                    type="monotone"
                    dataKey={slug}
                    name={name}
                    stroke={color}
                    strokeWidth={selectedCity ? 2.5 : 1.5}
                    dot={chartData.length <= 40 ? { r: 3 } : false}
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                )
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] text-gray-600 text-center">
          Línea en 0 = perfecto · Zona verde = dentro de ±1°C · Click en leyenda para aislar ciudad
        </p>
      </div>

      {/* Table: sorted by precision */}
      <div className="card">
        <h3 className="mb-3 text-sm font-medium text-gray-400">
          Ranking de precisión por ciudad
          <span className="text-gray-600 ml-2">(más precisa → menos precisa)</span>
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-700/50">
                <th className="pb-2 pr-2 font-medium">#</th>
                <th className="pb-2 pr-2 font-medium">Ciudad</th>
                <th className="pb-2 pr-2 font-medium text-right">MAE</th>
                <th className="pb-2 pr-2 font-medium text-right">Sesgo</th>
                <th className="pb-2 pr-2 font-medium text-right">±1°C</th>
                <th className="pb-2 pr-2 font-medium text-right">RMSE</th>
                <th className="pb-2 pr-2 font-medium text-right">Días</th>
                <th className="pb-2 font-medium text-right">Mejor día</th>
                <th className="pb-2 font-medium text-right">Peor día</th>
              </tr>
            </thead>
            <tbody>
              {data.perCity.map((c, i) => (
                <tr
                  key={c.slug}
                  className="border-t border-gray-700/20 hover:bg-slate-800/40 cursor-pointer transition"
                  onClick={() => setSelectedCity(selectedCity === c.slug ? null : c.slug)}
                >
                  <td className="py-2.5 pr-2 text-gray-600 font-mono">{i + 1}</td>
                  <td className="py-2.5 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CITY_COLORS[c.slug] ?? '#6b7280' }} />
                      <span className={`font-medium ${selectedCity === c.slug ? 'text-white' : 'text-gray-300'}`}>{c.ciudad}</span>
                    </div>
                  </td>
                  <td className={`py-2.5 pr-2 text-right font-mono font-bold ${c.mae <= 1 ? 'text-emerald-400' : c.mae <= 1.5 ? 'text-amber-400' : 'text-red-400'}`}>
                    {c.mae}°
                  </td>
                  <td className={`py-2.5 pr-2 text-right font-mono ${Math.abs(c.bias) < 0.3 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {c.bias > 0 ? '+' : ''}{c.bias}°
                  </td>
                  <td className="py-2.5 pr-2 text-right font-mono text-emerald-400 font-bold">
                    {c.accuracy_pct}%
                  </td>
                  <td className="py-2.5 pr-2 text-right font-mono text-gray-400">
                    {c.rmse}°
                  </td>
                  <td className="py-2.5 pr-2 text-right text-gray-500">
                    {c.muestras}
                  </td>
                  <td className="py-2.5 text-right">
                    <span className="text-emerald-400 font-mono">{c.best_day.error > 0 ? '+' : ''}{c.best_day.error}°</span>
                    <span className="text-gray-600 ml-1">{c.best_day.fecha.slice(5)}</span>
                  </td>
                  <td className="py-2.5 text-right">
                    <span className="text-red-400 font-mono">{c.worst_day.error > 0 ? '+' : ''}{c.worst_day.error}°</span>
                    <span className="text-gray-600 ml-1">{c.worst_day.fecha.slice(5)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[10px] text-gray-600">
          Click en una ciudad para aislarla en el gráfico · MAE = error absoluto medio · Sesgo = dirección promedio del error
        </p>
      </div>

      {/* Tabla de datos: Pronóstico vs Real */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400">
            Datos individuales — Pronóstico vs Real
            <span className="ml-2 text-[10px] text-gray-600">({g.total} registros)</span>
          </h3>
          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Última fecha con real: {data.daily.reduce((max, r) => r.fecha > max ? r.fecha : max, data.daily[0]?.fecha ?? '')}
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
              {[...data.daily]
                .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.ciudad.localeCompare(b.ciudad))
                .map((r, i) => (
                  <tr key={`prec-row-${i}`} className="border-t border-gray-700/30 hover:bg-slate-800/50">
                    <td className="p-2 text-gray-300">{r.fecha.slice(5)}</td>
                    <td className="p-2 text-gray-300">{r.ciudad}</td>
                    <td className="p-2 text-right text-blue-300 font-mono">{r.temp_corregida != null ? r.temp_corregida.toFixed(1) : '-'}</td>
                    <td className="p-2 text-right text-emerald-400 font-mono font-medium">{r.temp_real != null ? r.temp_real.toFixed(1) : '-'}</td>
                    <td className={`p-2 text-right font-mono ${Math.abs(r.error) <= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.error > 0 ? '+' : ''}{r.error.toFixed(2)}°
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function MiniCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 border border-gray-800 p-3 text-center">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${color}`}>{value}</div>
      <div className="text-[9px] text-gray-600 mt-0.5">{sub}</div>
    </div>
  )
}
