import { createClient } from '@supabase/supabase-js';

const url = 'https://dzgxnpazxcusbjbkpnqn.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6Z3hucGF6eGN1c2JqYmtwbnFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQwOTk5NCwiZXhwIjoyMDk3OTg1OTk0fQ.LtNq54RH8YKw_CQDOz3Q1V1YsVlWl1vTje7ToDHNgag';
const sb = createClient(url, key);

const FECHA = '2026-09-01';

async function main() {
  // 1) Contar antes
  const { data: fhBefore, count: fhCount } = await sb
    .from('forecast_history')
    .select('id, slug, fecha_objetivo, run_type', { count: 'exact' })
    .eq('fecha_objetivo', FECHA);
  console.log(`forecast_history con ${FECHA}: ${fhCount} registros`);
  if (fhBefore?.length) console.log('  Ejemplo:', JSON.stringify(fhBefore[0]));

  const { data: drBefore, count: drCount } = await sb
    .from('daily_runs')
    .select('id, fecha_objetivo, run_type, fecha_ejecucion', { count: 'exact' })
    .eq('fecha_objetivo', FECHA);
  console.log(`daily_runs con ${FECHA}: ${drCount} registros`);
  if (drBefore?.length) console.log('  Ejemplo:', JSON.stringify(drBefore[0]));

  const { data: fsBefore, count: fsCount } = await sb
    .from('forecast_snapshot')
    .select('id, slug, fecha_objetivo', { count: 'exact' })
    .eq('fecha_objetivo', FECHA);
  console.log(`forecast_snapshot con ${FECHA}: ${fsCount} registros`);

  if (fhCount === 0 && drCount === 0 && fsCount === 0) {
    console.log('Nada que borrar.');
    return;
  }

  // 2) Borrar
  if (fhCount > 0) {
    const { error: e1 } = await sb.from('forecast_history').delete().eq('fecha_objetivo', FECHA);
    console.log(`forecast_history: ${e1 ? 'ERROR ' + e1.message : 'OK - borrados'}`);
  }
  if (drCount > 0) {
    const { error: e2 } = await sb.from('daily_runs').delete().eq('fecha_objetivo', FECHA);
    console.log(`daily_runs: ${e2 ? 'ERROR ' + e2.message : 'OK - borrados'}`);
  }
  if (fsCount > 0) {
    const { error: e3 } = await sb.from('forecast_snapshot').delete().eq('fecha_objetivo', FECHA);
    console.log(`forecast_snapshot: ${e3 ? 'ERROR ' + e3.message : 'OK - borrados'}`);
  }

  console.log('Listo.');
}

main().catch(e => { console.error(e); process.exit(1); });
