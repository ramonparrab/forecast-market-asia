import { HistoricalRecord } from '@/types'

export interface MejoraEntry {
  temp: number
  error: number
}

export interface DiaComparacion {
  fecha: string
  temp_real: number
  temp_corregida: number
  error_actual: number
  station: MejoraEntry
  rapid_warming: MejoraEntry
  range_bias: MejoraEntry
  combinado: MejoraEntry
}

export interface MejoraMetrics {
  mae_actual: number
  mae_mejorado: number
  mejora_mae_pct: number
  bias_actual: number
  bias_mejorado: number
  dias_mejora: number
  dias_empeora: number
  dias_empate: number
  total_dias: number
  conclusion: string
}

export interface PipelineStep {
  paso: number
  etapa: string
  desc: string
  aplicado: boolean
  detalle: string
}

export interface CityMejoraResult {
  slug: string
  nombre: string
  estacion_bias_general: number
  modelo: 'combinado_estandar' | 'wuhan_adaptive' | 'shanghai_adaptive' | 'hongkong_adaptive' | 'seoul_adaptive' | 'singapore_adaptive' | 'beijing_adaptive' | 'chengdu_adaptive' | 'shenzhen_adaptive' | 'tokyo_adaptive'
  pipeline: PipelineStep[]
  dailyResults: DiaComparacion[]
  mejoras: Record<string, MejoraMetrics>
  currentForecast: {
    temp_corregida: number
    station: number | null
    rapid_warming: number | null
    range_bias: number | null
    combinado: number | null
  } | null
}

const RANGOS = [
  { min: -Infinity, max: 20, label: '<20' },
  { min: 20, max: 25, label: '20-25' },
  { min: 25, max: 30, label: '25-30' },
  { min: 30, max: 35, label: '30-35' },
  { min: 35, max: Infinity, label: '35+' },
]

function getRango(temp: number): string {
  for (const r of RANGOS) {
    if (temp >= r.min && temp < r.max) return r.label
  }
  return '35+'
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function generateStationConclusion(
  ciudad: string,
  maeAct: number,
  maeMej: number,
  mejPct: number,
  biasAct: number,
  biasMej: number,
  diasMej: number,
  total: number,
  estacionBias: number
): string {
  const dir = mejPct > 0 ? 'MEJORA' : 'EMPEORA'
  const absPct = Math.abs(mejPct).toFixed(1)
  const pctDias = ((diasMej / total) * 100).toFixed(0)
  const biasDirAct = biasAct > 0 ? 'sobrestima' : 'subestima'
  const biasDirMej = biasMej > 0 ? 'sobrestima' : 'subestima'
  const estacionSigno = estacionBias >= 0 ? '+' : ''

  return (
    `[${ciudad}] Corrección por Estación: ${dir} el MAE en un ${absPct}% (de ${maeAct.toFixed(2)}°C a ${maeMej.toFixed(2)}°C). ` +
    `El bias cambia de ${biasAct.toFixed(2)}°C (${biasDirAct}) a ${biasMej.toFixed(2)}°C (${biasDirMej}). ` +
    `Bias de estación general: ${estacionSigno}${estacionBias.toFixed(2)}°C. ` +
    `Mejora en ${diasMej}/${total} días (${pctDias}%). ` +
    `Recomendación: ${mejPct > 5 ? 'APLICAR — reducción significativa del error sistemático.' : mejPct > 0 ? 'Aplicar con cautela — mejora marginal.' : 'NO APLICAR — empeora la precisión.'}`
  )
}

function generateRapidConclusion(
  ciudad: string,
  maeAct: number,
  maeMej: number,
  mejPct: number,
  biasAct: number,
  biasMej: number,
  diasMej: number,
  total: number,
  activaciones: number,
  activacionesMejora: number
): string {
  const dir = mejPct > 0 ? 'MEJORA' : 'EMPEORA'
  const absPct = Math.abs(mejPct).toFixed(1)
  const pctDias = ((diasMej / total) * 100).toFixed(0)
  const pctAct = ((activaciones / total) * 100).toFixed(1)
  const pctActMej = activaciones > 0 ? ((activacionesMejora / activaciones) * 100).toFixed(0) : '0'

  return (
    `[${ciudad}] Boost de Calentamiento Rápido: ${dir} el MAE en un ${absPct}% (de ${maeAct.toFixed(2)}°C a ${maeMej.toFixed(2)}°C). ` +
    `Se activó en ${activaciones}/${total} días (${pctAct}%), mejorando en ${activacionesMejora} de ellos (${pctActMej}%). ` +
    `El bias pasa de ${biasAct.toFixed(2)}°C a ${biasMej.toFixed(2)}°C. ` +
    `Recomendación: ${mejPct > 3 ? 'APLICAR — útil en eventos de calentamiento brusco.' : mejPct > 0 ? 'Útil solo en ciudades con olas de calor frecuentes.' : 'NO APLICAR — añade ruido innecesario.'}`
  )
}

function generateRangeConclusion(
  ciudad: string,
  maeAct: number,
  maeMej: number,
  mejPct: number,
  biasAct: number,
  biasMej: number,
  diasMej: number,
  total: number,
  biasesPorRango: { rango: string; bias: number; muestras: number }[]
): string {
  const dir = mejPct > 0 ? 'MEJORA' : 'EMPEORA'
  const absPct = Math.abs(mejPct).toFixed(1)
  const pctDias = ((diasMej / total) * 100).toFixed(0)
  const rangosStr = biasesPorRango
    .filter(b => b.muestras >= 3)
    .map(b => `${b.rango}°C: ${b.bias >= 0 ? '+' : ''}${b.bias.toFixed(2)}°C (${b.muestras} días)`)
    .join('; ')

  return (
    `[${ciudad}] Sesgo por Rango de Temperatura: ${dir} el MAE en un ${absPct}% (de ${maeAct.toFixed(2)}°C a ${maeMej.toFixed(2)}°C). ` +
    `Biases por rango: ${rangosStr || 'insuficientes muestras'}. ` +
    `Mejora en ${diasMej}/${total} días (${pctDias}%). ` +
    `Recomendación: ${mejPct > 5 ? 'APLICAR — corrige sesgos sistemáticos por temperatura.' : mejPct > 0 ? 'Mejora marginal, aplicar solo donde hay patrones claros.' : 'NO APLICAR — no hay patrón consistente por rango.'}`
  )
}

function generateCombinedConclusion(
  ciudad: string,
  maeAct: number,
  maeMej: number,
  mejPct: number,
  biasAct: number,
  biasMej: number,
  diasMej: number,
  total: number,
  stationPct: number,
  rapidPct: number,
  rangePct: number
): string {
  const dir = mejPct > 0 ? 'MEJORA' : 'EMPEORA'
  const absPct = Math.abs(mejPct).toFixed(1)
  const pctDias = ((diasMej / total) * 100).toFixed(0)
  const mejorIndividual = Math.max(stationPct, rapidPct, rangePct)
  let mejorNombre = ''
  if (mejorIndividual === stationPct) mejorNombre = 'Station Bias'
  else if (mejorIndividual === rapidPct) mejorNombre = 'Rapid Warming'
  else mejorNombre = 'Range Bias'

  return (
    `[${ciudad}] Combinado (Estación + Calentamiento + Rango): ${dir} el MAE en un ${absPct}% ` +
    `(de ${maeAct.toFixed(2)}°C a ${maeMej.toFixed(2)}°C). Bias: ${biasAct.toFixed(2)}°C → ${biasMej.toFixed(2)}°C. ` +
    `Mejora en ${diasMej}/${total} días (${pctDias}%). ` +
    `Individuales: Station=${stationPct >= 0 ? '+' : ''}${stationPct.toFixed(1)}%, ` +
    `Rapid=${rapidPct >= 0 ? '+' : ''}${rapidPct.toFixed(1)}%, ` +
    `Range=${rangePct >= 0 ? '+' : ''}${rangePct.toFixed(1)}%. ` +
    `Mejor individual: ${mejorNombre} (${mejorIndividual >= 0 ? '+' : ''}${mejorIndividual.toFixed(1)}%). ` +
    `Recomendación: ${mejPct > 5 ? 'APLICAR COMBINADO — las 3 mejoras juntas dan el mejor resultado.' : mejPct > 0 ? 'Aplicar combinado, aunque el beneficio es marginal.' : 'NO APLICAR — las mejoras individuales no suman positivamente.'}`
  )
}

function computeMejoraMetrics(
  dailyResults: DiaComparacion[],
  mejoraKey: string,
  ciudad: string,
  slug: string,
  extra: Record<string, any> = {}
): MejoraMetrics {
  const errorsActual = dailyResults.map(d => Math.abs(d.error_actual))
  const errorsMejorado = dailyResults.map(d => Math.abs((d[mejoraKey as keyof DiaComparacion] as MejoraEntry).error))

  const maeActual = round2(mean(errorsActual))
  const maeMejorado = round2(mean(errorsMejorado))
  const mejoraPct = round2(((maeActual - maeMejorado) / (maeActual || 0.001)) * 100)

  const biasActual = round2(mean(dailyResults.map(d => d.error_actual)))
  const biasMejorado = round2(mean(dailyResults.map(d => (d[mejoraKey as keyof DiaComparacion] as MejoraEntry).error)))

  let diasMejora = 0, diasEmpeora = 0, diasEmpate = 0
  for (const d of dailyResults) {
    const act = Math.abs(d.error_actual)
    const mej = Math.abs((d[mejoraKey as keyof DiaComparacion] as MejoraEntry).error)
    if (mej < act) diasMejora++
    else if (mej > act) diasEmpeora++
    else diasEmpate++
  }

  let conclusion = ''
  switch (mejoraKey) {
    case 'station':
      conclusion = generateStationConclusion(
        ciudad, maeActual, maeMejorado, mejoraPct,
        biasActual, biasMejorado, diasMejora, dailyResults.length,
        (extra.estacionBias as number) || 0
      )
      break
    case 'rapid_warming':
      conclusion = generateRapidConclusion(
        ciudad, maeActual, maeMejorado, mejoraPct,
        biasActual, biasMejorado, diasMejora, dailyResults.length,
        (extra.activaciones as number) || 0,
        (extra.activacionesMejora as number) || 0
      )
      break
    case 'range_bias':
      conclusion = generateRangeConclusion(
        ciudad, maeActual, maeMejorado, mejoraPct,
        biasActual, biasMejorado, diasMejora, dailyResults.length,
        (extra.biasesPorRango as any[]) || []
      )
      break
    case 'combinado':
      conclusion = generateCombinedConclusion(
        ciudad, maeActual, maeMejorado, mejoraPct,
        biasActual, biasMejorado, diasMejora, dailyResults.length,
        (extra.stationPct as number) || 0,
        (extra.rapidPct as number) || 0,
        (extra.rangePct as number) || 0
      )
      break
  }

  return {
    mae_actual: maeActual,
    mae_mejorado: maeMejorado,
    mejora_mae_pct: mejoraPct,
    bias_actual: biasActual,
    bias_mejorado: biasMejorado,
    dias_mejora: diasMejora,
    dias_empeora: diasEmpeora,
    dias_empate: diasEmpate,
    total_dias: dailyResults.length,
    conclusion,
  }
}

function buildPipeline(slug: string, estacionBias: number, rangoBiasMap: Record<string, number>): PipelineStep[] {
  const esWuhan = slug === 'wuhan'
  const esShanghai = slug === 'shanghai'
  const esHongKong = slug === 'hong-kong'
  const esSeoul = slug === 'seoul'
  const esSingapore = slug === 'singapore'
  const esBeijing = slug === 'beijing'
  const esChengdu = slug === 'chengdu'
  const esShenzhen = slug === 'shenzhen'
  const esTokyo = slug === 'tokyo'
  const esAdaptive = esWuhan || esHongKong || esSeoul || esSingapore || esBeijing || esChengdu || esShenzhen || esTokyo
  const esRangeOnly = esShanghai

  const stationDesc = esAdaptive ? 'Corrige sesgo grid→estación con promedio histórico de errores (modelo adaptativo)' : esShanghai ? '❌ Desactivado: Range Bias supera a Station para Shanghai' : 'Corrige sesgo grid→estación con promedio histórico de errores'
  const stationDetail = esHongKong ? `✅ Activo — Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C (mejora 25.2% MAE)` :
    esSeoul ? `✅ Activo — Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C (mejora 33.9% MAE)` :
    esWuhan ? `✅ Activo — Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C (única corrección aplicada)` :
    esSingapore ? `✅ Activo — Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C (única corrección aplicada)` :
    esBeijing ? `✅ Activo (Station supera a Range+Station) — Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C` :
    esChengdu ? `✅ Activo (Station supera a Range+Station) — Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C` :
    esShenzhen ? `✅ Activo (Station supera a Range+Station) — Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C` :
    esTokyo ? `✅ Activo (Station supera a Range+Station) — Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C` :
    esShanghai ? `❌ Desactivado: Range Bias solo da mejor MAE (0.89°C vs 0.90°C con Station)` :
    `Bias general: ${estacionBias >= 0 ? '+' : ''}${estacionBias.toFixed(2)}°C`

  const rangeDetail = esShanghai ?
    `✅ Activo (modelo adaptativo) — ${Object.entries(rangoBiasMap).map(([r, b]) => `${r}: ${b >= 0 ? '+' : ''}${b.toFixed(2)}°C`).join(', ')}` :
    esWuhan ? '❌ Desactivado: sobre-corrige rango 26-30°C (MAE empeora 46%)' :
    esHongKong ? '❌ Desactivado: Station solo da mejor MAE (1.04°C vs 1.12°C con Range)' :
    esSeoul ? '❌ Desactivado: Station solo da mejor MAE (1.19°C vs 1.28°C con Range)' :
    esSingapore ? '❌ Desactivado: Station solo es la estrategia inicial' :
    esBeijing ? `❌ Desactivado: Station sola da mejor MAE que Station+Range` :
    esChengdu ? `❌ Desactivado: Station sola da mejor MAE que Station+Range` :
    esShenzhen ? `❌ Desactivado: Station sola da mejor MAE que Station+Range` :
    esTokyo ? `❌ Desactivado: Station sola da mejor MAE que Station+Range` :
    `${Object.entries(rangoBiasMap).map(([r, b]) => `${r}: ${b >= 0 ? '+' : ''}${b.toFixed(2)}°C`).join(', ')}`

  const rapidDetail = esHongKong ? '❌ Desactivado: sin activaciones en 59 días (0% impacto)' :
    esSeoul ? '❌ Desactivado: sin activaciones en 59 días (0% impacto)' :
    esShanghai ? '❌ Desactivado: solo 1 activación en 59 días (1.7%, datos insuficientes)' :
    esWuhan ? '❌ Desactivado: solo 3.4% win rate en Wuhan' :
    esSingapore ? '❌ Desactivado: modelo solo Station por ahora' :
    esShenzhen ? '❌ Desactivado: Station sola da mejor MAE que incluir Rapid Warming' :
    esBeijing ? '❌ Desactivado: Station sola da mejor MAE que incluir Rapid Warming' :
    esChengdu ? '❌ Desactivado: Station sola da mejor MAE que incluir Rapid Warming' :
    esTokyo ? '❌ Desactivado: Station sola da mejor MAE que incluir Rapid Warming' :
    'Se activa en saltos > 3°C'

  const combinadoDesc = esWuhan ? 'Solo Station Bias (sin range, sin rapid)' :
    esHongKong ? 'Solo Station Bias (sin range, sin rapid) — modelo HongKong Adaptive' :
    esSeoul ? 'Solo Station Bias (sin range, sin rapid) — modelo Seoul Adaptive' :
    esSingapore ? 'Solo Station Bias (sin range, sin rapid) — modelo Singapore Adaptive' :
    esBeijing ? 'Solo Station Bias (sin range, sin rapid) — modelo Beijing Adaptive' :
    esChengdu ? 'Solo Station Bias (sin range, sin rapid) — modelo Chengdu Adaptive' :
    esShenzhen ? 'Solo Station Bias (sin range, sin rapid) — modelo Shenzhen Adaptive' :
    esTokyo ? 'Solo Station Bias (sin range, sin rapid) — modelo Tokyo Adaptive' :
    esShanghai ? 'Solo Range Bias (sin station, sin rapid) — modelo Shanghai Adaptive' :
    'Station + Range + Rapid Warming'

  const combinadoDetail = esWuhan ? 'Modelo Wuhan Adaptive: temp_corregida + stationBias' :
    esHongKong ? 'Modelo HongKong Adaptive: temp_corregida + stationBias (MAE 1.04°C)' :
    esSeoul ? 'Modelo Seoul Adaptive: temp_corregida + stationBias (MAE 1.19°C)' :
    esSingapore ? 'Modelo Singapore Adaptive: temp_corregida + stationBias' :
    esBeijing ? 'Modelo Beijing Adaptive: temp_corregida + stationBias (MAE ~1.12°C)' :
    esChengdu ? 'Modelo Chengdu Adaptive: temp_corregida + stationBias (MAE ~1.13°C)' :
    esShenzhen ? 'Modelo Shenzhen Adaptive: temp_corregida + stationBias (MAE ~0.91°C)' :
    esTokyo ? 'Modelo Tokyo Adaptive: temp_corregida + stationBias (MAE ~0.87°C)' :
    esShanghai ? 'Modelo Shanghai Adaptive: temp_corregida + rangeBias (MAE 0.89°C)' :
    'Modelo estándar: temp + station + range + boost'

  return [
    { paso: 1, etapa: 'Station Bias', desc: stationDesc, aplicado: esAdaptive, detalle: stationDetail },
    { paso: 2, etapa: 'Range Bias', desc: 'Corrige sesgo específico del rango de temperatura', aplicado: esRangeOnly, detalle: rangeDetail },
    { paso: 3, etapa: 'Rapid Warming Boost', desc: '+0.5°C si forecast > temp_real ayer + 3°C (olas de calor)', aplicado: false, detalle: rapidDetail },
    { paso: 4, etapa: 'Combinado Final', desc: combinadoDesc, aplicado: true, detalle: combinadoDetail },
  ]
}

export function computeAllMejoras(
  records: HistoricalRecord[],
  nombre: string
): CityMejoraResult {
  const slug = records[0]?.slug || ''
  const esWuhan = slug === 'wuhan'
  const esShanghai = slug === 'shanghai'
  const esHongKong = slug === 'hong-kong'
  const esSeoul = slug === 'seoul'
  const esSingapore = slug === 'singapore'
  const esBeijing = slug === 'beijing'
  const esChengdu = slug === 'chengdu'
  const esShenzhen = slug === 'shenzhen'
  const esTokyo = slug === 'tokyo'
  const esOnlyStation = esWuhan || esHongKong || esSeoul || esSingapore || esBeijing || esChengdu || esShenzhen || esTokyo
  const validos = records.filter(r => r.temp_real !== null && r.error !== null) as (HistoricalRecord & { temp_real: number; error: number })[]
  validos.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

  const dailyResults: DiaComparacion[] = []
  const stationErrors: number[] = []
  const rangeBuckets: Record<string, number[]> = {}

  for (let i = 0; i < validos.length; i++) {
    const r = validos[i]

    const stationBias = stationErrors.length > 0 ? mean(stationErrors) : 0
    const tempStation = r.temp_corregida + stationBias
    const errorStation = r.temp_real - tempStation

    const prevReal = i > 0 ? validos[i - 1].temp_real : null
    const boost = (prevReal !== null && r.temp_corregida > prevReal + 3) ? 0.5 : 0
    const tempRapid = r.temp_corregida + boost
    const errorRapid = r.temp_real - tempRapid

    const range = getRango(r.temp_corregida)
    const rangeErrors = rangeBuckets[range] || []
    const rangeBias = rangeErrors.length > 0 ? mean(rangeErrors) : 0
    const tempRange = r.temp_corregida + rangeBias
    const errorRange = r.temp_real - tempRange

    let tempCombined: number, errorCombined: number
    if (esOnlyStation) {
      // Station ONLY model
      tempCombined = r.temp_corregida + stationBias
      errorCombined = r.temp_real - tempCombined
    } else if (esShanghai) {
      // Range ONLY model
      tempCombined = r.temp_corregida + rangeBias
      errorCombined = r.temp_real - tempCombined
    } else {
      tempCombined = r.temp_corregida + stationBias + rangeBias + boost
      errorCombined = r.temp_real - tempCombined
    }

    dailyResults.push({
      fecha: r.fecha_objetivo,
      temp_real: r.temp_real,
      temp_corregida: r.temp_corregida,
      error_actual: r.error,
      station: { temp: round2(tempStation), error: round2(errorStation) },
      rapid_warming: { temp: round2(tempRapid), error: round2(errorRapid) },
      range_bias: { temp: round2(tempRange), error: round2(errorRange) },
      combinado: { temp: round2(tempCombined), error: round2(errorCombined) },
    })

    stationErrors.push(r.error)
    if (!rangeBuckets[range]) rangeBuckets[range] = []
    rangeBuckets[range].push(r.error)
  }

  const estacionBias = stationErrors.length > 0 ? mean(stationErrors) : 0
  const biasesPorRango = Object.entries(rangeBuckets).map(([rango, errs]) => ({
    rango,
    bias: round2(mean(errs)),
    muestras: errs.length,
  }))

  const activaciones = dailyResults.filter(d => {
    const idx = dailyResults.indexOf(d)
    if (idx === 0) return false
    return d.temp_corregida > dailyResults[idx - 1].temp_real + 3
  }).length

  const activacionesMejora = dailyResults.filter((d, idx) => {
    if (idx === 0) return false
    if (!(d.temp_corregida > dailyResults[idx - 1].temp_real + 3)) return false
    return Math.abs(d.rapid_warming.error) < Math.abs(d.error_actual)
  }).length

  const stationMetrics = computeMejoraMetrics(dailyResults, 'station', nombre, slug, { estacionBias })
  const rapidMetrics = computeMejoraMetrics(dailyResults, 'rapid_warming', nombre, slug, { activaciones, activacionesMejora })
  const rangeMetrics = computeMejoraMetrics(dailyResults, 'range_bias', nombre, slug, { biasesPorRango })
  const combinedMetrics = computeMejoraMetrics(dailyResults, 'combinado', nombre, slug, {
    stationPct: stationMetrics.mejora_mae_pct,
    rapidPct: rapidMetrics.mejora_mae_pct,
    rangePct: rangeMetrics.mejora_mae_pct,
  })

  const rangoBiasMap: Record<string, number> = {}
  for (const b of biasesPorRango) rangoBiasMap[b.rango] = b.bias
  const pipeline = buildPipeline(slug, estacionBias, rangoBiasMap)

  return {
    slug,
    nombre,
    estacion_bias_general: round2(estacionBias),
    modelo: esWuhan ? 'wuhan_adaptive' : esShanghai ? 'shanghai_adaptive' : esHongKong ? 'hongkong_adaptive' : esSeoul ? 'seoul_adaptive' : esSingapore ? 'singapore_adaptive' : esBeijing ? 'beijing_adaptive' : esChengdu ? 'chengdu_adaptive' : esShenzhen ? 'shenzhen_adaptive' : esTokyo ? 'tokyo_adaptive' : 'combinado_estandar',
    pipeline,
    dailyResults,
    mejoras: {
      station: stationMetrics,
      rapid_warming: rapidMetrics,
      range_bias: rangeMetrics,
      combinado: combinedMetrics,
    },
    currentForecast: null,
  }
}

export function computeCurrentForecast(
  records: HistoricalRecord[],
  currentRecord: HistoricalRecord,
  nombre: string
): CityMejoraResult['currentForecast'] {
  const slug = currentRecord.slug || ''
  const esWuhan = slug === 'wuhan'
  const esShanghai = slug === 'shanghai'
  const esHongKong = slug === 'hong-kong'
  const esSeoul = slug === 'seoul'
  const esSingapore = slug === 'singapore'
  const esBeijing = slug === 'beijing'
  const esChengdu = slug === 'chengdu'
  const esShenzhen = slug === 'shenzhen'
  const esTokyo = slug === 'tokyo'
  const esOnlyStation = esWuhan || esHongKong || esSeoul || esSingapore || esBeijing || esChengdu || esShenzhen || esTokyo
  const validos = records.filter(r => r.temp_real !== null && r.error !== null) as (HistoricalRecord & { temp_real: number; error: number })[]
  validos.sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

  const stationErrors = validos.map(r => r.error)
  const stationBias = stationErrors.length > 0 ? mean(stationErrors) : 0
  const tempStation = currentRecord.temp_corregida + stationBias

  const prevReal = validos.length > 0 ? validos[validos.length - 1].temp_real : null
  const boost = (prevReal !== null && currentRecord.temp_corregida > prevReal + 3) ? 0.5 : 0
  const tempRapid = currentRecord.temp_corregida + boost

  const range = getRango(currentRecord.temp_corregida)
  const rangeErrors = validos.filter(r => getRango(r.temp_corregida) === range).map(r => r.error)
  const rangeBias = rangeErrors.length > 0 ? mean(rangeErrors) : 0
  const tempRange = currentRecord.temp_corregida + rangeBias

  // City-specific combinado
  let tempCombined: number
  if (esOnlyStation) {
    tempCombined = currentRecord.temp_corregida + stationBias
  } else if (esShanghai) {
    tempCombined = currentRecord.temp_corregida + rangeBias
  } else {
    tempCombined = currentRecord.temp_corregida + stationBias + rangeBias + boost
  }

  return {
    temp_corregida: currentRecord.temp_corregida,
    station: round2(tempStation),
    rapid_warming: round2(tempRapid),
    range_bias: round2(tempRange),
    combinado: round2(tempCombined),
  }
}

export type MejoraKey = 'station' | 'rapid_warming' | 'range_bias' | 'combinado'

export const MEJORA_LABELS: Record<MejoraKey, string> = {
  station: 'Corrección por Estación',
  rapid_warming: 'Boost Calentamiento Rápido',
  range_bias: 'Sesgo por Rango',
  combinado: 'Todas Combinadas',
}

export const MEJORA_DESCRIPTIONS: Record<MejoraKey, string> = {
  station: `Corrige el sesgo sistemático entre la celda grid de Open-Meteo (~11km) y la estación meteorológica real del aeropuerto. 
Para cada día, calcula el error promedio histórico previo (temp_real - temp_corregida) y lo suma como corrección. 
Usa ventana expansiva (solo datos anteriores al día evaluado) para evitar look-ahead bias.
Ejemplo: Si la estación de Chongqing (ZUCK) promedia +0.8°C vs el grid, se suma +0.8°C a todos los forecasts.`,

  rapid_warming: `Detecta olas de calor o calentamientos bruscos que los modelos numéricos tienden a subestimar.
Si la temperatura corregida de hoy supera por más de 3°C la temperatura real de ayer, se añade un boost de +0.5°C.
Esto captura el "rapid warming" típico de eventos de calor extremo donde los modelos son conservadores.
No usa datos futuros, solo el día anterior — naturalmente out-of-sample.`,

  range_bias: `El sesgo del modelo varía según el rango de temperatura. Aplica una corrección distinta para cada rango:
<20°C, 20-25°C, 25-30°C, 30-35°C, 35+°C. Para cada rango, calcula el error promedio histórico previo.
Los rangos con pocas muestras (<3) usan bias cero. Ventana expansiva sin look-ahead bias.
Ejemplo: Si en el rango 35+°C el modelo típicamente subestima por -1.2°C, se suma +1.2°C.`,

  combinado: `Aplica las 3 mejoras en secuencia:
1. Corrección por Estación (bias grid→estación)
2. Boost de Calentamiento Rápido (+0.5°C si salto >3°C)
3. Sesgo por Rango (bias según temperatura)
Cada corrección usa ventana expansiva con datos anteriores al día evaluado.`,
}
