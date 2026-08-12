-- SQL Schema for Forecast Market Asia
-- Run this in Supabase SQL Editor after creating your project

-- Table: daily_runs
-- Stores each daily execution of the forecast bot
CREATE TABLE IF NOT EXISTS daily_runs (
  id BIGSERIAL PRIMARY KEY,
  fecha_ejecucion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_objetivo DATE NOT NULL,
  resultados JSONB,
  recomendaciones JSONB,
  total_asignado DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_runs_fecha ON daily_runs(fecha_objetivo DESC);

-- Table: forecast_history
-- Stores individual city forecast records for accuracy tracking
CREATE TABLE IF NOT EXISTS forecast_history (
  id BIGSERIAL PRIMARY KEY,
  fecha_ejecucion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_objetivo DATE NOT NULL,
  ciudad VARCHAR(100) NOT NULL,
  slug VARCHAR(50) NOT NULL,
  temp_pronosticada DECIMAL(5, 2),
  temp_corregida DECIMAL(5, 2),
  temp_real DECIMAL(5, 2),
  error DECIMAL(5, 2),
  modelos_usados INTEGER DEFAULT 0,
  consenso VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_forecast_history_slug ON forecast_history(slug, fecha_objetivo DESC);
CREATE INDEX idx_forecast_history_fecha ON forecast_history(fecha_objetivo DESC);
CREATE INDEX idx_forecast_history_error ON forecast_history(slug) WHERE error IS NOT NULL;

-- Table: model_errors
-- Tracks per-model error for adaptive weight computation
CREATE TABLE IF NOT EXISTS model_errors (
  id BIGSERIAL PRIMARY KEY,
  fecha_ejecucion TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slug VARCHAR(50) NOT NULL,
  model_name VARCHAR(50) NOT NULL,
  temp_pronosticada DECIMAL(5, 2),
  temp_real DECIMAL(5, 2),
  error DECIMAL(5, 2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_model_errors_model ON model_errors(slug, model_name, fecha_ejecucion DESC);

-- Enable Row Level Security (optional, for public read access)
ALTER TABLE daily_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_errors ENABLE ROW LEVEL SECURITY;

-- Allow public read access (since it's public data)
CREATE POLICY "Allow public read daily_runs" ON daily_runs FOR SELECT USING (true);
CREATE POLICY "Allow public insert daily_runs" ON daily_runs FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read forecast_history" ON forecast_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert forecast_history" ON forecast_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read model_errors" ON model_errors FOR SELECT USING (true);
CREATE POLICY "Allow public insert model_errors" ON model_errors FOR INSERT WITH CHECK (true);
