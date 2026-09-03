-- ============================================================
-- LIMPIEZA de datos corruptos del 2026-09-02
-- El "respaldo 10PM" del cron 11PM sobrescribió los datos
-- originales del 10PM con datos del 11PM etiquetados como 10PM.
-- ============================================================

-- 1) Eliminar registros de forecast_history del 09-02 que tienen run_type='10PM'
--    pero que en realidad son datos del 11PM (insertados por el respaldo).
--    Criterio: si existe un registro 11PM con la misma temp_corregida,
--    el de 10PM es el respaldo falso.
DELETE FROM forecast_history
WHERE fecha_objetivo = '2026-09-02'
  AND run_type = '10PM'
  AND slug IN (
    SELECT fh10.slug
    FROM forecast_history fh10
    JOIN forecast_history fh11
      ON fh11.slug = fh10.slug
      AND fh11.fecha_objetivo = fh10.fecha_objetivo
      AND fh11.run_type = '11PM'
    WHERE fh10.fecha_objetivo = '2026-09-02'
      AND fh10.run_type = '10PM'
      AND ABS(fh10.temp_corregida - fh11.temp_corregida) < 0.5
  );

-- 2) Limpiar el snapshot del 09-02: poner temp_10pm = NULL
--    ya que no sabemos cuál era el valor real del 10PM.
--    El decision-tab mostrará la columna 10PM vacía para esa fecha.
UPDATE forecast_snapshot
SET temp_10pm = NULL,
    modelo_10pm = NULL
WHERE fecha_objetivo = '2026-09-02';

-- 3) Eliminar daily_runs del 09-02 que NO tengan run_type válido
--    (ejecuciones manuales que contaminaron)
DELETE FROM daily_runs
WHERE fecha_objetivo = '2026-09-02'
  AND (run_type IS NULL OR run_type NOT IN ('10PM', '11PM'));

-- 4) Verificar qué quedó
SELECT slug, run_type, temp_pronosticada, temp_corregida
FROM forecast_history
WHERE fecha_objetivo = '2026-09-02'
ORDER BY slug, run_type;

SELECT slug, temp_10pm, temp_11pm, modelo_10pm, modelo_11pm, run_type_ganadora
FROM forecast_snapshot
WHERE fecha_objetivo = '2026-09-02'
ORDER BY slug;
