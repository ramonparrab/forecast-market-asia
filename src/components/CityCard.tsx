import { CityAnalysis, PolymarketContract } from '@/types'

interface CityCardProps {
  data: CityAnalysis
}

function ConsensoBadge({ consenso }: { consenso: string }) {
  if (consenso === 'MUY FUERTE') return (
    <span className="badge-green relative group cursor-help">
      {consenso}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Consenso MUY FUERTE</p>
        <p className="text-gray-300">Todos los modelos (6/6) coinciden en el mismo rango de temperatura. Alta confianza en el pronóstico.</p>
      </div>
    </span>
  )
  if (consenso === 'FUERTE') return (
    <span className="badge-blue relative group cursor-help">
      {consenso}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Consenso FUERTE</p>
        <p className="text-gray-300">5 de 6 modelos coinciden. Buena confianza, pero hay 1 modelo diferente.</p>
      </div>
    </span>
  )
  if (consenso === 'ACEPTABLE') return (
    <span className="badge-yellow relative group cursor-help">
      {consenso}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Consenso ACEPTABLE</p>
        <p className="text-gray-300">4 de 6 modelos coinciden. Confianza moderada, considerar其他 opciones.</p>
      </div>
    </span>
  )
  return (
    <span className="badge-red relative group cursor-help">
      {consenso}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Consenso DÉBIL</p>
        <p className="text-gray-300">3 o menos modelos coinciden. Alta incertidumbre, no recomendado apostar.</p>
      </div>
    </span>
  )
}

function ArbBadge({ nivel }: { nivel: string }) {
  if (nivel.includes('ALTO')) return (
    <span className="badge-red relative group cursor-help">
      {nivel}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Arbitraje ALTO</p>
        <p className="text-gray-300">Las probabilidades suman más de 100%. El mercado está mal定价, posibilidad de ganar sin riesgo.</p>
      </div>
    </span>
  )
  if (nivel.includes('MEDIO')) return (
    <span className="badge-yellow relative group cursor-help">
      {nivel}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Arbitraje MEDIO</p>
        <p className="text-gray-300">Pequeña discrepancia entre precios. Posible oportunidad pero con riesgo.</p>
      </div>
    </span>
  )
  return (
    <span className="badge-green relative group cursor-help">
      {nivel}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Sin Arbitraje</p>
        <p className="text-gray-300">Precios coherentes entre contratos. Mercado bien定价.</p>
      </div>
    </span>
  )
}

function LiquidityBadge({ liquidity }: { liquidity?: 'ALTA' | 'MEDIA' | 'BAJA' }) {
  if (!liquidity || liquidity === 'BAJA') return (
    <span className="badge-red relative group cursor-help">
      🔴 BAJA
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Liquidez BAJA</p>
        <p className="text-gray-300">Poca gente comprando/vendiendo. Spread alto ({'>'}$0.05). Riesgo de no poder vender o precio poco confiable.</p>
      </div>
    </span>
  )
  if (liquidity === 'MEDIA') return (
    <span className="badge-yellow relative group cursor-help">
      🟡 MEDIA
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Liquidez MEDIA</p>
        <p className="text-gray-300">Volumen moderado. Spread aceptable ({'>'}$0.03). Se puede apostar pero con precaución.</p>
      </div>
    </span>
  )
  return (
    <span className="badge-green relative group cursor-help">
      🟢 ALTA
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Liquidez ALTA</p>
        <p className="text-gray-300">Mercado líquido. Volumen {'>'}$5,000/día, spread {'<'}.03. Precio confiable, fácil entrada/salida.</p>
      </div>
    </span>
  )
}

function EvIndicator({ ev }: { ev?: number }) {
  if (ev === undefined || ev === null) return <span className="text-gray-500">N/A</span>
  if (ev > 0.05) return (
    <span className="text-emerald-400 font-bold relative group cursor-help">
      +${ev.toFixed(2)} ✅
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">EV Positivo: +${ev.toFixed(2)}</p>
        <p className="text-gray-300">Cada $1 apostado, ganás ${ev.toFixed(2)} en promedio. Apuesta recomendada.</p>
      </div>
    </span>
  )
  if (ev > 0) return (
    <span className="text-amber-400 relative group cursor-help">
      +${ev.toFixed(2)} ⚠️
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">EV Bajo: +${ev.toFixed(2)}</p>
        <p className="text-gray-300">Ganancia mínima. Considerar si vale la pena el riesgo.</p>
      </div>
    </span>
  )
  return (
    <span className="text-red-400 font-bold relative group cursor-help">
      ${ev.toFixed(2)} ❌
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">EV Negativo: ${ev.toFixed(2)}</p>
        <p className="text-gray-300">Perdés ${Math.abs(ev).toFixed(2)} por cada $1 apostado a largo plazo. NO apostar.</p>
      </div>
    </span>
  )
}

function ExitoPctBadge({ pct, isReal }: { pct: number; isReal?: boolean }) {
  const badgeContent = (
    <>
      {pct}%
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 p-3 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-2">Precisión: {pct}%</p>
        {isReal ? (
          <>
            <p className="text-emerald-300 mb-2">✅ Basado en pronósticos REALES vs temperatura real en Polymarket</p>
            <p className="text-gray-400 text-[10px]">Se calcula: % de pronósticos que estuvieron dentro de ±2°C de la temperatura real del cierre.</p>
            <p className="text-blue-300 text-[10px] mt-2">Con cada historial adicional, esta precisión MEJORA.</p>
          </>
        ) : (
          <>
            <p className="text-amber-300 mb-2">⚠️ Estimación teórica (sin datos suficientes)</p>
            <p className="text-gray-400 text-[10px]">Basado en: modelos, spread, consenso, nowcast.</p>
            <p className="text-gray-400 text-[10px] mt-2">Se volverá REAL cuando haya 5+ pronósticos verificados.</p>
          </>
        )}
      </div>
    </>
  )

  if (pct >= 80) return <span className="text-emerald-400 font-bold relative group cursor-help">{badgeContent}</span>
  if (pct >= 65) return <span className="text-green-400 font-bold relative group cursor-help">{badgeContent}</span>
  if (pct >= 50) return <span className="text-amber-400 font-bold relative group cursor-help">{badgeContent}</span>
  return <span className="text-red-400 font-bold relative group cursor-help">{badgeContent}</span>
}

function NowcastIndicator({ data }: { data: CityAnalysis }) {
  const n = data.nowcast
  if (!n || !n.activo) return null
  const color = n.peso_observacion > 0.5 ? 'text-emerald-400' : 'text-blue-400'
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color} relative group cursor-help`}>
      <span>📡</span>
      Nowcast {(n.peso_observacion * 100).toFixed(0)}%
      {n.temp_observada !== null && <span>({n.temp_observada.toFixed(1)}°C obs)</span>}
      <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 text-xs text-white bg-gray-900 border border-gray-700 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <p className="font-bold mb-1">Nowcasting Activo</p>
        <p className="text-gray-300 mb-2">Usa observaciones METAR del aeropuerto {n.estacion} en tiempo real.</p>
        <p className="text-gray-400 text-[10px] mb-2">El peso de la observación sube de 0% a 80% durante el día, capturando la temperatura real.</p>
        <p className="text-blue-300 text-[10px]">Temperatura observada: {n.temp_observada?.toFixed(1)}°C</p>
      </div>
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
      <div className="flex items-center gap-3 text-xs">
        <span className="text-gray-500">Mkt: <span className="text-gray-300">{contract.prob_mkt}%</span></span>
        <span className="text-gray-500">IA: <span className="text-blue-300">{probIAPct}%</span></span>
        <span className={`font-mono font-semibold ${edgeColor}`}>
          {edge > 0 ? '+' : ''}{edge}%
        </span>
        <LiquidityBadge liquidity={contract.liquidity} />
        <EvIndicator ev={contract.ev} />
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
          <LiquidityBadge liquidity={data.liquidity_avg} />
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
          <ExitoPctBadge pct={data.exito_pct} isReal={data.totalRecords !== undefined && data.totalRecords >= 5} />
        </div>
        <p className="text-gray-400 leading-relaxed">{data.explicacion}</p>
      </div>

      {/* Temperatures */}
      <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-900/50 p-3">
        <div className="text-center">
          <div className="text-xs text-gray-500">Ensemble crudo</div>
          <div className="text-xl font-bold text-white">{forecast.temp_ponderada.toFixed(1)}°</div>
          <div className="text-[9px] text-gray-600">{modelosCount} modelos</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">Corregida 10PM Caracas</div>
          <div className="text-xl font-bold text-emerald-400">{forecast.temp_corregida.toFixed(1)}°</div>
          <div className="text-[9px] text-gray-600">valor pronosticado</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-amber-400 font-semibold">Corrección histórica</div>
          <div className="text-xl font-bold text-amber-400">{forecast.sesgo_aplicado > 0 ? '+' : ''}{forecast.sesgo_aplicado.toFixed(2)}°</div>
          <div className="text-[9px] text-amber-600">ajuste por bias histórico</div>
        </div>
      </div>
      <div className="mb-3 rounded-lg bg-amber-500/5 border border-amber-500/10 p-2 text-[10px] text-gray-400 leading-relaxed">
        ⚡ <span className="text-amber-300">Corrección aplicada:</span> El ensemble crudo de {modelosCount} modelos se ajustó <strong className="text-white">{forecast.sesgo_aplicado > 0 ? '+' : ''}{forecast.sesgo_aplicado.toFixed(2)}°C</strong> basado en el error histórico (últimos 30 días). Próximo pronóstico se beneficiará del nuevo dato de cierre.
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
        {data.volume_total !== undefined && data.volume_total > 0 && (
          <>
            <span>·</span>
            <span className="text-blue-400">Volumen: ${data.volume_total.toFixed(0)}</span>
          </>
        )}
        {data.avg_spread !== undefined && (
          <>
            <span>·</span>
            <span className="text-amber-400">Mkt Spread: {(data.avg_spread * 100).toFixed(1)}¢</span>
          </>
        )}
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
