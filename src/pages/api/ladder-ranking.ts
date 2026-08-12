import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from '@/lib/cities'
import { buildPlanData } from './ladder-betting'

export interface RankingFila {
  slug: string
  ciudad: string
  regimen: string
  modelo: string
  hora: string | null
  mae_combo: number | null
  hit_pronostico: number
  valor_hoy: number | null
  escalones: number
  inversion: number
  probabilidad_ganar: number
  ev: number
  ev_dolar: number
  score: number
  error?: string
}

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const DIAS_RUNS = 55

let cache: { ts: number; filas: RankingFila[] } | null = null
const TTL = 120 * 1000

export const maxDuration = 120

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300')
  try {
    if (cache && Date.now() - cache.ts < TTL) {
      return res.json({ filas: cache.filas, cache: true, generado: new Date(cache.ts).toISOString() })
    }
    if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })

    const client = createClient(supabaseUrl, supabaseKey)
    const ahora = new Date()
    const startHour = new Date(ahora.getTime() - DIAS_RUNS * 24 * 60 * 60 * 1000)

    // Una sola lectura compartida para TODAS las ciudades (daily_runs es la query pesada, ~8s)
    const [fhAll, runsAll, pendingAll] = await Promise.all([
      client
        .from('forecast_history' as any)
        .select('slug, fecha_objetivo, temp_pronosticada, temp_corregida, temp_real, error')
        .not('temp_real', 'is', null)
        .order('fecha_objetivo', { ascending: true } as any),
      client
        .from('daily_runs' as any)
        .select('fecha_ejecucion, fecha_objetivo, resultados')
        .gte('fecha_ejecucion', startHour.toISOString()),
      client
        .from('forecast_history' as any)
        .select('id, fecha_ejecucion, fecha_objetivo, slug, temp_pronosticada, temp_corregida, temp_real')
        .is('temp_real', null)
        .order('fecha_ejecucion', { ascending: false } as any),
    ])

    const pendPorSlug: Record<string, any> = {}
    for (const r of (pendingAll.data || []) as any[]) {
      const prev = pendPorSlug[r.slug]
      if (!prev || String(r.fecha_ejecucion) > String(prev.fecha_ejecucion)) pendPorSlug[r.slug] = r
    }
    const fhPorSlug: Record<string, any[]> = {}
    for (const r of (fhAll.data || []) as any[]) {
      if (!fhPorSlug[r.slug]) fhPorSlug[r.slug] = []
      fhPorSlug[r.slug].push(r)
    }

    const resultados = await Promise.allSettled(
      CIUDADES_ASIA.map(c => {
        const pending = pendPorSlug[c.slug]
        if (!pending) return Promise.reject(new Error('sin pronóstico pendiente'))
        return buildPlanData(c.slug, 10, { pending, history: fhPorSlug[c.slug] || [], runs: (runsAll.data || []) as any[] })
      })
    )

    const filas: RankingFila[] = resultados
      .map((r, i) => {
        const c = CIUDADES_ASIA[i]
        if (r.status === 'rejected') {
          return { slug: c.slug, ciudad: c.nombre, error: String((r.reason as any)?.message ?? r.reason) } as RankingFila
        }
        const d = r.value as any
        const plan = d.plan as any
        const hit = Number((d.hist_error_entero as any)?.['0'] ?? 0) / 100
        const inversion = plan?.inversion ?? 0
        const ev = plan?.ev ?? 0
        const evDolar = inversion > 0 ? ev / inversion : 0
        const score = round4(hit * (1 + evDolar))
        const keyGanador = (d.modelo_ganador === 'KALMAN' ? 'kal' : 'mc') + '_' + (d.hora_ganadora === '10PM' ? '10pm' : d.hora_ganadora === '11PM' ? '11pm' : '')
        return {
          slug: c.slug,
          ciudad: c.nombre,
          regimen: d.regimen,
          modelo: d.modelo_ganador,
          hora: d.hora_ganadora,
          mae_combo: keyGanador && d.combos_mae?.[keyGanador] != null ? Number(d.combos_mae[keyGanador]) : null,
          hit_pronostico: round4(hit),
          valor_hoy: d.valor_hoy_modelo != null ? Number(d.valor_hoy_modelo) : null,
          escalones: plan?.escalones?.length ?? 0,
          inversion: round2(inversion),
          probabilidad_ganar: plan?.probabilidad_ganar ?? 0,
          ev: round2(ev),
          ev_dolar: round2(evDolar),
          score,
        } as RankingFila
      })
      .sort((a, b) => {
        if (a.error) return 1
        if (b.error) return -1
        if (a.ev !== b.ev) return b.ev - a.ev
        return b.probabilidad_ganar - a.probabilidad_ganar
      })

    cache = { ts: Date.now(), filas }
    return res.json({ filas, cache: false, generado: new Date().toISOString() })
  } catch (error) {
    console.error('[ladder-ranking]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}