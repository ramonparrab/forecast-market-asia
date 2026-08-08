import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from '@/lib/cities'
import { AlertaClima, DatosDia, detectarAlertas } from '@/lib/alerta-clima'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const MODELS = ['best_match', 'ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'jma_seamless', 'meteofrance_seamless']

export interface AlertaCiudad {
  slug: string
  nombre: string
  fecha_objetivo: string
  temp_corregida: number | null
  alertas: AlertaClima[]
  datos: { tmax: number | null; tmin: number | null; precip: number | null; prob: number | null; wind: number | null; code: number | null }
}

function prom(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number')
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const client = createClient(supabaseUrl, supabaseKey)

    // 1) Fecha objetivo pendiente (sin real) más reciente por ciudad
    const { data: pendientes } = await (client
      .from('forecast_history' as any)
      .select('slug, fecha_objetivo, temp_corregida')
      .is('temp_real', null)
      .order('fecha_objetivo', { ascending: false } as any) as any)

    const fechasPorSlug: Record<string, { fecha: string; temp_corregida: number | null }> = {}
    for (const r of (pendientes ?? []) as any[]) {
      if (!fechasPorSlug[r.slug]) fechasPorSlug[r.slug] = { fecha: r.fecha_objetivo, temp_corregida: r.temp_corregida }
    }

    const slugs = Object.keys(fechasPorSlug)
    if (slugs.length === 0) {
      return res.status(200).json({ fecha_consulta: new Date().toISOString(), ciudades: [], aviso: 'no hay fecha objetivo pendiente' })
    }

    const slugNombres: Record<string, string> = {}
    CIUDADES_ASIA.forEach((c: any) => { slugNombres[c.slug] = c.nombre })

    const resultado: AlertaCiudad[] = []

    for (const slug of slugs) {
      const info = fechasPorSlug[slug]
      const fechaObj = info!.fecha
      const city = CIUDADES_ASIA.find(c => c.slug === slug)
      if (!city) continue

      // Pedimos 3 días: prev2, prev1, fecha objetivo
      const dt = new Date(fechaObj + 'T00:00:00Z')
      const d0 = new Date(dt); d0.setUTCDate(dt.getUTCDate() - 2)
      const start = d0.toISOString().slice(0, 10)
      const end = fechaObj

      const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code&temperature_unit=celsius&start_date=${start}&end_date=${end}&models=${MODELS.join(',')}&timezone=auto`

      const resp = await fetch(url)
      const j = await resp.json()
      const d = j?.daily
      if (!d) continue

      // Promedio multinmodelo por día: índice 2 = fecha objetivo, 1 = prev1, 0 = prev2
      const diaModelos = (idx: number): DatosDia | null => {
        const tmax = prom(MODELS.map(m => d[`temperature_2m_max_${m}`]?.[idx] ?? null))
        const tmin = prom(MODELS.map(m => d[`temperature_2m_min_${m}`]?.[idx] ?? null))
        const precip = prom(MODELS.map(m => d[`precipitation_sum_${m}`]?.[idx] ?? null))
        const prob = prom(MODELS.map(m => d[`precipitation_probability_max_${m}`]?.[idx] ?? null))
        const wind = prom(MODELS.map(m => d[`wind_speed_10m_max_${m}`]?.[idx] ?? null))
        const codes = MODELS.map(m => d[`weather_code_${m}`]?.[idx] ?? null).filter((v): v is number => typeof v === 'number')
        if (tmax == null) return null
        return {
          tmax,
          tmin: tmin ?? tmax,
          precip: precip ?? 0,
          prob: prob ?? 0,
          wind: wind ?? 0,
          code: codes.length ? codes.sort((a, b) => a - b)[Math.floor(codes.length / 2)] : 0,
        }
      }

      const hoy = diaModelos(2)
      const prev1 = diaModelos(1)
      const prev2 = diaModelos(0)
      if (!hoy) continue

      const alertas = detectarAlertas(hoy, prev1, prev2)

      // Datos de consenso para el UI (best_match como referencia rápida)
      const datos = {
        tmax: Math.round(hoy.tmax * 10) / 10,
        tmin: hoy.tmin != null ? Math.round(hoy.tmin * 10) / 10 : null,
        precip: hoy.precip != null ? Math.round(hoy.precip * 10) / 10 : null,
        prob: hoy.prob != null ? Math.round(hoy.prob) : null,
        wind: hoy.wind != null ? Math.round(hoy.wind) : null,
        code: hoy.code ?? null,
      }

      resultado.push({
        slug,
        nombre: slugNombres[slug] ?? city.nombre,
        fecha_objetivo: fechaObj,
        temp_corregida: info!.temp_corregida ?? null,
        alertas,
        datos,
      })
    }

    res.status(200).json({ fecha_consulta: new Date().toISOString(), ciudades: resultado })
  } catch (error) {
    console.error('[alerta-clima]', error)
    res.status(500).json({ error: (error as Error).message })
  }
}