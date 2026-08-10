import { NextApiRequest, NextApiResponse } from 'next'
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

let cache: { ts: number; filas: RankingFila[] } | null = null
const TTL = 90 * 1000

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (cache && Date.now() - cache.ts < TTL) {
      return res.json({ filas: cache.filas, cache: true, generado: new Date(cache.ts).toISOString() })
    }

    const resultados = await Promise.allSettled(
      CIUDADES_ASIA.map(c => buildPlanData(c.slug, 10))
    )

    const filas: RankingFila[] = resultados
      .map((r, i) => {
        const c = CIUDADES_ASIA[i]
        if (r.status === 'rejected') {
          return { slug: c.slug, ciudad: c.nombre, error: String(r.reason?.message ?? r.reason) } as RankingFila
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