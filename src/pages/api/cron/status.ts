import { NextApiRequest, NextApiResponse } from 'next'
import { getRecentCronRuns } from '@/lib/supabase'

/**
 * GET /api/cron/status — salud de los cron jobs.
 *
 * Lee cron_log (migration-008) y resume las últimas corridas de cada job:
 *   - daily: 10PM y 11PM Caracas (única fuente automática de datos)
 *   - backfill-reales: recuperaciones manuales
 *
 * Cada corrida reporta status ok | partial | error | running + detalles por paso.
 * Si la tabla cron_log no existe (migration-008 sin aplicar) responde con aviso.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const runs = await getRecentCronRuns(30)

    if (runs.length === 0) {
      return res.status(200).json({
        status: 'unknown',
        message: 'Sin registros en cron_log. ¿Está aplicada migration-008-cron-log.sql? Mientras tanto, los crons funcionan igual (el log es solo observabilidad).',
      })
    }

    // Última corrida por job y por run_type
    const lastByJob: Record<string, any> = {}
    const lastDailyByRun: Record<string, any> = {}
    for (const run of runs) {
      if (run.job === 'daily') {
        if (run.run_type && !lastDailyByRun[run.run_type]) lastDailyByRun[run.run_type] = run
      }
      if (!lastByJob[run.job]) lastByJob[run.job] = run
    }

    // Hoy (UTC) — ¿ya corrieron los 2 crons de hoy?
    const today = new Date().toISOString().slice(0, 10)
    const dailyToday = runs.filter(r => r.job === 'daily' && r.started_at?.slice(0, 10) === today)

    // ¿Faltan reales del día asiático culminado? (se registran en la corrida 10PM)
    const realDay = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)
    const last10pm = lastDailyByRun['10PM']
    const realesOk = last10pm?.status === 'ok' || last10pm?.status === 'partial'
      ? (last10pm.details as any)?.reales?.actualizadas ?? null
      : null

    return res.status(200).json({
      status: 'ok',
      hoy: {
        fecha_utc: today,
        crons_daily_hoy: dailyToday.map((r: any) => ({
          run_type: r.run_type, status: r.status, started_at: r.started_at, duracion_ms: (r.details as any)?.duration_ms,
        })),
        dia_real_culminado: realDay,
      },
      ultima_corrida_por_horario: Object.fromEntries(
        Object.entries(lastDailyByRun).map(([k, v]: [string, any]) => [k, {
          status: v.status,
          started_at: v.started_at,
          finished_at: v.finished_at,
          ciudades: v.details?.forecast?.cities,
          degradadas_twc: v.details?.forecast?.degraded_twc,
          reales_actualizadas: v.details?.reales?.actualizadas,
          errores: v.details?.errors?.slice(0, 5),
        }])
      ),
      ultimo_backfill: lastByJob['backfill-reales']
        ? {
            status: lastByJob['backfill-reales'].status,
            started_at: lastByJob['backfill-reales'].started_at,
            actualizados: lastByJob['backfill-reales'].details?.actualizados,
            snapshots: lastByJob['backfill-reales'].details?.snapshots_actualizados,
          }
        : null,
      recientes: runs.slice(0, 15).map(r => ({
        id: r.id, job: r.job, run_type: r.run_type, status: r.status,
        started_at: r.started_at, finished_at: r.finished_at,
      })),
    })
  } catch (error) {
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
