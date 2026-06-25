interface ArbitragePanelProps {
  alerts: string[]
  citiesCount: number
}

export default function ArbitragePanel({ alerts, citiesCount }: ArbitragePanelProps) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">🔍 Arbitraje Polymarket</h2>
        <span className="text-xs text-gray-500">{citiesCount} ciudades escaneadas</span>
      </div>

      <div className="mb-3 text-xs text-gray-400">
        Escaneo de particiones completas. Si Σ YES {'<'} 1 compra YES en todos; si Σ NO {'<'} N−1 compra NO en todos.
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-lg bg-emerald-500/10 p-3 text-center text-sm text-emerald-400">
          ✅ Sin alertas de arbitraje significativas
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <div key={i} className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-400">
              ⚠️ {alert}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
        <span>• Forecast: Open-Meteo horario → máximo real del día</span>
        <span>• Polymarket: Gamma API, precio mid no-vig</span>
        <span>• 20,000 sims Monte Carlo</span>
      </div>
    </div>
  )
}
