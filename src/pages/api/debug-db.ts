import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

  const results: any[] = []

  // Test with anon key - query
  try {
    const client = createClient(url, anonKey)
    const { data, error, count } = await client
      .from('backtest_bias' as any)
      .select('*', { count: 'exact', head: true })
    results.push({ test: 'query anon key', error: error?.message, count, data })
  } catch (e: any) { results.push({ test: 'query anon key', error: e.message }) }

  // Test with anon key - insert
  try {
    const client = createClient(url, anonKey)
    const { data, error } = await client
      .from('backtest_bias' as any)
      .insert({ slug: 'debug-test', mes: 6, bias: 0.5, mae: 1.0, muestras: 5 })
    results.push({ test: 'insert anon key', error: error?.message, data })
  } catch (e: any) { results.push({ test: 'insert anon key', error: e.message }) }

  // Test with service key - query
  try {
    const client = createClient(url, serviceKey)
    const { data, error } = await client
      .from('backtest_bias' as any)
      .select('*')
      .limit(3)
    results.push({ test: 'query service key', error: error?.message, count: (data as any)?.length })
  } catch (e: any) { results.push({ test: 'query service key', error: e.message }) }

  // Test with service key - upsert
  try {
    const client = createClient(url, serviceKey)
    const { data, error } = await client
      .from('backtest_bias' as any)
      .upsert({ slug: 'debug-test', mes: 6, bias: 0.5, mae: 1.0, muestras: 5 }, { onConflict: 'slug,mes' })
    results.push({ test: 'upsert service key', error: error?.message, data })
  } catch (e: any) { results.push({ test: 'upsert service key', error: e.message }) }

  // Cleanup
  try {
    const client = createClient(url, serviceKey)
    await client.from('backtest_bias' as any).delete().eq('slug', 'debug-test')
  } catch {}

  // Also check if forecast_history table works
  try {
    const client = createClient(url, anonKey)
    const { data, error } = await client
      .from('forecast_history' as any)
      .select('id')
      .limit(1)
    results.push({ test: 'forecast_history query', error: error?.message, hasData: (data as any)?.length > 0 })
  } catch (e: any) { results.push({ test: 'forecast_history query', error: e.message }) }

  return res.status(200).json({ results })
}
