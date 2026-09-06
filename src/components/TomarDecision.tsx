import { useState, useEffect, useCallback } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'
import BrierPanel from './BrierPanel'
import ShadowPanel from './ShadowPanel'

interface DecisionDay {
  fecha_objetivo: string
  temp_real: number | null
  /** true si la base fue reconstruida (estimada) vs viene de temp_corregida_base real */
  base_estimada: boolean
  base_10pm: number | null
  base_11pm: number | null
  mc_10pm: number | null
  mc_11pm: number | null
  mc_err_10pm: number | null
  mc_err_11pm: number | null
  kal_10pm: number | null
  kal_11pm: number | null
  kal_err_10pm: number | null
  kal_err_11pm: number | null
  final_10pm: number | null
  final_11pm: number | null
  final_err_10pm: number | null
  final_err_11pm: number | null
  mc_acierto: boolean | null
  kal_acierto: boolean | null
  final_acierto: boolean | null
  modelo_ganador: string | null
  /** Cubo redondeado al que se refieren p_prod_cubo/p_som_cubo (round(real) si resolvió, si no round(temp)) */
  cubo: number | null
  /** Prob PRODUCCIÓN (prob_ia_norm) del cubo — solo visual, no afecta la recomendación */
  p_prod_cubo: number | null
  /** Prob SOMBRA v2 (receta congelada) del mismo cubo — solo visual, no afecta la recomendación */
  p_som_cubo: number | null
}

interface DecisionCityResult {
  slug: string
  nombre: string
  modelo_activo: string
  days: DecisionDay[]
  mc_mae: number | null
  kal_mae: number | null
  final_mae: number | null
  mc_aciertos: number
  kal_aciertos: number
  final_aciertos: number
  mc_gana_vs_kal: number
  kal_gana_vs_mc: number
  empates: number
  total_con_real: number
  pendientes: number
  recomendacion: 'MC' | 'KALMAN' | 'FINAL' | 'EMPATE'
  rec_mae_diff: number
}

type CiudadFilter = 'todas' | string
type SubTab = 'modelos' | 'duelo'

export default function TomarDecision() {
  const [data, setData] = useState<Record<string, DecisionCityResult> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ciudad, setCiudad] = useState<CiudadFilter>('todas')
  const [dias, setDias] = useState(30)
  const [subtab, setSubtab] = useState<SubTab>('modelos')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ dias: String(dias) })
      if (ciudad !== 'todas') params.set('ciudad', ciudad)
      const res = await fetch(`/api/decision-tab?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json.ciudades)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [ciudad, dias])

  useEffect(() => { fetchData() }, [fetchData])

  const ciudadesList = data ? Object.values(data) : []
  const filteredCities = ciudad === 'todas'
    ? ciudadesList
    : ciudadesList.filter(c => c.slug === ciudad)

  // Summary across all filtered cities
  const totals = filteredCities.reduce((acc, c) => {
    acc.mc_mae_sum += (c.mc_mae ?? 0)
    acc.kal_mae_sum += (c.kal_mae ?? 0)
    acc.final_mae_sum += (c.final_mae ?? 0)
    acc.mc_aciertos += c.mc_aciertos
    acc.kal_aciertos += c.kal_aciertos
    acc.final_aciertos += c.final_aciertos
    acc.mc_gana += c.mc_gana_vs_kal
    acc.kal_gana += c.kal_gana_vs_mc
    acc.empates += c.empates
    acc.total_real += c.total_con_real
    acc.count++
    return acc
  }, { mc_mae_sum: 0, kal_mae_sum: 0, final_mae_sum: 0, mc_aciertos: 0, kal_aciertos: 0, final_aciertos: 0, mc_gana: 0, kal_gana: 0, empates: 0, total_real: 0, count: 0 })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl bg-gradient-to-r from-amber-600/20 via-orange-500/10 to-amber-600/20 border border-amber-500/20 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-amber-300">Para TOMAR DECISIÓN</h2>
            <p className="text-xs text-gray-400 mt-1">
              Compara MC vs KALMAN vs FINAL (modelo ganador) a 10PM y 11PM con <span className="text-amber-300 font-medium">sesgo dinámico + nowcast incluidos</span>.
              La BASE es temp_corregida_base (ensemble + nowcast + sesgo backtest). MC y KALMAN suman su bias corrector sobre esa base.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={ciudad}
              onChange={e => setCiudad(e.target.value)}
              className="bg-slate-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
            >
              <option value="todas">Todas las ciudades</option>
              {CIUDADES_ASIA.map(c => (
                <option key={c.slug} value={c.slug}>{c.nombre}</option>
              ))}
            </select>
            <select
              value={dias}
              onChange={e => setDias(Number(e.target.value))}
              className="bg-slate-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white"
            >
              {[15, 30, 60, 90].map(d => (
                <option key={d} value={d}>{d} días</option>
              ))}
            </select>
            <button onClick={fetchData} disabled={loading} className="btn-primary text-xs px-3 py-1.5">
              {loading ? '...' : 'Actualizar'}
            </button>
          </div>
        </div>
      </div>

      {/* Subpestañas */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setSubtab('modelos')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            subtab === 'modelos'
              ? 'bg-amber-500/20 border-amber-400/40 text-amber-200'
              : 'bg-slate-800 border-gray-700 text-gray-400 hover:text-gray-200'
          }`}
        >
          🌡️ Modelos de temperatura (MC vs KALMAN)
        </button>
        <button
          onClick={() => setSubtab('duelo')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            subtab === 'duelo'
              ? 'bg-orange-500/20 border-orange-400/40 text-orange-200'
              : 'bg-slate-800 border-gray-700 text-gray-400 hover:text-gray-200'
          }`}
        >
          🥊 Duelo de probs (Producción vs Sombra v2)
        </button>
      </div>

      {subtab === 'duelo' ? (
        /* Subpestaña 2: comparación diaria producción vs receta candidata — NO toca los cálculos actuales */
        <ShadowPanel />
      ) : (
        <>
      {/* Calibración Brier: ¿son confiables las probabilidades antes de apostar? */}
      <BrierPanel />

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 px-1">
        <span><span className="inline-block w-2 h-2 rounded-full bg-cyan-400 mr-1"></span>MC = base + mean(errors históricos)</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-purple-400 mr-1"></span>KALMAN = base + bias exponencial (~9 días memoria)</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-1"></span>FINAL = valor del Resumen (modelo ganador ya aplicado)</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1"></span>BASE = ensemble + nowcast + sesgo dinámico (sin MC ni KALMAN)</span>
        <span title="Probabilidad de cada versión para el cubo redondeado (día resuelto: el cubo que SALIÓ; día pendiente: el cubo del centro). Producción = prob_ia_norm guardada · SOMBRA v2 = receta congelada (centro único + t(4)·σ=1.5). Solo comparación visual.">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-400 mr-1"></span>P. CUBO = prob del cubo redondeado: PRODUCCIÓN (cian) vs SOMBRA v2 (naranja) — solo visual, no afecta la recomendación
        </span>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
          Error: {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-blue-400/30 border-t-blue-400 mr-3"></span>
          Cargando datos...
        </div>
      )}

      {data && (
        <>
          {/* Global Summary Card */}
          {filteredCities.length > 1 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard
                label="MC (promedio)"
                mae={totals.count > 0 ? round2(totals.mc_mae_sum / totals.count) : null}
                aciertos={totals.mc_aciertos}
                total={totals.total_real}
                color="cyan"
              />
              <SummaryCard
                label="KALMAN (exp)"
                mae={totals.count > 0 ? round2(totals.kal_mae_sum / totals.count) : null}
                aciertos={totals.kal_aciertos}
                total={totals.total_real}
                color="purple"
              />
              <SummaryCard
                label="FINAL (ganador)"
                mae={totals.count > 0 ? round2(totals.final_mae_sum / totals.count) : null}
                aciertos={totals.final_aciertos}
                total={totals.total_real}
                color="emerald"
              />
              <div className="rounded-xl bg-slate-800/80 border border-gray-700/30 p-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Head-to-Head MC vs KALMAN</p>
                <p className="text-lg font-bold text-white mt-1">
                  <span className="text-cyan-400">{totals.mc_gana}</span>
                  <span className="text-gray-600 mx-1">-</span>
                  <span className="text-gray-500">{totals.empates}</span>
                  <span className="text-gray-600 mx-1">-</span>
                  <span className="text-purple-400">{totals.kal_gana}</span>
                </p>
                <p className="text-[10px] text-gray-600">MC gana — empate — KALMAN gana</p>
              </div>
            </div>
          )}

          {/* Per-city tables */}
          {filteredCities.map(city => (
            <CityTable key={city.slug} city={city} />
          ))}
        </>
      )}
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, mae, aciertos, total, color }: {
  label: string; mae: number | null; aciertos: number; total: number; color: string
}) {
  const colorMap: Record<string, string> = {
    cyan: 'text-cyan-400',
    purple: 'text-purple-400',
    emerald: 'text-emerald-400',
  }
  const pct = total > 0 ? Math.round((aciertos / total) * 100) : 0
  return (
    <div className="rounded-xl bg-slate-800/80 border border-gray-700/30 p-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${colorMap[color] || 'text-white'} mt-1`}>
        {mae !== null ? `${mae}°C` : '-'}
      </p>
      <p className="text-xs text-gray-400 mt-1">
        {aciertos}/{total} aciertos ({pct}%)
      </p>
    </div>
  )
}

function CityTable({ city }: { city: DecisionCityResult }) {
  const [expanded, setExpanded] = useState(false)
  const recColor: Record<string, string> = {
    MC: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    KALMAN: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    FINAL: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    EMPATE: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  }
  const recLabel: Record<string, string> = {
    MC: 'Usar MC',
    KALMAN: 'Usar KALMAN',
    FINAL: 'Usar FINAL (ganador)',
    EMPATE: 'Indistinto',
  }

  // Last 7 days for quick view
  const recentDays = city.days.slice(-7)
  const showDays = expanded ? city.days : recentDays

  const recBadge = (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${recColor[city.recomendacion]}`}>
      {city.recomendacion === 'MC' ? '🔵' : city.recomendacion === 'KALMAN' ? '🟣' : city.recomendacion === 'FINAL' ? '🟢' : '⚪'}
      {recLabel[city.recomendacion]}
    </span>
  )

  return (
    <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
      {/* City Header */}
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 cursor-pointer hover:bg-slate-700/30 transition"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white">{city.nombre}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-gray-400">{city.modelo_activo}</span>
          {recBadge}
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="text-center">
            <p className="text-gray-500">MC MAE</p>
            <p className="font-bold text-cyan-400">{city.mc_mae ?? '-'}°C</p>
          </div>
          <div className="text-center">
            <p className="text-gray-500">KALMAN MAE</p>
            <p className="font-bold text-purple-400">{city.kal_mae ?? '-'}°C</p>
          </div>
          <div className="text-center">
            <p className="text-gray-500">FINAL MAE</p>
            <p className="font-bold text-emerald-400">{city.final_mae ?? '-'}°C</p>
          </div>
          <div className="text-center">
            <p className="text-gray-500">MC vs KAL</p>
            <p className="font-bold text-white">
              <span className="text-cyan-400">{city.mc_gana_vs_kal}</span>
              <span className="text-gray-600">-</span>
              <span className="text-purple-400">{city.kal_gana_vs_mc}</span>
            </p>
          </div>
          <span className="text-gray-600 text-[10px]">{city.total_con_real}d</span>
          <span className="text-gray-600">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-t border-gray-700/30 bg-slate-800/80">
              <th className="px-2 py-2 text-left text-gray-500 font-medium whitespace-nowrap">Fecha</th>
              <th className="px-2 py-2 text-center text-gray-500 font-medium whitespace-nowrap">Real</th>
              <th className="px-2 py-2 text-center text-amber-400/70 font-medium whitespace-nowrap" colSpan={2}>BASE</th>
              <th className="px-2 py-2 text-center text-cyan-400/70 font-medium whitespace-nowrap" colSpan={2}>MC</th>
              <th className="px-2 py-2 text-center text-purple-400/70 font-medium whitespace-nowrap" colSpan={2}>KALMAN</th>
              <th className="px-2 py-2 text-center text-emerald-400/70 font-medium whitespace-nowrap" colSpan={2}>FINAL</th>
              <th
                className="px-2 py-2 text-center text-orange-400/70 font-medium whitespace-nowrap"
                colSpan={2}
                title="Probabilidad del cubo redondeado: PRODUCCIÓN (prob_ia_norm) vs SOMBRA v2 (receta congelada centro único). Día resuelto → cubo que salió; día pendiente → cubo del centro. Solo visual: NO afecta la recomendación."
              >
                P. CUBO
              </th>
              <th className="px-2 py-2 text-center text-gray-500 font-medium whitespace-nowrap">Err MC</th>
              <th className="px-2 py-2 text-center text-gray-500 font-medium whitespace-nowrap">Err KAL</th>
              <th className="px-2 py-2 text-center text-gray-500 font-medium whitespace-nowrap">Err Final</th>
            </tr>
            <tr className="bg-slate-800/50">
              <th></th>
              <th></th>
              <th className="px-1 py-1 text-[9px] text-gray-600">10PM</th>
              <th className="px-1 py-1 text-[9px] text-gray-600">11PM</th>
              <th className="px-1 py-1 text-[9px] text-gray-600">10PM</th>
              <th className="px-1 py-1 text-[9px] text-gray-600">11PM</th>
              <th className="px-1 py-1 text-[9px] text-gray-600">10PM</th>
              <th className="px-1 py-1 text-[9px] text-gray-600">11PM</th>
              <th className="px-1 py-1 text-[9px] text-cyan-500/70">prod</th>
              <th className="px-1 py-1 text-[9px] text-orange-500/70">v2</th>
              <th className="px-1 py-1 text-[9px] text-gray-600">11PM</th>
              <th className="px-1 py-1 text-[9px] text-gray-600">11PM</th>
              <th className="px-1 py-1 text-[9px] text-gray-600">11PM</th>
            </tr>
          </thead>
          <tbody>
            {[...showDays].reverse().map((day) => {
              const isPending = day.temp_real === null
              const cuboTitle = day.cubo != null
                ? `Cubo ${day.cubo}°C · producción ${day.p_prod_cubo != null ? Math.round(day.p_prod_cubo * 100) + '%' : '—'} vs sombra v2 ${day.p_som_cubo != null ? Math.round(day.p_som_cubo * 100) + '%' : '—'}${isPending ? ' · día pendiente (cubo del centro)' : ' · día resuelto (cubo que salió)'} — solo visual, no afecta la recomendación`
                : 'Sin contratos guardados de esta corrida'
              return (
                <tr
                  key={day.fecha_objetivo}
                  className={`border-t border-gray-700/20 ${isPending ? 'opacity-50' : ''}`}
                >
                  <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">
                    {formatFecha(day.fecha_objetivo)}
                    {day.base_estimada && <span className="ml-1 text-[8px] text-amber-500/70" title="Base estimada (temp_corregida_base no existía en esta corrida)">~</span>}
                  </td>
                  <td className={`px-2 py-1.5 text-center font-medium ${isPending ? 'text-gray-600' : 'text-white'}`}>
                    {day.temp_real !== null ? day.temp_real.toFixed(1) : '...'}
                  </td>
                  {/* BASE */}
                  <td className="px-1 py-1.5 text-center text-amber-300/80">{fmt(day.base_10pm)}</td>
                  <td className="px-1 py-1.5 text-center text-amber-300">{fmt(day.base_11pm)}</td>
                  {/* MC */}
                  <td className={`px-1 py-1.5 text-center ${day.mc_acierto === true ? 'text-cyan-300 font-bold' : day.mc_acierto === false ? 'text-cyan-500/60' : 'text-cyan-400'}`}>
                    {fmt(day.mc_10pm)}
                  </td>
                  <td className={`px-1 py-1.5 text-center ${day.mc_acierto === true ? 'text-cyan-300 font-bold' : day.mc_acierto === false ? 'text-cyan-500/60' : 'text-cyan-400'}`}>
                    {fmt(day.mc_11pm)}
                  </td>
                  {/* KALMAN */}
                  <td className={`px-1 py-1.5 text-center ${day.kal_acierto === true ? 'text-purple-300 font-bold' : day.kal_acierto === false ? 'text-purple-500/60' : 'text-purple-400'}`}>
                    {fmt(day.kal_10pm)}
                  </td>
                  <td className={`px-1 py-1.5 text-center ${day.kal_acierto === true ? 'text-purple-300 font-bold' : day.kal_acierto === false ? 'text-purple-500/60' : 'text-purple-400'}`}>
                    {fmt(day.kal_11pm)}
                  </td>
                  {/* FINAL */}
                  <td className={`px-1 py-1.5 text-center ${day.final_acierto === true ? 'text-emerald-300 font-bold' : day.final_acierto === false ? 'text-emerald-500/60' : 'text-emerald-400'}`}>
                    {fmt(day.final_10pm)}
                  </td>
                  <td className={`px-1 py-1.5 text-center ${day.final_acierto === true ? 'text-emerald-300 font-bold' : day.final_acierto === false ? 'text-emerald-500/60' : 'text-emerald-400'}`}>
                    {fmt(day.final_11pm)}
                  </td>
                  {/* P. CUBO — producción vs sombra v2 (solo visual, no afecta la decisión) */}
                  <td className="px-1 py-1.5 text-center text-cyan-400/90" title={cuboTitle}>
                    {fmtPct(day.p_prod_cubo)}
                  </td>
                  <td className="px-1 py-1.5 text-center text-orange-400 font-medium" title={cuboTitle}>
                    {fmtPct(day.p_som_cubo)}
                  </td>
                  {/* Errors (11PM preferred) */}
                  <td className={`px-1 py-1.5 text-center ${errColor(day.mc_err_11pm ?? day.mc_err_10pm)}`}>
                    {fmtErr(day.mc_err_11pm ?? day.mc_err_10pm)}
                  </td>
                  <td className={`px-1 py-1.5 text-center ${errColor(day.kal_err_11pm ?? day.kal_err_10pm)}`}>
                    {fmtErr(day.kal_err_11pm ?? day.kal_err_10pm)}
                  </td>
                  <td className={`px-1 py-1.5 text-center ${errColor(day.final_err_11pm ?? day.final_err_10pm)}`}>
                    {fmtErr(day.final_err_11pm ?? day.final_err_10pm)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Expand/collapse hint */}
      {city.days.length > 7 && (
        <div className="px-3 py-2 text-center text-[10px] text-gray-600 border-t border-gray-700/20">
          {expanded
            ? `Mostrando todos los ${city.days.length} días`
            : `Mostrando últimos 7 de ${city.days.length} días — click para expandir`
          }
        </div>
      )}
    </div>
  )
}

function formatFecha(fecha: string): string {
  const [y, m, d] = fecha.split('-')
  const date = new Date(fecha + 'T12:00:00')
  const dayName = date.toLocaleDateString('es-ES', { weekday: 'short' })
  return `${d}/${m} ${dayName}`
}

function fmt(v: number | null): string {
  if (v === null) return '-'
  return v.toFixed(1)
}

function fmtErr(v: number | null): string {
  if (v === null) return '-'
  return v.toFixed(2)
}

function fmtPct(v: number | null): string {
  if (v === null) return '-'
  return Math.round(v * 100) + '%'
}

function errColor(v: number | null): string {
  if (v === null) return 'text-gray-600'
  if (v <= 0.5) return 'text-emerald-400 font-medium'
  if (v <= 1.0) return 'text-yellow-400'
  if (v <= 1.5) return 'text-orange-400'
  return 'text-red-400'
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
