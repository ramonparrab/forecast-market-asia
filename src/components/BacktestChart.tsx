import { useState, useEffect } from 'react'
import { BacktestSummary, BacktestCityMetrics } from '@/lib/backtest-engine'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, Cell, ReferenceLine
} from 'recharts'

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1']

export default function BacktestChart() {
  const [data, setData] = useState<BacktestSummary | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(90)

  useEffect(() => {
    fetch('/api/backtest')
      .then(r => r.json())
      .then(j => { if (j?.data) setData(j.data) })
      .catch(() => {})
  }, [])

  async function runBacktest() {
    setRunning(true)
    setError(null)
    setProgress(0)

    try {
      setProgress(50)
      const resp = await fetch(`/api/backtest?days=${days}`, { method: 'POST', signal: AbortSignal.timeout(30000) })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      if (json.status !== 'ok') throw new Error(json.message || 'Error')

      if (json.data) setData(json.data)

      setProgress(100)

      // Refresh bias corrections
      try {
        const biasResp = await fetch('/api/backtest-bias', { signal: AbortSignal.timeout(8000) })
        if (biasResp.ok) {
          const biasJson = await biasResp.json()
          if (biasJson?.active_corrections) setBiasCorrections(biasJson.active_corrections)
        }
      } catch { /* best effort */ }
    } catch (e: any) {
      setError(e.message || 'Error ejecutando backtest')
    } finally {
      setRunning(false)
    }
  }

  const hasData = data && data.total_muestras > 0

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">📊 Backtesting Histórico</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Compara el pronóstico del ensemble contra la temperatura real observada
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={days}
              onChange={e => setDays(parseInt(e.target.value))}
              disabled={running}
              className="rounded-lg bg-slate-800 border border-gray-700 px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
            >
              <option value={30}>Últimos 30 días</option>
              <option value={60}>Últimos 60 días</option>
              <option value={90}>Últimos 90 días</option>
              <option value={180}>Últimos 180 días</option>
            </select>
            <button
              onClick={runBacktest}
              disabled={running}
              className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
            >
              {running ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                  {days > 30 ? `Procesando (${progress}%)` : 'Procesando...'}
                </>
              ) : (
                <>
                  <span>🚀</span>
                  {hasData ? 'Re-ejecutar' : 'Ejecutar Backtest'}
                </>
              )}
            </button>
          </div>
        </div>
        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
            ⚠️ {error}
          </div>
        )}
        {running && days > 30 && (
          <div className="mt-3">
            <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Procesando {days} días en {Math.ceil(days / CHUNK_SIZE)} bloques de {CHUNK_SIZE} días...
            </p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
          <span>• 6 modelos por ciudad</span>
          <span>• Temperatura real vía Open-Meteo Archive</span>
          <span>• Bias dinámico + sesgo de backtest</span>
        </div>
      </div>

      {running && !hasData && (
        <div className="card text-center py-8">
          <div className="mb-3 text-4xl animate-pulse">⏳</div>
          <p className="text-gray-400">Procesando datos históricos...</p>
        </div>
      )}

      {!hasData && !running && (
        <div className="card text-center py-8 text-gray-500">
          <div className="mb-3 text-5xl">📊</div>
          <p className="text-lg font-medium text-gray-400">Backtesting histórico</p>
          <p className="mt-1 text-sm">Presiona "Ejecutar Backtest" para validar la precisión del modelo.</p>
        </div>
      )}

      {hasData && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="MAE Global" value={`${data.overall_mae}°C`} desc="Error absoluto medio" color="text-blue-400" />
            <SummaryCard label="RMSE Global" value={`${data.overall_rmse}°C`} desc="Raíz del error cuadrático" color="text-amber-400" />
            <SummaryCard label="Acierto ±1°C" value={`${data.overall_accuracy_1c}%`} desc={`${data.total_muestras} muestras`} color="text-emerald-400" />
            <SummaryCard label="Bias" value={`${data.overall_bias > 0 ? '+' : ''}${data.overall_bias}°C`} desc={data.overall_bias > 0 ? 'Sobre-estimación' : 'Sub-estimación'} color={Math.abs(data.overall_bias) < 0.3 ? 'text-emerald-400' : 'text-red-400'} />
          </div>

          <div className="rounded-xl bg-gradient-to-r from-blue-600/10 to-emerald-600/10 border border-blue-500/20 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-gray-300">🏆 <strong className="text-emerald-400">{data.mejores_ciudades.join(', ')}</strong></span>
              <span className="text-gray-500">|</span>
              <span className="text-gray-300">⚠️ <strong className="text-red-400">{data.peores_ciudades.join(', ')}</strong></span>
              <span className="text-gray-500">|</span>
              <span className="text-gray-400">{data.total_muestras} muestras · {data.total_dias}d</span>
            </div>
          </div>

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
                  <ReferenceLine y={1} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: '±1°C', fill: '#f59e0b', fontSize: 10 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.por_ciudad.map(city => (<CityBacktestCard key={city.slug} city={city} />))}
          </div>

          {data.resultados.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-sm font-medium text-gray-400">Evolución del error</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={prepareEvolutionData(data.resultados)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 9 }} tickFormatter={v => v.slice(5)} />
                    <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#f1f5f9' }} />
                    <Legend />
                    <Bar dataKey="mae_diario" fill="#3b82f6" name="MAE diario" radius={[2, 2, 0, 0]} opacity={0.6} />
                    <Line type="monotone" dataKey="mae_7d" stroke="#10b981" strokeWidth={2} dot={false} name="MAE (media 7d)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Bias correction indicator */}
          <div className="rounded-xl bg-gradient-to-r from-amber-600/10 to-red-600/10 border border-amber-500/20 p-4 text-sm">
            <div className="flex items-start gap-3">
              <span className="text-xl">🎯</span>
              <div>
                <p className="text-gray-300 font-medium mb-1">Auto-corrección por backtest activa</p>
                <p className="text-gray-500 text-xs">
                  El modelo se ajusta según el sesgo observado. 
                  {Math.abs(data.overall_bias) >= 0.15
                    ? ` Bias de ${data.overall_bias > 0 ? '+' : ''}${data.overall_bias}°C → ajustando pronóstico.`
                    : ' Bias dentro del rango aceptable (±0.15°C).'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 p-4 text-xs text-gray-500">
            <p className="font-medium text-gray-400 mb-2">📖 Interpretación</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div><strong className="text-gray-400">MAE:</strong> Error absoluto medio en °C.</div>
              <div><strong className="text-gray-400">RMSE:</strong> Penaliza errores grandes. Si RMSE &gt; MAE×1.5 hay outliers.</div>
              <div><strong className="text-gray-400">Acierto ±1°C:</strong> % de días con error &lt; 1°C. Objetivo &gt;60%.</div>
              <div><strong className="text-gray-400">Bias:</strong> Error sistemático. Positivo = sobre-estimamos.</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value, desc, color }: { label: string; value: string; desc: string; color: string }) {
  return (
    <div className="rounded-xl bg-slate-900/50 border border-gray-700/30 p-4 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-600 mt-0.5">{desc}</p>
    </div>
  )
}

function CityBacktestCard({ city }: { city: BacktestCityMetrics }) {
  const accuracyColor = city.accuracy_within_1c >= 70 ? 'text-emerald-400' : city.accuracy_within_1c >= 50 ? 'text-amber-400' : 'text-red-400'
  const maeColor = city.mae <= 1.5 ? 'text-emerald-400' : city.mae <= 2.5 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="rounded-xl bg-slate-900/50 border border-gray-700/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-white">{city.ciudad}</h4>
        <span className={`text-xs font-medium ${maeColor}`}>{city.mae}°C MAE</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-gray-500">RMSE:</span> <span className="text-gray-300">{city.rmse}°C</span></div>
        <div><span className="text-gray-500">Bias:</span> <span className="text-gray-300">{city.bias > 0 ? '+' : ''}{city.bias}°</span></div>
        <div><span className="text-gray-500">±1°C:</span> <span className={accuracyColor}>{city.accuracy_within_1c}%</span></div>
        <div><span className="text-gray-500">Max error:</span> <span className="text-red-400">{city.max_error}°C</span></div>
        <div><span className="text-gray-500">Muestras:</span> <span className="text-gray-400">{city.muestras} días</span></div>
      </div>
    </div>
  )
}

function prepareEvolutionData(resultados: { fecha: string; error: number }[]) {
  const byDate: Record<string, number[]> = {}
  for (const r of resultados) {
    if (!byDate[r.fecha]) byDate[r.fecha] = []
    byDate[r.fecha].push(Math.abs(r.error))
  }
  const entries: { fecha: string; mae_diario: number; mae_7d?: number }[] = Object.entries(byDate)
    .map(([fecha, errors]) => ({
      fecha,
      mae_diario: Math.round(errors.reduce((s, v) => s + v, 0) / errors.length * 100) / 100,
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
  for (let i = 0; i < entries.length; i++) {
    const window = entries.slice(Math.max(0, i - 6), i + 1)
    entries[i].mae_7d = Math.round(window.reduce((s, w) => s + w.mae_diario, 0) / window.length * 100) / 100
  }
  return entries
}
