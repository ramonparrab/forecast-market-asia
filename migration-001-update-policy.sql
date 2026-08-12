-- Migration: Add UPDATE policies and backfill support
-- Run this in Supabase SQL Editor

-- Allow UPDATE on forecast_history (for backfilling actual temps)
CREATE POLICY "Allow public update forecast_history" 
  ON forecast_history FOR UPDATE USING (true) WITH CHECK (true);

-- Allow UPDATE on model_errors (for backfilling actual temps)
CREATE POLICY "Allow public update model_errors" 
  ON model_errors FOR UPDATE USING (true) WITH CHECK (true);
