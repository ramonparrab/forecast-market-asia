-- Migration 007: Add unique constraint to daily_runs for UPSERT
-- Allows 10PM and 11PM runs to coexist, with upsert on re-run.
-- Execute in Supabase SQL Editor.

-- Clean duplicates: keep latest id per (fecha_objetivo, run_type)
DELETE FROM daily_runs d1
USING daily_runs d2
WHERE d1.id < d2.id
  AND d1.fecha_objetivo = d2.fecha_objetivo
  AND COALESCE(d1.run_type, '') = COALESCE(d2.run_type, '');

-- Unique constraint for upsert
ALTER TABLE daily_runs
  ADD CONSTRAINT uq_daily_runs_fecha_runtype
  UNIQUE (fecha_objetivo, run_type);