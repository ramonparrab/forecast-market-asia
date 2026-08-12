-- Table: backtest_results
-- Stores historical backtest runs for accuracy validation
CREATE TABLE IF NOT EXISTS backtest_results (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_dias INTEGER NOT NULL,
  total_muestras INTEGER NOT NULL,
  overall_mae DECIMAL(6, 2),
  overall_rmse DECIMAL(6, 2),
  overall_bias DECIMAL(6, 2),
  overall_accuracy_2c DECIMAL(5, 2),
  overall_accuracy_1c DECIMAL(5, 2),
  por_ciudad JSONB,
  resultados JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_backtest_timestamp ON backtest_results(timestamp DESC);

-- Allow public access
ALTER TABLE backtest_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read backtest_results" ON backtest_results FOR SELECT USING (true);
CREATE POLICY "Allow public insert backtest_results" ON backtest_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete backtest_results" ON backtest_results FOR DELETE USING (true);
