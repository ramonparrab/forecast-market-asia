import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const GAMMA_API = 'https://gamma-api.polymarket.com'
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december']

interface BucketAnalysis {
  valor: number
  texto: string
  tipo: string
  mktPrice: number
  probMktEntrada?: number
  volume: number
  iaProb?: number
  edge?: number
  esGanador: boolean
}

interface CityAnalysis {
  slug: string
  ciudad: string
  forecast: number | null
  tempReal: number | null
  error: number | null
  consenso: string | null
  buckets: BucketAnalysis[]
  totalVolume: number
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const fecha = (req.query.fecha as string) || req.body?.fecha
    if (!fecha) return res.status(400).json({ error: 'fecha requerida' })

    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'No Supabase config' })

    const client = createClient(supabaseUrl, supabaseKey)

    // 1. Get forecast_history for this date
    const { data: records } = await client
      .from('forecast_history' as any)
      .select('slug, ciudad, temp_corregida, temp_real, error, consenso')
      .eq('fecha_objetivo', fecha)
      .not('temp_real', 'is', null)
    const historyMap = new Map((records as any[] || []).map(r => [r.slug, r]))

    // 2. Get earliest daily_run for this date (forecast-time, before market resolved)
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('resultados')
      .eq('fecha_objetivo', fecha)
      .order('fecha_ejecucion', { ascending: true } as any)
      .limit(1)

    let contratosMap = new Map<string, any[]>()
    if ((runs as any[] | undefined)?.length) {
      const row = (runs as any[])[0]
      const cities = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : row.resultados
      if (Array.isArray(cities)) {
        for (const c of cities) {
          if (c.contratos) contratosMap.set(c.slug, c.contratos)
        }
      }
    }

    // 3. Fetch Polymarket events for each city
    const results: CityAnalysis[] = []
    const date = new Date(fecha + 'T12:00:00Z')
    const monthName = MONTHS[date.getUTCMonth()]
    const day = date.getUTCDate()
    const year = date.getUTCFullYear()

    const slugSet = new Set<string>()
    for (const k of Array.from(historyMap.keys())) slugSet.add(k)
    for (const k of Array.from(contratosMap.keys())) slugSet.add(k)
    const slugs = Array.from(slugSet)

    for (const slug of slugs) {
      const eventSlug = `highest-temperature-in-${slug}-on-${monthName}-${day}-${year}`
      let buckets: BucketAnalysis[] = []
      let totalVolume = 0

      try {
        const resp = await fetch(`${GAMMA_API}/events?slug=${encodeURIComponent(eventSlug)}`, {
          signal: AbortSignal.timeout(10000),
        })
        if (resp.ok) {
          const events = await resp.json()
          if (events?.length) {
            const markets: any[] = events[0].markets || []
            const savedContratos = contratosMap.get(slug) || []

            for (const m of markets) {
              const title = m.groupItemTitle || m.question || ''
              const valor = parseInt(title.replace(/[°C]/g, '').trim()) || 0
              if (!valor) continue

              let outcomePrices: string[] = []
              if (typeof m.outcomePrices === 'string') {
                try { outcomePrices = JSON.parse(m.outcomePrices) } catch { outcomePrices = [] }
              } else {
                outcomePrices = (m.outcomePrices as string[]) || []
              }
              const yesPrice = parseFloat(outcomePrices[0] || '0')

              const savedC = savedContratos.find((c: any) => c.valor === valor)
              const vol = parseFloat(m.volumeNum as any) || parseFloat(m.volume || '0') || 0
              totalVolume += vol

              buckets.push({
                valor,
                texto: m.groupItemTitle || title,
                tipo: title.includes('higher') ? 'superior' : 'exacto',
                mktPrice: yesPrice,
                probMktEntrada: savedC?.prob_mkt ?? undefined,
                volume: Math.round(vol * 100) / 100,
                iaProb: savedC?.prob_ia_norm ? Math.round(savedC.prob_ia_norm * 10000) / 100 : undefined,
                edge: savedC?.prob_ia_norm ? Math.round((savedC.prob_ia_norm * 100 - (savedC.prob_mkt || 0)) * 10) / 10 : undefined,
                esGanador: yesPrice >= 0.99,
              })
            }
          }
        }
      } catch { /* skip if gamma fails */ }

      buckets.sort((a, b) => a.valor - b.valor)

      const hist = historyMap.get(slug) || {}
      results.push({
        slug,
        ciudad: (hist as any).ciudad || slug,
        forecast: (hist as any).temp_corregida ?? null,
        tempReal: (hist as any).temp_real ?? null,
        error: (hist as any).error ?? null,
        consenso: (hist as any).consenso ?? null,
        buckets,
        totalVolume: Math.round(totalVolume * 100) / 100,
      })
    }

    return res.status(200).json({ fecha, cities: results })
  } catch (error) {
    return res.status(500).json({ error: 'Error', details: (error as Error).message })
  }
}