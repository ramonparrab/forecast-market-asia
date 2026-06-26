import { GlobalMetrics } from '@/types'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart
} from 'recharts'

interface MetricsChartProps {
  metrics: GlobalMetrics | null
}

function MetricCard({ label, value, unit, color, sub, subColor }: { label: string; value: string; unit: string; color: string; sub?: string; subColor?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}<span className="ml-0.5 text-sm">{unit}</span></div>
      {sub && <div className={`text-[10px] mt-0.5 ${subColor || 'text-gray-500'}`}>{sub}</div>}
    </div>
  )
}

export default function MetricsChart({ metrics }: MetricsChartProps) {
  const live = metrics && metrics.total_muestras > 0 ? metrics : null
  const bt = metrics?.backtest

  const hasLive = !!live
  const hasBacktest = !!bt && bt.total_muestras > 0
  const hasAny = hasLive || hasBacktest

  if (!hasAny) {
    return (
      <div className="card text-center text-gray-500">
        <div className="py-4 text-4xl">📈</div>
        <p className="text-lg font-medium text-gray-400">Métricas de precisión</p>
        <p className="mt-1 text-sm">No hay suficientes datos históricos aún. Ejecuta el backtest desde la pestaña Backtest para generar métricas.</p>
      </div>
    )
  }

  // Build per-city comparison data
  const cityNames = new Set<string>()
  if (hasLive) for (const c of live!.por_ciudad) cityNames.add(c.ciudad)
  if (hasBacktest) for (const c of bt!.por_ciudad) cityNames.add(c.ciudad)

  const cityComparison = Array.from(cityNames).map(name => {
    const l = hasLive ? live!.por_ciudad.find(c => c.ciudad === name) : null
    const b = hasBacktest ? bt!.por_ciudad.find(c => c.ciudad === name) : null
    return {
      ciudad: name,
      live_mae: l?.mae ?? null,
      live_rmse: l?.rmse ?? null,
      live_bias: l?.bias ?? null,
      backtest_mae: b?.mae ?? null,
      backtest_rmse: b?.rmse ?? null,
      backtest_bias: b?.bias ?? null,
      live_muestras: l?.muestras ?? 0,
      backtest_muestras: b?.muestras ?? 0,
    }
  })

  // Build evolution chart (prefer live, fallback to nothing)
  const evolucion = live?.evolucion_diaria ?? []

  return (
    <div className="space-y-6">
      {/* Source badges */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        {hasLive && <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400"></span> Tiempo real ({live!.total_muestras} muestras)</span>}
        {hasBacktest && <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400"></span> Backtest ({bt!.total_muestras} muestras · {bt!.total_dias}d)</span>}
      </div>

      {/* Summary cards — show best available (live preferred) */}

      {/* If both sources exist, show comparison grid */}
      {hasLive && hasBacktest && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Comparativa: Tiempo Real vs Backtest</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard label="MAE" value={live!.overall_mae.toFixed(2)} unit="°C" color="text-emerald-400"
              sub={`Backtest: ${bt!.overall_mae.toFixed(2)}°C`} subColor="text-blue-400" />
            <MetricCard label="RMSE" value={live!.overall_rmse.toFixed(2)} unit="°C" color="text-amber-400"
              sub={`Backtest: ${bt!.overall_rmse.toFixed(2)}°C`} subColor="text-blue-400" />
            <MetricCard label="Bias" value={live!.overall_bias.toFixed(2)} unit="°C" color={Math.abs(live!.overall_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400'}
              sub={`Backtest: ${bt!.overall_bias > 0 ? '+' : ''}${bt!.overall_bias.toFixed(2)}°C`} subColor="text-blue-400" />
            <MetricCard label="±2°C" value={live!.accuracy_pct.toFixed(1)} unit="%" color="text-emerald-400"
              sub={`Backtest: ${bt!.accuracy_2c.toFixed(1)}%`} subColor="text-blue-400" />
          </div>
        </div>
      )}

      {/* Only one source available */}
      {!hasLive && hasBacktest && (
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricCard label="MAE (Backtest)" value={bt!.overall_mae.toFixed(2)} unit="°C" color="text-blue-400" />
          <MetricCard label="RMSE (Backtest)" value={bt!.overall_rmse.toFixed(2)} unit="°C" color="text-amber-400" />
          <MetricCard label="Bias (Backtest)" value={`${bt!.overall_bias > 0 ? '+' : ''}${bt!.overall_bias.toFixed(2)}`} unit="°C" color={Math.abs(bt!.overall_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400'} />
          <MetricCard label="±2°C (Backtest)" value={bt!.accuracy_2c.toFixed(1)} unit="%" color="text-emerald-400" />
        </div>
      )}

      {hasLive && !hasBacktest && (
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricCard label="MAE" value={live!.overall_mae.toFixed(2)} unit="°C" color="text-blue-400" />
          <MetricCard label="RMSE" value={live!.overall_rmse.toFixed(2)} unit="°C" color="text-amber-400" />
          <MetricCard label="Bias" value={`${live!.overall_bias > 0 ? '+' : ''}${live!.overall_bias.toFixed(2)}`} unit="°C" color={Math.abs(live!.overall_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400'} />
          <MetricCard label="±2°C" value={live!.accuracy_pct.toFixed(1)} unit="%" color="text-emerald-400" />
        </div>
      )}

      {/* Per-city comparison chart (when both sources available) */}
      {hasLive && hasBacktest && cityComparison.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">MAE por ciudad: Tiempo Real vs Backtest</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cityComparison}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Legend />
                <Bar dataKey="live_mae" fill="#10b981" name="MAE Tiempo Real" radius={[4, 4, 0, 0]} />
                <Bar dataKey="backtest_mae" fill="#3b82f6" name="MAE Backtest" radius={[4, 4, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-city chart from backtest (when only backtest available) */}
      {!hasLive && hasBacktest && bt!.por_ciudad.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">MAE por ciudad (Backtest)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bt!.por_ciudad.map(c => ({ ciudad: c.ciudad, mae: c.mae }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Bar dataKey="mae" fill="#3b82f6" name="MAE" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-city chart from live (when only live available) — already existed */}
      {hasLive && !hasBacktest && live!.por_ciudad.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Error por ciudad</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={live!.por_ciudad.map(c => ({ ...c, error: c.bias }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#f1f5f9' }} />
                <Bar dataKey="mae" fill="#3b82f6" name="MAE" radius={[4, 4, 0, 0]} />
                <Bar dataKey="rmse" fill="#f59e0b" name="RMSE" radius={[4, 4, 0, 0]} />
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Daily evolution (live only) */}
      {evolucion.length > 1 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Evolución diaria del error (Tiempo Real)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolucion}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#f1f5f9' }} />
                <Line type="monotone" dataKey="mae" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="MAE" />
                <Line type="monotone" dataKey="rmse" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="RMSE" />
                <Legend />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Backtest accuracy distribution */}
      {hasBacktest && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Precisión del Backtest</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{bt!.accuracy_2c.toFixed(1)}%</p>
              <p className="text-xs text-gray-400">Acierto dentro de ±2°C</p>
            </div>
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">{bt!.accuracy_1c.toFixed(1)}%</p>
              <p className="text-xs text-gray-400">Acierto dentro de ±1°C</p>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{bt!.total_muestras}</p>
              <p className="text-xs text-gray-400">Muestras totales ({bt!.total_dias} días × 9 ciudades)</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
