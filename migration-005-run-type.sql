-- Migration 005: Add run_type column to daily_runs
-- Distinguishes 10PM vs 11PM Caracas runs
-- Execute in Supabase SQL Editor

ALTER TABLE daily_runs ADD COLUMN IF NOT EXISTS run_type VARCHAR(10);

-- Index for faster queries by run_type
CREATE INDEX IF NOT EXISTS idx_daily_runs_run_type ON daily_runs(run_type);

-- Backfill existing records based on fecha_ejecucion
-- 10PM Caracas = 02:00 UTC, 11PM Caracas = 03:00 UTC
UPDATE daily_runs
SET run_type = CASE
  WHEN EXTRACT(HOUR FROM fecha_ejecucion AT TIME ZONE 'UTC') BETWEEN 1 AND 2 THEN '10PM'
  WHEN EXTRACT(HOUR FROM fecha_ejecucion AT TIME ZONE 'UTC') BETWEEN 2 AND 4 THEN '11PM'
  ELSE NULL
END
WHERE run_type IS NULL;
