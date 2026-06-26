import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'

interface ForecastRecord {
  fecha: string
  temp_pronosticada: number
  temp_corregida: number
  temp_real: number
  error: number
}

export default function ComparisonPanel() {
  const [selectedSlug, setSelectedSlug] = useState(CIUDADES_ASIA[0].slug)
  const [records, setRecords] = useState<ForecastRecord[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadCity(selectedSlug)
  }, [selectedSlug])

  async function loadCity(slug: string) {
    setLoading(true)
    try {
      const resp = await fetch(`/api/metrics/comparison?slug=${slug}&limit=90`)
      if (resp.ok) {
        const json = await resp.json()
        setRecords(json.records || [])
      }
    } catch { /* silent */ }
    setLoading(false)
  }

  const selectedCity = CIUDADES_ASIA.find(c => c.slug === selectedSlug)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="card">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">🌡️ Comparación Pronóstico vs Real</h2>
            <p className="mt-1 text-xs text-gray-500">
              Temperatura pronosticada (10 PM Caracas) vs temperatura real de cierre por ciudad
            </p>
          </div>
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
          <div className="py-8 text-center text-gray-500">Cargando datos...</div>
        )}

        {!loading && records.length === 0 && (
          <div className="py-8 text-center text-gray-500">
            <div className="mb-2 text-4xl">🌤️</div>
            <p>No hay datos de comparación para {selectedCity?.nombre}</p>
            <p className="mt-1 text-xs">Los datos aparecerán después de ejecutar análisis diarios con temperatura real registrada</p>
          </div>
        )}

        {records.length > 0 && (
          <>
            {/* Summary stats */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Error Promedio"
                value={`${records.reduce((s, r) => s + r.error, 0) / records.length > 0 ? '+' : ''}${(records.reduce((s, r) => s + r.error, 0) / records.length).toFixed(2)}°C`}
                color={(records.reduce((s, r) => s + r.error, 0) / records.length) < 1 ? 'text-emerald-400' : 'text-amber-400'}
              />
              <StatCard
                label="MAE"
                value={`${(records.map(r => Math.abs(r.error)).reduce((s, v) => s + v, 0) / records.length).toFixed(2)}°C`}
                color="text-blue-400"
              />
              <StatCard
                label="Total registros"
                value={String(records.length)}
                color="text-purple-400"
              />
              <StatCard
                label="Aciertos ±2°C"
                value={`${(records.filter(r => Math.abs(r.error) <= 2).length / records.length * 100).toFixed(0)}%`}
                color="text-emerald-400"
              />
            </div>

            {/* Forecast vs Actual chart */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-400">
                Pronóstico vs Real · {selectedCity?.nombre}
              </h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={records}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="fecha"
                      stroke="#64748b"
                      tick={{ fontSize: 9 }}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fontSize: 10 }}
                      label={{ value: '°C', angle: -90, position: 'insideLeft', style: { fill: '#64748b', fontSize: 12 } }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#f1f5f9' }}
                      formatter={(value: number) => [`${value.toFixed(1)}°C`]}
                    />
                    <Line
                      type="monotone"
                      dataKey="temp_corregida"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Pronóstico (corregido)"
                    />
                    <Line
                      type="monotone"
                      dataKey="temp_pronosticada"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      dot={{ r: 2 }}
                      name="Pronóstico (crudo)"
                    />
                    <Line
                      type="monotone"
                      dataKey="temp_real"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Temp Real"
                    />
                    <Legend />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Error chart */}
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium text-gray-400">Error del pronóstico por fecha</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={records}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="fecha"
                      stroke="#64748b"
                      tick={{ fontSize: 9 }}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                      labelStyle={{ color: '#f1f5f9' }}
                      formatter={(value: number) => [`${value.toFixed(2)}°C`]}
                    />
                    <Line
                      type="monotone"
                      dataKey="error"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      name="Error (°C)"
                    />
                    <Legend />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="card">
        <div className="rounded-lg bg-slate-900/30 p-3 text-xs text-gray-500">
          <p className="mb-1 font-medium text-gray-400">📖 Leyenda — Comparación</p>
          <ul className="space-y-1">
            <li><span className="text-blue-400">Pronóstico corregido</span>: Temperatura del ensemble con bias dinámico aplicado a las 10 PM Caracas</li>
            <li><span className="text-gray-400">Pronóstico crudo</span>: Temperatura del ensemble sin corrección de bias</li>
            <li><span className="text-emerald-400">Temp Real</span>: Temperatura máxima real registrada para esa fecha</li>
            <li><span className="text-amber-400">Error</span>: Diferencia entre temp corregida y temp real (positivo = sobrestimación)</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}
