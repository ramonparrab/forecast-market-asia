const TWC_API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525'
const TWC_API = 'https://api.weather.com/v1/location'

const ICAO_COUNTRY: Record<string, string> = {
  ZBAA: 'CN', ZSPD: 'CN', ZGSZ: 'CN', ZHHH: 'CN', ZUCK: 'CN', ZUUU: 'CN',
  RKSI: 'KR', RJTT: 'JP',
}

const STATION_MAP: Record<string, { station: string; type: string }> = {
  'beijing':   { station: 'ZBAA', type: 'icao' },
  'shanghai':  { station: 'ZSPD', type: 'icao' },
  'shenzhen':  { station: 'ZGSZ', type: 'icao' },
  'seoul':     { station: 'RKSI', type: 'icao' },
  'tokyo':     { station: 'RJTT', type: 'icao' },
  'hong-kong': { station: '22.302,114.174', type: 'geo' },
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

export async function fetchStationMaxTemp(
  slug: string,
  fechaISO: string
): Promise<number | null> {
  const mapping = STATION_MAP[slug]
  if (!mapping) return null

  const dateStr = fechaISO.slice(0, 10)

  let url: string
  if (mapping.type === 'geo') {
    const dateCompact = dateStr.replace(/-/g, '')
    url = `https://api.weather.com/v1/geocode/${mapping.station}/observations/historical.json?apiKey=${TWC_API_KEY}&units=e&startDate=${dateCompact}&endDate=${dateCompact}`
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
    const maxC = Math.round(((maxF - 32) * 5 / 9) * 10) / 10
    return maxC
  } catch (e) {
    console.error(`[TWC] Error fetching ${slug}:`, (e as Error).message)
    return null
  }
}
