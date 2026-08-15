import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
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
  temp_pronosticada: number
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

    // Leer temp_real verificados de forecast_snapshot (misma fuente que RESUMEN)
    const { data: snapshots, error: snapErr } = await client
      .from('forecast_snapshot' as any)
      .select('fecha_objetivo, slug, temp_corregida, temp_real, run_type_ganadora')
      .eq('slug', slug)
      .not('temp_real', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    if (snapErr) return res.status(500).json({ error: snapErr.message })
    if (!snapshots || (snapshots as any[]).length === 0) return res.json({ slug, results: [], summary: null })

    // Deduplicar por fecha (quedar con el winner)
    const seen = new Map<string, any>()
    for (const r of snapshots as any[]) {
      if (!seen.has(r.fecha_objetivo)) {
        seen.set(r.fecha_objetivo, r)
      }
    }
    const allRecords = Array.from(seen.values())
      .sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

    // Limitar por días
    const limited = daysLimit >= 999 ? allRecords : allRecords.slice(-daysLimit)
    const dates = limited.map(r => r.fecha_objetivo)

    if (dates.length === 0) return res.json({ slug, results: [], summary: null })

    // Obtener contratos de daily_runs
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

    // Para cada fecha, elegir el run winner (igual que RESUMEN)
    const { data: allSnapshots } = await client
      .from('forecast_snapshot' as any)
      .select('fecha_objetivo, slug, run_type_ganadora')
      .in('fecha_objetivo', dates)
      .eq('slug', slug)

    const winnerByDate: Record<string, string> = {}
    for (const s of (allSnapshots ?? []) as any[]) {
      winnerByDate[s.fecha_objetivo] = s.run_type_ganadora ?? '11PM'
    }

    const results: BacktestDayRow[] = []

    for (const record of limited) {
      const date = record.fecha_objetivo
      const tempPronosticada = record.temp_corregida
      const tempReal = record.temp_real

      if (tempPronosticada === null || tempPronosticada === undefined) continue

      // Elegir el run winner
      const cityRuns = runsByDate[date] || []
      if (cityRuns.length === 0) continue

      const preferred = winnerByDate[date] ?? '11PM'
      let bestRun = cityRuns.find((r: any) => r.run_type === preferred) ?? cityRuns[cityRuns.length - 1]

      let resultados: any[]
      try {
        resultados = typeof bestRun.resultados === 'string'
          ? JSON.parse(bestRun.resultados)
          : bestRun.resultados
      } catch { continue }

      const cityData = resultados.find((r: any) => r.slug === slug)
      if (!cityData?.contratos?.length) continue

      const contratos: any[] = cityData.contratos
      const umbralBase = roundTemp(tempPronosticada)
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
              tipo: c.tipo, valor: c.valor, prob_mkt: prob,
              multiplicador: Math.round(mult * 100) / 100,
              multiplicador_neto: Math.round((mult - 1) * 100) / 100,
            })
          } else {
            usados.push({ tipo: null, valor: v, prob_mkt: null, multiplicador: null, multiplicador_neto: null })
          }
        }

        const tempRealRounded = tempReal !== null ? roundTemp(tempReal) : null

        const resultadosContratos = usados.map(c => {
          if (c.prob_mkt === null) {
            return { ...c, resultado: tempRealRounded !== null && tempRealRounded === c.valor ? 'gana' : 'pierde' }
          }
          return { ...c, resultado: evalResult(tempRealRounded, c.tipo, c.valor) }
        })

        const costoTotalPct = usados.reduce((s, c) => s + (c.prob_mkt || 0), 0)
        const algunGana = resultadosContratos.some((c: any) => c.resultado === 'gana')
        const resultado: 'gana' | 'pierde' | 'pendiente' = tempRealRounded === null ? 'pendiente' : algunGana ? 'gana' : 'pierde'
        const multEfectivo = algunGana && costoTotalPct > 0 ? 100 / costoTotalPct : 0

        results.push({
          fecha: date, temp_pronosticada: tempPronosticada, umbral, modo_umbral: thresholdMode,
          contratos_usados: resultadosContratos,
          costo_total_pct: costoTotalPct.toFixed(1) + '%',
          multiplicador: Math.round(multEfectivo * 100) / 100,
          multiplicador_neto: Math.round((multEfectivo - 1) * 100) / 100,
          temp_real: tempReal, resultado,
        })
      } else {
        const tempRealRounded = tempReal !== null ? roundTemp(tempReal) : null

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
          ? (relevantes.find((c: any) => c.tipo === 'superior' && typeof c.valor === 'number' && c.valor === umbral) || relevantes[0])
          : null

        let resultado: 'gana' | 'pierde' | 'pendiente'
        if (tempRealRounded === null) {
          resultado = 'pendiente'
        } else if (usado) {
          const cVal = typeof usado.valor === 'number' ? usado.valor : (Array.isArray(usado.valor) ? usado.valor[0] : null)
          if (cVal !== null && cVal === umbral && usado.tipo === 'superior') {
            resultado = tempRealRounded >= cVal ? 'gana' : 'pierde'
          } else if (cVal !== null && cVal === umbral) {
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
          results.push({
            fecha: date, temp_pronosticada: tempPronosticada, umbral, modo_umbral: thresholdMode,
            contratos_usados: [{
              tipo: usado.tipo, valor: usado.valor, prob_mkt: probMkt,
              multiplicador: Math.round(multIndiv * 100) / 100,
              multiplicador_neto: Math.round((multIndiv - 1) * 100) / 100,
            }],
            costo_total_pct: probMkt.toFixed(1) + '%',
            multiplicador: Math.round(multIndiv * 100) / 100,
            multiplicador_neto: Math.round((multIndiv - 1) * 100) / 100,
            temp_real: tempReal, resultado,
          })
        } else {
          results.push({
            fecha: date, temp_pronosticada: tempPronosticada, umbral, modo_umbral: thresholdMode,
            contratos_usados: [], costo_total_pct: '-', multiplicador: 0, multiplicador_neto: 0,
            temp_real: tempReal, resultado,
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
      total_dias: total, dias_ganados: ganados.length, dias_perdidos: perdidos.length,
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
            const key = diff === 0 ? 'prono' : diff === -1 ? 'menos1' : diff === 1 ? 'mas1' : `otro`
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
