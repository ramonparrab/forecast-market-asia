import { GlobalMetrics } from '@/types'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts'

interface MetricsChartProps {
  metrics: GlobalMetrics | null
}

export default function MetricsChart({ metrics }: MetricsChartProps) {
  if (!metrics || metrics.total_muestras < 3) {
    return (
      <div className="card text-center text-gray-500">
        <div className="py-4 text-4xl">📈</div>
        <p className="text-lg font-medium text-gray-400">Métricas de precisión</p>
        <p className="mt-1 text-sm">No hay suficientes datos históricos aún. Se necesitan al menos 3 muestras.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <h2 className="mb-4 text-lg font-semibold text-white">📈 Precisión · {metrics.total_muestras} muestras</h2>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="MAE" value={metrics.overall_mae.toFixed(2)} unit="°C" color="text-blue-400" />
        <MetricCard label="RMSE" value={metrics.overall_rmse.toFixed(2)} unit="°C" color="text-amber-400" />
        <MetricCard label="Bias" value={metrics.overall_bias.toFixed(2)} unit="°C" color={Math.abs(metrics.overall_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400'} />
        <MetricCard label="±2°C" value={metrics.accuracy_pct.toFixed(1)} unit="%" color="text-emerald-400" />
      </div>

      {/* Daily evolution chart */}
      {metrics.evolucion_diaria.length > 1 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-gray-400">Evolución diaria del error</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics.evolucion_diaria}>
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

      {/* Per city chart */}
      {metrics.por_ciudad.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-400">Error por ciudad</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.por_ciudad.map(c => ({ ...c, error: c.bias }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
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
    </div>
  )
}

function MetricCard({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}<span className="ml-0.5 text-sm">{unit}</span></div>
    </div>
  )
}
