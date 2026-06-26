import { NextApiRequest, NextApiResponse } from 'next'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * ONE-TIME endpoint: Ejecuta migraciones SQL en Supabase.
 * Visita GET /api/migrate para ejecutar.
 * Requiere SUPABASE_SERVICE_KEY en environment.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const connStr = process.env.SUPABASE_CONN_STRING
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  if (!connStr && !serviceKey) {
    return res.status(400).json({
      error: 'No database credentials. Set SUPABASE_CONN_STRING or SUPABASE_SERVICE_KEY env var.',
      help: 'Add to Vercel env: SUPABASE_CONN_STRING=postgresql://postgres:pass@db.dzgxnpazxcusbjbkpnqn.supabase.co:5432/postgres',
    })
  }

  try {
    // Read migration files
    const migration002 = readFileSync(join(process.cwd(), 'migration-002-backtest.sql'), 'utf8')
    const migration003 = readFileSync(join(process.cwd(), 'migration-003-backtest-bias.sql'), 'utf8')

    // We'll use pg module if available, otherwise fallback to supabase-js rpc
    let pg: any
    try {
      pg = require('pg')
    } catch {
      return res.status(500).json({
        error: 'pg module not available. Run: npm install pg',
        note: 'Will be available after next build deploy.',
      })
    }

    // Parse connection from service key or use direct connection string
    let connectionString = connStr
    if (!connectionString && serviceKey) {
      const ref = 'dzgxnpazxcusbjbkpnqn'
      connectionString = `postgresql://postgres:${encodeURIComponent(serviceKey)}@db.${ref}.supabase.co:5432/postgres`
    }

    const client = new pg.Client({ connectionString })
    await client.connect()

    // Run both migrations in a transaction
    const fullSql = migration002 + '\n' + migration003
    const result = await client.query(fullSql)
    await client.end()

    return res.status(200).json({
      status: 'ok',
      message: 'Migraciones ejecutadas exitosamente',
      tables: ['backtest_results', 'backtest_bias'],
      rows_affected: result?.rowCount ?? 0,
    })
  } catch (error: any) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
      hint: 'Asegúrate de que la IP de Vercel esté en allowed IPs de Supabase (Project Settings → Database → Network)',
    })
  }
}
