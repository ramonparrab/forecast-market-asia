import { PolymarketContract } from '@/types'

const GAMMA_API = 'https://gamma-api.polymarket.com'

interface GammaMarket {
  conditionId: string
  outcomes: string[]
  outcomePrices?: string[]
  volume?: string
}

interface GammaPrice {
  price: string
  tokenID?: string
}

/**
 * Fetch Polymarket contracts for a given city/date using Gamma API.
 * This replaces the fragile Playwright scraping.
 */
export async function fetchPolymarketPrices(
  slug: string,
  fechaObjetivo: string
): Promise<PolymarketContract[]> {
  const contracts: PolymarketContract[] = []

  try {
    // Search for the event
    const query = encodeURIComponent(`highest temperature in ${slug} on ${fechaObjetivo}`)
    const searchUrl = `${GAMMA_API}/events?tag=weather&closed=false&limit=5&title=${query}`

    const searchResp = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) })
    if (!searchResp.ok) throw new Error(`Search returned ${searchResp.status}`)

    const events = await searchResp.json()
    if (!events || events.length === 0) {
      console.warn(`No Polymarket event found for ${slug} on ${fechaObjetivo}`)
      return []
    }

    const event = events[0]
    const eventSlug = event.slug

    // Get markets for this event
    const marketsUrl = `${GAMMA_API}/markets?tag=weather&limit=50&closed=false&slug=${eventSlug}`
    const marketsResp = await fetch(marketsUrl, { signal: AbortSignal.timeout(15000) })
    if (!marketsResp.ok) throw new Error(`Markets returned ${marketsResp.status}`)

    const markets: GammaMarket[] = await marketsResp.json()

    for (const market of markets) {
      if (!market.outcomePrices || market.outcomePrices.length < 2) continue

      const yesPrice = parseFloat(market.outcomePrices[0])
      const noPrice = parseFloat(market.outcomePrices[1])

      // Mid price without vig: (yes + (1 - no)) / 2
      const midPrice = (yesPrice + (1 - noPrice)) / 2
      const probMkt = Math.round(midPrice * 100)

      if (probMkt <= 0 || probMkt > 100) continue

      // Parse outcome to get temperature description
      const outcome = market.outcomes[0] || ''
      const texto = outcome.trim()

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
