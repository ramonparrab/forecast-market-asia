-- Migration 008: cron_log — registro de salud de los cron jobs
--
-- PROBLEMA: los crons responden 200 "ok" aunque los guardados en Supabase
-- fallen silenciosamente (saveDailyRun/saveForecastRecords solo hacen
-- console.error). No hay forma de saber si un cron registró data sin
-- revisar huecos en la UI.
--
-- SOLUCIÓN: cada ejecución de /api/cron/daily y /api/cron/backfill-reales
-- escribe una fila en cron_log con estado final (ok | partial | error) y
-- detalles por paso. /api/cron/status expone la salud de los últimos días.

CREATE TABLE IF NOT EXISTS public.cron_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job TEXT NOT NULL,                       -- 'daily' | 'backfill-reales'
  run_type TEXT,                           -- '10PM' | '11PM' | NULL (backfill)
  status TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'ok' | 'partial' | 'error'
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  details JSONB                            -- pasos, conteos y errores por paso
);

-- Índice para consulta de salud (últimas corridas por job)
CREATE INDEX IF NOT EXISTS idx_cron_log_job_time
  ON public.cron_log (job, started_at DESC);

-- RLS: lectura pública (el dashboard lee el estado), escritura solo service_role
ALTER TABLE public.cron_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cron_log_select_public" ON public.cron_log;
CREATE POLICY "cron_log_select_public"
  ON public.cron_log FOR SELECT
  USING (true);

-- Nota: INSERT/UPDATE quedan restringidos a service_role (SUPABASE_SERVICE_KEY),
-- que es el único que deben usar los crons tras migration-005-security-rls.
