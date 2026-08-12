import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { CIUDADES_ASIA } from '@/lib/cities'
import { fetchWeatherModels } from '@/lib/openmeteo'

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const OPENMETEO_BASE = 'https://api.open-meteo.com/v1/forecast'

interface RivalCity {
  slug: string
  nombre: string
  lat: number
  lon: number
  nuestro: number | null         // nuestro pronóstico (mejor de 10PM/11PM)
  ecmwf: number | null
  gfs: number | null
  icon: number | null
  best_match: number | null
  real: number | null            // temperatura real registrada
  error_nuestro: number | null  // |nuestro - real|
  error_ecmwf: number | null
  error_gfs: number | null
  error_icon: number | null
  error_best: number | null
}

interface RivalResponse {
  fecha: string
  ciudades: RivalCity[]
  mae: {
    nuestro: number
    ecmwf: number
    gfs: number
    icon: number
    best_match: number
  }
  total_con_real: number
  dias_historicos: number
}

/**
 * Fetch TWC/weather.com max temp for a city on a given date.
 * Uses the station-weather approach but we inline a simpler version here.
 */
async function fetchTWCMaxTemp(
  lat: number,
  lon: number,
  fechaISO: string
): Promise<number | null> {
  // TWC requires ICAO codes, not geo coords for historical data.
  // For VS RIVALES we skip TWC and use Open-Meteo models which are more reliable.
  // The user's original tab mentioned weather.com but the actual data source
  // for model comparison is Open-Meteo.
  return null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const fecha = req.query.fecha as string
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Se requiere ?fecha=YYYY-MM-DD' })
  }

  try {
    const client = createClient(supabaseUrl, supabaseKey)

    // 1. Get our forecasts from forecast_history for this date
    //    We want the best run (prefer 11PM which includes nowcast, fallback to 10PM)
    const { data: historyRows, error: dbError } = await client
      .from('forecast_history' as any)
      .select('slug, ciudad, temp_corregida, temp_real, error, fecha_ejecucion')
      .eq('fecha_objetivo', fecha)
      .order('fecha_ejecucion', { ascending: false } as any)

    if (dbError) {
      console.error('[vs-rivales] DB error:', dbError.message)
      return res.status(500).json({ error: dbError.message })
    }

    // Pick the best forecast per city: prefer later run (11PM with nowcast)
    const bestByCity: Record<string, { temp_corregida: number; temp_real: number | null; error: number | null }> = {}
    for (const row of (historyRows as any[]) ?? []) {
      if (!bestByCity[row.slug]) {
        bestByCity[row.slug] = {
          temp_corregida: parseFloat(row.temp_corregida),
          temp_real: row.temp_real !== null ? parseFloat(row.temp_real) : null,
          error: row.error !== null ? parseFloat(row.error) : null,
        }
      }
    }

    // 2. Fetch rival model forecasts from Open-Meteo for each city
    const modelCodes = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'best_match']
    const ciudades: RivalCity[] = []

    // Fetch models in parallel (max 3 concurrent to respect rate limits)
    const batchSize = 3
    for (let i = 0; i < CIUDADES_ASIA.length; i += batchSize) {
      const batch = CIUDADES_ASIA.slice(i, i + batchSize)
      const results = await Promise.allSettled(
        batch.map(async (city) => {
          const models = await fetchWeatherModels(city.lat, city.lon, fecha, modelCodes)
          return { city, models }
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { city, models } = result.value
          const nuestro = bestByCity[city.slug]?.temp_corregida ?? null
          const real = bestByCity[city.slug]?.temp_real ?? null

          ciudades.push({
            slug: city.slug,
            nombre: city.nombre,
            lat: city.lat,
            lon: city.lon,
            nuestro,
            ecmwf: models.models.ecmwf_ifs025 ?? null,
            gfs: models.models.gfs_seamless ?? null,
            icon: models.models.icon_seamless ?? null,
            best_match: models.models.best_match ?? null,
            real,
            error_nuestro: nuestro !== null && real !== null ? Math.abs(nuestro - real) : null,
            error_ecmwf: models.models.ecmwf_ifs025 !== null && real !== null ? Math.abs(models.models.ecmwf_ifs025 - real) : null,
            error_gfs: models.models.gfs_seamless !== null && real !== null ? Math.abs(models.models.gfs_seamless - real) : null,
            error_icon: models.models.icon_seamless !== null && real !== null ? Math.abs(models.models.icon_seamless - real) : null,
            error_best: models.models.best_match !== null && real !== null ? Math.abs(models.models.best_match - real) : null,
          })
        } else {
          // On failure, still add city with null model values
          const city = batch[results.indexOf(result)]
          const nuestro = bestByCity[city.slug]?.temp_corregida ?? null
          const real = bestByCity[city.slug]?.temp_real ?? null
          ciudades.push({
            slug: city.slug,
            nombre: city.nombre,
            lat: city.lat,
            lon: city.lon,
            nuestro,
            ecmwf: null,
            gfs: null,
            icon: null,
            best_match: null,
            real,
            error_nuestro: nuestro !== null && real !== null ? Math.abs(nuestro - real) : null,
            error_ecmwf: null,
            error_gfs: null,
            error_icon: null,
            error_best: null,
          })
        }
      }
    }

    // 3. Calculate MAE per source (only cities with real temp)
    const withReal = ciudades.filter(c => c.real !== null)
    const avg = (arr: (number | null)[]) => {
      const valid = arr.filter((v): v is number => v !== null)
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0
    }

    // 4. Count total historical days with real data (for MAE context)
    const { count: totalHistoricos } = await client
      .from('forecast_history' as any)
      .select('id', { count: 'exact', head: true } as any)
      .not('temp_real', 'is', null)
      .not('error', 'is', null)

    const response: RivalResponse = {
      fecha,
      ciudades,
      mae: {
        nuestro: avg(withReal.map(c => c.error_nuestro)),
        ecmwf: avg(withReal.map(c => c.error_ecmwf)),
        gfs: avg(withReal.map(c => c.error_gfs)),
        icon: avg(withReal.map(c => c.error_icon)),
        best_match: avg(withReal.map(c => c.error_best)),
      },
      total_con_real: withReal.length,
      dias_historicos: totalHistoricos ?? 0,
    }

    return res.status(200).json(response)
  } catch (error) {
    console.error('[vs-rivales] Error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
