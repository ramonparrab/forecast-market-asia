import { CityAnalysis, PolymarketContract } from '@/types'

interface CityCardProps {
  data: CityAnalysis
}

function ConsensoBadge({ consenso }: { consenso: string }) {
  if (consenso === 'MUY FUERTE') return <span className="badge-green">{consenso}</span>
  if (consenso === 'FUERTE') return <span className="badge-blue">{consenso}</span>
  if (consenso === 'ACEPTABLE') return <span className="badge-yellow">{consenso}</span>
  return <span className="badge-red">{consenso}</span>
}

function ArbBadge({ nivel }: { nivel: string }) {
  if (nivel.includes('ALTO')) return <span className="badge-red">{nivel}</span>
  if (nivel.includes('MEDIO')) return <span className="badge-yellow">{nivel}</span>
  return <span className="badge-green">{nivel}</span>
}

function ContractRow({ contract }: { contract: PolymarketContract }) {
  const probIAPct = Math.round((contract.prob_ia_norm ?? 0) * 10000) / 100
  const edge = Math.round((probIAPct - contract.prob_mkt) * 100) / 100

  let edgeColor = 'text-gray-400'
  if (edge > 8) edgeColor = 'text-emerald-400'
  else if (edge > 5) edgeColor = 'text-blue-400'
  else if (edge > 2) edgeColor = 'text-amber-400'
  else edgeColor = 'text-red-400'

  return (
    <div className="flex items-center justify-between border-b border-gray-700/30 py-2 last:border-0">
      <span className="text-sm text-gray-300">{contract.texto}</span>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-gray-500">Mkt: <span className="text-gray-300">{contract.prob_mkt}%</span></span>
        <span className="text-gray-500">IA: <span className="text-blue-300">{probIAPct}%</span></span>
        <span className={`font-mono font-semibold ${edgeColor}`}>
          {edge > 0 ? '+' : ''}{edge}%
        </span>
      </div>
    </div>
  )
}

export default function CityCard({ data }: CityCardProps) {
  const { forecast } = data
  const modelosCount = Object.keys(forecast.ensemble_raw).length

  return (
    <div className="card">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-white">{data.ciudad}</h3>
          <p className="text-xs text-gray-500">{data.slug} · {modelosCount} modelos</p>
        </div>
        <ConsensoBadge consenso={forecast.consenso} />
      </div>

      {/* Temperatures */}
      <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-900/50 p-3">
        <div className="text-center">
          <div className="text-xs text-gray-500">Ensemble</div>
          <div className="text-xl font-bold text-white">{forecast.temp_ponderada.toFixed(1)}°</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">Corregida</div>
          <div className="text-xl font-bold text-emerald-400">{forecast.temp_corregida.toFixed(1)}°</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">Sesgo</div>
          <div className="text-xl font-bold text-amber-400">-{forecast.sesgo_aplicado.toFixed(2)}°</div>
        </div>
      </div>

      {/* Models */}
      <div className="mb-3 flex flex-wrap gap-1">
        {Object.entries(forecast.ensemble_raw).map(([model, temp]) => (
          <span key={model} className="rounded bg-slate-700/50 px-2 py-0.5 text-xs text-gray-400">
            {model.split('_')[0]}: {temp.toFixed(1)}°
          </span>
        ))}
      </div>

      {/* Contracts */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">CONTRATOS ({data.contratos.length})</span>
          <ArbBadge nivel={data.arbitraje.nivel} />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {data.contratos.map((c, i) => (
            <ContractRow key={`${c.token_id}-${i}`} contract={c} />
          ))}
        </div>
      </div>

      {/* Volatility */}
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
        <span>Vol: {forecast.volatilidad.toFixed(2)}</span>
        <span>·</span>
        <span>Spread: {(Math.max(...Object.values(forecast.ensemble_raw)) - Math.min(...Object.values(forecast.ensemble_raw))).toFixed(1)}°</span>
      </div>
    </div>
  )
}
