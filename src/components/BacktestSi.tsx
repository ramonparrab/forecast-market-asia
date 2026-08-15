import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'

interface BacktestContract {
  tipo: string | null
  valor: number | [number, number]
  prob_mkt: number | null
  multiplicador: number | null
  multiplicador_neto: number | null
  resultado?: 'gana' | 'pierde'
}

interface BacktestDayRow {
  fecha: string
  temp_pronosticada: number
  umbral: number
  modo_umbral: string
  contratos_usados: BacktestContract[]
  costo_total_pct: string
  multiplicador: number
  multiplicador_neto: number
  temp_real: number | null
  resultado: 'gana' | 'pierde' | 'pendiente'
}

interface BacktestSummary {
  total_dias: number
  dias_ganados: number
  dias_perdidos: number
  dias_pendientes: number
  win_rate: number | null
  mult_promedio: number | null
  mult_maximo: number | null
  mult_minimo: number | null
  net_mult_promedio: number | null
}

type Estrategia = 'exacta' | 'consecutiva'

export default function BacktestSi() {
  const [slug, setSlug] = useState('chongqing')
  const [thresholdMode, setThresholdMode] = useState<'forecast' | 'forecast+1'>('forecast')
  const [daysLimit, setDaysLimit] = useState(60)
  const [estrategia, setEstrategia] = useState<Estrategia>('exacta')
  const [data, setData] = useState<{ results: BacktestDayRow[]; summary: BacktestSummary | null; estrategia: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const allSlugs = CIUDADES_ASIA.map(c => ({ slug: c.slug, nombre: c.nombre }))

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ slug, modo: thresholdMode, dias: String(daysLimit), estrategia })
      const res = await fetch(`/api/backtest-si?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || 'Error al cargar datos')
      }
      const json = await res.json()
      setData(json)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [slug, thresholdMode, daysLimit, estrategia])

  const summary = data?.summary
  const results = data?.results ?? []
  const primeraFecha = (data as any)?.primeraFecha ?? null
  const ultimaFecha = (data as any)?.ultimaFecha ?? null

  const sortedDesc = [...results].sort((a, b) => b.fecha.localeCompare(a.fecha))

  const daysOptions = [15, 30, 60, 90, 999]

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-6">
        <h2 className="text-xl font-bold text-white mb-1">BACKTEST SI — RENDIMIENTO</h2>
        <p className="text-sm text-gray-400 mb-2">
          Evalua el desempeno historico de apostar SI usando la temperatura pronosticada (RESUMEN) con contratos reales de Polymarket.
        </p>
        <p className="text-[10px] text-gray-500 mb-6">
          El multiplicador indica cuanto pagaria la apuesta por cada $1 invertido. P.ej. SI%=19% - x5.26 (si aciertas, recibes $5.26 por cada $1).
        </p>

        {/* Subtabs */}
        <div className="flex rounded-lg bg-slate-800 border border-gray-600 overflow-hidden mb-6">
          <button
            onClick={() => setEstrategia('exacta')}
            className={`flex-1 px-3 py-2.5 text-xs font-bold transition ${estrategia === 'exacta' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            BACKTEST TEMPERATURA PRONOSTICADA EXACTA
          </button>
          <button
            onClick={() => setEstrategia('consecutiva')}
            className={`flex-1 px-3 py-2.5 text-xs font-bold transition ${estrategia === 'consecutiva' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
          >
            BACKTEST TEMPERATURA PRONOSTICADA + CONSECUTIVA
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Ciudad</label>
            <select
              value={slug}
              onChange={e => setSlug(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {allSlugs.map(c => (
                <option key={c.slug} value={c.slug}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Umbral</label>
            <div className="flex rounded-lg bg-slate-800 border border-gray-600 overflow-hidden">
              <button
                onClick={() => setThresholdMode('forecast')}
                className={`flex-1 px-3 py-2 text-xs font-medium transition ${thresholdMode === 'forecast' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Misma Prono
              </button>
              <button
                onClick={() => setThresholdMode('forecast+1')}
                className={`flex-1 px-3 py-2 text-xs font-medium transition ${thresholdMode === 'forecast+1' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Prono +1C
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Dias</label>
            <select
              value={daysLimit}
              onChange={e => setDaysLimit(parseInt(e.target.value))}
              className="w-full rounded-lg bg-slate-800 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {daysOptions.map(d => (
                <option key={d} value={d}>{d === 999 ? 'Todos' : `Ultimos ${d}`}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={loadData}
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition disabled:opacity-50"
            >
              {loading ? 'Cargando...' : 'Actualizar'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">{error}</div>
        )}

        {loading && (
          <div className="animate-pulse space-y-4">
            <div className="h-24 rounded-xl bg-slate-800/50" />
            <div className="h-64 rounded-xl bg-slate-800/50" />
          </div>
        )}
      </div>

      {primeraFecha && ultimaFecha && (
        <div className="rounded-xl bg-blue-900/20 border border-blue-500/20 px-4 py-2 text-[11px] text-blue-300 text-center">
          Rango de datos: <span className="font-semibold">{primeraFecha}</span> - <span className="font-semibold">{ultimaFecha}</span>
          {' '}· {daysLimit === 999 ? 'Todos los' : summary ? summary.total_dias + '/' + daysLimit : '-'} dias con contratos
        </div>
      )}

      {summary && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <SummaryCard label="Dias" value={summary.total_dias} color="text-white" />
          <SummaryCard label="Ganados" value={summary.dias_ganados} color="text-emerald-400" />
          <SummaryCard label="Perdidos" value={summary.dias_perdidos} color="text-red-400" />
          <SummaryCard
            label="Win Rate"
            value={summary.win_rate !== null ? summary.win_rate.toFixed(1) + '%' : '-'}
            color={summary.win_rate !== null && summary.win_rate >= 50 ? 'text-emerald-400' : 'text-red-400'}
          />
          {estrategia === 'exacta' && (
            <>
              <SummaryCard label="Mult Promedio (gana)" value={summary.mult_promedio !== null ? 'x' + summary.mult_promedio.toFixed(2) : '-'} color="text-blue-400" />
              <SummaryCard label="Mult Neto Promedio" value={summary.net_mult_promedio !== null ? 'x' + summary.net_mult_promedio.toFixed(2) : '-'} color={summary.net_mult_promedio !== null && summary.net_mult_promedio > 0 ? 'text-emerald-400' : 'text-red-400'} />
              <SummaryCard label="Mult Maximo" value={summary.mult_maximo !== null ? 'x' + summary.mult_maximo.toFixed(2) : '-'} color="text-amber-400" />
              <SummaryCard label="Mult Minimo" value={summary.mult_minimo !== null ? 'x' + summary.mult_minimo.toFixed(2) : '-'} color="text-gray-400" />
            </>
          )}
          {estrategia === 'consecutiva' && (
            <>
              <SummaryCard label="Mult Efectivo Prom (gana)" value={summary.mult_promedio !== null ? 'x' + summary.mult_promedio.toFixed(2) : '-'} color="text-blue-400" />
              <SummaryCard label="Mult Efectivo Max" value={summary.mult_maximo !== null ? 'x' + summary.mult_maximo.toFixed(2) : '-'} color="text-amber-400" />
              <SummaryCard
                label="Costo Promedio"
                value={(() => {
                  const costos = results.map(r => parseFloat(r.costo_total_pct)).filter(c => !isNaN(c))
                  if (costos.length === 0) return '-'
                  return (costos.reduce((a, b) => a + b, 0) / costos.length).toFixed(1) + '%'
                })()}
                color="text-gray-400"
              />
            </>
          )}
        </div>
      )}

      {estrategia === 'consecutiva' && !loading && data && (data as any).distribucionGanadores && (
        <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
          <h4 className="text-xs font-semibold text-gray-300 mb-3 uppercase tracking-wider">Distribucion de ganadores por contrato</h4>
          <div className="grid grid-cols-4 gap-3">
            {[
              { key: 'menos1', label: 'Prono -1', color: 'text-orange-400', bg: 'bg-orange-500/10' },
              { key: 'prono', label: 'Temp Pronosticada', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
              { key: 'mas1', label: 'Prono +1', color: 'text-blue-400', bg: 'bg-blue-500/10' },
              { key: 'ninguno', label: 'Ninguno (Pierde)', color: 'text-red-400', bg: 'bg-red-500/10' },
            ].map(({ key, label, color, bg }) => {
              const count = ((data as any).distribucionGanadores as Record<string, number>)[key] || 0
              const total = (data as any).summary?.total_dias || 1
              const pct = ((count / total) * 100).toFixed(1)
              return (
                <div key={key} className={`rounded-lg ${bg} border border-gray-700/30 p-3 text-center`}>
                  <p className={`text-lg font-bold ${color}`}>{count}</p>
                  <p className="text-[10px] text-gray-500 uppercase">{label}</p>
                  <p className="text-[10px] text-gray-600">({pct}%)</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {sortedDesc.length > 0 && !loading && (
        <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 overflow-hidden">
          <div className="p-4 border-b border-gray-700/30 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Resultados dia por dia ({sortedDesc.length} dias{estrategia === 'consecutiva' ? ' - 3 contratos consecutivos' : ''})
            </h3>
            <span className="text-[10px] text-gray-500">mas reciente primero</span>
          </div>
          <div className="overflow-x-auto">
            {estrategia === 'exacta' ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500">
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-right">PRONOSTICADA</th>
                    <th className="px-3 py-2 text-right">Umbral</th>
                    <th className="px-3 py-2 text-right">Contrato</th>
                    <th className="px-3 py-2 text-right">SI%</th>
                    <th className="px-3 py-2 text-right">Mult</th>
                    <th className="px-3 py-2 text-right">Real</th>
                    <th className="px-3 py-2 text-center">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDesc.map(r => (
                    <tr key={r.fecha} className="border-t border-gray-800 hover:bg-slate-800/30 transition">
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{r.fecha}</td>
                      <td className="px-3 py-2 text-right text-blue-300 font-bold">{r.temp_pronosticada.toFixed(2)}C</td>
                      <td className="px-3 py-2 text-right text-white font-medium">{'>='}{r.umbral}C</td>
                      <td className="px-3 py-2 text-right text-white">
                        {r.contratos_usados[0]?.tipo === 'superior' ? '>=' : r.contratos_usados[0]?.tipo ? '' : '-'}
                        {typeof r.contratos_usados[0]?.valor === 'number' ? r.contratos_usados[0].valor + 'C' : '-'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-amber-400 font-medium">{r.costo_total_pct}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.multiplicador > 0 ? (
                          <span className="text-blue-400 font-bold">x{r.multiplicador.toFixed(2)}</span>
                        ) : (
                          <span className="text-gray-500">?</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-white">
                        {r.temp_real !== null ? r.temp_real.toFixed(2) + 'C' : '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.resultado === 'gana' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-400 font-medium">GANA</span>
                        ) : r.resultado === 'pierde' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-red-400 font-medium">PIERDE</span>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500">
                    <th className="px-2 py-2 text-left">Fecha</th>
                    <th className="px-2 py-2 text-right">PRONO</th>
                    <th className="px-2 py-2 text-right">Um</th>
                    <th className="px-2 py-2 text-center" colSpan={2}>Prono -1</th>
                    <th className="px-2 py-2 text-center" colSpan={2}>Temp Pronosticada</th>
                    <th className="px-2 py-2 text-center" colSpan={2}>Prono +1</th>
                    <th className="px-2 py-2 text-right">Real</th>
                    <th className="px-2 py-2 text-right">Costo</th>
                    <th className="px-2 py-2 text-center">Resultado</th>
                  </tr>
                  <tr className="border-b border-gray-800 text-gray-600 text-[10px]">
                    <th></th><th></th><th></th>
                    <th className="px-1 py-1 text-right">SI%</th>
                    <th className="px-1 py-1 text-right">Mult</th>
                    <th className="px-1 py-1 text-right">SI%</th>
                    <th className="px-1 py-1 text-right">Mult</th>
                    <th className="px-1 py-1 text-right">SI%</th>
                    <th className="px-1 py-1 text-right">Mult</th>
                    <th></th><th></th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDesc.map(r => {
                    const cs = r.contratos_usados
                    const c0 = cs.find(c => typeof c.valor === 'number' && c.valor === r.umbral - 1)
                    const c1 = cs.find(c => typeof c.valor === 'number' && c.valor === r.umbral)
                    const c2 = cs.find(c => typeof c.valor === 'number' && c.valor === r.umbral + 1)
                    return (
                      <tr key={r.fecha} className="border-t border-gray-800 hover:bg-slate-800/30 transition">
                        <td className="px-2 py-2 text-gray-400 whitespace-nowrap">{r.fecha}</td>
                        <td className="px-2 py-2 text-right text-blue-300 font-bold">{r.temp_pronosticada.toFixed(2)}C</td>
                        <td className="px-2 py-2 text-right text-white font-medium">{'>='}{r.umbral}C</td>

                        {/* Prono-1 */}
                        <td className={`px-2 py-2 text-right ${(c0 as any)?.resultado === 'gana' ? 'text-orange-400 font-bold' : 'text-amber-400'}`}>
                          {c0?.prob_mkt != null ? c0.prob_mkt + '%' : '-'}
                        </td>
                        <td className={`px-2 py-2 text-right ${(c0 as any)?.resultado === 'gana' ? 'text-orange-400 font-bold' : 'text-blue-400'}`}>
                          {c0?.multiplicador != null ? 'x' + c0.multiplicador.toFixed(2) : '-'}
                        </td>

                        {/* Temp Pronosticada */}
                        <td className={`px-2 py-2 text-right ${(c1 as any)?.resultado === 'gana' ? 'text-emerald-400 font-bold' : 'text-amber-400'}`}>
                          {c1?.prob_mkt != null ? c1.prob_mkt + '%' : '-'}
                        </td>
                        <td className={`px-2 py-2 text-right ${(c1 as any)?.resultado === 'gana' ? 'text-emerald-400 font-bold' : 'text-blue-400'}`}>
                          {c1?.multiplicador != null ? 'x' + c1.multiplicador.toFixed(2) : '-'}
                        </td>

                        {/* Prono+1 */}
                        <td className={`px-2 py-2 text-right ${(c2 as any)?.resultado === 'gana' ? 'text-blue-400 font-bold' : 'text-amber-400'}`}>
                          {c2?.prob_mkt != null ? c2.prob_mkt + '%' : '-'}
                        </td>
                        <td className={`px-2 py-2 text-right ${(c2 as any)?.resultado === 'gana' ? 'text-blue-400 font-bold' : 'text-blue-400'}`}>
                          {c2?.multiplicador != null ? 'x' + c2.multiplicador.toFixed(2) : '-'}
                        </td>

                        <td className="px-2 py-2 text-right text-white">
                          {r.temp_real !== null ? r.temp_real.toFixed(1) + 'C' : '-'}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-400">{r.costo_total_pct}</td>
                        <td className="px-2 py-2 text-center">
                          {c0?.resultado === 'gana' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-orange-400 font-bold text-[10px]">
                              Prono -1
                            </span>
                          ) : c1?.resultado === 'gana' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-400 font-bold text-[10px]">
                              Prono
                            </span>
                          ) : c2?.resultado === 'gana' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-400 font-bold text-[10px]">
                              Prono +1
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-red-400 font-medium text-[10px]">
                              PIERDE
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {!loading && !error && sortedDesc.length === 0 && (
        <div className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-gray-700/30 p-8 text-center">
          <p className="text-gray-400">No hay datos disponibles para los parametros seleccionados.</p>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4 text-center">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  )
}