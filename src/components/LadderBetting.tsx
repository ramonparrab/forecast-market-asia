import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'

const allSlugs = CIUDADES_ASIA.map(c => ({ slug: c.slug, nombre: c.nombre }))

interface Escalon {
  temp: number
  p_ia: number
  p_mkt: number
  si_pct: number
  no_pct: number
  edge: number
  edge_no: number
  monto: number
  pago_si_gana: number
}

interface Plan {
  inversion: number
  sd: number
  escalones: Escalon[]
  probabilidad_ganar: number
  ev: number
  peor_caso: number
  sin_contratos: boolean
  empirica: boolean
}

interface RegimenDetalle {
  delta1: number | null
  tendencia: number | null
  motivo: string
  sd: number
  factor_bankroll: number
}

interface LadderData {
  fecha: string
  fecha_caracas: string
  hora_caracas: string
  ventana_10_11pm: boolean
  diana_esperada: string
  fecha_coincide: boolean
  fecha_ejecucion_forecast: string
  slug: string
  ciudad: string
  timestamp_analisis: string
  crudo: number | null
  corregida: number | null
  modelo_ganador: 'KALMAN' | 'MEJORA CONTINUA'
  hora_ganadora: '10PM' | '11PM' | null
  combos_mae: Record<string, number | null>
  muestras_horas: number
  base_10pm_hoy: number | null
  base_11pm_hoy: number | null
  modelo_asignado: 'KALMAN' | 'MEJORA CONTINUA'
  mae_kalman: number
  mae_mc: number
  ventana_modelos: number
  hist_error_entero: Record<string, number>
  muestras_hist: number
  valor_hoy_modelo: number
  regimen: 'ESTABLE' | 'TRANSICION' | 'CRITICO'
  regimen_detalle: RegimenDetalle
  bankroll_solicitado: number
  plan: Plan
  contratos_disponibles: number
  hora_snapshot: string
  nota_horas: string
  metodologia: string
}

const fmtSigned = (v: number | null): string => {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${Math.round(v * 100) / 100}°`
}

const comboLabel: Record<string, string> = {
  kal_10pm: 'KAL @ 10PM',
  kal_11pm: 'KAL @ 11PM',
  mc_10pm: 'MC @ 10PM',
  mc_11pm: 'MC @ 11PM',
}

export default function LadderBetting() {
  const [slug, setSlug] = useState('wuhan')
  const [monto, setMonto] = useState(10)
  const [inputMonto, setInputMonto] = useState('10')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<LadderData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const analyze = async (s: string, m: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ slug: s, monto: String(m) })
      const res = await fetch(`/api/ladder-betting?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || 'Error al cargar datos')
      }
      setData(await res.json())
    } catch (e) {
      setData(null)
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

  const regimenBanner = () => {
    if (!data) return null
    const r = data.regimen
    const d = data.regimen_detalle
    if (r === 'CRITICO') {
      return (
        <div className="rounded-xl bg-red-600/20 border-2 border-red-500/70 p-4 mb-4 animate-pulse">
          <div className="text-lg sm:text-2xl font-black text-red-400 text-center tracking-wide">🚫 NO APOSTAR EN {data.ciudad.toUpperCase()}</div>
          <div className="mt-2 text-center text-xs sm:text-sm text-red-300 font-semibold">{d.motivo}</div>
          <div className="mt-2 flex flex-wrap justify-center gap-2 text-[10px] sm:text-xs">
            <span className="bg-red-500/20 border border-red-500/40 rounded px-2 py-0.5">Δ 1d: {fmtSigned(d.delta1)}</span>
            <span className="bg-red-500/20 border border-red-500/40 rounded px-2 py-0.5">Tendencia: {fmtSigned(d.tendencia)}</span>
          </div>
        </div>
      )
    }
    if (r === 'TRANSICION') {
      return (
        <div className="rounded-xl bg-amber-500/15 border-2 border-amber-500/60 p-4 mb-4">
          <div className="text-base sm:text-xl font-black text-amber-400 tracking-wide">⚠️ PRONÓSTICO EN TRANSICIÓN</div>
          <div className="mt-1 text-xs sm:text-sm text-amber-300 font-medium">{d.motivo}</div>
          <div className="mt-1 text-[10px] sm:text-xs text-amber-200/80">
            σ ampliada a {d.sd} (×1.5) · bankroll reducido a la mitad (${data.bankroll_solicitado / 2}) · edge mínimo 3%
          </div>
        </div>
      )
    }
    return (
      <div className="rounded-xl bg-emerald-500/10 border-2 border-emerald-500/40 p-4 mb-4">
        <div className="text-base sm:text-xl font-black text-emerald-400 tracking-wide">✅ RÉGIMEN ESTABLE — JUEGO COMPLETO</div>
        <div className="mt-1 text-xs sm:text-sm text-emerald-300/90 font-medium">{d.motivo}</div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-4 sm:p-6 overflow-hidden">
      {/* Header & Controls */}
      <div className="flex flex-col gap-3 mb-4">
        <h2 className="text-lg sm:text-xl font-bold text-white">🪜 LADDER BETTING — EN VIVO</h2>
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
            <label className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">Bankroll $</label>
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

      {/* Fecha objetivo del análisis */}
      {data && !loading && (
        <div className="rounded-xl bg-blue-600/15 border border-blue-500/40 p-3 sm:p-4 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <div>
              <div className="text-[9px] sm:text-[10px] text-blue-400 font-semibold tracking-wide">FECHA OBJETIVO DEL ANÁLISIS — {data.ciudad.toUpperCase()}</div>
              <div className="text-xl sm:text-2xl font-black text-white">{data.fecha} <span className="text-blue-300 text-xs sm:text-sm font-semibold">(día del evento en Asia)</span></div>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-1 text-[10px] sm:text-xs">
              <span className="text-gray-300">
                Snapshot: <span className="font-bold text-white">{data.hora_caracas}</span> Caracas · {data.fecha_caracas}
              </span>
              {data.ventana_10_11pm ? (
                <span className="text-emerald-400 font-bold">✅ Dentro de la ventana 10-11PM — pronóstico listo</span>
              ) : (
                <span className="text-amber-400 font-bold">⚠️ Fuera de la ventana 10-11PM — los precios aún pueden moverse</span>
              )}
              {data.fecha_coincide ? (
                <span className="text-emerald-400 font-semibold">✅ Coincide con la fecha esperada ({data.diana_esperada})</span>
              ) : (
                <span className="text-red-400 font-semibold">⚠️ Esperado para {data.diana_esperada} (Asia) — verifica que sea el día que quieres apostar</span>
              )}
            </div>
          </div>
          {data.fecha_ejecucion_forecast && (
            <div className="mt-1.5 text-[10px] sm:text-xs text-gray-500">
              Forecast ejecutado: {String(data.fecha_ejecucion_forecast).slice(0, 10)} · {data.contratos_disponibles} contratos en Polymarket para esta fecha
            </div>
          )}
        </div>
      )}

      {/* Régimen Banner */}
      {data && !loading && regimenBanner()}

      {/* Loading */}
      {loading && <div className="text-center py-8 text-gray-500 text-sm">Cargando datos en vivo...</div>}

      {/* Error */}
      {error && (
        <div className="text-center py-4 text-red-400 text-xs sm:text-sm border border-red-500/20 rounded-lg bg-red-500/5 mb-4">{error}</div>
      )}

      {/* Results */}
      {data && !loading && (
        <div className="space-y-4">
          {/* Pronóstico y métricas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-[9px] sm:text-[10px] text-gray-500">PRONÓSTICO (crudo)</div>
              <div className="text-base sm:text-lg font-bold text-white">{data.crudo != null ? data.crudo.toFixed(1) + '°C' : '—'}</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-[9px] sm:text-[10px] text-gray-500">CORREGIDA GANADORA {data.hora_ganadora ? `— ${data.modelo_ganador === 'KALMAN' ? 'KAL' : 'MC'} @ ${data.hora_ganadora}` : `— ${data.modelo_ganador === 'KALMAN' ? 'KAL' : 'MC'}`}</div>
              <div className="text-base sm:text-lg font-bold text-blue-300">{data.valor_hoy_modelo.toFixed(2)}°C</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-[9px] sm:text-[10px] text-gray-500">INVERSIÓN TOTAL</div>
              <div className="text-base sm:text-lg font-bold text-amber-300">${data.plan.inversion.toFixed(2)}</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-[9px] sm:text-[10px] text-gray-500">P(GANAR ALGO)</div>
              <div className="text-base sm:text-lg font-bold text-emerald-400">{Math.round(data.plan.probabilidad_ganar * 100)}%</div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-[9px] sm:text-[10px] text-gray-500">EV</div>
              <div className={`text-base sm:text-lg font-bold ${data.plan.ev >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {data.plan.ev >= 0 ? '+' : ''}${data.plan.ev.toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-800/60 rounded-lg p-2">
              <div className="text-[9px] sm:text-[10px] text-gray-500">PEOR CASO</div>
              <div className="text-base sm:text-lg font-bold text-red-400">${data.plan.peor_caso.toFixed(2)}</div>
            </div>
          </div>

          {/* Modelo ganador + patrón histórico */}
          <div className="rounded-xl bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border border-cyan-500/20 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h3 className="text-sm sm:text-base font-bold text-cyan-300">MODELO GANADOR (histórico walk-forward)</h3>
              <span className={`text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full ${
                data.modelo_ganador === 'KALMAN'
                  ? 'bg-cyan-500/15 border border-cyan-400/30 text-cyan-300'
                  : 'bg-emerald-500/15 border border-emerald-400/30 text-emerald-300'
              }`}>
                {data.modelo_ganador === 'KALMAN' ? 'KAL' : 'MC'}{data.hora_ganadora ? ' @ ' + data.hora_ganadora : ''} — MEJOR
              </span>
              {data.modelo_ganador !== data.modelo_asignado && (
                <span className="text-[9px] sm:text-[10px] text-amber-400 font-semibold">
                  ⚠️ difiere del asignado ({data.modelo_asignado === 'KALMAN' ? 'KAL' : 'MC'})
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">MAE KALMAN ({data.ventana_modelos}d)</div>
                <div className={`text-base sm:text-lg font-bold ${data.mae_kalman <= data.mae_mc ? 'text-cyan-400' : 'text-gray-300'}`}>{data.mae_kalman.toFixed(2)}°</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">MAE MEJORA CONT. ({data.ventana_modelos}d)</div>
                <div className={`text-base sm:text-lg font-bold ${data.mae_mc <= data.mae_kalman ? 'text-emerald-400' : 'text-gray-300'}`}>{data.mae_mc.toFixed(2)}°</div>
              </div>
              <div className="bg-slate-800/60 rounded-lg p-2">
                <div className="text-[9px] sm:text-[10px] text-gray-500">DISTRIBUCIÓN LADDER</div>
                <div className="text-base sm:text-lg font-bold text-white">{data.plan.empirica ? `EMPÍRICA (${data.muestras_hist} días)` : 'GAUSS'}</div>
              </div>
            </div>

            {data.muestras_horas >= 10 && (
              <>
                <div className="text-[10px] sm:text-xs text-gray-400 mb-1">
                  MAE de los 4 combos modelo × hora con corridas reales de daily_runs ({data.muestras_horas} días):
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
                  {Object.entries(data.combos_mae || {}).map(([k, v]) => {
                    const keyGanador = (data.modelo_ganador === 'KALMAN' ? 'kal' : 'mc') + '_' + (data.hora_ganadora === '10PM' ? '10pm' : data.hora_ganadora === '11PM' ? '11pm' : '')
                    const esGanador = k === keyGanador
                    return (
                      <span
                        key={k}
                        className={`rounded-lg px-2 py-1 text-center text-[10px] sm:text-xs font-mono border ${
                          esGanador
                            ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-300 font-bold'
                            : 'bg-slate-800/70 border-gray-700 text-gray-400'
                        }`}
                      >
                        {comboLabel[k]}: {v != null ? v.toFixed(2) + '°' : '—'}
                      </span>
                    )
                  })}
                </div>
                <div className="text-[10px] sm:text-xs text-gray-500 mb-2">
                  Base hoy: 10PM={data.base_10pm_hoy != null ? data.base_10pm_hoy.toFixed(2) + '°' : '—'} · 11PM={data.base_11pm_hoy != null ? data.base_11pm_hoy.toFixed(2) + '°' : '—'} (corrida {data.hora_ganadora === '10PM' ? '02:00Z' : '03:00Z'} + modelo)
                </div>
              </>
            )}

            <div className="text-[10px] sm:text-xs text-gray-400 mb-1">
              Cómo se desvía el pronóstico ganador del real en {data.muestras_hist} días (e = entero pronóstico − entero real):
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {Object.entries(data.hist_error_entero).map(([e, pct]) => (
                <span
                  key={e}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-mono border ${
                    pct >= 20
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                      : 'bg-slate-800 border-gray-700 text-gray-400'
                  }`}
                >
                  {Number(e) >= 0 ? '+' : ''}{e}: {pct}%
                </span>
              ))}
            </div>
            <div className="text-[9px] sm:text-[10px] text-gray-500">
              📌 {data.nota_horas}
            </div>
          </div>
          {data.regimen === 'CRITICO' && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/40 p-4 text-center">
              <div className="text-xs sm:text-sm text-red-300 font-bold">
                Bankroll ${data.bankroll_solicitado} NO se invierte. Ningún escalón es válido en régimen crítico.
              </div>
              <div className="mt-1 text-[10px] sm:text-xs text-red-400/70">
                Historial: en saltos ≥2° con tendencia ≥3°, el error de la corrección es la cola gruesa del sistema (hasta 5.5°).
              </div>
            </div>
          )}

          {/* Sin contratos */}
          {data.plan.sin_contratos && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-center text-xs sm:text-sm text-amber-300">
              No hay contratos exactos con edge ≥ 3% en Polymarket para esta ciudad/fecha.
            </div>
          )}

          {/* Ladder table */}
          {data.plan.escalones.length > 0 && (
            <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20 p-3 sm:p-4">
              <h3 className="text-sm sm:text-base font-bold text-blue-300 mb-2">
                🪜 ESCALERA ({data.plan.escalones.length} escalones, σ={data.plan.sd})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] sm:text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-700/30">
                      <th className="text-left py-1.5 pr-2">Escalón</th>
                      <th className="text-right py-1.5 pr-2">P(IA)</th>
                      <th className="text-right py-1.5 pr-2">Mkt SI%</th>
                      <th className="text-right py-1.5 pr-2">Mkt NO%</th>
                      <th className="text-right py-1.5 pr-2">Precio mid</th>
                      <th className="text-right py-1.5 pr-2">Edge SI</th>
                      <th className="text-right py-1.5 pr-2">Edge NO</th>
                      <th className="text-right py-1.5 pr-2">Monto $</th>
                      <th className="text-right py-1.5 pr-2">Pago si gana $</th>
                      <th className="text-right py-1.5 pr-2">Ganancia $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.plan.escalones.map((e, idx) => {
                      const ganancia = e.pago_si_gana - e.monto
                      return (
                        <tr key={e.temp} className={`border-b border-gray-700/20 ${idx === 0 ? 'bg-yellow-500/5' : ''}`}>
                          <td className="py-1.5 pr-2">
                            <span className={`${idx === 0 ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>{e.temp}°C</span>
                            {idx === 0 && (
                              <span className="ml-1.5 text-[8px] sm:text-[9px] font-bold text-yellow-500 bg-yellow-500/20 px-1 py-0.5 rounded-full">TOP EDGE</span>
                            )}
                          </td>
                          <td className="text-right py-1.5 pr-2 font-mono text-white">{Math.round(e.p_ia * 100)}%</td>
                          <td className="text-right py-1.5 pr-2 font-mono text-gray-400">{e.si_pct}%</td>
                          <td className="text-right py-1.5 pr-2 font-mono text-gray-400">{e.no_pct}%</td>
                          <td className="text-right py-1.5 pr-2 font-mono text-amber-300">{Math.round(e.p_mkt * 100)}¢</td>
                          <td className={`text-right py-1.5 pr-2 font-mono font-bold ${e.edge >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {e.edge >= 0 ? '+' : ''}{e.edge.toFixed(1)}pp
                          </td>
                          <td className={`text-right py-1.5 pr-2 font-mono ${e.edge_no >= 3 ? 'text-emerald-400 font-bold' : 'text-gray-500'}`}>
                            {e.edge_no >= 3 ? '+' + e.edge_no.toFixed(1) + 'pp ⭐' : e.edge_no.toFixed(1) + 'pp'}
                          </td>
                          <td className="text-right py-1.5 pr-2 font-mono text-white">${e.monto.toFixed(2)}</td>
                          <td className="text-right py-1.5 pr-2 font-mono text-emerald-400">${e.pago_si_gana.toFixed(2)}</td>
                          <td className={`text-right py-1.5 pr-2 font-mono font-bold ${ganancia >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {ganancia >= 0 ? '+' : ''}${ganancia.toFixed(2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[9px] sm:text-[10px] text-gray-500 mt-2">
                Precio mid sin vig = (SI + (1 − NO)) / 2 · Edge SI = P(IA) − mid · Edge NO = (1 − P(IA)) − NO% (⭐ si ≥ 3pp: el NO de ese escalón también vale la pena)
              </p>
            </div>
          )}

          {/* Footer Info */}
          <div className="text-center text-[9px] sm:text-[10px] text-gray-600 pt-2 border-t border-gray-700/30">
            {data.contratos_disponibles} contratos en Polymarket (Gamma) · {data.metodologia} · Forecast: {data.fecha_ejecucion_forecast?.slice(0, 10) ?? '—'}
          </div>
        </div>
      )}
    </div>
  )
}