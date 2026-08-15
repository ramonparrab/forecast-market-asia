import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = createClient(supabaseUrl, supabaseKey)
    const slug = (req.query.slug as string) || 'seoul'
    const fecha = (req.query.fecha as string) || '2026-08-10'

    // 1) Check daily_runs for this date
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, resultados')
      .eq('fecha_objetivo', fecha)
      .order('fecha_ejecucion', { ascending: false } as any)
      .limit(2)

    const debug: any = { fecha, slug, daily_runs_found: (runs as any[])?.length || 0 }

    for (const run of (runs as any[]) ?? []) {
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      const cityData = parsed.find((c: any) => c.slug === slug)
      if (!cityData) {
        debug.city_found = false
        continue
      }
      const f = cityData.forecast || {}
      debug.city_found = true
      debug.fecha_ejecucion = run.fecha_ejecucion
      debug.forecast_keys = Object.keys(f)
      debug.modelo_activo = f.modelo_activo
      debug.temp_corregida = f.temp_corregida
      debug.temp_corregida_alt = f.temp_corregida_alt
      debug.temp_corregida_base = f.temp_corregida_base
      debug.modelo_alt = f.modelo_alt
    }

    // 2) Check walkForwardErrors availability from forecast_history
    const { data: fhRecords } = await client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, error, temp_real')
      .eq('slug', slug)
      .not('error', 'is', null as any)
      .order('fecha_objetivo', { ascending: true } as any)
      .limit(5000)

    const items = (fhRecords as any[]) ?? []
    debug.fh_records = items.length
    debug.fh_fechas = items.map(r => r.fecha_objetivo).filter((v, i, a) => a.indexOf(v) === i)
    
    // Walk-forward errors for the requested date
    const beforeDate = items.filter(r => r.fecha_objetivo < fecha)
    debug.walkforward_count = beforeDate.length
    debug.walkforward_errors = beforeDate.map(r => r.error)
    debug.walkforward_mean = beforeDate.length > 0
      ? (beforeDate.reduce((s, r) => s + r.error, 0) / beforeDate.length).toFixed(4)
      : null

    // 3) Check forecast_snapshot
    const { data: snap } = await client
      .from('forecast_snapshot' as any)
      .select('*')
      .eq('slug', slug)
      .eq('fecha_objetivo', fecha)
      .limit(2)
    debug.snapshot = (snap as any[])?.map(s => ({
        modelo_ganador: s.modelo_ganador,
        temp_corregida: s.temp_corregida,
        modelo_10pm: s.modelo_10pm,
        modelo_11pm: s.modelo_11pm,
        temp_10pm: s.temp_10pm,
        temp_11pm: s.temp_11pm,
        run_type_ganadora: s.run_type_ganadora,
      }))

    return res.status(200).json(debug)
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message })
  }
}
