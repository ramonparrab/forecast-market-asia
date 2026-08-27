import { NextApiRequest, NextApiResponse } from 'next'
import { getServiceClient } from '@/lib/supabase'

export const config = { maxDuration: 30 }

// One-time migration: add run_type column to daily_runs
// Call: GET /api/run-migration-005
export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
  const serviceClient = getServiceClient()
  if (!serviceClient) return res.status(500).json({ error: 'No service client' })

  // Step 1: Create a temporary function that executes DDL
  const createFuncSQL = `
    CREATE OR REPLACE FUNCTION _tmp_migration_005()
    RETURNS text AS $$
    BEGIN
      ALTER TABLE daily_runs ADD COLUMN IF NOT EXISTS run_type VARCHAR(10);
      CREATE INDEX IF NOT EXISTS idx_daily_runs_run_type ON daily_runs(run_type);
      RETURN 'OK';
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `

  const { error: err1 } = await (serviceClient as any)
    .from('daily_runs')
    .select('run_type')
    .limit(1)

  // If column exists already, just return
  if (!err1 || !err1.message.includes('does not exist')) {
    return res.status(200).json({ status: 'column_exists', message: 'run_type column already exists' })
  }

  return res.status(500).json({
    error: 'run_type column does not exist. Run this SQL in Supabase SQL Editor:\n\nALTER TABLE daily_runs ADD COLUMN IF NOT EXISTS run_type VARCHAR(10);\nCREATE INDEX IF NOT EXISTS idx_daily_runs_run_type ON daily_runs(run_type);',
    needs_manual: true,
    details: err1?.message,
  })
}
