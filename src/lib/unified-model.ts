import { CityAnalysis, BetRecommendation, GlobalMetrics } from '@/types'

export interface DailyImprovement {
  ciudad: string
  slug: string
  accuracy_hoy: number
  accuracy_ayer: number
  accuracy_delta: number
  edge_hoy: number
  edge_ayer: number
  edge_delta: number
  best_contract_hoy: string
  best_edge_hoy: number
  tendencia: 'mejorando' | 'estable' | 'empeorando'
  signal: 'FUERTE' | 'MEDIA' | 'DEBIL' | 'EVITAR'
}

export interface BetAction {
  ciudad: string
  slug: string
  contrato: string
  temp_pronosticada: number
  precio_compra: number
  montoinvertir: number
  upside: number
  downside: number
  edge: number
  prob_ia: number
  prob_mercado: number
  consenso: string
  exito_pct: number
  signal: 'EXCELENTE' | 'BUENA' | 'NEUTRAL' | 'EVITAR'
  razon: string
  riesgo: 'BAJO' | 'MEDIO' | 'ALTO'
  ganancia_esperada: number
  perdida_esperada: number
  ev: number
}

export interface BetActionPlan {
  presupuesto_total: number
  total_asignado: number
  total_restante: number
  num_apuestas: number
  acciones: BetAction[]
  resumen_plan: string
  escenario_caso_a: string
  escenario_caso_b: string
  escenario_caso_c: string
}

export interface ExecutiveSummary {
  fecha: string
  fecha_anterior: string | null
  // Global metrics
  precision_global_hoy: number
  precision_global_ayer: number | null
  precision_global_delta: number | null
  // Top recommendation
  mejor_recomendacion: BetRecommendation | null
  // Per-city improvements
  mejoras_por_ciudad: DailyImprovement[]
  // Top opportunities
  top_opportunities: {
    ciudad: string
    contrato: string
    edge: number
    accuracy: number
    consenso: string
    razon: string
  }[]
  // Action plan
  action_plan: BetActionPlan
  // Daily highlights
  highlights: string[]
  // Summary text
  resumen_texto: string
}

function getConfidenceLabel(pct: number): 'FUERTE' | 'MEDIA' | 'DEBIL' | 'EVITAR' {
  if (pct >= 70) return 'FUERTE'
  if (pct >= 55) return 'MEDIA'
  if (pct >= 40) return 'DEBIL'
  return 'EVITAR'
}

function getActionSignal(edge: number, exitoPct: number, consenso: string): BetAction['signal'] {
  if (edge > 10 && exitoPct >= 65 && (consenso === 'MUY FUERTE' || consenso === 'FUERTE')) return 'EXCELENTE'
  if (edge > 6 && exitoPct >= 55) return 'BUENA'
  if (edge > 3) return 'NEUTRAL'
  return 'EVITAR'
}

function getRiskLevel(exitoPct: number, consenso: string, spread: number): BetAction['riesgo'] {
  if (exitoPct >= 70 && (consenso === 'MUY FUERTE' || consenso === 'FUERTE') && spread <= 2.5) return 'BAJO'
  if (exitoPct >= 55 || (consenso === 'FUERTE' && spread <= 3.0)) return 'MEDIO'
  return 'ALTO'
}

function computeActionPlan(
  recommendations: BetRecommendation[],
  cities: CityAnalysis[],
  presupuesto: number = 10
): BetActionPlan {
  const PRESUPUESTO = presupuesto
  const MAX_POR_APUESTA = 5.0
  const MIN_POR_APUESTA = 1.0
  const MIN_EDGE = 4.0

  // Filter actionable candidates (min accuracy 55%)
  const candidates = recommendations
    .filter(r => r.edge >= MIN_EDGE)
    .filter(r => (r.exito_pct ?? 50) >= 55)
    .filter(r => r.consenso === 'MUY FUERTE' || r.consenso === 'FUERTE' || r.consenso === 'ACEPTABLE')
    .filter(r => r.arbitraje !== 'ALTO')
    .sort((a, b) => {
      const scoreA = a.edge * ((a.exito_pct ?? 50) / 100)
      const scoreB = b.edge * ((b.exito_pct ?? 50) / 100)
      return scoreB - scoreA
    })

  if (candidates.length === 0) {
    return {
      presupuesto_total: PRESUPUESTO,
      total_asignado: 0,
      total_restante: PRESUPUESTO,
      num_apuestas: 0,
      acciones: [],
      resumen_plan: `Presupuesto: $${PRESUPUESTO} · Sin apuestas que cumplan filtros (edge > ${MIN_EDGE}%, consenso FUERTE)`,
      escenario_caso_a: 'Sin apuestas',
      escenario_caso_b: 'Sin apuestas',
      escenario_caso_c: 'Sin apuestas',
    }
  }

  // Step 1: Calculate raw scores for proportional allocation
  const scores = candidates.map(r => {
    const accuracy = (r.exito_pct ?? 50) / 100
    const edgeScore = r.edge * accuracy
    return { rec: r, score: edgeScore }
  })

  const totalScore = scores.reduce((s, x) => s + x.score, 0)

  // Step 2: Allocate proportionally, then clamp
  const acciones: BetAction[] = []
  let totalAsignado = 0

  for (const { rec, score } of scores) {
    if (totalAsignado >= PRESUPUESTO) break

    const cityData = cities.find(c => c.slug === rec.slug)
    const modeloTemps = cityData ? Object.values(cityData.forecast.ensemble_raw) : []
    const spread = modeloTemps.length > 0 ? Math.max(...modeloTemps) - Math.min(...modeloTemps) : 3

    const exitoPct = rec.exito_pct ?? 50
    const signal = getActionSignal(rec.edge, exitoPct, rec.consenso)
    const riesgo = getRiskLevel(exitoPct, rec.consenso, spread)

    // Proportional allocation based on score
    const proporcion = totalScore > 0 ? score / totalScore : 1 / candidates.length
    let monto = Math.round(proporcion * PRESUPUESTO * 100) / 100

    // Clamp
    monto = Math.max(MIN_POR_APUESTA, Math.min(MAX_POR_APUESTA, monto))
    monto = Math.min(monto, PRESUPUESTO - totalAsignado)
    monto = Math.round(monto * 100) / 100

    if (monto < MIN_POR_APUESTA) continue

    const precioCompra = rec.mkt_pct / 100
    const upside = monto * ((1 / precioCompra) - 1)
    const downside = monto
    const probGanar = (rec.ia_pct ?? 50) / 100
    const probPerder = 1 - probGanar
    const gananciaEsperada = probGanar * upside
    const perdidaEsperada = probPerder * downside
    const ev = gananciaEsperada - perdidaEsperada

    // Build reasoning
    const razones: string[] = []
    if (rec.edge > 10) razones.push(`Edge MUY fuerte (+${rec.edge.toFixed(1)}%)`)
    else if (rec.edge > 6) razones.push(`Edge fuerte (+${rec.edge.toFixed(1)}%)`)
    else razones.push(`Edge moderado (+${rec.edge.toFixed(1)}%)`)

    if (exitoPct >= 70) razones.push(`Precisión ${exitoPct}% (alta)`)
    else if (exitoPct >= 55) razones.push(`Precisión ${exitoPct}% (media)`)
    else razones.push(`Precisión ${exitoPct}% (baja)`)

    if (rec.consenso === 'MUY FUERTE') razones.push('consenso muy fuerte entre modelos')
    else if (rec.consenso === 'FUERTE') razones.push('consenso fuerte entre modelos')

    if (rec.temp_corregida && rec.contrato.includes(`${Math.round(rec.temp_corregida)}`)) {
      razones.push(`contrato alineado con pronóstico ${rec.temp_corregida.toFixed(1)}°C`)
    }

    const razon = razones.join(' · ')

    acciones.push({
      ciudad: rec.ciudad,
      slug: rec.slug,
      contrato: rec.contrato,
      temp_pronosticada: rec.temp_corregida,
      precio_compra: precioCompra,
      montoinvertir: monto,
      upside: Math.round(upside * 100) / 100,
      downside: Math.round(downside * 100) / 100,
      edge: rec.edge,
      prob_ia: rec.ia_pct,
      prob_mercado: rec.mkt_pct,
      consenso: rec.consenso,
      exito_pct: exitoPct,
      signal,
      razon,
      riesgo,
      ganancia_esperada: Math.round(gananciaEsperada * 100) / 100,
      perdida_esperada: Math.round(perdidaEsperada * 100) / 100,
      ev: Math.round(ev * 100) / 100,
    })

    totalAsignado += monto
  }

  totalAsignado = Math.round(totalAsignado * 100) / 100
  const totalRestante = Math.round((PRESUPUESTO - totalAsignado) * 100) / 100

  // Build scenarios
  let totalGananciaBest = 0
  let totalGananciaWorst = 0
  let totalPerdidaBest = 0
  let totalPerdidaWorst = 0

  for (const a of acciones) {
    totalGananciaBest += a.ganancia_esperada
    totalPerdidaBest += a.perdida_esperada
  }

  // Case A: All bets win
  const caseA_ganancia = acciones.reduce((s, a) => s + a.upside, 0)
  // Case B: Expected (some win, some lose based on probabilities)
  const caseB_ganancia = totalGananciaBest
  // Case C: All bets lose
  const caseC_perdida = totalAsignado

  const resumenPlan = `Presupuesto: $${PRESUPUESTO} · ${acciones.length} apuesta(s) · $${totalAsignado} asignados · $${totalRestante} sin usar`

  return {
    presupuesto_total: PRESUPUESTO,
    total_asignado: totalAsignado,
    total_restante: totalRestante,
    num_apuestas: acciones.length,
    acciones,
    resumen_plan: resumenPlan,
    escenario_caso_a: `Si GANAS todas: +$${caseA_ganancia.toFixed(2)} de ganancia neta`,
    escenario_caso_b: `Resultado ESPERADO: +$${caseB_ganancia.toFixed(2)} ganancia neta (promedio ponderado)`,
    escenario_caso_c: `Si PIERDES todas: -$${caseC_perdida.toFixed(2)} (pierdes lo invertido)`,
  }
}

export function computeExecutiveSummary(
  fechaActual: string,
  citiesToday: CityAnalysis[],
  recommendationsToday: BetRecommendation[],
  metricsToday: GlobalMetrics | null,
  citiesYesterday: CityAnalysis[] | null,
  recommendationsYesterday: BetRecommendation[] | null,
  metricsYesterday: GlobalMetrics | null
): ExecutiveSummary {
  // Global accuracy comparison
  const accuracyGlobalHoy = metricsToday?.accuracy_pct ?? 0
  const accuracyGlobalAyer = metricsYesterday?.accuracy_pct ?? null
  const precisionGlobalDelta = accuracyGlobalAyer !== null ? accuracyGlobalHoy - accuracyGlobalAyer : null

  // Find best recommendation by edge
  const bestRec = recommendationsToday.length > 0
    ? [...recommendationsToday].sort((a, b) => b.edge - a.edge)[0]
    : null

  // Per-city improvements
  const cityMapToday = new Map(citiesToday.map(c => [c.slug, c]))
  const cityMapYesterday = new Map((citiesYesterday ?? []).map(c => [c.slug, c]))

  const mejorasPorCiudad: DailyImprovement[] = citiesToday.map(city => {
    const cityY = cityMapYesterday.get(city.slug)
    const accuracyHoy = city.exito_pct
    const accuracyAyer = cityY?.exito_pct ?? accuracyHoy
    const accuracyDelta = accuracyHoy - accuracyAyer

    // Best contract today
    const bestContract = city.contratos.length > 0
      ? [...city.contratos].sort((a, b) => {
          const edgeA = (a.prob_ia_norm ?? 0) * 100 - a.prob_mkt
          const edgeB = (b.prob_ia_norm ?? 0) * 100 - b.prob_mkt
          return edgeB - edgeA
        })[0]
      : null
    const edgeHoy = bestContract ? ((bestContract.prob_ia_norm ?? 0) * 100 - bestContract.prob_mkt) : 0

    // Yesterday's best edge
    const bestContractY = cityY?.contratos && cityY.contratos.length > 0
      ? [...cityY.contratos].sort((a, b) => {
          const edgeA = (a.prob_ia_norm ?? 0) * 100 - a.prob_mkt
          const edgeB = (b.prob_ia_norm ?? 0) * 100 - b.prob_mkt
          return edgeB - edgeA
        })[0]
      : null
    const edgeAyer = bestContractY ? ((bestContractY.prob_ia_norm ?? 0) * 100 - bestContractY.prob_mkt) : edgeHoy
    const edgeDelta = edgeHoy - edgeAyer

    const tendencia: DailyImprovement['tendencia'] =
      accuracyDelta > 2 ? 'mejorando' : accuracyDelta < -2 ? 'empeorando' : 'estable'

    const signal = getConfidenceLabel(accuracyHoy)

    return {
      ciudad: city.ciudad,
      slug: city.slug,
      accuracy_hoy: accuracyHoy,
      accuracy_ayer: accuracyAyer,
      accuracy_delta: accuracyDelta,
      edge_hoy: edgeHoy,
      edge_ayer: edgeAyer,
      edge_delta: edgeDelta,
      best_contract_hoy: bestContract?.texto ?? 'N/A',
      best_edge_hoy: edgeHoy,
      tendencia,
      signal,
    }
  }).sort((a, b) => b.best_edge_hoy - a.best_edge_hoy)

  // Top opportunities (edge > 5% AND accuracy > 60%)
  const topOpportunities = recommendationsToday
    .filter(r => r.edge > 5 && (r.exito_pct ?? 0) >= 55)
    .sort((a, b) => {
      const scoreA = a.edge * (a.exito_pct ?? 50) / 100
      const scoreB = b.edge * (b.exito_pct ?? 50) / 100
      return scoreB - scoreA
    })
    .slice(0, 5)
    .map(r => ({
      ciudad: r.ciudad,
      contrato: r.contrato,
      edge: r.edge,
      accuracy: r.exito_pct ?? 50,
      consenso: r.consenso,
      razon: r.edge > 10
        ? 'Ventaja MATEMÁTICA fuerte — apostar'
        : r.edge > 5
        ? 'Ventaja moderada — considerar'
        : 'Señal débil — observar',
    }))

  // Generate highlights
  const highlights: string[] = []

  if (precisionGlobalDelta !== null) {
    if (precisionGlobalDelta > 0) {
      highlights.push(`Precisión global mejoró +${precisionGlobalDelta.toFixed(1)}% vs ayer`)
    } else if (precisionGlobalDelta < 0) {
      highlights.push(`Precisión global bajó ${precisionGlobalDelta.toFixed(1)}% vs ayer`)
    } else {
      highlights.push('Precisión global estable vs ayer')
    }
  }

  const improving = mejorasPorCiudad.filter(m => m.tendencia === 'mejorando')
  const worsening = mejorasPorCiudad.filter(m => m.tendencia === 'empeorando')

  if (improving.length > 0) {
    highlights.push(`${improving.length} ciudad(es) mejorando: ${improving.map(m => m.ciudad).join(', ')}`)
  }
  if (worsening.length > 0) {
    highlights.push(`${worsening.length} ciudad(es) bajando: ${worsening.map(m => m.ciudad).join(', ')}`)
  }

  if (topOpportunities.length > 0) {
    const best = topOpportunities[0]
    highlights.push(`Mejor oportunidad: ${best.ciudad} ${best.contrato} (edge +${best.edge.toFixed(1)}%, ${best.accuracy}% acierto)`)
  }

  const fuertes = mejorasPorCiudad.filter(m => m.signal === 'FUERTE')
  if (fuertes.length > 0) {
    highlights.push(`Señales FUERTES: ${fuertes.map(m => m.ciudad).join(', ')}`)
  }

  // Summary text
  const parts: string[] = []
  parts.push(`Análisis del ${fechaActual}.`)
  if (bestRec) {
    parts.push(`Mejor oportunidad: ${bestRec.ciudad} ${bestRec.contrato} con edge +${bestRec.edge.toFixed(1)}%.`)
  }
  if (precisionGlobalDelta !== null) {
    parts.push(`Precisión global: ${accuracyGlobalHoy.toFixed(1)}% (${precisionGlobalDelta >= 0 ? '+' : ''}${precisionGlobalDelta.toFixed(1)}% vs ayer).`)
  }
  if (fuertes.length > 0) {
    parts.push(`Ciudades con señal fuerte: ${fuertes.map(m => m.ciudad).join(', ')}.`)
  }

  // Compute action plan with $10 daily budget
  const actionPlan = computeActionPlan(recommendationsToday, citiesToday, 10)

  return {
    fecha: fechaActual,
    fecha_anterior: citiesYesterday?.[0]?.forecast?.temp_corregida !== undefined ? 'ayer' : null,
    precision_global_hoy: accuracyGlobalHoy,
    precision_global_ayer: accuracyGlobalAyer,
    precision_global_delta: precisionGlobalDelta,
    mejor_recomendacion: bestRec,
    mejoras_por_ciudad: mejorasPorCiudad,
    top_opportunities: topOpportunities,
    action_plan: actionPlan,
    highlights,
    resumen_texto: parts.join(' '),
  }
}
