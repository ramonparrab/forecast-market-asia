import { useState, useEffect, useMemo } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'
import { CityMejoraResult, DiaComparacion, MejoraMetrics, MejoraKey, MEJORA_LABELS, MEJORA_DESCRIPTIONS, PipelineStep } from '@/lib/mejora-continua-engine'

interface ApiResponse {
  ciudades: Record<string, CityMejoraResult>
}

const MEJORA_KEYS: MejoraKey[] = ['station', 'rapid_warming', 'range_bias', 'combinado']

type SubView = 'analisis' | 'pipeline'

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function SimpleChart({ data, mejoraKey }: { data: DiaComparacion[]; mejoraKey: MejoraKey }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; idx: number } | null>(null)

  if (data.length === 0) return null
  const display = data.slice(-30)
  const temps = display.flatMap(d => [d.temp_real, d.temp_corregida, d[mejoraKey].temp])
  const minT = Math.floor(Math.min(...temps) - 1)
  const maxT = Math.ceil(Math.max(...temps) + 1)
  const range = maxT - minT || 1
  const w = Math.max(display.length * 40, 400)
  const h = 240
  const pad = { top: 20, right: 20, bottom: 30, left: 50 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom

  const xScale = (i: number) => pad.left + (i / (display.length - 1 || 1)) * plotW
  const yScale = (v: number) => pad.top + plotH - ((v - minT) / range) * plotH

  const realPath = display.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v.temp_real).toFixed(1)}`).join(' ')
  const actualPath = display.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v.temp_corregida).toFixed(1)}`).join(' ')
  const mejoradoPath = display.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v[mejoraKey].temp).toFixed(1)}`).join(' ')

  const yTicks: number[] = []
  for (let t = Math.ceil(minT / 5) * 5; t <= maxT; t += 5) yTicks.push(t)
  if (yTicks.length < 2) { yTicks.push(minT); yTicks.push(maxT) }

  const xTicks: { i: number; label: string }[] = []
  const step = Math.max(1, Math.floor(display.length / 8))
  for (let i = 0; i < display.length; i += step) {
    const d = new Date(display[i].fecha + 'T12:00:00')
    xTicks.push({ i, label: `${d.getDate()}/${d.getMonth() + 1}` })
  }
  if (xTicks.length === 0 || xTicks[xTicks.length - 1].i !== display.length - 1) {
    const d = new Date(display[display.length - 1].fecha + 'T12:00:00')
    xTicks.push({ i: display.length - 1, label: `${d.getDate()}/${d.getMonth() + 1}` })
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const scaleX = rect.width / w
    const plotX = mx / scaleX
    const idx = Math.round((plotX - pad.left) / plotW * (display.length - 1))
    if (idx >= 0 && idx < display.length) {
      setTooltip({ x: e.clientX, y: e.clientY, idx })
    }
  }

  function handleMouseLeave() {
    setTooltip(null)
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" style={{ maxHeight: 260 }}
        onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
        <rect x={0} y={0} width={w} height={h} fill="transparent" />
        {yTicks.map(t => (
          <g key={t}>
            <line x1={pad.left} y1={yScale(t)} x2={w - pad.right} y2={yScale(t)} stroke="#1e293b" strokeWidth={1} />
            <text x={pad.left - 6} y={yScale(t) + 4} textAnchor="end" fill="#64748b" fontSize={11}>{t}°C</text>
          </g>
        ))}
        {xTicks.map(xt => (
          <text key={xt.i} x={xScale(xt.i)} y={h - 6} textAnchor="middle" fill="#64748b" fontSize={10}>{xt.label}</text>
        ))}
        {xTicks.map(xt => (
          <line key={`gx-${xt.i}`} x1={xScale(xt.i)} y1={pad.top} x2={xScale(xt.i)} y2={h - pad.bottom} stroke="#1e293b" strokeWidth={0.5} />
        ))}
        {display.map((d, i) => {
          if (d.error_actual === null || d[mejoraKey]?.error === null) return null
          const actBetter = Math.abs(d[mejoraKey].error) < Math.abs(d.error_actual)
          const color = actBetter ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)'
          return (
            <line key={`err-${i}`} x1={xScale(i)} y1={yScale(d.temp_corregida)} x2={xScale(i)} y2={yScale(d.temp_real)}
              stroke={color} strokeWidth={3} opacity={0.4} />
          )
        })}
        <path d={realPath} fill="none" stroke="#fbbf24" strokeWidth={2.5} opacity={0.9} />
        <path d={actualPath} fill="none" stroke="#60a5fa" strokeWidth={2} strokeDasharray="6,3" opacity={0.7} />
        <path d={mejoradoPath} fill="none" stroke="#34d399" strokeWidth={2} strokeDasharray="3,3" opacity={0.8} />
        <g transform={`translate(${w - 150}, 6)`}>
          <line x1={0} y1={0} x2={20} y2={0} stroke="#fbbf24" strokeWidth={2} />
          <text x={26} y={4} fill="#94a3b8" fontSize={10}>Real</text>
          <line x1={70} y1={0} x2={90} y2={0} stroke="#60a5fa" strokeWidth={2} strokeDasharray="6,3" />
          <text x={96} y={4} fill="#94a3b8" fontSize={10}>Actual</text>
          <line x1={0} y1={16} x2={20} y2={16} stroke="#34d399" strokeWidth={2} strokeDasharray="3,3" />
          <text x={26} y={20} fill="#94a3b8" fontSize={10}>Mejorado</text>
        </g>
      </svg>
      {tooltip && (() => {
        const d = display[tooltip.idx]
        const actError = Math.abs(d.error_actual)
        const mejError = Math.abs(d[mejoraKey].error)
        const isBetter = mejError < actError
        const fmt = (v: number) => v.toFixed(1) + '°C'
        const fmtErr = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '°C'
        return (
          <div className="fixed pointer-events-none z-50 bg-slate-900/95 border border-gray-600 rounded-lg p-3 text-xs shadow-xl"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}>
            <div className="text-gray-400 font-semibold mb-1.5 border-b border-gray-700 pb-1">{d.fecha}</div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Real: <span className="text-white font-mono">{fmt(d.temp_real)}</span></div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />Actual: <span className="text-white font-mono">{fmt(d.temp_corregida)}</span></div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Mejorado: <span className="text-white font-mono">{fmt(d[mejoraKey].temp)}</span></div>
            <div className={`mt-1.5 pt-1.5 border-t border-gray-700 text-center ${isBetter ? 'text-emerald-400' : 'text-red-400'}`}>
              {isBetter ? '✅ ' : '❌ '}Error: {fmtErr(d[mejoraKey].error)}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function MetricsCard({ metrics, label, desc }: { metrics: MejoraMetrics; label: string; desc: string }) {
  const mejora = metrics.mejora_mae_pct
  const mejoraColor = mejora > 5 ? 'text-emerald-400' : mejora > 0 ? 'text-emerald-300' : 'text-red-400'
  const mejoraIcon = mejora > 5 ? '🟢' : mejora > 0 ? '🟡' : '🔴'

  return (
    <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        <span className="text-2xl">{mejoraIcon}</span>
      </div>
      <p className="text-xs text-gray-500 mb-3">{desc}</p>
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">MAE Actual</span>
          <span className="text-blue-400 font-medium">{metrics.mae_actual.toFixed(2)}°C</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">MAE Mejorado</span>
          <span className="text-emerald-400 font-medium">{metrics.mae_mejorado.toFixed(2)}°C</span>
        </div>
        <div className="flex justify-between border-t border-gray-700/30 pt-1.5">
          <span className="text-gray-400">Mejora</span>
          <span className={`font-bold ${mejoraColor}`}>{mejora >= 0 ? '+' : ''}{mejora.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Bias Actual</span>
          <span className="text-blue-400 font-medium">{metrics.bias_actual.toFixed(2)}°C</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Bias Mejorado</span>
          <span className="text-emerald-400 font-medium">{metrics.bias_mejorado.toFixed(2)}°C</span>
        </div>
        <div className="flex justify-between border-t border-gray-700/30 pt-1.5">
          <span className="text-gray-400">Días</span>
          <span className="text-white">
            <span className="text-emerald-400">{metrics.dias_mejora}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-red-400">{metrics.dias_empeora}</span>
            <span className="text-gray-600"> / </span>
            <span className="text-gray-500">{metrics.dias_empate}</span>
            <span className="text-gray-500 ml-1">(M/E/E)</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function PipelineDiagram() {
  const boxW = 155
  const boxH = 78
  const gapX = 22
  const row1Y = 30
  const row2Y = 155
  const row3Y = 280
  const row4Y = 405
  const w = boxW * 4 + gapX * 3 + 20
  const h = row4Y + boxH + 30

  const steps = [
    { x: 10, y: row1Y, titulo: '1. Modelos Crudos', desc: 'Consulta 6 modelos meteorológicos (GFS, ECMWF, ICON, JMA, MeteoFrance) + hasta 51 miembros ECMWF ENS', color: '#6366f1' },
    { x: 10 + (boxW + gapX), y: row1Y, titulo: '2. Z-score Filter', desc: 'Elimina modelos con desviación |z| > 3σ del conjunto para excluir outliers meteorológicos', color: '#8b5cf6' },
    { x: 10 + (boxW + gapX) * 2, y: row1Y, titulo: '3. EWMA Pesos Adaptativos', desc: 'Asigna peso dinámico a cada modelo según su MAE histórico con decaimiento exponencial α=0.15', color: '#a855f7' },
    { x: 10 + (boxW + gapX) * 3, y: row1Y, titulo: '4. temp_ponderada', desc: 'Promedio ponderado de los 6 modelos filtrados usando los pesos EWMA como proporción', color: '#06b6d4' },
    { x: 10, y: row2Y, titulo: '5. Backtest Bias Estacional', desc: 'Suma un bias fijo por ciudad + mes calendario calculado del backtest histórico de hasta 90 días', color: '#0ea5e9' },
    { x: 10 + (boxW + gapX), y: row2Y, titulo: '6. Dynamic EMA Bias', desc: 'Calcula EMA de los errores recientes con α=0.3 sobre los últimos 30 días para corrección dinámica', color: '#3b82f6' },
    { x: 10 + (boxW + gapX) * 2, y: row2Y, titulo: '7. temp_corregida ACTUAL', desc: 'Forecast punto final del sistema actual: temp_ponderada + backtest_bias + ema_bias', color: '#10b981' },
  ]

  const mejoras = [
    { x: 10, y: row3Y, titulo: '8. + Station Bias 🟡', desc: 'Suma el error promedio histórico entre el grid (celda ~11km) y la estación meteorológica real del aeropuerto', color: '#f59e0b' },
    { x: 10 + (boxW + gapX), y: row3Y, titulo: '9. + Range Bias 🟡', desc: 'Aplica bias distinto según rango de temperatura: <20°C, 20-25, 25-30, 30-35, 35+°C con su propio sesgo histórico', color: '#f97316' },
    { x: 10 + (boxW + gapX) * 2, y: row3Y, titulo: '10. + Rapid Warming 🟡', desc: 'Si el forecast de hoy supera por >3°C la temp real de ayer, suma +0.5°C para capturar olas de calor', color: '#ef4444' },
    { x: 10 + (boxW + gapX) * 3, y: row3Y, titulo: '11. temp_corregida MEJORADA', desc: 'Forecast punto final mejorado: actual + station + range + rapid_warming', color: '#34d399' },
  ]

  const postSteps = [
    { x: 10, y: row4Y, titulo: '12. Monte Carlo 20K Sims', desc: '20,000 simulaciones con ruido Student-t ν=4. Si hay ≥20 miembros ECMWF ENS usa CDF empírica directa', color: '#14b8a6' },
    { x: 10 + (boxW + gapX), y: row4Y, titulo: '13. Probabilidad por Bucket', desc: '% de simulaciones que caen en cada bucket de Polymarket para generar prob_ia_raw de cada contrato', color: '#06b6d4' },
    { x: 10 + (boxW + gapX) * 2, y: row4Y, titulo: '14. Normalización Identity', desc: 'prob_ia_norm = prob_ia_raw / suma. Sin Platt scaling aún (pendiente de implementar con datos calibrados)', color: '#8b5cf6' },
    { x: 10 + (boxW + gapX) * 3, y: row4Y, titulo: '15. Kelly Allocation', desc: 'Fracción de Kelly f=0.25, edge mínimo 6%, $10/día. Calcula el monto óptimo por cada apuesta', color: '#a855f7' },
  ]

  const arrowConfigs: { x1: number; y1: number; x2: number; y2: number; color: string; dashed: boolean }[] = [
    { x1: steps[0].x + boxW, y1: steps[0].y + boxH/2, x2: steps[1].x, y2: steps[1].y + boxH/2, color: '#475569', dashed: false },
    { x1: steps[1].x + boxW, y1: steps[1].y + boxH/2, x2: steps[2].x, y2: steps[2].y + boxH/2, color: '#475569', dashed: false },
    { x1: steps[2].x + boxW, y1: steps[2].y + boxH/2, x2: steps[3].x, y2: steps[3].y + boxH/2, color: '#475569', dashed: false },
    { x1: steps[3].x + boxW/2, y1: steps[3].y + boxH, x2: steps[4].x + boxW/2, y2: steps[4].y, color: '#475569', dashed: false },
    { x1: steps[4].x + boxW, y1: steps[4].y + boxH/2, x2: steps[5].x, y2: steps[5].y + boxH/2, color: '#475569', dashed: false },
    { x1: steps[5].x + boxW, y1: steps[5].y + boxH/2, x2: steps[6].x, y2: steps[6].y + boxH/2, color: '#475569', dashed: false },
    { x1: steps[6].x + boxW/2, y1: steps[6].y + boxH, x2: mejoras[0].x + boxW/2, y2: mejoras[0].y, color: '#f59e0b', dashed: true },
    { x1: mejoras[0].x + boxW, y1: mejoras[0].y + boxH/2, x2: mejoras[3].x, y2: mejoras[3].y + boxH/2, color: '#f59e0b', dashed: true },
    { x1: mejoras[1].x + boxW, y1: mejoras[1].y + boxH/2, x2: mejoras[3].x, y2: mejoras[3].y + boxH/2, color: '#f59e0b', dashed: true },
    { x1: mejoras[2].x + boxW, y1: mejoras[2].y + boxH/2, x2: mejoras[3].x, y2: mejoras[3].y + boxH/2, color: '#f59e0b', dashed: true },
    { x1: mejoras[3].x + boxW/2, y1: mejoras[3].y + boxH, x2: postSteps[0].x + boxW/2, y2: postSteps[0].y, color: '#475569', dashed: false },
    { x1: postSteps[0].x + boxW, y1: postSteps[0].y + boxH/2, x2: postSteps[1].x, y2: postSteps[1].y + boxH/2, color: '#475569', dashed: false },
    { x1: postSteps[1].x + boxW, y1: postSteps[1].y + boxH/2, x2: postSteps[2].x, y2: postSteps[2].y + boxH/2, color: '#475569', dashed: false },
    { x1: postSteps[2].x + boxW, y1: postSteps[2].y + boxH/2, x2: postSteps[3].x, y2: postSteps[3].y + boxH/2, color: '#475569', dashed: false },
  ]

  const allBoxes = [...steps, ...mejoras, ...postSteps]

  function wrapText(text: string, maxChars: number): string[] {
    const words = text.split(' ')
    const lines: string[] = []
    let current = ''
    for (const w of words) {
      if ((current + ' ' + w).trim().length <= maxChars) { current = (current + ' ' + w).trim() }
      else { if (current) lines.push(current); current = w }
    }
    if (current) lines.push(current)
    return lines
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" style={{ minWidth: w, maxHeight: h + 20 }}>
        <rect x={0} y={0} width={w} height={h} fill="transparent" />

        <text x={10} y={16} fill="#64748b" fontSize={10} fontWeight="bold">⬇ PROCESO BASE (actual y mejorado comparten pasos 1-7, 12-15)</text>
        <text x={10} y={row2Y - 6} fill="#64748b" fontSize={10} fontWeight="bold">⬇ CORRECCIÓN DE SESGO (actual y mejorado comparten pasos 5-7)</text>
        <text x={10} y={row3Y - 6} fill="#f59e0b" fontSize={10} fontWeight="bold">🟡 MEJORAS NUEVAS (solo aplican al sistema mejorado, pasos 8-11)</text>
        <text x={10} y={row4Y - 6} fill="#14b8a6" fontSize={10} fontWeight="bold">⬇ POST-PROCESO (actual y mejorado comparten pasos 12-15)</text>

        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#475569" />
          </marker>
          <marker id="arrowhead-amber" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
          </marker>
        </defs>

        {arrowConfigs.map((a, i) => (
          <line key={`arrow-${i}`} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
            stroke={a.color} strokeWidth={1.5} strokeDasharray={a.dashed ? '5,3' : 'none'}
            markerEnd={a.dashed ? 'url(#arrowhead-amber)' : 'url(#arrowhead)'} />
        ))}

        {allBoxes.map((s, i) => {
          const isMejora = s.titulo.includes('🟡')
          const borderColor = isMejora ? '#f59e0b' : s.color
          const bgOpacity = isMejora ? 0.12 : 0.15
          const lines = wrapText(s.desc, 36)
          return (
            <g key={`box-${i}`}>
              <rect x={s.x} y={s.y} width={boxW} height={boxH} rx={7} fill={s.color} opacity={bgOpacity} stroke={borderColor} strokeWidth={1.5} />
              <text x={s.x + boxW/2} y={s.y + 16} textAnchor="middle" fill="#e2e8f0" fontSize={10} fontWeight="bold">
                {s.titulo}
              </text>
              <line x1={s.x + 8} y1={s.y + 23} x2={s.x + boxW - 8} y2={s.y + 23} stroke={s.color} strokeWidth={0.5} opacity={0.4} />
              {lines.map((line, li) => (
                <text key={li} x={s.x + 8} y={s.y + 37 + li * 11} fill="#cbd5e1" fontSize={8.5}>
                  {line}
                </text>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function PipelineView() {
  const pipelineSteps = [
    { paso: 1, etapa: 'Fetch modelos', desc: 'Consulta Open-Meteo para los modelos meteorológicos', actual: 'best_match, ecmwf_ifs025, gfs_seamless, icon_seamless, jma_seamless, meteofrance_seamless + ECMWF ENS 51', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 2, etapa: 'Fetch estación', desc: 'Obtiene temp real histórica desde TWC usando ICAO de la estación', actual: 'ICAO correcto (ZUCK, ZBAA, VHHH, etc.)', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 3, etapa: 'Z-score filter', desc: 'Elimina modelos outlier con |z| > 3σ del promedio ponderado', actual: 'Sí, en ensemble.ts', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 4, etapa: 'EWMA pesos adaptativos', desc: 'Peso dinámico por modelo según MAE histórico', actual: 'α=0.15, bias-correction.ts', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 5, etapa: 'Ensemble promedio', desc: 'temp_ponderada = promedio ponderado de todos los modelos', actual: 'Sí, en ensemble.ts', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 6, etapa: 'Backtest bias estacional', desc: 'Bias por ciudad+mes desde tabla backtest_bias', actual: 'temp_ponderada + backtest_bias[slug][mes]', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 7, etapa: 'Dynamic EMA bias', desc: 'EMA de errores recientes (últimos 30 días)', actual: 'α=0.3, bias-correction.ts', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 8, etapa: 'Station bias', desc: 'Bias grid→estación: promedio histórico de errores por ciudad', actual: '❌ No se aplica', mejorado: '✅ Se suma el bias de estación al forecast', diff: 'NUEVO' },
    { paso: 9, etapa: 'Range bias', desc: 'Bias distinto según rango de temp (<20, 20-25, 25-30, 30-35, 35+)', actual: '❌ No se aplica', mejorado: '✅ Se suma bias del rango correspondiente', diff: 'NUEVO' },
    { paso: 10, etapa: 'Rapid warming boost', desc: '+0.5°C si forecast de hoy > temp_real de ayer + 3°C', actual: '❌ No se aplica', mejorado: '✅ Se suma +0.5°C en calentamientos bruscos', diff: 'NUEVO' },
    { paso: 11, etapa: 'Nowcast blending', desc: 'Si hay observación en vivo, blend con forecast según hora del día', actual: 'Sí, pesos dinámicos', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 12, etapa: 'Monte Carlo 20K', desc: '20,000 simulaciones con ruido Student-t ν=4 (o CDF empírica ECMWF ENS)', actual: 'Sí, en montecarlo.ts', mejorado: 'Igual', diff: 'Pendiente: underdispersion' },
    { paso: 13, etapa: 'Probabilidad por bucket', desc: '% de simulaciones que caen en cada bucket de Polymarket', actual: 'prob_ia_raw para cada contrato', mejorado: 'Igual', diff: 'Pendiente: calibración' },
    { paso: 14, etapa: 'Normalización', desc: 'prob_ia_norm = prob_ia_raw / sum(prob_ia_raw). Identity (sin calibración)', actual: 'Identity (Platt scaling no activo)', mejorado: 'Igual', diff: 'Pendiente: Platt scaling' },
    { paso: 15, etapa: 'Kelly allocation', desc: 'Fracción de Kelly (0.25), edge mínimo 6%, $10/día', actual: 'Sí, en signals-engine.ts', mejorado: 'Igual', diff: 'Sin cambio' },
    { paso: 16, etapa: 'Recomendación final', desc: 'Qué bucket comprar, con qué edge, cuánto asignar', actual: 'Basada en temp_corregida actual', mejorado: 'Basada en temp_corregida + 3 correcciones', diff: '✅ El forecast cambió → cambia prob y recomendación' },
  ]

  const diffColor = (d: string) => {
    if (d.includes('NUEVO')) return 'text-amber-400'
    if (d.includes('Pendiente')) return 'text-gray-500'
    if (d.includes('Igual') || d.includes('Sin cambio')) return 'text-gray-500'
    return 'text-emerald-400'
  }

  return (
    <div className="space-y-6">
      {/* Pipeline Graphic */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-6">
        <h3 className="text-sm font-semibold text-white mb-4">🔄 Pipeline del Pronóstico: Actual vs Mejorado</h3>
        <PipelineDiagram />
      </div>

      {/* Step-by-step comparative table */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 overflow-hidden">
        <div className="p-4 border-b border-gray-700/30">
          <h3 className="text-sm font-semibold text-white">📋 Tabla Comparativa Paso a Paso</h3>
          <p className="text-xs text-gray-500 mt-1">Cada etapa del pipeline, qué hace el sistema actual vs el mejorado</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800/50 text-gray-400">
                <th className="text-left p-3 w-12">#</th>
                <th className="text-left p-3">Etapa</th>
                <th className="text-left p-3 w-64">Descripción</th>
                <th className="text-left p-3 w-72">Sistema Actual</th>
                <th className="text-left p-3 w-72">Sistema Mejorado</th>
                <th className="text-left p-3 w-28">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {pipelineSteps.map(s => {
                const isMejora = s.diff === 'NUEVO'
                const rowBg = isMejora ? 'bg-amber-500/5' : ''
                return (
                  <tr key={s.paso} className={`border-t border-gray-800 hover:bg-slate-800/30 transition ${rowBg}`}>
                    <td className={`p-3 text-center font-bold ${isMejora ? 'text-amber-400' : 'text-gray-500'}`}>{s.paso}</td>
                    <td className={`p-3 font-medium ${isMejora ? 'text-amber-300' : 'text-white'}`}>{s.etapa}</td>
                    <td className="p-3 text-gray-400">{s.desc}</td>
                    <td className="p-3 text-blue-300">{s.actual}</td>
                    <td className="p-3 text-emerald-300">{s.mejorado}</td>
                    <td className={`p-3 font-semibold ${diffColor(s.diff)}`}>{s.diff}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-gray-700/30 p-4">
        <h3 className="text-sm font-semibold text-white mb-2">📌 Resumen del Cambio</h3>
        <p className="text-xs text-gray-300 leading-relaxed">
          Las 3 mejoras (Station Bias, Range Bias, Rapid Warming Boost) actúan en los <strong className="text-amber-400">pasos 8-10</strong>, 
          justo <strong className="text-white">antes</strong> de calcular temp_corregida. 
          Todo el pipeline posterior (Monte Carlo → Probabilidades → Kelly) recibe un forecast punto más preciso, 
          lo que produce probabilidades mejor calibradas y mejores recomendaciones de apuesta.
        </p>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded-lg bg-slate-800/50 p-2 text-center">
            <p className="text-gray-500">Pasos sin cambio</p>
            <p className="text-lg font-bold text-gray-400">{pipelineSteps.filter(s => s.diff === 'Sin cambio').length}</p>
          </div>
          <div className="rounded-lg bg-amber-500/10 p-2 text-center">
            <p className="text-amber-400">Mejoras NUEVAS</p>
            <p className="text-lg font-bold text-amber-400">{pipelineSteps.filter(s => s.diff === 'NUEVO').length}</p>
          </div>
          <div className="rounded-lg bg-gray-500/10 p-2 text-center">
            <p className="text-gray-500">Pendientes</p>
            <p className="text-lg font-bold text-gray-400">{pipelineSteps.filter(s => s.diff.includes('Pendiente')).length}</p>
          </div>
          <div className="rounded-lg bg-emerald-500/10 p-2 text-center">
            <p className="text-emerald-400">Total pasos</p>
            <p className="text-lg font-bold text-emerald-400">{pipelineSteps.length}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MejoraContinua() {
  const [ciudadesData, setCiudadesData] = useState<Record<string, CityMejoraResult> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ciudadSlug, setCiudadSlug] = useState('todas')
  const [mejoraKey, setMejoraKey] = useState<MejoraKey>('station')
  const [daysLimit, setDaysLimit] = useState(60)
  const [subView, setSubView] = useState<SubView>('analisis')

  const allSlugs = CIUDADES_ASIA.map(c => c.slug)

  useEffect(() => {
    loadData()
  }, [daysLimit])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`/api/mejora-continua?dias=${daysLimit}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json: ApiResponse = await resp.json()
      setCiudadesData(json.ciudades)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const cityNames = useMemo(() => {
    const m = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))
    return m
  }, [])

  const summaryRows = useMemo(() => {
    if (!ciudadesData) return []
    const slugs = ciudadSlug === 'todas' ? allSlugs : [ciudadSlug]
    return slugs
      .filter(s => ciudadesData[s])
      .map(s => {
        const cd = ciudadesData[s]
        const m = cd.mejoras[mejoraKey]
        return {
          slug: s,
          nombre: cd.nombre,
          estacionBias: cd.estacion_bias_general,
          metrics: m,
          tieneCurrent: cd.currentForecast !== null,
          currentActual: cd.currentForecast?.temp_corregida ?? null,
          currentMejorado: cd.currentForecast?.[mejoraKey] ?? null,
        }
      })
      .sort((a, b) => b.metrics.mejora_mae_pct - a.metrics.mejora_mae_pct)
  }, [ciudadesData, ciudadSlug, mejoraKey, allSlugs])

  const globalMetrics = useMemo(() => {
    if (summaryRows.length === 0) return null
    const totalMAEAct = summaryRows.reduce((s, r) => s + r.metrics.mae_actual * r.metrics.total_dias, 0)
    const totalMAEMej = summaryRows.reduce((s, r) => s + r.metrics.mae_mejorado * r.metrics.total_dias, 0)
    const totalDias = summaryRows.reduce((s, r) => s + r.metrics.total_dias, 0)
    const totalMejora = summaryRows.reduce((s, r) => s + r.metrics.dias_mejora, 0)
    const totalEmpeora = summaryRows.reduce((s, r) => s + r.metrics.dias_empeora, 0)
    const totalEmpate = summaryRows.reduce((s, r) => s + r.metrics.dias_empate, 0)
    const ciudadesMejoran = summaryRows.filter(r => r.metrics.mejora_mae_pct > 0).length
    const ciudadesEmpeoran = summaryRows.filter(r => r.metrics.mejora_mae_pct <= 0).length
    return {
      maeActual: round2(totalMAEAct / (totalDias || 1)),
      maeMejorado: round2(totalMAEMej / (totalDias || 1)),
      mejoraPct: round2(((totalMAEAct - totalMAEMej) / (totalMAEAct || 0.001)) * 100),
      totalDias,
      totalMejora,
      totalEmpeora,
      totalEmpate,
      ciudadesMejoran,
      ciudadesEmpeoran,
    }
  }, [summaryRows])

  const selectedCity = useMemo(() => {
    if (!ciudadesData || ciudadSlug === 'todas') return null
    return ciudadesData[ciudadSlug] || null
  }, [ciudadesData, ciudadSlug])

  const mejoraDesc = MEJORA_DESCRIPTIONS[mejoraKey]

  if (loading && !ciudadesData) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-gray-700/30 p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-64 rounded bg-slate-700" />
          <div className="h-4 w-96 rounded bg-slate-700" />
          <div className="grid grid-cols-3 gap-4">
            <div className="h-32 rounded-xl bg-slate-700" />
            <div className="h-32 rounded-xl bg-slate-700" />
            <div className="h-32 rounded-xl bg-slate-700" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-6">
        <h2 className="text-xl font-bold text-white mb-1">🔬 Análisis de Mejora Continua</h2>
        <p className="text-sm text-gray-400 mb-4">
          Comparación del sistema actual vs mejoras propuestas, evaluadas con datos históricos sin look-ahead bias.
        </p>

        {/* Sub-navigation */}
        <div className="flex gap-2 mb-4 border-b border-gray-700/30 pb-3">
          <button
            onClick={() => setSubView('analisis')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              subView === 'analisis'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
            }`}
          >
            📊 Análisis por Ciudad
          </button>
          <button
            onClick={() => setSubView('pipeline')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              subView === 'pipeline'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
            }`}
          >
            🔄 Pipeline Comparativo
          </button>
        </div>

        {/* Controls - only show in análisis view */}
        {subView === 'analisis' && (
          <>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ciudad</label>
                <select
                  value={ciudadSlug}
                  onChange={e => setCiudadSlug(e.target.value)}
                  className="rounded-lg bg-slate-700 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="todas">Todas las ciudades</option>
                  {CIUDADES_ASIA.map(c => (
                    <option key={c.slug} value={c.slug}>{c.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Días históricos</label>
                <select
                  value={daysLimit}
                  onChange={e => { setDaysLimit(Number(e.target.value)); loadData() }}
                  className="rounded-lg bg-slate-700 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value={30}>30 días</option>
                  <option value={60}>60 días</option>
                  <option value={90}>90 días</option>
                  <option value={0}>Todos</option>
                </select>
              </div>
              <button
                onClick={loadData}
                disabled={loading}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 transition disabled:opacity-50"
              >
                {loading ? 'Cargando...' : '↻ Actualizar'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              {MEJORA_KEYS.map(key => (
                <button
                  key={key}
                  onClick={() => setMejoraKey(key)}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                    mejoraKey === key
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20'
                      : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                  }`}
                >
                  {MEJORA_LABELS[key]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {subView === 'pipeline' && <PipelineView />}

      {subView === 'analisis' && (
        <>
          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">⚠️ {error}</div>
          )}

          {loading && (
            <div className="text-center py-8 text-gray-400 text-sm">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-emerald-400 mr-2" />
              Analizando {ciudadSlug === 'todas' ? 'todas las ciudades' : cityNames.get(ciudadSlug) || ciudadSlug}...
            </div>
          )}

          {!loading && ciudadesData && Object.keys(ciudadesData).length === 0 && (
            <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-8 text-center text-gray-400 text-sm">
              No hay datos históricos disponibles. Ejecuta el pronóstico diario para generar datos.
            </div>
          )}

          {!loading && ciudadesData && Object.keys(ciudadesData).length > 0 && (
            <>
              {globalMetrics && (
                <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-emerald-500/20 p-5">
                  <h3 className="text-sm font-semibold text-white mb-3">
                    📊 Métricas Globales — {MEJORA_LABELS[mejoraKey]}
                    <span className="text-gray-500 font-normal ml-2">
                      ({ciudadSlug === 'todas' ? 'todas las ciudades' : cityNames.get(ciudadSlug)})
                    </span>
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg bg-slate-800/50 p-3 text-center">
                      <p className="text-xs text-gray-500">MAE Actual</p>
                      <p className="text-xl font-bold text-blue-400">{globalMetrics.maeActual.toFixed(2)}°C</p>
                    </div>
                    <div className="rounded-lg bg-slate-800/50 p-3 text-center">
                      <p className="text-xs text-gray-500">MAE Mejorado</p>
                      <p className="text-xl font-bold text-emerald-400">{globalMetrics.maeMejorado.toFixed(2)}°C</p>
                    </div>
                    <div className="rounded-lg bg-slate-800/50 p-3 text-center">
                      <p className="text-xs text-gray-500">Mejora</p>
                      <p className={`text-xl font-bold ${globalMetrics.mejoraPct > 5 ? 'text-emerald-400' : globalMetrics.mejoraPct > 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                        {globalMetrics.mejoraPct >= 0 ? '+' : ''}{globalMetrics.mejoraPct.toFixed(1)}%
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-800/50 p-3 text-center">
                      <p className="text-xs text-gray-500">Días (M/E/E)</p>
                      <p className="text-xl font-bold">
                        <span className="text-emerald-400">{globalMetrics.totalMejora}</span>
                        <span className="text-gray-600">/</span>
                        <span className="text-red-400">{globalMetrics.totalEmpeora}</span>
                        <span className="text-gray-600">/</span>
                        <span className="text-gray-500">{globalMetrics.totalEmpate}</span>
                      </p>
                    </div>
                  </div>
                  {ciudadSlug === 'todas' && (
                    <div className="mt-2 text-xs text-gray-500 text-center">
                      {globalMetrics.ciudadesMejoran} ciudades mejoran · {globalMetrics.ciudadesEmpeoran} empeoran · {summaryRows.length} total
                    </div>
                  )}
                </div>
              )}

              {ciudadSlug === 'todas' && (
                <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 overflow-hidden">
                  <div className="p-4 border-b border-gray-700/30">
                    <h3 className="text-sm font-semibold text-white">Resumen por Ciudad</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-800/50 text-gray-400">
                          <th className="text-left p-3">Ciudad</th>
                          <th className="text-right p-3">Bias Estación</th>
                          <th className="text-right p-3">MAE Actual</th>
                          <th className="text-right p-3">MAE Mejorado</th>
                          <th className="text-right p-3">Mejora %</th>
                          <th className="text-right p-3">Bias Act</th>
                          <th className="text-right p-3">Bias Mej</th>
                          <th className="text-right p-3">Días (M/E/E)</th>
                          <th className="text-right p-3">Hoy Actual</th>
                          <th className="text-right p-3">Hoy Mejorado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryRows.map(row => {
                          const m = row.metrics
                          const mejoraColor = m.mejora_mae_pct > 5 ? 'text-emerald-400' : m.mejora_mae_pct > 0 ? 'text-emerald-300' : 'text-red-400'
                          return (
                            <tr key={row.slug} className="border-t border-gray-800 hover:bg-slate-800/30 transition">
                              <td className="p-3 text-white font-medium">{row.nombre}</td>
                              <td className="p-3 text-right text-gray-400">{row.estacionBias >= 0 ? '+' : ''}{row.estacionBias.toFixed(2)}°C</td>
                              <td className="p-3 text-right text-blue-400">{m.mae_actual.toFixed(2)}°C</td>
                              <td className="p-3 text-right text-emerald-400">{m.mae_mejorado.toFixed(2)}°C</td>
                              <td className={`p-3 text-right font-bold ${mejoraColor}`}>{m.mejora_mae_pct >= 0 ? '+' : ''}{m.mejora_mae_pct.toFixed(1)}%</td>
                              <td className="p-3 text-right text-blue-400">{m.bias_actual.toFixed(2)}°C</td>
                              <td className="p-3 text-right text-emerald-400">{m.bias_mejorado.toFixed(2)}°C</td>
                              <td className="p-3 text-right">
                                <span className="text-emerald-400">{m.dias_mejora}</span>
                                <span className="text-gray-600">/</span>
                                <span className="text-red-400">{m.dias_empeora}</span>
                                <span className="text-gray-600">/</span>
                                <span className="text-gray-500">{m.dias_empate}</span>
                              </td>
                              <td className="p-3 text-right text-blue-400">{row.currentActual !== null ? `${row.currentActual.toFixed(1)}°C` : '-'}</td>
                              <td className="p-3 text-right text-emerald-400">{row.currentMejorado !== null ? `${row.currentMejorado.toFixed(1)}°C` : '-'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedCity && (
                <>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {MEJORA_KEYS.map(key => (
                      <MetricsCard key={key} metrics={selectedCity.mejoras[key]} label={MEJORA_LABELS[key]}
                        desc={key === mejoraKey ? '✓ Seleccionada' : 'Selecciona arriba para ver detalle'} />
                    ))}
                  </div>

                  {/* City-specific Pipeline */}
                  <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-4">
                    <h3 className="text-sm font-semibold text-white mb-3">
                      🔧 Pipeline Específico — {selectedCity.nombre}
                      <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${
                        selectedCity.modelo === 'wuhan_adaptive'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {selectedCity.modelo === 'wuhan_adaptive' ? 'WUHAN ADAPTIVE' : 'COMBINADO ESTÁNDAR'}
                      </span>
                    </h3>
                    <div className="space-y-2">
                      {selectedCity.pipeline.map(s => (
                        <div key={s.paso} className={`rounded-xl border p-3 ${
                          s.aplicado
                            ? 'bg-emerald-500/5 border-emerald-500/20'
                            : 'bg-slate-800/50 border-gray-700/30 opacity-60'
                        }`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ${
                                s.aplicado ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-600/30 text-gray-500'
                              }`}>
                                {s.paso}
                              </span>
                              <span className={`text-xs sm:text-sm font-medium ${s.aplicado ? 'text-white' : 'text-gray-500'}`}>
                                {s.etapa}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                s.aplicado
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-red-500/15 text-red-400'
                              }`}>
                                {s.aplicado ? 'ACTIVO' : 'INACTIVO'}
                              </span>
                            </div>
                          </div>
                          <p className="text-[10px] sm:text-xs text-gray-400 mt-1 ml-7">{s.desc}</p>
                          <p className="text-[10px] text-gray-500 mt-0.5 ml-7 font-mono">{s.detalle}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4">
                      <h3 className="text-sm font-semibold text-white mb-2">📖 Explicación de la Mejora</h3>
                      <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-line">{mejoraDesc}</p>
                    </div>
                    <div className="rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-emerald-500/20 p-4">
                      <h3 className="text-sm font-semibold text-white mb-2">📝 Conclusión</h3>
                      <div className="text-xs text-gray-200 leading-relaxed whitespace-pre-line">
                        {selectedCity.mejoras[mejoraKey]?.conclusion || 'Selecciona una mejora para ver la conclusión.'}
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-700/30">
                        <p className="text-xs text-gray-500">
                          Pronóstico de hoy: Actual <span className="text-blue-400">{selectedCity.currentForecast?.temp_corregida.toFixed(1) ?? '-'}°C</span>
                          {' → '}Mejorado <span className="text-emerald-400">{selectedCity.currentForecast?.[mejoraKey]?.toFixed(1) ?? '-'}°C</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-4">
                    <h3 className="text-sm font-semibold text-white mb-3">
                      📈 Últimos {Math.min(selectedCity.dailyResults.length, 30)} días — {selectedCity.nombre}
                    </h3>
                    <SimpleChart data={selectedCity.dailyResults} mejoraKey={mejoraKey} />
                  </div>

                  <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 overflow-hidden">
                    <div className="p-4 border-b border-gray-700/30">
                      <h3 className="text-sm font-semibold text-white">📋 Detalle Día a Día — {MEJORA_LABELS[mejoraKey]}</h3>
                    </div>
                    <div className="overflow-x-auto" style={{ maxHeight: 400 }}>
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-slate-900">
                          <tr className="text-gray-400">
                            <th className="text-left p-2">Fecha</th>
                            <th className="text-right p-2">Real</th>
                            <th className="text-right p-2">Actual</th>
                            <th className="text-right p-2">Error Act</th>
                            <th className="text-right p-2">Mejorado</th>
                            <th className="text-right p-2">Error Mej</th>
                            <th className="text-right p-2">Δ Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCity.dailyResults.slice().reverse().map(d => {
                            const mejEntry = d[mejoraKey]
                            const absAct = Math.abs(d.error_actual)
                            const absMej = Math.abs(mejEntry.error)
                            const mejora = absAct - absMej
                            const mejoraClass = mejora > 0.05 ? 'text-emerald-400' : mejora < -0.05 ? 'text-red-400' : 'text-gray-500'
                            const rowClass = mejora > 0.05 ? 'bg-emerald-500/5' : mejora < -0.05 ? 'bg-red-500/5' : ''
                            return (
                              <tr key={d.fecha} className={`border-t border-gray-800 hover:bg-slate-800/30 transition ${rowClass}`}>
                                <td className="p-2 text-gray-300">{d.fecha}</td>
                                <td className="p-2 text-right text-yellow-400 font-medium">{d.temp_real.toFixed(1)}</td>
                                <td className="p-2 text-right text-blue-400">{d.temp_corregida.toFixed(1)}</td>
                                <td className="p-2 text-right text-blue-300">{d.error_actual >= 0 ? '+' : ''}{d.error_actual.toFixed(2)}</td>
                                <td className="p-2 text-right text-emerald-400">{mejEntry.temp.toFixed(1)}</td>
                                <td className="p-2 text-right text-emerald-300">{mejEntry.error >= 0 ? '+' : ''}{mejEntry.error.toFixed(2)}</td>
                                <td className={`p-2 text-right font-bold ${mejoraClass}`}>{mejora >= 0 ? '+' : ''}{mejora.toFixed(2)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
