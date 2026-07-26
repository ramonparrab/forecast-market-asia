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
 * After resolution, each contract has YES price = 1 (true) or 0 (false).
 * The highest temperature value with YES=1 is the real temperature (integer °C).
 * Handles both formats: "34°C" (exact) and "34°C or higher" (superior).
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

    const markets: GammaMarket[] = events[0].markets || []
    let maxResolved = -Infinity
    let anyResolved = false

    for (const market of markets) {
      let outcomePrices: string[]
      if (typeof market.outcomePrices === 'string') {
        try { outcomePrices = JSON.parse(market.outcomePrices) } catch { continue }
      } else {
        outcomePrices = market.outcomePrices as string[]
      }
      if (!outcomePrices?.length) continue

      const yesPrice = parseFloat(outcomePrices[0])
      if (yesPrice !== 0 && yesPrice !== 1) continue

      const texto = (market as any).groupItemTitle || market.question || ''
      if (!texto) continue

      // Skip "or below" contracts (inferior/range) — we want the highest YES
      const lower = texto.toLowerCase()
      if (lower.includes('or below') || lower.includes('under') || lower.includes('or lower')) continue

      const nums = texto.match(/\d+/g)
      if (!nums) continue

      const value = parseInt(nums[0])
      anyResolved = true

      if (yesPrice === 1 && value > maxResolved) {
        maxResolved = value
      }
    }

    if (!anyResolved) return null
    if (maxResolved === -Infinity) return null

    return maxResolved
  } catch (e) {
    console.error(`[Polymarket] settlement fetch error for ${slug} ${fechaObjetivo}:`, (e as Error).message)
    return null
  }
}

/**
 * Fetch Polymarket contracts for a given city/date using Gamma API.
 * Builds the exact event slug instead of searching by title.
 */
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
