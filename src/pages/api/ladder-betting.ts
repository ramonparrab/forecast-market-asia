import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { fetchPolymarketPrices } from '@/lib/polymarket'
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
    const nombre = ciudadMap.get(slug) || slug
    const client = createClient(supabaseUrl, supabaseKey)

    // 1. Historial completo de la ciudad (régimen + walk-forward de modelos)
    const { data: allHistory } = await client
      .from('forecast_history' as any)
      .select('fecha_objetivo, temp_pronosticada, temp_corregida, temp_real, error')
      .eq('slug', slug)
      .order('fecha_objetivo', { ascending: true } as any)

    // 2. Último pronóstico pendiente (target del día)
    const { data: pendingRaw } = await client
      .from('forecast_history' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, slug, temp_pronosticada, temp_corregida, temp_real')
      .eq('slug', slug)
      .is('temp_real', null)
      .order('fecha_ejecucion', { ascending: false } as any)
      .limit(1)

    if (!pendingRaw || !(pendingRaw as any[]).length) {
      return res.status(404).json({ error: 'No hay pronóstico pendiente para ' + nombre })
    }

    const currentRecord = (pendingRaw as any[])[0]
    const history = (allHistory || []) as any[]

    // 3. Régimen del día (deltas sobre el crudo)
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

    const desde = Math.max(0, validos.length - VENTANA_MODELOS)
    const errsK = validos.slice(desde).map((h: any, i: number) => Number(h.temp_real) - seriesK[desde + i])
    const errsM = validos.slice(desde).map((h: any, i: number) => Number(h.temp_real) - seriesM[desde + i])
    const maeK = mae(errsK)
    const maeM = mae(errsM)
    const ganador = maeK <= maeM ? 'KALMAN' : 'MEJORA CONTINUA'

    // Valor del día pendiente con el modelo ganador del historial reciente
    const pendCorr = Number(currentRecord.temp_corregida)
    const baseForModel = pendCorr
    let valorHoy: number
    if (ganador === 'KALMAN') {
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

    // 5. Histograma empírico de desviación entera del ganador (últimos N días)
    const { hist, n } = histogramaEnteros(
      ganador === 'KALMAN' ? seriesK.slice(desde) : seriesM.slice(desde),
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
    const ahora = new Date()
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
    if (regimen.regimen === 'CRITICO') {
      plan = { inversion: 0, sd: regimen.sd, escalones: [], probabilidad_ganar: 0, ev: 0, peor_caso: 0, sin_contratos: false, empirica: false }
    } else if (n >= MIN_MUESTRAS_EMPIRICA) {
      plan = calcularLadderEmpirica(valorHoy, hist, n, regimen.sd, monto * regimen.factorBankroll, priceMap, regimen.regimen === 'TRANSICION')
    } else {
      plan = calcularLadderGauss(valorHoy, regimen.sd, monto * regimen.factorBankroll, priceMap)
    }

    return res.json({
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
      modelo_ganador: ganador,
      modelo_asignado: getModeloActivo(slug),
      mae_kalman: round2(maeK),
      mae_mc: round2(maeM),
      ventana_modelos: validos.length - desde,
      hist_error_entero: histPct,
      muestras_hist: n,
      valor_hoy_modelo: round2(valorHoy),
      regimen: regimen.regimen,
      regimen_detalle: {
        delta1: regimen.delta1,
        tendencia: regimen.tendencia,
        motivo: regimen.motivo,
        sd: regimen.sd,
        factor_bankroll: regimen.factorBankroll,
      },
      bankroll_solicitado: monto,
      plan,
      contratos_disponibles: contratos.length,
      hora_snapshot: '~10-11pm Caracas',
      nota_horas: 'El sistema guarda UNA corrida por día dentro de la ventana 10-11PM Caracas (02-03Z) — no se almacenan 10PM y 11PM por separado, por lo que no es posible comparar horas dentro del mismo día.',
      metodologia: 'walk-forward KALMAN vs MEJORA CONTINUA (ventana ' + (validos.length - desde) + 'd) · distribucion = histograma empirico del ganador (' + n + ' muestras) + mezcla gauss en TRANSICION · edge SI>=3% · Kelly normalizado · CRITICO=no apostar',
    })
  } catch (error) {
    console.error('[ladder-betting]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}