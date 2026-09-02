const https = require('https');

const SUPABASE_URL = 'https://dzgxnpazxcusbjbkpnqn.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6Z3hucGF6eGN1c2JqYmtwbnFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQwOTk5NCwiZXhwIjoyMDk3OTg1OTk0fQ.LtNq54RH8YKw_CQDOz3Q1V1YsVlWl1vTje7ToDHNgag';

function query(table, filters, select = '*', limit = 30) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      select,
      order: 'id.desc',
      limit: String(limit),
      ...filters
    });
    const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
    const opts = {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    https.get(url, opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(data)); }
      });
    }).on('error', reject);
  });
}

(async () => {
  // 1. forecast_history for Aug 30
  console.log('=== forecast_history 2026-08-30 ===');
  const fh30 = await query('forecast_history', { 'fecha_objetivo': 'eq.2026-08-30' }, 'id,slug,fecha_objetivo,temp_pronosticada,temp_corregida,temp_real,run_type,created_at');
  console.log('Records:', fh30.length);
  if (fh30.length) {
    console.log('Slugs:', [...new Set(fh30.map(r => r.slug))].join(', '));
    console.log('RunTypes:', [...new Set(fh30.map(r => r.run_type))].join(', '));
    console.log('First:', JSON.stringify(fh30[0]));
    console.log('Last:', JSON.stringify(fh30[fh30.length-1]));
  }

  // 2. forecast_snapshot for Aug 30
  console.log('\n=== forecast_snapshot 2026-08-30 ===');
  const snap30 = await query('forecast_snapshot', { 'fecha_objetivo': 'eq.2026-08-30' }, 'slug,fecha_objetivo,temp_pronosticada,temp_corregida,temp_real,run_type_ganadora,modelo_ganador');
  console.log('Records:', snap30.length);
  if (snap30.length) {
    console.log('Slugs:', [...new Set(snap30.map(r => r.slug))].join(', '));
    console.log('Sample:', JSON.stringify(snap30[0]));
  }

  // 3. daily_runs recent (creates Aug 30 forecasts)
  console.log('\n=== daily_runs recent ===');
  const runs = await query('daily_runs', { 'fecha_ejecucion': 'gte.2026-08-29T00:00:00' }, 'id,fecha_ejecucion,fecha_objetivo', 20);
  // Sort by fecha_ejecucion desc
  runs.sort((a,b) => b.fecha_ejecucion.localeCompare(a.fecha_ejecucion));
  console.log('Records:', runs.length);
  for (const r of runs) {
    console.log('  id:', r.id, 'ejec:', r.fecha_ejecucion, 'obj:', r.fecha_objetivo);
  }

  // 4. forecast_history for Aug 29 (comparison)
  console.log('\n=== forecast_history 2026-08-29 ===');
  const fh29 = await query('forecast_history', { 'fecha_objetivo': 'eq.2026-08-29' }, 'id,slug,run_type,temp_pronosticada', 5);
  console.log('Records:', fh29.length);
  if (fh29.length) {
    console.log('RunTypes:', [...new Set(fh29.map(r => r.run_type))].join(', '));
    console.log('Sample:', JSON.stringify(fh29[0]));
  }
})().catch(e => console.error('ERR:', e));
