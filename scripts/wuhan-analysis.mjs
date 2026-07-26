import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || 'https://dzgxnpazxcusbjbkpnqn.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) { console.error('SUPABASE_KEY env var required'); process.exit(1) }

const client = createClient(supabaseUrl, supabaseKey)

// Get all distinct slugs
const { data: slugs, error: slugsErr } = await client
  .from('forecast_history')
  .select('slug')
  .order('slug', { ascending: true })

if (slugsErr) { console.error('Error:', slugsErr); process.exit(1) }

const uniqueSlugs = [...new Set((slugs ?? []).map(r => r.slug))].sort()
console.log('Ciudades encontradas:', uniqueSlugs.join(', '))
console.log('')

for (const slug of uniqueSlugs) {
  const { data, error } = await client
    .from('forecast_history')
    .select('id, fecha_objetivo, temp_pronosticada, temp_corregida, temp_real, error, modelos_usados, consenso')
    .eq('slug', slug)
    .not('temp_real', 'is', null)
    .order('fecha_objetivo', { ascending: false })
    .limit(10)

  if (error) { console.error(`Error ${slug}:`, error); continue }

  const records = data ?? []

  // Also get the current forecast (no temp_real)
  const { data: current } = await client
    .from('forecast_history')
    .select('id, fecha_objetivo, temp_pronosticada, temp_corregida, modelos_usados, consenso')
    .eq('slug', slug)
    .is('temp_real', null)
    .order('fecha_ejecucion', { ascending: false })
    .limit(1)

  const curr = (current ?? [])[0]

  console.log(`\n═════════════════════════════════════════════════════`)
  console.log(`  ${slug.toUpperCase()}`)
  console.log(`═════════════════════════════════════════════════════`)

  // Check for anomalies: where |temp_corregida - temp_pronosticada| > 2.5 AND error > 2
  let anomalies = 0
  for (const r of records) {
    const diff = Math.abs((r.temp_corregida ?? r.temp_pronosticada) - r.temp_pronosticada)
    const errProno = r.temp_real - r.temp_pronosticada
    const errAbs = Math.abs(r.error ?? 0)
    if (diff > 2.5 || errAbs > 2.5 || Math.abs(errProno) > 2.5) {
      if (anomalies === 0) console.log('  ANOMALÍAS DETECTADAS:')
      console.log(`  🔴 ${r.fecha_objetivo} | prono=${r.temp_pronosticada.toFixed(2)} | corr=${(r.temp_corregida ?? r.temp_pronosticada).toFixed(2)} | real=${r.temp_real.toFixed(1)} | err_prono=${errProno > 0 ? '+' : ''}${errProno.toFixed(2)} | err_corr=${r.error > 0 ? '+' : ''}${(r.error ?? 0).toFixed(2)}`)
      anomalies++
    }
  }
  if (anomalies === 0) console.log('  ✅ Todo normal en últimos 10 registros históricos')

  // Check current forecast
  if (curr) {
    const diff = curr.temp_corregida - curr.temp_pronosticada
    console.log(`\n  Pronóstico activo (${curr.fecha_objetivo}):`)
    console.log(`    pronosticada=${curr.temp_pronosticada.toFixed(2)}  corregida=${curr.temp_corregida.toFixed(2)}  dif=${diff > 0 ? '+' : ''}${diff.toFixed(2)}`)
    if (Math.abs(diff) > 2.5) {
      console.log(`    🔴 POSIBLE CORRUPCIÓN: diferencia prono-corr de ${diff.toFixed(1)}°C`)
    } else {
      console.log(`    ✅ Diferencia normal`)
    }
  }

  // Print full list
  console.log('\n  Últimos históricos:')
  for (const r of records) {
    const errProno = r.temp_real - r.temp_pronosticada
    console.log(`  ${r.fecha_objetivo} | prono=${r.temp_pronosticada.toFixed(2).padStart(6)} | corr=${(r.temp_corregida ?? r.temp_pronosticada).toFixed(2).padStart(6)} | real=${r.temp_real.toFixed(1).padStart(4)} | err_prono=${errProno > 0 ? '+' : ''}${errProno.toFixed(2).padStart(6)} | err_corr=${r.error !== null ? (r.error > 0 ? '+' : '') + r.error.toFixed(2) : 'N/A'.padStart(6)}`)
  }
}
