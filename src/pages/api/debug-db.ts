import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

  const results: any[] = []

  // Test with anon key - query forecast_history
  const client = createClient(url, anonKey)
  const { data: fhData, error: fhErr } = await client.from('forecast_history' as any).select('id').limit(1)
  results.push({ test: 'forecast_history select', error: fhErr?.message || null, data: fhData ? 'ok' : 'empty' })

  // Test with anon key - query backtest_bias
  const { data: bbData, error: bbErr } = await client.from('backtest_bias' as any).select('*')
  results.push({ test: 'backtest_bias select', error: bbErr?.message || null, rows: (bbData as any[])?.length ?? 0 })

  // Test with anon key - insert backtest_bias
  const { error: insErr } = await client.from('backtest_bias' as any).upsert({
    slug: 'debug-test', mes: 6, bias: 0.5, mae: 1.0, muestras: 5, fecha_actualizacion: new Date().toISOString(),
  }, { onConflict: 'slug,mes' })
  results.push({ test: 'backtest_bias upsert', error: insErr?.message || null })

  // Cleanup
  await client.from('backtest_bias' as any).delete().eq('slug', 'debug-test')

  // Test with service key
  const svc = createClient(url, serviceKey)
  const { error: svcErr, data: svcData } = await svc.from('backtest_bias' as any).select('*').limit(1)
  results.push({ test: 'service key select', error: svcErr?.message || null, data: svcData ? 'ok' : 'empty' })

  return res.status(200).json({ url, results })
}
