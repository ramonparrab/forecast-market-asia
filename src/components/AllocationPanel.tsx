import { BetRecommendation } from '@/types'

interface AllocationPanelProps {
  recommendations: BetRecommendation[]
  totalAllocated: number
}

function StatusBadge({ status, exito_pct }: { status: string; exito_pct?: number }) {
  const color = status === 'EXCELENTE' ? 'text-emerald-400 bg-emerald-500/10' :
    status === 'BUENA' ? 'text-blue-400 bg-blue-500/10' :
    status === 'NEUTRAL' ? 'text-amber-400 bg-amber-500/10' :
    'text-gray-500 bg-gray-500/10'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {status}{exito_pct ? ` · ${exito_pct}% acierto` : ''}
    </span>
  )
}

export default function AllocationPanel({ recommendations, totalAllocated }: AllocationPanelProps) {
  if (recommendations.length === 0) {
    return (
      <div className="card text-center py-8">
        <div className="mb-3 text-5xl">💰</div>
        <p className="text-lg font-medium text-gray-300">No hay apuestas con suficiente calidad hoy</p>
        <p className="mt-2 text-sm text-gray-500 max-w-lg mx-auto">
          Ninguna oportunidad supera los filtros: edge &gt; 6%, consenso fuerte o muy fuerte, y sin riesgo de arbitraje alto.
          El sistema prefiere no apostar a forzar entradas de baja calidad.
        </p>
        <div className="mt-4 flex justify-center gap-4 text-xs text-gray-600">
          <span>🔍 Edge mínimo: 6%</span>
          <span>📊 Consenso: FUERTE+</span>
          <span>⚖️ Kelly 0.25 fraccional</span>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">💰 Distribución de $10</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Basado en Kelly fraccional 0.25 · Solo señales — no se colocan órdenes automáticas
          </p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-bold text-emerald-400">${totalAllocated.toFixed(2)}</span>
          <p className="text-xs text-gray-500">de $10.00 asignados</p>
        </div>
      </div>

      <div className="space-y-3">
        {recommendations.map((r, i) => {
          const pct = Math.max(1, Math.round((r.monto / 10) * 100))
          const isBest = i === 0
          const isSecond = i === 1
          const emoji = isBest ? '🔥' : isSecond ? '⭐' : '💎'
          return (
            <div key={i} className={`rounded-xl p-4 border ${
              isBest ? 'bg-emerald-500/5 border-emerald-500/20' :
              'bg-slate-900/50 border-gray-700/30'
            }`}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{emoji}</span>
                  <div>
                    <span className="font-semibold text-white">{r.ciudad}</span>
                    <span className="ml-2 text-sm text-gray-400">→ {r.contrato}</span>
                  </div>
                </div>
                <span className="text-xl font-bold text-emerald-400">${r.monto.toFixed(2)}</span>
              </div>

              {/* Progress bar */}
              <div className="mb-3 h-2.5 overflow-hidden rounded-full bg-slate-700">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isBest
                      ? 'bg-gradient-to-r from-emerald-500 to-green-400'
                      : 'bg-gradient-to-r from-blue-500 to-emerald-500'
                  }`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>

              {/* Metrics row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-2 text-xs">
                <span>Edge: <span className="text-emerald-400 font-semibold">+{r.edge}%</span></span>
                <span>IA: <span className="text-blue-300">{r.ia_pct}%</span></span>
                <span>Mercado: {r.mkt_pct}%</span>
                <span>Temp: {r.temp_corregida.toFixed(1)}°C</span>
                <span>Consenso: {r.consenso}</span>
                <StatusBadge status={r.status} exito_pct={r.exito_pct} />
              </div>

              {/* Explanation */}
              {r.explicacion && (
                <p className="text-xs text-gray-500 leading-relaxed">{r.explicacion}</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 rounded-xl bg-slate-900/50 p-4">
        <p className="text-xs font-medium text-gray-400 mb-2">📖 Cómo se calculó esto</p>
        <div className="grid gap-2 text-xs text-gray-500 sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <span className="text-emerald-400 mt-0.5">①</span>
            <span><strong className="text-gray-400">6 modelos:</strong> ECMWF, GFS, ICON, JMA, MeteoFrance, best_match → ensemble ponderado</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 mt-0.5">②</span>
            <span><strong className="text-gray-400">Nowcasting:</strong> Observaciones METAR en vivo ajustan el pronóstico durante el día</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-amber-400 mt-0.5">③</span>
            <span><strong className="text-gray-400">Monte Carlo:</strong> 20,000 sims con Student-t ν=4 → probabilidad por bucket</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-purple-400 mt-0.5">④</span>
            <span><strong className="text-gray-400">Kelly 0.25:</strong> Asignación fraccional que maximiza crecimiento a largo plazo</span>
          </div>
        </div>
      </div>
    </div>
  )
}
