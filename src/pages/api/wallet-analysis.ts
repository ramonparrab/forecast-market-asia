import type { NextApiRequest, NextApiResponse } from 'next'

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

interface RawPosition {
  proxyWallet: string
  asset: string
  conditionId: string
  size: number
  avgPrice: number
  initialValue: number
  grossInitialValue: number
  entryFeesUsdc: number
  currentValue: number
  cashPnl: number
  percentPnl: number
  totalBought: number
  realizedPnl: number
  percentRealizedPnl: number
  curPrice: number
  redeemable: boolean
  title: string
  slug: string
  eventId: string
  eventSlug: string
  outcome: string
  outcomeIndex: number
  oppositeOutcome: string
  endDate: string
  negativeRisk: boolean
}

interface RawActivity {
  proxyWallet: string
  timestamp: number
  conditionId: string
  type: string
  size: number
  usdcSize: number
  transactionHash: string
  price: number
  asset: string
  side: string
  outcomeIndex: number
  title: string
  slug: string
  icon: string
  eventSlug: string
  outcome: string
  name: string
  pseudonym: string
}

interface ParsedTrade {
  title: string
  city: string
  temp: number
  date: string
  outcome: string
  side: string
  entryPriceCents: number
  shares: number
  invested: number
  cashPnl: number
  percentPnl: number
  won: boolean
  type: string
  tempStr: string
}

interface CityBreakdown { city: string; count: number; wins: number; winRate: number; invested: number; pnl: number; roi: number }
interface PriceBucket { bucket: string; label: string; count: number; wins: number; winRate: number; invested: number; pnl: number; roi: number }
interface SideBreakdown { side: string; count: number; wins: number; winRate: number; invested: number; pnl: number; roi: number }
interface TypeBreakdown { type: string; count: number; wins: number; winRate: number; invested: number; pnl: number; roi: number }

interface OpenPosition {
  title: string
  city: string
  temp: number
  date: string
  outcome: string
  side: string
  priceCents: number
  size: number
  invested: number
  timestamp: string
  txHash: string
  slug: string
}

export interface WalletAnalysisResponse {
  wallet: string
  period: string
  periodLabel: string
  totalWeatherTrades: number
  wins: number
  losses: number
  winRate: number
  totalInvested: number
  totalPnl: number
  roi: number
  avgEntryPrice: number
  byCity: CityBreakdown[]
  byPriceBucket: PriceBucket[]
  bySide: SideBreakdown[]
  byType: TypeBreakdown[]
  bestTrades: ParsedTrade[]
  worstTrades: ParsedTrade[]
  allTrades: ParsedTrade[]
  openPositions: OpenPosition[]
  username: string
  pseudonym: string
  dateRange: { from: string; to: string }
  fetchedAt: string
  error?: string
}

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function parseWeatherTitle(title: string): { city: string; temp: number; date: string; type: string; tempStr: string } | null {
  const mHighest = title.match(/Will the (highest) temperature in ([A-Za-z\s]+?) be (\d+)°C.*?on ([A-Za-z]+ \d+)(?:,? (\d{4}))?/)
  if (mHighest) {
    const dateStr = mHighest[4] + (mHighest[5] ? ', ' + mHighest[5] : '')
    return { city: mHighest[2].trim(), temp: parseInt(mHighest[3]), date: dateStr, type: 'highest', tempStr: mHighest[3] + '°C' }
  }
  const mLowest = title.match(/Will the (lowest) temperature in ([A-Za-z\s]+?) be (\d+)°C.*?on ([A-Za-z]+ \d+)(?:,? (\d{4}))?/)
  if (mLowest) {
    const dateStr = mLowest[4] + (mLowest[5] ? ', ' + mLowest[5] : '')
    return { city: mLowest[2].trim(), temp: parseInt(mLowest[3]), date: dateStr, type: 'lowest', tempStr: mLowest[3] + '°C' }
  }
  const mOrBelow = title.match(/Will the (highest) temperature in ([A-Za-z\s]+?) be (\d+)°C or below.*?on ([A-Za-z]+ \d+)(?:,? (\d{4}))?/)
  if (mOrBelow) {
    const dateStr = mOrBelow[4] + (mOrBelow[5] ? ', ' + mOrBelow[5] : '')
    return { city: mOrBelow[2].trim(), temp: parseInt(mOrBelow[3]), date: dateStr, type: 'highest', tempStr: mOrBelow[3] + '°C or below' }
  }
  return null
}

function parseEndDate(endDate: string): Date {
  // endDate is "2026-06-06" format
  const parts = endDate.split('-')
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 23, 59, 59)
}

function parseTradeDate(dateStr: string): Date {
  // dateStr is "June 6" or "June 6, 2026"
  const now = new Date()
  const currentYear = now.getFullYear()
  // Try with year first
  const withYear = new Date(dateStr + (dateStr.includes(',') ? '' : ', ' + currentYear))
  if (!isNaN(withYear.getTime())) return withYear
  return new Date(dateStr)
}

function getPriceBucket(cents: number): { bucket: string; label: string } {
  if (cents < 10) return { bucket: '<10', label: '<10¢' }
  if (cents < 25) return { bucket: '10-24', label: '10-24¢' }
  if (cents < 45) return { bucket: '25-44', label: '25-44¢' }
  if (cents < 65) return { bucket: '45-64', label: '45-64¢' }
  if (cents < 85) return { bucket: '65-84', label: '65-84¢' }
  return { bucket: '85+', label: '85¢+' }
}

function getPeriodDays(period: string): number | null {
  const map: Record<string, number | null> = {
    '7': 7, '15': 15, '30': 30, '45': 45, '60': 60, '90': 90, '180': 180, '360': 360, 'global': null
  }
  return map[period] ?? null
}

function getPeriodLabel(period: string): string {
  if (period === 'global') return 'GLOBAL (todo el historial)'
  return `Ultimos ${period} dias`
}

/* ------------------------------------------------------------------
   API Route
   ------------------------------------------------------------------ */

export default async function handler(req: NextApiRequest, res: NextApiResponse<WalletAnalysisResponse>) {
  const wallet = (req.query.wallet as string || '').trim()
  const period = (req.query.period as string || 'global').trim()

  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return res.status(400).json({
      wallet, period, periodLabel: getPeriodLabel(period),
      totalWeatherTrades: 0, wins: 0, losses: 0, winRate: 0,
      totalInvested: 0, totalPnl: 0, roi: 0, avgEntryPrice: 0,
      byCity: [], byPriceBucket: [], bySide: [], byType: [],
      bestTrades: [], worstTrades: [], allTrades: [], openPositions: [],
      username: '', pseudonym: '', dateRange: { from: '', to: '' }, fetchedAt: new Date().toISOString(),
      error: 'Wallet address invalida. Debe ser 0x... (40 hex chars)'
    })
  }

  try {
    // 1. Fetch ALL positions (paginated)
    const allRawPositions: RawPosition[] = []
    let offset = 0
    const limit = 200
    while (true) {
      const url = `https://data-api.polymarket.com/positions?user=${wallet}&limit=${limit}&offset=${offset}`
      const resp = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000)
      })
      if (!resp.ok) throw new Error(`Positions API error: ${resp.status}`)
      const batch: RawPosition[] = await resp.json()
      allRawPositions.push(...batch)
      if (batch.length < limit) break
      offset += limit
      if (offset > 2000) break // safety limit
    }

    // 2. Fetch activity (open/active positions - last 200 trades)
    let allActivity: RawActivity[] = []
    let username = ''
    let pseudonym = ''
    try {
      const actUrl = `https://data-api.polymarket.com/activity?user=${wallet}&limit=200&offset=0`
      const actResp = await fetch(actUrl, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000)
      })
      if (actResp.ok) {
        allActivity = await actResp.json()
        if (allActivity.length > 0) {
          username = allActivity[0].name || ''
          pseudonym = allActivity[0].pseudonym || ''
        }
      }
    } catch { /* non-critical */ }

    // 3. Filter weather positions
    const weatherRaw = allRawPositions.filter(p =>
      p.title.toLowerCase().includes('temperature')
    )

    // 4. Parse trades
    const allTrades: ParsedTrade[] = []
    for (const p of weatherRaw) {
      const parsed = parseWeatherTitle(p.title)
      if (!parsed) continue

      const endDate = parseEndDate(p.endDate)
      allTrades.push({
        title: p.title,
        city: parsed.city,
        temp: parsed.temp,
        date: p.endDate,
        outcome: p.outcome,
        side: p.outcome, // Yes or No
        entryPriceCents: Math.round(p.avgPrice * 1000) / 10,
        shares: p.size,
        invested: Math.abs(p.initialValue),
        cashPnl: p.cashPnl,
        percentPnl: p.percentPnl,
        won: p.cashPnl > 0,
        type: parsed.type,
        tempStr: parsed.tempStr,
      })
    }

    // 5. Filter by period
    const periodDays = getPeriodDays(period)
    let filteredTrades = allTrades
    if (periodDays !== null) {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - periodDays)
      filteredTrades = allTrades.filter(t => parseEndDate(t.date) >= cutoff)
    }

    // 6. Compute summaries
    const wins = filteredTrades.filter(t => t.won).length
    const losses = filteredTrades.filter(t => !t.won).length
    const totalInvested = filteredTrades.reduce((s, t) => s + t.invested, 0)
    const totalPnl = filteredTrades.reduce((s, t) => s + t.cashPnl, 0)
    const roi = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0
    const avgEntryPrice = filteredTrades.length > 0
      ? filteredTrades.reduce((s, t) => s + t.entryPriceCents, 0) / filteredTrades.length
      : 0

    // 7. By City
    const cityMap = new Map<string, ParsedTrade[]>()
    for (const t of filteredTrades) {
      if (!cityMap.has(t.city)) cityMap.set(t.city, [])
      cityMap.get(t.city)!.push(t)
    }
    const byCity: CityBreakdown[] = Array.from(cityMap.entries())
      .map(([city, trades]) => {
        const w = trades.filter(t => t.won).length
        const inv = trades.reduce((s, t) => s + t.invested, 0)
        const pnl = trades.reduce((s, t) => s + t.cashPnl, 0)
        return { city, count: trades.length, wins: w, winRate: trades.length > 0 ? (w / trades.length) * 100 : 0, invested: inv, pnl, roi: inv > 0 ? (pnl / inv) * 100 : 0 }
      })
      .sort((a, b) => b.roi - a.roi)

    // 8. By Price Bucket
    const bucketMap = new Map<string, ParsedTrade[]>()
    for (const t of filteredTrades) {
      const { bucket } = getPriceBucket(t.entryPriceCents)
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, [])
      bucketMap.get(bucket)!.push(t)
    }
    const byPriceBucket: PriceBucket[] = Array.from(bucketMap.entries())
      .map(([bucket, trades]) => {
        const w = trades.filter(t => t.won).length
        const inv = trades.reduce((s, t) => s + t.invested, 0)
        const pnl = trades.reduce((s, t) => s + t.cashPnl, 0)
        const { label } = getPriceBucket(trades[0].entryPriceCents)
        return { bucket, label, count: trades.length, wins: w, winRate: trades.length > 0 ? (w / trades.length) * 100 : 0, invested: inv, pnl, roi: inv > 0 ? (pnl / inv) * 100 : 0 }
      })
      .sort((a, b) => {
        const order = ['<10', '10-24', '25-44', '45-64', '65-84', '85+']
        return order.indexOf(a.bucket) - order.indexOf(b.bucket)
      })

    // 9. By Side (Yes/No)
    const sideMap = new Map<string, ParsedTrade[]>()
    for (const t of filteredTrades) {
      if (!sideMap.has(t.side)) sideMap.set(t.side, [])
      sideMap.get(t.side)!.push(t)
    }
    const bySide: SideBreakdown[] = Array.from(sideMap.entries())
      .map(([side, trades]) => {
        const w = trades.filter(t => t.won).length
        const inv = trades.reduce((s, t) => s + t.invested, 0)
        const pnl = trades.reduce((s, t) => s + t.cashPnl, 0)
        return { side, count: trades.length, wins: w, winRate: trades.length > 0 ? (w / trades.length) * 100 : 0, invested: inv, pnl, roi: inv > 0 ? (pnl / inv) * 100 : 0 }
      })

    // 10. By Type (highest/lowest)
    const typeMap = new Map<string, ParsedTrade[]>()
    for (const t of filteredTrades) {
      if (!typeMap.has(t.type)) typeMap.set(t.type, [])
      typeMap.get(t.type)!.push(t)
    }
    const byType: TypeBreakdown[] = Array.from(typeMap.entries())
      .map(([type, trades]) => {
        const w = trades.filter(t => t.won).length
        const inv = trades.reduce((s, t) => s + t.invested, 0)
        const pnl = trades.reduce((s, t) => s + t.cashPnl, 0)
        return { type, count: trades.length, wins: w, winRate: trades.length > 0 ? (w / trades.length) * 100 : 0, invested: inv, pnl, roi: inv > 0 ? (pnl / inv) * 100 : 0 }
      })

    // 11. Best / Worst trades
    const sorted = [...filteredTrades].sort((a, b) => b.cashPnl - a.cashPnl)
    const bestTrades = sorted.slice(0, 10)
    const worstTrades = sorted.slice(-10).reverse()

    // 12. Open positions (from activity - trades on unresolved markets)
    const resolvedConditionIds = new Set(allRawPositions.map(p => p.conditionId))
    const openTrades = allActivity
      .filter(a => !resolvedConditionIds.has(a.conditionId) && a.title.toLowerCase().includes('temperature'))
    const seenOpen = new Set<string>()
    const openPositions: OpenPosition[] = []
    for (const a of openTrades) {
      const key = a.conditionId + a.outcome
      if (seenOpen.has(key)) continue
      seenOpen.add(key)
      const parsed = parseWeatherTitle(a.title)
      if (!parsed) continue
      const ts = new Date(a.timestamp * 1000).toISOString()
      openPositions.push({
        title: a.title,
        city: parsed.city,
        temp: parsed.temp,
        date: a.title.match(/on ([A-Za-z]+ \d+)(?:,? (\d{4}))?/)?.[0]?.replace('on ', '') || '',
        outcome: a.outcome,
        side: a.side,
        priceCents: Math.round(a.price * 1000) / 10,
        size: a.size,
        invested: a.usdcSize,
        timestamp: ts,
        txHash: a.transactionHash,
        slug: a.slug,
      })
    }

    // 13. Date range
    const dates = filteredTrades.map(t => t.date).sort()
    const dateRange = dates.length > 0
      ? { from: dates[0], to: dates[dates.length - 1] }
      : { from: '', to: '' }

    res.status(200).json({
      wallet, period, periodLabel: getPeriodLabel(period),
      totalWeatherTrades: filteredTrades.length,
      wins, losses,
      winRate: filteredTrades.length > 0 ? (wins / filteredTrades.length) * 100 : 0,
      totalInvested: Math.round(totalInvested * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      roi: Math.round(roi * 100) / 100,
      avgEntryPrice: Math.round(avgEntryPrice * 10) / 10,
      byCity, byPriceBucket, bySide, byType,
      bestTrades, worstTrades, allTrades: filteredTrades,
      openPositions,
      username, pseudonym, dateRange,
      fetchedAt: new Date().toISOString(),
    })
  } catch (err: any) {
    console.error('[wallet-analysis]', err)
    res.status(500).json({
      wallet, period, periodLabel: getPeriodLabel(period),
      totalWeatherTrades: 0, wins: 0, losses: 0, winRate: 0,
      totalInvested: 0, totalPnl: 0, roi: 0, avgEntryPrice: 0,
      byCity: [], byPriceBucket: [], bySide: [], byType: [],
      bestTrades: [], worstTrades: [], allTrades: [], openPositions: [],
      username: '', pseudonym: '', dateRange: { from: '', to: '' },
      fetchedAt: new Date().toISOString(),
      error: err.message || 'Error desconocido al obtener datos de Polymarket'
    })
  }
}
