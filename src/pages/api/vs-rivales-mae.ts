import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Modelos rivales que extraemos de ensemble_raw
const RIVAL_MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'best_match'] as const
const RIVAL_LABELS: Record<string, string> = {
  ecmwf_ifs025: 'ECMWF',
  gfs_seamless: 'GFS',
  icon_seamless: 'ICON',
  best_match: 'Best Match',
}

interface CityMae {
  slug: string
  nombre: string
  nuestro: { mae: number; dias: number }
  ecmwf: { mae: number; dias: number }
  gfs: { mae: number; dias: number }
  icon: { mae: number; dias: number }
  best_match: { mae: number; dias: number }
  mejor: string // cual tiene menor MAE
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const client = createClient(supabaseUrl, supabaseKey)

    // 1. Get all forecast_history with real temps (deduped by slug+fecha, latest id)
    const { data: historyRows, error: dbErr } = await client
      .from('forecast_history' as any)
      .select('id, slug, ciudad, fecha_objetivo, temp_corregida, temp_real, error')
      .not('temp_real', 'is', null)
      .not('error', 'is', null)
      .order('id', { ascending: false } as any)
      .limit(5000)

    if (dbErr || !historyRows) {
      return res.status(500).json({ error: dbErr?.message ?? 'DB error' })
    }

    // Dedup: keep latest id per (slug, fecha_objetivo)
    const seen = new Map<string, any>()
    for (const r of (historyRows as any[])) {
      const key = `${r.slug}|${r.fecha_objetivo}`
      if (!seen.has(key) || r.id > seen.get(key).id) {
        seen.set(key, r)
      }
    }
    const dedupedHistory = Array.from(seen.values())

    // Collect unique fechas with real data
    const fechasConReal = new Set(dedupedHistory.map((r: any) => r.fecha_objetivo))
    const fechasList = Array.from(fechasConReal).sort()

    // 2. Get daily_runs for those fechas (to extract rival model temps)
    //    We need the latest run per fecha_objetivo
    const { data: dailyRuns, error: drErr } = await client
      .from('daily_runs' as any)
      .select('id, fecha_objetivo, fecha_ejecucion, resultados')
      .in('fecha_objetivo', fechasList)
      .order('fecha_ejecucion', { ascending: false } as any)

    if (drErr || !dailyRuns) {
      return res.status(500).json({ error: drErr?.message ?? 'DB error fetching daily_runs' })
    }

    // Dedup daily_runs: keep latest per fecha_objetivo
    const runsByDate = new Map<string, any>()
    for (const run of (dailyRuns as any[])) {
      if (!runsByDate.has(run.fecha_objetivo)) {
        runsByDate.set(run.fecha_objetivo, run)
      }
    }

    // 3. Build lookup: (slug, fecha) -> { temp_real, nuestro_live }
    const realLookup = new Map<string, { temp_real: number; nuestro_base: number }>()
    for (const r of dedupedHistory) {
      realLookup.set(`${r.slug}|${r.fecha_objetivo}`, {
        temp_real: parseFloat(r.temp_real),
        nuestro_base: parseFloat(r.temp_corregida),
      })
    }

    // 4. For each date, extract model temps from daily_runs and compare
    // Accumulate errors per source: global and per city
    const globalErrors: Record<string, number[]> = { nuestro: [], ecmwf: [], gfs: [], icon: [], best_match: [] }
    const cityErrors: Record<string, Record<string, number[]>> = {}

    // Also track "nuestro_live" (with winner model) from daily_runs
    const nuestroLiveErrors: number[] = []
    const cityNuestroLiveErrors: Record<string, number[]> = {}

    for (const entry of Array.from(runsByDate.entries())) {
      const fecha = entry[0]
      const run = entry[1]
      let resultados: any[]
      try {
        resultados = typeof run.resultados === 'string' ? JSON.parse(run.resultados) : (run.resultados ?? [])
      } catch {
        continue
      }
      if (!Array.isArray(resultados)) continue

      for (const city of resultados) {
        const slug = city.slug
        const key = `${slug}|${fecha}`
        const realData = realLookup.get(key)
        if (!realData) continue

        const realTemp = realData.temp_real
        const ensembleRaw = city.forecast?.ensemble_raw
        if (!ensembleRaw || typeof ensembleRaw !== 'object') continue

        // Nuestro LIVE (from daily_runs, with winner model applied)
        const nuestroLive = city.forecast?.temp_corregida
        if (nuestroLive !== null && typeof nuestroLive === 'number') {
          const err = Math.abs(nuestroLive - realTemp)
          nuestroLiveErrors.push(err)
          if (!cityNuestroLiveErrors[slug]) cityNuestroLiveErrors[slug] = []
          cityNuestroLiveErrors[slug].push(err)
        }

        // Nuestro BASE (from forecast_history, without winner model — for fair comparison)
        const nuestroBase = realData.nuestro_base
        if (typeof nuestroBase === 'number') {
          const err = Math.abs(nuestroBase - realTemp)
          globalErrors.nuestro.push(err)
          if (!cityErrors[slug]) cityErrors[slug] = { nuestro: [], ecmwf: [], gfs: [], icon: [], best_match: [] }
          cityErrors[slug].nuestro.push(err)
        }

        // Rival models
        for (const modelKey of RIVAL_MODELS) {
          const modelTemp = ensembleRaw[String(modelKey)]
          if (modelTemp !== null && typeof modelTemp === 'number') {
            const err = Math.abs(modelTemp - realTemp)
            const label = RIVAL_LABELS[String(modelKey)] ?? String(modelKey)
            const errKey = label.toLowerCase().replace(' ', '_')
            if (globalErrors[errKey]) {
              globalErrors[errKey].push(err)
            }
            if (!cityErrors[slug]) cityErrors[slug] = { nuestro: [], ecmwf: [], gfs: [], icon: [], best_match: [] }
            if (cityErrors[slug][errKey]) {
              cityErrors[slug][errKey].push(err)
            }
          }
        }
      }
    }

    // 5. Compute MAE
    const mae = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 100) / 100 : 0

    // Use nuestro_live (with winner model) as "NOSOTROS" for the comparison
    const globalMae = {
      nuestro: { mae: mae(nuestroLiveErrors), dias: nuestroLiveErrors.length },
      ecmwf: { mae: mae(globalErrors.ecmwf), dias: globalErrors.ecmwf.length },
      gfs: { mae: mae(globalErrors.gfs), dias: globalErrors.gfs.length },
      icon: { mae: mae(globalErrors.icon), dias: globalErrors.icon.length },
      best_match: { mae: mae(globalErrors.best_match), dias: globalErrors.best_match.length },
    }

    // Per city
    const citySlugs = Object.keys(cityErrors)
    const cityMaeList: CityMae[] = citySlugs.map(slug => {
      const ce = cityErrors[slug]
      const cityName = dedupedHistory.find((r: any) => r.slug === slug)?.ciudad ?? slug
      const nLive = cityNuestroLiveErrors[slug] ?? []

      const entries = [
        { key: 'nuestro', mae: mae(nLive), dias: nLive.length },
        { key: 'ecmwf', mae: mae(ce.ecmwf), dias: ce.ecmwf.length },
        { key: 'gfs', mae: mae(ce.gfs), dias: ce.gfs.length },
        { key: 'icon', mae: mae(ce.icon), dias: ce.icon.length },
        { key: 'best_match', mae: mae(ce.best_match), dias: ce.best_match.length },
      ]
      entries.sort((a, b) => a.mae - b.mae)
      const best = entries[0]?.key ?? 'nuestro'

      return {
        slug,
        nombre: cityName,
        nuestro: { mae: mae(nLive), dias: nLive.length },
        ecmwf: { mae: mae(ce.ecmwf), dias: ce.ecmwf.length },
        gfs: { mae: mae(ce.gfs), dias: ce.gfs.length },
        icon: { mae: mae(ce.icon), dias: ce.icon.length },
        best_match: { mae: mae(ce.best_match), dias: ce.best_match.length },
        mejor: best,
      }
    }).sort((a, b) => {
      // Cities where NOSOTROS wins first
      const winA = a.mejor === 'nuestro' ? 0 : 1
      const winB = b.mejor === 'nuestro' ? 0 : 1
      if (winA !== winB) return winA - winB
      return a.nuestro.mae - b.nuestro.mae
    })

    // Total unique dates
    const totalDias = fechasList.length

    return res.status(200).json({
      global: globalMae,
      por_ciudad: cityMaeList,
      total_dias: totalDias,
      total_registros: dedupedHistory.length,
    })
  } catch (error) {
    console.error('[vs-rivales-mae] Error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
