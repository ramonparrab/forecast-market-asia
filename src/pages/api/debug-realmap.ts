import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const client = createClient(supabaseUrl, supabaseKey)

  // Same query as decision-tab
  const { data: fhRecords, error } = await client
    .from('forecast_history' as any)
    .select('id, slug, fecha_objetivo, temp_real, run_type, created_at')
    .not('temp_real', 'is', null as any)

  if (error) return res.status(500).json({ error: error.message })

  const all = (fhRecords as any[]) ?? []
  const aug26 = all.filter(r => r.fecha_objetivo === '2026-08-26')

  return res.status(200).json({
    totalWithReal: all.length,
    aug26Records: aug26.length,
    aug26Data: aug26.map(r => ({
      id: r.id,
      slug: r.slug,
      fecha_objetivo: r.fecha_objetivo,
      temp_real: r.temp_real,
      run_type: r.run_type,
      created_at: r.created_at,
    })),
    // Also show records where temp_real IS null for aug 26 (to see the full picture)
  })
}
