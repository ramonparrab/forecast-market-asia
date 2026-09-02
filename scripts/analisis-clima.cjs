const CIUDADES = [
  { slug: 'singapore', nombre: 'Singapur',  lat: 1.35,  lon: 103.99 },
  { slug: 'shanghai',  nombre: 'Shanghái',  lat: 31.14, lon: 121.80 },
  { slug: 'wuhan',     nombre: 'Wuhan',     lat: 30.78, lon: 114.21 },
  { slug: 'chongqing', nombre: 'Chongqing', lat: 29.72, lon: 106.64 },
];

const MODELS = ['best_match', 'ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'jma_seamless', 'meteofrance_seamless'];

function prom(values) {
  const nums = values.filter(v => v !== null && v !== undefined);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

async function fetchCity(city, startDate, endDate, label) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code&temperature_unit=celsius&start_date=${startDate}&end_date=${endDate}&models=${MODELS.join(',')}&timezone=auto`;
  
  const resp = await fetch(url);
  const j = await resp.json();
  const d = j?.daily;
  if (!d) { console.log(`\n${city.nombre} (${label}): SIN DATOS`); return; }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${city.nombre} (${city.slug}) — ${label}`);
  console.log(`${'='.repeat(70)}`);
  
  for (let i = 0; i < d.time.length; i++) {
    const fecha = d.time[i];
    const tmax = prom(MODELS.map(m => d[`temperature_2m_max_${m}`]?.[i] ?? null));
    const tmin = prom(MODELS.map(m => d[`temperature_2m_min_${m}`]?.[i] ?? null));
    const precip = prom(MODELS.map(m => d[`precipitation_sum_${m}`]?.[i] ?? null));
    const prob = prom(MODELS.map(m => d[`precipitation_probability_max_${m}`]?.[i] ?? null));
    const wind = prom(MODELS.map(m => d[`wind_speed_10m_max_${m}`]?.[i] ?? null));
    const codes = MODELS.map(m => d[`weather_code_${m}`]?.[i] ?? null).filter(v => typeof v === 'number');
    const code = codes.length ? codes.sort((a, b) => a - b)[Math.floor(codes.length / 2)] : null;
    const bm = d[`temperature_2m_max_best_match`]?.[i];
    
    let delta = null;
    if (i >= 2) {
      const p1 = prom(MODELS.map(m => d[`temperature_2m_max_${m}`]?.[i-1] ?? null));
      const p2 = prom(MODELS.map(m => d[`temperature_2m_max_${m}`]?.[i-2] ?? null));
      if (p1 !== null && p2 !== null) delta = tmax - (p1 + p2) / 2;
    }
    
    const alerts = [];
    const hayPrecip = precip >= 1.5 || prob >= 35;
    const hayViento = wind >= 30;
    const TORMENTA_SEVERA_CODES = new Set([96, 99]);
    const LLUVIA_TORRENCIAL_CODES = new Set([82, 86, 95, 96, 99, 65, 67]);
    const AGUACERO_CODES = new Set([80, 81, 82]);
    const NIEVE_CODES = new Set([71, 73, 75, 77, 85, 86]);
    
    if (delta !== null) {
      if (delta <= -3.2 && (hayPrecip || hayViento)) alerts.push(`FRENTE_FRIO (delta=${delta.toFixed(1)})`);
      if (delta >= 3.5 || tmax >= 38.5) alerts.push(`FRENTE_CALUROSO (delta=${delta?.toFixed(1)})`);
    }
    if (NIEVE_CODES.has(code)) alerts.push('NIEVE');
    const esAguaceroViento = AGUACERO_CODES.has(code) && (wind >= 35 || prob >= 75);
    const esTormenta = LLUVIA_TORRENCIAL_CODES.has(code);
    if (precip >= 15 || (precip >= 5 && prob >= 70) || esTormenta || esAguaceroViento) {
      alerts.push(precip >= 45 ? 'TORMENTA_SEVERA' : 'LLUVIA_FUERTE');
    }
    
    console.log(`\n  ${fecha}  (indice ${i})`);
    console.log(`  Tmax prom modelos: ${tmax?.toFixed(1)}C  |  best_match: ${bm}C`);
    console.log(`  Tmin: ${tmin?.toFixed(1)}C  |  Precip: ${precip?.toFixed(1)}mm  |  Prob: ${prob?.toFixed(0)}%  |  Viento: ${wind?.toFixed(0)}km/h`);
    console.log(`  Weather code: ${code}`);
    if (delta !== null) console.log(`  Delta vs 2 dias prev: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}C`);
    console.log(`  Alertas: ${alerts.length ? alerts.join(', ') : 'NINGUNA'}`);
  }
}

async function main() {
  console.log('#'.repeat(70));
  console.log('# SINGAPUR 31 AGOSTO: por que NO detecto alerta');
  console.log('#'.repeat(70));
  
  const sg = CIUDADES.find(c => c.slug === 'singapore');
  await fetchCity(sg, '2026-08-29', '2026-08-31', '29,30,31 Ago (indice 2=31)');
  
  console.log('\n\n' + '#'.repeat(70));
  console.log('# 01 SEPT: SINGAPUR, SHANGHAI, WUHAN, CHONGQING');
  console.log('#'.repeat(70));
  
  for (const city of CIUDADES) {
    await fetchCity(city, '2026-08-30', '2026-09-01', '30,31 Ago, 01 Sep (indice 2=01)');
  }
  
  // Datos guardados en forecast_history para Singapur
  console.log('\n\n' + '#'.repeat(70));
  console.log('# REGISTROS EN forecast_history PARA SINGAPUR (ultimos dias)');
  console.log('#'.repeat(70));
  
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(
    'https://dzgxnpazxcusbjbkpnqn.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6Z3hucGF6eGN1c2JqYmtwbnFuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjQwOTk5NCwiZXhwIjoyMDk3OTg1OTk0fQ.LtNq54RH8YKw_CQDOz3Q1V1YsVlWl1vTje7ToDHNgag'
  );
  
  const { data: fh } = await sb
    .from('forecast_history')
    .select('id, slug, fecha_objetivo, temp_pronosticada, temp_corregida, temp_real, error, run_type')
    .eq('slug', 'singapore')
    .gte('fecha_objetivo', '2026-08-28')
    .order('fecha_objetivo', { ascending: true });
  
  if (fh?.length) {
    for (const r of fh) {
      console.log(`  ${r.fecha_objetivo} | run=${r.run_type || '-'} | pronostico=${r.temp_pronosticada} | corregida=${r.temp_corregida} | real=${r.temp_real ?? '-'} | error=${r.error ?? '-'}`);
    }
  } else {
    console.log('  Sin registros');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
