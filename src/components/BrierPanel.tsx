import { useState, useEffect, useCallback } from 'react'

/**
 * Franja de CALIBRACIÓN BRIER para TOMAR DECISIÓN.
 *
 * Responde la pregunta previa a apostar: ¿las probabilidades del sistema son
 * confiables? Compara el Brier score de la IA (prob_ia_norm) contra el del
 * mercado (precio medio de Polymarket registrado en el mismo instante),
 * puntuados contra la resolución REAL de cada contrato.
 *
 * Escala: 0 = perfecto · 0.25 = moneda al aire · 1 = pésimo. Menor = mejor.
 * Datos: /api/brier (daily_runs contratos vs forecast_snapshot temp_real).
 */

interface BrierAgg {
  n: number
  brier_ia: number | null
  brier_mkt: number | null
  skill: number | null
}

interface BrierCalibBin { lo: number; hi: number; n: number; p_obs: number }
interface BrierSemana { semana: string; n: number; brier_ia: number; brier_mkt: number; ganador: string }

interface BrierSummary {
  ok: boolean
  error?: string
  dias: number | 'all'
  n_contratos: number
  n_dias: number
  fecha_desde: string | null
  fecha_hasta: string | null
  global: BrierAgg
  por_slot: Record<string, BrierAgg>
  por_tipo: Record<string, BrierAgg>
  por_ciudad: Array<BrierAgg & { slug: string; nombre: string }>
  calibracion: BrierCalibBin[]
  confianza_ia: { n: number; fallos: number; tasa_fallo: number }
  confianza_mkt: { n: number; fallos: number; tasa_fallo: number }
  semanas: BrierSemana[]
}

const f3 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3))
const pct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)

const VENTANAS: Array<{ key: number | 'all'; label: string }> = [
  { key: 30, label: '30 días' },
  { key: 90, label: '90 días' },
  { key: 'all', label: 'Todo' },
]

export default function BrierPanel() {
  const [dias, setDias] = useState<number | 'all'>(30)
  const [data, setData] = useState<BrierSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detalle, setDetalle] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/brier?dias=${dias}`)
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
      <div className="card border-cyan-500/20">
        <div className="animate-pulse flex items-center gap-3 py-3">
          <span className="text-xl">🎯</span>
          <span className="text-xs text-gray-400">Calculando calibración Brier…</span>
        </div>
      </div>
    )
  }

  if (error || !data || !data.ok || data.n_contratos === 0) {
    return (
      <div className="card border-cyan-500/20">
        <div className="flex items-center gap-2 py-2 text-xs">
          <span>🎯</span>
          <span className="text-gray-400">Calibración Brier: sin datos resueltos todavía (se llena sola cuando lleguen los reales)</span>
        </div>
      </div>
    )
  }

  const g = data.global
  const iaMejor = (g.brier_ia ?? 1) < (g.brier_mkt ?? 1)
  const skillPct = g.skill == null ? null : g.skill * 100
  const ci = data.confianza_ia, cm = data.confianza_mkt
  const iaMasConfiable = ci.tasa_fallo < cm.tasa_fallo

  // Sparkline semanal (SVG inline, sin dependencias)
  const semanas = data.semanas
  const spark = (() => {
    if (semanas.length < 2) return null
    const W = 320, H = 64, PAD = 6
    const all = semanas.flatMap(s => [s.brier_ia, s.brier_mkt])
    const min = Math.min(...all) * 0.95, max = Math.max(...all) * 1.05
    const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (semanas.length - 1)
    const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - 2 * PAD)
    const line = (key: 'brier_ia' | 'brier_mkt') =>
      semanas.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ')
    return { W, H, lineIA: line('brier_ia'), lineMKT: line('brier_mkt'), min, max }
  })()

  return (
    <div className="card border-cyan-500/20 bg-gradient-to-br from-cyan-500/5 to-transparent">
      {/* Título + ventana */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
            <span>🎯</span> Calibración Brier — ¿confiar en las probabilidades antes de apostar?
          </h3>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {data.n_contratos} contratos resueltos · {data.n_dias} días ({data.fecha_desde} → {data.fecha_hasta}) · IA vs precio de mercado en el mismo instante
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {VENTANAS.map(v => (
            <button
              key={String(v.key)}
              onClick={() => setDias(v.key)}
              className={`px-2 py-1 rounded text-[10px] font-medium border ${
                dias === v.key
                  ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-200'
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

      {/* 4 tarjetas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
        <div className={`rounded-lg border p-2.5 ${iaMejor ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-red-500/10 border-red-400/30'}`}>
          <div className="text-[10px] text-gray-400 font-medium">BRIER IA</div>
          <div className={`text-xl font-bold ${iaMejor ? 'text-emerald-300' : 'text-red-300'}`} title="media de (probabilidad − resultado)² contra la resolución real">
            {f3(g.brier_ia)}
          </div>
          <div className="text-[10px] text-gray-500">
            {iaMejor ? 'mejor que el mercado' : 'por debajo del mercado'}
          </div>
        </div>

        <div className="rounded-lg border p-2.5 bg-slate-800/60 border-gray-700">
          <div className="text-[10px] text-gray-400 font-medium">BRIER MERCADO</div>
          <div className="text-xl font-bold text-gray-200" title="precio medio de Polymarket al momento de cada corrida">
            {f3(g.brier_mkt)}
          </div>
          <div className="text-[10px] text-gray-500">benchmark a vencer</div>
        </div>

        <div className={`rounded-lg border p-2.5 ${skillPct != null && skillPct > 0 ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-amber-500/10 border-amber-400/30'}`}>
          <div className="text-[10px] text-gray-400 font-medium">EDGE CALIBRACIÓN</div>
          <div className={`text-xl font-bold ${skillPct != null && skillPct > 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
            {skillPct == null ? '—' : `${skillPct > 0 ? '+' : ''}${skillPct.toFixed(1)}%`}
          </div>
          <div className="text-[10px] text-gray-500">
            {skillPct != null && skillPct > 0 ? 'probabilidades más sharp' : 'el mercado fue más preciso'}
          </div>
        </div>

        <div className="rounded-lg border p-2.5 bg-slate-800/60 border-gray-700">
          <div className="text-[10px] text-gray-400 font-medium">FALLO CON p ≥ 90%</div>
          <div className={`text-xl font-bold ${iaMasConfiable ? 'text-emerald-300' : 'text-amber-300'}`}>
            {pct(ci.tasa_fallo)}
          </div>
          <div className="text-[10px] text-gray-500" title={`IA: ${ci.fallos}/${ci.n} fallas · Mercado: ${cm.fallos}/${cm.n}`}>
            IA vs mercado {pct(cm.tasa_fallo)}
          </div>
        </div>
      </div>

      {/* Sparkline semanal */}
      {spark && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-400 font-medium">Evolución semanal (menor = mejor)</span>
            <span className="text-[10px]">
              <span className="text-cyan-300 mr-3">■ IA</span>
              <span className="text-gray-400">■ Mercado</span>
            </span>
          </div>
          <svg viewBox={`0 0 ${spark.W} ${spark.H}`} className="w-full h-16" preserveAspectRatio="none">
            <path d={spark.lineMKT} fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="3,2" />
            <path d={spark.lineIA} fill="none" stroke="#22d3ee" strokeWidth="2" />
          </svg>
          <div className="flex justify-between text-[9px] text-gray-600">
            <span>{semanas[0]?.semana}</span>
            <span>{semanas[semanas.length - 1]?.semana}</span>
          </div>
        </div>
      )}

      {/* Chips por ciudad */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {data.por_ciudad.map(c => {
          const mejor = (c.brier_ia ?? 1) < (c.brier_mkt ?? 1)
          return (
            <span
              key={c.slug}
              title={`IA ${f3(c.brier_ia)} vs mercado ${f3(c.brier_mkt)} · ${c.n} contratos`}
              className={`px-2 py-0.5 rounded-full text-[10px] border ${
                mejor
                  ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
                  : 'bg-red-500/10 border-red-400/25 text-red-200'
              }`}
            >
              {c.nombre} {f3(c.brier_ia)}
            </span>
          )
        })}
      </div>

      {/* Detalle colapsable */}
      <button
        onClick={() => setDetalle(!detalle)}
        className="text-[10px] text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
      >
        {detalle ? '▾ ocultar detalle' : '▸ ver calibración por bins, tipo y slot'}
      </button>

      {detalle && (
        <div className="mt-2 grid md:grid-cols-3 gap-3 text-[10px]">
          {/* Calibración */}
          <div className="rounded-lg bg-slate-800/60 border border-gray-700 p-2">
            <div className="text-gray-300 font-semibold mb-1.5">Calibración IA (decir 70% y acertar ~70%)</div>
            <table className="w-full">
              <tbody>
                {data.calibracion.map((b, i) => {
                  const gap = b.p_obs - (b.lo + b.hi) / 2
                  const color = Math.abs(gap) <= 0.07 ? 'text-emerald-400' : Math.abs(gap) <= 0.15 ? 'text-amber-400' : 'text-red-400'
                  return (
                    <tr key={i} className="border-t border-gray-700/50">
                      <td className="py-0.5 text-gray-400">p ∈ [{b.lo.toFixed(1)}, {b.hi.toFixed(1)})</td>
                      <td className="py-0.5 text-right text-gray-300">n={b.n}</td>
                      <td className={`py-0.5 text-right ${color}`}>obs {b.p_obs.toFixed(3)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Por tipo */}
          <div className="rounded-lg bg-slate-800/60 border border-gray-700 p-2">
            <div className="text-gray-300 font-semibold mb-1.5">Por tipo de contrato</div>
            <table className="w-full">
              <tbody>
                {Object.entries(data.por_tipo).map(([tipo, a]) => (
                  <tr key={tipo} className="border-t border-gray-700/50">
                    <td className="py-0.5 text-gray-400">{tipo}</td>
                    <td className="py-0.5 text-right text-cyan-300">{f3(a.brier_ia)}</td>
                    <td className="py-0.5 text-right text-gray-400">{f3(a.brier_mkt)}</td>
                    <td className="py-0.5 text-right text-gray-500">n={a.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-gray-600 mt-1">columnas: tipo · IA · mercado · n</div>
          </div>
          {/* Por slot */}
          <div className="rounded-lg bg-slate-800/60 border border-gray-700 p-2">
            <div className="text-gray-300 font-semibold mb-1.5">Por slot de corrida</div>
            <table className="w-full">
              <tbody>
                {Object.entries(data.por_slot).map(([slot, a]) => (
                  <tr key={slot} className="border-t border-gray-700/50">
                    <td className="py-0.5 text-gray-400">{slot}</td>
                    <td className="py-0.5 text-right text-cyan-300">{f3(a.brier_ia)}</td>
                    <td className="py-0.5 text-right text-gray-400">{f3(a.brier_mkt)}</td>
                    <td className="py-0.5 text-right text-gray-500">n={a.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-gray-600 mt-1">columnas: slot · IA · mercado · n</div>
          </div>
        </div>
      )}

      <p className="text-[9px] text-gray-600 mt-2.5">
        Brier = media de (probabilidad − resultado)² contra la resolución real de cada contrato (entero redondeado, como paga Polymarket) ·
        escala: 0.000 perfecto · 0.250 moneda al aire · 1.000 pésimo · menor = mejor · fuente: daily_runs vs forecast_snapshot
      </p>
    </div>
  )
}
