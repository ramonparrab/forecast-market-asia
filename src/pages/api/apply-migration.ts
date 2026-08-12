import { NextApiRequest, NextApiResponse } from 'next'
import { getServiceClient } from '@/lib/supabase'

export const config = {
  maxDuration: 30,
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const results: string[] = []

  try {
    // Step 1: Remove duplicates via Supabase REST
    const client = getServiceClient()
    if (!client) return res.status(500).json({ error: 'No Supabase client' })

    const { data: all } = await (client as any)
      .from('forecast_history')
      .select('id, slug, fecha_objetivo')
      .order('id', { ascending: true })

    if (!all || all.length === 0) {
      return res.status(200).json({ message: 'No records', deleted: 0 })
    }

    const seen = new Map<string, number>()
    let deleted = 0
    for (const r of all as any[]) {
      const key = `${r.slug}|${r.fecha_objetivo}`
      if (seen.has(key)) {
        await (client as any).from('forecast_history').delete().eq('id', r.id)
        deleted++
      } else {
        seen.set(key, r.id)
      }
    }
    results.push(`Duplicados eliminados: ${deleted}`)

    // Step 2: Try direct Postgres connection for UNIQUE constraint
    // (pg module is available in node_modules on Vercel)
    try {
      const { Client } = require('pg')
      const serviceKey = process.env.SUPABASE_SERVICE_KEY || ''
      const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace('https://', '').replace('.supabase.co', '')

      if (serviceKey && ref) {
        // Try common pooler regions
        const regions = [
          'aws-0-us-east-1',
          'aws-0-us-east-2',
          'aws-0-us-west-1',
          'aws-0-eu-west-1',
          'aws-0-eu-central-1',
          'aws-0-ap-southeast-1',
          'us-east-1',
        ]

        for (const region of regions) {
          const hosts = [
            `${region}.pooler.supabase.com:6543`,
            `${region}.pooler.supabase.com:5432`,
          ]
          for (const hostPort of hosts) {
            try {
              const [host, port] = hostPort.split(':')
              const pgClient = new Client({
                host,
                port: parseInt(port),
                user: `postgres.${ref}`,
                password: serviceKey,
                database: 'postgres',
                ssl: { rejectUnauthorized: false },
                connectionTimeoutMillis: 5000,
              })
              await pgClient.connect()
              await pgClient.query(
                'ALTER TABLE forecast_history ADD CONSTRAINT IF NOT EXISTS uq_forecast_history_slug_fecha UNIQUE (slug, fecha_objetivo)'
              )
              results.push(`CONSTRAINT applied via ${host}:${port}`)
              await pgClient.query(
                'CREATE INDEX IF NOT EXISTS idx_forecast_history_slug_fecha ON forecast_history(slug, fecha_objetivo DESC)'
              )
              results.push('INDEX created')
              const verified = await pgClient.query(
                "SELECT conname FROM pg_constraint WHERE conname = 'uq_forecast_history_slug_fecha'"
              )
              results.push(`Verified: ${JSON.stringify(verified.rows)}`)
              await pgClient.end()
              return res.status(200).json({ status: 'ok', results })
            } catch {
              // try next host
            }
          }
        }
        results.push('No pooler connection worked - run SQL manually in Supabase dashboard')
      } else {
        results.push('Missing SUPABASE_SERVICE_KEY or URL')
      }
    } catch (e: any) {
      results.push(`pg module error: ${e.message}`)
    }

    return res.status(200).json({
      status: 'partial',
      results,
      sql_manual: `ALTER TABLE forecast_history ADD CONSTRAINT IF NOT EXISTS uq_forecast_history_slug_fecha UNIQUE (slug, fecha_objetivo);
CREATE INDEX IF NOT EXISTS idx_forecast_history_slug_fecha ON forecast_history(slug, fecha_objetivo DESC);`,
    })
  } catch (error) {
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
