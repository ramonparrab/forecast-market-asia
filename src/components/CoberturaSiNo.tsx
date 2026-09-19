import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'

const allSlugs = CIUDADES_ASIA.map(c => ({ slug: c.slug, nombre: c.nombre }))

// ── Tipos de respuesta de la API ─────────────────────────────────────────────
interface ContractInfo { tipo: string; valor: number | [number, number]; prob_mkt: number; texto: string }

interface ApuestaSI { monto: number; shares: number; pago_si_gana: number; ganancia_si_gana: number; perdida_si_pierde: number }
interface Escenario { label: string; pnl_si: number; pnl_no: number; total: number }

interface OpcionNO {
  contrato: ContractInfo; etiqueta: string; si_pct: number; no_pct: number
  b_necesario: number; shares_no: number; pago_no_gana: number; ganancia_no_gana: number
  inversion_total: number
  escenario_si_gana_no_pierde: Escenario; escenario_si_pierde_no_gana: Escenario
  escenario_ambos_ganan: Escenario; escenario_peor_caso: Escenario
}

interface EstrellaInfo {
  bucket: number; etiqueta: string; precio_si_pct: number; precio_no_pct: number
  zona: 'DULCE' | 'AGRESIVA' | 'CARA' | 'LOTERIA'; zona_detalle: string
  stake: number; shares: number; pago_si_gana: number; ganancia_si_gana: number; texto: string
}

interface AbanicoLeg {
  bucket: number; distancia: number; etiqueta: string; si_pct: number; no_pct: number
  stake: number; shares_no: number; pago_si_no_cae: number; texto: string
}

interface EscenarioEstrella { caso: string; tipo: string; detalle: string; pnl: number }

interface CiudadRanking {
  slug: string; ciudad: string; fecha: string; combinado: number
  estrella: EstrellaInfo; abanico_n: number; suma_cobertura: number
  ev_mercado: number; conviccion: number; liquidez: string
  mejor_caso: number; peor_caso: number; score: number; medalla: string; puesto: number
}

interface Leyendas { timing: string; noperder: string; estrella: string; abanico: string; sigma: string; ranking: string; zona_dulce: string }

interface CoberturaData {
  modo: string; fecha: string; fecha_polymarket: string; fecha_ejecucion_forecast: string
  slug: string; ciudad: string; timestamp_analisis: string; combinado: number
  total_contratos_disponibles: number; hora_snapshot: string; leyendas: Leyendas
  // noperder
  umbral_si?: number; umbral_ajustado?: number | null
  contratos_si?: ContractInfo[]; costo_si_pct?: string; apuesta_si?: ApuestaSI
  opciones_no?: OpcionNO[]; mejor_opcion?: OpcionNO | null
  // estrella
  monto?: number; estrella?: EstrellaInfo; abanico?: AbanicoLeg[]
  suma_cobertura?: number; escenarios?: EscenarioEstrella[]
  mejor_caso?: number; peor_caso?: number; ev_mercado?: number; conviccion?: number
  reparto?: { estrella_pct: number; abanico_pct: number }
}

interface RankingData {
  modo: string; monto_por_evento: number; timestamp_analisis: string
  top5: CiudadRanking[]; descartadas: { slug: string; ciudad: string; descartada: string }[]
  leyendas: Leyendas
}

const MODOS = [
  { key: 'noperder', label: '🛡️ NO-PERDER', sub: 'Cobertura total · no perder el día' },
  { key: 'estrella', label: '⭐ ESTRELLA+ABANICO', sub: 'Estilo Bilberry · +17-20% esperanza' },
  { key: 'ranking', label: '🏆 TOP 5 CIUDADES', sub: 'Ranking diario · convicción × liquidez' },
]

const zonaColor = (z: string) =>
  z === 'DULCE' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
  : z === 'AGRESIVA' ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
  : z === 'CARA' ? 'bg-red-500/15 border-red-500/40 text-red-300'
  : 'bg-purple-500/15 border-purple-500/40 text-purple-300'

const pnlColor = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-red-400')

export default function CoberturaSiNo() {
  const [modo, setModo] = useState<'noperder' | 'estrella' | 'ranking'>('noperder')
  const [slug, setSlug] = useState('chongqing')
  const [monto, setMonto] = useState(10)
  const [inputMonto, setInputMonto] = useState('10')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<CoberturaData | null>(null)
  const [rankData, setRankData] = useState<RankingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analisisDate, setAnalisisDate] = useState('')

  const analyze = async (m: string, s: string, mo: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ modo: m, monto: String(mo) })
      if (m !== 'ranking') params.set('slug', s)
      const res = await fetch(`/api/cobertura-si-no?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || 'Error al cargar datos')
      }
      const json = await res.json()
      if (m === 'ranking') { setRankData(json); setData(null) }
      else { setData(json); setRankData(null) }
      const d = new Date(json.timestamp_analisis)
      setAnalisisDate(d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { analyze(modo, slug, monto) }, [modo, slug, monto])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') setMonto(Math.max(1, parseFloat(inputMonto) || 1))
  }

  const leyendas = data?.leyendas || rankData?.leyendas

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-4 sm:p-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg sm:text-xl font-bold text-white">COBERTURA SI/NO — EN VIVO</h2>
          <span className="text-[10px] sm:text-xs bg-blue-500/10 border border-blue-500/30 rounded-full px-3 py-1 text-blue-300 font-semibold">
            ⏰ Entradas: 10PM y 11PM hora Caracas
          </span>
        </div>

        {/* Selector de modo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MODOS.map(m => (
            <button
              key={m.key}
              onClick={() => setModo(m.key as any)}
              className={`text-left rounded-xl border px-3 py-2 transition ${
                modo === m.key
                  ? 'bg-blue-600/20 border-blue-500/50 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                  : 'bg-slate-800/40 border-gray-700/40 hover:border-gray-600'
              }`}
            >
              <div className={`text-xs sm:text-sm font-bold ${modo === m.key ? 'text-blue-300' : 'text-gray-300'}`}>{m.label}</div>
              <div className="text-[9px] sm:text-[10px] text-gray-500">{m.sub}</div>
            </button>
          ))}
        </div>

        {/* Controles */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {modo !== 'ranking' && (
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">Ciudad</label>
              <select
                value={slug}
                onChange={e => setSlug(e.target.value)}
                className="bg-slate-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs sm:text-sm text-white w-28 sm:w-36"
              >
                {allSlugs.map(c => <option key={c.slug} value={c.slug}>{c.nombre}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">
              {modo === 'ranking' ? 'Monto por evento $' : 'Monto $'}
            </label>
            <input
              type="number" value={inputMonto}
              onChange={e => setInputMonto(e.target.value)}
              onKeyDown={handleKeyDown}
              className="bg-slate-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs sm:text-sm text-white w-16 sm:w-20 text-center"
            />
            <button
              onClick={() => setMonto(Math.max(1, parseFloat(inputMonto) || 1))}
              className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] sm:text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
            >
              {loading ? '...' : 'Aplicar'}
            </button>
          </div>
        </div>
      </div>

      {/* Banner en vivo */}
      <div className="text-[10px] sm:text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-4">
        <span className="font-bold text-amber-400">⚠️ ANÁLISIS EN VIVO</span>
        <span className="text-gray-300"> — Datos de Polymarket en tiempo real.</span>
        <div className="mt-1 text-gray-400">
          {modo !== 'ranking' && data && (
            <>Contratos de <span className="font-bold text-amber-300">{data.ciudad}</span> del <span className="font-bold text-amber-300">{data.fecha_polymarket}</span>
            {data.fecha_ejecucion_forecast && <span> — Forecast ejecutado: {data.fecha_ejecucion_forecast.slice(0, 10)}</span>}</>
          )}
          {modo === 'ranking' && rankData && <>Top 5 de las 10 ciudades asiáticas — evento del <span className="font-bold text-amber-300">{rankData.top5[0]?.fecha || '—'}</span></>}
        </div>
        <div className="text-gray-500">Snapshot {modo !== 'ranking' ? (data?.hora_snapshot || '10PM/11PM Caracas') : '10PM/11PM Caracas'}. Válido para {analisisDate || 'ahora'}.</div>
      </div>

      {/* Leyenda del modo activo */}
      {leyendas && (
        <div className={`text-[10px] sm:text-xs rounded-lg px-3 py-2.5 mb-4 border ${
          modo === 'noperder' ? 'bg-emerald-500/5 border-emerald-500/20'
          : modo === 'estrella' ? 'bg-yellow-500/5 border-yellow-500/25'
          : 'bg-purple-500/5 border-purple-500/25'
        }`}>
          <span className={`font-bold ${modo === 'noperder' ? 'text-emerald-400' : modo === 'estrella' ? 'text-yellow-400' : 'text-purple-400'}`}>
            {modo === 'noperder' ? '📖 ' : modo === 'estrella' ? '⭐ ' : '🏆 '}
            {modo === 'noperder' ? leyendas.noperder : modo === 'estrella' ? leyendas.estrella : leyendas.ranking}
          </span>
        </div>
      )}

      {loading && <div className="text-center py-8 text-gray-500 text-sm">Cargando datos en vivo...</div>}
      {error && <div className="text-center py-4 text-red-400 text-xs sm:text-sm border border-red-500/20 rounded-lg bg-red-500/5 mb-4">{error}</div>}

      {/* ═══════════ MODO NO-PERDER ═══════════ */}
      {modo === 'noperder' && data && !loading && (
        <div className="space-y-4">
          {/* SI Bet Section */}
          <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-bold text-blue-300 mb-1">APUESTA SI — Umbral {data.umbral_si}°C</h3>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mb-3">
              💡 El umbral es el redondeo de nuestro pronóstico ({data.combinado}°C). Se compra el SÍ de ese umbral: cada share paga $1 si la máxima real ≥ {data.umbral_si}°C.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">COMBINADO</div>
                <div className="text-base sm:text-lg font-bold text-white">{data.combinado}°C</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Umbral SI (rnd)</div>
                <div className="text-base sm:text-lg font-bold text-blue-300">
                  {data.umbral_si}°C
                  {data.umbral_ajustado && <span className="text-[9px] text-amber-400 ml-1">(ajust. → {data.umbral_ajustado}°C)</span>}
                </div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Costo cartera</div>
                <div className="text-base sm:text-lg font-bold text-white">{data.costo_si_pct}</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Inversión SI</div>
                <div className="text-base sm:text-lg font-bold text-amber-300">${data.apuesta_si!.monto.toFixed(2)}</div>
              </div>
            </div>

            <div className="text-[10px] sm:text-xs text-gray-400 mb-2">Contratos ({data.contratos_si!.length}):</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {data.contratos_si!.map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1 bg-blue-500/15 border border-blue-500/20 rounded px-1.5 py-0.5 text-[10px] sm:text-xs text-blue-300">
                  {c.texto} <span className="text-blue-400">{c.prob_mkt}%</span>
                </span>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-1.5 sm:p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-400">Shares</div>
                <div className="text-sm sm:text-base font-bold text-emerald-300">{data.apuesta_si!.shares.toFixed(2)}</div>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-1.5 sm:p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-400">Pago SI gana</div>
                <div className="text-sm sm:text-base font-bold text-emerald-400">${data.apuesta_si!.pago_si_gana.toFixed(2)}</div>
              </div>
              <div className={`rounded-lg border p-1.5 sm:p-2 ${data.apuesta_si!.ganancia_si_gana >= 0 ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                <div className="text-[9px] sm:text-[10px] text-gray-400">Ganancia SI gana</div>
                <div className={`text-sm sm:text-base font-bold ${data.apuesta_si!.ganancia_si_gana >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.apuesta_si!.ganancia_si_gana >= 0 ? '+' : ''}${data.apuesta_si!.ganancia_si_gana.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* NO Hedge Ranking */}
          <div className="rounded-xl bg-gradient-to-br from-red-500/10 to-red-500/5 border border-red-500/20 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-bold text-red-300 mb-1">COBERTURA NO — Ranking de opciones</h3>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mb-1">
              💡 B = A × (NO% / SI%) — cuánto hay que poner en el NO para rescatar TODO lo apostado si el SÍ falla. Buscamos: mayor NO% (seguridad), menor B (capital eficiente).
            </p>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mb-3">
              💡 El NO gana si la máxima real NO alcanza ese umbral — por eso los contratos lejanos al pronóstico son los más seguros (NO% alto) y los más baratos de cubrir.
            </p>

            {data.opciones_no!.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-xs sm:text-sm">No hay contratos NO disponibles para cobertura.</div>
            )}

            {data.opciones_no!.length > 0 && (
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
                    {data.opciones_no!.slice(0, 8).map((op, idx) => (
                      <tr key={idx} className={`border-b border-gray-700/20 ${idx === 0 ? 'bg-yellow-500/5' : ''}`}>
                        <td className="py-1.5 pr-2 text-gray-500">{idx + 1}</td>
                        <td className="py-1.5 pr-2">
                          <span className={`${idx === 0 ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>{op.etiqueta}</span>
                          {idx === 0 && <span className="ml-1.5 text-[8px] sm:text-[9px] font-bold text-yellow-500 bg-yellow-500/20 px-1 py-0.5 rounded-full">MEJOR</span>}
                        </td>
                        <td className="text-right py-1.5 pr-2 text-gray-400">{op.si_pct}%</td>
                        <td className="text-right py-1.5 pr-2">
                          <span className={op.no_pct >= 90 ? 'text-emerald-400 font-bold' : 'text-amber-300'}>{op.no_pct}%</span>
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
              <h3 className="text-sm sm:text-base font-bold text-yellow-400 mb-1">
                ★ MEJOR OPCIÓN — NO en {data.mejor_opcion.etiqueta} (NO {data.mejor_opcion.no_pct}%)
              </h3>
              <p className="text-[9px] sm:text-[10px] text-gray-500 mb-3">
                💡 Los 4 escenarios muestran el P&L combinado (SÍ + NO) según dónde quede la máxima real. El objetivo del modo: que NI el escenario cubierto NI el peor caso hundan el día.
              </p>

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
                      <tr key={i} className={`border-b border-gray-700/20 ${i === 2 ? 'bg-emerald-500/5' : i === 3 ? 'bg-red-500/5' : ''}`}>
                        <td className="py-1.5 pr-2">
                          <span className={`${i === 2 ? 'text-emerald-400 font-semibold' : i === 3 ? 'text-red-400 font-semibold' : 'text-gray-300'}`}>{esc.label}</span>
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
        </div>
      )}

      {/* ═══════════ MODO ESTRELLA+ABANICO ═══════════ */}
      {modo === 'estrella' && data && !loading && data.estrella && (
        <div className="space-y-4">
          {/* Aviso de riesgo */}
          <div className="text-[10px] sm:text-xs bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <span className="font-bold text-red-400">⚠️ MODO CON RIESGO DE PÉRDIDA</span>
            <span className="text-gray-300"> — A diferencia de NO-PERDER, aquí puedes perder hasta ${data.monto?.toFixed(2)} si la máxima cae en el vecino equivocado. A cambio: la esperanza por evento de Bilberry fue +17% a +20%.</span>
          </div>

          {/* Hero estrella */}
          <div className="rounded-xl bg-gradient-to-br from-yellow-500/15 via-amber-500/5 to-slate-900 border border-yellow-500/40 p-4 sm:p-5 relative overflow-hidden">
            <div className="absolute -right-6 -top-6 text-[120px] opacity-5 select-none pointer-events-none">⭐</div>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-yellow-400 mb-1">LA ESTRELLA — {data.estrella.etiqueta}</h3>
                <p className="text-[9px] sm:text-[10px] text-gray-500 max-w-md">
                  💡 Nuestro cubo de máxima convicción: el pronóstico combinado ({data.combinado}°C) redondeado. Bilberry concentraba el 86% de su dinero SÍ en un único entero como este, comprado en la zona 35-95¢.
                </p>
              </div>
              <span className={`text-[10px] sm:text-xs font-bold border rounded-full px-2.5 py-1 whitespace-nowrap ${zonaColor(data.estrella.zona)}`}>
                ZONA {data.estrella.zona} · {data.estrella.precio_si_pct}¢
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
              <div className="bg-slate-800/70 rounded-lg p-2 col-span-2 sm:col-span-1">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Cubo estrella</div>
                <div className="text-2xl sm:text-3xl font-black text-yellow-300">{data.estrella.bucket}<span className="text-sm">°C</span></div>
              </div>
              <div className="bg-slate-800/70 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Stake (75%)</div>
                <div className="text-base sm:text-lg font-bold text-amber-300">${data.estrella.stake.toFixed(2)}</div>
              </div>
              <div className="bg-slate-800/70 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Shares SÍ</div>
                <div className="text-base sm:text-lg font-bold text-white">{data.estrella.shares.toFixed(2)}</div>
              </div>
              <div className="bg-slate-800/70 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Pago si acierta</div>
                <div className="text-base sm:text-lg font-bold text-emerald-400">${data.estrella.pago_si_gana.toFixed(2)}</div>
              </div>
              <div className="bg-slate-800/70 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Ganancia</div>
                <div className="text-base sm:text-lg font-bold text-emerald-400">+${data.estrella.ganancia_si_gana.toFixed(2)}</div>
              </div>
            </div>

            {/* Barra de reparto */}
            <div className="mb-1 flex justify-between text-[9px] sm:text-[10px] text-gray-500">
              <span>REPARTO DEL CAPITAL</span>
              <span>{data.estrella.texto}</span>
            </div>
            <div className="flex h-6 rounded-lg overflow-hidden border border-gray-700/50 text-[9px] sm:text-[10px] font-bold">
              <div className="bg-yellow-500/70 text-slate-900 flex items-center justify-center" style={{ width: '75%' }}>
                ⭐ ESTRELLA 75% — ${data.estrella.stake.toFixed(2)}
              </div>
              <div className="bg-red-500/60 text-white flex items-center justify-center" style={{ width: '25%' }}>
                ABANICO NO 25%
              </div>
            </div>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mt-2">
              💡 {data.estrella.zona_detalle}
            </p>
          </div>

          {/* Abanico NO */}
          <div className="rounded-xl bg-gradient-to-br from-red-500/10 to-red-500/5 border border-red-500/20 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-bold text-red-300 mb-1">EL ABANICO NO — Vecinos ±1° y ±2°</h3>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mb-1">
              💡 Cada NO del abanico gana SIEMPRE que la máxima NO sea ese entero exacto — incluso si la estrella acierta. Solo pierde si la temperatura cae JUSTO en su cubo.
            </p>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mb-3">
              💡 El stake se reparte ∝ probabilidad de cada vecino: el ±1° (fallo más probable de la estrella) se lleva el mayor peso — es el rescate más barato y más probable.
            </p>

            {data.abanico!.length === 0 && (
              <div className="text-center py-4 text-gray-500 text-xs sm:text-sm">No hay vecinos con contrato disponible para el abanico.</div>
            )}

            {data.abanico!.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] sm:text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700/30">
                      <th className="text-left py-1.5 pr-2">Cubo</th>
                      <th className="text-left py-1.5 pr-2">Dist.</th>
                      <th className="text-right py-1.5 pr-2">P(SÍ) mkt</th>
                      <th className="text-right py-1.5 pr-2">Costo NO</th>
                      <th className="text-right py-1.5 pr-2">Stake</th>
                      <th className="text-right py-1.5 pr-2">Shares NO</th>
                      <th className="text-right py-1.5 pr-2">Paga si NO cae ahí</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.abanico!.map((a, i) => (
                      <tr key={i} className={`border-b border-gray-700/20 ${Math.abs(a.distancia) === 1 ? 'bg-amber-500/5' : ''}`}>
                        <td className="py-1.5 pr-2">
                          <span className="text-white font-bold">{a.etiqueta}</span>
                          {Math.abs(a.distancia) === 1 && <span className="ml-1.5 text-[8px] font-bold text-amber-500 bg-amber-500/20 px-1 py-0.5 rounded-full">RESCATE</span>}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-400">{a.distancia > 0 ? '+' : ''}{a.distancia}°</td>
                        <td className="text-right py-1.5 pr-2 text-gray-400">{a.si_pct}%</td>
                        <td className="text-right py-1.5 pr-2 text-red-300">{a.no_pct}¢</td>
                        <td className="text-right py-1.5 pr-2 font-mono text-amber-300">${a.stake.toFixed(2)}</td>
                        <td className="text-right py-1.5 pr-2 font-mono text-white">{a.shares_no.toFixed(2)}</td>
                        <td className="text-right py-1.5 pr-2 font-mono text-emerald-400">${a.pago_si_no_cae.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Σ cobertura */}
          <div className="rounded-xl bg-slate-800/40 border border-gray-700/40 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="text-sm sm:text-base font-bold text-purple-300">Σ COBERTURA — {(data.suma_cobertura! * 100).toFixed(0)}%</h3>
              <span className="text-[10px] text-gray-500">Bilberry: Σ≈57% · Modo NO-PERDER: Σ≤95%</span>
            </div>
            <div className="h-4 rounded-full bg-slate-900 border border-gray-700/50 overflow-hidden relative">
              <div className="h-full bg-gradient-to-r from-purple-600 to-purple-400" style={{ width: Math.min(100, data.suma_cobertura! * 100) + '%' }} />
              <div className="absolute top-0 bottom-0 w-px bg-emerald-400/70" style={{ left: '57%' }} title="Nivel Bilberry (57%)" />
            </div>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mt-2">
              💡 {data.leyendas.sigma} La línea verde marca el nivel típico de Bilberry (57%): cubrir menos masa = capital más eficiente, con días fallidos asumidos.
            </p>
          </div>

          {/* Matriz de escenarios */}
          <div className="rounded-xl bg-slate-800/40 border border-gray-700/40 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-bold text-white mb-1">ESCENARIOS — Si la máxima real queda en…</h3>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mb-3">
              💡 P&L total de las ${(data.monto!).toFixed(2)} invertidas (estrella + abanico) según el entero que gane. Fíjate: en casi todos los escenarios hay AL MENOS una pata que cobra.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] sm:text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700/30">
                    <th className="text-left py-1.5 pr-2">Escenario</th>
                    <th className="text-left py-1.5 pr-2 hidden sm:table-cell">Qué pasa</th>
                    <th className="text-right py-1.5 pr-2">P&L total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.escenarios!.map((e, i) => (
                    <tr key={i} className={`border-b border-gray-700/20 ${
                      e.tipo === 'estrella' ? 'bg-emerald-500/10' : e.tipo === 'otro' ? 'bg-blue-500/5' : 'bg-red-500/5'
                    }`}>
                      <td className="py-1.5 pr-2">
                        <span className={`font-semibold ${e.tipo === 'estrella' ? 'text-emerald-400' : e.tipo === 'otro' ? 'text-blue-300' : 'text-red-300'}`}>
                          {e.tipo === 'estrella' ? '🎯 ' : e.tipo === 'otro' ? '🌀 ' : '⚠️ '}{e.caso}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-gray-500 hidden sm:table-cell">{e.detalle}</td>
                      <td className={`text-right py-1.5 pr-2 font-mono font-bold ${pnlColor(e.pnl)}`}>
                        {e.pnl >= 0 ? '+' : ''}${e.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              <div className="bg-slate-900/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Mejor caso (estrella)</div>
                <div className="text-sm font-bold text-emerald-400">+${(data.mejor_caso!).toFixed(2)}</div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Peor caso (vecino caro)</div>
                <div className="text-sm font-bold text-red-400">${(data.peor_caso!).toFixed(2)}</div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Esperanza mercado</div>
                <div className="text-sm font-bold text-blue-300">{data.ev_mercado}°C</div>
              </div>
              <div className="bg-slate-900/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">Nuestra convicción</div>
                <div className="text-sm font-bold text-yellow-300">{data.conviccion}°C de desvío</div>
              </div>
            </div>
            <p className="text-[9px] sm:text-[10px] text-gray-500 mt-2">
              💡 Convicción = |nuestro pronóstico ({data.combinado}°C) − esperanza del mercado ({data.ev_mercado}°C)|: cuánto creemos que el mercado está mal centrado. Bilberry ganaba con desvíos de este tipo comprados temprano y baratos.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════ MODO TOP 5 CIUDADES ═══════════ */}
      {modo === 'ranking' && rankData && !loading && (
        <div className="space-y-4">
          {/* Podio */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            {rankData.top5.map((c, i) => (
              <div
                key={c.slug}
                className={`rounded-xl border p-3 sm:p-4 relative overflow-hidden ${
                  i === 0
                    ? 'bg-gradient-to-br from-yellow-500/20 via-amber-600/5 to-slate-900 border-yellow-500/50 lg:col-span-2 shadow-[0_0_20px_rgba(234,179,8,0.12)]'
                    : i === 1
                    ? 'bg-gradient-to-br from-slate-400/15 to-slate-900 border-slate-400/40'
                    : i === 2
                    ? 'bg-gradient-to-br from-orange-700/15 to-slate-900 border-orange-600/40'
                    : 'bg-slate-800/40 border-gray-700/40'
                }`}
              >
                <div className="absolute -right-3 -top-4 text-[80px] opacity-[0.07] select-none pointer-events-none">{c.medalla === '🥇' ? '🏆' : c.medalla}</div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{c.medalla}</span>
                  <span className={`text-[9px] font-bold border rounded-full px-2 py-0.5 ${zonaColor(c.estrella.zona)}`}>{c.estrella.zona}</span>
                </div>
                <div className="text-sm sm:text-base font-bold text-white mb-0.5">{c.ciudad}</div>
                <div className="text-[9px] text-gray-500 mb-2">evento {c.fecha}</div>

                <div className="flex items-end gap-2 mb-2">
                  <div className="text-3xl sm:text-4xl font-black text-yellow-300 leading-none">{c.estrella.bucket}<span className="text-sm">°C</span></div>
                  <div className="pb-1">
                    <div className="text-[9px] text-gray-500 leading-tight">estrella</div>
                    <div className="text-[10px] text-gray-400">{c.estrella.precio_si_pct}¢ · {c.abanico_n} NO</div>
                  </div>
                </div>

                {/* barra convicción */}
                <div className="mb-1">
                  <div className="flex justify-between text-[9px] text-gray-500 mb-0.5">
                    <span>CONVICCIÓN {c.conviccion}°C</span>
                    <span>score {c.score.toFixed(2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-900 border border-gray-700/50 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${i === 0 ? 'bg-gradient-to-r from-yellow-600 to-yellow-400' : 'bg-gradient-to-r from-blue-600 to-blue-400'}`}
                      style={{ width: Math.min(100, (c.conviccion / Math.max(...rankData.top5.map(x => x.conviccion), 0.1)) * 100) + '%' }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <div className="bg-slate-900/60 rounded p-1">
                    <div className="text-[8px] text-gray-500">Nuestro fc</div>
                    <div className="text-[11px] font-bold text-white">{c.combinado}°</div>
                  </div>
                  <div className="bg-slate-900/60 rounded p-1">
                    <div className="text-[8px] text-gray-500">Mercado</div>
                    <div className="text-[11px] font-bold text-blue-300">{c.ev_mercado}°</div>
                  </div>
                  <div className="bg-slate-900/60 rounded p-1">
                    <div className="text-[8px] text-gray-500">Liquidez</div>
                    <div className={`text-[11px] font-bold ${c.liquidez === 'ALTA' ? 'text-emerald-400' : c.liquidez === 'MEDIA' ? 'text-amber-300' : 'text-red-400'}`}>{c.liquidez}</div>
                  </div>
                </div>

                <div className="flex justify-between mt-2 text-[10px] font-mono">
                  <span className="text-emerald-400">mejor +${c.mejor_caso.toFixed(2)}</span>
                  <span className="text-red-400">peor ${c.peor_caso.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Leyenda del podio */}
          <div className="rounded-xl bg-slate-800/40 border border-gray-700/40 p-3 sm:p-4">
            <h3 className="text-sm font-bold text-white mb-2">📖 CÓMO LEER EL TOP 5</h3>
            <ul className="text-[10px] sm:text-xs text-gray-400 space-y-1.5 list-disc pl-4">
              <li><span className="text-yellow-300 font-semibold">Estrella</span> — el cubo de nuestra máxima convicción para esa ciudad (pronóstico redondeado). El precio (¢) es lo que cuesta el SÍ.</li>
              <li><span className="text-yellow-300 font-semibold">Convicción</span> — cuánto se desvía nuestro pronóstico de la esperanza del mercado. Más desvío = más valor si tenemos razón. Bilberry vivía de mercados mal centrados como estos.</li>
              <li><span className="text-yellow-300 font-semibold">Score</span> — convicción × factor de liquidez × factor de zona de precio. Es el orden recomendado de apuesta.</li>
              <li><span className="text-yellow-300 font-semibold">Mejor / Peor</span> — P&L por evento de ${rankData.monto_por_evento} con el reparto 75% estrella + 25% abanico NO (modo ESTRELLA+ABANICO).</li>
              <li><span className="text-yellow-300 font-semibold">Zona</span> — DULCE (35-95¢, donde Bilberry ganaba +10-20% consistente), AGRESIVA (20-35¢), CARA (&gt;95¢), LOTERÍA (&lt;20¢).</li>
              <li>💡 Replicar el efecto cartera de Bilberry (44 eventos/día) a nuestra escala: operar estas 5 ciudades el mismo día con montos pequeños descorrelaciona el riesgo — un fallo meteorológico puntual no hunde la jornada.</li>
            </ul>
          </div>

          {/* Descartadas */}
          {rankData.descartadas.length > 0 && (
            <div className="rounded-xl bg-slate-800/20 border border-gray-700/30 p-3">
              <div className="text-[10px] sm:text-xs font-bold text-gray-400 mb-1.5">Descartadas hoy ({rankData.descartadas.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {rankData.descartadas.map(d => (
                  <span key={d.slug} className="text-[9px] sm:text-[10px] text-gray-500 bg-slate-900/60 border border-gray-700/40 rounded px-2 py-0.5" title={d.descartada}>
                    {d.ciudad}: {d.descartada.length > 40 ? d.descartada.slice(0, 40) + '…' : d.descartada}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {(data || rankData) && !loading && (
        <div className="text-center text-[9px] sm:text-[10px] text-gray-600 pt-2 border-t border-gray-700/30 mt-2">
          {modo !== 'ranking'
            ? `${data?.total_contratos_disponibles} contratos disponibles en Polymarket · Análisis generado ${analisisDate}`
            : `Top 5 de ${rankData!.top5.length + rankData!.descartadas.length} ciudades evaluadas · Análisis generado ${analisisDate}`}
          <span className="hidden sm:inline"> · </span>
          <span className="block sm:inline">⏰ Entradas a las 10PM y 11PM hora Caracas, como siempre</span>
        </div>
      )}
    </div>
  )
}
