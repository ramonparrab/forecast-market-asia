import { BetRecommendation } from '@/types'

interface AllocationPanelProps {
  recommendations: BetRecommendation[]
  totalAllocated: number
}

export default function AllocationPanel({ recommendations, totalAllocated }: AllocationPanelProps) {
  if (recommendations.length === 0) {
    return (
      <div className="card text-center text-gray-500">
        <div className="py-4 text-4xl">💰</div>
        <p className="text-lg font-medium text-gray-400">No hay apuestas con suficiente calidad hoy</p>
        <p className="mt-1 text-sm">Ninguna oportunidad supera los filtros de edge &gt; 6% y consenso fuerte</p>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">💰 Distribución de $10</h2>
        <span className="text-2xl font-bold text-emerald-400">${totalAllocated.toFixed(2)}</span>
      </div>

      <div className="space-y-3">
        {recommendations.map((r, i) => {
          const pct = Math.round((r.monto / 10) * 100)
          return (
            <div key={i} className="rounded-lg bg-slate-900/50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <span className="mr-2 text-lg">{i === 0 ? '🔥' : i === 1 ? '⭐' : '💎'}</span>
                  <span className="font-semibold text-white">{r.ciudad}</span>
                  <span className="ml-2 text-sm text-gray-400">→ {r.contrato}</span>
                </div>
                <span className="text-xl font-bold text-emerald-400">${r.monto.toFixed(2)}</span>
              </div>

              {/* Progress bar */}
              <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>Edge: <span className="text-emerald-400">+{r.edge}%</span></span>
                <span>IA: <span className="text-blue-300">{r.ia_pct}%</span></span>
                <span>Mkt: {r.mkt_pct}%</span>
                <span>Temp: {r.temp_corregida.toFixed(1)}°C</span>
                <span>{r.consenso}</span>
                <span>{r.status}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 rounded-lg bg-slate-900/50 p-3 text-center text-sm text-gray-400">
        Kelly fraccional 0.25 · Cap 10% bankroll · Solo señales — no se colocan órdenes
      </div>
    </div>
  )
}
