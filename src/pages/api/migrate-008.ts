import { NextApiRequest, NextApiResponse } from 'next'

/**
 * ONE-TIME endpoint (TEMPORAL): Ejecuta migration-008 (cron_log).
 * GET /api/migrate-008 con header Authorization: Bearer <CRON_SECRET>
 * Conexión: SUPABASE_CONN_STRING o SUPABASE_SERVICE_KEY (patrón migrate-006).
 * ⚠️ BORRAR este archivo después de aplicar la migration.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' })

  const expectedSecret = process.env.CRON_SECRET || ''
  const got = String(req.headers.authorization || '').replace('Bearer ', '')
  if (!expectedSecret || got !== expectedSecret) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const connStr = process.env.SUPABASE_CONN_STRING
  const serviceKey = process.env.SUPABASE_SERVICE_KEY

  if (!connStr && !serviceKey) {
    return res.status(400).json({ error: 'Sin credenciales de BD (SUPABASE_CONN_STRING o SUPABASE_SERVICE_KEY).' })
  }

  // migration-008-cron-log.sql (embebido — el bundle serverless no incluye .sql de la raíz)
  const SQL = `
CREATE TABLE IF NOT EXISTS public.cron_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job TEXT NOT NULL,
  run_type TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  details JSONB
);
CREATE INDEX IF NOT EXISTS idx_cron_log_job_time
  ON public.cron_log (job, started_at DESC);
ALTER TABLE public.cron_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cron_log_select_public" ON public.cron_log;
CREATE POLICY "cron_log_select_public"
  ON public.cron_log FOR SELECT
  USING (true);
`

  try {
    const pg = require('pg')

    let connectionString = connStr
    if (!connectionString && serviceKey) {
      const ref = 'dzgxnpazxcusbjbkpnqn'
      connectionString = `postgresql://postgres:${encodeURIComponent(serviceKey)}@db.${ref}.supabase.co:5432/postgres`
    }

    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    await client.connect()

    const statements = SQL
      .split(';\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    const results: string[] = []
    for (const stmt of statements) {
      const codeLines = stmt.split('\n').filter(l => !l.trim().startsWith('--') && l.trim().length > 0)
      if (codeLines.length === 0) continue
      try {
        const r = await client.query(stmt)
        results.push(`OK${r.rowCount !== null ? ` (${r.rowCount} rows)` : ' (DDL)'}`)
      } catch (stmtErr: any) {
        results.push(`ERROR: ${stmtErr.message?.slice(0, 150)}`)
      }
    }

    const verify = await client.query("SELECT to_regclass('public.cron_log') AS tabla, count(*) AS columnas FROM information_schema.columns WHERE table_name='cron_log'")
    const policies = await client.query("SELECT policyname FROM pg_policies WHERE tablename='cron_log'")

    await client.end()

    return res.status(200).json({
      status: 'ok',
      message: 'Migration 008 (cron_log) ejecutada',
      steps: results,
      verification: {
        tabla_existe: Boolean(verify.rows[0]?.tabla),
        columnas: Number(verify.rows[0]?.columnas ?? 0),
        policies: policies.rows.map((r: any) => r.policyname),
      },
    })
  } catch (error: any) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
      hint: 'La conexión puede requerir IPv6 o la contraseña real de la BD (dashboard → Settings → Database).',
    })
  }
}
