-- Migration 004: Add unique constraint to prevent duplicate forecast records
-- After cleaning 685 duplicates, prevent reintroduction

-- First remove duplicates keeping the latest id per (slug, fecha_objetivo)
DELETE FROM forecast_history f1
USING forecast_history f2
WHERE f1.id < f2.id
  AND f1.slug = f2.slug
  AND f1.fecha_objetivo = f2.fecha_objetivo;

-- Then add the unique constraint
ALTER TABLE forecast_history
ADD CONSTRAINT uq_forecast_history_slug_fecha
UNIQUE (slug, fecha_objetivo);

-- Update the existing index to reflect the constraint (redundant but kept for query perf)
CREATE INDEX IF NOT EXISTS idx_forecast_history_slug_fecha
ON forecast_history(slug, fecha_objetivo DESC);
