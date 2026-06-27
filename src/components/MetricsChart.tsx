import { useState, useEffect } from 'react'
import { GlobalMetrics } from '@/types'
import { CIUDADES_ASIA } from '@/lib/cities'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'

interface MetricsChartProps {
  metrics: GlobalMetrics | null
}

function CityMetricRow({ ciudad, mae, rmse, bias, muestras, fuente }: {
  ciudad: string; mae: string; rmse: string; bias: string; muestras: number; fuente: string
}) {
  return (
    <tr className="border-t border-gray-700/30 hover:bg-slate-800/50">
      <td className="p-2 text-gray-300 font-medium">{ciudad}</td>
      <td className="p-2 text-blue-400 font-mono">{mae}</td>
      <td className="p-2 text-amber-400 font-mono">{rmse}</td>
      <td className={`p-2 font-mono ${Math.abs(parseFloat(bias)) < 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>{bias}</td>
      <td className="p-2 text-gray-500 text-xs">{muestras}</td>
      <td className="p-2 text-[10px] text-gray-500">{fuente}</td>
    </tr>
  )
}

export default function MetricsChart({ metrics }: MetricsChartProps) {
  const [btData, setBtData] = useState<any>(null)
  const [btLoading, setBtLoading] = useState(false)
  const [btError, setBtError] = useState<string | null>(null)
  const [biasCorrections, setBiasCorrections] = useState<Record<string, number>>({})
  const [bcLoading, setBcLoading] = useState(false)

  const live = metrics?.total_muestras ? metrics : null

  // Load backtest data on mount
  useEffect(() => {
    fetchBacktestData()
    fetchBiasCorrections()
  }, [])

  async function fetchBacktestData() {
    try {
      const resp = await fetch('/api/backtest', { signal: AbortSignal.timeout(10000) })
      if (resp.ok) {
        const json = await resp.json()
        if (json?.data) setBtData(json.data)
      }
    } catch { /* silent */ }
  }

  async function fetchBiasCorrections() {
    setBcLoading(true)
    try {
      const resp = await fetch('/api/backtest-bias', { signal: AbortSignal.timeout(8000) })
      if (resp.ok) {
        const json = await resp.json()
        if (json?.active_corrections) setBiasCorrections(json.active_corrections)
      }
    } catch { /* silent */ }
    setBcLoading(false)
  }

  async function run30dBacktest() {
    setBtLoading(true)
    setBtError(null)
    try {
      const resp = await fetch('/api/backtest?days=30', { method: 'POST', signal: AbortSignal.timeout(60000) })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      if (json?.data) setBtData(json.data)
      await fetchBiasCorrections()
    } catch (e: any) {
      setBtError(e.message || 'Error')
    } finally {
      setBtLoading(false)
    }
  }

  const bt = btData?.overall_mae != null ? btData : null
  const hasBt = bt && bt.total_muestras > 0
  const hasLive = !!live

  // Build ALL city names from both sources
  const cityNames = new Set<string>()
  if (hasLive) for (const c of live.por_ciudad) cityNames.add(c.ciudad)
  if (hasBt) for (const c of bt.por_ciudad) cityNames.add(c.ciudad)

  const sortedCities = Array.from(cityNames).sort()

  // City name → slug mapping
  const nameToSlug: Record<string, string> = {}
  for (const c of CIUDADES_ASIA) { nameToSlug[c.nombre] = c.slug }

  // Per-city table data
  const cityRows = sortedCities.map(name => {
    const l = hasLive ? live.por_ciudad.find(c => c.ciudad === name) : null
    const b = hasBt ? bt.por_ciudad.find((c: any) => c.ciudad === name) : null
    const slug = nameToSlug[name] || name.toLowerCase().replace(/\s+/g, '-')
    const correction = biasCorrections[slug]
    return {
      ciudad: name,
      live_mae: l?.mae, live_rmse: l?.rmse, live_bias: l?.bias, live_n: l?.muestras ?? 0,
      bt_mae: b?.mae, bt_rmse: b?.rmse, bt_bias: b?.bias, bt_n: b?.muestras ?? 0,
      correction,
    }
  })

  const showTable = cityRows.length > 0

  // Bar chart data (prefer live, fallback to backtest)
  const barData = cityRows.map(r => ({
    ciudad: r.ciudad,
    MAE: r.live_mae ?? r.bt_mae ?? 0,
    fuente: r.live_mae != null ? 'Live' : 'Backtest',
  }))

  // Bias corrections chart
  const biasBarData = cityRows
    .filter(r => r.correction != null)
    .map(r => ({ ciudad: r.ciudad, correccion: r.correction }))

  return (
    <div className="space-y-6">
      {/* Action: Run Backtest */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">📈 Precisión por Ciudad</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {hasLive
                ? `${live.total_muestras} registros en vivo · ${hasBt ? `${bt.total_muestras} de backtest` : 'backtest disponible bajo demanda'}`
                : hasBt
                  ? `${bt.total_muestras} registros de backtest (${bt.total_dias} días)`
                  : 'Ejecuta backtest para generar métricas históricas'}
            </p>
          </div>
          <button
            onClick={run30dBacktest}
            disabled={btLoading}
            className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
          >
            {btLoading ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                Ejecutando...
              </>
            ) : (
              <>
                <span>⏳</span>
                Backtest 30d
              </>
            )}
          </button>
        </div>
        {btError && (
          <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">⚠️ {btError}</div>
        )}
        {btLoading && (
          <div className="mt-3 h-1 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full bg-blue-500 animate-pulse w-3/4" />
          </div>
        )}
      </div>

      {/* Bias corrections */}
      {biasBarData.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">
            🔧 Correcciones activas por ciudad {bcLoading && <span className="text-blue-400 animate-pulse">cargando...</span>}
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Ajuste aplicado automáticamente al pronóstico de cada ciudad basado en el error histórico (backtest). Corrección positiva = el modelo subestima, se suma temperatura.
          </p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={biasBarData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number) => [`${value > 0 ? '+' : ''}${value.toFixed(2)}°C`, 'Corrección']}
                />
                <Bar dataKey="correccion" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Corrección °C" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Live vs Backtest summary (when both available) */}
      {hasLive && hasBt && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Comparativa global: Live vs Backtest</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryCard label="MAE Live" value={`${live.overall_mae.toFixed(2)}°`} sub={`Backtest: ${bt.overall_mae.toFixed(2)}°`} color="text-emerald-400" />
            <SummaryCard label="RMSE Live" value={`${live.overall_rmse.toFixed(2)}°`} sub={`Backtest: ${bt.overall_rmse.toFixed(2)}°`} color="text-amber-400" />
            <SummaryCard label="Bias Live" value={`${live.overall_bias > 0 ? '+' : ''}${live.overall_bias.toFixed(2)}°`} sub={`Backtest: ${bt.overall_bias > 0 ? '+' : ''}${bt.overall_bias.toFixed(2)}°`} color={Math.abs(live.overall_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400'} />
            <SummaryCard label="±2°C Live" value={`${live.accuracy_pct.toFixed(1)}%`} sub={`Backtest: ${bt.overall_accuracy_2c.toFixed(1)}%`} color="text-emerald-400" />
          </div>
        </div>
      )}

      {/* Only backtest summary */}
      {!hasLive && hasBt && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Métricas de Backtest ({bt.total_dias} días)</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryCard label="MAE" value={`${bt.overall_mae.toFixed(2)}°`} sub={`${bt.total_muestras} muestras`} color="text-blue-400" />
            <SummaryCard label="RMSE" value={`${bt.overall_rmse.toFixed(2)}°`} sub="" color="text-amber-400" />
            <SummaryCard label="Bias" value={`${bt.overall_bias > 0 ? '+' : ''}${bt.overall_bias.toFixed(2)}°`} sub={bt.overall_bias > 0 ? 'Sobre-est.' : 'Sub-est.'} color={Math.abs(bt.overall_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400'} />
            <SummaryCard label="±2°C" value={`${bt.overall_accuracy_2c.toFixed(1)}%`} sub={`±1°C: ${bt.overall_accuracy_1c.toFixed(1)}%`} color="text-emerald-400" />
          </div>
        </div>
      )}

      {/* Only live summary */}
      {hasLive && !hasBt && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Métricas en Tiempo Real ({live.total_muestras} muestras)</h3>
          <div className="grid gap-3 sm:grid-cols-4">
            <SummaryCard label="MAE" value={`${live.overall_mae.toFixed(2)}°`} sub="Error absoluto medio" color="text-emerald-400" />
            <SummaryCard label="RMSE" value={`${live.overall_rmse.toFixed(2)}°`} sub="Raíz error cuadrático" color="text-amber-400" />
            <SummaryCard label="Bias" value={`${live.overall_bias > 0 ? '+' : ''}${live.overall_bias.toFixed(2)}°`} sub={live.overall_bias > 0 ? 'Sobre-est.' : 'Sub-est.'} color={Math.abs(live.overall_bias) < 0.5 ? 'text-emerald-400' : 'text-red-400'} />
            <SummaryCard label="±2°C" value={`${live.accuracy_pct.toFixed(1)}%`} sub={`${live.total_muestras} muestras`} color="text-emerald-400" />
          </div>
        </div>
      )}

      {/* No data banner */}
      {!hasLive && !hasBt && (
        <div className="card">
          <p className="text-gray-500 text-sm text-center py-4">
            No hay datos aún. Presiona <strong className="text-blue-400">"Backtest 30d"</strong> para generar métricas históricas simuladas,
            o ejecuta el análisis diario desde el dashboard para acumular datos reales.
          </p>
        </div>
      )}

      {/* Bar chart: MAE per city */}
      {showTable && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">MAE por ciudad</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  labelStyle={{ color: '#f1f5f9' }}
                  formatter={(value: number) => [`${value.toFixed(2)}°C`, 'MAE']}
                />
                <Bar dataKey="MAE" fill="#3b82f6" radius={[4, 4, 0, 0]} name="MAE °C" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Per-city detailed table */}
      {showTable && (
        <div className="card">
          <h3 className="mb-3 text-sm font-medium text-gray-400">Detalle por ciudad</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-gray-400">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-700/30">
                  <th className="p-2 font-medium">Ciudad</th>
                  <th className="p-2 font-medium">MAE</th>
                  <th className="p-2 font-medium">RMSE</th>
                  <th className="p-2 font-medium">Bias</th>
                  <th className="p-2 font-medium">Muestras</th>
                  <th className="p-2 font-medium">Fuente</th>
                  {biasBarData.length > 0 && <th className="p-2 font-medium text-amber-400">Corrección</th>}
                </tr>
              </thead>
              <tbody>
                {cityRows.map(r => {
                  const mae = r.live_mae ?? r.bt_mae
                  const rmse = r.live_rmse ?? r.bt_rmse
                  const bias = r.live_bias ?? r.bt_bias
                  const n = r.live_n || r.bt_n
                  const fuente = r.live_mae != null ? '🟢 Live' : '🔵 BT'
                  return (
                    <CityMetricRow
                      key={r.ciudad}
                      ciudad={r.ciudad}
                      mae={mae != null ? mae.toFixed(2) + '°' : '—'}
                      rmse={rmse != null ? rmse.toFixed(2) + '°' : '—'}
                      bias={bias != null ? `${bias > 0 ? '+' : ''}${bias.toFixed(2)}°` : '—'}
                      muestras={n}
                      fuente={fuente}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>
          {hasBt && !hasLive && (
            <p className="mt-3 text-[10px] text-gray-600">
              🔵 BT = Backtest. Datos generados mediante simulación histórica de 30 días con 6 modelos meteorológicos.
              Correcciones activas se aplican automáticamente al próximo pronóstico.
            </p>
          )}
          {hasLive && (
            <p className="mt-3 text-[10px] text-gray-600">
              🟢 Live = Temperatura real registrada después del pronóstico. Fuente: Open-Meteo Archive API.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 p-3 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}
