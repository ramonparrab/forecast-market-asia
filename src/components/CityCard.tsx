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

function ExitoPctBadge({ pct }: { pct: number }) {
  if (pct >= 80) return <span className="text-emerald-400 font-bold">{pct}%</span>
  if (pct >= 65) return <span className="text-green-400 font-bold">{pct}%</span>
  if (pct >= 50) return <span className="text-amber-400 font-bold">{pct}%</span>
  return <span className="text-red-400 font-bold">{pct}%</span>
}

function NowcastIndicator({ data }: { data: CityAnalysis }) {
  const n = data.nowcast
  if (!n || !n.activo) return null
  const color = n.peso_observacion > 0.5 ? 'text-emerald-400' : 'text-blue-400'
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
      <span>📡</span>
      Nowcast {(n.peso_observacion * 100).toFixed(0)}%
      {n.temp_observada !== null && <span>({n.temp_observada.toFixed(1)}°C obs)</span>}
    </span>
  )
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
  const modelosTemps = Object.values(forecast.ensemble_raw)
  const spread = modelosTemps.length > 0 ? Math.max(...modelosTemps) - Math.min(...modelosTemps) : 0
  const totalMkt = data.contratos.reduce((s, c) => s + c.prob_mkt, 0)

  return (
    <div className="card relative overflow-hidden">
      {/* Success probability bar at top */}
      <div className="absolute top-0 left-0 right-0 h-1">
        <div
          className={`h-full transition-all duration-500 ${
            data.exito_pct >= 80 ? 'bg-emerald-500' :
            data.exito_pct >= 65 ? 'bg-green-500' :
            data.exito_pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
          }`}
          style={{ width: `${data.exito_pct}%` }}
        />
      </div>

      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-bold text-white">{data.ciudad}</h3>
          <p className="text-xs text-gray-500">{data.slug} · {modelosCount} modelos</p>
        </div>
        <div className="flex items-center gap-2">
          <NowcastIndicator data={data} />
          <ConsensoBadge consenso={forecast.consenso} />
        </div>
      </div>

      {/* Success % + Explanation */}
      <div className={`mb-3 rounded-lg p-2.5 text-xs ${
        data.exito_pct >= 65 ? 'bg-emerald-500/5 border border-emerald-500/10' :
        data.exito_pct >= 50 ? 'bg-amber-500/5 border border-amber-500/10' :
        'bg-red-500/5 border border-red-500/10'
      }`}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-gray-500">Precisión estimada</span>
          <ExitoPctBadge pct={data.exito_pct} />
        </div>
        <p className="text-gray-400 leading-relaxed">{data.explicacion}</p>
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
          <div className="text-xl font-bold text-amber-400">{forecast.sesgo_aplicado > 0 ? '+' : ''}{forecast.sesgo_aplicado.toFixed(2)}°</div>
        </div>
      </div>

      {/* Models */}
      <div className="mb-3 flex flex-wrap gap-1">
        {Object.entries(forecast.ensemble_raw).map(([model, temp]) => {
          const diff = temp - forecast.temp_corregida
          const diffColor = Math.abs(diff) < 1.5 ? 'text-gray-400' : Math.abs(diff) < 3 ? 'text-amber-400' : 'text-red-400'
          return (
            <span key={model} className={`rounded bg-slate-700/50 px-2 py-0.5 text-xs ${diffColor}`}>
              {model.split('_')[0]}: {temp.toFixed(1)}°{diff > 0 ? ' ↑' : diff < 0 ? ' ↓' : ''}
            </span>
          )
        })}
      </div>

      {/* Contracts */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">CONTRATOS ({data.contratos.length})</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Σ Mkt: {totalMkt.toFixed(0)}%</span>
            <ArbBadge nivel={data.arbitraje.nivel} />
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto">
          {data.contratos.map((c, i) => (
            <ContractRow key={`${c.token_id}-${i}`} contract={c} />
          ))}
        </div>
      </div>

      {/* Info bar */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
        <span>Vol: {forecast.volatilidad.toFixed(2)}</span>
        <span>·</span>
        <span>Spread: {spread.toFixed(1)}°</span>
        {data.nowcast?.activo && (
          <>
            <span>·</span>
            <span className="text-blue-400">Nowcast: {data.nowcast.estacion}</span>
          </>
        )}
      </div>
    </div>
  )
}
