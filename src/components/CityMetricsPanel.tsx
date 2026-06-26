import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'
import { AccuracyMetrics, CityImprovement } from '@/types'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts'

interface CityMetricsData {
  metrics: AccuracyMetrics | null
  improvement: CityImprovement | null
  evolucion: { fecha: string; mae: number; rmse: number }[]
}

export default function CityMetricsPanel() {
  const [selectedSlug, setSelectedSlug] = useState(CIUDADES_ASIA[0].slug)
  const [data, setData] = useState<CityMetricsData | null>(null)
  const [allCities, setAllCities] = useState<{ slug: string; metrics: AccuracyMetrics | null }[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadCity(selectedSlug)
    loadAll()
  }, [])

  useEffect(() => {
    loadCity(selectedSlug)
  }, [selectedSlug])

  async function loadCity(slug: string) {
    setLoading(true)
    try {
      const resp = await fetch(`/api/metrics/city?slug=${slug}`)
      if (resp.ok) {
        const json = await resp.json()
        setData(json)
      }
    } catch { /* silent */ }
    setLoading(false)
  }

  async function loadAll() {
    try {
      const resp = await fetch('/api/metrics/city')
      if (resp.ok) {
        const json = await resp.json()
        if (json.cities) {
          setAllCities(json.cities.map((c: any) => ({
            slug: c.slug,
            metrics: c.metrics,
          })))
        }
      }
    } catch { /* silent */ }
  }

  const selectedCity = CIUDADES_ASIA.find(c => c.slug === selectedSlug)
  const cityData = data

  return (
    <div className="card">
      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-white">📈 Precisión por Ciudad</h2>
        <select
          value={selectedSlug}
          onChange={(e) => setSelectedSlug(e.target.value)}
          className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white border border-slate-600 focus:border-blue-500 focus:outline-none"
        >
          {CIUDADES_ASIA.map(c => (
            <option key={c.slug} value={c.slug}>{c.nombre}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="py-8 text-center text-gray-500">Cargando métricas...</div>
      )}

      {!loading && !cityData?.metrics && (
        <div className="py-8 text-center text-gray-500">
          <div className="mb-2 text-4xl">📊</div>
          <p>No hay suficientes datos históricos para {selectedCity?.nombre}</p>
          <p className="mt-1 text-xs">Se necesitan al menos 2 registros con temperatura real</p>
        </div>
      )}

      {cityData?.metrics && (
        <>
          {/* Metric cards */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="MAE" value={cityData.metrics.mae.toFixed(2)} unit="°C" color="text-blue-400" />
            <MetricCard label="RMSE" value={cityData.metrics.rmse.toFixed(2)} unit="°C" color="text-amber-400" />
            <MetricCard
              label="Bias"
              value={cityData.metrics.bias.toFixed(2)}
              unit="°C"
              color={Math.abs(cityData.metrics.bias) < 0.5 ? 'text-emerald-400' : 'text-red-400'}
            />
            <MetricCard label="Muestras" value={String(cityData.metrics.muestras)} unit="" color="text-purple-400" />
          </div>

          {/* Improvement section */}
          {cityData.improvement && (
            <div className="mb-4 rounded-lg bg-slate-900/50 p-4">
              <h3 className="mb-3 text-sm font-medium text-gray-400">📉 Mejora Continua</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ImprovementCard
                  label="Mejora MAE"
                  value={`${cityData.improvement.mejora_mae_pct > 0 ? '+' : ''}${cityData.improvement.mejora_mae_pct.toFixed(1)}%`}
                  positive={cityData.improvement.mejora_mae_pct > 0}
                />
                <ImprovementCard
                  label="Precisión ±2°C"
                  value={`${cityData.improvement.accuracy_pct.toFixed(1)}%`}
                  positive={cityData.improvement.accuracy_pct > 70}
                />
                <ImprovementCard
                  label="Tendencia"
                  value={cityData.improvement.tendencia === 'mejorando' ? '📈 Mejorando' : cityData.improvement.tendencia === 'empeorando' ? '📉 Empeorando' : '➡️ Estable'}
                  positive={cityData.improvement.tendencia === 'mejorando'}
                />
                <ImprovementCard
                  label="Impacto próximo"
                  value={`${cityData.improvement.impacto_proximo_pct > 0 ? '+' : ''}${cityData.improvement.impacto_proximo_pct.toFixed(1)}%`}
                  positive={cityData.improvement.impacto_proximo_pct > 0}
                />
              </div>
              <div className="mt-3 text-xs text-gray-500">
                <p>{cityData.improvement.descripcion_impacto}</p>
                <p className="mt-1 text-gray-600">{cityData.improvement.ultima_mejora_desc} · {cityData.improvement.ultima_mejora_fecha}</p>
              </div>
            </div>
          )}

          {/* Daily evolution chart */}
          {cityData.evolucion.length > 1 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-gray-400">Evolución diaria del error</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cityData.evolucion}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#f1f5f9' }}
                    />
                    <Line type="monotone" dataKey="mae" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="MAE" />
                    <Line type="monotone" dataKey="rmse" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="RMSE" />
                    <Legend />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Comparing with other cities */}
          {allCities.length > 1 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-400">Comparación entre ciudades</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={allCities.map(c => ({
                    ciudad: CIUDADES_ASIA.find(city => city.slug === c.slug)?.nombre || c.slug,
                    mae: c.metrics?.mae ?? 0,
                    rmse: c.metrics?.rmse ?? 0,
                  })).filter(d => d.mae > 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={60} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#f1f5f9' }}
                    />
                    <Bar dataKey="mae" fill="#3b82f6" name="MAE" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="rmse" fill="#f59e0b" name="RMSE" radius={[4, 4, 0, 0]} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="mt-4 rounded-lg bg-slate-900/30 p-3 text-xs text-gray-500">
            <p className="mb-1 font-medium text-gray-400">📖 Mejora Continua — Leyenda</p>
            <ul className="space-y-1">
              <li><span className="text-emerald-400">Mejora MAE</span>: Reducción del error medio absoluto entre período anterior y reciente</li>
              <li><span className="text-emerald-400">Impacto próximo</span>: Estimación de cómo los bias dinámicos y pesos adaptativos mejorarán el próximo pronóstico</li>
              <li><span className="text-gray-400">Tendencia</span>: Dirección de la precisión basada en los últimos registros vs históricos</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}{unit && <span className="ml-0.5 text-sm">{unit}</span>}</div>
    </div>
  )
}

function ImprovementCard({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className="rounded-lg bg-slate-800/50 p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${positive ? 'text-emerald-400' : 'text-red-400'}`}>{value}</div>
    </div>
  )
}
