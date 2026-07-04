import { useState, useEffect, useMemo } from 'react'
import { CitySignal, SignalsPackage } from '@/lib/signals-engine'

const CONF_COLORS: Record<string, string> = {
  'MUY ALTA': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  ALTA: 'text-green-400 bg-green-500/10 border-green-500/20',
  MEDIA: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  BAJA: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  'MUY BAJA': 'text-red-400 bg-red-500/10 border-red-500/20',
}

const BAND_COLORS: Record<string, string> = {
  'MUY ALTA': 'bg-emerald-500',
  ALTA: 'bg-green-500',
  MEDIA: 'bg-amber-500',
  BAJA: 'bg-orange-500',
  'MUY BAJA': 'bg-red-500',
}

const FLAGS: Record<string, string> = {
  'Corea del Sur': '🇰🇷', 'Japón': '🇯🇵', 'China': '🇨🇳',
}

export default function SignalsPanel() {
  const [signalsPackage, setSignalsPackage] = useState<SignalsPackage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterConf, setFilterConf] = useState<string>('todas')
  const [filterExtreme, setFilterExtreme] = useState(false)
  const [expandedMethodology, setExpandedMethodology] = useState(false)

  useEffect(() => {
    fetchSignals()
  }, [])

  async function fetchSignals() {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/signals')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      setSignalsPackage(json)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const signals = useMemo(() => {
    if (!signalsPackage) return []
    let list = signalsPackage.signals
    if (filterConf !== 'todas') {
      list = list.filter(s => s.confidence.label === filterConf)
    }
    if (filterExtreme) {
      list = list.filter(s => s.extreme_alert)
    }
    return [...list].sort((a, b) => b.historical_accuracy_pct - a.historical_accuracy_pct)
  }, [signalsPackage, filterConf, filterExtreme])

  function downloadJSON(signal?: CitySignal) {
    const data = signal ?? signalsPackage
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = signal ? `signal-${signal.slug}.json` : `signals-${signalsPackage?.fecha_objetivo}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function downloadCSV(signal?: CitySignal) {
    const data = signal ? [signal] : signalsPackage?.signals ?? []
    const headers = [
      'ciudad', 'slug', 'pais', 'forecast_c', 'raw_ensemble_c', 'sesgo_aplicado',
      'banda_p5', 'banda_p95', 'banda_ancho',
      'prob_sobre_35c', 'prob_bajo_30c', 'prob_bajo_25c', 'prob_sobre_40c',
      'edge_pct', 'market_prob', 'model_prob',
      'confianza_label', 'confianza_score', 'precision_historica_pct', 'muestras_historicas',
      'consenso', 'nowcast_activo', 'clima', 'alerta_extrema', 'recomendacion',
    ]
    const rows = data.map(s => [
      s.ciudad, s.slug, s.pais, s.forecast_c.toFixed(1), s.raw_ensemble_c.toFixed(1), s.sesgo_aplicado.toFixed(2),
      s.band.p5.toFixed(2), s.band.p95.toFixed(2), s.band.bandWidth.toFixed(2),
      s.prob_sobre_35c ?? '', s.prob_bajo_30c ?? '', s.prob_bajo_25c ?? '', s.prob_sobre_40c ?? '',
      s.edge_pct?.toFixed(1) ?? '', s.market_prob ?? '', s.model_prob ?? '',
      s.confidence.label, s.confidence.score.toFixed(3), s.historical_accuracy_pct.toFixed(0), s.historical_samples,
      s.consenso, s.nowcast_activo ? 'SI' : 'NO', s.weather.label, s.extreme_alert ? `SI_${s.extreme_type}` : 'NO',
      s.recomendacion,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = signal ? `signal-${signal.slug}.csv` : `signals-${signalsPackage?.fecha_objetivo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copyToClipboard(signal?: CitySignal) {
    const data = signal ?? signalsPackage
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="card text-center py-12">
        <div className="mb-4 text-3xl animate-pulse">📡</div>
        <p className="text-gray-400 text-sm">Cargando señales climáticas...</p>
        <div className="mt-4 flex justify-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0s' }} />
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0.15s' }} />
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: '0.3s' }} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card text-center py-8">
        <p className="text-red-400 text-sm">⚠️ Error: {error}</p>
        <button onClick={fetchSignals} className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition">
          Reintentar
        </button>
      </div>
    )
  }

  if (!signalsPackage) return null

  const pkg = signalsPackage
  const confLabels = Array.from(new Set(pkg.signals.map(s => s.confidence.label)))

  return (
    <div className="space-y-6">
      {/* ===== HEADER EXECUTIVO ===== */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">📡</span>
              <h2 className="text-lg font-bold text-white">Señales Climáticas · Asia</h2>
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                pkg.data_freshness === 'cron_10pm'
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                {pkg.data_freshness === 'cron_10pm' ? '📡 Cron 10PM' : '⚡ Análisis fresco'}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {pkg.coverage.ciudades} ciudades · {pkg.coverage.paises} países ({pkg.coverage.lista_paises.join(', ')}) · Actualizado: {new Date(pkg.generated_at).toLocaleString('es-ES')}
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-400">{pkg.global_accuracy_pct.toFixed(1)}%</p>
              <p className="text-gray-500">Precisión global ±0.5°C</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-400">{pkg.global_mae.toFixed(2)}°C</p>
              <p className="text-gray-500">MAE global</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gray-300">{pkg.total_historical_records}</p>
              <p className="text-gray-500">Registros históricos</p>
            </div>
          </div>
        </div>
      </div>

      {/* ===== FILTROS ===== */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-gray-500 font-semibold mr-1">Filtrar:</span>
        <select
          value={filterConf}
          onChange={e => setFilterConf(e.target.value)}
          className="rounded-lg bg-slate-800 border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
        >
          <option value="todas">Todas las confianzas</option>
          {confLabels.map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button
          onClick={() => setFilterExtreme(!filterExtreme)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
            filterExtreme ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'border-gray-700 text-gray-400 hover:text-gray-300'
          }`}
        >
          ⚠️ Solo alertas extremas
        </button>
        <button onClick={fetchSignals} className="ml-auto rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-300 transition">
          🔄 Actualizar
        </button>
      </div>

      {/* ===== GRID DE SEÑALES ===== */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {signals.map(s => (
          <SignalCard key={s.slug} signal={s} onDownloadJSON={downloadJSON} onDownloadCSV={downloadCSV} onCopy={copyToClipboard} />
        ))}
      </div>

      {/* ===== EXPORTACIÓN MASIVA ===== */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📦</span> Exportar señales completas
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5">
              Todas las {pkg.signals.length} ciudades en un archivo. Formato estructurado para integración con APIs, bots o análisis externo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadJSON()} className="rounded-lg bg-blue-600/20 border border-blue-500/30 px-3 py-2 text-xs text-blue-400 hover:bg-blue-600/30 transition flex items-center gap-1.5 font-medium">
              <span>⬇</span> JSON
            </button>
            <button onClick={() => downloadCSV()} className="rounded-lg bg-emerald-600/20 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-400 hover:bg-emerald-600/30 transition flex items-center gap-1.5 font-medium">
              <span>⬇</span> CSV
            </button>
            <button onClick={() => copyToClipboard()} className="rounded-lg bg-slate-700/50 border border-gray-600/30 px-3 py-2 text-xs text-gray-300 hover:bg-slate-700/80 transition flex items-center gap-1.5">
              <span>📋</span> Copiar JSON
            </button>
            <a
              href={`/api/signals?format=${filterExtreme ? 'csv' : 'json'}`}
              download={`signals-${pkg.fecha_objetivo}.${filterExtreme ? 'csv' : 'json'}`}
              className="rounded-lg bg-purple-600/20 border border-purple-500/30 px-3 py-2 text-xs text-purple-400 hover:bg-purple-600/30 transition flex items-center gap-1.5 font-medium"
            >
              <span>🔗</span> API directa
            </a>
          </div>
        </div>
      </div>

      {/* ===== METODOLOGÍA ===== */}
      <div className="card">
        <button
          onClick={() => setExpandedMethodology(!expandedMethodology)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>🔬</span> Metodología y fuentes de datos
          </h3>
          <span className={`text-gray-500 transition ${expandedMethodology ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {expandedMethodology && (
          <div className="mt-4 space-y-4 text-xs text-gray-400 leading-relaxed">
            <div>
              <h4 className="font-bold text-gray-300 mb-1">🎯 ¿Qué es una Señal Climática?</h4>
              <p>Una señal climática es un pronóstico de temperatura estructurado con métricas de calidad, bandas de error histórico, y una recomendación accionable. Cada señal combina datos de 6 modelos meteorológicos, corrección dinámica de sesgo basada en errores históricos reales, y precisión calculada con contracción bayesiana.</p>
            </div>
            <div>
              <h4 className="font-bold text-gray-300 mb-1">📊 Score de Confianza</h4>
              <p>El score de confianza (0-1) combina 5 factores con pesos específicos:</p>
              <ul className="mt-1 space-y-1 pl-4">
                <li className="flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" /> 40% — Precisión histórica real (exito_pct con contracción bayesiana)</li>
                <li className="flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" /> 20% — Consenso entre modelos (MUY FUERTE → ALTA, DEBIL → BAJA)</li>
                <li className="flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-400" /> 10% — Nowcasting activo (datos METAR en vivo)</li>
                <li className="flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" /> 10% — Cantidad de muestras históricas (más = mejor precisión)</li>
                <li className="flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-400" /> 10% — Spread entre modelos (bajo = mejor consenso)</li>
                <li className="flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" /> 10% — Factores adicionales (volatilidad, clima extremo)</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-gray-300 mb-1">📈 Bandas de Error P5-P95</h4>
              <p>Las bandas P5-P95 representan el rango donde ha caído el error histórico el 90% de las veces. Se calculan tomando los percentiles 5 y 95 de todos los errores históricos (real - pronóstico) de cada ciudad. Una banda estrecha indica un modelo consistente y predecible.</p>
            </div>
            <div>
              <h4 className="font-bold text-gray-300 mb-1">📡 Fuentes de datos</h4>
              <ul className="mt-1 space-y-1">
                <li className="flex items-center gap-2"><span className="text-emerald-400">❶</span> <strong className="text-gray-300">Open-Meteo API</strong> — 6 modelos: ECMWF IFS 025, GFS Seamless, ICON Seamless, JMA Seamless, MeteoFrance Seamless, Best Match Ensemble</li>
                <li className="flex items-center gap-2"><span className="text-emerald-400">❷</span> <strong className="text-gray-300">METAR airports</strong> — Nowcasting en vivo desde aeropuertos locales (RKSI, ZBAA, ZSPD, VHHH, RJTT, ZGSZ, ZHHH, ZUCK, ZUUU)</li>
                <li className="flex items-center gap-2"><span className="text-emerald-400">❸</span> <strong className="text-gray-300">Supabase DB</strong> — 150+ registros históricos verificados con temperatura real de cierre de Polymarket</li>
                <li className="flex items-center gap-2"><span className="text-emerald-400">❹</span> <strong className="text-gray-300">Polymarket CLOB</strong> — Precios de mercado en tiempo real para cálculo de edge y oportunidades de cobertura</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-gray-300 mb-1">⚙️ Corrección de sesgo</h4>
              <p>El sistema aplica corrección dinámica de sesgo usando EMA (Exponential Moving Average) con α=0.3 sobre los errores históricos recientes. Cuando hay pocos datos, se usa un sesgo estático estacional derivado de backtests de 3 años. Esto asegura que el pronóstico se ajuste continuamente a las condiciones reales de cada ciudad.</p>
            </div>
            <div>
              <h4 className="font-bold text-gray-300 mb-1">📋 Licencia y uso</h4>
              <p className="text-gray-500">{pkg.metadata.license}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SignalCard({
  signal, onDownloadJSON, onDownloadCSV, onCopy,
}: {
  signal: CitySignal
  onDownloadJSON: (s?: CitySignal) => void
  onDownloadCSV: (s?: CitySignal) => void
  onCopy: (s?: CitySignal) => void
}) {
  const confColor = CONF_COLORS[signal.confidence.label] ?? 'text-gray-400 bg-gray-500/10'
  const bandColor = BAND_COLORS[signal.confidence.label] ?? 'bg-gray-500'
  const flag = FLAGS[signal.pais] ?? '🌏'

  // Band visualization: center the forecast in the band
  const bandMin = signal.forecast_c + signal.band.p5
  const bandMax = signal.forecast_c + signal.band.p95
  const bandSpan = bandMax - bandMin
  const fcPos = bandSpan > 0 ? ((signal.forecast_c - bandMin) / bandSpan) * 100 : 50

  return (
    <div className={`card relative overflow-hidden ${signal.extreme_alert ? 'ring-1 ring-red-500/30' : ''}`}>
      {/* Extreme alert bar */}
      {signal.extreme_alert && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-500 via-amber-500 to-red-500 animate-pulse" />
      )}

      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-lg">{flag}</span>
            <h3 className="font-bold text-white text-sm">{signal.ciudad.split(',')[0]}</h3>
            <span className="text-base">{signal.weather.icon}</span>
          </div>
          <p className="text-[9px] text-gray-500 mt-0.5">{signal.pais} · {signal.slug}</p>
        </div>
        <div className="flex items-center gap-1">
          {signal.nowcast_activo && <span className="text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">LIVE</span>}
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${confColor}`}>
            {signal.confidence.label}
          </span>
        </div>
      </div>

      {/* Temperature and edge row */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <p className="text-3xl font-extrabold text-white">{signal.forecast_c.toFixed(1)}°<span className="text-sm font-normal text-gray-500">C</span></p>
          <p className="text-[9px] text-gray-500">Raw ensemble: {signal.raw_ensemble_c.toFixed(1)}°C · Sesgo: {signal.sesgo_aplicado > 0 ? '+' : ''}{signal.sesgo_aplicado.toFixed(2)}°C</p>
        </div>
        {signal.edge_pct !== null && (
          <div className={`text-right ${signal.edge_pct >= 5 ? 'text-emerald-400' : signal.edge_pct <= -5 ? 'text-red-400' : 'text-amber-400'}`}>
            <p className="text-lg font-bold">{signal.edge_pct > 0 ? '+' : ''}{signal.edge_pct.toFixed(1)}%</p>
            <p className="text-[9px] text-gray-500">Edge vs Mercado</p>
          </div>
        )}
      </div>

      {/* Band visualization */}
      <div className="mb-3">
        <div className="relative h-6">
          <div className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full bg-slate-700" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full transition-all"
            style={{ left: '5%', right: '5%', background: `linear-gradient(to right, ${signal.band.p5 < 0 ? '#ef4444' : '#10b981'}, #6366f1)` }}
          />
          {/* Forecast diamond */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
            style={{ left: `${fcPos}%` }}
          >
            <div className="h-4 w-4 rotate-45 border-2 border-white bg-blue-500 shadow-lg shadow-blue-500/30" />
          </div>
          {/* P5 label */}
          <span className="absolute top-0 left-0 text-[8px] text-gray-500">{bandMin.toFixed(1)}°</span>
          <span className="absolute top-0 right-0 text-[8px] text-gray-500">{bandMax.toFixed(1)}°</span>
        </div>
        <div className="flex justify-between text-[8px] text-gray-600 mt-0.5">
          <span>P5 ({signal.band.p5 > 0 ? '+' : ''}{signal.band.p5.toFixed(2)})</span>
          <span>Ancho banda: {signal.band.bandWidth.toFixed(2)}°C</span>
          <span>P95 (+{signal.band.p95.toFixed(2)})</span>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded bg-slate-800/50 p-1.5 text-center">
          <p className="text-xs font-bold text-emerald-400">{signal.historical_accuracy_pct.toFixed(0)}%</p>
          <p className="text-[8px] text-gray-500">Precisión ±0.5°C</p>
        </div>
        <div className="rounded bg-slate-800/50 p-1.5 text-center">
          <p className="text-xs font-bold text-blue-400">{signal.historical_samples}</p>
          <p className="text-[8px] text-gray-500">Muestras históricas</p>
        </div>
        <div className="rounded bg-slate-800/50 p-1.5 text-center">
          <p className={`text-xs font-bold ${signal.consenso === 'DEBIL' ? 'text-red-400' : signal.consenso === 'FUERTE' || signal.consenso === 'MUY FUERTE' ? 'text-emerald-400' : 'text-amber-400'}`}>
            {signal.consenso}
          </p>
          <p className="text-[8px] text-gray-500">Consenso modelos</p>
        </div>
      </div>

      {/* Extreme probability badges */}
      <div className="flex flex-wrap gap-1 mb-3">
        {signal.prob_sobre_35c !== null && signal.prob_sobre_35c > 0.05 && (
          <span className="text-[8px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">{'🔥 >35°C'}: {(signal.prob_sobre_35c * 100).toFixed(0)}%</span>
        )}
        {signal.prob_sobre_40c !== null && signal.prob_sobre_40c > 0.01 && (
          <span className="text-[8px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">{'🔥 >40°C'}: {(signal.prob_sobre_40c * 100).toFixed(0)}%</span>
        )}
        {signal.prob_bajo_30c !== null && signal.prob_bajo_30c > 0.05 && (
          <span className="text-[8px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{'❄️ <30°C'}: {(signal.prob_bajo_30c * 100).toFixed(0)}%</span>
        )}
        {signal.prob_bajo_25c !== null && signal.prob_bajo_25c > 0.01 && (
          <span className="text-[8px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{'❄️ <25°C'}: {(signal.prob_bajo_25c * 100).toFixed(0)}%</span>
        )}
      </div>

      {/* Confidence score bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-[8px] text-gray-500 mb-0.5">
          <span>Score de confianza: {signal.confidence.score.toFixed(3)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${bandColor}`} style={{ width: `${signal.confidence.score * 100}%` }} />
        </div>
      </div>

      {/* Recommendation */}
      <div className="rounded-lg bg-slate-800/30 border border-gray-700/20 p-2 mb-3">
        <p className="text-[9px] text-gray-400 leading-relaxed">{signal.recomendacion}</p>
      </div>

      {/* Export row */}
      <div className="flex items-center justify-between border-t border-gray-700/20 pt-2">
        <div className="flex items-center gap-1">
          <button onClick={() => onDownloadJSON(signal)} className="text-[9px] text-blue-400 hover:text-blue-300 transition px-1.5 py-0.5 rounded hover:bg-blue-500/10" title="Descargar JSON individual">⬇ JSON</button>
          <button onClick={() => onDownloadCSV(signal)} className="text-[9px] text-emerald-400 hover:text-emerald-300 transition px-1.5 py-0.5 rounded hover:bg-emerald-500/10" title="Descargar CSV individual">⬇ CSV</button>
          <button onClick={() => onCopy(signal)} className="text-[9px] text-gray-400 hover:text-gray-300 transition px-1.5 py-0.5 rounded hover:bg-gray-500/10" title="Copiar JSON al portapapeles">📋 Copiar</button>
        </div>
        <a
          href={`/api/signals?format=json`}
          className="text-[9px] text-purple-400 hover:text-purple-300 transition"
          title="Endpoint API directo"
          target="_blank"
        >
          🔗 API
        </a>
      </div>
    </div>
  )
}
