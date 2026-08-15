import { NextApiRequest, NextApiResponse } from 'next'

let cache: { data: any; ts: number } | null = null
const CACHE_TTL = 300_000 // 5 min

interface ContractRow {
  ciudad: string
  slug: string
  texto: string
  tipo: 'exacto' | 'superior' | 'inferior' | 'rango'
  valor: number | [number, number]
  prob_mkt: number
  si_pct: number
  no_pct: number
  prob_ia_norm: number | null
  prob_ia_raw: number | null
  edge: number | null
  ev: number | null
  volume_24h: number | null
  spread: number | null
  liquidity: string | null
}

interface CityArb {
  ciudad: string
  slug: string
  temp_corregida: number
  consenso: string
  exito_pct: number
  contratos: ContractRow[]
  arbitraje_desvio: number
  arbitraje_nivel: string
  total_contracts: number
  best_edge: number | null
  worst_edge: number | null
  avg_edge: number | null
  total_volume: number
}

interface ArbitrajeData {
  fecha_objetivo: string
  run_type: string
  cities: CityArb[]
  all_contracts: ContractRow[]
  resumen: {
    total_contracts: number
    total_cities: number
    contracts_with_edge: number
    avg_edge: number
    best_edge: number
    total_volume: number
    high_ev_count: number
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cache && (Date.now() - cache.ts) < CACHE_TTL) {
    return res.status(200).json({ status: 'ok', cached: true, data: cache.data })
  }

  try {
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({ status: 'ok', data: null, error: 'No Supabase config' })
    }

    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(supabaseUrl, supabaseKey)

    // Fecha objetivo (mañana en Caracas)
    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    const fecha = nowCaracas.toISOString().slice(0, 10)

    // Obtener corridas del día (10PM y 11PM)
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('*')
      .eq('fecha_objetivo', fecha)
      .order('fecha_ejecucion', { ascending: false } as any)
      .limit(2)

    if (!runs || (runs as any[]).length === 0) {
      return res.status(200).json({ status: 'ok', data: null, error: 'Sin corridas para hoy' })
    }

    // Snapshots para determinar winner
    const { data: snapshots } = await client
      .from('forecast_snapshot' as any)
      .select('slug, run_type_ganadora')
      .eq('fecha_objetivo', fecha)
    
    const allRuns = runs as any[]
    let chosen: any
    let runType = 'N/A'

    if (allRuns.length === 1) {
      chosen = allRuns[0]
    } else {
      const snapWins: Record<string, number> = {}
      for (const s of (snapshots ?? [])) {
        snapWins[s.run_type_ganadora] = (snapWins[s.run_type_ganadora] ?? 0) + 1
      }
      const wins10 = snapWins['10PM'] ?? 0
      const wins11 = snapWins['11PM'] ?? 0
      const preferred = wins10 > wins11 ? '10PM' : '11PM'
      chosen = allRuns.find((r: any) => r.run_type === preferred) ?? allRuns[0]
    }
    runType = chosen.run_type ?? (allRuns.length > 1 ? '11PM' : 'single')

    // Parsear resultados
    const ciudades = typeof chosen.resultados === 'string'
      ? JSON.parse(chosen.resultados)
      : chosen.resultados

    if (!ciudades || !Array.isArray(ciudades)) {
      return res.status(200).json({ status: 'ok', data: null, error: 'Sin resultados' })
    }

    // Build city + contract data
    const cities: CityArb[] = []
    const allContracts: ContractRow[] = []

    for (const city of ciudades) {
      const contratos: ContractRow[] = (city.contratos ?? []).map((c: any) => {
        const probIA = (c.prob_ia_norm ?? c.prob_ia_raw) ?? null
        const probMkt = c.prob_mkt ?? 0
        const iaPct = probIA !== null ? Math.round(probIA * 10000) / 100 : null
        const edge = iaPct !== null ? Math.round((iaPct - probMkt) * 100) / 100 : null
        return {
          ciudad: city.ciudad ?? city.nombre ?? '',
          slug: city.slug ?? '',
          texto: c.texto ?? '',
          tipo: c.tipo ?? 'exacto',
          valor: c.valor ?? 0,
          prob_mkt: probMkt,
          si_pct: c.si_pct ?? Math.round(probMkt),
          no_pct: c.no_pct ?? Math.round(100 - probMkt),
          prob_ia_norm: iaPct,
          prob_ia_raw: c.prob_ia_raw ? Math.round(c.prob_ia_raw * 10000) / 100 : null,
          edge,
          ev: c.ev ?? null,
          volume_24h: c.volume_24h ?? null,
          spread: c.spread ?? null,
          liquidity: c.liquidity ?? null,
        }
      })

      if (contratos.length === 0) continue

      // Arbitraje por ciudad: desviación de suma de probs IA vs 1
      const probsIA = contratos.map(c => c.prob_ia_norm ?? 0).filter(p => p > 0)
      const sumaIA = probsIA.reduce((s, v) => s + v, 0)
      const desvio = probsIA.length >= 2 ? Math.abs(sumaIA - 100) : 0
      const nivel = probsIA.length < 2 ? `N/A (${contratos.length} contratos)`
        : desvio < 8 ? 'BAJO'
        : desvio < 18 ? 'MEDIO'
        : 'ALTO'

      const edges = contratos.map(c => c.edge).filter((e): e is number => e !== null)
      const bestEdge = edges.length > 0 ? Math.max(...edges) : null
      const worstEdge = edges.length > 0 ? Math.min(...edges) : null
      const avgEdge = edges.length > 0 ? Math.round(edges.reduce((s, v) => s + v, 0) / edges.length * 100) / 100 : null
      const totalVol = contratos.reduce((s, c) => s + (c.volume_24h ?? 0), 0)

      cities.push({
        ciudad: city.ciudad ?? city.nombre ?? '',
        slug: city.slug ?? '',
        temp_corregida: city.forecast?.temp_corregida ?? 0,
        consenso: city.forecast?.consenso ?? 'N/A',
        exito_pct: city.exito_pct ?? 0,
        contratos,
        arbitraje_desvio: Math.round(desvio * 100) / 100,
        arbitraje_nivel: nivel,
        total_contracts: contratos.length,
        best_edge: bestEdge,
        worst_edge: worstEdge,
        avg_edge: avgEdge,
        total_volume: Math.round(totalVol),
      })

      allContracts.push(...contratos)
    }

    // Resumen global
    const allEdges = allContracts.map(c => c.edge).filter((e): e is number => e !== null)
    const highEv = allContracts.filter(c => c.ev !== null && c.ev > 0.05)
    const resumen = {
      total_contracts: allContracts.length,
      total_cities: cities.length,
      contracts_with_edge: allEdges.filter(e => Math.abs(e) > 2).length,
      avg_edge: allEdges.length > 0 ? Math.round(allEdges.reduce((s, v) => s + v, 0) / allEdges.length * 100) / 100 : 0,
      best_edge: allEdges.length > 0 ? Math.max(...allEdges) : 0,
      total_volume: Math.round(allContracts.reduce((s, c) => s + (c.volume_24h ?? 0), 0)),
      high_ev_count: highEv.length,
    }

    const data: ArbitrajeData = {
      fecha_objetivo: fecha,
      run_type: runType,
      cities,
      all_contracts: allContracts,
      resumen,
    }

    cache = { data, ts: Date.now() }
    return res.status(200).json({ status: 'ok', cached: false, data, source: 'daily_runs' })
  } catch (err) {
    console.error('[ARBITRAJE] Error:', err)
    return res.status(500).json({ status: 'error', message: (err as Error).message })
  }
}
