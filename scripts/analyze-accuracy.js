const https = require('https');

https.get('https://forecast-market-asia.vercel.app/api/backtest', (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    const bt = JSON.parse(body).data;
    const bySlug = {};
    for (const r of bt.resultados) {
      if (!bySlug[r.slug]) bySlug[r.slug] = [];
      bySlug[r.slug].push(r);
    }

    console.log('CIUDAD       |  MUESTRAS  | RAW MAE  | CORR MAE | MEJORA  | RAW ACC | CORR ACC | MEJORA');
    console.log('-' .repeat(85));

    let totalRaw = [], totalCorr = [];

    for (const [slug, items] of Object.entries(bySlug)) {
      const rawErrors = items.map(r => r.temp_real - r.temp_pronosticada);
      const corrErrors = items.map(r => r.error);
      totalRaw.push(...rawErrors);
      totalCorr.push(...corrErrors);

      const rawMAE = rawErrors.reduce((s, e) => s + Math.abs(e), 0) / rawErrors.length;
      const corrMAE = corrErrors.reduce((s, e) => s + Math.abs(e), 0) / corrErrors.length;
      const rawAcc = rawErrors.filter(e => Math.abs(e) <= 0.5).length / rawErrors.length * 100;
      const corrAcc = corrErrors.filter(e => Math.abs(e) <= 0.5).length / corrErrors.length * 100;
      const maeImprov = ((rawMAE - corrMAE) / rawMAE * 100).toFixed(1);
      const accImprov = (corrAcc - rawAcc).toFixed(1);

      console.log(
        slug.padEnd(14) + '|  ' +
        items.length.toString().padStart(4) + '     |  ' +
        rawMAE.toFixed(2).padStart(6) + '  |  ' +
        corrMAE.toFixed(2).padStart(6) + '  |  ' +
        maeImprov.padStart(5) + '% |  ' +
        rawAcc.toFixed(1).padStart(6) + '% | ' +
        corrAcc.toFixed(1).padStart(6) + '% | ' +
        accImprov.padStart(6) + 'pp'
      );
    }

    console.log('-' .repeat(85));
    const gRawMAE = totalRaw.reduce((s, e) => s + Math.abs(e), 0) / totalRaw.length;
    const gCorrMAE = totalCorr.reduce((s, e) => s + Math.abs(e), 0) / totalCorr.length;
    const gRawAcc = totalRaw.filter(e => Math.abs(e) <= 0.5).length / totalRaw.length * 100;
    const gCorrAcc = totalCorr.filter(e => Math.abs(e) <= 0.5).length / totalCorr.length * 100;
    console.log(
      'GLOBAL'.padEnd(14) + '|  ' +
      totalRaw.length.toString().padStart(4) + '     |  ' +
      gRawMAE.toFixed(2).padStart(6) + '  |  ' +
      gCorrMAE.toFixed(2).padStart(6) + '  |  ' +
      ((gRawMAE - gCorrMAE) / gRawMAE * 100).toFixed(1).padStart(5) + '% |  ' +
      gRawAcc.toFixed(1).padStart(6) + '% | ' +
      gCorrAcc.toFixed(1).padStart(6) + '% | ' +
      (gCorrAcc - gRawAcc).toFixed(1).padStart(6) + 'pp'
    );

    console.log('\n--- ANALISIS POR CIUDAD ---');
    for (const [slug, items] of Object.entries(bySlug)) {
      const corrErrors = items.map(r => r.error);
      const sorted = [...items].sort((a, b) => Math.abs(a.error) - Math.abs(b.error));
      const medianAE = sorted[Math.floor(sorted.length / 2)].error;
      const bias = corrErrors.reduce((s, e) => s + e, 0) / corrErrors.length;
      const sesgos = items.map(r => r.sesgo_aplicado);
      const avgSesgo = sesgos.reduce((s, v) => s + v, 0) / sesgos.length;
      const rmse = Math.sqrt(corrErrors.reduce((s, e) => s + e*e, 0) / corrErrors.length);

      console.log(`\n${slug}:`);
      console.log(`  RMSE=${rmse.toFixed(2)}°C  MAE=${(corrErrors.reduce((s,e)=>s+Math.abs(e),0)/corrErrors.length).toFixed(2)}°C  Bias=${bias.toFixed(2)}°C`);
      console.log(`  Error mediano=${Math.abs(medianAE).toFixed(2)}°C  Sesgo promedio=${avgSesgo.toFixed(2)}°C`);
      console.log(`  Con RMSE=${rmse.toFixed(2)}°C, la accuracy TEORICA maxima (dist normal) es: ${(2*0.5/rmse < 3 ? (stdNorm(0.5/rmse)*2*100).toFixed(1) : '99.9')}%`);

      // Top 3 worst errors
      const worst = [...items].sort((a, b) => Math.abs(b.error) - Math.abs(a.error)).slice(0, 3);
      console.log(`  Peores 3 errores:`);
      for (const w of worst) {
        console.log(`    ${w.fecha}: pron=${w.temp_pronosticada}°C real=${w.temp_real}°C corr=${w.temp_corregida}°C error=${w.error}°C sesgo=${w.sesgo_aplicado}°C`);
      }
    }
  });
});

function stdNorm(x) {
  // Approximation of standard normal CDF
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
