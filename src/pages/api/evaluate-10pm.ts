import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

interface DecisionEval {
  fecha: string
  slug: string
  ciudad: string
  real: number
  nuestraRecom: number
  nuestraMkt: number
  nuestraIA: number
  nuestraEdge: number
  nuestraPnl: number
  optimoRecom: number
  optimoMkt: number
  optimoPnl: number
  diffPnl: number
  acertamos: boolean
}

interface CitySummary {
  slug: string
  ciudad: string
  total: number
  ganadas: number
  pnlNuestro: number
  pnlOptimo: number
  diffTotal: number
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'No Supabase config' })
    const client = createClient(supabaseUrl, supabaseKey)

    const { data: allRuns } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo')
      .order('fecha_ejecucion', { ascending: true } as any)
      .limit(10000)

    const runs = (allRuns as any[]) || []
    const dateGroups = new Map<string, { id: number; ms: number; fecha_ejecucion: string }[]>()
    for (const r of runs) {
      if (!r.fecha_objetivo || !r.fecha_ejecucion) continue
      if (!dateGroups.has(r.fecha_objetivo)) dateGroups.set(r.fecha_objetivo, [])
      dateGroups.get(r.fecha_objetivo)!.push({
        id: r.id, ms: new Date(r.fecha_ejecucion).getTime(), fecha_ejecucion: r.fecha_ejecucion,
      })
    }

    // Pick run closest to 02:00 UTC (10pm Caracas)
    const targetMs = new Date('2026-01-01T02:00:00Z').getTime() % 86400000
    const selectedRuns = new Map<string, { id: number; fecha_ejecucion: string }>()
    for (const [fecha, entries] of Array.from(dateGroups)) {
      const baseDate = new Date(fecha + 'T00:00:00Z').getTime()
      const targetAbsolute = baseDate + targetMs
      let best = entries[0], bestDist = Math.abs(best.ms - targetAbsolute)
      for (let i = 1; i < entries.length; i++) {
        const dist = Math.abs(entries[i].ms - targetAbsolute)
        if (dist < bestDist) { best = entries[i]; bestDist = dist }
      }
      selectedRuns.set(fecha, { id: best.id, fecha_ejecucion: best.fecha_ejecucion })
    }

    const selectedDates = Array.from(selectedRuns.keys())

    const { data: historyData } = await client
      .from('forecast_history' as any)
      .select('fecha_objetivo, slug, ciudad, temp_real')
      .in('fecha_objetivo', selectedDates)
      .not('temp_real', 'is', null)

    const historyMap = new Map<string, any>()
    for (const h of (historyData as any[]) || []) {
      historyMap.set(`${h.fecha_objetivo}|${h.slug}`, h)
    }

    const evaluations: DecisionEval[] = []

    for (const fecha of selectedDates) {
      const runInfo = selectedRuns.get(fecha)!
      const { data: runData } = await client
        .from('daily_runs' as any)
        .select('resultados')
        .eq('id', runInfo.id)
        .limit(1)

      if (!((runData as any[])?.length)) continue

      const row = (runData as any[])[0]
      const cities = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : row.resultados
      if (!Array.isArray(cities)) continue

      for (const city of cities) {
        if (!city.contratos || !Array.isArray(city.contratos)) continue

        const hist = historyMap.get(`${fecha}|${city.slug}`)
        if (!hist || hist.temp_real == null) continue

        const tempReal = Number(hist.temp_real)
        const ganadorValor = Math.round(tempReal)

        // Find our best recommendation at 10pm: highest score (edge * IA) with edge > 0
        let nuestraRecom: { valor: number; mkt: number; ia: number; edge: number; score: number } | null = null
        // Find winning bucket's market price at 10pm
        let optimoMkt: number | null = null

        for (const c of city.contratos) {
          const valor = Number(c.valor) || 0
          const probMkt = Number(c.prob_mkt) || 0
          const probIa = Number(c.prob_ia_norm) || 0

          if (valor === ganadorValor && probMkt > 0) {
            optimoMkt = probMkt
          }

          if (probMkt <= 0 || probIa <= 0) continue
          const edge = probIa * 100 - probMkt
          if (edge <= 0) continue
          const score = edge * probIa * 100
          if (!nuestraRecom || score > nuestraRecom.score) {
            nuestraRecom = { valor, mkt: probMkt, ia: probIa, edge, score }
          }
        }

        if (!nuestraRecom) continue
        if (optimoMkt === null) continue

        const acertamos = nuestraRecom.valor === ganadorValor

        // P&L: bet $1
        const nuestraPnl = acertamos ? (100 / nuestraRecom.mkt - 1) : -1
        const optimoPnl = (100 / optimoMkt - 1)

        evaluations.push({
          fecha,
          slug: city.slug,
          ciudad: city.ciudad || city.slug,
          real: tempReal,
          nuestraRecom: nuestraRecom.valor,
          nuestraMkt: nuestraRecom.mkt,
          nuestraIA: Math.round(nuestraRecom.ia * 10000) / 100,
          nuestraEdge: Math.round(nuestraRecom.edge * 10) / 10,
          nuestraPnl: Math.round(nuestraPnl * 100) / 100,
          optimoRecom: ganadorValor,
          optimoMkt,
          optimoPnl: Math.round(optimoPnl * 100) / 100,
          diffPnl: Math.round((optimoPnl - nuestraPnl) * 100) / 100,
          acertamos,
        })
      }
    }

    // Per-city summaries
    const cityMap = new Map<string, DecisionEval[]>()
    for (const e of evaluations) {
      if (!cityMap.has(e.slug)) cityMap.set(e.slug, [])
      cityMap.get(e.slug)!.push(e)
    }

    const summaries: CitySummary[] = Array.from(cityMap.entries()).map(([slug, evals]) => ({
      slug,
      ciudad: evals[0].ciudad,
      total: evals.length,
      ganadas: evals.filter(e => e.acertamos).length,
      pnlNuestro: Math.round(evals.reduce((s, e) => s + e.nuestraPnl, 0) * 100) / 100,
      pnlOptimo: Math.round(evals.reduce((s, e) => s + e.optimoPnl, 0) * 100) / 100,
      diffTotal: Math.round(evals.reduce((s, e) => s + e.diffPnl, 0) * 100) / 100,
    }))

    const total = evaluations.length
    const ganadas = evaluations.filter(e => e.acertamos).length
    const pnlNuestro = Math.round(evaluations.reduce((s, e) => s + e.nuestraPnl, 0) * 100) / 100
    const pnlOptimo = Math.round(evaluations.reduce((s, e) => s + e.optimoPnl, 0) * 100) / 100
    const diffTotal = Math.round(evaluations.reduce((s, e) => s + e.diffPnl, 0) * 100) / 100

    return res.status(200).json({
      total,
      ganadas,
      perdidas: total - ganadas,
      winRate: total > 0 ? Math.round((ganadas / total) * 10000) / 100 : 0,
      pnlNuestro,
      pnlOptimo,
      diffTotal,
      ciudades: summaries.length,
      summaries,
      evaluations,
    })
  } catch (error) {
    return res.status(500).json({ error: 'Error', details: (error as Error).message })
  }
}
