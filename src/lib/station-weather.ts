const TWC_API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525'
const TWC_API = 'https://api.weather.com/v1/location'
const HKO_API = 'https://data.weather.gov.hk/weatherAPI/opendata/opendata.php'

const ICAO_COUNTRY: Record<string, string> = {
  ZBAA: 'CN', ZSPD: 'CN', ZHHH: 'CN', ZUCK: 'CN', ZUUU: 'CN',
  RKSI: 'KR', RJTT: 'JP',
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
}

function buildTWCUrl(icao: string, dateStr: string): string | null {
  const cc = ICAO_COUNTRY[icao]
  if (!cc) return null
  const dateCompact = dateStr.replace(/-/g, '')
  return `${TWC_API}/${icao}:9:${cc}/observations/historical.json?apiKey=${TWC_API_KEY}&units=e&startDate=${dateCompact}&endDate=${dateCompact}`
}

async function fetchHKOMaxTemp(year: number, month: number, day: number): Promise<number | null> {
  try {
    const url = `${HKO_API}?dataType=CLMMAXT&station=HKO&year=${year}&month=${month}&rformat=json&lang=en`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return null
    const data = await resp.json()
    if (!data || !Array.isArray(data.data)) return null
    const entry = data.data.find((row: string[]) => {
      const y = parseInt(row[0], 10)
      const m = parseInt(row[1], 10)
      const d = parseInt(row[2], 10)
      return y === year && m === month && d === day
    })
    if (!entry) return null
    return parseFloat(entry[3])
  } catch {
    return null
  }
}

export async function fetchStationMaxTemp(
  slug: string,
  fechaISO: string
): Promise<number | null> {
  const mapping = STATION_MAP[slug]
  if (!mapping) return null

  // Hong Kong: use HKO API (1 decimal, not truncated — Polymarket resolves vs exact HKO value)
  if (mapping.type === 'hko') {
    const date = new Date(fechaISO.slice(0, 10))
    return fetchHKOMaxTemp(date.getFullYear(), date.getMonth() + 1, date.getDate())
  }

  const dateStr = fechaISO.slice(0, 10)

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
    if (!resp.ok) throw new Error(`TWC HTTP ${resp.status}`)

    const data = await resp.json()
    const observations: any[] = data.observations || []
    if (observations.length === 0) return null

    const temps = observations
      .map((o: any) => o.temp)
      .filter((t: any) => t !== null && t !== undefined)

    if (temps.length === 0) return null

    const maxF = Math.max(...temps)
    // Polymarket resolves to whole °C for Wunderground-sourced cities
    return Math.round((maxF - 32) * 5 / 9)
  } catch (e) {
    console.error(`[TWC] Error fetching ${slug}:`, (e as Error).message)
    return null
  }
}
