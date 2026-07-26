import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data, error } = await supabase
  .from('forecast_history')
  .select('id, slug, ciudad, fecha_objetivo, temp_real, error, temp_pronosticada, temp_corregida')
  .in('slug', ['beijing', 'hong-kong'])
  .not('temp_real', 'is', null)
  .gte('fecha_objetivo', new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10))
  .order('fecha_objetivo', { ascending: false });

if (error) { console.error(error); process.exit(1); }

const seen = new Map();
for (const r of data) {
  const key = r.slug + '|' + r.fecha_objetivo.slice(0,10);
  if (!seen.has(key)) seen.set(key, r);
}

const sorted = Array.from(seen.values()).sort((a, b) => b.fecha_objetivo.localeCompare(a.fecha_objetivo));

console.log('slug | fecha | temp_pron | temp_corregida | temp_real | error');
console.log('--- | --- | --- | --- | --- | ---');
for (const r of sorted) {
  console.log(`${r.slug} | ${r.fecha_objetivo.slice(0,10)} | ${r.temp_pronosticada} | ${r.temp_corregida} | ${r.temp_real} | ${r.error?.toFixed(2)}`);
}
