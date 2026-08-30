import { PolymarketContract } from '@/types'

const GAMMA_API = 'https://gamma-api.polymarket.com'

interface GammaMarket {
  conditionId: string
  outcomes: string[]
  outcomePrices?: string[]
  volume?: string
  volumeNum?: number
  bestBid?: string
  bestAsk?: string
  question?: string
  groupItemTitle?: string
}

interface GammaPrice {
  price: string
  tokenID?: string
}

const MONTHS = ['january','february','march','april','may','june',
                'july','august','september','october','november','december']

/**
 * Fetch the actual settlement temperature from resolved Polymarket contracts.
 *
 * Strategy (3 passos):
 * 1. PASSO RÍGIDO: Busca contratos con yesPrice EXACTAMENTE 1.0 (resolución formal on-chain reflejada en Gamma).
 * 2. PASSO EVENTO CERRADO: Si el evento tiene `closed: true` pero Gamma aún no actualizó a 1.0,
 *    infiere la temperatura real del contrato "exacto" con mayor precio YES.
 * 3. PASSO INFERENCIA: Si ningún contrato tiene yes=1 pero hay un contrato exacto con > 0.95,
 *    lo usa como temperatura real (caso raro: mercado resuelto pero Gamma retrasada).
 */
export async function fetchActualTempFromPolymarket(
  slug: string,
  fechaObjetivo: string
): Promise<number | null> {
  try {
    const date = new Date(fechaObjetivo + 'T12:00:00Z')
    const monthName = MONTHS[date.getUTCMonth()]
    const day = date.getUTCDate()
    const year = date.getUTCFullYear()
    const eventSlug = `highest-temperature-in-${slug}-on-${monthName}-${day}-${year}`

    const eventsResp = await fetch(`${GAMMA_API}/events?slug=${encodeURIComponent(eventSlug)}`, {
      signal: AbortSignal.timeout(15000)
    })
    if (!eventsResp.ok) return null

    const events = await eventsResp.json()
    if (!events?.length) return null

    const eventClosed = !!events[0].closed
    const markets: GammaMarket[] = events[0].markets || []
    let maxResolved = -Infinity
    let anyResolved = false

    // Passo 1 y 2: recolectar todos los contratos con precios
    interface ParsedContract {
      value: number
      yesPrice: number
      tipo: 'exacto' | 'superior' | 'inferior'
    }
    const parsed: ParsedContract[] = []

    for (const market of markets) {
      let outcomePrices: string[]
      if (typeof market.outcomePrices === 'string') {
        try { outcomePrices = JSON.parse(market.outcomePrices) } catch { continue }
      } else {
        outcomePrices = market.outcomePrices as string[]
      }
      if (!outcomePrices?.length) continue

      const yesPrice = parseFloat(outcomePrices[0])
      const texto = (market as any).groupItemTitle || market.question || ''
      if (!texto) continue

      const lower = texto.toLowerCase()
      if (lower.includes('or below') || lower.includes('under') || lower.includes('or lower')) continue

      const nums = texto.match(/\d+/g)
      if (!nums) continue

      const value = parseInt(nums[0])
      const tipo: 'exacto' | 'superior' = (lower.includes('or higher') || lower.includes('above') || lower.includes('over'))
        ? 'superior' : 'exacto'

      parsed.push({ value, yesPrice, tipo })

      // PASSO 1: resolución formal reflejada en Gamma (yesPrice === 1)
      if (yesPrice === 1 && tipo === 'exacto' && value > maxResolved) {
        maxResolved = value
      }
      if (yesPrice === 0 || yesPrice === 1) {
        anyResolved = true
      }
    }

    // PASSO 1 resultado: si encontramos un exacto con YES=1, ya tenemos la temp real
    if (maxResolved !== -Infinity) {
      return maxResolved
    }

    // PASSO 2: evento cerrado pero Gamma aún no actualizó precios a 1.0
    // Usar el contrato "exacto" con mayor precio YES como temperatura inferida.
    if (eventClosed) {
      const exactos = parsed.filter(c => c.tipo === 'exacto')
      if (exactos.length > 0) {
        const best = exactos.reduce((a, b) => b.yesPrice > a.yesPrice ? b : a)
        if (best.yesPrice > 0.80) {
          console.log(`[Polymarket] Inferred temp from closed event (not yet 1.0): ${slug} ${fechaObjetivo} → ${best.value}°C (yes=${best.yesPrice})`)
          return best.value
        }
      }
    }

    // PASSO 3: inferencia por alta probabilidad (sin require closed)
    // Si hay un exacto con > 0.95 y el día ya terminó en Asia, confiar en él.
    const exactos = parsed.filter(c => c.tipo === 'exacto')
    if (exactos.length > 0) {
      const best = exactos.reduce((a, b) => b.yesPrice > a.yesPrice ? b : a)
      if (best.yesPrice > 0.95 && anyResolved) {
        console.log(`[Polymarket] Inferred temp from high probability: ${slug} ${fechaObjetivo} → ${best.value}°C (yes=${best.yesPrice})`)
        return best.value
      }
    }

    if (!anyResolved) return null
    return null
  } catch (e) {
    console.error(`[Polymarket] settlement fetch error for ${slug} ${fechaObjetivo}:`, (e as Error).message)
    return null
  }
}

/**
 * Fetch Polymarket contracts for a given city/date using Gamma API.
 * Builds the exact event slug instead of searching by title.
 */
/**
 * Detects if the Polymarket event for a city/date is CLOSED (resolved, or locked
 * for resolution) → the day is not bettable anymore. Cached 10 min.
 */
const estadoCache = new Map<string, { cerrado: boolean; ts: number }>()
const ESTADO_TTL = 10 * 60 * 1000

export async function fetchEventoCerrado(slug: string, fechaObjetivo: string): Promise<boolean> {
  const key = slug + '|' + fechaObjetivo
  const hit = estadoCache.get(key)
  if (hit && Date.now() - hit.ts < ESTADO_TTL) return hit.cerrado
  try {
    const date = new Date(fechaObjetivo + 'T12:00:00Z')
    const monthName = MONTHS[date.getUTCMonth()]
    const eventSlug = `highest-temperature-in-${slug}-on-${monthName}-${date.getUTCDate()}-${date.getUTCFullYear()}`
    const eventsResp = await fetch(`${GAMMA_API}/events?slug=${encodeURIComponent(eventSlug)}`, { signal: AbortSignal.timeout(15000) })
    if (!eventsResp.ok) return false
    const events = await eventsResp.json()
    const cerrado = !!events?.[0]?.closed
    estadoCache.set(key, { cerrado, ts: Date.now() })
    return cerrado
  } catch (e) {
    console.error(`[Polymarket] closed-check error for ${slug} ${fechaObjetivo}:`, (e as Error).message)
    return false
  }
}

export async function fetchPolymarketPrices(
  slug: string,
  fechaObjetivo: string
): Promise<PolymarketContract[]> {
  const contracts: PolymarketContract[] = []

  try {
    // Build exact event slug: highest-temperature-in-{city}-on-{month}-{day}-{year}
    const date = new Date(fechaObjetivo + 'T12:00:00Z')
    const monthName = MONTHS[date.getUTCMonth()]
    const day = date.getUTCDate()
    const year = date.getUTCFullYear()
    const eventSlug = `highest-temperature-in-${slug}-on-${monthName}-${day}-${year}`

    // Query event by slug — the response includes embedded markets
    const eventsUrl = `${GAMMA_API}/events?slug=${encodeURIComponent(eventSlug)}`
    const eventsResp = await fetch(eventsUrl, { signal: AbortSignal.timeout(15000) })
    if (!eventsResp.ok) throw new Error(`Events returned ${eventsResp.status}`)

    const events = await eventsResp.json()
    if (!events || events.length === 0) {
      console.warn(`No Polymarket event found for ${eventSlug}`)
      return []
    }

    const event = events[0]
    const markets: GammaMarket[] = event.markets || []

    for (const market of markets) {
      // outcomePrices is a stringified JSON array from Gamma API, parse if needed
      let outcomePrices: string[]
      if (typeof market.outcomePrices === 'string') {
        try { outcomePrices = JSON.parse(market.outcomePrices) } catch { continue }
      } else {
        outcomePrices = market.outcomePrices as string[]
      }
      if (!outcomePrices || outcomePrices.length < 2) continue

      const yesPrice = parseFloat(outcomePrices[0])
      const noPrice = parseFloat(outcomePrices[1])

      // Mid price without vig: (yes + (1 - no)) / 2
      const midPrice = (yesPrice + (1 - noPrice)) / 2
      const probMkt = Math.round(midPrice * 100)

      if (probMkt <= 0 || probMkt > 100) continue

      // Use groupItemTitle for temperature description (outcomes are always ["Yes","No"])
      const texto = (market as any).groupItemTitle || market.question || ''
      if (!texto) continue

      // Determine contract type
      const lower = texto.toLowerCase()
      let tipo: 'exacto' | 'superior' | 'inferior' | 'rango' = 'exacto'
      let valor: number | [number, number] = 0

      const nums = texto.match(/\d+/g)
      if (!nums) continue

      if (lower.includes('or higher') || lower.includes('above') || lower.includes('over')) {
        tipo = 'superior'
        valor = parseInt(nums[0])
      } else if (lower.includes('or lower') || lower.includes('below') || lower.includes('under')) {
        tipo = 'inferior'
        valor = parseInt(nums[0])
      } else if (texto.includes('-') || lower.includes('to')) {
        tipo = 'rango'
        valor = nums.length >= 2 ? [parseInt(nums[0]), parseInt(nums[1])] : [0, 0]
      } else {
        tipo = 'exacto'
        valor = parseInt(nums[0])
      }

      contracts.push({
        token_id: market.conditionId,
        texto: `${texto} ${probMkt}%`,
        tipo,
        valor,
        prob_mkt: probMkt,
        si_pct: Math.round(yesPrice * 100),
        no_pct: Math.round(noPrice * 100),
        volume_24h: market.volumeNum || parseFloat(market.volume || '0'),
        spread: yesPrice && noPrice ? Math.round((yesPrice - noPrice) * 10000) / 10000 : undefined,
      })
    }

    // Sort by temperature value
    contracts.sort((a, b) => {
      const aVal = typeof a.valor === 'number' ? a.valor : (a.valor as [number, number])[0]
      const bVal = typeof b.valor === 'number' ? b.valor : (b.valor as [number, number])[0]
      return aVal - bVal
    })

  } catch (e) {
    console.error(`Error fetching Polymarket data for ${slug}:`, (e as Error).message)
  }

  return contracts
}

/**
 * Parse a contract text to determine type and value.
 */
export function parseContract(texto: string): { tipo: 'exacto' | 'superior' | 'inferior' | 'rango'; valor: number | [number, number] } {
  const lower = texto.toLowerCase()
  const nums = texto.match(/\d+/g)
  const defaultVal = nums ? parseInt(nums[0]) : 0

  if (lower.includes('or higher') || lower.includes('above') || lower.includes('over')) {
    return { tipo: 'superior', valor: defaultVal }
  }
  if (lower.includes('or lower') || lower.includes('below') || lower.includes('under')) {
    return { tipo: 'inferior', valor: defaultVal }
  }
  if (texto.includes('-') || lower.includes('to')) {
    const v = nums && nums.length >= 2 ? [parseInt(nums[0]), parseInt(nums[1])] as [number, number] : [0, 0] as [number, number]
    return { tipo: 'rango', valor: v }
  }
  return { tipo: 'exacto', valor: defaultVal }
}

/**
 * Calculate liquidity level based on volume and spread.
 * ALTA: Volume > $5000 AND spread < $0.03
 * MEDIA: Volume > $1000 OR spread < $0.05
 * BAJA: Everything else
 */
export function calculateLiquidity(
  volume24h: number | undefined,
  spread: number | undefined
): 'ALTA' | 'MEDIA' | 'BAJA' {
  const vol = volume24h ?? 0
  const spr = spread ?? 0.10

  if (vol >= 5000 && spr <= 0.03) return 'ALTA'
  if (vol >= 1000 || spr <= 0.05) return 'MEDIA'
  return 'BAJA'
}

/**
 * Calculate Expected Value (EV) for a bet.
 * EV = (prob_win × profit) - (prob_lose × loss)
 * Positive EV = profitable long-term
 */
export function calculateEV(
  modelProbability: number,
  marketPrice: number,
  potentialProfit: number = 1.0
): number {
  if (marketPrice <= 0 || marketPrice >= 1) return 0
  const edge = modelProbability - marketPrice
  const ev = (modelProbability * potentialProfit) - ((1 - modelProbability) * marketPrice)
  return Math.round(ev * 100) / 100
}
