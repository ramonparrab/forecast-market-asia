import { useState, useEffect, useCallback } from 'react'

/**
 * DUELO DE PROBABILIDADES: PRODUCCIÓN vs SOMBRA v2 (subpestaña de TOMAR DECISIÓN).
 *
 * La SOMBRA v2 es una receta CONGELADA (centro único temp_corregida + t(4)·σ=1.5
 * + regla de pago exacta) que se calcula al vuelo sobre los mismos datos guardados
 * de cada corrida. NO toca producción: las probs de la página, el motor y las
 * decisiones siguen siendo las de siempre. Esto solo compara, día a día, quién
 * puntúa mejor en Brier contra la resolución real — para decidir con datos si la
 * v2 merece ser promovida a motor algún día.
 *
 * Datos: /api/shadow (solo lectura).
 */

interface DueloAgg {
  n: number
  brier_prod: number | null
  brier_sombra: number | null
  brier_mkt: number | null
  delta: number | null
  skill_prod: number | null
  skill_sombra: number | null
}
interface DueloDia { fecha: string; n: number; brier_prod: number; brier_sombra: number; brier_mkt: number; delta: number }
interface DueloCiudad extends DueloAgg { slug: string; nombre: string }
interface DueloPendiente {
  fecha: string; slot: string; slug: string; nombre: string; tipo: string; valor: string
  p_prod: number; p_sombra: number; p_mkt: number; delta: number; ev_prod: number; ev_sombra: number
}
interface ShadowSummary {
  ok: boolean
  error?: string
  dias: number | 'all'
  n_contratos: number
  n_dias: number
  fecha_desde: string | null
  fecha_hasta: string | null
  receta: { nombre: string; centro: string; distribucion: string; sigma: number; regla: string; congelada: string }
  global: DueloAgg
  por_slot: Record<string, DueloAgg>
  por_segmento: { backtest: DueloAgg | null; vivo: DueloAgg | null; pendientes_vivo: number }
  por_dia: DueloDia[]
  por_ciudad: DueloCiudad[]
  stats: { discordantes: number; pct_discordantes: number | null; flips_ev: number; abs_delta_medio: number | null }
  hoy: { fecha: string | null; pendientes: DueloPendiente[] }
}

const f4 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(4))
const f3 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3))
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
const deltaColor = (d: number | null | undefined) =>
  d == null ? 'text-gray-500' : d < -0.0005 ? 'text-emerald-400' : d > 0.0005 ? 'text-red-400' : 'text-gray-400'
const deltaSign = (d: number | null | undefined) =>
  d == null ? '' : d < -0.0005 ? '▼' : d > 0.0005 ? '▲' : '='

const VENTANAS: Array<{ key: number | 'all'; label: string }> = [
  { key: 30, label: '30 días' },
  { key: 90, label: '90 días' },
  { key: 'all', label: 'Todo' },
]

const TIPO_LABEL: Record<string, string> = { exacto: 'exacto', superior: '≥', inferior: '≤', rango: 'rango' }

export default function ShadowPanel() {
  const [dias, setDias] = useState<number | 'all'>(30)
  const [data, setData] = useState<ShadowSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detalle, setDetalle] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/shadow?dias=${dias}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [dias])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading && !data) {
    return (
      <div className="card border-orange-500/20">
        <div className="animate-pulse flex items-center gap-3 py-3">
          <span className="text-xl">🥊</span>
          <span className="text-xs text-gray-400">Calculando duelo producción vs sombra v2…</span>
        </div>
      </div>
    )
  }

  if (error || !data || !data.ok || data.n_contratos === 0) {
    return (
      <div className="card border-orange-500/20">
        <div className="flex items-center gap-2 py-2 text-xs">
          <span>🥊</span>
          <span className="text-gray-400">
            Duelo producción vs sombra v2: sin datos resueltos todavía
            {error ? ` (${error})` : ' (se llena solo cuando lleguen los reales)'}
          </span>
        </div>
      </div>
    )
  }

  const g = data.global
  const sombraMejor = (g.delta ?? 0) < 0
  const st = data.stats

  // Serie diaria (SVG inline, sin dependencias)
  const dias_ = data.por_dia
  const chart = (() => {
    if (dias_.length < 2) return null
    const W = 560, H = 96, PAD = 8
    const all = dias_.flatMap(d => [d.brier_prod, d.brier_sombra, d.brier_mkt])
    const min = Math.min(...all) * 0.96, max = Math.max(...all) * 1.04
    const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (dias_.length - 1)
    const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD)
    const line = (key: 'brier_prod' | 'brier_sombra' | 'brier_mkt') =>
      dias_.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
    // Línea divisoria backtest | vivo (primera fecha posterior o igual a la congelada)
    const iVivo = dias_.findIndex(d => d.fecha >= data.receta.congelada)
    const xVivo = iVivo > 0 ? x(iVivo) : null
    return { W, H, lineP: line('brier_prod'), lineS: line('brier_sombra'), lineM: line('brier_mkt'), min, max, xVivo }
  })()

  return (
    <div className="card border-orange-500/20 bg-gradient-to-br from-orange-500/5 to-transparent">
      {/* Título + ventana */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-orange-300 flex items-center gap-2">
            <span>🥊</span> Duelo de probabilidades — PRODUCCIÓN vs <span className="text-orange-200">SOMBRA v2</span>
          </h3>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {data.n_contratos} contratos resueltos · {data.n_dias} días ({data.fecha_desde} → {data.fecha_hasta}) · las tres series puntúan Brier contra la resolución real
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {VENTANAS.map(v => (
            <button
              key={String(v.key)}
              onClick={() => setDias(v.key)}
              className={`px-2 py-1 rounded text-[10px] font-medium border ${
                dias === v.key
                  ? 'bg-orange-500/20 border-orange-400/40 text-orange-200'
                  : 'bg-slate-800 border-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              {v.label}
            </button>
          ))}
          <button onClick={fetchData} disabled={loading} className="px-2 py-1 rounded text-[10px] border border-gray-700 text-gray-400 hover:text-gray-200 bg-slate-800">
            ↻
          </button>
        </div>
      </div>

      {/* Receta congelada */}
      <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
        <span className="text-orange-300/80 font-medium">SOMBRA v2</span> = centro único (
        {data.receta.centro}) + distribución {data.receta.distribucion}·σ={data.receta.sigma} + {data.receta.regla}.
        Receta congelada el <span className="text-gray-400">{data.receta.congelada}</span> — cálculo analítico exacto
        (sin Monte Carlo), determinista. <span className="text-gray-600">NO afecta las probs de la página ni las decisiones: solo comparación.</span>
      </p>

      {/* 4 tarjetas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <div className="rounded-xl bg-slate-800/80 border border-cyan-500/20 p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Brier PRODUCCIÓN</p>
          <p className="text-2xl font-bold text-cyan-400 mt-1">{f4(g.brier_prod)}</p>
          <p className="text-[10px] text-gray-500 mt-1">la que está en la página hoy · skill {pct(g.skill_prod)}</p>
        </div>
        <div className="rounded-xl bg-slate-800/80 border border-orange-500/30 p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Brier SOMBRA v2</p>
          <p className="text-2xl font-bold text-orange-400 mt-1">{f4(g.brier_sombra)}</p>
          <p className="text-[10px] text-gray-500 mt-1">centro único σ={data.receta.sigma} · skill {pct(g.skill_sombra)}</p>
        </div>
        <div className="rounded-xl bg-slate-800/80 border border-gray-600/30 p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Brier MERCADO</p>
          <p className="text-2xl font-bold text-gray-300 mt-1">{f4(g.brier_mkt)}</p>
          <p className="text-[10px] text-gray-500 mt-1">precio medio Polymarket en el mismo instante</p>
        </div>
        <div className={`rounded-xl bg-slate-800/80 border p-3 ${sombraMejor ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Δ v2 − producción</p>
          <p className={`text-2xl font-bold mt-1 ${deltaColor(g.delta)}`}>
            {deltaSign(g.delta)} {g.delta == null ? '—' : (g.delta > 0 ? '+' : '') + g.delta.toFixed(4)}
          </p>
          <p className={`text-[10px] mt-1 ${deltaColor(g.delta)}`}>
            {sombraMejor ? 'la sombra puntúa MEJOR (menor Brier)' : 'la sombra puntúa peor por ahora'}
          </p>
        </div>
      </div>

      {/* 10PM vs 11PM */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
        {(['10PM', '11PM'] as const).map(slot => {
          const s = data.por_slot[slot] || { n: 0, brier_prod: null, brier_sombra: null, brier_mkt: null, delta: null, skill_prod: null, skill_sombra: null }
          return (
            <div key={slot} className="rounded-xl bg-slate-800/60 border border-gray-700/30 p-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-bold text-gray-300">{slot} <span className="text-gray-600 font-normal">· {s.n} contratos</span></p>
                <p className={`text-[10px] font-medium ${deltaColor(s.delta)}`}>
                  {deltaSign(s.delta)} {s.delta == null ? '—' : (s.delta > 0 ? '+' : '') + s.delta.toFixed(4)}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[9px] text-gray-600 uppercase">Prod</p>
                  <p className="text-sm font-bold text-cyan-400">{f4(s.brier_prod)}</p>
                </div>
                <div>
                  <p className="text-[9px] text-gray-600 uppercase">Sombra v2</p>
                  <p className="text-sm font-bold text-orange-400">{f4(s.brier_sombra)}</p>
                </div>
                <div>
                  <p className="text-[9px] text-gray-600 uppercase">Mercado</p>
                  <p className="text-sm font-bold text-gray-300">{f4(s.brier_mkt)}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Segmento backtest vs vivo */}
      <div className="rounded-xl bg-slate-800/40 border border-gray-700/20 p-2.5 mb-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center items-center">
          <div>
            <p className="text-[9px] text-gray-600 uppercase tracking-wide">◀ Backtest (in-sample)</p>
            <p className="text-xs text-gray-400 mt-0.5">
              prod <span className="text-cyan-400 font-medium">{f4(data.por_segmento.backtest?.brier_prod)}</span>
              {' · '}v2 <span className="text-orange-400 font-medium">{f4(data.por_segmento.backtest?.brier_sombra)}</span>
              {data.por_segmento.backtest?.delta != null && (
                <span className={`ml-1 ${deltaColor(data.por_segmento.backtest.delta)}`}>
                  ({data.por_segmento.backtest.delta > 0 ? '+' : ''}{data.por_segmento.backtest.delta.toFixed(4)})
                </span>
              )}
            </p>
            <p className="text-[9px] text-gray-600">σ elegida con estos datos — tránsito, no veredicto</p>
          </div>
          <div className="border-x border-gray-700/30 sm:border-x px-2">
            <p className="text-[9px] text-emerald-500/70 uppercase tracking-wide">▶ EN VIVO (out-of-sample)</p>
            {data.por_segmento.vivo && data.por_segmento.vivo.n > 0 ? (
              <p className="text-xs text-gray-400 mt-0.5">
                n={data.por_segmento.vivo.n} · prod <span className="text-cyan-400 font-medium">{f4(data.por_segmento.vivo.brier_prod)}</span>
                {' · '}v2 <span className="text-orange-400 font-medium">{f4(data.por_segmento.vivo.brier_sombra)}</span>
                <span className={`ml-1 ${deltaColor(data.por_segmento.vivo.delta)}`}>
                  ({data.por_segmento.vivo.delta != null && data.por_segmento.vivo.delta > 0 ? '+' : ''}{f4(data.por_segmento.vivo.delta)})
                </span>
              </p>
            ) : (
              <p className="text-xs text-gray-600 mt-0.5">
                esperando {data.por_segmento.pendientes_vivo} contratos por resolver
              </p>
            )}
            <p className="text-[9px] text-gray-600">desde {data.receta.congelada} — el veredicto real empieza aquí</p>
          </div>
          <div>
            <p className="text-[9px] text-gray-600 uppercase tracking-wide">Discordancia</p>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="text-white font-medium">{st.discordantes}</span> contratos difieren &gt;5pp
              ({pct(st.pct_discordantes)}) · flips de señal EV: <span className="text-white font-medium">{st.flips_ev}</span>
            </p>
            <p className="text-[9px] text-gray-600">|Δp| medio: {f4(st.abs_delta_medio)}</p>
          </div>
        </div>
      </div>

      {/* Serie diaria */}
      {chart && (
        <div className="rounded-xl bg-slate-800/60 border border-gray-700/30 p-3 mb-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] font-bold text-gray-300">Brier por día</p>
            <div className="flex gap-3 text-[9px] text-gray-500">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-cyan-400"></span>prod</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-orange-400"></span>sombra v2</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-0.5 bg-gray-500"></span>mercado</span>
            </div>
          </div>
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="w-full h-24">
            <path d={chart.lineM} fill="none" stroke="#6b7280" strokeWidth="1" strokeDasharray="3,2" />
            <path d={chart.lineP} fill="none" stroke="#22d3ee" strokeWidth="1.6" />
            <path d={chart.lineS} fill="none" stroke="#fb923c" strokeWidth="1.6" />
            {chart.xVivo != null && (
              <>
                <line x1={chart.xVivo} y1="4" x2={chart.xVivo} y2={chart.H - 4} stroke="#34d399" strokeWidth="1" strokeDasharray="2,3" />
                <text x={chart.xVivo + 4} y="12" fill="#34d399" fontSize="8">vivo ▶</text>
              </>
            )}
          </svg>
          <div className="flex justify-between text-[9px] text-gray-600 mt-0.5">
            <span>{dias_[0]?.fecha}</span>
            <span>rango {f4(chart.min)}–{f4(chart.max)}</span>
            <span>{dias_[dias_.length - 1]?.fecha}</span>
          </div>
        </div>
      )}

      {/* Chips por ciudad */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {data.por_ciudad.map(c => (
          <span
            key={c.slug}
            title={`${c.nombre}: prod ${f4(c.brier_prod)} · v2 ${f4(c.brier_sombra)} · mercado ${f4(c.brier_mkt)} · Δ ${c.delta}`}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
              (c.delta ?? 0) < 0
                ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                : 'bg-red-500/10 border-red-500/25 text-red-300'
            }`}
          >
            {c.nombre} {f4(c.brier_prod)}→<span className="font-bold">{f4(c.brier_sombra)}</span> {deltaSign(c.delta)}
          </span>
        ))}
      </div>

      {/* Tabla diaria */}
      <div className="rounded-xl bg-slate-800/60 border border-gray-700/30 overflow-hidden mb-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800/80 border-b border-gray-700/30">
                <th className="px-2 py-2 text-left text-gray-500 font-medium">Fecha</th>
                <th className="px-2 py-2 text-center text-gray-500 font-medium">n</th>
                <th className="px-2 py-2 text-center text-cyan-400/70 font-medium">Prod</th>
                <th className="px-2 py-2 text-center text-orange-400/70 font-medium">Sombra v2</th>
                <th className="px-2 py-2 text-center text-gray-500 font-medium">Mercado</th>
                <th className="px-2 py-2 text-center text-gray-500 font-medium">Δ v2</th>
                <th className="px-2 py-2 text-center text-gray-500 font-medium">Ganador</th>
              </tr>
            </thead>
            <tbody>
              {[...dias_].slice(-15).reverse().map(d => (
                <tr key={d.fecha} className={`border-t border-gray-700/20 ${d.fecha >= data.receta.congelada ? 'bg-emerald-500/[0.03]' : ''}`}>
                  <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{formatFecha(d.fecha)}</td>
                  <td className="px-2 py-1.5 text-center text-gray-500">{d.n}</td>
                  <td className="px-2 py-1.5 text-center text-cyan-400">{f4(d.brier_prod)}</td>
                  <td className="px-2 py-1.5 text-center text-orange-400 font-medium">{f4(d.brier_sombra)}</td>
                  <td className="px-2 py-1.5 text-center text-gray-400">{f4(d.brier_mkt)}</td>
                  <td className={`px-2 py-1.5 text-center ${deltaColor(d.delta)}`}>
                    {d.delta > 0 ? '+' : ''}{d.delta.toFixed(4)}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {Math.abs(d.delta) < 0.002 ? (
                      <span className="text-gray-600">=</span>
                    ) : d.delta < 0 ? (
                      <span className="text-emerald-400 text-[10px] font-bold">V2</span>
                    ) : (
                      <span className="text-cyan-400 text-[10px] font-bold">PROD</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-1.5 text-[9px] text-gray-600 border-t border-gray-700/20">
          Últimos {Math.min(15, dias_.length)} días resueltos · filas sombreadas = tramo en vivo (out-of-sample)
        </p>
      </div>

      {/* HOY sin resolver */}
      <button
        onClick={() => setDetalle(!detalle)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-800/40 border border-gray-700/20 text-left hover:bg-slate-700/30 transition"
      >
        <span className="text-[11px] font-bold text-gray-300">
          HOY sin resolver todavía — probs lado a lado {data.hoy.fecha ? `(${data.hoy.fecha})` : ''}
          <span className="text-gray-600 font-normal ml-1">{data.hoy.pendientes.length} contratos · puntuarán cuando llegue el real</span>
        </span>
        <span className="text-gray-600 text-[10px]">{detalle ? '▲' : '▼'}</span>
      </button>

      {detalle && data.hoy.pendientes.length > 0 && (
        <PendientesTabla pendientes={data.hoy.pendientes} />
      )}
    </div>
  )
}

function PendientesTabla({ pendientes }: { pendientes: DueloPendiente[] }) {
  const [slot, setSlot] = useState<'10PM' | '11PM'>('11PM')
  const [soloDiscordantes, setSoloDiscordantes] = useState(false)

  const rows = pendientes
    .filter(p => p.slot === slot)
    .filter(p => !soloDiscordantes || Math.abs(p.delta) > 0.05)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return (
    <div className="mt-2 rounded-xl bg-slate-800/60 border border-gray-700/30 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-800/80 border-b border-gray-700/30">
        <div className="flex gap-1.5">
          {(['10PM', '11PM'] as const).map(s => (
            <button
              key={s}
              onClick={() => setSlot(s)}
              className={`px-2 py-1 rounded text-[10px] font-medium border ${
                slot === s
                  ? 'bg-orange-500/20 border-orange-400/40 text-orange-200'
                  : 'bg-slate-800 border-gray-700 text-gray-400 hover:text-gray-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
          <input type="checkbox" checked={soloDiscordantes} onChange={e => setSoloDiscordantes(e.target.checked)} className="accent-orange-500" />
          solo discordantes (&gt;5pp)
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800/50">
              <th className="px-2 py-2 text-left text-gray-500 font-medium">Ciudad</th>
              <th className="px-2 py-2 text-left text-gray-500 font-medium">Contrato</th>
              <th className="px-2 py-2 text-center text-cyan-400/70 font-medium">p prod</th>
              <th className="px-2 py-2 text-center text-orange-400/70 font-medium">p sombra v2</th>
              <th className="px-2 py-2 text-center text-gray-500 font-medium">p mercado</th>
              <th className="px-2 py-2 text-center text-gray-500 font-medium">Δ v2</th>
              <th className="px-2 py-2 text-center text-gray-500 font-medium">Señal EV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const evP = p.ev_prod > 0.01
              const evS = p.ev_sombra > 0.01
              return (
                <tr key={`${p.slug}-${p.tipo}-${p.valor}-${i}`} className="border-t border-gray-700/20">
                  <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap">{p.nombre}</td>
                  <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">
                    <span className="text-gray-600 mr-1">{TIPO_LABEL[p.tipo] || p.tipo}</span>{p.valor}
                  </td>
                  <td className="px-2 py-1.5 text-center text-cyan-400">{f3(p.p_prod)}</td>
                  <td className="px-2 py-1.5 text-center text-orange-400 font-medium">{f3(p.p_sombra)}</td>
                  <td className="px-2 py-1.5 text-center text-gray-400">{f3(p.p_mkt)}</td>
                  <td className={`px-2 py-1.5 text-center ${deltaColor(p.delta)}`}>
                    {p.delta > 0 ? '+' : ''}{p.delta.toFixed(3)}
                  </td>
                  <td className="px-2 py-1.5 text-center text-[10px] whitespace-nowrap">
                    {evP && evS ? (
                      <span className="text-emerald-400">ambos EV+</span>
                    ) : !evP && !evS ? (
                      <span className="text-gray-600">ninguno</span>
                    ) : evS ? (
                      <span className="text-orange-300">solo v2 EV+</span>
                    ) : (
                      <span className="text-cyan-300">solo prod EV+</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p className="px-3 py-3 text-center text-[10px] text-gray-600">Sin contratos en este filtro</p>
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
