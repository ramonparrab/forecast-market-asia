import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { fetchPolymarketPrices } from '@/lib/polymarket'
import { CIUDADES_ASIA } from '@/lib/cities'
import { detectarRegimen } from '@/lib/regime'
import { calcularLadder, LadderPlan, LadderContractPrice } from '@/lib/ladder'

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const ciudadMap = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))

interface HistRow {
  fecha_objetivo: string
  temp_pronosticada: number | null
  temp_corregida: number | null
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })

  try {
    const slug = (req.query.slug as string) || 'chongqing'
    const monto = parseFloat(req.query.monto as string) || 10
    const nombre = ciudadMap.get(slug) || slug
    const client = createClient(supabaseUrl, supabaseKey)

    // 1. Historial completo de la ciudad (para régimen)
    const { data: allHistory } = await client
      .from('forecast_history' as any)
      .select('fecha_objetivo, temp_pronosticada, temp_corregida, temp_real')
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
    const history: HistRow[] = (allHistory as any[]) || []

    // 3. Régimen del día (deltas sobre el crudo = temp_pronosticada)
    const regimen = detectarRegimen(
      history.map(h => ({ fecha_objetivo: h.fecha_objetivo, temp_pronosticada: h.temp_pronosticada ?? null })),
      currentRecord.fecha_objetivo
    )

    // 4. Precios Polymarket live (contratos exactos con SI% y NO% crudos)
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

    // 5. Verificación de fecha objetivo vs ventana 10-11PM Caracas
    const ahora = new Date()
    const caracas = partsTz('America/Caracas', ahora, 'both')
    const [hC = 0, mC = 0] = (caracas.hora.split(':') || []).map(Number)
    const ventana_10_11pm = (hC === 22 || hC === 23) || (hC === 21 && mC >= 30)
    const manana = new Date(ahora.getTime() + 24 * 60 * 60 * 1000)
    // Dentro de la ventana 10-11PM la diana es el día siguiente en Asia; durante el día, el evento abierto es el día de Asia en curso
    const diana_esperada = ventana_10_11pm
      ? partsTz('Asia/Shanghai', manana, 'date').fecha
      : partsTz('Asia/Shanghai', ahora, 'date').fecha
    const fecha_coincide = currentRecord.fecha_objetivo === diana_esperada

    // 6. Plan ladder según régimen (A2: trans = σ amplia + bankroll/2; crit = NO apostar)
    let plan: LadderPlan
    if (regimen.regimen === 'CRITICO') {
      plan = { inversion: 0, sd: regimen.sd, escalones: [], probabilidad_ganar: 0, ev: 0, peor_caso: 0, sin_contratos: false }
    } else {
      const corregida = currentRecord.temp_corregida != null ? Number(currentRecord.temp_corregida) : null
      if (corregida === null) {
        return res.status(500).json({ error: 'El pronóstico pendiente no tiene temp_corregida' })
      }
      plan = calcularLadder(corregida, regimen.sd, monto * regimen.factorBankroll, priceMap)
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
      corregida: currentRecord.temp_corregida != null ? Number(currentRecord.temp_corregida) : null,
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
      metodologia: 'blend sesgo-corregido (engine 10PM/11PM) · edge SI>=3% · Kelly normalizado · regimen ESTABLE=σ0.85 · TRANSICION=σ1.25 bankroll/2 · CRITICO=no apostar · precio=mid sin vig SI/NO',
    })
  } catch (error) {
    console.error('[ladder-betting]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}