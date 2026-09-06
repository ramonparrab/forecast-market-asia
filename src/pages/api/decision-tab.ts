import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from '@/lib/cities'
import { kalmanBiasPredictions, kalmanNextBias, estimateKalmanR, getKalmanQ } from '@/lib/kalman-engine'
import { shadowProbsContratos } from '@/lib/shadow'

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
  /** Cubo redondeado al que se refiere p_prod_cubo/p_som_cubo (round(real) si resolvió, si no round(temp_corregida)) */
  cubo: number | null
  /** Prob PRODUCCIÓN (prob_ia_norm) del cubo — solo visual, no afecta la recomendación */
  p_prod_cubo: number | null
  /** Prob SOMBRA v2 (receta congelada) del mismo cubo — solo visual, no afecta la recomendación */
  p_som_cubo: number | null
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
  /** Sombra v2 (solo visual): cubo elegido y probs prod/sombra de ese cubo */
  cubo: number | null
  p_prod_cubo: number | null
  p_som_cubo: number | null
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

    // ============ 1b) forecast_snapshot: temp_10pm y temp_11pm INMUTABLES ============
    // Los snapshots guardan el valor exacto que produjo cada corrida.
    // Estos NUNCA cambian después de que el cron correspondiente ejecutó.
    // Se usan directamente como final_10pm y final_11pm en vez de
    // reconstruirlos desde daily_runs (que pueden ser sobrescritos por
    // ejecuciones manuales o fallbacks de forecast_history).
    const snapSince = new Date()
    snapSince.setDate(snapSince.getDate() - daysLimit - 10)
    const snapSinceStr = snapSince.toISOString().slice(0, 10)
    const { data: snapRecords } = await client
      .from('forecast_snapshot' as any)
      .select('slug, fecha_objetivo, temp_10pm, temp_11pm, modelo_10pm, modelo_11pm, modelo_ganador, run_type_ganadora')
      .gte('fecha_objetivo', snapSinceStr)
    // Mapa: slug|fecha → { temp_10pm, temp_11pm, modelo_10pm, modelo_11pm }
    const snapshotFinalMap: Record<string, { temp_10pm: number | null; temp_11pm: number | null; modelo_10pm: string | null; modelo_11pm: string | null }> = {}
    for (const s of (snapRecords as any[]) ?? []) {
      const key = s.slug + '|' + s.fecha_objetivo
      snapshotFinalMap[key] = {
        temp_10pm: s.temp_10pm,
        temp_11pm: s.temp_11pm,
        modelo_10pm: s.modelo_10pm,
        modelo_11pm: s.modelo_11pm,
      }
    }

    // ============ 2) daily_runs — paginado para evitar corte PostgREST en 1000 ============
    const allRuns: any[] = []
    let runsPage = 0
    const RUNS_PAGE = 500
    while (true) {
      const { data: page } = await client
        .from('daily_runs' as any)
        .select('id, fecha_ejecucion, fecha_objetivo, resultados, run_type')
        .gte('fecha_ejecucion', startDate.toISOString())
        .order('fecha_ejecucion', { ascending: true } as any)
        .range(runsPage, runsPage + RUNS_PAGE - 1)
      if (!page || page.length === 0) break
      allRuns.push(...page)
      if (page.length < RUNS_PAGE) break
      runsPage += RUNS_PAGE
    }

    if (debug) {
      return res.status(200).json({
        _debug: true,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        runsFetched: allRuns.length,
        realCount: Object.keys(realMap).length,
        slugs: allSlugs,
        sampleRun: allRuns[0] ? {
          id: (allRuns[0] as any).id,
          fecha_ejecucion: (allRuns[0] as any).fecha_ejecucion,
          fecha_objetivo: (allRuns[0] as any).fecha_objetivo,
          run_type: (allRuns[0] as any).run_type,
          resultados_length: String((allRuns[0] as any).resultados ?? '').length,
          resultados_preview: String((allRuns[0] as any).resultados ?? '').substring(0, 300),
        } : null,
      })
    }

    const runDataMap: Record<string, RunData> = {}
    let skippedNoRT = 0
    let skippedNoForecast = 0
    let processedRuns = 0

    for (const run of allRuns) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue

      // Usar run_type de la columna directamente — no adivinar por timestamp
      const rt = (run.run_type as string || '').toUpperCase()
      const effectiveRT: '10PM' | '11PM' | '' =
        rt === '10PM' ? '10PM' : rt === '11PM' ? '11PM' : ''
      if (!effectiveRT) { skippedNoRT++; continue }

      for (const slug of allSlugs) {
        const cityData = parsed.find((c: any) => c.slug === slug)
        if (!cityData?.forecast) { skippedNoForecast++; continue }

        const realBase = cityData.forecast.temp_corregida_base ?? null
        const final_ = cityData.forecast.temp_corregida ?? null
        if (final_ === null && realBase === null) continue

        // ===== SOMBRA v2 (solo visual — NO afecta la recomendación) =====
        // Receta congelada calculada al vuelo sobre los contratos GUARDADOS de
        // esta corrida (mismo instante de captura que prob_ia_norm/prob_mkt).
        // Cubo mostrado: round(temp_real) si el día ya resolvió ("cuánto pagó
        // cada versión por lo que pasó"), si no round(temp_corregida) ("cuánto
        // paga cada versión por el cubo del centro HOY").
        let cubo: number | null = null
        let pProdCubo: number | null = null
        let pSomCubo: number | null = null
        const contratos: any[] = Array.isArray(cityData.contratos) ? cityData.contratos : []
        const centroNum = Number(final_)
        if (contratos.length > 0 && final_ !== null && !isNaN(centroNum)) {
          const probs = shadowProbsContratos(contratos, centroNum)
          const exactos = contratos
            .map((c: any, i: number) => ({ c, i }))
            .filter((x: any) => x.c && x.c.tipo === 'exacto' && typeof x.c.valor === 'number')
          if (probs && exactos.length > 0) {
            const real = realMap[slug + '|' + fo] ?? null
            const bucketObjetivo = real !== null ? Math.round(real) : Math.round(centroNum)
            let pick = exactos.find((x: any) => Number(x.c.valor) === bucketObjetivo) ?? null
            if (!pick) {
              // El cubo objetivo no está listado (real de cola) → exacto más cercano al cubo del centro
              const centroBucket = Math.round(centroNum)
              pick = exactos.reduce((best: any, x: any) =>
                Math.abs(Number(x.c.valor) - centroBucket) < Math.abs(Number(best.c.valor) - centroBucket) ? x : best)
            }
            cubo = Number(pick.c.valor)
            pProdCubo = typeof pick.c.prob_ia_norm === 'number'
              ? Math.max(0, Math.min(1, Number(pick.c.prob_ia_norm)))
              : null
            pSomCubo = typeof probs[pick.i] === 'number'
              ? Math.max(0, Math.min(1, Number(probs[pick.i])))
              : null
          }
        }

        const key = slug + '|' + fo + '|' + effectiveRT
        runDataMap[key] = {
          run_type: effectiveRT,
          has_real_base: realBase !== null,
          temp_corregida_base: realBase ?? final_ ?? 0,
          temp_corregida: final_ ?? realBase ?? 0,
          modelo_activo: cityData.forecast.modelo_activo ?? null,
          cubo,
          p_prod_cubo: pProdCubo,
          p_som_cubo: pSomCubo,
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
    // TIME GATE: solo incluir forecast_history si el cron correspondiente ya ejecutó.
    // 10PM cron = fecha_objetivo T02:00Z, 11PM cron = fecha_objetivo T03:00Z.
    // Esto evita mostrar datos de runs MANUAL o fuera de ventana para fechas futuras.
    const nowUtcMs = Date.now()
    for (const r of fhAll) {
      const key = r.slug + '|' + r.fecha_objetivo + '|' + r.run_type
      if (runDataMap[key]) continue
      // TIME GATE: verificar que el cron para este run_type ya pasó
      const cronTs = r.run_type === '10PM'
        ? new Date(r.fecha_objetivo + 'T02:00:00.000Z').getTime()
        : new Date(r.fecha_objetivo + 'T03:00:00.000Z').getTime()
      if (nowUtcMs < cronTs) continue
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
        cubo: null,
        p_prod_cubo: null,
        p_som_cubo: null,
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
      // Último bias conocido para fechas sin temp_real (walk-forward)
      // kal_bias: estado del filtro DESPUÉS de procesar todos los errores
      //   (no kalPreds[last] que es la predicción ANTES del último error)
      const lastKnownBias: { mc_bias: number; kal_bias: number } = validErrors.length > 0
        ? { mc_bias: sumErr / countErr, kal_bias: kalmanNextBias(rawErrors, cityQ, R) }
        : { mc_bias: 0, kal_bias: 0 }

      // Reconstruir bases faltantes
      const reconstructedBase: Record<string, number> = {}
      for (const d of dayInfos) {
        if (d.base_11pm_real !== null || d.base_11pm_final === null) continue
        const modelo = d.modelo_11pm
        const biases = biasMap[d.fecha] ?? lastKnownBias
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
            const biases10 = biasMap[f] ?? lastKnownBias
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

        // FINAL values vienen de forecast_snapshot (INMUTABLES).
        // Una vez que el cron 10PM ejecuta y guarda snapshot.temp_10pm,
        // ese valor NUNCA cambia, sin importar lo que pase después.
        const snap = snapshotFinalMap[slug + '|' + f]
        const final10 = snap?.temp_10pm ?? null
        const final11 = snap?.temp_11pm ?? null

        if (run11?.modelo_activo) lastModelo = run11.modelo_activo
        else if (run10?.modelo_activo) lastModelo = run10.modelo_activo

        // SOMBRA v2 (solo visual): 11PM preferido, 10PM de respaldo
        const somInfo =
          run11 && (run11.p_prod_cubo !== null || run11.p_som_cubo !== null)
            ? run11
            : run10 && (run10.p_prod_cubo !== null || run10.p_som_cubo !== null)
              ? run10
              : null

        const biases = biasMap[f] ?? lastKnownBias
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
          modelo_ganador: snap?.modelo_11pm ?? snap?.modelo_10pm ?? run11?.modelo_activo ?? run10?.modelo_activo ?? null,
          cubo: somInfo?.cubo ?? null,
          p_prod_cubo: somInfo?.p_prod_cubo ?? null,
          p_som_cubo: somInfo?.p_som_cubo ?? null,
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
        runsFetched: allRuns.length,
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
