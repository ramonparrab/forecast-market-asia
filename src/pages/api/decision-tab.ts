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
  // Base = temp_corregida_base (ensemble + nowcast + sesgo dinámico, SIN KALMAN ni MC)
  base_10pm: number | null
  base_11pm: number | null
  // MC = base + mean(historical errors on temp_corregida_base)
  mc_10pm: number | null
  mc_11pm: number | null
  mc_err_10pm: number | null
  mc_err_11pm: number | null
  // KALMAN = base + kalman_bias (exponential weighted on same errors)
  kal_10pm: number | null
  kal_11pm: number | null
  kal_err_10pm: number | null
  kal_err_11pm: number | null
  // Final = valor que muestra el Resumen (temp_corregida con modelo ganador ya aplicado)
  final_10pm: number | null
  final_11pm: number | null
  final_err_10pm: number | null
  final_err_11pm: number | null
  // ¿Cuál acierta el entero?
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
  /** Recomendación: cuál usar para apostar */
  recomendacion: 'MC' | 'KALMAN' | 'FINAL' | 'EMPATE'
  rec_mae_diff: number
}

interface RunData {
  run_type: '10PM' | '11PM'
  temp_corregida_base: number
  temp_corregida: number
  modelo_activo: string | null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const client = createClient(supabaseUrl, supabaseKey)
    const daysLimit = parseInt(req.query.dias as string || '60') || 60

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysLimit - 10)

    const allSlugs = CIUDADES_ASIA.map(c => c.slug)
    const slugNames: Record<string, string> = {}
    CIUDADES_ASIA.forEach((c: any) => { slugNames[c.slug] = c.nombre })

    // ============ 1) forecast_history: temp_real por slug+fecha ============
    const { data: fhRecords } = await client
      .from('forecast_history' as any)
      .select('id, slug, fecha_objetivo, temp_real')
      .not('temp_real', 'is', null as any)

    const realMap: Record<string, number> = {}
    for (const r of (fhRecords as any[]) ?? []) {
      const key = r.slug + '|' + r.fecha_objetivo
      realMap[key] = r.temp_real
    }

    // ============ 2) daily_runs: extraer bases y finales por corrida ============
    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, resultados, run_type')
      .gte('fecha_ejecucion', startDate.toISOString())
      .order('fecha_ejecucion', { ascending: true } as any)

    // Organizar: por (slug, fecha, run_type) guardar base y final
    // Si un slug/fecha/run_type tiene múltiples corridas, tomar la última
    const runDataMap: Record<string, RunData> = {}

    for (const run of (runs as any[]) ?? []) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue

      // Determinar run_type
      const rt = (run.run_type as string) || ''
      const cronTs10 = new Date(fo + 'T02:00:00.000Z').getTime()
      const cronTs11 = new Date(fo + 'T03:00:00.000Z').getTime()
      const runTs = new Date(run.fecha_ejecucion).getTime()
      const midpoint = cronTs10 + 30 * 60 * 1000

      let effectiveRT: '10PM' | '11PM' | '' = rt as '10PM' | '11PM' | ''
      if (!effectiveRT) {
        if (runTs >= cronTs10 - 60 * 60 * 1000 && runTs < midpoint) effectiveRT = '10PM'
        else if (runTs >= midpoint && runTs < cronTs11 + 90 * 60 * 1000) effectiveRT = '11PM'
      }
      if (!effectiveRT) continue

      for (const slug of allSlugs) {
        const cityData = parsed.find((c: any) => c.slug === slug)
        if (!cityData?.forecast) continue

        const base = cityData.forecast.temp_corregida_base ?? null
        const final_ = cityData.forecast.temp_corregida ?? null
        const modelo = cityData.forecast.modelo_activo ?? null
        if (base === null && final_ === null) continue

        const key = slug + '|' + fo + '|' + effectiveRT
        // Sobrescribir con la corrida más reciente
        runDataMap[key] = {
          run_type: effectiveRT,
          temp_corregida_base: base ?? final_ ?? 0,
          temp_corregida: final_ ?? base ?? 0,
          modelo_activo: modelo,
        }
      }
    }

    // ============ 3) Construir errores walk-forward por slug ============
    // Para cada slug, necesitamos los errores históricos: temp_real - temp_corregida_base
    // Usamos los datos de 11PM como referencia (los más completos)
    const ciudades: Record<string, DecisionCityResult> = {}

    for (const slug of allSlugs) {
      // Recolectar todas las fechas donde tenemos datos
      const fechaSet = new Set<string>()
      for (const [key] of Object.entries(runDataMap)) {
        const [s, f] = key.split('|')
        if (s === slug) fechaSet.add(f)
      }
      const fechas = Array.from(fechaSet).sort()

      if (fechas.length === 0) continue

      // Build timeline: para cada fecha, obtener (temp_real, base_11pm) para errores
      interface TimelineEntry {
        fecha: string
        temp_real: number | null
        base_11pm: number | null
      }
      const timeline: TimelineEntry[] = []
      for (const f of fechas) {
        const real = realMap[slug + '|' + f] ?? null
        const runKey11 = slug + '|' + f + '|11PM'
        const runKey10 = slug + '|' + f + '|10PM'
        const base = runDataMap[runKey11]?.temp_corregida_base ?? runDataMap[runKey10]?.temp_corregida_base ?? null
        timeline.push({ fecha: f, temp_real: real, base_11pm: base })
      }

      // Compute walk-forward errors: temp_real - temp_corregida_base (del 11PM)
      // Solo días donde tenemos ambos temp_real y base
      const validErrors: { fecha: string; error: number }[] = []
      for (const t of timeline) {
        if (t.temp_real !== null && t.base_11pm !== null) {
          validErrors.push({ fecha: t.fecha, error: t.temp_real - t.base_11pm })
        }
      }

      // Pre-compute MC biases (running mean) and Kalman biases (walk-forward)
      const rawErrors = validErrors.map(e => e.error)
      const R = estimateKalmanR(rawErrors.length > 0 ? rawErrors : [1])
      const cityQ = getKalmanQ(slug)
      const kalPreds = kalmanBiasPredictions(rawErrors.length > 0 ? rawErrors : [0], cityQ, R)

      // Map: fecha -> {mc_bias, kal_bias} (usando solo errores anteriores)
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

      // ============ 4) Construir resultados por día ============
      const resultDays: DecisionDay[] = []
      let mcMaeSum = 0, kalMaeSum = 0, finalMaeSum = 0
      let mcHits = 0, kalHits = 0, finalHits = 0
      let mcGana = 0, kalGana = 0, empatesCount = 0
      let totalConReal = 0
      let pendientes = 0

      // Último modelo activo
      let lastModelo: string | null = null

      for (const f of fechas) {
        const daysAgo = Math.floor((endDate.getTime() - new Date(f + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24))
        if (daysAgo < -1 || daysAgo > daysLimit) continue

        const tempReal = realMap[slug + '|' + f] ?? null
        const run10 = runDataMap[slug + '|' + f + '|10PM']
        const run11 = runDataMap[slug + '|' + f + '|11PM']

        if (!run10 && !run11) continue

        const base10 = run10?.temp_corregida_base ?? null
        const base11 = run11?.temp_corregida_base ?? null
        const final10 = run10?.temp_corregida ?? null
        const final11 = run11?.temp_corregida ?? null

        if (run11?.modelo_activo) lastModelo = run11.modelo_activo
        else if (run10?.modelo_activo) lastModelo = run10.modelo_activo

        // Get biases for this date (computed from errors BEFORE this date)
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

          // Acierto = entero coincide
          const mcRef = mc11 ?? mc10
          const kalRef = kal11 ?? kal10
          const finalRef = final11 ?? final10

          if (mcRef !== null) mcAcierto = roundInt(mcRef) === rReal
          if (kalRef !== null) kalAcierto = roundInt(kalRef) === rReal
          if (finalRef !== null) finalAcierto = roundInt(finalRef) === rReal

          // MAE accumulation (prefer 11PM)
          const mcRefErr = mcErr11 ?? mcErr10
          const kalRefErr = kalErr11 ?? kalErr10
          const finalRefErr = finalErr11 ?? finalErr10

          if (mcRefErr !== null) mcMaeSum += mcRefErr
          if (kalRefErr !== null) kalMaeSum += kalRefErr
          if (finalRefErr !== null) finalMaeSum += finalRefErr

          if (mcAcierto) mcHits++
          if (kalAcierto) kalHits++
          if (finalAcierto) finalHits++

          // Head to head MC vs KALMAN
          if (mcRefErr !== null && kalRefErr !== null) {
            if (mcRefErr < kalRefErr - 0.01) mcGana++
            else if (kalRefErr < mcRefErr - 0.01) kalGana++
            else empatesCount++
          }
        } else {
          pendientes++
        }

        resultDays.push({
          fecha_objetivo: f,
          temp_real: tempReal,
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

      // Recommendation
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

    return res.status(200).json({ ciudades })
  } catch (error) {
    console.error('[decision-tab]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
