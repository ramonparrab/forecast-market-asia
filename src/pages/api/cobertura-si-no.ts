import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeCurrentForecast } from '@/lib/mejora-continua-engine'
import { fetchPolymarketPrices, calculateLiquidity } from '@/lib/polymarket'
import { CIUDADES_ASIA } from '@/lib/cities'

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const ciudadMap = new Map(CIUDADES_ASIA.map(c => [c.slug, c.nombre]))

// ─────────────────────────────────────────────────────────────────────────────
// COBERTURA SI/NO — 3 modos:
//   modo=noperder  (default) → diseño original NO-PERDER (SÍ umbral + NO lejano) + fix umbral
//   modo=estrella            → ESTRELLA+ABANICO (estilo Bilberry): 75% SÍ estrella + 25% abanico NO ±1/±2
//   modo=ranking             → TOP 5 ciudades del día (convicción × liquidez × zona de precio)
// Entradas SIEMPRE a las 10PM y 11PM hora Caracas (timing habitual de la app).
// ─────────────────────────────────────────────────────────────────────────────

interface ContractInfo {
  tipo: string
  valor: number | [number, number]
  prob_mkt: number
  texto: string
}

const r2 = (x: number) => Math.round(x * 100) / 100

// Trae forecast pendiente + historial + pronóstico corriente + contratos PM de una ciudad
async function getCityData(client: any, slug: string) {
  const nombre = ciudadMap.get(slug) || slug

  const { data: allHistory } = await client
    .from('forecast_history')
    .select('id, fecha_objetivo, slug, temp_corregida, temp_real, error')
    .eq('slug', slug)
    .not('temp_real', 'is', null)
    .order('fecha_objetivo', { ascending: true })

  const { data: pendingRaw } = await client
    .from('forecast_history')
    .select('id, fecha_ejecucion, fecha_objetivo, slug, temp_corregida, temp_real')
    .eq('slug', slug)
    .is('temp_real', null)
    .order('fecha_ejecucion', { ascending: false })
    .limit(1)

  if (!pendingRaw || !pendingRaw.length) return { error: 'No hay pronóstico pendiente para ' + nombre }

  const currentRecord = pendingRaw[0]
  const history = allHistory || []
  const forecast = computeCurrentForecast(history, { ...currentRecord, ciudad: nombre }, nombre)
  const contratos = await fetchPolymarketPrices(slug, currentRecord.fecha_objetivo)
  if (!contratos || contratos.length === 0) return { error: 'No se encontraron contratos de Polymarket para ' + nombre }

  return { nombre, currentRecord, forecast, contratos }
}

// ── MODO ESTRELLA+ABANICO ────────────────────────────────────────────────────
function buildEstrella(combinado: number, contratos: any[], monto: number) {
  const star = Math.round(combinado)
  const exactos = contratos.filter(
    (c: any) => c.tipo === 'exacto' && typeof c.valor === 'number'
  ) as any[]

  // Estrella: contrato exacto del cubo; si no existe, el más cercano
  let starContract = exactos.find(c => c.valor === star)
  let umbralAjustado: number | null = null
  if (!starContract && exactos.length) {
    starContract = exactos.reduce((a: any, b: any) =>
      Math.abs(b.valor - star) < Math.abs(a.valor - star) ? b : a
    )
    umbralAjustado = starContract.valor
  }
  if (!starContract) return { error: 'Sin contratos exactos para definir la estrella' }

  const starPrice = starContract.prob_mkt / 100

  // Zona de precio (Bilberry: zona dulce 35-95c)
  const zona =
    starContract.prob_mkt > 95 ? 'CARA'
    : starContract.prob_mkt >= 35 ? 'DULCE'
    : starContract.prob_mkt >= 20 ? 'AGRESIVA'
    : 'LOTERIA'

  // Reparto: 75% estrella / 25% abanico
  const stakeStar = r2(monto * 0.75)
  const stakeFanTotal = r2(monto * 0.25)
  const sharesStar = r2(stakeStar / starPrice)

  // Abanico NO en vecinos ±1 (peso 1.0) y ±2 (peso 0.5), stake ∝ prob del vecino
  const fanDefs = [
    { off: -1, peso: 1.0 }, { off: 1, peso: 1.0 },
    { off: -2, peso: 0.5 }, { off: 2, peso: 0.5 },
  ]
  const fanRaw = fanDefs
    .map(d => {
      const c = exactos.find(x => x.valor === star + d.off)
      if (!c) return null
      if (c.prob_mkt < 2 || c.prob_mkt > 75) return null
      return { contrato: c, off: d.off, peso: d.peso, weight: c.prob_mkt * d.peso }
    })
    .filter(Boolean) as any[]

  const weightSum = fanRaw.reduce((s: number, f: any) => s + f.weight, 0)
  const abanico = fanRaw.map(f => {
    const stake = r2(weightSum > 0 ? (stakeFanTotal * f.weight) / weightSum : stakeFanTotal / fanRaw.length)
    const noPrice = (100 - f.contrato.prob_mkt) / 100
    return {
      bucket: f.contrato.valor,
      distancia: f.off,
      etiqueta: f.contrato.valor + '°C',
      si_pct: f.contrato.prob_mkt,
      no_pct: 100 - f.contrato.prob_mkt,
      stake,
      shares_no: r2(stake / noPrice),
      pago_si_no_cae: r2(stake / noPrice),      // paga $1/share si la temp NO es ese entero
      texto: f.contrato.texto,
    }
  })

  // Σ masa cubierta = p(estrella) + Σ p(vecinos del abanico)
  const sigmaCobertura = r2((starContract.prob_mkt + abanico.reduce((s: number, a: any) => s + a.si_pct, 0)) / 100)

  // Escenarios: P&L según el entero real
  const pnlPara = (k: number | 'OTRO') => {
    const si = k === starContract.valor ? sharesStar : 0
    const no = abanico.reduce((s: number, a: any) => s + (k !== a.bucket ? a.shares_no : 0), 0)
    return r2(si + no - monto)
  }
  const escenarios: any[] = [
    {
      caso: 'LA ESTRELLA (' + starContract.valor + '°C)',
      tipo: 'estrella',
      detalle: 'SÍ paga + TODOS los NO del abanico pagan',
      pnl: pnlPara(starContract.valor),
    },
    ...abanico.map(a => ({
      caso: 'VECINO ' + a.bucket + '°C (' + (a.distancia > 0 ? '+' : '') + a.distancia + '°)',
      tipo: 'vecino',
      detalle: 'SÍ pierde + ese NO pierde; los demás NO pagan',
      pnl: pnlPara(a.bucket),
    })),
    {
      caso: 'OTRO ENTERO (±3° o más)',
      tipo: 'otro',
      detalle: 'SÍ pierde + TODOS los NO del abanico pagan',
      pnl: pnlPara('OTRO'),
    },
  ]

  // Esperanza del mercado (para convicción del ranking)
  const pmap: Record<number, number> = {}
  for (const c of contratos) {
    if (c.tipo === 'rango' || typeof c.valor !== 'number') continue
    pmap[c.valor] = (pmap[c.valor] || 0) + c.prob_mkt
  }
  const pSuma = Object.values(pmap).reduce((s: number, x: number) => s + x, 0) || 1
  const evMercado = r2(Object.entries(pmap).reduce((s: number, [k, p]: any) => s + (Number(k) * p) / pSuma, 0))

  return {
    estrella: {
      bucket: starContract.valor,
      etiqueta: starContract.valor + '°C',
      precio_si_pct: starContract.prob_mkt,
      precio_no_pct: 100 - starContract.prob_mkt,
      zona,
      zona_detalle:
        zona === 'DULCE' ? 'Zona dulce de Bilberry (35-95¢): historically donde vive el edge'
        : zona === 'CARA' ? 'Estrella cara (>95¢): poco valor, el mercado ya lo da por hecho'
        : zona === 'AGRESIVA' ? 'Zona agresiva (20-35¢): paga 3-5x si acierta, acierto más bajo'
        : 'Zona lotería (<20¢): mediana histórica negativa — stake pequeño o evitar',
      stake: stakeStar,
      shares: sharesStar,
      pago_si_gana: r2(sharesStar),
      ganancia_si_gana: r2(sharesStar - stakeStar),
      texto: starContract.texto,
    },
    abanico,
    suma_cobertura: sigmaCobertura,
    escenarios,
    mejor_caso: escenarios[0].pnl,
    peor_caso: Math.min(...escenarios.map(e => e.pnl)),
    ev_mercado: evMercado,
    conviccion: r2(Math.abs(combinado - evMercado)),
    umbral_ajustado: umbralAjustado,
    reparto: { estrella_pct: 75, abanico_pct: 25 },
  }
}

// ── MODO NO-PERDER (original + fix del bug de umbral) ───────────────────────
function buildNoPerder(combinado: number, contratos: any[], montoSI: number) {
  const umbralSI = Math.round(combinado)

  const contratosSI = contratos
    .filter((c: any) => {
      if (c.tipo === 'inferior' || c.tipo === 'rango') return false
      const val = typeof c.valor === 'number' ? c.valor : (Array.isArray(c.valor) ? c.valor[0] : null)
      return val !== null && val >= umbralSI
    })
    .sort((a: any, b: any) => {
      const av = typeof a.valor === 'number' ? a.valor : (a.valor as number[])[0]
      const bv = typeof b.valor === 'number' ? b.valor : (b.valor as number[])[0]
      return av - bv
    })

  // FIX: si no hay contratos al/por encima del umbral → usar el contrato (exacto|superior)
  // más cercano al umbral desde abajo. Antes: 404 "No hay contratos SI para el umbral X°C".
  let usadosSI = contratosSI
  let umbralAjustado: number | null = null
  const supUmbral = contratosSI.find(
    (c: any) => c.tipo === 'superior' && typeof c.valor === 'number' && c.valor === umbralSI
  )
  if (supUmbral) {
    usadosSI = [supUmbral]
  } else if (contratosSI.length === 0) {
    const candidatos = contratos.filter(
      (c: any) => (c.tipo === 'exacto' || c.tipo === 'superior') && typeof c.valor === 'number'
    )
    if (candidatos.length === 0) return { error: 'No hay contratos exactos ni superiores en el mercado' }
    const masCercano = candidatos.reduce((a: any, b: any) =>
      Math.abs(b.valor - umbralSI) < Math.abs(a.valor - umbralSI) ? b : a
    )
    usadosSI = [masCercano]
    umbralAjustado = masCercano.valor
  }

  const costoSIPct = usadosSI.reduce((s: number, c: any) => s + c.prob_mkt, 0)
  const costoSIDecimal = costoSIPct / 100
  const sharesSI = montoSI / costoSIDecimal
  const pagoSiGana = sharesSI
  const gananciaSiGana = pagoSiGana - montoSI

  const opcionesNO: any[] = []
  for (const c of contratos) {
    if (c.tipo === 'rango') continue
    const val = typeof c.valor === 'number' ? c.valor : (Array.isArray(c.valor) ? c.valor[0] : null)
    if (val === null) continue
    if (val >= umbralSI) continue
    const siPct = c.prob_mkt
    const noPct = 100 - siPct
    if (noPct < 50) continue

    const bNeeded = Math.ceil(montoSI * (noPct / siPct) * 100) / 100
    const costNOperShare = noPct / 100
    const sharesNO = bNeeded / costNOperShare
    const pagoNOgana = sharesNO
    const gananciaNOgana = pagoNOgana - bNeeded

    const s1 = { label: 'Temp ≥ ' + umbralSI + '°C (SI gana, NO pierde)', pnl_si: r2(gananciaSiGana), pnl_no: r2(-bNeeded), total: r2(gananciaSiGana - bNeeded) }
    const s2 = { label: 'Temp < ' + umbralSI + '°C (SI pierde, NO gana → cubierto)', pnl_si: r2(-montoSI), pnl_no: r2(gananciaNOgana), total: r2(-montoSI + gananciaNOgana) }
    const s3 = { label: 'Temp ≥ ' + Math.max(umbralSI, val) + '°C (ambos ganan)', pnl_si: r2(gananciaSiGana), pnl_no: r2(gananciaNOgana), total: r2(gananciaSiGana + gananciaNOgana) }
    const s4 = { label: c.tipo === 'superior' ? 'Temp = ' + val + '°C (peor caso: ambos pierden)' : 'Temp exactamente ' + val + '°C (peor caso: NO pierde)', pnl_si: r2(-montoSI), pnl_no: r2(-bNeeded), total: r2(-montoSI - bNeeded) }

    opcionesNO.push({
      contrato: { tipo: c.tipo, valor: val, prob_mkt: siPct, texto: c.texto },
      etiqueta: c.tipo === 'superior' ? '≥' + val + '°C' : val + '°C',
      si_pct: siPct,
      no_pct: noPct,
      b_necesario: bNeeded,
      shares_no: r2(sharesNO),
      pago_no_gana: r2(pagoNOgana),
      ganancia_no_gana: r2(gananciaNOgana),
      inversion_total: r2(montoSI + bNeeded),
      escenario_si_gana_no_pierde: s1,
      escenario_si_pierde_no_gana: s2,
      escenario_ambos_ganan: s3,
      escenario_peor_caso: s4,
    })
  }
  opcionesNO.sort((a: any, b: any) => (b.no_pct !== a.no_pct ? b.no_pct - a.no_pct : a.b_necesario - b.b_necesario))

  return {
    umbral_si: umbralSI,
    umbral_ajustado: umbralAjustado,
    contratos_si: usadosSI.map((c: any) => ({ tipo: c.tipo, valor: c.valor, prob_mkt: c.prob_mkt, texto: c.texto })),
    costo_si_pct: costoSIPct + '%',
    apuesta_si: {
      monto: montoSI,
      shares: r2(sharesSI),
      pago_si_gana: r2(pagoSiGana),
      ganancia_si_gana: r2(gananciaSiGana),
      perdida_si_pierde: r2(-montoSI),
    },
    opciones_no: opcionesNO.slice(0, 10),
    mejor_opcion: opcionesNO.length > 0 ? opcionesNO[0] : null,
  }
}

// ── LEYENDAS compartidas ─────────────────────────────────────────────────────
const LEYENDAS = {
  timing: '⏰ Las entradas se ejecutan a las 10PM y 11PM hora Caracas, como siempre — igual que el resto de la app. Nada de adelantar compras.',
  noperder:
    'QUÉ ES ESTE MODO: compras el SÍ del umbral (nuestro pronóstico redondeado) y lo cubres con un NO de un contrato lejano y barato. Objetivo: NO perder el día — si la temperatura cae lejos del umbral, el NO rescata la inversión. Coste: la cobertura se come parte de la ganancia cuando aciertas.',
  estrella:
    'QUÉ ES ESTE MODO (inspirado en BILBERRY, la wallet más rentable de clima en Polymarket: +$26,191 en 30 días): concentras el 75% del monto en el SÍ de UN solo cubo — la estrella, nuestro pronóstico redondeado — y repartes el 25% en un abanico de NO sobre los vecinos ±1° y ±2°. Cada NO paga siempre que la temperatura NO sea ese entero exacto. Diferencia clave con NO-PERDER: aquí SÍ puedes perder el día (si la temperatura cae exactamente en un vecino con NO grande), pero la esperanza histórica por evento es de +17% a +20%. A cambio, si la estrella acierta ganan TODAS las patas a la vez.',
  abanico:
    'El abanico NO: cada contrato NO gana en TODOS los escenarios excepto cuando la temperatura cae EXACTAMENTE en su entero. Por eso el vecino ±1° (el fallo más probable de la estrella) se lleva el mayor peso. Bilberry: 79% de su dinero NO acabó en el bucket ganador — cobró el decay sin quemarse.',
  sigma:
    'Σ cobertura = probabilidad de mercado de que la temperatura caiga en ALGUNO de los enteros donde tenemos posición (estrella + abanico). Bilberry opera con Σ≈0.57: acepta no cubrir el 43% restante. Nuestro modo NO-PERDER cubre Σ≤0.95.',
  ranking:
    'CÓMO SE ELIGE EL TOP 5: (1) CONVICCIÓN = |nuestro pronóstico − esperanza del mercado| — cuánto creemos que el mercado está mal centrado; (2) LIQUIDEZ del libro (volumen 24h y spread de la estrella); (3) ZONA de precio de la estrella (dulce 35-95¢ pondera más). El score combina las tres. Las 5 mejores se muestran con medallas; el resto queda descartado con su motivo.',
  zona_dulce: 'Bilberry compra su estrella entre 35¢ y 95¢: es donde su retorno medio fue +10% a +20% con mediana positiva. Debajo de 20¢ las compras pierden en mediana 60-99% (lotería).',
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'Supabase not configured' })

  try {
    const modo = (req.query.modo as string) || 'noperder'
    const monto = Math.max(1, parseFloat(req.query.monto as string) || 10)
    const client = createClient(supabaseUrl, supabaseKey)

    // ── MODO RANKING: TOP 5 ciudades del día ─────────────────────────────────
    if (modo === 'ranking') {
      const resultados = await Promise.all(
        CIUDADES_ASIA.map(async (c: any) => {
          try {
            const data: any = await getCityData(client, c.slug)
            if (data.error) return { slug: c.slug, ciudad: c.nombre, descartada: data.error }
            const estrella: any = buildEstrella(data.forecast.combinado, data.contratos, monto)
            if (estrella.error) return { slug: c.slug, ciudad: c.nombre, descartada: estrella.error }

            const volTotal = data.contratos.reduce((s: number, x: any) => s + (x.volume_24h || 0), 0)
            const starContract = data.contratos.find(
              (x: any) => x.tipo === 'exacto' && x.valor === estrella.estrella.bucket
            )
            const liquidez = calculateLiquidity(volTotal, starContract?.spread)
            const factorLiq = liquidez === 'ALTA' ? 1.0 : liquidez === 'MEDIA' ? 0.7 : 0.4
            const factorZona =
              estrella.estrella.zona === 'DULCE' ? 1.0
              : estrella.estrella.zona === 'AGRESIVA' ? 0.8
              : estrella.estrella.zona === 'CARA' ? 0.3
              : 0.5
            const score = r2(estrella.conviccion * factorLiq * factorZona)

            return {
              slug: c.slug,
              ciudad: c.nombre,
              fecha: data.currentRecord.fecha_objetivo,
              combinado: r2(data.forecast.combinado),
              estrella: estrella.estrella,
              abanico_n: estrella.abanico.length,
              suma_cobertura: estrella.suma_cobertura,
              ev_mercado: estrella.ev_mercado,
              conviccion: estrella.conviccion,
              liquidez,
              mejor_caso: estrella.mejor_caso,
              peor_caso: estrella.peor_caso,
              score,
            }
          } catch (e: any) {
            return { slug: c.slug, ciudad: c.nombre, descartada: e.message }
          }
        })
      )

      const validas = resultados
        .filter((r: any) => !r.descartada)
        .sort((a: any, b: any) => b.score - a.score)
      const top5 = validas.slice(0, 5).map((r: any, i: number) => ({
        ...r,
        medalla: ['🥇', '🥈', '🥉'][i] || ('#' + (i + 1)),
        puesto: i + 1,
      }))
      const descartadas = resultados.filter((r: any) => r.descartada)

      return res.json({
        modo: 'ranking',
        monto_por_evento: monto,
        timestamp_analisis: new Date().toISOString(),
        top5,
        descartadas,
        leyendas: LEYENDAS,
      })
    }

    // ── MODOS POR CIUDAD ─────────────────────────────────────────────────────
    const slug = (req.query.slug as string) || 'chongqing'
    const data: any = await getCityData(client, slug)
    if (data.error) return res.status(404).json({ error: data.error })

    const base = {
      fecha: data.currentRecord.fecha_objetivo,
      fecha_polymarket: data.currentRecord.fecha_objetivo,
      fecha_ejecucion_forecast: data.currentRecord.fecha_ejecucion,
      slug,
      ciudad: data.nombre,
      timestamp_analisis: new Date().toISOString(),
      combinado: r2(data.forecast.combinado),
      total_contratos_disponibles: data.contratos.length,
      hora_snapshot: '10PM/11PM Caracas',
      leyendas: LEYENDAS,
    }

    if (modo === 'estrella') {
      const estrella: any = buildEstrella(data.forecast.combinado, data.contratos, monto)
      if (estrella.error) return res.status(404).json({ error: estrella.error })
      return res.json({ ...base, modo: 'estrella', monto, ...estrella })
    }

    // default: noperder
    const noperder: any = buildNoPerder(data.forecast.combinado, data.contratos, monto)
    if (noperder.error) return res.status(404).json({ error: noperder.error })
    return res.json({ ...base, modo: 'noperder', ...noperder })
  } catch (error) {
    console.error('[cobertura-si-no]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
