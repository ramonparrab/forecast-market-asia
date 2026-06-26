import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { DailyAnalysis, CityAnalysis, BetRecommendation } from '@/types'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const fecha = req.query.fecha as string
  const action = req.query.action as string

  if (action === 'dates') {
    // Return list of available dates
    const client = createClient(supabaseUrl, supabaseKey)
    const { data, error } = await client
      .from('daily_runs' as any)
      .select('fecha_objetivo')
      .order('fecha_objetivo', { ascending: false } as any)
      .limit(90)

    if (error) return res.status(500).json({ error: error.message })
    const dates: string[] = []
    for (const r of (data as any[]) ?? []) {
      if (!dates.includes(r.fecha_objetivo)) dates.push(r.fecha_objetivo)
    }
    return res.status(200).json({ dates })
  }

  if (!fecha) return res.status(400).json({ error: 'Se requiere ?fecha=YYYY-MM-DD' })

  const client = createClient(supabaseUrl, supabaseKey)
  const { data, error } = await client
    .from('daily_runs' as any)
    .select('*')
    .eq('fecha_objetivo', fecha)
    .order('fecha_ejecucion', { ascending: false } as any)
    .limit(1)

  if (error) return res.status(500).json({ error: error.message })
  if (!data || (data as any[]).length === 0) {
    return res.status(404).json({ error: `No hay pronóstico guardado para ${fecha}` })
  }

  const row = (data as any[])[0]

  let resultados: CityAnalysis[]
  let recomendaciones: BetRecommendation[]

  try {
    resultados = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : row.resultados
    recomendaciones = typeof row.recomendaciones === 'string' ? JSON.parse(row.recomendaciones) : row.recomendaciones
  } catch {
    return res.status(500).json({ error: 'Error parsing saved forecast data' })
  }

  const analysis: DailyAnalysis = {
    fecha: row.fecha_ejecucion,
    fecha_objetivo: row.fecha_objetivo,
    message: `Pronóstico histórico del ${new Date(row.fecha_ejecucion).toLocaleDateString('es-ES', { timeZone: 'America/Caracas' })}`,
    cities: resultados,
    recommendations: recomendaciones,
    total_allocated: row.total_asignado ?? 0,
    global_metrics: null,
    arbitrage_alerts: [],
  }

  return res.status(200).json(analysis)
}
