import https from 'https';

const PROJECT_REF = 'dzgxnpazxcusbjbkpnqn';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6Z3hucGF6eGN1c2JqYmtwbnFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQwOTk5NCwiZXhwIjoyMDk3OTg1OTk0fQ.LtNq54RH8YKw_CQDOz3Q1V1YsVlWl1vTje7ToDHNgag';

function runQuery(sql) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: sql });
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== CHECKING 11PM CRON DATA FOR AUGUST 27, 2026 ===');
  console.log('Project:', PROJECT_REF);
  console.log('Current UTC time context: Aug 27 2026 in America/Caracas (UTC-4)');
  console.log('');

  // 1) Check daily_runs for Aug 27 (both run_type values)
  console.log('--- 1. DAILY_RUNS for Aug 27, 2026 ---');
  const q1 = await runQuery(`
    SELECT id, fecha_ejecucion, fecha_objetivo, run_type, total_asignado, created_at
    FROM daily_runs
    WHERE fecha_objetivo = '2026-08-27'
       OR fecha_ejecucion::date = '2026-08-27'
    ORDER BY created_at DESC;
  `);
  console.log(JSON.stringify(q1, null, 2));

  // 2) Count by run_type for Aug 27
  console.log('\n--- 2. DAILY_RUNS count by run_type for Aug 27 ---');
  const q2 = await runQuery(`
    SELECT run_type, COUNT(*) as count
    FROM daily_runs
    WHERE fecha_objetivo = '2026-08-27'
       OR fecha_ejecucion::date = '2026-08-27'
    GROUP BY run_type
    ORDER BY run_type;
  `);
  console.log(JSON.stringify(q2, null, 2));

  // 3) Check forecast_history for Aug 27
  console.log('\n--- 3. FORECAST_HISTORY for Aug 27, 2026 ---');
  const q3 = await runQuery(`
    SELECT id, slug, fecha_objetivo, forecast_temp, confidence, run_type, created_at
    FROM forecast_history
    WHERE fecha_objetivo = '2026-08-27'
       OR created_at::date = '2026-08-27'
    ORDER BY created_at DESC
    LIMIT 50;
  `);
  console.log(JSON.stringify(q3, null, 2));

  // 4) Count by run_type in forecast_history for Aug 27
  console.log('\n--- 4. FORECAST_HISTORY count by run_type for Aug 27 ---');
  const q4 = await runQuery(`
    SELECT run_type, COUNT(*) as count, COUNT(DISTINCT slug) as unique_slugs
    FROM forecast_history
    WHERE fecha_objetivo = '2026-08-27'
       OR created_at::date = '2026-08-27'
    GROUP BY run_type
    ORDER BY run_type;
  `);
  console.log(JSON.stringify(q4, null, 2));

  // 5) Specifically check for 11PM run records
  console.log('\n--- 5. Specifically 11PM run records (run_type LIKE \'%11%\') ---');
  const q5 = await runQuery(`
    SELECT 'daily_runs' as tbl, id, fecha_ejecucion, fecha_objetivo, run_type, created_at
    FROM daily_runs
    WHERE (fecha_objetivo = '2026-08-27' OR fecha_ejecucion::date = '2026-08-27')
      AND run_type ILIKE '%11%'
    UNION ALL
    SELECT 'forecast_history' as tbl, id, NULL::timestamp as fecha_ejecucion, fecha_objetivo, run_type, created_at
    FROM forecast_history
    WHERE (fecha_objetivo = '2026-08-27' OR created_at::date = '2026-08-27')
      AND run_type ILIKE '%11%'
    ORDER BY created_at DESC;
  `);
  console.log(JSON.stringify(q5, null, 2));

  // 6) Also check the most recent records to see latest activity
  console.log('\n--- 6. Most recent daily_runs (last 5) ---');
  const q6 = await runQuery(`
    SELECT id, fecha_ejecucion, fecha_objetivo, run_type, created_at
    FROM daily_runs
    ORDER BY created_at DESC
    LIMIT 5;
  `);
  console.log(JSON.stringify(q6, null, 2));

  console.log('\n--- 7. Most recent forecast_history (last 5) ---');
  const q7 = await runQuery(`
    SELECT id, slug, fecha_objetivo, run_type, created_at
    FROM forecast_history
    ORDER BY created_at DESC
    LIMIT 5;
  `);
  console.log(JSON.stringify(q7, null, 2));

  // 8) Distinct run_type values in both tables
  console.log('\n--- 8. All distinct run_type values ---');
  const q8 = await runQuery(`
    SELECT 'daily_runs' as tbl, run_type
    FROM daily_runs
    GROUP BY run_type
    UNION ALL
    SELECT 'forecast_history' as tbl, run_type
    FROM forecast_history
    GROUP BY run_type
    ORDER BY tbl, run_type;
  `);
  console.log(JSON.stringify(q8, null, 2));
}

main().catch(console.error);
