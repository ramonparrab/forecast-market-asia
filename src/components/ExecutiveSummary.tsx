import { useState, useEffect } from 'react'
import { DailyAnalysis, GlobalMetrics } from '@/types'
import { computeExecutiveSummary, ExecutiveSummary, DailyImprovement, BetAction } from '@/lib/unified-model'

interface Props {
  analysis: DailyAnalysis | null
  metrics: GlobalMetrics | null
  previousAnalysis: DailyAnalysis | null
  previousMetrics: GlobalMetrics | null
}

function DeltaBadge({ delta, suffix = '%', invert = false }: { delta: number | null; suffix?: string; invert?: boolean }) {
  if (delta === null) return <span className="text-gray-500 text-xs">—</span>
  const isPositive = invert ? delta < 0 : delta > 0
  const isNegative = invert ? delta > 0 : delta < 0
  return (
    <span className={`text-xs font-bold ${isPositive ? 'text-emerald-400' : isNegative ? 'text-red-400' : 'text-gray-400'}`}>
      {delta > 0 ? '+' : ''}{delta.toFixed(1)}{suffix}
    </span>
  )
}

function SignalBadge({ signal }: { signal: DailyImprovement['signal'] }) {
  const colors = {
    FUERTE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    MEDIA: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    DEBIL: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    EVITAR: 'bg-red-500/20 text-red-400 border-red-500/30',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${colors[signal]}`}>
      {signal}
    </span>
  )
}

function TrendIcon({ tendencia }: { tendencia: DailyImprovement['tendencia'] }) {
  if (tendencia === 'mejorando') return <span className="text-emerald-400">↗</span>
  if (tendencia === 'empeorando') return <span className="text-red-400">↘</span>
  return <span className="text-gray-400">→</span>
}

function ActionBetCard({ accion, index }: { accion: BetAction; index: number }) {
  const signalColors = {
    EXCELENTE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    BUENA: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    NEUTRAL: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    EVITAR: 'bg-red-500/20 text-red-400 border-red-500/30',
  }
  const riskColors = {
    BAJO: 'text-emerald-400',
    MEDIO: 'text-amber-400',
    ALTO: 'text-red-400',
  }
  const colors = ['border-emerald-500/30', 'border-blue-500/30', 'border-purple-500/30', 'border-amber-500/30', 'border-pink-500/30']
  const bgColors = ['from-emerald-500/5', 'from-blue-500/5', 'from-purple-500/5', 'from-amber-500/5', 'from-pink-500/5']

  return (
    <div className={`rounded-xl bg-gradient-to-br ${bgColors[index % bgColors.length]} to-transparent border ${colors[index % colors.length]} p-4`}>
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-extrabold text-white bg-white/10 rounded-lg w-10 h-10 flex items-center justify-center">
            {index + 1}
          </span>
          <div>
            <h4 className="text-base font-extrabold text-white">{accion.ciudad}</h4>
            <p className="text-xs text-gray-400">{accion.contrato}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${signalColors[accion.signal]}`}>
            {accion.signal}
          </span>
          <span className={`text-[10px] font-bold ${riskColors[accion.riesgo]}`}>
            Riesgo: {accion.riesgo}
          </span>
        </div>
      </div>

      {/* Main numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div className="rounded-lg bg-black/20 p-2 text-center">
          <p className="text-[10px] text-gray-400 mb-0.5">INVERTIR</p>
          <p className="text-xl font-extrabold text-amber-400">${accion.montoinvertir}</p>
        </div>
        <div className="rounded-lg bg-black/20 p-2 text-center">
          <p className="text-[10px] text-gray-400 mb-0.5">SI GANAS</p>
          <p className="text-xl font-extrabold text-emerald-400">+${accion.upside}</p>
        </div>
        <div className="rounded-lg bg-black/20 p-2 text-center">
          <p className="text-[10px] text-gray-400 mb-0.5">SI PIERDES</p>
          <p className="text-xl font-extrabold text-red-400">-${accion.downside}</p>
        </div>
        <div className="rounded-lg bg-black/20 p-2 text-center">
          <p className="text-[10px] text-gray-400 mb-0.5">EV</p>
          <p className={`text-xl font-extrabold ${accion.ev > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {accion.ev > 0 ? '+' : ''}{accion.ev}
          </p>
        </div>
      </div>

      {/* Edge explanation */}
      <div className="rounded-lg bg-black/10 p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">🎯</span>
          <span className="text-xs font-bold text-white">¿POR QUÉ ESTE CONTRATO?</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs mb-2">
          <div>
            <span className="text-gray-400">Tu modelo dice:</span>
            <span className="ml-1 font-bold text-blue-400">{accion.prob_ia.toFixed(1)}%</span>
          </div>
          <div>
            <span className="text-gray-400">Mercado dice:</span>
            <span className="ml-1 font-bold text-white">{accion.prob_mercado}%</span>
          </div>
          <div>
            <span className="text-gray-400">Edge:</span>
            <span className="ml-1 font-bold text-emerald-400">+{accion.edge.toFixed(1)}%</span>
          </div>
        </div>
        <p className="text-xs text-gray-300">{accion.razon}</p>
      </div>

      {/* Probability bar */}
      <div className="rounded-lg bg-black/10 p-3">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-gray-400">Probabilidad de ganar esta apuesta</span>
          <span className="font-bold text-white">{accion.prob_ia.toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-1000"
            style={{ width: `${accion.prob_ia}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-gray-500 mt-1">
          <span>0%</span>
          <span className="text-white">Precio compra: ${(accion.precio_compra * 100).toFixed(0)}¢</span>
          <span>100%</span>
        </div>
      </div>

      {/* Explanation text */}
      <div className="mt-3 text-[11px] text-gray-400 leading-relaxed">
        <strong className="text-gray-300">Resumen:</strong>{' '}
        Compras <span className="text-white font-bold">{accion.contrato}</span> en {accion.ciudad} por{' '}
        <span className="text-amber-400 font-bold">${accion.montoinvertir}</span>.
        Si la temperatura cierra en ese rango, ganas <span className="text-emerald-400 font-bold">+${accion.upside}</span>.
        Si no, pierdes <span className="text-red-400 font-bold">${accion.downside}</span>.
        Tu modelo estima <span className="text-blue-400 font-bold">{accion.prob_ia.toFixed(1)}%</span> de probabilidad vs{' '}
        <span className="text-white font-bold">{accion.prob_mercado}%</span> del mercado.
      </div>
    </div>
  )
}

export default function ExecutiveSummaryPanel({ analysis, metrics, previousAnalysis, previousMetrics }: Props) {
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null)

  useEffect(() => {
    if (!analysis) return

    const fechaActual = analysis.fecha_objetivo
    const citiesToday = analysis.cities
    const recsToday = analysis.recommendations

    // Find previous day's data
    const citiesYesterday = previousAnalysis?.cities ?? null
    const recsYesterday = previousAnalysis?.recommendations ?? null

    const result = computeExecutiveSummary(
      fechaActual,
      citiesToday,
      recsToday,
      metrics,
      citiesYesterday,
      recsYesterday,
      previousMetrics
    )
    setSummary(result)
  }, [analysis, metrics, previousAnalysis, previousMetrics])

  if (!summary) {
    const hasAnalysis = analysis && analysis.cities.length > 0
    return (
      <div className="space-y-6">
        {/* Hero CTA */}
        {!hasAnalysis && (
          <div className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-gray-700/30 p-8 text-center">
            <div className="text-4xl mb-4">📊</div>
            <h2 className="text-xl font-bold text-white mb-2">Resumen Ejecutivo de Forecast</h2>
            <p className="text-gray-400 mb-4">Ejecuta el análisis para ver las recomendaciones del día, precisión global, y oportunidades de apuesta.</p>
            <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto text-xs">
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
                <p className="text-blue-400 font-bold mb-1">🎯 Recomendación</p>
                <p className="text-gray-500">Mejor apuesta del día con edge positivo</p>
              </div>
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                <p className="text-emerald-400 font-bold mb-1">📈 Precisión</p>
                <p className="text-gray-500">Evolución diaria del acierto ±1°C</p>
              </div>
              <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-3">
                <p className="text-purple-400 font-bold mb-1">💰 Plan Acción</p>
                <p className="text-gray-500">Asignación Kelly con presupuesto $10/día</p>
              </div>
            </div>
          </div>
        )}

        {/* Show basic analysis info even without summary */}
        {hasAnalysis && (
          <div className="rounded-2xl bg-gradient-to-br from-blue-600/10 via-blue-500/5 to-blue-600/10 border border-blue-500/20 p-6">
            <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
              <span>📊</span>
              Resumen del Análisis — {analysis.fecha_objetivo}
            </h2>
            <p className="text-sm text-gray-300 mb-4">{analysis.message}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg bg-slate-900/50 border border-gray-700/30 p-3 text-center">
                <p className="text-2xl font-bold text-white">{analysis.cities.length}</p>
                <p className="text-xs text-gray-400">Ciudades analizadas</p>
              </div>
              <div className="rounded-lg bg-slate-900/50 border border-gray-700/30 p-3 text-center">
                <p className="text-2xl font-bold text-amber-400">{analysis.recommendations.length}</p>
                <p className="text-xs text-gray-400">Recomendaciones</p>
              </div>
              <div className="rounded-lg bg-slate-900/50 border border-gray-700/30 p-3 text-center">
                <p className="text-2xl font-bold text-emerald-400">${analysis.total_allocated.toFixed(2)}</p>
                <p className="text-xs text-gray-400">Total asignado</p>
              </div>
              <div className="rounded-lg bg-slate-900/50 border border-gray-700/30 p-3 text-center">
                <p className="text-2xl font-bold text-blue-400">{analysis.recommendations.filter(r => r.edge > 5).length}</p>
                <p className="text-xs text-gray-400">Oportunidades (edge &gt;5%)</p>
              </div>
            </div>
            {metrics && (
              <div className="mt-4 rounded-lg bg-slate-900/50 border border-gray-700/30 p-3 flex items-center justify-between text-sm">
                <span className="text-gray-400">Precisión global ±1°C:</span>
                <span className="text-emerald-400 font-bold">{metrics.accuracy_pct.toFixed(1)}%</span>
                <span className="text-gray-500">MAE: {metrics.overall_mae.toFixed(2)}°C</span>
                <span className="text-gray-500">Bias: {metrics.overall_bias > 0 ? '+' : ''}{metrics.overall_bias.toFixed(2)}°C</span>
                <span className="text-gray-500">Muestras: {metrics.total_muestras}</span>
              </div>
            )}
          </div>
        )}

        {/* Help text */}
        <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 p-4 text-xs text-gray-500">
          <p className="font-medium text-gray-400 mb-2">💡 ¿Qué necesitas para ver el Resumen Ejecutivo completo?</p>
          <ul className="space-y-1">
            <li>1. El sistema debe tener al menos 5 registros históricos con temperatura real (±1°C de precisión)</li>
            <li>2. Debe haber contratos en Polymarket con edge positivo (&gt;4%)</li>
            <li>3. El análisis diario debe ejecutarse (usa el botón <strong className="text-blue-400">🚀 Actualizar</strong>)</li>
          </ul>
        </div>
      </div>
    )
  }

  const bestRec = summary.mejor_recomendacion
  const fuertes = summary.mejoras_por_ciudad.filter(m => m.signal === 'FUERTE')
  const oportunidades = summary.top_opportunities

  return (
    <div className="space-y-6">
      {/* HERO: Recomendación del Día */}
      {bestRec && (
        <div className="rounded-2xl bg-gradient-to-br from-emerald-600/20 via-blue-600/10 to-purple-600/20 border border-emerald-500/30 p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full -translate-y-32 translate-x-32" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-3xl">🎯</span>
              <div>
                <p className="text-xs text-emerald-300 font-semibold tracking-wider">RECOMENDACIÓN DEL DÍA</p>
                <p className="text-[10px] text-gray-400">{summary.fecha}</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 mb-4">
              <div>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-1">
                  {bestRec.ciudad} → {bestRec.contrato}
                </h2>
                <p className="text-sm text-gray-300">
                  Temp pronosticada: <span className="text-emerald-400 font-bold">{bestRec.temp_corregida.toFixed(1)}°C</span>
                  <span className="mx-2">·</span>
                  Consenso: <span className="text-blue-400 font-bold">{bestRec.consenso}</span>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-black/20 p-3 text-center">
                <p className="text-[10px] text-gray-400 mb-1">Edge</p>
                <p className="text-2xl font-extrabold text-emerald-400">+{bestRec.edge.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3 text-center">
                <p className="text-[10px] text-gray-400 mb-1">Prob. IA</p>
                <p className="text-2xl font-extrabold text-blue-400">{bestRec.ia_pct.toFixed(1)}%</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3 text-center">
                <p className="text-[10px] text-gray-400 mb-1">Mercado</p>
                <p className="text-2xl font-extrabold text-white">{bestRec.mkt_pct}%</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3 text-center">
                <p className="text-[10px] text-gray-400 mb-1">Precisión ±1°C</p>
                <p className="text-2xl font-extrabold text-purple-400">{bestRec.exito_pct ?? 50}%</p>
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2 text-xs text-emerald-300">
              {bestRec.status === 'EXCELENTE' ? '🔥 Señal EXCELENTE — Alta confianza para apostar' :
               bestRec.status === 'BUENA' ? '✅ Señal BUENA — Buena oportunidad' :
               '⚠️ Señal moderada — Considerar con precaución'}
            </div>
          </div>
        </div>
      )}

      {/* PLAN DE ACCIÓN: QUÉ COMPRAR */}
      {summary.action_plan && summary.action_plan.acciones.length > 0 && (
        <div className="rounded-2xl bg-gradient-to-br from-amber-600/15 via-orange-600/10 to-red-600/15 border border-amber-500/30 p-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-48 h-48 bg-amber-500/5 rounded-full -translate-y-24 -translate-x-24" />
          <div className="relative z-10">
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <span className="text-4xl">🎰</span>
              <div>
                <h2 className="text-xl font-extrabold text-white">PLAN DE ACCIÓN — QUÉ COMPRAR</h2>
                <p className="text-xs text-amber-300/80">Presupuesto diario: ${summary.action_plan.presupuesto_total} · {summary.action_plan.num_apuestas} apuesta(s)</p>
              </div>
            </div>

            {/* Budget bar */}
            <div className="mb-5 rounded-xl bg-black/20 p-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">Distribución del presupuesto</span>
                <span className="text-white font-bold">${summary.action_plan.total_asignado} / ${summary.action_plan.presupuesto_total}</span>
              </div>
              <div className="h-3 rounded-full bg-slate-700 overflow-hidden flex">
                {summary.action_plan.acciones.map((a, i) => {
                  const pct = (a.montoinvertir / summary.action_plan.presupuesto_total) * 100
                  const colors = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-pink-500']
                  return (
                    <div
                      key={i}
                      className={`${colors[i % colors.length]} h-full transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                      title={`${a.ciudad}: $${a.montoinvertir}`}
                    />
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {summary.action_plan.acciones.map((a, i) => {
                  const colors = ['text-emerald-400', 'text-blue-400', 'text-purple-400', 'text-amber-400', 'text-pink-400']
                  return (
                    <span key={i} className={`text-[10px] font-bold ${colors[i % colors.length]}`}>
                      {a.ciudad} ${a.montoinvertir}
                    </span>
                  )
                })}
                {summary.action_plan.total_restante > 0 && (
                  <span className="text-[10px] text-gray-500">+${summary.action_plan.total_restante} reserva</span>
                )}
              </div>
            </div>

            {/* Individual bets */}
            <div className="space-y-3">
              {summary.action_plan.acciones.map((accion, i) => (
                <ActionBetCard key={i} accion={accion} index={i} />
              ))}
            </div>

            {/* Scenarios */}
            <div className="mt-5 rounded-xl bg-black/20 p-4">
              <h4 className="text-xs font-bold text-white mb-3 flex items-center gap-2">
                <span>📊</span> ESCENARIOS POSIBLES
              </h4>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🟢</span>
                    <span className="text-xs font-bold text-emerald-400">CASO A: Ganas TODAS</span>
                  </div>
                  <p className="text-sm font-extrabold text-emerald-300">{summary.action_plan.escenario_caso_a}</p>
                  <p className="text-[10px] text-gray-400 mt-1">Si cada apuesta acierta, ganas el upside de cada una</p>
                </div>
                <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🔵</span>
                    <span className="text-xs font-bold text-blue-400">CASO B: Resultado esperado</span>
                  </div>
                  <p className="text-sm font-extrabold text-blue-300">{summary.action_plan.escenario_caso_b}</p>
                  <p className="text-[10px] text-gray-400 mt-1">Promedio ponderado por probabilidades del modelo</p>
                </div>
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🔴</span>
                    <span className="text-xs font-bold text-red-400">CASO C: Pierdes TODAS</span>
                  </div>
                  <p className="text-sm font-extrabold text-red-300">{summary.action_plan.escenario_caso_c}</p>
                  <p className="text-[10px] text-gray-400 mt-1">Si ninguna apuesta acierta, pierdes lo invertido</p>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="mt-4 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300/80">
              <strong>⚠️ IMPORTANTE:</strong> Este plan es informativo. El edge positivo significa ventaja estadística a LARGO PLAZO. En el corto plazo puedes perder. Apuesta solo lo que puedas permitirte perder. No invertirás automáticamente — decides tú.
            </div>
          </div>
        </div>
      )}

      {/* Global Accuracy Comparison */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-gradient-to-br from-blue-600/10 to-blue-500/5 border border-blue-500/20 p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-blue-300 font-semibold">PRECISIÓN GLOBAL</p>
            <DeltaBadge delta={summary.precision_global_delta} />
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-extrabold text-white">{summary.precision_global_hoy.toFixed(1)}%</span>
            {summary.precision_global_ayer !== null && (
              <span className="text-sm text-gray-500">vs {summary.precision_global_ayer.toFixed(1)}% ayer</span>
            )}
          </div>
          <div className="mt-2 h-2 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-1000"
              style={{ width: `${summary.precision_global_hoy}%` }}
            />
          </div>
        </div>

        <div className="rounded-xl bg-gradient-to-br from-purple-600/10 to-purple-500/5 border border-purple-500/20 p-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-purple-300 font-semibold">OPORTUNIDADES CON EDGE</p>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-extrabold text-white">{oportunidades.length}</span>
            <span className="text-sm text-gray-500">contratos con ventaja</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {oportunidades.slice(0, 3).map((o, i) => (
              <span key={i} className="rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-300">
                {o.ciudad} +{o.edge.toFixed(1)}%
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Highlights */}
      {summary.highlights.length > 0 && (
        <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <span className="text-lg">⚡</span>
            Cambios vs Día Anterior
          </h3>
          <div className="space-y-2">
            {summary.highlights.map((h, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-blue-400 mt-0.5">•</span>
                <span className="text-gray-300">{h}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Opportunities Table */}
      {oportunidades.length > 0 && (
        <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <span className="text-lg">💰</span>
            TOP Oportunidades (Edge × Precisión)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700/50">
                  <th className="p-2 font-semibold">#</th>
                  <th className="p-2 font-semibold">Ciudad</th>
                  <th className="p-2 font-semibold">Contrato</th>
                  <th className="p-2 font-semibold">Edge</th>
                  <th className="p-2 font-semibold">Precisión</th>
                  <th className="p-2 font-semibold">Consenso</th>
                  <th className="p-2 font-semibold">Señal</th>
                </tr>
              </thead>
              <tbody>
                {oportunidades.map((o, i) => (
                  <tr key={i} className="border-t border-gray-700/30 hover:bg-slate-800/50">
                    <td className="p-2 text-gray-500">{i + 1}</td>
                    <td className="p-2 text-white font-bold">{o.ciudad}</td>
                    <td className="p-2 text-blue-300">{o.contrato}</td>
                    <td className="p-2">
                      <span className={`font-bold ${o.edge > 10 ? 'text-emerald-400' : o.edge > 5 ? 'text-blue-400' : 'text-amber-400'}`}>
                        +{o.edge.toFixed(1)}%
                      </span>
                    </td>
                    <td className="p-2">
                      <span className={`font-bold ${o.accuracy >= 70 ? 'text-emerald-400' : o.accuracy >= 55 ? 'text-blue-400' : 'text-amber-400'}`}>
                        {o.accuracy.toFixed(0)}%
                      </span>
                    </td>
                    <td className="p-2 text-gray-300">{o.consenso}</td>
                    <td className="p-2">
                      <span className={`text-[10px] font-bold ${o.edge > 10 ? 'text-emerald-400' : o.edge > 5 ? 'text-blue-400' : 'text-amber-400'}`}>
                        {o.razon}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-City Summary */}
      <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <span className="text-lg">🏙️</span>
          Resumen por Ciudad
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.mejoras_por_ciudad.map(m => (
            <div key={m.slug} className="rounded-xl bg-slate-900/50 border border-gray-700/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-white">{m.ciudad}</span>
                <div className="flex items-center gap-2">
                  <TrendIcon tendencia={m.tendencia} />
                  <SignalBadge signal={m.signal} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-gray-500">Precisión ±1°C</p>
                  <div className="flex items-center gap-1">
                    <span className="text-white font-bold">{m.accuracy_hoy.toFixed(1)}%</span>
                    <DeltaBadge delta={m.accuracy_delta} />
                  </div>
                </div>
                <div>
                  <p className="text-gray-500">Mejor Edge</p>
                  <div className="flex items-center gap-1">
                    <span className="text-emerald-400 font-bold">+{m.best_edge_hoy.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                Mejor: {m.best_contract_hoy}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Resumen Text */}
      <div className="rounded-xl bg-gradient-to-r from-blue-600/10 via-blue-500/5 to-blue-600/10 border border-blue-500/20 p-4">
        <h3 className="text-sm font-bold text-blue-300 mb-2 flex items-center gap-2">
          <span className="text-lg">📝</span>
          Resumen del Día
        </h3>
        <p className="text-sm text-gray-300 leading-relaxed">{summary.resumen_texto}</p>
      </div>

      {/* Strong Signals Section */}
      {fuertes.length > 0 && (
        <div className="rounded-xl bg-gradient-to-br from-emerald-600/10 to-emerald-500/5 border border-emerald-500/20 p-4">
          <h3 className="text-sm font-bold text-emerald-400 mb-3 flex items-center gap-2">
            <span className="text-lg">🔥</span>
            Señales FUERTES del Día
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fuertes.map(f => (
              <div key={f.slug} className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold text-white">{f.ciudad}</span>
                  <span className="text-xs text-emerald-400 font-bold">{f.accuracy_hoy.toFixed(1)}%</span>
                </div>
                <p className="text-xs text-gray-400">Edge: +{f.best_edge_hoy.toFixed(1)}% · {f.best_contract_hoy}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
