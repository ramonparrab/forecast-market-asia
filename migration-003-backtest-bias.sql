-- Table: backtest_bias
-- Per-city bias correction derived from cumulative backtest results
CREATE TABLE IF NOT EXISTS backtest_bias (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(20) NOT NULL,
  mes INTEGER NOT NULL,
  bias DECIMAL(6, 2) NOT NULL,
  mae DECIMAL(6, 2) NOT NULL,
  muestras INTEGER NOT NULL,
  fecha_actualizacion TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(slug, mes)
);

CREATE INDEX IF NOT EXISTS idx_backtest_bias_slug ON backtest_bias(slug, mes);

ALTER TABLE backtest_bias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read backtest_bias" ON backtest_bias FOR SELECT USING (true);
CREATE POLICY "Allow public insert backtest_bias" ON backtest_bias FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update backtest_bias" ON backtest_bias FOR UPDATE USING (true);
CREATE POLICY "Allow public delete backtest_bias" ON backtest_bias FOR DELETE USING (true);
