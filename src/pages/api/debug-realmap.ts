import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const client = createClient(supabaseUrl, supabaseKey)

  // 1) Same query as decision-tab realMap (after fix)
  const since90 = new Date()
  since90.setDate(since90.getDate() - 90)
  const since90Str = since90.toISOString().slice(0, 10)

  const { data: fhRecords, error: e1 } = await client
    .from('forecast_history' as any)
    .select('id, slug, fecha_objetivo, temp_real, temp_corregida, run_type')
    .not('temp_real', 'is', null as any)
    .gte('fecha_objetivo', since90Str)

  const all = (fhRecords as any[]) ?? []
  const aug26 = all.filter(r => r.fecha_objetivo === '2026-08-26')
  const withCorr = all.filter(r => r.temp_corregida !== null)
  const withoutCorr = all.filter(r => r.temp_corregida === null || r.temp_corregida === undefined)

  // 2) Precision query simulation
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const { data: precRecords, error: e2 } = await client
    .from('forecast_history' as any)
    .select('slug, fecha_objetivo, temp_corregida, temp_real, error')
    .not('temp_real', 'is', null)
    .not('temp_corregida', 'is', null)
    .gte('fecha_objetivo', cutoff.toISOString().slice(0, 10))
    .order('fecha_objetivo', { ascending: true } as any)

  return res.status(200).json({
    // RealMap query results
    totalWithReal_90d: all.length,
    aug26Records: aug26.length,
    aug26Data: aug26.map(r => ({
      id: r.id, slug: r.slug, real: r.temp_real, corr: r.temp_corregida, run_type: r.run_type
    })),
    withCorregida: withCorr.length,
    withoutCorregida: withoutCorr.length,
    // Precision query
    precisionQueryCount: (precRecords as any[])?.length ?? 0,
    precisionError: e2?.message ?? null,
    precisionSample: ((precRecords as any[]) ?? []).slice(0, 3),
  })
}
