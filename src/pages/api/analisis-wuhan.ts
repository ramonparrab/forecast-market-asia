import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeAllMejoras } from '@/lib/mejora-continua-engine'

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })

  try {
    const client = createClient(supabaseUrl, supabaseKey)
    const { data: records } = await client
      .from('forecast_history' as any)
      .select('id, fecha_objetivo, slug, temp_corregida, temp_real, error')
      .eq('slug', 'wuhan')
      .not('temp_real', 'is', null)
      .not('error', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    if (!records || !(records as any[]).length) {
      return res.status(404).json({ error: 'No records for Wuhan' })
    }

    const result = computeAllMejoras(records as any[], 'Wuhan')
    const daily = result.dailyResults

    // --- 1. Overall Metrics ---
    let sumAbsCorr = 0, sumAbsComb = 0, sumSqCorr = 0, sumSqComb = 0
    let sumErrCorr = 0, sumErrComb = 0, vecesGanaComb = 0
    for (const d of daily) {
      const ac = Math.abs(d.error_actual)
      const acm = Math.abs(d.combinado.error)
      sumAbsCorr += ac; sumAbsComb += acm
      sumSqCorr += d.error_actual * d.error_actual
      sumSqComb += d.combinado.error * d.combinado.error
      sumErrCorr += d.error_actual; sumErrComb += d.combinado.error
      if (acm < ac) vecesGanaComb++
    }
    const n = daily.length

    // --- 2. Error by Temperature Range ---
    const rangos: Record<string, { corr: number[]; comb: number[]; station: number[]; rapid: number[]; range: number[] }> = {}
    for (const d of daily) {
      const r = d.temp_real <= 25 ? '≤25°C' : d.temp_real <= 30 ? '26-30°C' : d.temp_real <= 35 ? '31-35°C' : '36°C+'
      if (!rangos[r]) rangos[r] = { corr: [], comb: [], station: [], rapid: [], range: [] }
      rangos[r].corr.push(d.error_actual)
      rangos[r].comb.push(d.combinado.error)
      rangos[r].station.push(d.station.error)
      rangos[r].rapid.push(d.rapid_warming.error)
      rangos[r].range.push(d.range_bias.error)
    }

    const porRango = Object.entries(rangos).map(([rango, vals]) => {
      const maeC = vals.corr.reduce((s, v) => s + Math.abs(v), 0) / vals.corr.length
      const maeM = vals.comb.reduce((s, v) => s + Math.abs(v), 0) / vals.comb.length
      const mejora = maeC > 0 ? ((maeC - maeM) / maeC * 100) : 0
      const biasC = vals.corr.reduce((s, v) => s + v, 0) / vals.corr.length
      const biasM = vals.comb.reduce((s, v) => s + v, 0) / vals.comb.length
      return {
        rango, muestras: vals.corr.length,
        mae_corregida: Math.round(maeC * 1000) / 1000,
        mae_combinado: Math.round(maeM * 1000) / 1000,
        mejora_mae_pct: Math.round(mejora * 10) / 10,
        bias_corregida: Math.round(biasC * 1000) / 1000,
        bias_combinado: Math.round(biasM * 1000) / 1000,
        mae_station: Math.round(vals.station.reduce((s, v) => s + Math.abs(v), 0) / vals.station.length * 1000) / 1000,
        mae_rapid: Math.round(vals.rapid.reduce((s, v) => s + Math.abs(v), 0) / vals.rapid.length * 1000) / 1000,
        mae_range: Math.round(vals.range.reduce((s, v) => s + Math.abs(v), 0) / vals.range.length * 1000) / 1000,
      }
    })

    // --- 3. Error by station_bias magnitude ---
    const biasGrupos = [
      { label: 'stationBias < 0.3', min: -Infinity, max: 0.3 },
      { label: 'stationBias 0.3-0.6', min: 0.3, max: 0.6 },
      { label: 'stationBias > 0.6', min: 0.6, max: Infinity },
    ]
    const porBias: any[] = []
    for (const g of biasGrupos) {
      const items = daily.filter(d => d.error_actual >= g.min && d.error_actual < g.max)
      if (!items.length) continue
      const maeC = items.reduce((s, d) => s + Math.abs(d.error_actual), 0) / items.length
      const maeM = items.reduce((s, d) => s + Math.abs(d.combinado.error), 0) / items.length
      porBias.push({
        grupo: g.label,
        muestras: items.length,
        mae_corregida: Math.round(maeC * 1000) / 1000,
        mae_combinado: Math.round(maeM * 1000) / 1000,
      })
    }

    // --- 4. Consecutive day analysis ---
    let acumCorr = 0, acumComb = 0, countAcum = 0
    let diasCalientes = 0, calienteCorr = 0, calienteComb = 0
    for (let i = 1; i < daily.length; i++) {
      const prev = daily[i - 1]
      const curr = daily[i]
      // consecutive error for same direction
      if (prev.error_actual > 0 && curr.error_actual > 0) {
        acumCorr += Math.abs(curr.error_actual); countAcum++
      }
      if (prev.combinado.error > 0 && curr.combinado.error > 0) {
        acumComb += Math.abs(curr.combinado.error)
      }
      // rapid warming activation days
      if (curr.temp_corregida > prev.temp_real + 3) {
        diasCalientes++
        calienteCorr += Math.abs(curr.error_actual)
        calienteComb += Math.abs(curr.combinado.error)
      }
    }

    // --- 5. Boost analysis ---
    const conBoost = daily.filter((_, i) => {
      if (i === 0) return false
      return daily[i].temp_corregida > daily[i - 1].temp_real + 3
    })
    const sinBoost = daily.filter((_, i) => {
      if (i === 0) return false
      return !(daily[i].temp_corregida > daily[i - 1].temp_real + 3)
    })
    const boostInfo = {
      activaciones: conBoost.length,
      mae_corregida_con_boost: conBoost.length
        ? Math.round(conBoost.reduce((s, d) => s + Math.abs(d.error_actual), 0) / conBoost.length * 1000) / 1000 : null,
      mae_combinado_con_boost: conBoost.length
        ? Math.round(conBoost.reduce((s, d) => s + Math.abs(d.combinado.error), 0) / conBoost.length * 1000) / 1000 : null,
      mae_corregida_sin_boost: sinBoost.length
        ? Math.round(sinBoost.reduce((s, d) => s + Math.abs(d.error_actual), 0) / sinBoost.length * 1000) / 1000 : null,
      mae_combinado_sin_boost: sinBoost.length
        ? Math.round(sinBoost.reduce((s, d) => s + Math.abs(d.combinado.error), 0) / sinBoost.length * 1000) / 1000 : null,
    }

    // --- 6. Component correlation ---
    let sumStationCorr = 0, sumRapidCorr = 0, sumRangeCorr = 0
    for (const d of daily) {
      sumStationCorr += Math.abs(d.station.error) < Math.abs(d.error_actual) ? 1 : 0
      sumRapidCorr += Math.abs(d.rapid_warming.error) < Math.abs(d.error_actual) ? 1 : 0
      sumRangeCorr += Math.abs(d.range_bias.error) < Math.abs(d.error_actual) ? 1 : 0
    }

    // --- 7. "New combined" proposals ---
    const propuestas: any[] = []
    const maeCorr = sumAbsCorr / n
    const maeComb = sumAbsComb / n

    // Propuesta A: Use only station bias (skip range + rapid if they hurt)
    const errorsA = daily.map(d => d.temp_real - (d.temp_corregida + result.estacion_bias_general))
    const maeA = errorsA.reduce((s, e) => s + Math.abs(e), 0) / n
    propuestas.push({
      nombre: 'A: Solo station bias general',
      formula: 'temp_corregida + estacion_bias_general',
      mae: Math.round(maeA * 1000) / 1000,
      mejora_vs_corregida: Math.round((maeCorr - maeA) / maeCorr * 1000) / 10,
      mejora_vs_combinado: Math.round((maeComb - maeA) / maeComb * 1000) / 10,
    })

    // Propuesta B: Station bias (walk-forward) only, no range, no rapid
    const maeB = daily.reduce((s, d) => s + Math.abs(d.station.error), 0) / n
    propuestas.push({
      nombre: 'B: Station walk-forward (sin range, sin rapid)',
      formula: 'temp_corregida + station_bias_walkforward',
      mae: Math.round(maeB * 1000) / 1000,
      mejora_vs_corregida: Math.round((maeCorr - maeB) / maeCorr * 1000) / 10,
      mejora_vs_combinado: Math.round((maeComb - maeB) / maeComb * 1000) / 10,
    })

    // Propuesta C: Range walk-forward (station + range, skip rapid)
    const maeC = daily.reduce((s, d) => s + Math.abs(d.range_bias.error), 0) / n
    propuestas.push({
      nombre: 'C: Range walk-forward (station + range, sin rapid)',
      formula: 'temp_corregida + range_bias walk-forward',
      mae: Math.round(maeC * 1000) / 1000,
      mejora_vs_corregida: Math.round((maeCorr - maeC) / maeCorr * 1000) / 10,
      mejora_vs_combinado: Math.round((maeComb - maeC) / maeComb * 1000) / 10,
    })

    // Propuesta D: Dynamic selection - use station-only IF bias > threshold, else use combinado
    let sumD = 0
    for (let i = 0; i < daily.length; i++) {
      const hist = daily.slice(0, i)
      const histBias = hist.length > 0 ? hist.reduce((s, d) => s + d.error_actual, 0) / hist.length : 0
      const pred = Math.abs(histBias) > 0.4 ? daily[i].temp_corregida + histBias : daily[i].combinado.temp
      sumD += Math.abs(daily[i].temp_real - pred)
    }
    const maeD = sumD / n
    propuestas.push({
      nombre: 'D: Híbrido dinámico (station si bias>0.4, sino combinado)',
      formula: 'if(|avg_hist_error|>0.4) temp+histBias else combinado',
      mae: Math.round(maeD * 1000) / 1000,
      mejora_vs_corregida: Math.round((maeCorr - maeD) / maeCorr * 1000) / 10,
      mejora_vs_combinado: Math.round((maeComb - maeD) / maeComb * 1000) / 10,
    })

    // Propuesta E: Half-bias correction (reduce stationBias by 50%)
    const halfBias = result.estacion_bias_general * 0.5
    const maeE = daily.reduce((s, d) => s + Math.abs(d.temp_real - (d.temp_corregida + halfBias)), 0) / n
    propuestas.push({
      nombre: 'E: Half station bias (50% de corrección)',
      formula: 'temp_corregida + estacion_bias * 0.5',
      mae: Math.round(maeE * 1000) / 1000,
      mejora_vs_corregida: Math.round((maeCorr - maeE) / maeCorr * 1000) / 10,
      mejora_vs_combinado: Math.round((maeComb - maeE) / maeComb * 1000) / 10,
    })

    // --- 8. Top 10 worst errors comparison ---
    const peoresCorr = [...daily].sort((a, b) => Math.abs(b.error_actual) - Math.abs(a.error_actual)).slice(0, 10)
    const peoresComb = [...daily].sort((a, b) => Math.abs(b.combinado.error) - Math.abs(a.combinado.error)).slice(0, 10)

    return res.json({
      ciudad: 'Wuhan',
      muestras: n,
      resumen: {
        mae_corregida: Math.round(sumAbsCorr / n * 1000) / 1000,
        mae_combinado: Math.round(sumAbsComb / n * 1000) / 1000,
        mejora_mae_pct: Math.round(((sumAbsCorr / n) - (sumAbsComb / n)) / (sumAbsCorr / n) * 1000) / 10,
        rmse_corregida: Math.round(Math.sqrt(sumSqCorr / n) * 1000) / 1000,
        rmse_combinado: Math.round(Math.sqrt(sumSqComb / n) * 1000) / 1000,
        bias_corregida: Math.round(sumErrCorr / n * 1000) / 1000,
        bias_combinado: Math.round(sumErrComb / n * 1000) / 1000,
        veces_gana_combinado: vecesGanaComb,
        veces_gana_pct: Math.round(vecesGanaComb / n * 1000) / 10,
        estacion_bias_general: Math.round(result.estacion_bias_general * 1000) / 1000,
      },
      por_rango: porRango,
      por_bias_magnitud: porBias,
      componente_win_rates: {
        station_mejora: Math.round(sumStationCorr / n * 1000) / 10 + '%',
        rapid_mejora: Math.round(sumRapidCorr / n * 1000) / 10 + '%',
        range_mejora: Math.round(sumRangeCorr / n * 1000) / 10 + '%',
      },
      dias_calientes: {
        total: diasCalientes,
        mae_corregida: calienteCorr > 0 ? Math.round(calienteCorr / diasCalientes * 1000) / 1000 : null,
        mae_combinado: calienteComb > 0 ? Math.round(calienteComb / diasCalientes * 1000) / 1000 : null,
      },
      boost: boostInfo,
      propuestas,
      peores_10_corregida: peoresCorr.map(d => ({
        fecha: d.fecha, real: d.temp_real, corregida: d.temp_corregida, error: Math.round(d.error_actual * 1000) / 1000,
        station: d.station.temp, rapid: d.rapid_warming.temp, range: d.range_bias.temp, combinado: d.combinado.temp,
      })),
      peores_10_combinado: peoresComb.map(d => ({
        fecha: d.fecha, real: d.temp_real, corregida: d.temp_corregida, error_comb: Math.round(d.combinado.error * 1000) / 1000,
        station: d.station.temp, rapid: d.rapid_warming.temp, range: d.range_bias.temp, combinado: d.combinado.temp,
      })),
      recomienda_usar: 'temp_corregida',
    })
  } catch (error) {
    console.error('[analisis-wuhan]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
