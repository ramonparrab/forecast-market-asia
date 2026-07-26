import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeAllMejoras } from '@/lib/mejora-continua-engine'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

function roundTemp(v: number): number {
  return Math.floor(v + 0.55)
}

export interface BacktestContract {
  tipo: string
  valor: number | [number, number]
  prob_mkt: number
  multiplicador: number
  multiplicador_neto: number
}

export interface BacktestDayRow {
  fecha: string
  temp_original: number
  temp_mejora: number
  umbral: number
  modo_umbral: string
  contratos_usados: BacktestContract[]
  costo_total_pct: string
  multiplicador: number
  multiplicador_neto: number
  temp_real: number | null
  resultado: 'gana' | 'pierde' | 'pendiente'
}

export interface BacktestSummary {
  total_dias: number
  dias_ganados: number
  dias_perdidos: number
  dias_pendientes: number
  win_rate: number | null
  mult_promedio: number | null
  mult_maximo: number | null
  mult_minimo: number | null
  net_mult_promedio: number | null
}

const ciudadMap = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))

function findContract(contratos: any[], valor: number): any | null {
  // Try exacto first, then superior
  let c = contratos.find((x: any) => x.tipo === 'exacto' && typeof x.valor === 'number' && x.valor === valor)
  if (c) return c
  c = contratos.find((x: any) => x.tipo === 'superior' && typeof x.valor === 'number' && x.valor === valor)
  return c || null
}

function evalResult(tempRealRounded: number | null, tipo: string, valor: number): 'gana' | 'pierde' {
  if (tempRealRounded === null) return 'pierde'
  if (tipo === 'superior') return tempRealRounded >= valor ? 'gana' : 'pierde'
  return tempRealRounded === valor ? 'gana' : 'pierde'
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })

  try {
    const slug = (req.query.slug as string) || 'chongqing'
    const thresholdMode = (req.query.modo as string) || 'forecast'
    const daysLimit = parseInt(req.query.dias as string) || 60
    const estrategia = (req.query.estrategia as string) || 'exacta'

    const client = createClient(supabaseUrl, supabaseKey)

    const { data: allHistory, error: histErr } = await client
      .from('forecast_history' as any)
      .select('id, fecha_objetivo, slug, temp_corregida, temp_real, error')
      .eq('slug', slug)
      .not('temp_real', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    if (histErr) return res.status(500).json({ error: histErr.message })
    if (!allHistory || allHistory.length === 0) return res.json({ slug, results: [], summary: null })

    const seen = new Map<string, any>()
    for (const r of allHistory as any[]) {
      if (!seen.has(r.fecha_objetivo) || r.id > seen.get(r.fecha_objetivo).id) {
        seen.set(r.fecha_objetivo, r)
      }
    }
    const allRecords = Array.from(seen.values())
      .sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

    const nombre = ciudadMap.get(slug) || slug
    const mejoraResult = computeAllMejoras(allRecords as any, nombre)
    const dailyResults = mejoraResult.dailyResults

    const limited = dailyResults.slice(-daysLimit)
    const dates = limited.map(d => d.fecha)

    const { data: runs } = await client
      .from('daily_runs' as any)
      .select('*')
      .in('fecha_objetivo', dates)
      .order('fecha_ejecucion', { ascending: true } as any)

    const runsByDate: Record<string, any[]> = {}
    for (const run of (runs || []) as any[]) {
      const key = run.fecha_objetivo
      if (!runsByDate[key]) runsByDate[key] = []
      runsByDate[key].push(run)
    }

    const results: BacktestDayRow[] = []

    for (const day of limited) {
      const date = day.fecha
      const cityRuns = runsByDate[date] || []
      if (cityRuns.length === 0) continue

      const targetMs = new Date(date + 'T02:00:00Z').getTime()
      let bestRun = cityRuns[0]
      let bestDiff = Infinity
      for (const run of cityRuns) {
        const d = new Date(run.fecha_ejecucion).getTime()
        const diff = Math.abs(d - targetMs)
        if (diff < bestDiff) { bestDiff = diff; bestRun = run }
      }

      let resultados: any[]
      try {
        resultados = typeof bestRun.resultados === 'string'
          ? JSON.parse(bestRun.resultados)
          : bestRun.resultados
      } catch { continue }

      const cityData = resultados.find((r: any) => r.slug === slug)
      if (!cityData?.contratos?.length) continue

      const contratos: any[] = cityData.contratos

      const tempMejora = day.combinado.temp
      const tempOriginal = day.temp_corregida
      const umbralBase = roundTemp(tempMejora)
      const umbral = thresholdMode === 'forecast+1' ? umbralBase + 1 : umbralBase

      if (estrategia === 'consecutiva') {
        const valores = [umbral - 1, umbral, umbral + 1]
        const usados: any[] = []

        for (const v of valores) {
          const c = findContract(contratos, v)
          if (c) {
            const prob = c.prob_mkt
            const mult = prob > 0 ? 100 / prob : 0
            usados.push({
              tipo: c.tipo,
              valor: c.valor,
              prob_mkt: prob,
              multiplicador: Math.round(mult * 100) / 100,
              multiplicador_neto: Math.round((mult - 1) * 100) / 100,
            })
          } else {
            usados.push({
              tipo: null,
              valor: v,
              prob_mkt: null,
              multiplicador: null,
              multiplicador_neto: null,
            })
          }
        }

        const tempReal = day.temp_real
        const tempRealRounded = tempReal !== null ? roundTemp(tempReal) : null

        const resultadosContratos = usados.map(c => {
          if (c.prob_mkt === null) {
            return { ...c, resultado: tempRealRounded !== null && tempRealRounded === c.valor ? 'gana' : 'pierde' }
          }
          return { ...c, resultado: evalResult(tempRealRounded, c.tipo, c.valor) }
        })

        const costoTotalPct = usados.reduce((s, c) => s + (c.prob_mkt || 0), 0)

        const algunGana = resultadosContratos.some(c => c.resultado === 'gana')
        const resultado: 'gana' | 'pierde' | 'pendiente' = tempRealRounded === null ? 'pendiente' : algunGana ? 'gana' : 'pierde'

        const multEfectivo = algunGana && costoTotalPct > 0 ? 100 / costoTotalPct : 0

        results.push({
          fecha: date,
          temp_original: tempOriginal,
          temp_mejora: tempMejora,
          umbral,
          modo_umbral: thresholdMode,
          contratos_usados: resultadosContratos,
          costo_total_pct: costoTotalPct.toFixed(1) + '%',
          multiplicador: Math.round(multEfectivo * 100) / 100,
          multiplicador_neto: Math.round((multEfectivo - 1) * 100) / 100,
          temp_real: tempReal,
          resultado,
        })
      } else {
        const tempReal = day.temp_real
        const tempRealRounded = tempReal !== null ? roundTemp(tempReal) : null

        // Buscar contrato real de Polymarket (el que se habría comprado)
        const relevantes = contratos.filter((c: any) => {
          if (c.tipo === 'inferior' || c.tipo === 'rango') return false
          const val = typeof c.valor === 'number' ? c.valor : (Array.isArray(c.valor) ? c.valor[0] : null)
          return val !== null && val >= umbral
        }).sort((a: any, b: any) => {
          const av = typeof a.valor === 'number' ? a.valor : a.valor[0]
          const bv = typeof b.valor === 'number' ? b.valor : b.valor[0]
          return av - bv
        })

        const usado = relevantes.length > 0
          ? (relevantes.find(
              (c: any) => c.tipo === 'superior' && typeof c.valor === 'number' && c.valor === umbral
            ) || relevantes[0])
          : null

        // GANA/PIERDE se decide contra el contrato real (exacto o superior)
        let resultado: 'gana' | 'pierde' | 'pendiente'
        if (tempRealRounded === null) {
          resultado = 'pendiente'
        } else if (usado) {
          const cVal = typeof usado.valor === 'number' ? usado.valor : (Array.isArray(usado.valor) ? usado.valor[0] : null)
          if (cVal !== null && usado.tipo === 'superior') {
            resultado = tempRealRounded >= cVal ? 'gana' : 'pierde'
          } else if (cVal !== null) {
            resultado = tempRealRounded === cVal ? 'gana' : 'pierde'
          } else {
            resultado = tempRealRounded >= umbral ? 'gana' : 'pierde'
          }
        } else {
          resultado = tempRealRounded >= umbral ? 'gana' : 'pierde'
        }

        if (usado) {
          const probMkt = usado.prob_mkt
          const multIndiv = probMkt > 0 ? 100 / probMkt : 0
          const multNetoIndiv = multIndiv - 1
          results.push({
            fecha: date,
            temp_original: tempOriginal,
            temp_mejora: tempMejora,
            umbral,
            modo_umbral: thresholdMode,
            contratos_usados: [{
              tipo: usado.tipo,
              valor: usado.valor,
              prob_mkt: probMkt,
              multiplicador: Math.round(multIndiv * 100) / 100,
              multiplicador_neto: Math.round(multNetoIndiv * 100) / 100,
            }],
            costo_total_pct: probMkt.toFixed(1) + '%',
            multiplicador: Math.round(multIndiv * 100) / 100,
            multiplicador_neto: Math.round(multNetoIndiv * 100) / 100,
            temp_real: tempReal,
            resultado,
          })
        } else {
          results.push({
            fecha: date,
            temp_original: tempOriginal,
            temp_mejora: tempMejora,
            umbral,
            modo_umbral: thresholdMode,
            contratos_usados: [],
            costo_total_pct: '-',
            multiplicador: 0,
            multiplicador_neto: 0,
            temp_real: tempReal,
            resultado,
          })
        }
      }
    }

    const ganados = results.filter(r => r.resultado === 'gana')
    const perdidos = results.filter(r => r.resultado === 'pierde')
    const pendientes = results.filter(r => r.resultado === 'pendiente')
    const total = ganados.length + perdidos.length

    const multsGanados = ganados.map(r => r.multiplicador)
    const multProm = multsGanados.length > 0 ? multsGanados.reduce((s, m) => s + m, 0) / multsGanados.length : null
    const multMax = multsGanados.length > 0 ? Math.max(...multsGanados) : null
    const multMin = multsGanados.length > 0 ? Math.min(...multsGanados) : null
    const netMultProm = multProm !== null ? multProm - 1 : null

    const summary: BacktestSummary = {
      total_dias: total,
      dias_ganados: ganados.length,
      dias_perdidos: perdidos.length,
      dias_pendientes: pendientes.length,
      win_rate: total > 0 ? Math.round(ganados.length / total * 10000) / 100 : null,
      mult_promedio: multProm !== null ? Math.round(multProm * 100) / 100 : null,
      mult_maximo: multMax !== null ? Math.round(multMax * 100) / 100 : null,
      mult_minimo: multMin !== null ? Math.round(multMin * 100) / 100 : null,
      net_mult_promedio: netMultProm !== null ? Math.round(netMultProm * 100) / 100 : null,
    }

    const primeraFecha = results.length > 0 ? results[results.length - 1].fecha : null
    const ultimaFecha = results.length > 0 ? results[0].fecha : null

    const distribucionGanadores: Record<string, number> = {}
    if (estrategia === 'consecutiva') {
      for (const r of results) {
        const ganador = r.contratos_usados.find((c: any) => c.resultado === 'gana')
        if (ganador) {
          const val = typeof ganador.valor === 'number' ? ganador.valor : (Array.isArray(ganador.valor) ? ganador.valor[0] : null)
          if (val !== null) {
            const diff = val - r.umbral
            const key = diff === 0 ? 'prono' : diff === -1 ? 'menos1' : diff === 1 ? 'mas1' : `otro_${diff >= 0 ? '+' : ''}${diff}`
            distribucionGanadores[key] = (distribucionGanadores[key] || 0) + 1
          }
        } else {
          distribucionGanadores['ninguno'] = (distribucionGanadores['ninguno'] || 0) + 1
        }
      }
    }

    return res.json({ slug, thresholdMode, estrategia, results, summary, primeraFecha, ultimaFecha, distribucionGanadores })
  } catch (error) {
    console.error('[backtest-si]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}