import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { fetchPolymarketPrices, fetchEventoCerrado } from '@/lib/polymarket'
import { runDailyAnalysis } from '@/lib/forecast-engine'
import { saveDailyRun, saveForecastRecords } from '@/lib/supabase'
import { CIUDADES_ASIA } from '@/lib/cities'
import { detectarRegimen } from '@/lib/regime'
import { calcularLadderEmpirica, calcularLadderGauss, LadderPlan, LadderContractPrice, roundInt, round2, histogramaEnteros } from '@/lib/ladder'
import { kalmanBiasPredictions, kalmanNextBias, estimateKalmanR, KALMAN_Q } from '@/lib/kalman-engine'
import { computeAllMejoras, computeCurrentForecast } from '@/lib/mejora-continua-engine'
import { getModeloActivo } from '@/lib/modelo-selector'
import { HistoricalRecord } from '@/types'

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const ciudadMap = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))
const VENTANA_MODELOS = 45
const MIN_MUESTRAS_EMPIRICA = 15
const MIN_MUESTRAS_HORA = 10
const PLAN_TTL = 120 * 1000
const planCache = new Map<string, { ts: number; data: Record<string, unknown> }>()

export const maxDuration = 120

const generacionEnCurso = new Map<string, Promise<void>>()

function addDias(fecha: string, n: number): string {
  const d = new Date(fecha + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function asegurarGeneracionManana(fechaNext: string): Promise<void> {
  const enCurso = generacionEnCurso.get(fechaNext)
  if (enCurso) return enCurso
  const gen = (async () => {
    const result = await runDailyAnalysis(fechaNext, true)
    const records = result.cities.map(city => ({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fechaNext,
      ciudad: city.ciudad,
      slug: city.slug,
      temp_pronosticada: city.forecast.temp_ponderada,
      temp_corregida: city.forecast.temp_corregida_base ?? city.forecast.temp_corregida,
      temp_real: null,
      error: null,
      modelos_usados: Object.keys(city.forecast.ensemble_raw || {}).length,
      consenso: city.forecast.consenso,
    }))
    await saveForecastRecords(records)
    await saveDailyRun({
      fecha_ejecucion: result.fecha,
      fecha_objetivo: fechaNext,
      resultados: result.cities,
      recomendaciones: result.recommendations,
      total_asignado: result.total_allocated,
    })
  })().finally(() => generacionEnCurso.delete(fechaNext))
  generacionEnCurso.set(fechaNext, gen)
  await gen
}

export interface PlanCtx {
  pending?: any
  history?: any[]
  runs?: any[]
}

function partsTz(tz: string, d: Date, extra: 'date' | 'both'): { fecha: string; hora: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    ...(extra === 'both' ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
  const parts = fmt.formatToParts(d)
  const get = (t: string) => (parts.find(p => p.type === t) || { value: '00' }).value
  const dia = `${get('year')}-${get('month')}-${get('day')}`
  return { fecha: dia, hora: `${get('hour')}:${get('minute')}` }
}

function mae(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + Math.abs(b), 0) / arr.length
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })
  try {
    const slug = (req.query.slug as string) || 'chongqing'
    const monto = parseFloat(req.query.monto as string) || 10
    return res.json(await buildPlanData(slug, monto))
  } catch (error) {
    console.error('[ladder-betting]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}

export async function buildPlanData(slug: string, monto: number, ctx?: PlanCtx): Promise<Record<string, unknown>> {
  const nombre = ciudadMap.get(slug) || slug
  if (!ctx) {
    const ck = slug + '|' + monto
    const hit = planCache.get(ck)
    if (hit && Date.now() - hit.ts < PLAN_TTL) return hit.data
  }
  const client = createClient(supabaseUrl, supabaseKey)
  const ahora = new Date()

  // 1. Último pronóstico pendiente (target del día)
  const pendingRes = ctx?.pending != null
    ? { data: [ctx.pending] }
    : await client
        .from('forecast_history' as any)
        .select('id, fecha_ejecucion, fecha_objetivo, slug, temp_pronosticada, temp_corregida, temp_real')
        .eq('slug', slug)
        .is('temp_real', null)
        .order('fecha_ejecucion', { ascending: false } as any)
        .limit(1)

    if (!(pendingRes as any).data || !(pendingRes as any).data.length) {
      throw new Error('[404] No hay pronóstico pendiente para ' + nombre)
    }

    let currentRecord = (pendingRes as any).data[0]
    const fechaOriginal = currentRecord.fecha_objetivo
    let objetivoAvanzado = false
    const startHour = new Date(ahora.getTime() - (VENTANA_MODELOS + 10) * 24 * 60 * 60 * 1000)

    // 1b. Historial + corridas horarias + estado del mercado (paralelo)
    let mercadoCerrado = false
    const [[allHistoryRes, runsRes], estadoMercado] = await Promise.all([
      Promise.all([
        ctx?.history != null
          ? Promise.resolve({ data: ctx.history })
          : client
              .from('forecast_history' as any)
              .select('fecha_objetivo, temp_pronosticada, temp_corregida, temp_real, error')
              .eq('slug', slug)
              .order('fecha_objetivo', { ascending: true } as any),
        ctx?.runs != null
          ? Promise.resolve({ data: ctx.runs })
          : client
              .from('daily_runs' as any)
              .select('fecha_ejecucion, fecha_objetivo, resultados')
              .gte('fecha_ejecucion', startHour.toISOString()),
      ]),
      fetchEventoCerrado(slug, currentRecord.fecha_objetivo),
    ])
    mercadoCerrado = estadoMercado

    // 1c. Si el mercado del día objetivo ya CERRÓ/RESOLVIÓ → la escalera avanza
    // automáticamente al próximo día: usa el pendiente existente o lo GENERA bajo
    // demanda la primera vez (mismo pipeline del cron), dedup en memoria.
    if (mercadoCerrado) {
      const nextDate = addDias(currentRecord.fecha_objetivo, 1)
      const queryNext = () =>
        client
          .from('forecast_history' as any)
          .select('id, fecha_ejecucion, fecha_objetivo, slug, temp_pronosticada, temp_corregida, temp_real')
          .eq('slug', slug)
          .eq('fecha_objetivo', nextDate)
          .is('temp_real', null)
          .order('fecha_ejecucion', { ascending: false } as any)
          .limit(1)
      let nextRes = await queryNext()
      let nextRecord = (nextRes as any).data?.[0] ?? null
      if (!nextRecord) {
        await asegurarGeneracionManana(nextDate)
        nextRes = await queryNext()
        nextRecord = (nextRes as any).data?.[0] ?? null
        if (!nextRecord) {
          throw new Error(`[404] Mercado de ${nombre} [${currentRecord.fecha_objetivo}] cerrado y no se pudo generar el pronóstico para ${nextDate}`)
        }
      }
      currentRecord = nextRecord
      objetivoAvanzado = true
      mercadoCerrado = await fetchEventoCerrado(slug, currentRecord.fecha_objetivo)
    }

    const history = (allHistoryRes as any).data || []

    // basePorHora[slug|fecha] = { base10, base11, ts10, ts11 }
    const basePorHora: Record<string, { base10: number | null; base11: number | null; ts10: number | null; ts11: number | null }> = {}
    for (const run of ((runsRes as any).data ?? []) as any[]) {
      const fo = run.fecha_objetivo as string
      if (!fo) continue
      let parsed: any[]
      try { parsed = JSON.parse(run.resultados) } catch { continue }
      if (!Array.isArray(parsed)) continue
      const cityData = parsed.find((c: any) => c.slug === slug)
      if (!cityData) continue
      const tc = cityData?.forecast?.temp_corregida_base ?? cityData?.forecast?.temp_corregida
      if (tc == null) continue
      const runTs = new Date(run.fecha_ejecucion).getTime()
      const key = slug + '|' + fo
      const entry = basePorHora[key] || { base10: null, base11: null, ts10: null, ts11: null }
      basePorHora[key] = entry
      const cron10 = new Date(fo + 'T02:00:00.000Z').getTime()
      const cron11 = new Date(fo + 'T03:00:00.000Z').getTime()
      if (runTs >= cron10 && (entry.ts10 == null || runTs < entry.ts10!)) {
        entry.base10 = Number(tc); entry.ts10 = runTs
      }
      if (runTs >= cron11 && (entry.ts11 == null || runTs < entry.ts11!)) {
        entry.base11 = Number(tc); entry.ts11 = runTs
      }
    }

    // 4. Régimen del día (deltas sobre el crudo)
    const regimen = detectarRegimen(
      history.map((h: any) => ({ fecha_objetivo: h.fecha_objetivo, temp_pronosticada: h.temp_pronosticada ?? null })),
      currentRecord.fecha_objetivo
    )

    // 4. Walk-forward KALMAN vs MEJORA CONTINUA (sin look-ahead)
    const validos = history
      .filter((h: any) => h.temp_real != null && h.temp_corregida != null)
      .map((h: any) => ({
        ...h,
        error: h.error != null ? Number(h.error) : Number(h.temp_real) - Number(h.temp_corregida),
      }))
      .sort((a: any, b: any) => a.fecha_objetivo.localeCompare(b.fecha_objetivo)) as any[]

    const errs = validos.map((h: any) => h.error)
    const R = estimateKalmanR(errs)
    const preds = kalmanBiasPredictions(errs, KALMAN_Q, R)
    const seriesK = validos.map((h: any, i: number) => Number(h.temp_corregida) + preds[i])

    const mc = computeAllMejoras(
      validos.map((h: any) => ({ ...h, slug })) as HistoricalRecord[],
      nombre
    )
    const seriesM = mc.dailyResults.map(d => d.combinado.temp)
    const mcCorr = mc.dailyResults.map((d, i) => d.combinado.temp - Number(validos[i].temp_corregida))

    const desde = Math.max(0, validos.length - VENTANA_MODELOS)

    // ==== 4b. Combos modelo x hora (base 10PM/11PM de daily_runs + corrección del modelo) ====
    const combosMae: Record<string, number | null> = { kal_10pm: null, kal_11pm: null, mc_10pm: null, mc_11pm: null }
    let muestrasHoras = 0
    const errCombo: Record<string, number[]> = { kal_10pm: [], kal_11pm: [], mc_10pm: [], mc_11pm: [] }
    for (let i = desde; i < validos.length; i++) {
      const h = validos[i]
      const bH = basePorHora[slug + '|' + h.fecha_objetivo]
      if (!bH) continue
      const real = Number(h.temp_real)
      let tuvo = false
      if (bH.base10 != null) {
        errCombo.kal_10pm.push(real - (bH.base10 + preds[i]))
        errCombo.mc_10pm.push(real - (bH.base10 + mcCorr[i]))
        tuvo = true
      }
      if (bH.base11 != null) {
        errCombo.kal_11pm.push(real - (bH.base11 + preds[i]))
        errCombo.mc_11pm.push(real - (bH.base11 + mcCorr[i]))
        tuvo = true
      }
      if (tuvo) muestrasHoras++
    }
    const horarioDisponible = muestrasHoras >= MIN_MUESTRAS_HORA
    Object.keys(errCombo).forEach(k => {
      const arr = errCombo[k]
      combosMae[k] = arr.length >= MIN_MUESTRAS_HORA ? mae(arr) : null
    })

    // ==== 4c. Stored-series comparison (fallback) ====
    const errsK = validos.slice(desde).map((h: any, i: number) => Number(h.temp_real) - seriesK[desde + i])
    const errsM = validos.slice(desde).map((h: any, i: number) => Number(h.temp_real) - seriesM[desde + i])
    const maeK = mae(errsK)
    const maeM = mae(errsM)
    const ganadorStored = maeK <= maeM ? 'KALMAN' : 'MEJORA CONTINUA'

    // Mejor combo global: modelo x hora (si hay suficientes corridas horarias)
    let modeloGanador = ganadorStored
    let horaGanadora: '10PM' | '11PM' | null = null
    if (horarioDisponible) {
      const mejor = (Object.entries(combosMae).filter(([, v]) => v != null) as [string, number][])
        .sort((a, b) => a[1] - b[1])[0]
      if (mejor) {
        modeloGanador = mejor[0].startsWith('kal') ? 'KALMAN' : 'MEJORA CONTINUA'
        horaGanadora = mejor[0].endsWith('_10pm') ? '10PM' : '11PM'
      }
    }

    // Valor del día pendiente: base de la hora ganadora + modelo ganador
    if (currentRecord.temp_corregida == null) {
      throw new Error('[404] El pronóstico pendiente de ' + nombre + ' no tiene temp_corregida — no hay valor para armar ladder')
    }
    const pendCorr = Number(currentRecord.temp_corregida)
    const bHoy = basePorHora[slug + '|' + currentRecord.fecha_objetivo]
    const base10Hoy = bHoy?.base10 ?? null
    const base11Hoy = bHoy?.base11 ?? null
    const baseForModel = horaGanadora === '10PM' ? (base10Hoy ?? pendCorr) : horaGanadora === '11PM' ? (base11Hoy ?? pendCorr) : pendCorr
    let valorHoy: number
    if (modeloGanador === 'KALMAN') {
      valorHoy = errs.length > 0 ? baseForModel + kalmanNextBias(errs, KALMAN_Q, R) : baseForModel
    } else {
      const cf = computeCurrentForecast(validos as HistoricalRecord[], {
        slug,
        fecha_objetivo: currentRecord.fecha_objetivo,
        fecha_ejecucion: '',
        ciudad: '',
        temp_pronosticada: baseForModel,
        temp_corregida: baseForModel,
        temp_real: null,
        error: null,
        modelos_usados: 0,
        consenso: '',
      } as HistoricalRecord, nombre)
      valorHoy = cf?.combinado ?? baseForModel
    }

    // 5. Histograma empírico del combo ganador (o stored si no hay horas)
    let histSeriesCorr: number[] = []
    let histSeriesReal: number[] = []
    if (horarioDisponible) {
      for (let i = desde; i < validos.length; i++) {
        const h = validos[i]
        const bH = basePorHora[slug + '|' + h.fecha_objetivo]
        if (!bH) continue
        const b = horaGanadora === '11PM' ? bH.base11 : bH.base10
        if (b == null) continue
        const v = modeloGanador === 'KALMAN' ? b + preds[i] : b + mcCorr[i]
        histSeriesCorr.push(v)
        histSeriesReal.push(Number(h.temp_real))
      }
    }
    const { hist, n } = horarioDisponible
      ? histogramaEnteros(histSeriesCorr, histSeriesReal, VENTANA_MODELOS)
      : histogramaEnteros(
          ganadorStored === 'KALMAN' ? seriesK.slice(desde) : seriesM.slice(desde),
          validos.slice(desde).map((h: any) => Number(h.temp_real)),
          VENTANA_MODELOS
        )
    const histPct = Object.fromEntries(
      Object.entries(hist)
        .map(([e, c]) => [e, Math.round((100 * (c as number)) / Math.max(n, 1))])
        .sort((a, b) => Number(a[0]) - Number(b[0]))
    )

    // 6. Precios Polymarket live (contratos exactos con SI% y NO%)
    const contratos = await fetchPolymarketPrices(slug, currentRecord.fecha_objetivo)
    const priceMap: Record<number, LadderContractPrice> = {}
    for (const c of contratos) {
      if (c.tipo !== 'exacto' || typeof c.valor !== 'number') continue
      if (c.prob_mkt <= 0) continue
      const si = c.si_pct != null ? c.si_pct : c.prob_mkt
      const no = c.no_pct != null ? c.no_pct : 100 - si
      priceMap[c.valor] = {
        precio: Math.round((c.prob_mkt / 100) * 1000) / 1000,
        si,
        no,
      }
    }

    // 7. Verificación de fecha objetivo vs ventana 10-11PM Caracas
    const caracas = partsTz('America/Caracas', ahora, 'both')
    const [hC = 0, mC = 0] = (caracas.hora.split(':') || []).map(Number)
    const ventana_10_11pm = (hC === 22 || hC === 23) || (hC === 21 && mC >= 30)
    const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000)
    const diana_esperada = ventana_10_11pm
      ? partsTz('Asia/Shanghai', manana, 'date').fecha
      : partsTz('Asia/Shanghai', ahora, 'date').fecha
    const fecha_coincide = currentRecord.fecha_objetivo === diana_esperada

    // 8. Plan ladder: empírico del ganador (mezcla gauss en TRANSICIÓN), gauss si poco historial
    let plan: LadderPlan
    if (mercadoCerrado) {
      plan = {
        inversion: 0, sd: regimen.sd, escalones: [], probabilidad_ganar: 0, ev: 0, peor_caso: 0,
        sin_contratos: false, empirica: false,
        motivo_no_bet: `🔒 MERCADO CERRADO/RESUELTO — el evento [${nombre} ${currentRecord.fecha_objetivo}] ya cerró. Este día NO es apostable; la escalera espera el próximo día objetivo.`,
      }
    } else if (regimen.regimen === 'CRITICO') {
      plan = { inversion: 0, sd: regimen.sd, escalones: [], probabilidad_ganar: 0, ev: 0, peor_caso: 0, sin_contratos: false, empirica: false }
    } else if (n >= MIN_MUESTRAS_EMPIRICA) {
      plan = calcularLadderEmpirica(valorHoy, hist, n, regimen.sd, monto * regimen.factorBankroll, priceMap, regimen.regimen === 'TRANSICION')
    } else {
      plan = calcularLadderGauss(valorHoy, regimen.sd, monto * regimen.factorBankroll, priceMap)
    }

    const out = {
      fecha: currentRecord.fecha_objetivo,
      fecha_caracas: caracas.fecha,
      hora_caracas: caracas.hora,
      ventana_10_11pm,
      diana_esperada,
      fecha_coincide,
      fecha_ejecucion_forecast: currentRecord.fecha_ejecucion,
      slug,
      ciudad: nombre,
      timestamp_analisis: new Date().toISOString(),
      crudo: currentRecord.temp_pronosticada != null ? Number(currentRecord.temp_pronosticada) : null,
      corregida: pendCorr,
      modelo_ganador: modeloGanador,
      hora_ganadora: horaGanadora,
      combos_mae: {
        kal_10pm: combosMae.kal_10pm != null ? round2(combosMae.kal_10pm) : null,
        kal_11pm: combosMae.kal_11pm != null ? round2(combosMae.kal_11pm) : null,
        mc_10pm: combosMae.mc_10pm != null ? round2(combosMae.mc_10pm) : null,
        mc_11pm: combosMae.mc_11pm != null ? round2(combosMae.mc_11pm) : null,
      },
      muestras_horas: muestrasHoras,
      base_10pm_hoy: base10Hoy != null ? round2(base10Hoy) : null,
      base_11pm_hoy: base11Hoy != null ? round2(base11Hoy) : null,
      modelo_asignado: getModeloActivo(slug),
      mae_kalman: round2(maeK),
      mae_mc: round2(maeM),
      ventana_modelos: validos.length - desde,
      hist_error_entero: histPct,
      muestras_hist: n,
      valor_hoy_modelo: round2(valorHoy),
      base_usada: round2(baseForModel),
      bias_hoy: round2(valorHoy - baseForModel),
      regimen: regimen.regimen,
      regimen_detalle: {
        delta1: regimen.delta1,
        tendencia: regimen.tendencia,
        motivo: regimen.motivo,
        sd: regimen.sd,
        factor_bankroll: regimen.factorBankroll,
      },
      bankroll_solicitado: monto,
      mercado_cerrado: mercadoCerrado,
      objetivo_avanzado: objetivoAvanzado,
      objetivo_cerrado_saltado: objetivoAvanzado ? fechaOriginal : null,
      plan,
      contratos_disponibles: contratos.length,
      hora_snapshot: horaGanadora ? 'Corrida ' + (horaGanadora === '10PM' ? '02:00Z' : '03:00Z') + ' (10PM/11PM Caracas)' : '~10-11pm Caracas',
      nota_horas: horarioDisponible
        ? 'daily_runs guarda corridas por hora (02:00Z=10PM y 03:00Z=11PM Caracas). El LADDER compara los 4 combos modelo×hora y usa el mejor: ' + modeloGanador + ' @ ' + (horaGanadora || '—') + ' (MAE ' + (combosMae[horaGanadora === '10PM' ? (modeloGanador === 'KALMAN' ? 'kal_10pm' : 'mc_10pm') : horaGanadora === '11PM' ? (modeloGanador === 'KALMAN' ? 'kal_11pm' : 'mc_11pm') : 'kal_10pm']) + '°) — ' + muestrasHoras + ' días con corrida horaria.'
        : 'No hubo suficientes corridas horarias en daily_runs (' + muestrasHoras + ' < ' + MIN_MUESTRAS_HORA + '): se usó la serie almacenada sin comparación 10PM/11PM.',
      metodologia: 'escalera NO-PERDER: montos proporcionales al % de Polymarket (más dinero a los % más altos) → todo escalón paga > inversión si Σ precios ≤ 95% · se descartan escalones de peor valor hasta cumplir, si no → NO-BET · CRITICO=no apostar',
    }
    if (!ctx) planCache.set(slug + '|' + monto, { ts: Date.now(), data: out })
    return out
}