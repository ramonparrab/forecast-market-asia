import { NextApiRequest, NextApiResponse } from 'next'
import { getServiceClient } from '@/lib/supabase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const client = getServiceClient()
    if (!client) return res.status(500).json({ error: 'No Supabase client' })

    // Remove duplicates keeping latest id per (slug, fecha_objetivo)
    const { data: all } = await (client as any)
      .from('forecast_history')
      .select('id, slug, fecha_objetivo')
      .order('id', { ascending: true })

    if (!all || all.length === 0) return res.status(200).json({ message: 'No records', deleted: 0 })

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

    // Try adding unique constraint via raw SQL (requires `pgcrypto` or direct SQL access)
    const { error: sqlError } = await (client as any).rpc('exec_sql', {
      sql: `ALTER TABLE forecast_history ADD CONSTRAINT IF NOT EXISTS uq_forecast_history_slug_fecha UNIQUE (slug, fecha_objetivo);`,
    })

    const constraintApplied = !sqlError

    return res.status(200).json({
      status: 'ok',
      records_antes: all.length,
      duplicados_eliminados: deleted,
      constraint_unique: constraintApplied ? 'aplicada' : 'no aplicada (ejecutar SQL manual en Supabase)',
      sql_manual: constraintApplied ? undefined : `
-- Migration 004: Ejecutar en Supabase SQL Editor:
DELETE FROM forecast_history f1 USING forecast_history f2
WHERE f1.id < f2.id AND f1.slug = f2.slug AND f1.fecha_objetivo = f2.fecha_objetivo;
ALTER TABLE forecast_history ADD CONSTRAINT uq_forecast_history_slug_fecha UNIQUE (slug, fecha_objetivo);
CREATE INDEX IF NOT EXISTS idx_forecast_history_slug_fecha ON forecast_history(slug, fecha_objetivo DESC);
      `.trim(),
    })
  } catch (error) {
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
