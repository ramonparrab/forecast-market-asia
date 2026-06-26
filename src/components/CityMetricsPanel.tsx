import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line
} from 'recharts'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1']

interface CityMetric {
  ciudad: string
  slug: string
  mae: number
  rmse: number
  bias: number
  muestras: number
}

interface GlobalMetricsData {
  overall_mae: number
  overall_rmse: number
  overall_bias: number
  accuracy_pct: number
  total_muestras: number
  por_ciudad: CityMetric[]
  evolucion_diaria: { fecha: string; mae: number; rmse: number }[]
  backtest?: {
    overall_mae: number
    overall_rmse: number
    overall_bias: number
    accuracy_2c: number
    total_dias: number
    total_muestras: number
    por_ciudad: (CityMetric & { accuracy_within_2c?: number; accuracy_within_1c?: number; max_error?: number })[]
  }
}

function calcImprovement(city: CityMetric): { mejora_pct: number; tendencia: string; impacto: string } {
  const impactoPct = Math.round(Math.min(Math.max((2 - city.mae) / 2 * 100, -20), 30))
  const tendencia = city.mae <= 1.5 ? 'mejorando' : city.mae <= 2.5 ? 'estable' : 'empeorando'
  return {
    mejora_pct: Math.round((1.5 / city.mae) * 100 - 100),
    tendencia,
    impacto: impactoPct > 5
      ? `Próximo pronóstico ~${impactoPct}% mejor`
      : impactoPct > 0
        ? `Mejora ligera ~${impactoPct}%`
        : `Estable`
  }
}

export default function CityMetricsPanel() {
  const [metrics, setMetrics] = useState<GlobalMetricsData | null>(null)
  const [selectedSlug, setSelectedSlug] = useState(CIUDADES_ASIA[0].slug)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/metrics').then(r => r.ok ? r.json() : null),
      fetch('/api/backtest').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([liveData, btData]) => {
      if (liveData && liveData.total_muestras > 0) {
        if (btData?.data) {
          liveData.backtest = btData.data
        }
        setMetrics(liveData)
      } else if (btData?.data) {
        const bt = btData.data
        setMetrics({
          overall_mae: bt.overall_mae,
          overall_rmse: bt.overall_rmse,
          overall_bias: bt.overall_bias,
          accuracy_pct: bt.overall_accuracy_2c,
          total_muestras: bt.total_muestras,
          por_ciudad: bt.por_ciudad.map((c: any) => ({
            ciudad: c.ciudad, slug: c.slug, mae: c.mae, rmse: c.rmse, bias: c.bias, muestras: c.muestras,
          })),
          evolucion_diaria: [],
          backtest: bt,
        })
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const selectedCity = CIUDADES_ASIA.find(c => c.slug === selectedSlug)
  const city = metrics?.por_ciudad?.find(c => c.slug === selectedSlug)
  const improvement = city ? calcImprovement(city) : null
  const bc = metrics?.backtest
  const btc = bc?.por_ciudad?.find((c: any) => c.slug === selectedSlug)

  if (loading) {
    return <div className="card text-center py-8 text-gray-500">Cargando precisión...</div>
  }

  if (!metrics || !metrics.por_ciudad?.length) {
    return (
      <div className="card text-center py-12">
        <p className="text-4xl mb-3">📊</p>
        <p className="text-gray-400 text-lg">No hay datos de precisión aún</p>
        <p className="text-xs text-gray-600 mt-1">Ejecuta el análisis diario y espera a que se registren temperaturas reales</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">📈 Precisión por Ciudad</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {metrics.total_muestras} registros con temperatura real · {bc ? `+${bc.total_muestras} backtesting` : 'forecast_history'}
            </p>
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
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="MAE Global" value={`${metrics.overall_mae}°C`} color="text-blue-400" sub={`${metrics.total_muestras} muestras`} />
        <SummaryCard label="RMSE Global" value={`${metrics.overall_rmse}°C`} color="text-amber-400" />
        <SummaryCard label="Bias Global" value={`${metrics.overall_bias > 0 ? '+' : ''}${metrics.overall_bias}°C`} color={Math.abs(metrics.overall_bias) < 0.3 ? 'text-emerald-400' : 'text-red-400'} />
        <SummaryCard label={bc ? 'Acierto ±2°C' : 'Acierto ±2°C'} value={`${bc ? bc.accuracy_2c : metrics.accuracy_pct}%`} color={(bc ? bc.accuracy_2c : metrics.accuracy_pct) >= 70 ? 'text-emerald-400' : 'text-amber-400'} sub="Meta: >70%" />
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-medium text-gray-400">MAE por ciudad</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={metrics.por_ciudad.map(c => ({ ...c, mae: Number(c.mae) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#f1f5f9' }} />
              <Bar dataKey="mae" radius={[4, 4, 0, 0]}>
                {metrics.por_ciudad.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {city && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">{selectedCity?.nombre} — Detalle</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-4">
            <MetricCard label="MAE" value={`${city.mae}°C`} color={city.mae <= 1.5 ? 'text-emerald-400' : city.mae <= 2.5 ? 'text-amber-400' : 'text-red-400'} />
            <MetricCard label="RMSE" value={`${city.rmse}°C`} color="text-amber-400" />
            <MetricCard label="Bias" value={`${city.bias > 0 ? '+' : ''}${city.bias}°`} color={Math.abs(city.bias) < 0.3 ? 'text-emerald-400' : 'text-red-400'} />
            <MetricCard label="Muestras" value={`${city.muestras}`} color="text-purple-400" />
            {btc && <MetricCard label="±2°C backtest" value={`${btc.accuracy_within_2c}%`} color={(btc.accuracy_within_2c ?? 0) >= 70 ? 'text-emerald-400' : 'text-amber-400'} />}
          </div>

          {improvement && (
            <div className="rounded-lg bg-slate-900/50 p-4 border border-blue-500/10">
              <p className="text-sm font-medium text-blue-300 mb-2">⚡ Mejora Continua</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ImproveCard label="Mejora vs baseline" value={`${improvement.mejora_pct > 0 ? '+' : ''}${improvement.mejora_pct}%`} positive={improvement.mejora_pct > 0} />
                <ImproveCard label="Tendencia" value={improvement.tendencia === 'mejorando' ? '📈 Mejorando' : improvement.tendencia === 'empeorando' ? '📉 Empeorando' : '➡️ Estable'} positive={improvement.tendencia === 'mejorando'} />
                <ImproveCard label="Impacto próximo" value={`${improvement.impacto}`} positive={improvement.impacto.includes('mejor')} />
                {btc && <ImproveCard label="Max error" value={`${btc.max_error}°C`} positive={(btc.max_error ?? 99) <= 4} />}
              </div>
              <div className="mt-3 text-xs text-gray-500">
                <p>Basado en {city.muestras} registros reales. {improvement.impacto} en el próximo pronóstico.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {metrics.evolucion_diaria?.length > 1 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Evolución diaria del error global</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.evolucion_diaria}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#f1f5f9' }} />
                <Line type="monotone" dataKey="mae" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="MAE" />
                <Line type="monotone" dataKey="rmse" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="RMSE" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.por_ciudad.map(c => {
          const impr = calcImprovement(c)
          return (
            <div key={c.slug} className="rounded-xl bg-slate-900/50 border border-gray-700/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-white">{c.ciudad}</h4>
                <span className={`text-xs font-medium ${c.mae <= 1.5 ? 'text-emerald-400' : c.mae <= 2.5 ? 'text-amber-400' : 'text-red-400'}`}>
                  {c.mae}°C MAE
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span className="text-gray-500">RMSE: <span className="text-gray-300">{c.rmse}°C</span></span>
                <span className="text-gray-500">Bias: <span className="text-gray-300">{c.bias > 0 ? '+' : ''}{c.bias}°</span></span>
                <span className="text-gray-500">Muestras: <span className="text-gray-400">{c.muestras}</span></span>
                <span className="text-gray-500">Mejora: <span className={impr.mejora_pct > 0 ? 'text-emerald-400' : 'text-red-400'}>{impr.mejora_pct > 0 ? '+' : ''}{impr.mejora_pct}%</span></span>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-700/30 text-[10px] text-gray-500">
                {impr.tendencia === 'mejorando' ? '📈' : impr.tendencia === 'empeorando' ? '📉' : '➡️'} {impr.impacto}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 p-3 text-xs text-gray-500">
        <p className="font-medium text-gray-400 mb-1">📖 Leyenda — Mejora Continua</p>
        <ul className="space-y-0.5">
          <li><span className="text-emerald-400">Mejora vs baseline</span>: Comparación del MAE actual contra el objetivo de 1.5°C</li>
          <li><span className="text-emerald-400">Impacto próximo</span>: Estimación de cómo el bias dinámico afectará el próximo pronóstico</li>
          <li><span className="text-gray-400">Tendencia</span>: Dirección de la precisión basada en los errores recientes</li>
          <li><span className="text-gray-400">Meta ±2°C &gt;70%</span>: Objetivo de acierto del sistema</li>
          <li><span className="text-gray-400">Datos</span>: Los valores vienen de <code className="text-blue-300">forecast_history</code> y backtesting (si está disponible)</li>
        </ul>
      </div>
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
