import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''

  const baseUrl = url.replace(/\/$/, '')
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    'Content-Type': 'application/json',
  }

  // Test the forecast_history table (known to work)
  const testUrl = `${baseUrl}/rest/v1/forecast_history?limit=1`
  let testResult: any
  try {
    const r = await fetch(testUrl, { headers })
    const text = await r.text()
    testResult = { status: r.status, body: text.slice(0, 200) }
  } catch (e: any) {
    testResult = { error: e.message }
  }

  return res.status(200).json({
    url,
    anonKey: anonKey.slice(0, 20) + '...',
    serviceKeyExists: serviceKey.length > 0,
    baseUrl,
    testUrl,
    testResult,
  })
}
