export interface BandMetrics {
  p5: number
  p95: number
  bandWidth: number
  mae: number
  muestras: number
}

export interface ConfidenceResult {
  label: 'MUY ALTA' | 'ALTA' | 'MEDIA' | 'BAJA' | 'MUY BAJA'
  score: number
  factors: { factor: string; contribucion: number }[]
}

export interface CitySignal {
  ciudad: string
  slug: string
  pais: string
  lat: number
  lon: number
  forecast_c: number
  raw_ensemble_c: number
  sesgo_aplicado: number
  band: { p5: number; p95: number; bandWidth: number }
  prob_sobre_35c: number | null
  prob_bajo_30c: number | null
  prob_bajo_25c: number | null
  prob_sobre_40c: number | null
  edge_pct: number | null
  market_prob: number | null
  model_prob: number | null
  confidence: ConfidenceResult
  historical_accuracy_pct: number
  historical_samples: number
  weather: { code: number; label: string; icon: string }
  consenso: string
  nowcast_activo: boolean
  recomendacion: string
  extreme_alert: boolean
  extreme_type: string | null
}

export interface SignalsPackage {
  version: string
  generated_at: string
  fecha_objetivo: string
  data_freshness: 'cron_10pm' | 'analisis_fresco'
  coverage: { ciudades: number; paises: number; lista_paises: string[] }
  global_accuracy_pct: number
  global_mae: number
  total_historical_records: number
  signals: CitySignal[]
  metadata: {
    methodology: string
    accuracy_metric: string
    data_sources: string[]
    models: string[]
    confidence_method: string
    license: string
  }
}

const CIUDAD_PAIS: Record<string, string> = {
  beijing: 'China', shanghai: 'China', shenzhen: 'China', chongqing: 'China', chengdu: 'China', wuhan: 'China',
  'hong-kong': 'China',
  seoul: 'Corea del Sur',
  tokyo: 'Japón',
}

const CIUDAD_COORDS: Record<string, { lat: number; lon: number }> = {
  beijing: { lat: 39.9, lon: 116.4 }, shanghai: { lat: 31.2, lon: 121.5 }, shenzhen: { lat: 22.5, lon: 114.1 },
  chongqing: { lat: 29.6, lon: 106.6 }, chengdu: { lat: 30.6, lon: 104.1 }, wuhan: { lat: 30.6, lon: 114.3 },
  'hong-kong': { lat: 22.3, lon: 114.2 },
  seoul: { lat: 37.6, lon: 127.0 }, tokyo: { lat: 35.7, lon: 139.7 },
}

export function computeBands(errors: number[]): BandMetrics {
  if (errors.length < 2) return { p5: -1, p95: 1, bandWidth: 2, mae: 0, muestras: 0 }
  const sorted = [...errors].sort((a, b) => a - b)
  const p5 = sorted[Math.max(0, Math.floor(sorted.length * 0.05))]
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  const mae = errors.reduce((s, v) => s + Math.abs(v), 0) / errors.length
  return { p5, p95, bandWidth: p95 - p5, mae, muestras: errors.length }
}

export function computeConfidence(
  exitoPct: number,
  consenso: string,
  nowcastActivo: boolean,
  muestras: number,
  spread: number,
): ConfidenceResult {
  const factors: { factor: string; contribucion: number }[] = []

  let score = 0.5

  const accScore = Math.min(1, exitoPct / 100) * 0.40
  factors.push({ factor: `Precisión histórica: ${exitoPct.toFixed(0)}%`, contribucion: accScore })
  score += accScore - 0.20

  const consensoMap: Record<string, number> = { 'MUY FUERTE': 0.20, FUERTE: 0.15, ACEPTABLE: 0.05, DEBIL: -0.10 }
  const consScore = consensoMap[consenso] ?? -0.15
  factors.push({ factor: `Consenso: ${consenso}`, contribucion: consScore + 0.15 })
  score += consScore

  const nowScore = nowcastActivo ? 0.10 : 0
  factors.push({ factor: `Nowcasting: ${nowcastActivo ? 'ACTIVO' : 'inactivo'}`, contribucion: nowScore })
  score += nowScore

  const sampleScore = Math.min(1, muestras / 50) * 0.10
  factors.push({ factor: `Muestras históricas: ${muestras} (${muestras >= 50 ? 'suficientes' : muestras >= 20 ? 'moderadas' : 'pocas'})`, contribucion: sampleScore })
  score += sampleScore

  const spreadRisk = Math.min(1, Math.max(0, (spread - 1) / 5))
  const spreadScore = (1 - spreadRisk) * 0.10
  factors.push({ factor: `Spread entre modelos: ${spread.toFixed(1)}°C (${spread < 2 ? 'bajo' : spread < 4 ? 'moderado' : 'alto'})`, contribucion: spreadScore })
  score += spreadScore - 0.05

  const clamped = Math.max(0, Math.min(1, score))

  let label: ConfidenceResult['label']
  if (clamped >= 0.80) label = 'MUY ALTA'
  else if (clamped >= 0.65) label = 'ALTA'
  else if (clamped >= 0.45) label = 'MEDIA'
  else if (clamped >= 0.25) label = 'BAJA'
  else label = 'MUY BAJA'

  return { label, score: clamped, factors }
}

function computeProbMonteCarlo(
  tempCorregida: number,
  std: number
): { sobre_35: number | null; bajo_30: number | null; bajo_25: number | null; sobre_40: number | null } {
  if (std <= 0) return { sobre_35: null, bajo_30: null, bajo_25: null, sobre_40: null }
  const z35 = (35 - tempCorregida) / std
  const z30 = (30 - tempCorregida) / std
  const z25 = (25 - tempCorregida) / std
  const z40 = (40 - tempCorregida) / std
  return {
    sobre_35: +(Math.max(0, Math.min(1, 1 - 0.5 * (1 + erf(z35 / Math.SQRT2))))).toFixed(3),
    bajo_30: +(Math.max(0, Math.min(1, 0.5 * (1 + erf(z30 / Math.SQRT2))))).toFixed(3),
    bajo_25: +(Math.max(0, Math.min(1, 0.5 * (1 + erf(z25 / Math.SQRT2))))).toFixed(3),
    sobre_40: +(Math.max(0, Math.min(1, 1 - 0.5 * (1 + erf(z40 / Math.SQRT2))))).toFixed(3),
  }
}

function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x)
  const t = 1 / (1 + p * x)
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}

function generarRecomendacion(signal: {
  ciudad: string; forecast_c: number; edge_pct: number | null; confidence: ConfidenceResult
  extreme_alert: boolean; extreme_type: string | null; band: { p5: number; p95: number }
  weather: { label: string }; historical_accuracy_pct: number
}): string {
  const ciudad = signal.ciudad.split(',')[0]
  if (signal.extreme_alert && signal.extreme_type === 'calor') {
    return `${ciudad}: Probabilidad alta de calor extremo. Pronóstico ${signal.forecast_c.toFixed(1)}°C con banda superior en ${signal.band.p95.toFixed(1)}°C. Cobertura recomendada.`
  }
  if (signal.extreme_alert && signal.extreme_type === 'tormenta') {
    return `${ciudad}: Tormenta activa. Precipitación significativa puede desviar la temperatura real del pronóstico.`
  }
  if (signal.edge_pct !== null && Math.abs(signal.edge_pct) >= 5) {
    const dir = signal.edge_pct > 0 ? 'subestima' : 'sobreestima'
    return `${ciudad}: Mercado ${dir} la probabilidad. Modelo: ${(signal.forecast_c).toFixed(1)}°C, Banda P5-P95 [${signal.band.p5.toFixed(1)}, ${signal.band.p95.toFixed(1)}]. Edge: ${signal.edge_pct > 0 ? '+' : ''}${signal.edge_pct.toFixed(1)}%.`
  }
  if (signal.confidence.label === 'MUY ALTA' || signal.confidence.label === 'ALTA') {
    return `${ciudad}: Señal de alta confianza. Precisión histórica ${signal.historical_accuracy_pct.toFixed(0)}%. Pronóstico ${signal.forecast_c.toFixed(1)}°C con consenso ${signal.confidence.label}.`
  }
  if (signal.confidence.label === 'BAJA' || signal.confidence.label === 'MUY BAJA') {
    return `${ciudad}: Señal de baja confianza. Solo 1 de cada ${signal.historical_accuracy_pct > 0 ? Math.round(100 / signal.historical_accuracy_pct) : '?'} pronósticos acierta dentro de ±0.5°C. Recomendación: esperar confirmación.`
  }
  return `${ciudad}: Pronóstico ${signal.forecast_c.toFixed(1)}°C, Banda [${signal.band.p5.toFixed(1)}, ${signal.band.p95.toFixed(1)}]. Precisión ${signal.historical_accuracy_pct.toFixed(0)}%.`
}

export function buildCitySignal(
  city: CitySignalInput,
  rec: { edge: number; ia_pct: number; mkt_pct: number } | null,
  bands: BandMetrics,
): CitySignal {
  const probs = computeProbMonteCarlo(city.forecast.temp_corregida, Math.max(0.5, city.volatilidad))
  const extremeAlert = city.weather?.severity === 'severe' || city.volatilidad > 4

  let extremeType: string | null = null
  if (extremeAlert) {
    if (city.weather?.severity === 'severe') extremeType = 'tormenta'
    else if (city.forecast.temp_corregida > 38) extremeType = 'calor'
    else extremeType = 'alta_volatilidad'
  }

  const confidence = computeConfidence(
    city.exito_pct, city.consenso, city.nowcast?.activo ?? false,
    city.totalRecords ?? bands.muestras, city.spread
  )

  const signal: Partial<CitySignal> = {
    ciudad: city.ciudad,
    slug: city.slug,
    pais: CIUDAD_PAIS[city.slug] ?? 'Desconocido',
    lat: CIUDAD_COORDS[city.slug]?.lat ?? 0,
    lon: CIUDAD_COORDS[city.slug]?.lon ?? 0,
    forecast_c: city.forecast.temp_corregida,
    raw_ensemble_c: city.forecast.temp_ponderada,
    sesgo_aplicado: city.forecast.sesgo_aplicado,
    band: { p5: bands.p5, p95: bands.p95, bandWidth: bands.bandWidth },
    prob_sobre_35c: probs.sobre_35,
    prob_bajo_30c: probs.bajo_30,
    prob_bajo_25c: probs.bajo_25,
    prob_sobre_40c: probs.sobre_40,
    edge_pct: rec ? rec.edge : null,
    market_prob: rec ? rec.mkt_pct : null,
    model_prob: rec ? rec.ia_pct : null,
    confidence,
    historical_accuracy_pct: city.exito_pct,
    historical_samples: city.totalRecords ?? bands.muestras,
    weather: { code: city.weather?.code ?? 0, label: city.weather?.label ?? 'Despejado', icon: city.weather?.icon ?? '☀️' },
    consenso: city.consenso,
    nowcast_activo: city.nowcast?.activo ?? false,
    extreme_alert: extremeAlert,
    extreme_type: extremeType,
  }
  signal.recomendacion = generarRecomendacion({
    ciudad: signal.ciudad!, forecast_c: signal.forecast_c!, edge_pct: signal.edge_pct!,
    confidence: signal.confidence!, extreme_alert: signal.extreme_alert!,
    extreme_type: signal.extreme_type!, band: signal.band!,
    weather: signal.weather!, historical_accuracy_pct: signal.historical_accuracy_pct!,
  })

  return signal as CitySignal
}

interface CitySignalInput {
  ciudad: string; slug: string; exito_pct: number
  forecast: { temp_corregida: number; temp_ponderada: number; sesgo_aplicado: number }
  volatilidad: number; spread: number; consenso: string
  nowcast?: { activo: boolean }
  weather?: { code: number; label: string; icon: string; severity: string }
  totalRecords?: number
}

export function buildSignalsPackage(
  cities: CitySignalInput[],
  globalMetrics: { accuracy_pct: number; overall_mae: number; total_muestras: number },
  recommendations: { slug: string; edge: number; ia_pct: number; mkt_pct: number }[],
  historicalErrors: Record<string, number[]>,
  fechaObjetivo: string,
  isCron: boolean,
): SignalsPackage {
  const recMap = new Map(recommendations.map(r => [r.slug, r]))
  const paises = Array.from(new Set(cities.map(c => CIUDAD_PAIS[c.slug] ?? 'Desconocido')))

  const signals = cities.map(city => {
    const rec = recMap.get(city.slug) ?? null
    const errors = historicalErrors[city.slug] ?? []
    const bands = computeBands(errors)
    return buildCitySignal(city, rec, bands)
  })

  return {
    version: '1.0',
    generated_at: new Date().toISOString(),
    fecha_objetivo: fechaObjetivo,
    data_freshness: isCron ? 'cron_10pm' : 'analisis_fresco',
    coverage: { ciudades: cities.length, paises: paises.length, lista_paises: paises },
    global_accuracy_pct: globalMetrics.accuracy_pct,
    global_mae: globalMetrics.overall_mae,
    total_historical_records: globalMetrics.total_muestras,
    signals,
    metadata: {
      methodology: 'Ensemble ponderado de 6 modelos meteorológicos (ECMWF, GFS, ICON, JMA, MeteoFrance, best_match) con corrección dinámica de sesgo (EMA α=0.3), contracción bayesiana para precisión histórica, y bandas de error P5-P95 sobre errores históricos reales.',
      accuracy_metric: '±0.5°C del valor real de cierre del mercado. Precisión calculada con contracción bayesiana (prior global + observaciones por ciudad).',
      data_sources: [
        'Open-Meteo API (6 modelos meteorológicos)',
        'METAR airports (nowcasting en vivo)',
        'Supabase base de datos histórica (forecast_history con reales confirmados)',
        'Polymarket CLOB (precios de mercado en tiempo real)',
      ],
      models: ['ECMWF IFS 025', 'GFS Seamless', 'ICON Seamless', 'JMA Seamless', 'MeteoFrance Seamless', 'Best Match Ensemble'],
      confidence_method: 'Score compuesto: 40% precisión histórica, 20% consenso entre modelos, 10% nowcast activo, 10% cantidad de muestras, 10% spread entre modelos, 10% otros factores.',
      license: 'Uso libre con atribución. Para uso comercial o integración API, contactar a ramonparrab@gmail.com',
    },
  }
}
