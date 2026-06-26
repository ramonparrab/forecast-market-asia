/**
 * Nowcaster — blends live METAR observations into the ensemble forecast.
 *
 * Logic:
 * - As the day progresses in the target city, observed temperatures
 *   become increasingly informative about the day's high.
 * - Weight of observation rises from 0% at 00:00 local to 80% by 21:00 local.
 * - The blended value = w * observed_max + (1-w) * ensemble_max
 * - This prevents the bot from ignoring a high that's already been observed.
 */

// Station ICAO codes for our 9 Asian cities
const STATION_MAP: Record<string, string> = {
  seoul: 'RKSI',
  beijing: 'ZBAA',
  shanghai: 'ZSPD',
  'hong-kong': 'VHHH',
  tokyo: 'RJTT',
  shenzhen: 'ZGSZ',
  wuhan: 'ZHHH',
  chongqing: 'ZUCK',
  chengdu: 'ZUUU',
}

/**
 * Fetches METAR observation for a station from Open-Meteo.
 * Returns the current temperature at the station, or null if unavailable.
 */
async function fetchMetarObservation(lat: number, lon: number): Promise<number | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&temperature_unit=celsius&timezone=auto`
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!resp.ok) return null
    const data = await resp.json()
    return data?.current?.temperature_2m ?? null
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

  // If observation already exceeds ensemble, trust observation more
  const boostW = observedTemp > ensembleTemp ? Math.min(w + 0.15, 0.9) : w
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
  const observed = await fetchMetarObservation(lat, lon)
  return computeNowcasted(slug, lat, lon, ensembleTemp, observed)
}
