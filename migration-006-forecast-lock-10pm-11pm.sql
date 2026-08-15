-- =============================================================
-- Migration 006: Lock 10PM/11PM forecasts & snapshot winner
-- =============================================================
-- PROBLEMA: forecast_history tiene UNIQUE(slug, fecha_objetivo).
-- El cron de 10PM guarda un registro, luego el de 11PM BORRA
-- el de 10PM (saveForecastRecords hace DELETE+INSERT).
-- Resultado: se pierde la corrida de 10PM y los datos cambian.
--
-- SOLUCION:
--   1. Agregar run_type a forecast_history (10PM / 11PM)
--   2. Cambiar UNIQUE a (slug, fecha_objetivo, run_type)
--   3. Crear forecast_snapshot: el pronostico GANADOR bloqueado
--      por dia, elegido por historial de rendimiento.
--   4. Backfillar run_type en registros existentes.
-- =============================================================

-- =============================================================
-- STEP 1: Agregar columna run_type a forecast_history
-- =============================================================
ALTER TABLE forecast_history
  ADD COLUMN IF NOT EXISTS run_type VARCHAR(10);

-- =============================================================
-- STEP 2: Backfillar run_type en registros existentes
-- 10PM Caracas = 02:00 UTC del dia siguiente
-- 11PM Caracas = 03:00 UTC del dia siguiente
-- =============================================================
UPDATE forecast_history
SET run_type = CASE
  -- 10PM Caracas (UTC-4) = 02:00 UTC next day
  WHEN EXTRACT(HOUR FROM fecha_ejecucion AT TIME ZONE 'UTC') = 2
    THEN '10PM'
  -- 11PM Caracas (UTC-4) = 03:00 UTC next day  
  WHEN EXTRACT(HOUR FROM fecha_ejecucion AT TIME ZONE 'UTC') = 3
    THEN '11PM'
  -- Manual runs or other hours: infer from date relationship
  -- If fecha_ejecucion date is one day before fecha_objetivo,
  -- it was likely an overnight cron run (10PM or 11PM)
  WHEN fecha_ejecucion::date < fecha_objetivo
    AND EXTRACT(HOUR FROM fecha_ejecucion AT TIME ZONE 'UTC') BETWEEN 0 AND 5
    THEN CASE
      WHEN EXTRACT(HOUR FROM fecha_ejecucion AT TIME ZONE 'UTC') <= 2 THEN '10PM'
      ELSE '11PM'
    END
  ELSE NULL
END
WHERE run_type IS NULL;

-- =============================================================
-- STEP 3: Eliminar constraint UNIQUE anterior y crear nueva
-- De (slug, fecha_objetivo) a (slug, fecha_objetivo, run_type)
-- =============================================================

-- Drop old unique constraint (migration-004)
ALTER TABLE forecast_history
  DROP CONSTRAINT IF EXISTS uq_forecast_history_slug_fecha;

-- New unique constraint: permite coexistir 10PM y 11PM
ALTER TABLE forecast_history
  ADD CONSTRAINT uq_forecast_history_slug_fecha_run
  UNIQUE (slug, fecha_objetivo, run_type);

-- Index para queries frecuentes por run_type
CREATE INDEX IF NOT EXISTS idx_forecast_history_run_type
  ON forecast_history(run_type);

-- Index compuesto para queries tipicas de backtest
CREATE INDEX IF NOT EXISTS idx_forecast_history_slug_run_fecha
  ON forecast_history(slug, run_type, fecha_objetivo DESC);

-- =============================================================
-- STEP 4: Tabla forecast_snapshot
-- Almacena el pronostico GANADOR bloqueado por dia.
-- El cron escribe AQUI el valor final que debe mostrarse
-- en Resumen Ejecutivo y todas las pestanas.
-- =============================================================
CREATE TABLE IF NOT EXISTS forecast_snapshot (
  id BIGSERIAL PRIMARY KEY,
  fecha_objetivo DATE NOT NULL,
  slug VARCHAR(50) NOT NULL,
  ciudad VARCHAR(100) NOT NULL,
  
  -- Que corrida gano para esta ciudad/dia
  run_type_ganadora VARCHAR(10) NOT NULL,  -- '10PM' o '11PM'
  modelo_ganador VARCHAR(50) NOT NULL,      -- 'KALMAN' o 'MC' o 'ENSEMBLE'
  
  -- El pronostico final bloqueado (el que se muestra en UI)
  temp_pronosticada DECIMAL(5, 2),
  temp_corregida DECIMAL(5, 2),
  temp_ponderada DECIMAL(5, 2),
  consenso VARCHAR(20),
  modelos_usados INTEGER DEFAULT 0,
  
  -- Valores de AMBAS corridas para comparacion en UI
  temp_10pm DECIMAL(5, 2),
  temp_11pm DECIMAL(5, 2),
  modelo_10pm VARCHAR(50),
  modelo_11pm VARCHAR(50),
  
  -- Resultado real (se llena al backfillar)
  temp_real DECIMAL(5, 2),
  error DECIMAL(5, 2),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Un snapshot por ciudad por dia
  UNIQUE (slug, fecha_objetivo)
);

-- Indices para forecast_snapshot
CREATE INDEX IF NOT EXISTS idx_snapshot_fecha
  ON forecast_snapshot(fecha_objetivo DESC);

CREATE INDEX IF NOT EXISTS idx_snapshot_slug_fecha
  ON forecast_snapshot(slug, fecha_objetivo DESC);

CREATE INDEX IF NOT EXISTS idx_snapshot_pending
  ON forecast_snapshot(fecha_objetivo DESC)
  WHERE temp_real IS NULL;

-- =============================================================
-- STEP 5: RLS para forecast_snapshot
-- =============================================================
ALTER TABLE forecast_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read forecast_snapshot"
  ON forecast_snapshot FOR SELECT USING (true);

CREATE POLICY "Allow public insert forecast_snapshot"
  ON forecast_snapshot FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update forecast_snapshot"
  ON forecast_snapshot FOR UPDATE USING (true);

CREATE POLICY "Allow public delete forecast_snapshot"
  ON forecast_snapshot FOR DELETE USING (true);

-- =============================================================
-- STEP 6: Backfill inicial de forecast_snapshot
-- Para dias que tienen ambas corridas (10PM y 11PM),
-- elegir la que tenga menor error absoluto (MAE).
-- Para dias con una sola corrida, usar esa.
-- =============================================================
INSERT INTO forecast_snapshot (
  fecha_objetivo, slug, ciudad,
  run_type_ganadora, modelo_ganador,
  temp_pronosticada, temp_corregida,
  temp_10pm, temp_11pm,
  modelo_10pm, modelo_11pm,
  temp_real, error
)
WITH 
-- Get all records with their run_type
all_records AS (
  SELECT 
    fh.*, 
    COALESCE(fh.run_type, 'UNKNOWN') as rt
  FROM forecast_history fh
),
-- Pivot: get 10PM and 11PM side by side per (slug, fecha_objetivo)
pivoted AS (
  SELECT 
    COALESCE(a.slug, b.slug) as slug,
    COALESCE(a.fecha_objetivo, b.fecha_objetivo) as fecha_objetivo,
    COALESCE(a.ciudad, b.ciudad) as ciudad,
    a.temp_corregida as temp_10pm,
    a.id as id_10pm,
    b.temp_corregida as temp_11pm,
    b.id as id_11pm,
    a.temp_real as real_10pm,
    b.temp_real as real_11pm,
    a.error as error_10pm,
    b.error as error_11pm
  FROM (SELECT * FROM all_records WHERE rt = '10PM') a
  FULL OUTER JOIN (SELECT * FROM all_records WHERE rt = '11PM') b
    ON a.slug = b.slug AND a.fecha_objetivo = b.fecha_objetivo
  WHERE COALESCE(a.slug, b.slug) IS NOT NULL
),
-- Determine winner
with_winner AS (
  SELECT 
    p.*,
    CASE 
      -- Both have actuals: pick lowest error
      WHEN p.real_10pm IS NOT NULL AND p.real_11pm IS NOT NULL THEN
        CASE 
          WHEN ABS(p.error_10pm) <= ABS(p.error_11pm) THEN '10PM'
          ELSE '11PM'
        END
      -- Only 10PM has actuals
      WHEN p.real_10pm IS NOT NULL THEN '10PM'
      -- Only 11PM has actuals
      WHEN p.real_11pm IS NOT NULL THEN '11PM'
      -- Neither has actuals: prefer 11PM (more recent data)
      WHEN p.temp_11pm IS NOT NULL THEN '11PM'
      -- Only 10PM exists
      ELSE '10PM'
    END as winner,
    CASE 
      WHEN p.real_10pm IS NOT NULL AND p.real_11pm IS NOT NULL THEN
        CASE 
          WHEN ABS(p.error_10pm) <= ABS(p.error_11pm) THEN p.temp_10pm
          ELSE p.temp_11pm
        END
      WHEN p.temp_11pm IS NOT NULL THEN p.temp_11pm
      ELSE p.temp_10pm
    END as winning_temp
  FROM pivoted p
)
SELECT 
  w.fecha_objetivo, w.slug, w.ciudad,
  w.winner as run_type_ganadora,
  'ENSEMBLE' as modelo_ganador,  -- Will be updated by cron with actual model
  NULL as temp_pronosticada,
  w.winning_temp as temp_corregida,
  w.temp_10pm, w.temp_11pm,
  NULL as modelo_10pm, NULL as modelo_11pm,
  COALESCE(w.real_10pm, w.real_11pm) as temp_real,
  CASE 
    WHEN w.real_10pm IS NOT NULL AND w.real_11pm IS NOT NULL THEN
      CASE WHEN ABS(w.error_10pm) <= ABS(w.error_11pm) THEN w.error_10pm ELSE w.error_11pm END
    WHEN w.real_10pm IS NOT NULL THEN w.error_10pm
    WHEN w.real_11pm IS NOT NULL THEN w.error_11pm
    ELSE NULL
  END as error
FROM with_winner w
WHERE w.winning_temp IS NOT NULL
ON CONFLICT (slug, fecha_objetivo) DO NOTHING;

-- =============================================================
-- STEP 7: Actualizar updated_at trigger para forecast_snapshot
-- =============================================================
CREATE OR REPLACE FUNCTION update_snapshot_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_snapshot_updated_at ON forecast_snapshot;
CREATE TRIGGER trg_snapshot_updated_at
  BEFORE UPDATE ON forecast_snapshot
  FOR EACH ROW
  EXECUTE FUNCTION update_snapshot_updated_at();

-- =============================================================
-- VERIFICACION
-- =============================================================
-- Descomenta estas lineas para verificar despues de ejecutar:
--
-- SELECT run_type, COUNT(*) FROM forecast_history GROUP BY run_type ORDER BY run_type;
-- SELECT COUNT(*) as snapshots_created FROM forecast_snapshot;
-- SELECT * FROM forecast_snapshot ORDER BY fecha_objetivo DESC LIMIT 5;
