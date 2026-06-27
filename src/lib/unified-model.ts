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

  return {
    fecha: fechaActual,
    fecha_anterior: citiesYesterday?.[0]?.forecast?.temp_corregida !== undefined ? 'ayer' : null,
    precision_global_hoy: accuracyGlobalHoy,
    precision_global_ayer: accuracyGlobalAyer,
    precision_global_delta: precisionGlobalDelta,
    mejor_recomendacion: bestRec,
    mejoras_por_ciudad: mejorasPorCiudad,
    top_opportunities: topOpportunities,
    highlights,
    resumen_texto: parts.join(' '),
  }
}
