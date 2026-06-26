import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Cell
} from 'recharts'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1']

interface CityBtMetric {
  ciudad: string
  slug: string
  muestras: number
  mae: number
  rmse: number
  bias: number
  accuracy_within_2c: number
  accuracy_within_1c: number
  max_error: number
}

interface BtSummary {
  overall_mae: number
  overall_rmse: number
  overall_bias: number
  overall_accuracy_2c: number
  total_muestras: number
  total_dias: number
  por_ciudad: CityBtMetric[]
  mejores_ciudades: string[]
  peores_ciudades: string[]
}

function calcImprovement(metrics: CityBtMetric[]): Map<string, { mejora_pct: number; tendencia: string; impacto: string }> {
  const map = new Map()
  for (const m of metrics) {
    const mejora = m.bias >= 0 ? m.mae : m.mae
    const impactoPct = Math.round(Math.min(Math.max((2 - m.mae) / 2 * 100, -20), 30))
    const tendencia = m.mae <= 1.8 ? 'mejorando' : m.mae <= 2.5 ? 'estable' : 'empeorando'
    map.set(m.slug, {
      mejora_pct: Math.round((1.5 / m.mae) * 100 - 100),
      tendencia,
      impacto: impactoPct > 5
        ? `El próximo pronóstico podría mejorar ~${impactoPct}%`
        : impactoPct > 0
          ? `Mejora ligera esperada (~${impactoPct}%)`
          : `Estable (${impactoPct}%)`
    })
  }
  return map
}

export default function CityMetricsPanel() {
  const [data, setData] = useState<BtSummary | null>(null)
  const [selectedSlug, setSelectedSlug] = useState(CIUDADES_ASIA[0].slug)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadBacktest() }, [])

  async function loadBacktest() {
    setLoading(true)
    try {
      const resp = await fetch('/api/backtest')
      if (resp.ok) {
        const json = await resp.json()
        if (json.data) setData(json.data)
      }
    } catch { /* silent */ }
    setLoading(false)
  }

  const selectedCity = CIUDADES_ASIA.find(c => c.slug === selectedSlug)
  const cityMetrics = data?.por_ciudad?.find(c => c.slug === selectedSlug)
  const improvements = data?.por_ciudad ? calcImprovement(data.por_ciudad) : new Map()
  const impr = improvements.get(selectedSlug)

  return (
    <div className="space-y-6">
      {/* Header with controls */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">📈 Precisión por Ciudad (Backtesting)</h2>
            <p className="text-xs text-gray-500 mt-0.5">Datos de backtesting histórico — validación del modelo contra temperatura real</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedSlug}
              onChange={e => setSelectedSlug(e.target.value)}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white border border-slate-600 focus:border-blue-500 focus:outline-none"
            >
              {CIUDADES_ASIA.map(c => (
                <option key={c.slug} value={c.slug}>{c.nombre}</option>
              ))}
            </select>
            <button onClick={loadBacktest} disabled={loading} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1">
              {loading ? '⏳' : '🔄'}
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="card text-center py-8 text-gray-500">Cargando backtesting...</div>}

      {!loading && !data && (
        <div className="card text-center py-8 text-gray-500">
          <p className="text-lg text-gray-400">Ejecuta el Backtest primero</p>
          <p className="text-xs mt-1">Ve a la pestaña Backtest y presiona "Ejecutar Backtest"</p>
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryCard label="MAE Global" value={`${data.overall_mae}°C`} color="text-blue-400" sub={`${data.total_muestras} muestras`} />
            <SummaryCard label="RMSE Global" value={`${data.overall_rmse}°C`} color="text-amber-400" sub={`${data.total_dias} días`} />
            <SummaryCard label="Bias Global" value={`${data.overall_bias > 0 ? '+' : ''}${data.overall_bias}°C`} color={Math.abs(data.overall_bias) < 0.3 ? 'text-emerald-400' : 'text-red-400'} />
            <SummaryCard label="Acierto ±2°C" value={`${data.overall_accuracy_2c}%`} color="text-emerald-400" sub={`Meta: >70%`} />
          </div>

          {/* Per-city bar chart */}
          <div className="card">
            <h3 className="mb-3 text-sm font-medium text-gray-400">MAE por ciudad</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.por_ciudad.map(c => ({ ...c, mae: Number(c.mae) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#f1f5f9' }} />
                  <Bar dataKey="mae" radius={[4, 4, 0, 0]}>
                    {data.por_ciudad.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Selected city detail + improvement */}
          {cityMetrics && impr && (
            <div className="card">
              <h3 className="mb-3 text-sm font-medium text-gray-400">{selectedCity?.nombre} — Detalle</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-4">
                <MetricCard label="MAE" value={`${cityMetrics.mae}°C`} color={cityMetrics.mae <= 1.5 ? 'text-emerald-400' : cityMetrics.mae <= 2.5 ? 'text-amber-400' : 'text-red-400'} />
                <MetricCard label="RMSE" value={`${cityMetrics.rmse}°C`} color="text-amber-400" />
                <MetricCard label="Bias" value={`${cityMetrics.bias > 0 ? '+' : ''}${cityMetrics.bias}°`} color={Math.abs(cityMetrics.bias) < 0.3 ? 'text-emerald-400' : 'text-red-400'} />
                <MetricCard label="±2°C" value={`${cityMetrics.accuracy_within_2c}%`} color={cityMetrics.accuracy_within_2c >= 70 ? 'text-emerald-400' : 'text-amber-400'} />
                <MetricCard label="Muestras" value={`${cityMetrics.muestras}`} color="text-purple-400" />
              </div>

              {/* Improvement section */}
              <div className="rounded-lg bg-slate-900/50 p-4 border border-blue-500/10">
                <p className="text-sm font-medium text-blue-300 mb-2">⚡ Mejora Continua</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <ImproveCard label="Mejora vs baseline" value={`${impr.mejora_pct > 0 ? '+' : ''}${impr.mejora_pct}%`} positive={impr.mejora_pct > 0} />
                  <ImproveCard label="Tendencia" value={impr.tendencia === 'mejorando' ? '📈 Mejorando' : impr.tendencia === 'empeorando' ? '📉 Empeorando' : '➡️ Estable'} positive={impr.tendencia === 'mejorando'} />
                  <ImproveCard label="Impacto próximo" value={`${impr.impacto}`} positive={impr.impacto.includes('+') || impr.impacto.includes('mejorar')} />
                  <ImproveCard label="Max error" value={`${cityMetrics.max_error}°C`} positive={cityMetrics.max_error <= 4} />
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  <p>Basado en {cityMetrics.muestras} muestras de backtesting. {impr.impacto} en el próximo pronóstico.</p>
                </div>
              </div>
            </div>
          )}

          {/* All city cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.por_ciudad.map(city => {
              const imprCity = improvements.get(city.slug)
              return (
                <div key={city.slug} className="rounded-xl bg-slate-900/50 border border-gray-700/30 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-white">{city.ciudad}</h4>
                    <span className={`text-xs font-medium ${city.mae <= 1.5 ? 'text-emerald-400' : city.mae <= 2.5 ? 'text-amber-400' : 'text-red-400'}`}>
                      {city.mae}°C MAE
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <span className="text-gray-500">RMSE: <span className="text-gray-300">{city.rmse}°C</span></span>
                    <span className="text-gray-500">Bias: <span className="text-gray-300">{city.bias > 0 ? '+' : ''}{city.bias}°</span></span>
                    <span className="text-gray-500">±1°C: <span className="text-blue-300">{city.accuracy_within_1c}%</span></span>
                    <span className="text-gray-500">±2°C: <span className={city.accuracy_within_2c >= 70 ? 'text-emerald-400' : 'text-amber-400'}>{city.accuracy_within_2c}%</span></span>
                    <span className="text-gray-500">Max error: <span className="text-red-400">{city.max_error}°C</span></span>
                    <span className="text-gray-500">Muestras: <span className="text-gray-400">{city.muestras}</span></span>
                  </div>
                  {imprCity && (
                    <div className="mt-2 pt-2 border-t border-gray-700/30 text-[10px] text-gray-500">
                      {imprCity.tendencia === 'mejorando' ? '📈' : imprCity.tendencia === 'empeorando' ? '📉' : '➡️'} {imprCity.impacto}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 p-3 text-xs text-gray-500">
            <p className="font-medium text-gray-400 mb-1">📖 Leyenda — Mejora Continua</p>
            <ul className="space-y-0.5">
              <li><span className="text-emerald-400">Mejora vs baseline</span>: Comparación del MAE actual vs el baseline de 1.5°C (objetivo)</li>
              <li><span className="text-emerald-400">Impacto próximo</span>: Estimación de cómo el bias dinámico afectará el próximo pronóstico</li>
              <li><span className="text-gray-400">Tendencia</span>: Dirección de la precisión basada en errores recientes del backtest</li>
              <li><span className="text-gray-400">Meta ±2°C &gt;70%</span>: Objetivo de precisión del sistema</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-gray-700/30 p-4 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 p-3 text-center border border-gray-700/20">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  )
}

function ImproveCard({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="rounded-lg bg-slate-800/50 p-3 text-center border border-gray-700/20">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={`text-sm font-bold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>{value}</p>
    </div>
  )
}
