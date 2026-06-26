import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

/**
 * Debug: test Supabase DB connection and operations
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'not-set'
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'not-set'
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || 'not-set'

  // Test with anon key
  const client = createClient(url, anonKey)
  
  const results: any[] = []

  // Test 1: query backtest_bias
  try {
    const { data, error } = await client.from('backtest_bias' as any).select('*').limit(5)
    results.push({ test: 'query backtest_bias', data: data as any, error: error?.message })
  } catch (e: any) { results.push({ test: 'query backtest_bias', error: e.message }) }

  // Test 2: insert into backtest_bias
  try {
    const { data, error } = await client.from('backtest_bias' as any).upsert(
      { slug: 'debug-test', mes: 6, bias: 0.5, mae: 1.0, muestras: 5 },
      { onConflict: 'slug,mes' }
    ).select()
    results.push({ test: 'upsert backtest_bias', data: data as any, error: error?.message })
  } catch (e: any) { results.push({ test: 'upsert backtest_bias', error: e.message }) }

  // Test 3: clean up debug row
  try {
    await client.from('backtest_bias' as any).delete().eq('slug', 'debug-test')
  } catch {}

  return res.status(200).json({
    env: { url: url.slice(0, 20) + '...', anonKey: anonKey.slice(0, 10) + '...', serviceKey: serviceKey.slice(0, 10) + '...' },
    results,
  })
}
