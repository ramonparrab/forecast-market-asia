import { useEffect, useState } from 'react'
import type { PerfGlobalResponse, PerfCiudad, PerfDay, PerfClasificacion } from '@/pages/api/performance'

const RANGE_OPCIONES = [15, 30, 60, 90, 120, 365]

function bandaChip(mae: number | null): string {
  return mae == null ? '—' : `${mae}°C`
}

function ClsBadge({ cls }: { cls: PerfClasificacion | null }) {
  if (!cls) return <span className="text-gray-600">—</span>
  switch (cls.etiqueta) {
    case 'ACIERTO':
      return <span className="rounded bg-emerald-500/15 border border-emerald-400/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">✓ ACIERTO</span>
    case 'TEMP+1':
      return <span className="rounded bg-amber-500/15 border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">+1°</span>
    case 'TEMP-1':
      return <span className="rounded bg-amber-500/15 border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">−1°</span>
    case 'TEMP+2':
      return <span className="rounded bg-red-500/15 border border-red-400/30 px-1.5 py-0.5 text-[10px] font-bold text-red-300">+2°</span>
    case 'TEMP-2':
      return <span className="rounded bg-red-500/15 border border-red-400/30 px-1.5 py-0.5 text-[10px] font-bold text-red-300">−2°</span>
    default:
      return <span className="rounded bg-red-500/30 border border-red-400/50 px-1.5 py-0.5 text-[10px] font-bold text-red-200">±3°+</span>
  }
}

function Cell({ val, cls, highlight = false }: { val: number | null; cls: PerfClasificacion | null; highlight?: boolean }) {
  const accent = cls?.etiqueta === 'ACIERTO'
    ? 'text-emerald-300 font-bold'
    : cls?.etiqueta === 'TEMP±3+'
      ? 'text-red-300 font-bold'
      : 'text-gray-300'
  return (
    <td className={`px-2 py-1 text-center text-xs ${accent} ${highlight ? 'bg-blue-500/10 border-l border-r border-blue-500/20' : ''}`}>
      <div>{val != null ? val.toFixed(2) : '—'}</div>
      <div className="mt-0.5"><ClsBadge cls={cls} /></div>
    </td>
  )
}

function CityTable({ ciudad }: { ciudad: PerfCiudad }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-700/30">
      <table className="w-full text-left">
        <thead className="bg-slate-800/80">
          <tr className="text-[10px] uppercase tracking-wider text-gray-500">
            <th className="px-2 py-2">Fecha</th>
            <th className="px-2 py-2 text-center">Real</th>
            <th className="px-2 py-2 text-center text-blue-300" colSpan={2}>✅ ACTIVO · {ciudad.modelo_nombre} (10PM / 11PM)</th>
            <th className="px-2 py-2 text-center" colSpan={2}>MC Combinado (10PM / 11PM)</th>
            <th className="px-2 py-2 text-center" colSpan={2}>Kalman (10PM / 11PM)</th>
            <th className="px-2 py-2 text-center">Veredicto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {ciudad.dias.filter(d => d.temp_real != null).slice().sort((a, b) => b.fecha_objetivo.localeCompare(a.fecha_objetivo)).map(d => (
            <tr key={d.fecha_objetivo} className="hover:bg-slate-800/40">
              <td className="px-2 py-1 text-xs text-gray-400 whitespace-nowrap">{d.fecha_objetivo}</td>
              <td className="px-2 py-1 text-center text-sm font-bold text-white">{d.temp_real}°</td>
              <Cell val={d.act_10pm} cls={d.cls_act10} highlight />
              <Cell val={d.act_11pm} cls={d.cls_act11} highlight />
              <Cell val={d.cur_10pm} cls={d.cls_cur10} />
              <Cell val={d.cur_11pm} cls={d.cls_cur11} />
              <Cell val={d.kal_10pm} cls={d.cls_kal10} />
              <Cell val={d.kal_11pm} cls={d.cls_kal11} />
              <td className="px-2 py-1 text-center text-[10px]">
                {d.veredicto ? (
                  <span className={`inline-block max-w-[140px] rounded px-1.5 py-0.5 font-bold ${d.veredicto.startsWith('🏆') ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                    {d.veredicto}
                  </span>
                ) : <span className="text-gray-600">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalsRow ciudad={ciudad} />
        </tfoot>
      </table>
    </div>
  )
}

function TotalsCol({ mejor }: { mejor: PerfDay['mejor'] }) {
  if (!mejor) return <span className="text-gray-600">—</span>
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${mejor === 'actual' ? 'bg-emerald-500/15 text-emerald-300' : mejor === 'kalman' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-gray-700 text-gray-300'}`}>
      {mejor === 'actual' ? 'MC' : mejor === 'kalman' ? 'KAL' : 'EMP'}
    </span>
  )
}

function TotalsRow({ ciudad }: { ciudad: PerfCiudad }) {
  const sA = ciudad.stats_act
  const sC = ciudad.stats_cur
  const sK = ciudad.stats_kal
  const acAct = Math.round((sA.aciertos_mejor / Math.max(1, sA.n)) * 100)
  const acKal = Math.round((sK.aciertos_mejor / Math.max(1, sK.n)) * 100)
  const acCur = Math.round((sC.aciertos_mejor / Math.max(1, sC.n)) * 100)
  return (
    <tr className="bg-slate-800/60 border-t-2 border-gray-700 text-[11px]">
      <td className="px-2 py-1.5 font-bold text-white" colSpan={2}>
        RESUMEN {ciudad.nombre.toUpperCase()} · {sA.n} días · {ciudad.resumen}
      </td>
      <td className="px-2 py-1.5 text-center text-blue-300" colSpan={2}>
        {ciudad.modelo_nombre}: MAE10 {sA.mae10 ?? '—'} / MAE11 {sA.mae11 ?? '—'}
        <span className="block text-emerald-300">aciertos {sA.aciertos_mejor}/{sA.n} ({acAct}%)</span>
      </td>
      <td className="px-2 py-1.5 text-center text-amber-300" colSpan={2}>
        MC: MAE10 {sC.mae10 ?? '—'} / MAE11 {sC.mae11 ?? '—'}
        <span className="block text-emerald-300">aciertos {sC.aciertos_mejor}/{sC.n} ({acCur}%)</span>
      </td>
      <td className="px-2 py-1.5 text-center text-amber-300" colSpan={2}>
        Kalman: MAE10 {sK.mae10 ?? '—'} / MAE11 {sK.mae11 ?? '—'}
        <span className="block text-cyan-300">aciertos {sK.aciertos_mejor}/{sK.n} ({acKal}%)</span>
      </td>
      <td className="px-2 py-1.5 text-center text-gray-400">
        {ciudad.stats_act.dist ? Object.entries(ciudad.stats_act.dist).map(([k, v]) => `${k}:${v}`).join(' · ') : ''}
      </td>
    </tr>
  )
}

function SummaryCard({ data }: { data: PerfGlobalResponse }) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-blue-900/20 to-slate-900 border border-blue-500/20 p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white">📊 Análisis del Performance · Global</h3>
        <span className="text-[10px] text-gray-500">
          {data.g_total_dias} días con real · MAE mejor col: {bandaChip(data.g_act_max)} (modelo activo) / {bandaChip(data.g_kal_mejor)} (si todo fuera Kalman)
        </span>
      </div>
      {data.analisis.map((l, i) => (
        <p key={i} className="text-xs text-gray-300 leading-relaxed">{l}</p>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-[11px] text-emerald-300">
          🏆 Mejor: {data.ciudades.find(c => c.slug === data.mejor_ciudad)?.nombre ?? '—'}
        </span>
        <span className="rounded-full bg-red-500/10 border border-red-500/30 px-3 py-1 text-[11px] text-red-300">
          ⚠️ Peor: {data.ciudades.find(c => c.slug === data.peor_ciudad)?.nombre ?? '—'}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.ranking_mae.map((c, i) => (
          <div key={c.slug} className={`rounded-lg p-2.5 border text-xs ${i === 0 ? 'bg-emerald-500/10 border-emerald-500/30' : i === data.ranking_mae.length - 1 ? 'bg-red-500/10 border-red-500/30' : 'bg-slate-800/50 border-gray-700/30'}`}>
            <div className="flex items-center justify-between gap-1">
              <span className="font-bold text-white">#{i + 1} {c.nombre}</span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.modelo_activo === 'KALMAN' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{c.modelo_nombre}</span>
            </div>
            <p className="mt-1 text-gray-400">{c.resumen}</p>
            <p className="mt-1 text-[10px] text-gray-500">
              ✅ ACTIVO ({c.modelo_nombre}): MAE {c.stats_act.mae_mejor ?? '—'}° · {c.stats_act.aciertos_mejor}/{c.stats_act.n} | MC: MAE {c.stats_cur.mae_mejor ?? '—'}° · {c.stats_cur.aciertos_mejor}/{c.stats_cur.n} | Kalman: MAE {c.stats_kal.mae_mejor ?? '—'}° · {c.stats_kal.aciertos_mejor}/{c.stats_kal.n}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PerformanceAnalisis() {
  const [dias, setDias] = useState(30)
  const [ciudadSlug, setCiudadSlug] = useState('')
  const [data, setData] = useState<PerfGlobalResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ dias: String(dias) })
    if (ciudadSlug) params.set('ciudad', ciudadSlug)
    fetch(`/api/performance?${params.toString()}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(j => setData(j as PerfGlobalResponse))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [dias, ciudadSlug])

  const ciudadSel = data?.ciudades.find(c => c.slug === ciudadSlug) ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-800/50 border border-gray-700/30 px-4 py-3">
        <span className="text-xs text-gray-400 font-medium">📊 Ventana de días:</span>
        <div className="flex gap-1">
          {RANGE_OPCIONES.map(d => (
            <button
              key={d}
              onClick={() => setDias(d)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${dias === d ? 'bg-blue-600 text-white' : 'bg-slate-800 text-gray-400 hover:text-white'}`}
            >
              {d === 365 ? '365+' : d}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 mx-1">|</span>
        <select
          value={ciudadSlug}
          onChange={e => setCiudadSlug(e.target.value)}
          className="rounded-lg bg-slate-800 border border-gray-600 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">🌏 Global (todas las ciudades)</option>
          {data?.ciudades.map(c => (
            <option key={c.slug} value={c.slug}>{c.nombre} · {c.modelo_nombre}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {loading && !data && (
        <div className="card animate-pulse"><div className="h-24 rounded bg-slate-700"></div></div>
      )}

      {data && (
        <>
          <SummaryCard data={data} />

          {ciudadSel ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-sm font-bold text-white">📋 Detalle diario — {ciudadSel.nombre}</h3>
                <span className="rounded-md bg-slate-800 border border-gray-700 px-2 py-0.5 text-[10px] text-blue-300">modelo activo: {ciudadSel.modelo_nombre}</span>
                <span className="text-[11px] text-gray-500">{ciudadSel.resumen}</span>
              </div>
              <CityTable ciudad={ciudadSel} />
              <div className="rounded-xl bg-slate-800/40 border border-gray-700/30 p-4 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Distribución de errores (Mejora Continua, 10PM)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(ciudadSel.stats_cur.dist).map(([k, v]) => (
                      <span key={k} className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-gray-300">{k}: <b>{v}</b></span>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Ganadores por día en la ventana</p>
                  <p className="text-xs text-gray-300">
                    Mejora Continua ganó <b className="text-emerald-300">{ciudadSel.dias.filter(d => d.mejor === 'actual' && d.temp_real != null).length}</b> días ·
                    Kalman ganó <b className="text-cyan-300">{ciudadSel.dias.filter(d => d.mejor === 'kalman' && d.temp_real != null).length}</b> días ·
                    empates {ciudadSel.dias.filter(d => d.mejor === 'empate' && d.temp_real != null).length}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-700/30">
              <table className="w-full text-left">
                <thead className="bg-slate-800/80">
                  <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Ciudad</th>
                    <th className="px-3 py-2">Modelo activo</th>
                    <th className="px-3 py-2 text-center">Días</th>
                    <th className="px-3 py-2 text-center">MAE 10PM</th>
                    <th className="px-3 py-2 text-center">MAE 11PM</th>
                    <th className="px-3 py-2 text-center">Aciertos 10PM</th>
                    <th className="px-3 py-2 text-center">Aciertos 11PM</th>
                    <th className="px-3 py-2 text-center">Ambos</th>
                    <th className="px-3 py-2 text-center">Mejor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {data.ranking_mae.map((c, i) => (
                    <tr key={c.slug} onClick={() => setCiudadSlug(c.slug)} className={`cursor-pointer ${i === 0 ? 'bg-emerald-500/5' : ''}`}>
                      <td className="px-3 py-2 text-xs text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2 text-xs font-bold text-white">{c.nombre}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${c.modelo_activo === 'KALMAN' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{c.modelo_nombre}</span>
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-gray-300">{c.stats_cur.n}</td>
                      <td className="px-3 py-2 text-center text-xs text-amber-300">{c.stats_cur.mae10 ?? '—'}</td>
                      <td className="px-3 py-2 text-center text-xs text-amber-300">{c.stats_cur.mae11 ?? '—'}</td>
                      <td className="px-3 py-2 text-center text-xs text-emerald-300">{c.stats_cur.aciertos10}/{c.stats_cur.n}</td>
                      <td className="px-3 py-2 text-center text-xs text-emerald-300">{c.stats_cur.aciertos11}/{c.stats_cur.n}</td>
                      <td className="px-3 py-2 text-center text-xs text-emerald-300">{c.stats_cur.aciertos_ambos}</td>
                      <td className="px-3 py-2 text-center text-xs text-gray-300">{c.stats_cur.aciertos_mejor} ({Math.round((c.stats_cur.aciertos_mejor / Math.max(1, c.stats_cur.n)) * 100)}%)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}