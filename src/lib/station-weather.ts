import { fetchActualTempFromPolymarket } from './polymarket'

const TWC_API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525'
const TWC_API = 'https://api.weather.com/v1/location'
const HKO_API = 'https://data.weather.gov.hk/weatherAPI/opendata/opendata.php'

const ICAO_COUNTRY: Record<string, string> = {
  ZBAA: 'CN', ZSPD: 'CN', ZHHH: 'CN', ZUCK: 'CN', ZUUU: 'CN',
  RKSI: 'KR', RJTT: 'JP', WSSS: 'SG',
}

const STATION_MAP: Record<string, { station: string; type: string }> = {
  'beijing':   { station: 'ZBAA', type: 'icao' },
  'shanghai':  { station: 'ZSPD', type: 'icao' },
  'shenzhen':  { station: '22.64,113.83', type: 'geo' },  // Bao'an Airport — ICAO ZGSZ returns wrong station from TWC
  'seoul':     { station: 'RKSI', type: 'icao' },
  'tokyo':     { station: 'RJTT', type: 'icao' },
  'hong-kong': { station: 'HKO', type: 'hko' },           // Polymarket resolves vs HKO, not TWC
  'wuhan':     { station: 'ZHHH', type: 'icao' },
  'chongqing': { station: 'ZUCK', type: 'icao' },
  'chengdu':   { station: 'ZUUU', type: 'icao' },
  'singapore':  { station: 'WSSS', type: 'icao' },  // Changi Intl Airport
}

function buildTWCUrl(icao: string, dateStr: string): string | null {
  const cc = ICAO_COUNTRY[icao]
  if (!cc) return null
  const dateCompact = dateStr.replace(/-/g, '')
  return `${TWC_API}/${icao}:9:${cc}/observations/historical.json?apiKey=${TWC_API_KEY}&units=e&startDate=${dateCompact}&endDate=${dateCompact}`
}

const HKO_RHRREAD = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=en'

async function fetchHKOMaxTemp(year: number, month: number, day: number): Promise<number | null> {
  // Try CLMMAXT (definitive monthly climate data, but lags weeks)
  try {
    const url = `${HKO_API}?dataType=CLMMAXT&station=HKO&year=${year}&month=${month}&rformat=csv&lang=en`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (resp.ok) {
      const csv = await resp.text()
      const lines = csv.split('\n').filter(l => l.trim().length > 0)
      // Skip header lines (type, fields), find data rows matching year/month/day
      let dataStarted = false
      for (const line of lines) {
        if (line.startsWith('"***') || line.startsWith('"#')) break
        if (!dataStarted) {
          if (/^\d{4},\d{1,2},\d{1,2},/.test(line)) dataStarted = true
          else continue
        }
        const parts = line.split(',')
        if (parts.length >= 4) {
          const y = parseInt(parts[0], 10)
          const m = parseInt(parts[1], 10)
          const d = parseInt(parts[2], 10)
          if (y === year && m === month && d === day) {
            return parseFloat(parts[3])
          }
        }
      }
    }
  } catch { /* fall through */ }

  // CLMMAXT not available — only use rhrread if querying TODAY (nowcast), not for past dates
  const now = new Date()
  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
  const queryKey = `${year}-${month}-${day}`
  if (queryKey === todayKey) {
    try {
      const resp = await fetch(HKO_RHRREAD, { signal: AbortSignal.timeout(10000) })
      if (resp.ok) {
        const data = await resp.json()
        const hkoStation = data?.temperature?.data?.find(
          (s: any) => s.place === 'Hong Kong Observatory'
        )
        if (hkoStation?.value != null) {
          return parseFloat(hkoStation.value)
        }
      }
    } catch { /* fall through */ }
  }

  return null
}

export async function fetchStationMaxTemp(
  slug: string,
  fechaISO: string
): Promise<number | null> {
  // 1. Try Polymarket settlement first (exact source used for resolution)
  const pmTemp = await fetchActualTempFromPolymarket(slug, fechaISO)
  if (pmTemp !== null) return pmTemp

  const mapping = STATION_MAP[slug]
  if (!mapping) return null

  const dateStr = fechaISO.slice(0, 10)

  // 2. Fallback: direct API source per city
  let temp: number | null = null

  if (mapping.type === 'hko') {
    const date = new Date(dateStr)
    temp = await fetchHKOMaxTemp(date.getFullYear(), date.getMonth() + 1, date.getDate())
  } else {
    let url: string
    if (mapping.type === 'geo') {
      const dateCompact = dateStr.replace(/-/g, '')
      const coords = mapping.station.replace(',', '/')
      url = `https://api.weather.com/v1/geocode/${coords}/observations/historical.json?apiKey=${TWC_API_KEY}&units=e&startDate=${dateCompact}&endDate=${dateCompact}`
    } else {
      const result = buildTWCUrl(mapping.station, dateStr)
      if (!result) return null
      url = result
    }

    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'forecast-market-asia/1.0' },
        signal: AbortSignal.timeout(20000),
      })
      if (resp.ok) {
        const data = await resp.json()
        const observations: any[] = data.observations || []
        const temps = observations
          .map((o: any) => o.temp)
          .filter((t: any) => t !== null && t !== undefined)
        if (temps.length > 0) {
          const maxF = Math.max(...temps)
          temp = Math.round((maxF - 32) * 5 / 9)
        }
      }
    } catch (e) {
      console.error(`[TWC] Error fetching ${slug}:`, (e as Error).message)
    }
  }

  if (temp !== null) return temp

  // 3. Last resort: Open-Meteo ERA5 (skip for HK — elevation mismatch)
  if (slug === 'hong-kong') return null
  return null
}
