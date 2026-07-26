import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'

const allSlugs = CIUDADES_ASIA.map(c => ({ slug: c.slug, nombre: c.nombre }))

interface ContractInfo {
  tipo: string
  valor: number | [number, number]
  prob_mkt: number
  texto: string
}

interface ApuestaSI {
  monto: number
  shares: number
  pago_si_gana: number
  ganancia_si_gana: number
  perdida_si_pierde: number
}

interface Escenario {
  label: string
  pnl_si: number
  pnl_no: number
  total: number
}

interface OpcionNO {
  contrato: ContractInfo
  etiqueta: string
  si_pct: number
  no_pct: number
  b_necesario: number
  shares_no: number
  pago_no_gana: number
  ganancia_no_gana: number
  inversion_total: number
  escenario_si_gana_no_pierde: Escenario
  escenario_si_pierde_no_gana: Escenario
  escenario_ambos_ganan: Escenario
  escenario_peor_caso: Escenario
}

interface CoberturaData {
  fecha: string
  fecha_polymarket: string
  fecha_ejecucion_forecast: string
  slug: string
  ciudad: string
  timestamp_analisis: string
  combinado: number
  umbral_si: number
  contratos_si: ContractInfo[]
  costo_si_pct: string
  apuesta_si: ApuestaSI
  opciones_no: OpcionNO[]
  mejor_opcion: OpcionNO | null
  total_contratos_disponibles: number
  hora_snapshot: string
}

export default function CoberturaSiNo() {
  const [slug, setSlug] = useState('chongqing')
  const [monto, setMonto] = useState(10)
  const [inputMonto, setInputMonto] = useState('10')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<CoberturaData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analisisDate, setAnalisisDate] = useState('')

  const analyze = async (s: string, m: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ slug: s, monto: String(m) })
      const res = await fetch(`/api/cobertura-si-no?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || 'Error al cargar datos')
      }
      const json = await res.json()
      setData(json)
      const d = new Date(json.timestamp_analisis)
      setAnalisisDate(
        d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' })
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { analyze(slug, monto) }, [slug, monto])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const val = parseFloat(inputMonto) || 1
      setMonto(Math.max(1, val))
    }
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-4 sm:p-6 overflow-hidden">
      {/* Header & Controls */}
      <div className="flex flex-col gap-3 mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-white">COBERTURA SI/NO — EN VIVO</h2>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">Ciudad</label>
            <select
              value={slug}
              onChange={e => setSlug(e.target.value)}
              className="bg-slate-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs sm:text-sm text-white w-28 sm:w-36"
            >
              {allSlugs.map(c => (
                <option key={c.slug} value={c.slug}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">Monto SI $</label>
            <input
              type="number"
              value={inputMonto}
              onChange={e => setInputMonto(e.target.value)}
              onKeyDown={handleKeyDown}
              className="bg-slate-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs sm:text-sm text-white w-16 sm:w-20 text-center"
            />
            <button
              onClick={() => {
                const val = parseFloat(inputMonto) || 1
                if (val !== monto) setMonto(Math.max(1, val))
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] sm:text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
            >
              {loading ? '...' : 'Aplicar'}
            </button>
          </div>
        </div>
      </div>

      {/* Live Alert Banner */}
      <div className="text-[10px] sm:text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-4">
        <span className="font-bold text-amber-400">⚠️ ANÁLISIS EN VIVO</span>
        <span className="text-gray-300"> — Datos de Polymarket en tiempo real.</span>
        <div className="mt-1 text-gray-400">
          Contratos de Polymarket para <span className="font-bold text-amber-300">{data?.ciudad || '—'}</span> del <span className="font-bold text-amber-300">{data?.fecha_polymarket || '—'}</span>
          {data?.fecha_ejecucion_forecast && (
            <span> — Forecast ejecutado: {data.fecha_ejecucion_forecast.slice(0, 10)}</span>
          )}
        </div>
        <div className="text-gray-500">Snapshot ~{data?.hora_snapshot || '10pm Caracas'}. Válido para {analisisDate || 'la fecha/hora actual'}.</div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-gray-500 text-sm">Cargando datos en vivo...</div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-4 text-red-400 text-xs sm:text-sm border border-red-500/20 rounded-lg bg-red-500/5 mb-4">{error}</div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="space-y-4">
          {/* SI Bet Section */}
          <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-bold text-blue-300 mb-2">APUESTA SI — Umbral {data.umbral_si}°C</h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">COMBINADO</div>
                <div className="text-base sm:text-lg font-bold text-white">{data.combinado}°C</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Umbral SI (rnd)</div>
                <div className="text-base sm:text-lg font-bold text-blue-300">{data.umbral_si}°C</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Costo cartera</div>
                <div className="text-base sm:text-lg font-bold text-white">{data.costo_si_pct}</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Inversión SI</div>
                <div className="text-base sm:text-lg font-bold text-amber-300">${data.apuesta_si.monto.toFixed(2)}</div>
              </div>
            </div>

            <div className="text-[10px] sm:text-xs text-gray-400 mb-2">Contratos ({data.contratos_si.length}):</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {data.contratos_si.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-blue-500/15 border border-blue-500/20 rounded px-1.5 py-0.5 text-[10px] sm:text-xs text-blue-300">
                  {c.texto} <span className="text-blue-400">{c.prob_mkt}%</span>
                </span>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-1.5 sm:p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-400">Shares</div>
                <div className="text-sm sm:text-base font-bold text-emerald-300">{data.apuesta_si.shares.toFixed(2)}</div>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-1.5 sm:p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-400">Pago SI gana</div>
                <div className="text-sm sm:text-base font-bold text-emerald-400">${data.apuesta_si.pago_si_gana.toFixed(2)}</div>
              </div>
              <div className={`rounded-lg border p-1.5 sm:p-2 ${
                data.apuesta_si.ganancia_si_gana >= 0
                  ? 'bg-emerald-500/10 border-emerald-500/20'
                  : 'bg-red-500/10 border-red-500/20'
              }`}>
                <div className="text-[9px] sm:text-[10px] text-gray-400">Ganancia SI gana</div>
                <div className={`text-sm sm:text-base font-bold ${
                  data.apuesta_si.ganancia_si_gana >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {data.apuesta_si.ganancia_si_gana >= 0 ? '+' : ''}${data.apuesta_si.ganancia_si_gana.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* NO Hedge Ranking */}
          <div className="rounded-xl bg-gradient-to-br from-red-500/10 to-red-500/5 border border-red-500/20 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-bold text-red-300 mb-2">COBERTURA NO — Ranking de opciones</h3>
            <p className="text-[10px] sm:text-xs text-gray-500 mb-3">
              B = A × (NO% / SI%) — Buscamos: mayor NO% (seguridad), menor B (capital eficiente), umbral alejado del SI.
            </p>

            {data.opciones_no.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-xs sm:text-sm">No hay contratos NO disponibles para cobertura.</div>
            )}

            {data.opciones_no.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] sm:text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700/30">
                      <th className="text-left py-1.5 pr-2">#</th>
                      <th className="text-left py-1.5 pr-2">Contrato</th>
                      <th className="text-right py-1.5 pr-2">SI%</th>
                      <th className="text-right py-1.5 pr-2">NO%</th>
                      <th className="text-right py-1.5 pr-2">B $</th>
                      <th className="text-right py-1.5 pr-2">Total Inv.</th>
                      <th className="text-right py-1.5 pr-2">Pago NO gana</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.opciones_no.slice(0, 8).map((op, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-gray-700/20 ${
                          idx === 0 ? 'bg-yellow-500/5' : ''
                        }`}
                      >
                        <td className="py-1.5 pr-2 text-gray-500">{idx + 1}</td>
                        <td className="py-1.5 pr-2">
                          <span className={`${idx === 0 ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>
                            {op.etiqueta}
                          </span>
                          {idx === 0 && (
                            <span className="ml-1.5 text-[8px] sm:text-[9px] font-bold text-yellow-500 bg-yellow-500/20 px-1 py-0.5 rounded-full">MEJOR</span>
                          )}
                        </td>
                        <td className="text-right py-1.5 pr-2 text-gray-400">{op.si_pct}%</td>
                        <td className="text-right py-1.5 pr-2">
                          <span className={op.no_pct >= 90 ? 'text-emerald-400 font-bold' : 'text-amber-300'}>
                            {op.no_pct}%
                          </span>
                        </td>
                        <td className="text-right py-1.5 pr-2 font-mono text-white">${op.b_necesario.toFixed(2)}</td>
                        <td className="text-right py-1.5 pr-2 font-mono text-gray-300">${op.inversion_total.toFixed(2)}</td>
                        <td className="text-right py-1.5 pr-2 font-mono text-emerald-400">${op.pago_no_gana.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Best Option Detailed Scenarios */}
          {data.mejor_opcion && (
            <div className="rounded-xl bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 border border-yellow-500/30 p-3 sm:p-4">
              <h3 className="text-sm sm:text-base font-bold text-yellow-400 mb-2">
                ★ MEJOR OPCIÓN — NO en {data.mejor_opcion.etiqueta} (NO {data.mejor_opcion.no_pct}%)
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <div className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-[9px] sm:text-[10px] text-gray-500">B (hedge)</div>
                  <div className="text-base sm:text-lg font-bold text-red-300">${data.mejor_opcion.b_necesario.toFixed(2)}</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-[9px] sm:text-[10px] text-gray-500">Shares NO</div>
                  <div className="text-base sm:text-lg font-bold text-white">{data.mejor_opcion.shares_no.toFixed(2)}</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-[9px] sm:text-[10px] text-gray-500">Inversión total</div>
                  <div className="text-base sm:text-lg font-bold text-amber-300">${data.mejor_opcion.inversion_total.toFixed(2)}</div>
                </div>
                <div className="bg-slate-800/60 rounded-lg p-2">
                  <div className="text-[9px] sm:text-[10px] text-gray-500">Pago NO gana</div>
                  <div className="text-base sm:text-lg font-bold text-emerald-400">${data.mejor_opcion.pago_no_gana.toFixed(2)}</div>
                </div>
              </div>

              {/* Scenario Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] sm:text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700/30">
                      <th className="text-left py-1.5 pr-2">Escenario</th>
                      <th className="text-right py-1.5 pr-2">SI P&L</th>
                      <th className="text-right py-1.5 pr-2">NO P&L</th>
                      <th className="text-right py-1.5 pr-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      data.mejor_opcion.escenario_si_gana_no_pierde,
                      data.mejor_opcion.escenario_ambos_ganan,
                      data.mejor_opcion.escenario_si_pierde_no_gana,
                      data.mejor_opcion.escenario_peor_caso,
                    ].map((esc, i) => (
                      <tr key={i} className={`border-b border-gray-700/20 ${
                        i === 2 ? 'bg-emerald-500/5' :
                        i === 3 ? 'bg-red-500/5' : ''
                      }`}>
                        <td className="py-1.5 pr-2">
                          <span className={`
                            ${i === 2 ? 'text-emerald-400 font-semibold' : ''}
                            ${i === 3 ? 'text-red-400 font-semibold' : ''}
                            ${i !== 2 && i !== 3 ? 'text-gray-300' : ''}
                          `}>
                            {esc.label}
                          </span>
                        </td>
                        <td className={`text-right py-1.5 pr-2 font-mono ${esc.pnl_si >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {esc.pnl_si >= 0 ? '+' : ''}${esc.pnl_si.toFixed(2)}
                        </td>
                        <td className={`text-right py-1.5 pr-2 font-mono ${esc.pnl_no >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {esc.pnl_no >= 0 ? '+' : ''}${esc.pnl_no.toFixed(2)}
                        </td>
                        <td className={`text-right py-1.5 pr-2 font-mono font-bold ${esc.total >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {esc.total >= 0 ? '+' : ''}${esc.total.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Footer Info */}
          <div className="text-center text-[9px] sm:text-[10px] text-gray-600 pt-2 border-t border-gray-700/30">
            {data.total_contratos_disponibles} contratos disponibles en Polymarket · Análisis generado {analisisDate}
          </div>
        </div>
      )}
    </div>
  )
}
