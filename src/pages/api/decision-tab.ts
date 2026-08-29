import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from '@/lib/cities'
import { kalmanBiasPredictions, estimateKalmanR, getKalmanQ } from '@/lib/kalman-engine'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function roundInt(v: number): number {
  return Math.round(v + 0.05)
}

export interface DecisionDay {
  fecha_objetivo: string
  temp_real: number | null
  base_estimada: boolean
  base_10pm: number | null
  base_11pm: number | null
  mc_10pm: number | null
  mc_11pm: number | null
  mc_err_10pm: number | null
  mc_err_11pm: number | null
  kal_10pm: number | null
  kal_11pm: number | null
  kal_err_10pm: number | null
  kal_err_11pm: number | null
  final_10pm: number | null
  final_11pm: number | null
  final_err_10pm: number | null
  final_err_11pm: number | null
  mc_acierto: boolean | null
  kal_acierto: boolean | null
  final_acierto: boolean | null
  modelo_ganador: string | null
}

export interface DecisionCityResult {
  slug: string
  nombre: string
  modelo_activo: string
  days: DecisionDay[]
  mc_mae: number | null
  kal_mae: number | null
  final_mae: number | null
  mc_aciertos: number
  kal_aciertos: number
  final_aciertos: number
  mc_gana_vs_kal: number
  kal_gana_vs_mc: number
  empates: number
  total_con_real: number
  pendientes: number
  recomendacion: 'MC' | 'KALMAN' | 'FINAL' | 'EMPATE'
  rec_mae_diff: number
}

interface RunData {
  run_type: '10PM' | '11PM'
  has_real_base: boolean
  temp_corregida_base: number
  temp_corregida: number
  modelo_activo: string | null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const client = createClient(supabaseUrl, supabaseKey)
    const daysLimit = parseInt(req.query.dias as string || '60') || 60
    const debug = req.query.debug === '1'

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysLimit - 10)

    const allSlugs = CIUDADES_ASIA.map(c => c.slug)
    const slugNames: Record<string, string> = {}
    CIUDADES_ASIA.forEach((c: any) => { slugNames[c.slug] = c.nombre })

    // ============ 1) forecast_history: temp_real (con filtro + límite alto para evitar corte en 1000) ============
    const realSince = new Date()
    realSince.setDate(realSince.getDate() - daysLimit - 20)
    const { data: fhRecords } = await client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_real')
      .not('temp_real', 'is', null as any)
      .gte('fecha_objetivo', realSince.toISOString().slice(0, 10))
      .order('id', { ascending: false } as any)
      .limit(5000)

    const realMap: Record<string, number> = {}
    for (const r of (fhRecords as any[]) ?? []) {
      const key = r.slug + '|' + r.fecha_objetivo
      realMap[key] = r.temp_real
    }

    // ============ 2) daily_runs — MISMA QUERY que backtest-kalman.ts (probada que funciona) ============
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, resultados')
      .gte('fecha_ejecucion', startDate.toISOString())
      .order('fecha_ejecucion', { ascending: true } as any)

    if (debug) {
      return res.status(200).json({
        _debug: true,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        runsFetched: runs?.length ?? 0,
        realCount: Object.keys(realMap).length,
        slugs: allSlugs,
        sampleRun: runs?.[0] ? {
          id: (runs[0] as any).id,
          fecha_ejecucion: (runs[0] as any).fecha_ejecucion,
          fecha_objetivo: (runs[0] as any).fecha_objetivo,
          run_type: (runs[0] as any).run_type,
          resultados_length: String((runs[0] as any).resultados ?? '').length,
          resultados_preview: String((runs[0] as any).resultados ?? '').substring(0, 300),
        } : null,
      })
    }

    const runDataMap: Record<string, RunData> = {}
    let skippedNoRT = 0
    let skippedNoForecast = 0
    let processedRuns = 0

    for (const run of (runs as any[]) ?? []) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue

      const cronTs10 = new Date(fo + 'T02:00:00.000Z').getTime()
      const cronTs11 = new Date(fo + 'T03:00:00.000Z').getTime()
      const runTs = new Date(run.fecha_ejecucion).getTime()
      // Punto de corte a los 50 min (no 30) para tolerar ejecuciones tardías del cron 10PM
      const cutoff10 = cronTs10 + 50 * 60 * 1000

      let effectiveRT: '10PM' | '11PM' | '' = ''
      if (runTs >= cronTs10 - 60 * 60 * 1000 && runTs < cutoff10) effectiveRT = '10PM'
      else if (runTs >= cutoff10 && runTs < cronTs11 + 90 * 60 * 1000) effectiveRT = '11PM'
      if (!effectiveRT) { skippedNoRT++; continue }

      for (const slug of allSlugs) {
        const cityData = parsed.find((c: any) => c.slug === slug)
        if (!cityData?.forecast) { skippedNoForecast++; continue }

        const realBase = cityData.forecast.temp_corregida_base ?? null
        const final_ = cityData.forecast.temp_corregida ?? null
        if (final_ === null && realBase === null) continue

        const key = slug + '|' + fo + '|' + effectiveRT
        runDataMap[key] = {
          run_type: effectiveRT,
          has_real_base: realBase !== null,
          temp_corregida_base: realBase ?? final_ ?? 0,
          temp_corregida: final_ ?? realBase ?? 0,
          modelo_activo: cityData.forecast.modelo_activo ?? null,
        }
        processedRuns++
      }
    }

    // ============ 2b) FALLBACK: forecast_history con run_type explícito ============
    // Cuando los daily_runs se ejecutan fuera de la ventana horaria esperada
    // (crons manuales, retrasos, etc.), la clasificación por tiempo falla y
    // los datos de ese día desaparecen. Este fallback usa el run_type explícito
    // de forecast_history para recuperar esos días sin cambiar ningún cálculo.
    const fhSince = new Date()
    fhSince.setDate(fhSince.getDate() - daysLimit - 20)
    const fhSinceStr = fhSince.toISOString().slice(0, 10)
    const fhQuery = client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_pronosticada, temp_corregida, run_type, modelos_usados')
      .gte('fecha_objetivo', fhSinceStr)
      .in('run_type', ['10PM', '11PM'])
      .order('id', { ascending: false } as any)
    // Paginar para evitar truncamiento de PostgREST (máx 1000 filas por defecto)
    const FH_PAGE = 1000
    let fhAll: any[] = []
    let fhFrom = 0
    while (true) {
      const { data: fhPage, error: fhErr } = await fhQuery.range(fhFrom, fhFrom + FH_PAGE - 1)
      if (fhErr) break
      if (!fhPage || fhPage.length === 0) break
      fhAll = fhAll.concat(fhPage)
      if (fhPage.length < FH_PAGE) break
      fhFrom += FH_PAGE
    }
    // Llenar runDataMap solo para claves que no tiene (no sobreescribir datos de daily_runs)
    for (const r of fhAll) {
      const key = r.slug + '|' + r.fecha_objetivo + '|' + r.run_type
      if (runDataMap[key]) continue
      let modeloActivo: string | null = null
      try {
        const modelos = typeof r.modelos_usados === 'string' ? JSON.parse(r.modelos_usados) : r.modelos_usados
        modeloActivo = modelos?.active ?? modelos?.modelo_activo ?? null
      } catch { /* ignore */ }
      runDataMap[key] = {
        run_type: r.run_type as '10PM' | '11PM',
        has_real_base: false,
        temp_corregida_base: r.temp_pronosticada ?? r.temp_corregida ?? 0,
        temp_corregida: r.temp_corregida ?? r.temp_pronosticada ?? 0,
        modelo_activo: modeloActivo,
      }
      processedRuns++
    }

    // ============ 3) Por cada slug ============
    const ciudades: Record<string, DecisionCityResult> = {}

    for (const slug of allSlugs) {
      const fechaSet = new Set<string>()
      for (const [key] of Object.entries(runDataMap)) {
        const [s, f] = key.split('|')
        if (s === slug) fechaSet.add(f)
      }
      const fechas = Array.from(fechaSet).sort()
      if (fechas.length === 0) continue

      interface DayInfo {
        fecha: string
        temp_real: number | null
        base_11pm_real: number | null
        base_11pm_final: number | null
        modelo_11pm: string | null
      }
      const dayInfos: DayInfo[] = []
      for (const f of fechas) {
        const real = realMap[slug + '|' + f] ?? null
        const run11 = runDataMap[slug + '|' + f + '|11PM']
        const run10 = runDataMap[slug + '|' + f + '|10PM']
        if (!run11 && !run10) continue
        dayInfos.push({
          fecha: f,
          temp_real: real,
          base_11pm_real: run11?.has_real_base ? run11.temp_corregida_base : null,
          base_11pm_final: run11?.temp_corregida ?? run10?.temp_corregida ?? null,
          modelo_11pm: run11?.modelo_activo ?? run10?.modelo_activo ?? null,
        })
      }

      // Walk-forward errors from days with REAL base
      const validErrors: { fecha: string; error: number }[] = []
      for (const d of dayInfos) {
        if (d.temp_real !== null && d.base_11pm_real !== null) {
          validErrors.push({ fecha: d.fecha, error: d.temp_real - d.base_11pm_real })
        }
      }

      const rawErrors = validErrors.map(e => e.error)
      const R = estimateKalmanR(rawErrors.length > 0 ? rawErrors : [1])
      const cityQ = getKalmanQ(slug)
      const kalPreds = kalmanBiasPredictions(rawErrors.length > 0 ? rawErrors : [0], cityQ, R)

      const biasMap: Record<string, { mc_bias: number; kal_bias: number }> = {}
      let sumErr = 0
      let countErr = 0
      for (let i = 0; i < validErrors.length; i++) {
        const mcBias = countErr > 0 ? sumErr / countErr : 0
        const kalBias = kalPreds[i] ?? 0
        biasMap[validErrors[i].fecha] = { mc_bias: mcBias, kal_bias: kalBias }
        sumErr += validErrors[i].error
        countErr++
      }

      // Reconstruir bases faltantes
      const reconstructedBase: Record<string, number> = {}
      for (const d of dayInfos) {
        if (d.base_11pm_real !== null || d.base_11pm_final === null) continue
        const modelo = d.modelo_11pm
        const biases = biasMap[d.fecha] ?? { mc_bias: 0, kal_bias: 0 }
        let biasToRemove = 0
        if (modelo === 'KALMAN') biasToRemove = biases.kal_bias
        else if (modelo === 'MEJORA CONTINUA') biasToRemove = biases.mc_bias
        reconstructedBase[d.fecha] = round2(d.base_11pm_final - biasToRemove)
      }

      // Resultados finales
      const resultDays: DecisionDay[] = []
      let mcMaeSum = 0, kalMaeSum = 0, finalMaeSum = 0
      let mcHits = 0, kalHits = 0, finalHits = 0
      let mcGana = 0, kalGana = 0, empatesCount = 0
      let totalConReal = 0
      let pendientes = 0
      let lastModelo: string | null = null

      for (const f of fechas) {
        const daysAgo = Math.floor((endDate.getTime() - new Date(f + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
        if (daysAgo < -1 || daysAgo > daysLimit) continue

        const tempReal = realMap[slug + '|' + f] ?? null
        const run10 = runDataMap[slug + '|' + f + '|10PM']
        const run11 = runDataMap[slug + '|' + f + '|11PM']
        if (!run10 && !run11) continue

        const isEstimada10 = run10 ? !run10.has_real_base : false
        const isEstimada11 = run11 ? !run11.has_real_base : false

        let base10: number | null = null
        let base11: number | null = null

        if (run10) {
          if (run10.has_real_base) {
            base10 = run10.temp_corregida_base
          } else {
            const modelo10 = run10.modelo_activo
            const biases10 = biasMap[f] ?? { mc_bias: 0, kal_bias: 0 }
            const bias10 = modelo10 === 'KALMAN' ? biases10.kal_bias : biases10.mc_bias
            base10 = round2(run10.temp_corregida - bias10)
          }
        }
        if (run11) {
          if (run11.has_real_base) {
            base11 = run11.temp_corregida_base
          } else {
            base11 = reconstructedBase[f] ?? null
          }
        }

        const final10 = run10?.temp_corregida ?? null
        const final11 = run11?.temp_corregida ?? null

        if (run11?.modelo_activo) lastModelo = run11.modelo_activo
        else if (run10?.modelo_activo) lastModelo = run10.modelo_activo

        const biases = biasMap[f] ?? { mc_bias: 0, kal_bias: 0 }
        const mc10 = base10 !== null ? round2(base10 + biases.mc_bias) : null
        const mc11 = base11 !== null ? round2(base11 + biases.mc_bias) : null
        const kal10 = base10 !== null ? round2(base10 + biases.kal_bias) : null
        const kal11 = base11 !== null ? round2(base11 + biases.kal_bias) : null

        let mcErr10: number | null = null, mcErr11: number | null = null
        let kalErr10: number | null = null, kalErr11: number | null = null
        let finalErr10: number | null = null, finalErr11: number | null = null
        let mcAcierto: boolean | null = null
        let kalAcierto: boolean | null = null
        let finalAcierto: boolean | null = null

        if (tempReal !== null) {
          totalConReal++
          const rReal = roundInt(tempReal)

          if (mc10 !== null) mcErr10 = round2(Math.abs(mc10 - tempReal))
          if (mc11 !== null) mcErr11 = round2(Math.abs(mc11 - tempReal))
          if (kal10 !== null) kalErr10 = round2(Math.abs(kal10 - tempReal))
          if (kal11 !== null) kalErr11 = round2(Math.abs(kal11 - tempReal))
          if (final10 !== null) finalErr10 = round2(Math.abs(final10 - tempReal))
          if (final11 !== null) finalErr11 = round2(Math.abs(final11 - tempReal))

          const mcRef = mc11 ?? mc10
          const kalRef = kal11 ?? kal10
          const finalRef = final11 ?? final10

          if (mcRef !== null) mcAcierto = roundInt(mcRef) === rReal
          if (kalRef !== null) kalAcierto = roundInt(kalRef) === rReal
          if (finalRef !== null) finalAcierto = roundInt(finalRef) === rReal

          const mcRefErr = mcErr11 ?? mcErr10
          const kalRefErr = kalErr11 ?? kalErr10
          const finalRefErr = finalErr11 ?? finalErr10

          if (mcRefErr !== null) mcMaeSum += mcRefErr
          if (kalRefErr !== null) kalMaeSum += kalRefErr
          if (finalRefErr !== null) finalMaeSum += finalRefErr

          if (mcAcierto) mcHits++
          if (kalAcierto) kalHits++
          if (finalAcierto) finalHits++

          if (mcRefErr !== null && kalRefErr !== null) {
            if (mcRefErr < kalRefErr - 0.01) mcGana++
            else if (kalRefErr < mcRefErr - 0.01) kalGana++
            else empatesCount++
          }
        } else {
          pendientes++
        }

        const estimada = isEstimada10 || isEstimada11

        resultDays.push({
          fecha_objetivo: f,
          temp_real: tempReal,
          base_estimada: estimada,
          base_10pm: base10,
          base_11pm: base11,
          mc_10pm: mc10, mc_11pm: mc11,
          mc_err_10pm: mcErr10, mc_err_11pm: mcErr11,
          kal_10pm: kal10, kal_11pm: kal11,
          kal_err_10pm: kalErr10, kal_err_11pm: kalErr11,
          final_10pm: final10, final_11pm: final11,
          final_err_10pm: finalErr10, final_err_11pm: finalErr11,
          mc_acierto: mcAcierto,
          kal_acierto: kalAcierto,
          final_acierto: finalAcierto,
          modelo_ganador: run11?.modelo_activo ?? run10?.modelo_activo ?? null,
        })
      }

      if (resultDays.length === 0) continue

      const mcMae = totalConReal > 0 ? mcMaeSum / totalConReal : 999
      const kalMae = totalConReal > 0 ? kalMaeSum / totalConReal : 999
      const finalMae = totalConReal > 0 ? finalMaeSum / totalConReal : 999

      let recomendacion: DecisionCityResult['recomendacion'] = 'EMPATE'
      const minMae = Math.min(mcMae, kalMae, finalMae)
      if (Math.abs(mcMae - minMae) < 0.05 && Math.abs(kalMae - minMae) < 0.05 && Math.abs(finalMae - minMae) < 0.05) {
        recomendacion = 'EMPATE'
      } else if (mcMae === minMae) {
        recomendacion = 'MC'
      } else if (kalMae === minMae) {
        recomendacion = 'KALMAN'
      } else {
        recomendacion = 'FINAL'
      }

      ciudades[slug] = {
        slug,
        nombre: slugNames[slug] || slug,
        modelo_activo: lastModelo ?? '-',
        days: resultDays,
        mc_mae: totalConReal > 0 ? round2(mcMae) : null,
        kal_mae: totalConReal > 0 ? round2(kalMae) : null,
        final_mae: totalConReal > 0 ? round2(finalMae) : null,
        mc_aciertos: mcHits,
        kal_aciertos: kalHits,
        final_aciertos: finalHits,
        mc_gana_vs_kal: mcGana,
        kal_gana_vs_mc: kalGana,
        empates: empatesCount,
        total_con_real: totalConReal,
        pendientes,
        recomendacion,
        rec_mae_diff: round2(Math.abs(mcMae - kalMae)),
      }
    }

    return res.status(200).json({
      ciudades,
      _stats: {
        runsFetched: runs?.length ?? 0,
        entriesCreated: processedRuns,
        skippedNoRunType: skippedNoRT,
        skippedNoForecast: skippedNoForecast,
        citiesWithData: Object.keys(ciudades).length,
      }
    })
  } catch (error) {
    console.error('[decision-tab]', error)
    return res.status(500).json({ error: (error as Error).message, stack: (error as any).stack?.substring(0, 500) })
  }
}
