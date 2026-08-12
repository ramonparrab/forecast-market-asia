import { useState, useEffect } from 'react'

interface DecisionEval {
  fecha: string; slug: string; ciudad: string; real: number
  nuestraRecom: number; nuestraMkt: number; nuestraIA: number; nuestraEdge: number; nuestraPnl: number
  optimoRecom: number; optimoMkt: number; optimoPnl: number
  diffPnl: number; acertamos: boolean
}

interface CitySummary {
  slug: string; ciudad: string; total: number; ganadas: number
  pnlNuestro: number; pnlOptimo: number; diffTotal: number
}

interface EvalResponse {
  total: number; ganadas: number; perdidas: number; winRate: number
  pnlNuestro: number; pnlOptimo: number; diffTotal: number
  ciudades: number; summaries: CitySummary[]; evaluations: DecisionEval[]
}

export default function Evaluacion10pm() {
  const [data, setData] = useState<EvalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [verTodo, setVerTodo] = useState(false)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const resp = await fetch('/api/evaluate-10pm')
      if (resp.ok) setData(await resp.json())
    } catch { /* ignore */ }
    setLoading(false)
  }

  function toggleCity(slug: string) {
    setExpanded(prev => ({ ...prev, [slug]: !prev[slug] }))
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-4 sm:p-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h2 className="text-lg sm:text-xl font-bold text-white">⚖️ DECISION 10PM vs OPTIMO</h2>
        <button onClick={fetchData} disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition">
          {loading ? '...' : '↻'}
        </button>
      </div>

      <p className="text-[10px] sm:text-xs text-gray-400 mb-4">
        Compara lo que <span className="text-blue-400">recomendamos a las 10PM</span> vs lo que <span className="text-emerald-400">debimos haber apostado</span> (sabiendo el resultado).<br />
        <strong className="text-amber-400">Diferencia P&L</strong> = cuánto dinero dejamos de ganar (o perdimos de más) vs la jugada óptima.
      </p>

      {loading && <div className="text-center py-8 text-gray-500 text-sm">Evaluando...</div>}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-center">
              <div className="text-[9px] text-blue-400">Decisiones</div>
              <div className="text-xl font-bold text-white">{data.total}</div>
              <div className="text-[9px] text-gray-500">{data.ganadas} ganadas · {data.perdidas} perdidas</div>
            </div>
            <div className="bg-blue-600/10 border border-blue-600/20 rounded-xl p-3 text-center">
              <div className="text-[9px] text-blue-400">🤖 Nuestra 10PM</div>
              <div className={`text-xl font-bold ${data.pnlNuestro >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                ${data.pnlNuestro >= 0 ? '+' : ''}{data.pnlNuestro.toFixed(2)}
              </div>
              <div className="text-[9px] text-gray-500">recomendación real</div>
            </div>
            <div className="bg-emerald-600/10 border border-emerald-600/20 rounded-xl p-3 text-center">
              <div className="text-[9px] text-emerald-400">🎯 Óptimo hindsight</div>
              <div className="text-xl font-bold text-emerald-300">
                +${data.pnlOptimo.toFixed(2)}
              </div>
              <div className="text-[9px] text-gray-500">la mejor jugada posible</div>
            </div>
            <div className={`${data.diffTotal >= 0 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20'} border rounded-xl p-3 text-center`}>
              <div className="text-[9px] text-gray-400">⚡ Diferencia</div>
              <div className={`text-xl font-bold ${data.diffTotal >= 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                ${data.diffTotal >= 0 ? '+' : ''}{data.diffTotal.toFixed(2)}
              </div>
              <div className="text-[9px] text-gray-500">oportunidad perdida</div>
            </div>
          </div>

          {/* Per-city comparison */}
          <div className="overflow-x-auto mb-5">
            <table className="w-full text-[9px] sm:text-[10px]">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700/30">
                  <th className="text-left px-2 py-2">Ciudad</th>
                  <th className="text-right px-2 py-2">Casos</th>
                  <th className="text-right px-2 py-2">Ganadas</th>
                  <th className="text-right px-2 py-2">🤖 Nuestra 10PM</th>
                  <th className="text-right px-2 py-2">🎯 Óptimo</th>
                  <th className="text-right px-2 py-2">⚡ Diferencia</th>
                  <th className="text-center px-2 py-2">Det</th>
                </tr>
              </thead>
              <tbody>
                {data.summaries.sort((a, b) => b.diffTotal - a.diffTotal).map(s => {
                  const evals = data.evaluations.filter(e => e.slug === s.slug).sort((a, b) => b.fecha.localeCompare(a.fecha))
                  return (
                    <>
                      <tr key={s.slug} className="border-b border-gray-800/50 hover:bg-slate-700/20">
                        <td className="px-2 py-2 font-medium text-white">{s.ciudad}</td>
                        <td className="text-right px-2 py-2 text-gray-300">{s.total}</td>
                        <td className="text-right px-2 py-2 text-gray-300">{s.ganadas}</td>
                        <td className={`text-right px-2 py-2 font-medium ${s.pnlNuestro >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          ${s.pnlNuestro >= 0 ? '+' : ''}{s.pnlNuestro.toFixed(2)}
                        </td>
                        <td className={`text-right px-2 py-2 font-medium text-emerald-400`}>
                          +${s.pnlOptimo.toFixed(2)}
                        </td>
                        <td className={`text-right px-2 py-2 font-medium ${s.diffTotal >= 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          ${s.diffTotal >= 0 ? '+' : ''}{s.diffTotal.toFixed(2)}
                        </td>
                        <td className="text-center px-2 py-2">
                          <button onClick={() => toggleCity(s.slug)} className="text-blue-400 hover:text-blue-300 text-[10px]">
                            {expanded[s.slug] ? '▲' : '▼'}
                          </button>
                        </td>
                      </tr>
                      {expanded[s.slug] && evals.map(e => (
                        <tr key={`${e.fecha}`} className="bg-slate-800/30 border-b border-gray-800/30">
                          <td className="px-2 py-1 text-gray-500 text-[8px]">{e.fecha}</td>
                          <td className="px-2 py-1 text-right text-gray-500">{e.real}°C</td>
                          <td className="px-2 py-1">
                            <span className="text-blue-400 font-medium">{e.nuestraRecom}°C</span>
                            <span className="text-gray-500"> @ {e.nuestraMkt}%</span>
                          </td>
                          <td className={`px-2 py-1 text-right font-medium ${e.nuestraPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            ${e.nuestraPnl >= 0 ? '+' : ''}{e.nuestraPnl.toFixed(2)}
                          </td>
                          <td className="px-2 py-1">
                            <span className="text-emerald-400 font-medium">{e.optimoRecom}°C</span>
                            <span className="text-gray-500"> @ {e.optimoMkt}%</span>
                          </td>
                          <td className={`px-2 py-1 text-right font-medium text-emerald-400`}>
                            +${e.optimoPnl.toFixed(2)}
                          </td>
                          <td className={`px-2 py-1 text-right font-medium ${e.diffPnl >= 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                            ${e.diffPnl >= 0 ? '+' : ''}{e.diffPnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Full detail */}
          <button onClick={() => setVerTodo(!verTodo)}
            className="text-[10px] text-gray-500 hover:text-gray-300 mb-2">
            {verTodo ? '▲ Ocultar detalle completo' : '▼ Ver todas las decisiones (' + data.evaluations.length + ')'}
          </button>

          {verTodo && (
            <div className="overflow-x-auto">
              <table className="w-full text-[9px] sm:text-[10px]">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700/30">
                    <th className="text-left px-2 py-1">Fecha</th>
                    <th className="text-left px-2 py-1">Ciudad</th>
                    <th className="text-center px-2 py-1">Real</th>
                    <th className="text-center px-2 py-1" colSpan={3}>🤖 RECOMENDACION 10PM</th>
                    <th className="text-center px-2 py-1" colSpan={2}>🎯 OPTIMO (hindsight)</th>
                    <th className="text-right px-2 py-1">⚡ Diff</th>
                  </tr>
                  <tr className="text-gray-600 border-b border-gray-700/30 text-[8px]">
                    <th></th><th></th><th></th>
                    <th className="text-right px-1 py-1">Bucket</th>
                    <th className="text-right px-1 py-1">Mkt</th>
                    <th className="text-right px-1 py-1">P&L</th>
                    <th className="text-right px-1 py-1">Bucket</th>
                    <th className="text-right px-1 py-1">P&L</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.evaluations.sort((a, b) => b.fecha.localeCompare(a.fecha)).map((e, i) => (
                    <tr key={`${e.fecha}-${e.slug}-${i}`} className={`border-b border-gray-800/30 ${e.acertamos ? 'bg-emerald-500/10' : 'bg-red-500/5'}`}>
                      <td className="px-2 py-1 text-gray-500">{e.fecha}</td>
                      <td className="px-2 py-1 text-white">{e.ciudad}</td>
                      <td className="text-center px-2 py-1 text-white font-medium">{e.real}°C</td>
                      <td className="text-right px-2 py-1 text-blue-400 font-medium">{e.nuestraRecom}°C</td>
                      <td className="text-right px-2 py-1 text-gray-400">{e.nuestraMkt}%</td>
                      <td className={`text-right px-2 py-1 font-medium ${e.nuestraPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${e.nuestraPnl >= 0 ? '+' : ''}{e.nuestraPnl.toFixed(2)}
                      </td>
                      <td className="text-right px-2 py-1 text-emerald-400 font-medium">{e.optimoRecom}°C</td>
                      <td className="text-right px-2 py-1 text-emerald-400">
                        +${e.optimoPnl.toFixed(2)}
                      </td>
                      <td className={`text-right px-2 py-1 font-medium ${e.diffPnl >= 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        ${e.diffPnl >= 0 ? '+' : ''}{e.diffPnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!data && !loading && (
        <div className="text-center py-8 text-gray-500 text-sm">No hay datos.</div>
      )}
    </div>
  )
}
