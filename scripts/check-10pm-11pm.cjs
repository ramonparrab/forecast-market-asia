const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  'https://dzgxnpazxcusbjbkpnqn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6Z3hucGF6eGN1c2JqYmtwbnFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQwOTk5NCwiZXhwIjoyMDk3OTg1OTk0fQ.LtNq54RH8YKw_CQDOz3Q1V1YsVlWl1vTje7ToDHNgag'
);

async function main() {
  // Verificar forecast_history para Aug 31 - todas las ciudades
  const { data: fh } = await sb
    .from('forecast_history')
    .select('id, slug, fecha_objetivo, temp_pronosticada, temp_corregida, run_type, modelos_usados')
    .eq('fecha_objetivo', '2026-08-31')
    .in('run_type', ['10PM', '11PM'])
    .order('slug, run_type');

  console.log('=== forecast_history para Aug 31 ===');
  for (const r of (fh || [])) {
    console.log(`  ${r.slug.padEnd(12)} | run=${r.run_type} | pronostico=${r.temp_pronosticada} | corregida=${r.temp_corregida}`);
  }

  // Verificar forecast_snapshot para Aug 31
  console.log('\n=== forecast_snapshot para Aug 31 ===');
  const { data: fs } = await sb
    .from('forecast_snapshot')
    .select('*')
    .eq('fecha_objetivo', '2026-08-31')
    .order('slug');

  for (const s of (fs || [])) {
    console.log(`  ${s.slug.padEnd(12)} | temp_10pm=${s.temp_10pm} | temp_11pm=${s.temp_11pm} | ganadora=${s.run_type_ganadora} | corregida=${s.temp_corregida}`);
  }

  // Verificar daily_runs para Aug 31
  console.log('\n=== daily_runs para Aug 31 ===');
  const { data: dr } = await sb
    .from('daily_runs')
    .select('id, fecha_ejecucion, fecha_objetivo, run_type')
    .eq('fecha_objetivo', '2026-08-31')
    .order('run_type');

  for (const r of (dr || [])) {
    console.log(`  id=${r.id} | ejecucion=${r.fecha_ejecucion} | run_type=${r.run_type}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
