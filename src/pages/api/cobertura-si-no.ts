import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeCurrentForecast } from '@/lib/mejora-continua-engine'
import { fetchPolymarketPrices } from '@/lib/polymarket'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const ciudadMap = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))

interface ContractInfo {
  tipo: string
  valor: number | [number, number]
  prob_mkt: number
  texto: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })

  try {
    const slug = (req.query.slug as string) || 'chongqing'
    const montoSI = parseFloat(req.query.monto as string) || 10
    const nombre = ciudadMap.get(slug) || slug
    const client = createClient(supabaseUrl, supabaseKey)

    // 1. Get historical records for bias computation
    const { data: allHistory } = await client
      .from('forecast_history' as any)
      .select('id, fecha_objetivo, slug, temp_corregida, temp_real, error')
      .eq('slug', slug)
      .not('temp_real', 'is', null)
      .order('fecha_objetivo', { ascending: true } as any)

    // 2. Get latest pending forecast for this city
    const { data: pendingRaw } = await client
      .from('forecast_history' as any)
      .select('id, fecha_ejecucion, fecha_objetivo, slug, temp_corregida, temp_real')
      .eq('slug', slug)
      .is('temp_real', null)
      .order('fecha_ejecucion', { ascending: false } as any)
      .limit(1)

    if (!pendingRaw || !(pendingRaw as any[]).length) {
      return res.status(404).json({ error: 'No hay pronóstico pendiente para ' + nombre })
    }

    const currentRecord = (pendingRaw as any[])[0]

    // 3. Compute current mejora forecast
    const history = (allHistory as any[]) || []
    const forecast = computeCurrentForecast(
      history as any,
      { ...currentRecord, ciudad: nombre } as any,
      nombre
    )

    // 4. Fetch live Polymarket prices
    const contratos = await fetchPolymarketPrices(slug, currentRecord.fecha_objetivo)
    if (!contratos || contratos.length === 0) {
      return res.status(404).json({ error: 'No se encontraron contratos de Polymarket para ' + nombre })
    }

    const combinado = forecast.combinado
    const umbralSI = Math.round(combinado)

    // 5. Find contracts for SI portfolio (≥ umbralSI)
    const contratosSI = contratos
      .filter(c => {
        if (c.tipo === 'inferior' || c.tipo === 'rango') return false
        const val = typeof c.valor === 'number' ? c.valor : (Array.isArray(c.valor) ? c.valor[0] : null)
        return val !== null && val >= umbralSI
      })
      .sort((a, b) => {
        const av = typeof a.valor === 'number' ? a.valor : (a.valor as number[])[0]
        const bv = typeof b.valor === 'number' ? b.valor : (b.valor as number[])[0]
        return av - bv
      })

    if (contratosSI.length === 0) {
      return res.status(404).json({ error: 'No hay contratos SI para el umbral ' + umbralSI + '°C' })
    }

    // If there's a "superior" at umbralSI, use only that one
    let usadosSI = contratosSI
    const supUmbral = contratosSI.find(
      c => c.tipo === 'superior' && typeof c.valor === 'number' && c.valor === umbralSI
    )
    if (supUmbral) usadosSI = [supUmbral]

    const costoSIPct = usadosSI.reduce((s, c) => s + c.prob_mkt, 0)
    const costoSIDecimal = costoSIPct / 100

    // SI bet calculations
    const sharesSI = montoSI / costoSIDecimal
    const pagoSiGana = sharesSI
    const gananciaSiGana = pagoSiGana - montoSI

    // 6. Calculate NO hedge options for each available contract
    const opcionesNO: any[] = []

    for (const c of contratos) {
      if (c.tipo === 'rango') continue

      const val = typeof c.valor === 'number' ? c.valor : (Array.isArray(c.valor) ? c.valor[0] : null)
      if (val === null) continue

      // Skip contracts used in SI portfolio (they overlap)
      if (val >= umbralSI) continue

      const siPct = c.prob_mkt
      const noPct = 100 - siPct

      if (noPct < 50) continue

      // B needed to cover A + B
      // B * 100 / noPct >= A + B → B >= A * noPct / siPct
      const bNeeded = Math.ceil(montoSI * noPct / siPct * 100) / 100

      const costNOperShare = noPct / 100
      const sharesNO = bNeeded / costNOperShare
      const pagoNOgana = sharesNO
      const gananciaNOgana = pagoNOgana - bNeeded

      // Scenario: SI wins + NO loses
      const s1_pnl_si = gananciaSiGana
      const s1_pnl_no = -bNeeded
      const s1_total = s1_pnl_si + s1_pnl_no

      // Scenario: SI loses + NO wins (hedge covers)
      const s2_pnl_si = -montoSI
      const s2_pnl_no = gananciaNOgana
      const s2_total = s2_pnl_si + s2_pnl_no

      // Scenario: SI wins + NO wins (both win - temp satisfies both)
      // This happens if temp satisfies both conditions simultaneously
      const s3_pnl_si = gananciaSiGana
      const s3_pnl_no = gananciaNOgana
      const s3_total = s3_pnl_si + s3_pnl_no

      // Scenario: both lose (worst case)
      const s4_pnl_si = -montoSI
      const s4_pnl_no = -bNeeded
      const s4_total = s4_pnl_si + s4_pnl_no

      const etiqueta = c.tipo === 'superior' ? '≥' + val + '°C' : val + '°C'

      opcionesNO.push({
        contrato: { tipo: c.tipo, valor: val, prob_mkt: siPct, texto: c.texto },
        etiqueta,
        si_pct: siPct,
        no_pct: noPct,
        b_necesario: bNeeded,
        shares_no: Math.round(sharesNO * 100) / 100,
        pago_no_gana: Math.round(pagoNOgana * 100) / 100,
        ganancia_no_gana: Math.round(gananciaNOgana * 100) / 100,
        inversion_total: montoSI + bNeeded,
        escenario_si_gana_no_pierde: {
          label: 'Temp ≥ ' + umbralSI + '°C (SI gana, NO pierde)',
          pnl_si: Math.round(s1_pnl_si * 100) / 100,
          pnl_no: Math.round(s1_pnl_no * 100) / 100,
          total: Math.round(s1_total * 100) / 100,
        },
        escenario_si_pierde_no_gana: {
          label: 'Temp < ' + umbralSI + '°C (SI pierde, NO gana → cubierto)',
          pnl_si: Math.round(s2_pnl_si * 100) / 100,
          pnl_no: Math.round(s2_pnl_no * 100) / 100,
          total: Math.round(s2_total * 100) / 100,
        },
        escenario_ambos_ganan: {
          label: 'Temp ≥ ' + Math.max(umbralSI, val) + '°C (ambos ganan)',
          pnl_si: Math.round(s3_pnl_si * 100) / 100,
          pnl_no: Math.round(s3_pnl_no * 100) / 100,
          total: Math.round(s3_total * 100) / 100,
        },
        escenario_peor_caso: {
          label: c.tipo === 'superior'
            ? 'Temp = ' + val + '°C (peor caso: ambos pierden)'
            : 'Temp exactamente ' + val + '°C (peor caso: NO pierde)',
          pnl_si: Math.round(s4_pnl_si * 100) / 100,
          pnl_no: Math.round(s4_pnl_no * 100) / 100,
          total: Math.round(s4_total * 100) / 100,
        },
      })
    }

    // Sort by safety (no_pct descending) then by B needed (ascending)
    opcionesNO.sort((a, b) => {
      if (b.no_pct !== a.no_pct) return b.no_pct - a.no_pct
      return a.b_necesario - b.b_necesario
    })

    const mejorOpcion = opcionesNO.length > 0 ? opcionesNO[0] : null

    return res.json({
      fecha: currentRecord.fecha_objetivo,
      fecha_polymarket: currentRecord.fecha_objetivo,
      fecha_ejecucion_forecast: currentRecord.fecha_ejecucion,
      slug,
      ciudad: nombre,
      timestamp_analisis: new Date().toISOString(),
      combinado,
      umbral_si: umbralSI,
      contratos_si: usadosSI.map(c => ({
        tipo: c.tipo,
        valor: c.valor,
        prob_mkt: c.prob_mkt,
        texto: c.texto,
      })),
      costo_si_pct: costoSIPct + '%',
      apuesta_si: {
        monto: montoSI,
        shares: Math.round(sharesSI * 100) / 100,
        pago_si_gana: Math.round(pagoSiGana * 100) / 100,
        ganancia_si_gana: Math.round(gananciaSiGana * 100) / 100,
        perdida_si_pierde: -montoSI,
      },
      opciones_no: opcionesNO.slice(0, 10),
      mejor_opcion: mejorOpcion,
      total_contratos_disponibles: contratos.length,
      hora_snapshot: '~10pm Caracas',
    })
  } catch (error) {
    console.error('[cobertura-si-no]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
