import { NextApiRequest, NextApiResponse } from 'next'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * ONE-TIME endpoint: Ejecuta migration-006 (lock 10PM/11PM forecasts).
 * GET /api/migrate-006
 * Requiere SUPABASE_CONN_STRING o SUPABASE_SERVICE_KEY en environment.
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
    let pg: any
    try {
      pg = require('pg')
    } catch {
      return res.status(500).json({
        error: 'pg module not available. Run: npm install pg',
      })
    }

    let connectionString = connStr
    if (!connectionString && serviceKey) {
      const ref = 'dzgxnpazxcusbjbkpnqn'
      connectionString = `postgresql://postgres:${encodeURIComponent(serviceKey)}@db.${ref}.supabase.co:5432/postgres`
    }

    const client = new pg.Client({ connectionString })
    await client.connect()

    // Read migration SQL
    const sql = readFileSync(join(process.cwd(), 'migration-006-forecast-lock-10pm-11pm.sql'), 'utf8')

    // Execute each statement separately to handle DDL + DML mix
    // Split on empty lines followed by non-comment lines (simple statement splitter)
    const statements = sql
      .split(';\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    const results: string[] = []
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i]
      if (stmt.length < 5) continue // skip whitespace-only
      // Skip pure comment blocks
      const codeLines = stmt.split('\n').filter(l => !l.trim().startsWith('--') && l.trim().length > 0)
      if (codeLines.length === 0) continue

      try {
        const r = await client.query(stmt)
        if (r.rowCount !== null) {
          results.push(`[${i}] OK (${r.rowCount} rows)`)
        } else {
          results.push(`[${i}] OK (DDL)`)
        }
      } catch (stmtErr: any) {
        // Some statements like CREATE IF NOT EXIST may fail gracefully
        results.push(`[${i}] ${stmtErr.message?.slice(0, 120)}`)
      }
    }

    // Verification queries
    const verify1 = await client.query('SELECT run_type, COUNT(*) FROM forecast_history GROUP BY run_type ORDER BY run_type')
    const verify2 = await client.query('SELECT COUNT(*) as total FROM forecast_snapshot')
    const verify3 = await client.query("SELECT conname FROM pg_constraint WHERE conname = 'uq_forecast_history_slug_fecha_run'")

    await client.end()

    return res.status(200).json({
      status: 'ok',
      message: 'Migration 006 ejecutada',
      steps: results,
      verification: {
        forecast_history_by_run_type: verify1.rows,
        forecast_snapshot_count: verify2.rows[0]?.total ?? 0,
        new_constraint_exists: verify3.rows.length > 0,
      },
    })
  } catch (error: any) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
      hint: 'Asegurate de que la IP de Vercel este en allowed IPs de Supabase',
    })
  }
}
