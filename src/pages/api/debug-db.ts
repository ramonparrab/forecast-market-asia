import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

  const results: any[] = []

  // Direct REST call to bypass supabase-js
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  }
  const baseUrl = url.replace(/\/$/, '')

  // Test 1: GET backtest_bias
  try {
    const r = await fetch(`${baseUrl}/rest/v1/backtest_bias?limit=1`, { headers })
    const text = await r.text()
    results.push({ test: 'GET /backtest_bias', status: r.status, body: text.slice(0, 100) })
  } catch (e: any) { results.push({ test: 'GET /backtest_bias', error: e.message }) }

  // Test 2: POST to backtest_bias
  try {
    const r = await fetch(`${baseUrl}/rest/v1/backtest_bias`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: 'debug-curl', mes: 6, bias: 0.5, mae: 1.0, muestras: 5 }),
    })
    const text = await r.text()
    results.push({ test: 'POST /backtest_bias', status: r.status, body: text.slice(0, 100) })
  } catch (e: any) { results.push({ test: 'POST /backtest_bias', error: e.message }) }

  // Test 3: GET forecast_history (known working table)
  try {
    const r = await fetch(`${baseUrl}/rest/v1/forecast_history?limit=1`, { headers })
    const text = await r.text()
    results.push({ test: 'GET /forecast_history', status: r.status, body: text.slice(0, 100) })
  } catch (e: any) { results.push({ test: 'GET /forecast_history', error: e.message }) }

  // Cleanup
  try {
    await fetch(`${baseUrl}/rest/v1/backtest_bias?slug=eq.debug-curl`, { method: 'DELETE', headers })
  } catch {}

  return res.status(200).json({ url: url.slice(0, 30) + '...', results })
}
