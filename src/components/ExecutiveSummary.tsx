import { useState, useEffect, useMemo } from 'react'
import { DailyAnalysis, GlobalMetrics } from '@/types'
import { computeExecutiveSummary, ExecutiveSummary, BetAction } from '@/lib/unified-model'

function useCronCountdown(): string {
  const [label, setLabel] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const caracasOffset = -4 * 60
      const msOffset = caracasOffset * 60000
      const caracasMs = now.getTime() + msOffset
      const caracasDate = new Date(caracasMs)
      const caracasHour = caracasDate.getUTCHours()
      const caracasMin = caracasDate.getUTCMinutes()
      const caracasSec = caracasDate.getUTCSeconds()

      // Next 10PM Caracas (22:00)
      const next = new Date(caracasDate)
      if (caracasHour >= 22) {
        next.setUTCDate(next.getUTCDate() + 1)
      }
      next.setUTCHours(22, 0, 0, 0)

      const diffMs = next.getTime() - caracasMs
      if (diffMs <= 0) { setLabel('Ejecutándose...'); return }
      const h = Math.floor(diffMs / 3600000)
      const m = Math.floor((diffMs % 3600000) / 60000)
      const s = Math.floor((diffMs % 60000) / 1000)
      setLabel(`${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  return label
}

interface Props {
  analysis: DailyAnalysis | null
  metrics: GlobalMetrics | null
  previousAnalysis: DailyAnalysis | null
  previousMetrics: GlobalMetrics | null
}

interface Alert {
  type: 'error' | 'warning' | 'info'
  text: string
}

function SystemAlertBar({ alerts }: { alerts: Alert[] }) {
  const critical = alerts.filter(a => a.type === 'error')
  const warnings = alerts.filter(a => a.type === 'warning')
  if (critical.length === 0 && warnings.length === 0) {
    return (
      <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 flex items-center gap-2 text-sm">
        <span className="text-emerald-400 font-bold">✅</span>
        <span className="text-emerald-300">Sistema operativo — 9/9 ciudades con datos, nowcasting activo</span>
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 space-y-1">
      {[...critical, ...warnings].map((a, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className={a.type === 'error' ? 'text-red-400' : 'text-amber-400'}>
            {a.type === 'error' ? '✕' : '⚠'}
          </span>
          <span className={a.type === 'error' ? 'text-red-300' : 'text-amber-300'}>{a.text}</span>
        </div>
      ))}
    </div>
  )
}

function TrendSparkline({ data, width = 120, height = 28 }: { data: { mae: number }[]; width?: number; height?: number }) {
  if (data.length < 2) return null
  const values = data.map(d => d.mae)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 0.1)
  const pad = 2
  const w = width - pad * 2
  const h = height - pad * 2
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w
    const y = pad + h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  const last = values[values.length - 1]
  const first = values[0]
  const improving = last < first
  const color = improving ? '#34d399' : '#f87171'
  return (
    <svg width={width} height={height} className="inline-block">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => {
        const x = pad + (i / (values.length - 1)) * w
        const y = pad + h - ((v - min) / range) * h
        if (i === values.length - 1) return <circle key={i} cx={x} cy={y} r="2.5" fill={color} />
        return null
      })}
    </svg>
  )
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

function CompactBetCard({ accion, index }: { accion: BetAction; index: number }) {
  const colors = ['border-emerald-500/30', 'border-blue-500/30', 'border-purple-500/30']
  return (
    <div className={`rounded-lg border ${colors[index % colors.length]} bg-slate-900/50 p-3`}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-sm font-bold text-white">{accion.ciudad}</span>
          <span className="text-xs text-blue-300 ml-2">{accion.contrato}</span>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
          accion.signal === 'EXCELENTE' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' :
          accion.signal === 'BUENA' ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' :
          'text-amber-400 border-amber-500/30 bg-amber-500/10'
        }`}>{accion.signal}</span>
      </div>
      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        <div>
          <p className="text-gray-500">Invertir</p>
          <p className="font-bold text-amber-400">${accion.montoinvertir}</p>
        </div>
        <div>
          <p className="text-gray-500">Ganas</p>
          <p className="font-bold text-emerald-400">+${accion.upside}</p>
        </div>
        <div>
          <p className="text-gray-500">EV</p>
          <p className={`font-bold ${accion.ev > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {accion.ev > 0 ? '+' : ''}{accion.ev}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Edge</p>
          <p className="font-bold text-blue-400">+{accion.edge.toFixed(1)}%</p>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-gray-500 leading-relaxed">{accion.razon}</p>
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
    const citiesYesterday = previousAnalysis?.cities ?? null
    const recsYesterday = previousAnalysis?.recommendations ?? null
    const result = computeExecutiveSummary(fechaActual, citiesToday, recsToday, metrics, citiesYesterday, recsYesterday, previousMetrics)
    setSummary(result)
  }, [analysis, metrics, previousAnalysis, previousMetrics])

  // Compute system alerts (grouped by type to avoid repetition)
  const alerts = useMemo(() => {
    const list: Alert[] = []
    if (!analysis) return list
    const noNowcast: string[] = []
    const debil: string[] = []
    const fewModels: string[] = []
    for (const city of analysis.cities) {
      const numModels = Object.keys(city.forecast.ensemble_raw).length
      if (numModels < 3) fewModels.push(city.ciudad)
      if (!city.nowcast?.activo) noNowcast.push(city.ciudad)
      if (city.forecast.consenso === 'DEBIL') debil.push(city.ciudad)
    }
    if (fewModels.length) list.push({ type: 'error', text: `${fewModels.join(', ')}: pocos modelos` })
    if (noNowcast.length) {
      const names = noNowcast.length > 4 ? `${noNowcast.slice(0, 3).join(', ')} y ${noNowcast.length - 3} más` : noNowcast.join(', ')
      list.push({ type: 'warning', text: `${noNowcast.length} ciudades: nowcasting inactivo (${names})` })
    }
    if (debil.length) {
      const names = debil.length > 4 ? `${debil.slice(0, 3).join(', ')} y ${debil.length - 3} más` : debil.join(', ')
      list.push({ type: 'warning', text: `${debil.length} ciudades: consenso DÉBIL (${names})` })
    }
    return list
  }, [analysis])

  // Determine worst city (lowest accuracy in metrics)
  const worstCity = useMemo(() => {
    if (!metrics?.por_ciudad) return null
    return [...metrics.por_ciudad].sort((a, b) => b.mae - a.mae)[0]
  }, [metrics])

  // Daily MAE trend for sparkline
  const maeTrend = useMemo(() => {
    if (!metrics?.evolucion_diaria) return []
    return metrics.evolucion_diaria.slice(-14)
  }, [metrics])

  // Best recommendation for hot take
  const bestHot = useMemo(() => {
    if (!summary?.top_opportunities || summary.top_opportunities.length === 0) return null
    return summary.top_opportunities[0]
  }, [summary])

  // Expected ROI from action plan
  const roiData = useMemo(() => {
    if (!summary?.action_plan || summary.action_plan.acciones.length === 0) return null
    const apuestas = summary.action_plan.acciones
    const totalInv = apuestas.reduce((s, a) => s + a.montoinvertir, 0)
    const totalEV = apuestas.reduce((s, a) => s + a.ev, 0)
    const roi = totalInv > 0 ? (totalEV / totalInv) * 100 : 0
    const upsideTotal = apuestas.reduce((s, a) => s + a.upside, 0)
    const downsideTotal = apuestas.reduce((s, a) => s + a.downside, 0)
    return { totalInv, totalEV, roi, upsideTotal, downsideTotal, numApuestas: apuestas.length }
  }, [summary])

  const cronCountdown = useCronCountdown()

  // Format the analysis date for display
  const analysisDate = analysis?.fecha_objetivo
    ? new Date(analysis.fecha_objetivo + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : ''

  if (!analysis || analysis.cities.length === 0) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-gray-700/30 p-8 text-center">
        <div className="text-4xl mb-4">📊</div>
        <h2 className="text-xl font-bold text-white mb-2">Resumen Ejecutivo</h2>
        <p className="text-gray-400">Ejecuta el análisis para ver el resumen del día.</p>
      </div>
    )
  }

  const actions = summary?.action_plan?.acciones ?? []

  return (
    <div className="space-y-4">
      {/* ===== ALERT BAR ===== */}
      <SystemAlertBar alerts={alerts} />

      {/* ===== CRON INFO ===== */}
      <div className="flex items-center justify-between rounded-lg bg-slate-800/30 border border-gray-700/20 px-4 py-2 text-xs">
        <div className="flex items-center gap-2 text-gray-400">
          <span>📡</span>
          <span>Resumen del <span className="text-white font-semibold">{analysisDate}</span></span>
          <span className="text-gray-600">|</span>
          <span>Capturado a las <span className="text-blue-300 font-semibold">10PM Caracas</span> (cron noche anterior)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Próximo cron:</span>
          <span className="font-mono font-bold text-emerald-400 min-w-[100px] text-right">{cronCountdown}</span>
        </div>
      </div>

      {/* ===== HOT TAKE ROW ===== */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-gradient-to-br from-emerald-600/20 to-emerald-500/5 border border-emerald-500/30 p-4">
          <p className="text-[10px] text-emerald-300 font-semibold tracking-wider mb-1">🔥 MEJOR OPORTUNIDAD</p>
          {bestHot ? (
            <>
              <p className="text-lg font-extrabold text-white">{bestHot.ciudad}</p>
              <p className="text-xs text-blue-300 mb-2">{bestHot.contrato}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-emerald-400">+{bestHot.edge.toFixed(1)}%</span>
                <span className="text-xs text-gray-400">edge</span>
                <span className="text-xs text-purple-400">{bestHot.accuracy.toFixed(0)}% acierto</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-1">{bestHot.razon}</p>
            </>
          ) : (
            <p className="text-sm text-gray-400">Sin oportunidades con edge suficiente</p>
          )}
        </div>

        <div className="rounded-xl bg-gradient-to-br from-red-600/15 to-red-500/5 border border-red-500/20 p-4">
          <p className="text-[10px] text-red-300 font-semibold tracking-wider mb-1">⚠️ A TENER CUIDADO</p>
          {worstCity ? (
            <>
              <p className="text-lg font-extrabold text-white">{worstCity.ciudad}</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-extrabold text-red-400">MAE {worstCity.mae.toFixed(2)}°C</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Bias {worstCity.bias > 0 ? '+' : ''}{worstCity.bias.toFixed(2)}°C · {worstCity.muestras} muestras
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400">Sin datos suficientes</p>
          )}
        </div>

        <div className="rounded-xl bg-gradient-to-br from-blue-600/15 to-blue-500/5 border border-blue-500/20 p-4">
          <p className="text-[10px] text-blue-300 font-semibold tracking-wider mb-1">📊 SISTEMA</p>
          <p className="text-lg font-extrabold text-white">{analysis.cities.length}/9 ciudades</p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-1">
            <span>{metrics?.total_muestras ?? 0} muestras históricas</span>
            <span>· Precisión <span className="text-emerald-400 font-bold">{metrics?.accuracy_pct.toFixed(1) ?? '?'}%</span></span>
          </div>
          <div className="flex flex-wrap gap-x-3 text-[10px] text-gray-500">
            <span>Bias: {metrics?.overall_bias ? `${metrics.overall_bias > 0 ? '+' : ''}${metrics.overall_bias.toFixed(2)}°C` : '?'}</span>
            <span>MAE: {metrics?.overall_mae ? `${metrics.overall_mae.toFixed(2)}°C` : '?'}</span>
          </div>
        </div>
      </div>

      {/* ===== TREND + ACCURACY ===== */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400 font-semibold">PRECISIÓN GLOBAL ±0.5°C</p>
            {summary && <DeltaBadge delta={summary.precision_global_delta} />}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-extrabold text-white">{metrics?.accuracy_pct.toFixed(1) ?? '?'}%</span>
            {summary?.precision_global_ayer != null && (
              <span className="text-xs text-gray-500">ayer {summary.precision_global_ayer.toFixed(1)}%</span>
            )}
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-1000" style={{ width: `${metrics?.accuracy_pct ?? 0}%` }} />
          </div>
          <div className="mt-2 text-[10px] text-gray-500">
            MAE <span className="text-white font-bold">{metrics?.overall_mae.toFixed(2) ?? '?'}°C</span>
            <span className="mx-2">·</span>
            RMSE <span className="text-white font-bold">{metrics?.overall_rmse.toFixed(2) ?? '?'}°C</span>
            <span className="mx-2">·</span>
            Bias <span className="text-white font-bold">{metrics?.overall_bias ? `${metrics.overall_bias > 0 ? '+' : ''}${metrics.overall_bias.toFixed(2)}°C` : '?'}</span>
          </div>
        </div>

        <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-400 font-semibold">TENDENCIA MAE (14 DÍAS)</p>
            {maeTrend.length >= 2 && (
              <span className={`text-[10px] font-bold ${maeTrend[maeTrend.length-1].mae < maeTrend[0].mae ? 'text-emerald-400' : 'text-red-400'}`}>
                {maeTrend[maeTrend.length-1].mae < maeTrend[0].mae ? '▼ mejorando' : '▲ empeorando'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <TrendSparkline data={maeTrend} width={160} height={32} />
            <div className="text-xs text-gray-400">
              {maeTrend.length >= 2 && (
                <>
                  <span className="text-white font-bold">{maeTrend[0].mae.toFixed(2)}°</span>
                  <span className="text-gray-600 mx-1">→</span>
                  <span className="text-white font-bold">{maeTrend[maeTrend.length-1].mae.toFixed(2)}°</span>
                </>
              )}
            </div>
          </div>
          <div className="mt-1 text-[10px] text-gray-500">
            {maeTrend.length} días con datos · {metrics?.total_muestras ?? 0} registros totales
          </div>
        </div>
      </div>

      {/* ===== EXPECTED P&L ===== */}
      {roiData && summary && (
        <div className="rounded-xl bg-gradient-to-br from-amber-600/15 to-amber-500/5 border border-amber-500/30 p-4">
          <p className="text-[10px] text-amber-300 font-semibold tracking-wider mb-2">💰 EXPECTED P&L — HOY</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-lg bg-black/20 p-2 text-center">
              <p className="text-[10px] text-gray-400">Presupuesto</p>
              <p className="text-lg font-extrabold text-white">${summary.action_plan.presupuesto_total}</p>
            </div>
            <div className="rounded-lg bg-black/20 p-2 text-center">
              <p className="text-[10px] text-gray-400">Asignado</p>
              <p className="text-lg font-extrabold text-amber-400">${roiData.totalInv.toFixed(2)}</p>
            </div>
            <div className="rounded-lg bg-black/20 p-2 text-center">
              <p className="text-[10px] text-gray-400">EV esperado</p>
              <p className={`text-lg font-extrabold ${roiData.totalEV > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {roiData.totalEV > 0 ? '+' : ''}${roiData.totalEV.toFixed(2)}
              </p>
            </div>
            <div className="rounded-lg bg-black/20 p-2 text-center">
              <p className="text-[10px] text-gray-400">ROI esperado</p>
              <p className={`text-lg font-extrabold ${roiData.roi > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {roiData.roi > 0 ? '+' : ''}{roiData.roi.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg bg-black/20 p-2 text-center">
              <p className="text-[10px] text-gray-400">Apuestas</p>
              <p className="text-lg font-extrabold text-white">{roiData.numApuestas}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
            <span>Si ganas todas: <span className="text-emerald-400 font-bold">+${roiData.upsideTotal.toFixed(2)}</span></span>
            <span>Si pierdes todas: <span className="text-red-400 font-bold">-${roiData.downsideTotal.toFixed(2)}</span></span>
          </div>
        </div>
      )}

      {/* ===== ACTION PLAN ===== */}
      {actions.length > 0 && summary && (
        <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="text-lg">🎰</span>
              PLAN DE ACCIÓN
            </h3>
            <span className="text-xs text-gray-400">${summary.action_plan.total_asignado} / ${summary.action_plan.presupuesto_total} asignados</span>
          </div>
          <div className="h-2 rounded-full bg-slate-700 overflow-hidden flex mb-4">
            {actions.map((a, i) => {
              const pct = (a.montoinvertir / summary.action_plan.presupuesto_total) * 100
              const colors = ['bg-emerald-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-pink-500']
              return <div key={i} className={`${colors[i % colors.length]} h-full transition-all duration-500`} style={{ width: `${pct}%` }} title={`${a.ciudad}: $${a.montoinvertir}`} />
            })}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map((a, i) => <CompactBetCard key={i} accion={a} index={i} />)}
          </div>
        </div>
      )}

      {/* ===== SEÑALES FUERTES ===== */}
      {summary && summary.mejoras_por_ciudad.filter(m => m.signal === 'FUERTE').length > 0 && (
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
          <h3 className="text-xs font-bold text-emerald-400 mb-2 flex items-center gap-2">
            <span>🔥</span> SEÑALES FUERTES
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.mejoras_por_ciudad.filter(m => m.signal === 'FUERTE').map(m => (
              <span key={m.slug} className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs text-emerald-300 font-bold">
                {m.ciudad} {m.accuracy_hoy.toFixed(0)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ===== PER-CITY SNAPSHOT ===== */}
      <div className="rounded-xl bg-slate-800/30 border border-gray-700/20 p-4">
        <h3 className="text-xs font-bold text-gray-400 mb-3 flex items-center gap-2">
          <span>🏙️</span> CIUDADES — PRONÓSTICO vs PRECISIÓN
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
          {analysis.cities.sort((a, b) => b.exito_pct - a.exito_pct).map(c => {
            const numModels = Object.keys(c.forecast.ensemble_raw).length
            const hasNowcast = c.nowcast?.activo
            const consensusOk = c.forecast.consenso !== 'DEBIL'
            const needsAttention = c.exito_pct < 55
            return (
              <div key={c.slug} className={`rounded-lg border p-2 text-center ${needsAttention && c.exito_pct >= 45 ? 'bg-amber-900/20 border-amber-800/30' : needsAttention ? 'bg-red-900/20 border-red-800/30' : 'bg-slate-900/50 border-gray-700/30'}`}>
                <p className="text-[10px] text-gray-400 truncate font-semibold">
                  {c.forecast.weather && <span className="mr-0.5">{c.forecast.weather.icon}</span>}
                  {c.ciudad.split(',')[0]}
                </p>
                <p className="text-sm font-extrabold text-emerald-400">{c.forecast.temp_corregida.toFixed(1)}°</p>
                <p className="text-[9px] text-blue-300 font-semibold">{Math.round(c.forecast.temp_corregida)}° entero</p>
                <div className="flex items-center justify-center gap-1 mt-0.5">
                  {needsAttention && <span className="text-red-400 text-[8px]">⚠</span>}
                  <span className={`text-[8px] font-bold ${c.exito_pct >= 55 ? 'text-emerald-400' : c.exito_pct >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                    {c.exito_pct}%
                  </span>
                  <span className="text-[7px] text-gray-600">{numModels}m</span>
                </div>
                <div className="flex items-center justify-center gap-1">
                  <span className={`text-[7px] font-semibold ${c.exito_pct_integer >= 55 ? 'text-blue-400' : c.exito_pct_integer >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                    {c.exito_pct_integer}% entero
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ===== WEATHER ICON LEGEND ===== */}
      <div className="text-[10px] text-gray-500 flex items-center gap-3 flex-wrap justify-center">
        <span>🌤 Despejado</span>
        <span>⛅ Nubes</span>
        <span>🌧 Lluvia</span>
        <span>🌨 Nieve</span>
        <span>⛈ Tormenta</span>
        <span className="text-gray-600">|</span>
        <span>Los iconos junto al nombre de la ciudad indican el clima pronosticado para el mediodía local</span>
      </div>

      {/* ===== SUMMARY TEXT ===== */}
      {summary?.resumen_texto && (
        <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 p-3 text-xs text-gray-400 leading-relaxed">
          {summary.resumen_texto}
        </div>
      )}
    </div>
  )
}
