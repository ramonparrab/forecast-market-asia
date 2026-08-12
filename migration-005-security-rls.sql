-- Migration 005: Security - Remove public write policies
-- Run this in Supabase SQL Editor
-- This restricts writes to service_role only (bypasses RLS)

-- ===== DROP PUBLIC INSERT POLICIES =====
DROP POLICY IF EXISTS "Allow public insert daily_runs" ON daily_runs;
DROP POLICY IF EXISTS "Allow public insert forecast_history" ON forecast_history;
DROP POLICY IF EXISTS "Allow public insert model_errors" ON model_errors;
DROP POLICY IF EXISTS "Allow public insert backtest_results" ON backtest_results;
DROP POLICY IF EXISTS "Allow public insert backtest_bias" ON backtest_bias;

-- ===== DROP PUBLIC UPDATE POLICIES =====
DROP POLICY IF EXISTS "Allow public update forecast_history" ON forecast_history;
DROP POLICY IF EXISTS "Allow public update model_errors" ON model_errors;
DROP POLICY IF EXISTS "Allow public update backtest_bias" ON backtest_bias;

-- ===== DROP PUBLIC DELETE POLICIES =====
DROP POLICY IF EXISTS "Allow public delete backtest_results" ON backtest_results;
DROP POLICY IF EXISTS "Allow public delete backtest_bias" ON backtest_bias;

-- ===== VERIFY: Only SELECT policies remain for public =====
-- These are the ONLY policies that should exist for anon role:
-- "Allow public read daily_runs"     -> SELECT only
-- "Allow public read forecast_history" -> SELECT only
-- "Allow public read model_errors"    -> SELECT only
-- "Allow public read backtest_results" -> SELECT only
-- "Allow public read backtest_bias"   -> SELECT only

-- ===== VERIFY QUERY =====
-- Run this to confirm only SELECT policies remain:
SELECT
  schemaname,
  tablename,
  policyname,
  cmd AS operation
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
