import type { NextApiRequest, NextApiResponse } from 'next'

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

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

interface RawPosition {
  proxyWallet: string
  conditionId: string
  size: number
  avgPrice: number
  initialValue: number
  cashPnl: number
  percentPnl: number
  title: string
  outcome: string
  endDate: string
  redeemable: boolean
  curPrice: number
}

interface ParsedTrade {
  title: string
  city: string
  temp: number
  date: string
  outcome: string
  entryPriceCents: number
  invested: number
  cashPnl: number
  percentPnl: number
  won: boolean
  type: string
  tempStr: string
  status: 'completed' | 'resolved_loss' | 'open'
  shares: number
  timestamp: string
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
  priceCents: number
  size: number
  invested: number
  timestamp: string
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
  resolvedHeldLosses: number
  resolvedHeldLossAmount: number
  openCost: number
  error?: string
}

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function parseWeatherTitle(title: string): { city: string; temp: number; date: string; type: string; tempStr: string } | null {
  const mHighest = title.match(/Will the (highest) temperature in ([A-Za-z\s]+?) be (\d+)°C.*?on ([A-Za-z]+ \d+)(?:,? (\d{4}))?/)
  if (mHighest) return { city: mHighest[2].trim(), temp: parseInt(mHighest[3]), date: mHighest[4] + (mHighest[5] ? ', ' + mHighest[5] : ''), type: 'highest', tempStr: mHighest[3] + '°C' }
  const mLowest = title.match(/Will the (lowest) temperature in ([A-Za-z\s]+?) be (\d+)°C.*?on ([A-Za-z]+ \d+)(?:,? (\d{4}))?/)
  if (mLowest) return { city: mLowest[2].trim(), temp: parseInt(mLowest[3]), date: mLowest[4] + (mLowest[5] ? ', ' + mLowest[5] : ''), type: 'lowest', tempStr: mLowest[3] + '°C' }
  const mOrBelow = title.match(/Will the (highest) temperature in ([A-Za-z\s]+?) be (\d+)°C or below.*?on ([A-Za-z]+ \d+)(?:,? (\d{4}))?/)
  if (mOrBelow) return { city: mOrBelow[2].trim(), temp: parseInt(mOrBelow[3]), date: mOrBelow[4] + (mOrBelow[5] ? ', ' + mOrBelow[5] : ''), type: 'highest', tempStr: mOrBelow[3] + '°C or below' }
  return null
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

function fmtN(n: number, d = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
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
      username: '', pseudonym: '', dateRange: { from: '', to: '' },
      fetchedAt: new Date().toISOString(), resolvedHeldLosses: 0, resolvedHeldLossAmount: 0, openCost: 0,
      error: 'Wallet invalida. Formato: 0x... (40 hex chars)'
    })
  }

  try {
    // ===== 1. Fetch ALL activity (paginated) =====
    const allActivity: RawActivity[] = []
    let offset = 0
    const limit = 500
    let username = ''
    let pseudonym = ''

    while (true) {
      const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=${limit}&offset=${offset}`
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(25000) })
      if (!resp.ok) throw new Error(`Activity API ${resp.status}`)
      const batch: RawActivity[] = await resp.json()
      if (batch.length === 0) break
      allActivity.push(...batch)
      if (!username && batch.length > 0) { username = batch[0].name || ''; pseudonym = batch[0].pseudonym || '' }
      if (batch.length < limit) break
      offset += limit
      if (offset > 5000) break
    }

    // ===== 2. Fetch positions (for resolved held-to-expiration LOSERS) =====
    const allPositions: RawPosition[] = []
    offset = 0
    while (true) {
      const url = `https://data-api.polymarket.com/positions?user=${wallet}&limit=200&offset=${offset}`
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(20000) })
      if (!resp.ok) break
      const batch: RawPosition[] = await resp.json()
      if (batch.length === 0) break
      allPositions.push(...batch)
      if (batch.length < 200) break
      offset += 200
      if (offset > 2000) break
    }

    // ===== 3. Filter weather activity and group into positions =====
    const weatherActivity = allActivity.filter(a => a.title.toLowerCase().includes('temperature'))

    const posMap = new Map<string, { buys: RawActivity[]; sells: RawActivity[]; title: string; outcome: string }>()
    for (const a of weatherActivity) {
      const key = a.conditionId + '_' + a.outcome
      if (!posMap.has(key)) posMap.set(key, { buys: [], sells: [], title: a.title, outcome: a.outcome })
      const entry = posMap.get(key)!
      if (a.side === 'BUY') entry.buys.push(a)
      else entry.sells.push(a)
    }

    // ===== 4. Build resolved-positions set (conditionId+outcome) from positions API =====
    const resolvedLossSet = new Set<string>()
    for (const p of allPositions) {
      if (p.title.toLowerCase().includes('temperature') && p.redeemable && p.curPrice === 0) {
        resolvedLossSet.add(p.conditionId + '_' + p.outcome)
      }
    }

    // ===== 5. Classify each position =====
    const periodDays = getPeriodDays(period)
    const cutoffMs = periodDays !== null ? Date.now() - periodDays * 86400000 : 0

    const allTrades: ParsedTrade[] = []
    const openPositionsList: OpenPosition[] = []
    let resolvedHeldLosses = 0
    let resolvedHeldLossAmount = 0
    let openCost = 0

    for (const [key, pos] of posMap) {
      const parsed = parseWeatherTitle(pos.title)
      if (!parsed) continue

      const sharesBought = pos.buys.reduce((s, a) => s + a.size, 0)
      const sharesSold = pos.sells.reduce((s, a) => s + a.size, 0)
      const totalBought = pos.buys.reduce((s, a) => s + a.usdcSize, 0)
      const totalSold = pos.sells.reduce((s, a) => s + a.usdcSize, 0)
      const netShares = sharesBought - sharesSold

      // Use earliest buy timestamp for date filtering
      const firstBuyTs = pos.buys.length > 0 ? Math.min(...pos.buys.map(b => b.timestamp)) : 0
      if (periodDays !== null && firstBuyTs < cutoffMs) continue

      // Average entry price from buys
      const avgEntryPrice = sharesBought > 0 ? (totalBought / sharesBought) * 100 : 0

      // Trade date from activity timestamp
      const tradeDate = firstBuyTs > 0 ? new Date(firstBuyTs * 1000).toISOString().slice(0, 10) : parsed.date.replace(/.*?(\d{4})/, '$1')

      if (Math.abs(netShares) < 0.05) {
        // === COMPLETED: all shares sold ===
        const pnl = totalSold - totalBought
        const pctPnl = totalBought > 0 ? (pnl / totalBought) * 100 : 0
        allTrades.push({
          title: pos.title, city: parsed.city, temp: parsed.temp, date: tradeDate,
          outcome: pos.outcome, entryPriceCents: Math.round(avgEntryPrice * 10) / 10,
          invested: totalBought, cashPnl: pnl, percentPnl: pctPnl,
          won: pnl > 0, type: parsed.type, tempStr: parsed.tempStr,
          status: 'completed', shares: sharesBought, timestamp: new Date(firstBuyTs * 1000).toISOString()
        })
      } else if (netShares > 0) {
        // === STILL HOLDING shares ===
        const isResolvedLoss = resolvedLossSet.has(key)
        if (isResolvedLoss) {
          // Resolved loser held to expiration
          const heldCost = totalBought - totalSold
          resolvedHeldLosses++
          resolvedHeldLossAmount += heldCost
          allTrades.push({
            title: pos.title, city: parsed.city, temp: parsed.temp, date: tradeDate,
            outcome: pos.outcome, entryPriceCents: Math.round(avgEntryPrice * 10) / 10,
            invested: totalBought, cashPnl: -(totalBought - totalSold), percentPnl: -100,
            won: false, type: parsed.type, tempStr: parsed.tempStr,
            status: 'resolved_loss', shares: sharesBought, timestamp: new Date(firstBuyTs * 1000).toISOString()
          })
        } else {
          // Still open (not resolved or resolved winner)
          const heldCost = totalBought - totalSold
          openCost += heldCost
          // Add to open positions list
          const latestBuy = pos.buys.length > 0 ? pos.buys[pos.buys.length - 1] : null
          openPositionsList.push({
            title: pos.title, city: parsed.city, temp: parsed.temp, date: tradeDate,
            outcome: pos.outcome, priceCents: Math.round(avgEntryPrice * 10) / 10,
            size: netShares, invested: heldCost,
            timestamp: new Date(firstBuyTs * 1000).toISOString(),
            slug: latestBuy?.slug || ''
          })
        }
      }
      // Ignore negative net shares (sell before buy anomaly)
    }

    // ===== 6. Compute summaries =====
    const closedTrades = allTrades.filter(t => t.status !== 'open')
    const wins = closedTrades.filter(t => t.won).length
    const losses = closedTrades.length - wins
    const totalInvested = closedTrades.reduce((s, t) => s + t.invested, 0)
    const totalPnl = closedTrades.reduce((s, t) => s + t.cashPnl, 0)
    const roi = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0
    const avgEntryPrice = closedTrades.length > 0
      ? closedTrades.reduce((s, t) => s + t.entryPriceCents, 0) / closedTrades.length
      : 0

    // ===== 7. Breakdowns =====
    const cityMap = new Map<string, ParsedTrade[]>()
    const bucketMap = new Map<string, ParsedTrade[]>()
    const sideMap = new Map<string, ParsedTrade[]>()
    const typeMap = new Map<string, ParsedTrade[]>()

    for (const t of closedTrades) {
      if (!cityMap.has(t.city)) cityMap.set(t.city, [])
      cityMap.get(t.city)!.push(t)
      const { bucket } = getPriceBucket(t.entryPriceCents)
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, [])
      bucketMap.get(bucket)!.push(t)
      if (!sideMap.has(t.outcome)) sideMap.set(t.outcome, [])
      sideMap.get(t.outcome)!.push(t)
      if (!typeMap.has(t.type)) typeMap.set(t.type, [])
      typeMap.get(t.type)!.push(t)
    }

    const byCity: CityBreakdown[] = Array.from(cityMap.entries()).map(([city, trades]) => {
      const w = trades.filter(t => t.won).length
      const inv = trades.reduce((s, t) => s + t.invested, 0)
      const pnl = trades.reduce((s, t) => s + t.cashPnl, 0)
      return { city, count: trades.length, wins: w, winRate: (w / trades.length) * 100, invested: inv, pnl, roi: inv > 0 ? (pnl / inv) * 100 : 0 }
    }).sort((a, b) => b.roi - a.roi)

    const bucketOrder = ['<10', '10-24', '25-44', '45-64', '65-84', '85+']
    const byPriceBucket: PriceBucket[] = Array.from(bucketMap.entries()).map(([bucket, trades]) => {
      const w = trades.filter(t => t.won).length
      const inv = trades.reduce((s, t) => s + t.invested, 0)
      const pnl = trades.reduce((s, t) => s + t.cashPnl, 0)
      const { label } = getPriceBucket(trades[0].entryPriceCents)
      return { bucket, label, count: trades.length, wins: w, winRate: (w / trades.length) * 100, invested: inv, pnl, roi: inv > 0 ? (pnl / inv) * 100 : 0 }
    }).sort((a, b) => bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket))

    const bySide: SideBreakdown[] = Array.from(sideMap.entries()).map(([side, trades]) => {
      const w = trades.filter(t => t.won).length
      const inv = trades.reduce((s, t) => s + t.invested, 0)
      const pnl = trades.reduce((s, t) => s + t.cashPnl, 0)
      return { side, count: trades.length, wins: w, winRate: (w / trades.length) * 100, invested: inv, pnl, roi: inv > 0 ? (pnl / inv) * 100 : 0 }
    })

    const byType: TypeBreakdown[] = Array.from(typeMap.entries()).map(([type, trades]) => {
      const w = trades.filter(t => t.won).length
      const inv = trades.reduce((s, t) => s + t.invested, 0)
      const pnl = trades.reduce((s, t) => s + t.cashPnl, 0)
      return { type, count: trades.length, wins: w, winRate: (w / trades.length) * 100, invested: inv, pnl, roi: inv > 0 ? (pnl / inv) * 100 : 0 }
    })

    // ===== 8. Best / Worst =====
    const sorted = [...closedTrades].sort((a, b) => b.cashPnl - a.cashPnl)
    const bestTrades = sorted.slice(0, 10)
    const worstTrades = sorted.slice(-10).reverse()

    // ===== 9. Date range =====
    const dates = closedTrades.map(t => t.date).sort()
    const dateRange = dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : { from: '', to: '' }

    res.status(200).json({
      wallet, period, periodLabel: getPeriodLabel(period),
      totalWeatherTrades: closedTrades.length,
      wins, losses,
      winRate: closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0,
      totalInvested: Math.round(totalInvested * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      roi: Math.round(roi * 100) / 100,
      avgEntryPrice: Math.round(avgEntryPrice * 10) / 10,
      byCity, byPriceBucket, bySide, byType,
      bestTrades, worstTrades, allTrades: closedTrades,
      openPositions: openPositionsList,
      username, pseudonym, dateRange,
      fetchedAt: new Date().toISOString(),
      resolvedHeldLosses,
      resolvedHeldLossAmount: Math.round(resolvedHeldLossAmount * 100) / 100,
      openCost: Math.round(openCost * 100) / 100,
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
      fetchedAt: new Date().toISOString(), resolvedHeldLosses: 0, resolvedHeldLossAmount: 0, openCost: 0,
      error: err.message || 'Error obteniendo datos de Polymarket'
    })
  }
}
