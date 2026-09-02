import { ModelTemps } from '@/types'
import { MODELOS_CLIMATICOS } from './cities'

const OPENMETEO_BASE = 'https://api.open-meteo.com/v1/forecast'
const OPENMETEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'

// API key opcional de Open-Meteo (https://open-meteo.com/en/docs — gratis no-comercial).
// SIN key, la cuota diaria se cuenta por IP: en Vercel las funciones salen por IPs NAT
// COMPARTIDAS con otras apps, y el IP puede llegar ya agotado (HTTP 429) — causa raíz
// de corridas con 2/10 o 8/10 ciudades. CON key, la cuota es propia (10k/día) y estable.
const OM_API_KEY = process.env.OPENMETEO_API_KEY || ''

// Key TWC (fallback de pronóstico por ciudad cuando Open-Meteo falla).
const TWC_API_KEY = process.env.TWC_API_KEY || 'e1f10a1e78da46f5b10a1e78da96f525'

// Key OpenWeatherMap (https://openweathermap.org/api — free 1.000 llamadas/día,
// ~60/día para 10 ciudades). OWM se consulta EN PARALELO con Open-Meteo y aporta
// el modelo 'owm' al ensemble (+1 modelo de otro proveedor). Si Open-Meteo falla
// (429), OWM actúa de segundo fallback (1 modelo) ANTES que TWC. Sin key → sin efecto.
const OWM_API_KEY = process.env.OPENWEATHERMAP_API_KEY || ''

function withApiKey(url: string): string {
  if (!OM_API_KEY) return url
  return `${url}${url.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(OM_API_KEY)}`
}

interface OmFetchResult {
  ok: boolean
  status: number
  data?: any
  err?: string
}

/**
 * fetch con reintentos (solo 429/5xx/timeout), backoff con jitter y API key.
 * Los 4xx de parámetros no se reintentan (fallan igual siempre).
 */
async function omFetchJson(url: string, timeoutMs = 12000, attempts = 3): Promise<OmFetchResult> {
  let lastErr = 'unknown'
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resp = await fetch(withApiKey(url), { signal: AbortSignal.timeout(timeoutMs) })
      if (resp.ok) {
        return { ok: true, status: resp.status, data: await resp.json() }
      }
      const body = await resp.text().catch(() => '')
      lastErr = body.slice(0, 160) || `HTTP ${resp.status}`
      // 429 = cuota por IP agotada; 5xx = transitorio → reintentar
      const retryable = resp.status === 429 || resp.status >= 500
      if (!retryable) return { ok: false, status: resp.status, err: lastErr }
    } catch (e) {
      lastErr = (e as Error).message
    }
    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 600))
    }
  }
  return { ok: false, status: 0, err: lastErr }
}

/**
 * Fetch the ACTUAL maximum temperature for a date.
 * For past dates, uses the Archive API (reliable historical data).
 * For today or future dates, uses the Forecast API.
 */
export async function fetchActualMaxTemp(
  lat: number,
  lon: number,
  fechaISO: string
): Promise<number | null> {
  const dateStr = fechaISO.slice(0, 10)
  const todayUTC = new Date().toISOString().slice(0, 10)
  const isPast = dateStr < todayUTC
  const baseUrl = isPast ? OPENMETEO_ARCHIVE : OPENMETEO_BASE
  const label = isPast ? 'Archive' : 'Forecast'

  const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${dateStr}&end_date=${dateStr}`
  const r = await omFetchJson(url, 15000, 2)
  const maxTemp = r.data?.daily?.temperature_2m_max?.[0]

  if (r.ok && maxTemp !== null && maxTemp !== undefined) {
    console.log(`[Open-Meteo ${label}] ${dateStr} → ${maxTemp}°C`)
    return maxTemp
  }
  console.warn(`[Open-Meteo ${label}] ${dateStr} → sin datos (${r.err ?? 'sin valor'})`)
  return null
}

export interface WeatherModelsResult {
  models: ModelTemps
  ensembleMembers: number[]
  weatherCode: number
  precipitation: number
  /** true si Open-Meteo falló y se usó el fallback TWC (pronóstico degradado a 1 modelo) */
  degraded?: boolean
  /** razón del fallo de Open-Meteo (para cron_log / diagnóstico) */
  degradedReason?: string
}

const WMO_LABELS: Record<number, { label: string; icon: string; severity: 'none' | 'low' | 'moderate' | 'severe' }> = {
  0:  { label: 'Despejado', icon: '☀️', severity: 'none' },
  1:  { label: 'Mayormente despejado', icon: '🌤', severity: 'none' },
  2:  { label: 'Parcialmente nublado', icon: '⛅', severity: 'none' },
  3:  { label: 'Nublado', icon: '☁️', severity: 'none' },
  45: { label: 'Niebla', icon: '🌫', severity: 'low' },
  48: { label: 'Niebla con escarcha', icon: '🌫', severity: 'low' },
  51: { label: 'Llovizna ligera', icon: '🌦', severity: 'low' },
  53: { label: 'Llovizna moderada', icon: '🌦', severity: 'low' },
  55: { label: 'Llovizna densa', icon: '🌧', severity: 'moderate' },
  56: { label: 'Llovizna helada ligera', icon: '🌧', severity: 'moderate' },
  57: { label: 'Llovizna helada densa', icon: '🌧', severity: 'moderate' },
  61: { label: 'Lluvia ligera', icon: '🌦', severity: 'low' },
  63: { label: 'Lluvia moderada', icon: '🌧', severity: 'moderate' },
  65: { label: 'Lluvia fuerte', icon: '🌧', severity: 'moderate' },
  66: { label: 'Lluvia helada ligera', icon: '🌧', severity: 'moderate' },
  67: { label: 'Lluvia helada fuerte', icon: '🌧', severity: 'severe' },
  71: { label: 'Nieve ligera', icon: '🌨', severity: 'moderate' },
  73: { label: 'Nieve moderada', icon: '❄', severity: 'severe' },
  75: { label: 'Nieve fuerte', icon: '❄', severity: 'severe' },
  77: { label: 'Granos de nieve', icon: '❄', severity: 'moderate' },
  80: { label: 'Chubascos ligeros', icon: '🌦', severity: 'low' },
  81: { label: 'Chubascos moderados', icon: '🌧', severity: 'moderate' },
  82: { label: 'Chubascos violentos', icon: '🌧', severity: 'severe' },
  85: { label: 'Chubascos de nieve ligeros', icon: '🌨', severity: 'moderate' },
  86: { label: 'Chubascos de nieve fuertes', icon: '❄', severity: 'severe' },
  95: { label: 'Tormenta', icon: '⛈', severity: 'severe' },
  96: { label: 'Tormenta con granizo ligero', icon: '⛈', severity: 'severe' },
  99: { label: 'Tormenta con granizo fuerte', icon: '⛈', severity: 'severe' },
}

export function getWeatherInfo(code: number, precipitation: number): { label: string; icon: string; severity: 'none' | 'low' | 'moderate' | 'severe' } {
  const base = WMO_LABELS[code] ?? { label: 'Desconocido', icon: '❓', severity: 'none' as const }
  if (precipitation >= 25 && (code === 61 || code === 63 || code === 80 || code === 81)) {
    return { ...base, severity: 'severe' as const }
  }
  if (precipitation >= 10 && code >= 61 && code <= 67) {
    return { ...base, severity: 'moderate' as const }
  }
  return base
}

/**
 * FALLBACK: pronóstico máximo diario desde TWC v3 (1 solo modelo, degradado).
 * Se usa SOLO cuando Open-Meteo falla por completo para una ciudad (p.ej. 429).
 * calendarDayTemperatureMax[0] = hoy local en la ubicación; el índice se calcula
 * como días entre la fecha objetivo y el "hoy local" aproximado (UTC + lon/15).
 */
export async function fetchTWCForecastMax(lat: number, lon: number, fechaISO: string): Promise<number | null> {
  try {
    const url = `https://api.weather.com/v3/wx/forecast/daily/5day?geocode=${lat},${lon}&apiKey=${TWC_API_KEY}&units=e&language=en-US&format=json`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return null
    const data = await resp.json()
    const maxes: (number | null)[] = data?.calendarDayTemperatureMax ?? []
    const offsetH = Math.round(lon / 15)
    const localToday = new Date(Date.now() + offsetH * 3600000).toISOString().slice(0, 10)
    const diffDays = Math.round(
      (new Date(fechaISO + 'T12:00:00Z').getTime() - new Date(localToday + 'T12:00:00Z').getTime()) / 86400000
    )
    const idx = Math.max(0, Math.min(maxes.length - 1, diffDays))
    const maxF = maxes[idx]
    if (maxF === null || maxF === undefined) return null
    return Math.round((maxF - 32) * 5 / 9 * 100) / 100
  } catch {
    return null
  }
}

/**
 * Pronóstico máximo diario desde OpenWeatherMap 5-day/3h (free tier).
 * Máximo de main.temp de las entradas 3-horarias del día LOCAL objetivo
 * (la API devuelve el offset horario de la ciudad en city.timezone).
 * Requiere OPENWEATHERMAP_API_KEY; sin key o con key inactiva devuelve null.
 */
export async function fetchOWMForecastMax(lat: number, lon: number, fechaISO: string): Promise<number | null> {
  if (!OWM_API_KEY) return null
  const dateStr = fechaISO.slice(0, 10)
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${OWM_API_KEY}`
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) {
      // 401 = key nueva aún no activa (tarda ~2h en OWM) o key inválida
      console.warn(`[OWM] HTTP ${resp.status} lat=${lat} lon=${lon} ${dateStr}`)
      return null
    }
    const data = await resp.json()
    const tzSec: number = typeof data?.city?.timezone === 'number' ? data.city.timezone : 0
    const list: any[] = Array.isArray(data?.list) ? data.list : []
    const temps = list
      .filter(e => new Date((e.dt + tzSec) * 1000).toISOString().slice(0, 10) === dateStr)
      .map(e => e?.main?.temp)
      .filter((t: any) => typeof t === 'number')
    if (temps.length === 0) return null
    return Math.round(Math.max(...temps) * 100) / 100
  } catch {
    return null
  }
}

/**
 * Fetch weather model forecasts AND ECMWF ENS 51 ensemble members.
 *
 * Estrategia anti-429 (cuota diaria por IP de Open-Meteo):
 * 1. Una sola llamada por ciudad con los 6 modelos juntos (minimiza llamadas).
 * 2. Reintentos con jitter solo en 429/5xx/timeout (2 → 3 intentos).
 * 3. API key propia vía OPENMETEO_API_KEY (recomendado — ver .env.example).
 * 4. OpenWeatherMap en PARALELO con Open-Meteo (modelo 'owm' del ensemble).
 * 5. Si Open-Meteo falla para la ciudad: FALLBACK OWM (1 modelo) y si también
 *    falla: FALLBACK TWC v3 — pronóstico degradado a 1 modelo, flagged como
 *    `degraded`) para garantizar 10/10 ciudades.
 */
export async function fetchWeatherModels(
  lat: number,
  lon: number,
  fechaISO: string,
  modelos?: string[]
): Promise<WeatherModelsResult> {
  const toTry = modelos ?? MODELOS_CLIMATICOS
  const results: ModelTemps = {}
  const ensembleMembers: number[] = []

  // OWM en paralelo con Open-Meteo (no agrega latencia al camino crítico)
  const owmPromise = fetchOWMForecastMax(lat, lon, fechaISO)

  const modelsParam = toTry.join(',')
  const baseUrl = `${OPENMETEO_BASE}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,weather_code,precipitation_sum,precipitation_probability_max&temperature_unit=celsius&start_date=${fechaISO}&end_date=${fechaISO}&models=${modelsParam}&timezone=auto`

  const r = await omFetchJson(baseUrl, 12000, 3)
  if (r.ok && r.data?.daily) {
    const daily = r.data.daily

    for (const model of toTry) {
      const key = `temperature_2m_max_${model}`
      const temps = daily[key]
      if (temps && Array.isArray(temps) && temps.length > 0 && temps[0] !== null) {
        results[model] = temps[0]
      }
    }

    for (const key of Object.keys(daily)) {
      if (key.startsWith('temperature_2m_max_member') && key.includes('ecmwf_ens')) {
        const vals = daily[key]
        if (vals && Array.isArray(vals) && vals.length > 0 && vals[0] !== null) {
          ensembleMembers.push(vals[0])
        }
      }
    }

    const weatherCode = daily.weather_code_best_match?.[0] ?? daily.weather_code?.[0] ?? 0
    const precipitation = daily.precipitation_sum_best_match?.[0] ?? daily.precipitation_sum?.[0] ?? 0

    if (Object.keys(results).length > 0) {
      // Open-Meteo OK → sumar 'owm' al ensemble si está disponible (+1 modelo)
      const owmTemp = await owmPromise
      if (owmTemp !== null) results['owm'] = owmTemp
      return { models: results, ensembleMembers, weatherCode, precipitation }
    }
  }

  // Open-Meteo falló o devolvió 0 modelos → FALLBACK OWM (si hay key activa)
  const failReason = r.err ?? 'respuesta sin modelos'
  const owmTemp = await owmPromise
  if (owmTemp !== null) {
    console.warn(`[Open-Meteo] FALLBACK OWM lat=${lat} lon=${lon} ${fechaISO} → ${owmTemp}°C (1 modelo OWM). Razón: ${failReason}`)
    return {
      models: { owm: owmTemp },
      ensembleMembers: [],
      weatherCode: 0,
      precipitation: 0,
      degraded: true,
      degradedReason: failReason,
    }
  }

  // OWM también falló (o no hay key) → fallback TWC para no perder la ciudad
  const twcTemp = await fetchTWCForecastMax(lat, lon, fechaISO)
  if (twcTemp !== null) {
    console.warn(`[Open-Meteo] FALLBACK TWC lat=${lat} lon=${lon} ${fechaISO} → ${twcTemp}°C (degradado, 1 modelo). Razón: ${failReason}`)
    return {
      models: { twc: twcTemp },
      ensembleMembers: [],
      weatherCode: 0,
      precipitation: 0,
      degraded: true,
      degradedReason: failReason,
    }
  }

  console.error(`[Open-Meteo] FAILED lat=${lat} lon=${lon} ${fechaISO} (Open-Meteo y TWC fallaron): ${failReason}`)
  return { models: results, ensembleMembers, weatherCode: 0, precipitation: 0, degradedReason: failReason }
}
