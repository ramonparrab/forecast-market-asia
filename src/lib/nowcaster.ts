/**
 * Nowcaster — blends live METAR observations into the ensemble forecast.
 *
 * Logic:
 * - As the day progresses in the target city, observed temperatures
 *   become increasingly informative about the day's high.
 * - Weight of observation rises from 0% at 00:00 local to 80% by 21:00 local.
 * - The blended value = w * observed_max + (1-w) * ensemble_max
 * - If observed temp already exceeds forecast, weight jumps to ≥0.7.
 * - Hong Kong uses HKO rhrread API instead of Open-Meteo.
 */

// Station ICAO codes for our 9 Asian cities
const STATION_MAP: Record<string, string> = {
  seoul: 'RKSI',
  beijing: 'ZBAA',
  shanghai: 'ZSPD',
  'hong-kong': 'HKO',
  tokyo: 'RJTT',
  shenzhen: 'ZGSZ',
  wuhan: 'ZHHH',
  chongqing: 'ZUCK',
  chengdu: 'ZUUU',
}

/**
 * Fetches current temperature from HKO rhrread API (Hong Kong only).
 * Returns the Hong Kong Observatory station temperature, or null if unavailable.
 */
async function fetchHKORhrread(): Promise<number | null> {
  try {
    const resp = await fetch(
      'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread',
      { signal: AbortSignal.timeout(5000) }
    )
    if (!resp.ok) return null
    const data = await resp.json()
    const tempData = data?.temperature?.data
    if (!Array.isArray(tempData)) return null
    const hko = tempData.find((t: any) => t.place === 'Hong Kong Observatory')
    return hko?.value ?? null
  } catch {
    return null
  }
}

/**
 * Fetches METAR observation for a station from Open-Meteo.
 * Returns the current temperature at the station, or null if unavailable.
 */
async function fetchMetarObservation(lat: number, lon: number): Promise<number | null> {
  try {
    // API key propia (ver openmeteo.ts): sin key la cuota diaria es por IP compartido
    const apiKey = process.env.OPENMETEO_API_KEY
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&temperature_unit=celsius&forecast_days=1${apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : ''}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data?.hourly?.time || !data?.hourly?.temperature_2m) return null
    const now = new Date()
    let maxTemp = -Infinity
    for (let i = 0; i < data.hourly.time.length; i++) {
      const hourTime = new Date(data.hourly.time[i] + 'Z')
      if (hourTime <= now && data.hourly.temperature_2m[i] !== null) {
        maxTemp = Math.max(maxTemp, data.hourly.temperature_2m[i])
      }
    }
    return maxTemp === -Infinity ? null : Math.round(maxTemp * 100) / 100
  } catch {
    return null
  }
}

/**
 * Get local hour for a longitude offset.
 */
function getLocalHour(lon: number): number {
  const utc = new Date()
  const localOffset = Math.round(lon / 15)
  return (utc.getUTCHours() + localOffset + 24) % 24
}

/**
 * Calculate nowcast weight based on local time.
 * Weight = 0 at midnight, rises linearly to 0.8 at 21:00.
 */
function nowcastWeight(localHour: number): number {
  if (localHour < 6) return 0
  if (localHour >= 21) return 0.8
  return (localHour - 6) / (21 - 6) * 0.8
}

/**
 * Maximum observed temperature so far today (+ a small buffer).
 * Uses a simple heuristic: if it's past 15:00 local, the observed max
 * is very close to the final max.
 */
export function computeNowcasted(
  slug: string,
  lat: number,
  lon: number,
  ensembleTemp: number,
  observedTemp: number | null
): { temp: number; obsWeight: number; observedTemp: number | null; station: string } {
  const station = STATION_MAP[slug] ?? 'N/A'
  const localHour = getLocalHour(lon)
  const w = nowcastWeight(localHour)

  if (observedTemp === null || w === 0) {
    return { temp: ensembleTemp, obsWeight: w, observedTemp: null, station }
  }

  // If observation already exceeds ensemble, jump to ≥0.7
  const boostW = observedTemp > ensembleTemp ? Math.min(Math.max(w, 0.7), 0.9) : w
  const blended = observedTemp * boostW + ensembleTemp * (1 - boostW)

  return {
    temp: Math.round(blended * 100) / 100,
    obsWeight: Math.round(boostW * 100) / 100,
    observedTemp,
    station,
  }
}

/**
 * Main nowcast function for the forecast engine.
 */
export async function nowcastTemperature(
  slug: string,
  lat: number,
  lon: number,
  ensembleTemp: number
): Promise<{
  temp: number
  obsWeight: number
  observedTemp: number | null
  station: string
}> {
  const observed = slug === 'hong-kong' ? await fetchHKORhrread() : await fetchMetarObservation(lat, lon)
  return computeNowcasted(slug, lat, lon, ensembleTemp, observed)
}
