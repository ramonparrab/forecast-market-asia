import { NextApiRequest, NextApiResponse } from 'next'
import { computeBacktestKalman, KalmanCityResult } from './backtest-kalman'
import { getModeloActivo, getModeloNombre } from '@/lib/modelo-selector'

export interface PerfClasificacion {
  deltaInteger: number
  etiqueta: 'ACIERTO' | 'TEMP+1' | 'TEMP-1' | 'TEMP+2' | 'TEMP-2' | 'TEMP±3+'
}

export interface PerfDay {
  fecha_objetivo: string
  temp_real: number | null
  hora_10pm: string | null
  // Modelo ACTIVO (el que la ciudad usa según el selector): 10PM y 11PM
  act_10pm: number | null
  act_11pm: number | null
  cls_act10: PerfClasificacion | null
  cls_act11: PerfClasificacion | null
  // Mejora Continua (combinado) y Kalman, ambos a 10PM y 11PM
  cur_10pm: number | null
  cur_11pm: number | null
  kal_10pm: number | null
  kal_11pm: number | null
  cls_cur10: PerfClasificacion | null
  cls_cur11: PerfClasificacion | null
  cls_kal10: PerfClasificacion | null
  cls_kal11: PerfClasificacion | null
  mejor: 'actual' | 'kalman' | 'empate' | null
  /** Veredicto de la jornada: quién ganó o si nadie acertó */
  veredicto: string
  /** Distancia (en enteros) del pronóstico más cercano al real: 0 si hay acierto */
  distancia_minima_entero: number | null
}

export interface PerfStats {
  n: number
  mae10: number | null
  mae11: number | null
  mae_mejor: number | null
  aciertos10: number
  aciertos11: number
  aciertos_ambos: number
  aciertos_mejor: number
  dist: Record<string, number>
}

export interface PerfCiudad {
  slug: string
  nombre: string
  modelo_activo: string
  modelo_nombre: string
  dias: PerfDay[]
  stats_act: PerfStats
  stats_cur: PerfStats
  stats_kal: PerfStats
  mejor_modelo_ventana: 'actual' | 'kalman' | 'empate'
  resumen: string
}

export interface PerfGlobalResponse {
  ventana: number
  ciudades: PerfCiudad[]
  ranking_mae: PerfCiudad[]
  mejor_ciudad: string | null
  peor_ciudad: string | null
  g_act_max: number | null
  g_act_mae11: number | null
  g_kal_mae11: number | null
  g_kal_mejor: number | null
  g_total_dias: number
  g_aciertos_mejor: number
  analisis: string[]
}

function roundInt(v: number): number {
  return Math.round(v + 0.05)
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function clasificar(val: number | null, real: number | null): PerfClasificacion | null {
  if (val == null || real == null) return null
  const delta = roundInt(val) - roundInt(real)
  let etiqueta: PerfClasificacion['etiqueta']
  if (delta === 0) etiqueta = 'ACIERTO'
  else if (delta === 1) etiqueta = 'TEMP+1'
  else if (delta === -1) etiqueta = 'TEMP-1'
  else if (delta === 2) etiqueta = 'TEMP+2'
  else if (delta === -2) etiqueta = 'TEMP-2'
  else etiqueta = 'TEMP±3+'
  return { deltaInteger: delta, etiqueta }
}

type ColKey = 'cur_10pm' | 'cur_11pm' | 'kal_10pm' | 'kal_11pm'
type ClsKey = 'cls_cur10' | 'cls_cur11' | 'cls_kal10' | 'cls_kal11'

function buildStats(days: PerfDay[], col10: ColKey, col11: ColKey, clsKey10: ClsKey, clsKey11: ClsKey): PerfStats {
  const conReal = days.filter(d => d.temp_real != null)
  const n = conReal.length
  let s10 = 0, s11 = 0, sMejor = 0, hit10 = 0, hit11 = 0, hitAmbos = 0, hitMejor = 0
  const dist: Record<string, number> = {}
  for (const d of conReal) {
    const real = d.temp_real as number
    const v10 = d[col10]
    const v11 = d[col11]
    const c10 = d[clsKey10] as PerfClasificacion | null
    const c11 = d[clsKey11] as PerfClasificacion | null
    if (v10 != null) {
      s10 += Math.abs(v10 - real)
      if (c10?.etiqueta === 'ACIERTO') hit10++
      dist[c10?.etiqueta ?? 'SIN'] = (dist[c10?.etiqueta ?? 'SIN'] ?? 0) + 1
    }
    if (v11 != null) {
      s11 += Math.abs(v11 - real)
      if (c11?.etiqueta === 'ACIERTO') hit11++
    }
    const e10 = v10 != null ? Math.abs(v10 - real) : 99
    const e11 = v11 != null ? Math.abs(v11 - real) : 99
    sMejor += Math.min(e10, e11)
    if (c10?.etiqueta === 'ACIERTO' && c11?.etiqueta === 'ACIERTO') hitAmbos++
    if (c10?.etiqueta === 'ACIERTO' || c11?.etiqueta === 'ACIERTO') hitMejor++
  }
  return {
    n,
    mae10: n ? round2(s10 / n) : null,
    mae11: n ? round2(s11 / n) : null,
    mae_mejor: n ? round2(sMejor / n) : null,
    aciertos10: hit10,
    aciertos11: hit11,
    aciertos_ambos: hitAmbos,
    aciertos_mejor: hitMejor,
    dist,
  }
}

function textModelo(modelo: string): string {
  return modelo === 'KALMAN' ? 'Kalman 1D' : 'Mejora Continua'
}

function resumenCiudad(c: PerfCiudad): string {
  const s = c.stats_act
  const acPct = s.n ? Math.round((s.aciertos_mejor / s.n) * 100) : 0
  return `Usa ${textModelo(c.modelo_activo)}. Acierto exacto ${acPct}% de ${s.n} días, MAE(mejor col) ${s.mae_mejor ?? '-'}°C.`
}

function generarAnalisisGlobal(ciudades: PerfCiudad[], ranking: PerfCiudad[], ventana: number): string[] {
  const lineas: string[] = []
  const mejor = ranking[0]
  const peor = ranking[ranking.length - 1]
  const totalDias = ciudades.reduce((s, c) => s + c.stats_act.n, 0)
  const acMejorTotal = ciudades.reduce((s, c) => s + c.stats_act.aciertos_mejor, 0)
  const pctGlobal = totalDias ? Math.round((acMejorTotal / totalDias) * 100) : 0

  // MAE global de modelos
  const maeW = (key: 'mae_mejor') => {
    const dias = ciudades.reduce((s, c) => s + c.stats_act.n, 0)
    const sum = ciudades.reduce((s, c) => s + (c.stats_act[key] ?? 0) * c.stats_act.n, 0)
    return dias ? round2(sum / dias) : null
  }
  const gMae = maeW('mae_mejor')

  lineas.push(`📅 Últimos ${ventana} días (${totalDias} registros con real). Acierto global exacto (entero ganador): ${pctGlobal}%`)
  lineas.push(`🎯 MAE global del mejor valor entre 10PM/11PM: ${gMae ?? '-'}°C (modelo activo por ciudad).`)

  if (mejor) {
    const m = mejor.stats_act
    const pct = m.n ? Math.round((m.aciertos_mejor / m.n) * 100) : 0
    const modeloGana = mejor.mejor_modelo_ventana === 'actual' ? 'la Mejora Continua' : 'el Kalman 1D'
    lineas.push(`🏆 Mejor ciudad: ${mejor.nombre} — MAE ${m.mae_mejor}°C, ${pct}% de aciertos exactos en ${m.n} días (con su modelo activo ${mejor.modelo_nombre}). Gana ${modeloGana} en esta ventana.`)
  }
  if (peor) {
    const m = peor.stats_act
    lineas.push(`⚠️ Peor ciudad: ${peor.nombre} (MAE ${m.mae_mejor}°C, ${m.aciertos_mejor}/${m.n} exactos).`)
  }

  // Modelo activo vs alternativo
  const kalCiudades = ciudades.filter(c => c.modelo_activo === 'KALMAN')
  const mcCiudades = ciudades.filter(c => c.modelo_activo !== 'KALMAN')
  if (kalCiudades.length && mcCiudades.length) {
    const diasK = kalCiudades.reduce((s, c) => s + c.stats_kal.n, 0)
    const diasM = mcCiudades.reduce((s, c) => s + c.stats_cur.n, 0)
    const maeK = diasK ? round2(kalCiudades.reduce((s, c) => s + (c.stats_kal.mae_mejor ?? 0) * c.stats_kal.n, 0) / diasK) : null
    const maeM = diasM ? round2(mcCiudades.reduce((s, c) => s + (c.stats_cur.mae_mejor ?? 0) * c.stats_cur.n, 0) / diasM) : null
    lineas.push(`📊 Ciudades con modelo Kalman (${kalCiudades.length}): MAE global ${maeK}°C | Ciudades con Mejora Continua (${mcCiudades.length}): MAE global ${maeM}°C.`)
  }

  // dirección reciente: últimos 7 días vs previos
  const mae7 = (arr: PerfDay[], esKal: boolean): number | null => {
      if (!arr.length) return null
      let s = 0
      for (const d of arr) {
        const a = esKal ? d.kal_10pm : d.cur_10pm
        const b = esKal ? d.kal_11pm : d.cur_11pm
        const e = Math.min(
          a != null ? Math.abs(a - (d.temp_real as number)) : 99,
          b != null ? Math.abs(b - (d.temp_real as number)) : 99
        )
        s += e
      }
      return round2(s / arr.length)
    }
    const win7 = ciudades.map(c => {
      const conReal = c.dias.filter(d => d.temp_real != null)
      const d7 = conReal.slice(-7)
      const prev = conReal.slice(0, Math.max(0, conReal.length - 7))
      const esKal = c.modelo_activo === 'KALMAN'
      return { slug: c.slug, nombre: c.nombre, mae7: mae7(d7, esKal), maePrev: mae7(prev, esKal) }
    }).filter(x => x.mae7 != null && x.maePrev != null)

  const mejorando = win7.filter(w => (w.maePrev ?? 0) - (w.mae7 ?? 0) > 0.1).sort((a, b) => (b.maePrev - b.mae7) - (a.maePrev - a.mae7))
  const empeorando = win7.filter(w => (w.mae7 ?? 0) - (w.maePrev ?? 0) > 0.1).sort((a, b) => (b.mae7 - b.maePrev) - (a.mae7 - a.maePrev))
  if (mejorando.length) lineas.push(`📈 Ciudades que mejoraron en los últimos 7 días: ${mejorando.map(x => `${x.nombre} (${x.maePrev}→${x.mae7}°C)`).join(', ')}.`)
  if (empeorando.length) lineas.push(`📉 Ciudades que empeoraron en los últimos 7 días: ${empeorando.map(x => `${x.nombre} (${x.maePrev}→${x.mae7}°C)`).join(', ')}.`)

  return lineas
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const ventana = parseInt(req.query.dias as string || '30') || 30
    const slugFilter = (req.query.ciudad as string || '').trim()

    const ciudadesRaw = await computeBacktestKalman(ventana, slugFilter)
    const slugs = Object.keys(ciudadesRaw)
    if (slugs.length === 0) {
      return res.status(200).json({ ventana, ciudades: [], ranking_mae: [], mejor_ciudad: null, peor_ciudad: null, g_act_max: null, g_act_mae11: null, g_kal_mae11: null, g_kal_mejor: null, g_total_dias: 0, g_aciertos_mejor: 0, analisis: [] } satisfies PerfGlobalResponse)
    }

    const ciudades: PerfCiudad[] = slugs.map(slug => {
      const raw: KalmanCityResult = ciudadesRaw[slug]
      const modelo_activo = getModeloActivo(slug)
      const modelo_nombre = getModeloNombre(slug, modelo_activo)

      // El modelo ACTIVO es Kalman o MC según el selector por ciudad
      const dias: PerfDay[] = raw.days.map(d => {
        const esKalman = modelo_activo === 'KALMAN'
        const act10 = esKalman ? d.kal_10pm : d.cur_10pm
        const act11 = esKalman ? d.kal_11pm : d.cur_11pm
        const clsAct10 = clasificar(act10, d.temp_real)
        const clsAct11 = clasificar(act11, d.temp_real)
        const clsC10 = clasificar(d.cur_10pm, d.temp_real)
        const clsC11 = clasificar(d.cur_11pm, d.temp_real)
        const clsK10 = clasificar(d.kal_10pm, d.temp_real)
        const clsK11 = clasificar(d.kal_11pm, d.temp_real)

        // Veredicto: quién ganó o si todos fallaron y cuánto se alejó el más cercano
        let veredicto = ''
        let distMin = null as number | null
        if (d.temp_real != null) {
          const todos: { etiqueta: string; cls: PerfClasificacion | null; dInt: number }[] = [
            { etiqueta: `${modelo_nombre} 10PM`, cls: clsAct10, dInt: 0 },
            { etiqueta: `${modelo_nombre} 11PM`, cls: clsAct11, dInt: 0 },
            { etiqueta: 'MC 10PM', cls: clsC10, dInt: 0 },
            { etiqueta: 'MC 11PM', cls: clsC11, dInt: 0 },
            { etiqueta: 'Kalman 10PM', cls: clsK10, dInt: 0 },
            { etiqueta: 'Kalman 11PM', cls: clsK11, dInt: 0 },
          ]
          const ganadores = todos.filter(t => t.cls?.etiqueta === 'ACIERTO')
          if (ganadores.length > 0) {
            veredicto = `🏆 ${ganadores.map(g => g.etiqueta).join(' + ')}`
          } else {
            // El más cercano (menor distancia absoluta en valor real)
            let mejorAbs = Infinity
            let mejorTag = ''
            for (const t of todos) {
              const v = t.cls
              if (!v) continue
              const abs = Math.abs(v.deltaInteger)
              if (abs < mejorAbs) {
                mejorAbs = abs
                mejorTag = t.etiqueta
              }
            }
            distMin = mejorAbs === Infinity ? null : mejorAbs
            veredicto = `❌ Todos fallaron · más cercano ${mejorTag} a ${distMin}° del entero`
          }
        }

        return {
          fecha_objetivo: d.fecha_objetivo,
          temp_real: d.temp_real,
          hora_10pm: d.hora_10pm,
          act_10pm: act10,
          act_11pm: act11,
          cls_act10: clsAct10,
          cls_act11: clsAct11,
          cur_10pm: d.cur_10pm,
          cur_11pm: d.cur_11pm,
          kal_10pm: d.kal_10pm,
          kal_11pm: d.kal_11pm,
          cls_cur10: clsC10,
          cls_cur11: clsC11,
          cls_kal10: clsK10,
          cls_kal11: clsK11,
          mejor: d.mejor,
          veredicto,
          distancia_minima_entero: distMin,
        }
      })

      // Stats del modelo ACTIVO (10PM/11PM)
      const actCol10 = (esK: boolean): ColKey => esK ? 'kal_10pm' : 'cur_10pm'
      const esKalmanCiudad = modelo_activo === 'KALMAN'
      const stats_act = buildStats(
        dias,
        esKalmanCiudad ? 'kal_10pm' : 'cur_10pm',
        esKalmanCiudad ? 'kal_11pm' : 'cur_11pm',
        esKalmanCiudad ? 'cls_kal10' : 'cls_cur10',
        esKalmanCiudad ? 'cls_kal11' : 'cls_cur11'
      )
      const stats_cur = buildStats(dias, 'cur_10pm', 'cur_11pm', 'cls_cur10', 'cls_cur11')
      const stats_kal = buildStats(dias, 'kal_10pm', 'kal_11pm', 'cls_kal10', 'cls_kal11')

      let ganarCur = 0, ganarKal = 0
      for (const d of dias) {
        if (d.temp_real == null) continue
        if (d.mejor === 'actual') ganarCur++
        else if (d.mejor === 'kalman') ganarKal++
      }
      const mejorModelo: 'actual' | 'kalman' | 'empate' = ganarCur > ganarKal ? 'actual' : ganarKal > ganarCur ? 'kalman' : 'empate'

      return {
        slug,
        nombre: raw.nombre,
        modelo_activo,
        modelo_nombre,
        dias,
        stats_act,
        stats_cur,
        stats_kal,
        mejor_modelo_ventana: mejorModelo,
        resumen: '',
      }
    })

    for (const c of ciudades) c.resumen = resumenCiudad(c)

    const ranking_mae = [...ciudades].sort((a, b) => (a.stats_act.mae_mejor ?? 99) - (b.stats_act.mae_mejor ?? 99))
    const mejor_ciudad = ranking_mae[0]?.slug ?? null
    const peor_ciudad = ranking_mae[ranking_mae.length - 1]?.slug ?? null

    const analisis = generarAnalisisGlobal(ciudades, ranking_mae, ventana)

    const nDias = ciudades.reduce((s, c) => s + c.stats_act.n, 0)
    const sumA11 = ciudades.reduce((s, c) => s + (c.stats_act.mae11 ?? 0) * c.stats_act.n, 0)
    const sumK = ciudades.reduce((s, c) => s + (c.stats_kal.mae11 ?? 0) * c.stats_kal.n, 0)
    const sumAm = ciudades.reduce((s, c) => s + (c.stats_act.mae_mejor ?? 0) * c.stats_act.n, 0)
    const sumKm = ciudades.reduce((s, c) => s + (c.stats_kal.mae_mejor ?? 0) * c.stats_kal.n, 0)

    const aciertosAct = ciudades.reduce((s, c) => s + c.stats_act.aciertos_mejor, 0)

    return res.status(200).json({
      ventana,
      ciudades,
      ranking_mae,
      mejor_ciudad,
      peor_ciudad,
      g_act_max: nDias ? round2(sumAm / nDias) : null,
      g_act_mae11: nDias ? round2(sumA11 / nDias) : null,
      g_kal_mae11: nDias ? round2(sumK / nDias) : null,
      g_kal_mejor: nDias ? round2(sumKm / nDias) : null,
      g_total_dias: nDias,
      g_aciertos_mejor: aciertosAct,
      analisis,
    } satisfies PerfGlobalResponse)
  } catch (error) {
    console.error('[performance]', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}