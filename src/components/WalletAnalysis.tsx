import { useState, useCallback } from 'react'
import type { WalletAnalysisResponse } from '@/pages/api/wallet-analysis'

const PERIODS = [
  { value: '7', label: '7 dias' },
  { value: '15', label: '15 dias' },
  { value: '30', label: '30 dias' },
  { value: '45', label: '45 dias' },
  { value: '60', label: '60 dias' },
  { value: '90', label: '90 dias' },
  { value: '180', label: '180 dias' },
  { value: '360', label: '360 dias' },
  { value: 'global', label: 'Global' },
]

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function pnlColor(v: number): string {
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-gray-400'
}

function pnlBg(v: number): string {
  if (v > 0) return 'bg-emerald-500/10 border-emerald-500/20'
  if (v < 0) return 'bg-red-500/10 border-red-500/20'
  return 'bg-slate-800/50 border-gray-700/30'
}


export default function WalletAnalysis() {
  const [wallet, setWallet] = useState('')
  const [period, setPeriod] = useState('global')
  const [data, setData] = useState<WalletAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedAddr, setResolvedAddr] = useState<string | null>(null)

  const analyze = useCallback(async (w?: string, p?: string) => {
    const input = (w || wallet).trim()
    if (!input) return
    setLoading(true)
    setError(null)
    try {
      const per = p || period
      let addr = input

      // If not a wallet address, try to resolve username
      if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
        const resResp = await fetch(`/api/resolve-username?q=${encodeURIComponent(input)}`)
        const resJson = await resResp.json()
        if (!resResp.ok || !resJson.address) {
          setError(resJson.error || `No se encontro wallet para "${input}"`)
          setLoading(false)
          return
        }
        addr = resJson.address
        setResolvedAddr(addr)
      } else {
        setResolvedAddr(null)
      }

      const resp = await fetch(`/api/wallet-analysis?wallet=${addr}&period=${per}`)
      const json = await resp.json()

      // Auto-register username mapping for future searches
      if (json.username && json.wallet) {
        fetch('/api/resolve-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: json.username, address: json.wallet }),
        }).catch(() => {})
      }

      if (json.error && json.totalWeatherTrades === 0) {
        setError(json.error)
        setData(null)
      } else {
        setData(json)
      }
    } catch (e: any) {
      setError(e.message || 'Error de conexion')
    } finally {
      setLoading(false)
    }
  }, [wallet, period])

  const switchPeriod = useCallback((p: string) => {
    setPeriod(p)
    if (data || wallet) analyze(wallet, p)
  }, [wallet, data, analyze])

  const d = data

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="rounded-xl bg-gradient-to-r from-purple-900/30 via-blue-900/20 to-purple-900/30 border border-purple-500/20 p-5">
        <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
          <span className="text-xs font-bold tracking-tight text-purple-300">THE STOCK MARKET OF EVENTS</span>
          ANALISIS POLYMARKET x WALLET
        </h2>
        <p className="text-xs text-gray-400 mb-4">Analiza las apuestas de temperatura de cualquier wallet en Polymarket</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={wallet}
            onChange={e => setWallet(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyze()}
            placeholder="Wallet (0x...) o username de Polymarket"
            className="flex-1 rounded-lg bg-slate-800 border border-gray-600 px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30"
          />
          <button
            onClick={() => analyze()}
            disabled={loading || !wallet.trim()}
            className="btn-primary flex items-center gap-2 text-sm px-6 py-2.5 whitespace-nowrap disabled:opacity-50"
          >
            {loading ? (
              <><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></span> Analizando...</>
            ) : (
              <><span>🔍</span> Analizar</>
            )}
          </button>
        </div>
      </div>

      {/* Period Selector */}
      {d && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="text-xs text-gray-500 flex-shrink-0">Periodo:</span>
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => switchPeriod(p.value)}
              className={`flex-shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                period === p.value
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20'
                  : 'bg-slate-800 text-gray-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
          <p className="font-medium">Error</p>
          <p className="text-xs mt-1 text-red-300">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-12 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-purple-500/30 border-t-purple-500 mb-3"></div>
          <p className="text-sm text-gray-400">Obteniendo datos de Polymarket...</p>
        </div>
      )}

      {/* Results */}
      {d && !loading && (
        <div className="space-y-5">
          {/* User Info Bar */}
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {resolvedAddr && <span className="text-purple-400 font-medium">{wallet}</span>}
            <span className="font-mono text-gray-400 truncate max-w-[200px] sm:max-w-none">{d.wallet}</span>
            {d.username && <span>· {d.username}</span>}
            {d.pseudonym && <span className="text-purple-400">({d.pseudonym})</span>}
            <span>·</span>
            <span>{d.periodLabel}</span>
            {d.dateRange.from && <span>· {d.dateRange.from} → {d.dateRange.to}</span>}
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4 text-center">
              <p className="text-3xl font-bold text-white">{d.totalWeatherTrades}</p>
              <p className="text-[10px] text-gray-500 mt-1">OPERACIONES WEATHER</p>
            </div>
            <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4 text-center">
              <p className={`text-3xl font-bold ${d.winRate >= 50 ? 'text-emerald-400' : d.winRate >= 30 ? 'text-amber-400' : 'text-red-400'}`}>
                {d.winRate.toFixed(1)}%
              </p>
              <p className="text-[10px] text-gray-500 mt-1">WIN RATE ({d.wins}W / {d.losses}L)</p>
            </div>
            <div className={`rounded-xl border p-4 text-center ${pnlBg(d.totalPnl)}`}>
              <p className={`text-3xl font-bold ${pnlColor(d.totalPnl)}`}>
                {d.totalPnl >= 0 ? '+' : ''}{fmt(d.totalPnl)}
              </p>
              <p className="text-[10px] text-gray-500 mt-1">P&L TOTAL (USD)</p>
            </div>
            <div className={`rounded-xl border p-4 text-center ${pnlBg(d.roi)}`}>
              <p className={`text-3xl font-bold ${pnlColor(d.roi)}`}>
                {d.roi >= 0 ? '+' : ''}{fmt(d.roi)}%
              </p>
              <p className="text-[10px] text-gray-500 mt-1">ROI ({fmt(d.avgEntryPrice)}¢ entrada prom.)</p>
            </div>
          </div>

          {/* Breakdowns Grid */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* By City */}
            {d.byCity.length > 0 && (
              <details open className="rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white hover:text-blue-300 transition flex items-center gap-2">
                  <span>🏙️</span> Por Ciudad
                  <span className="text-xs text-gray-500">({d.byCity.length} ciudades)</span>
                  <span className="ml-auto text-xs text-gray-600">click para colapsar</span>
                </summary>
                <div className="p-4 pt-2 space-y-2">
                  <div className="grid grid-cols-6 gap-1 text-[9px] text-gray-500 font-medium uppercase tracking-wider px-2">
                    <div className="col-span-2">Ciudad</div>
                    <div className="text-right">Ops</div>
                    <div className="text-right">Win%</div>
                    <div className="text-right">Invertido</div>
                    <div className="text-right">ROI</div>
                  </div>
                  {d.byCity.map(c => (
                    <div key={c.city} className="grid grid-cols-6 gap-1 items-center rounded-lg bg-slate-900/50 px-2 py-2 text-xs">
                      <div className="col-span-2 text-white font-medium truncate">{c.city}</div>
                      <div className="text-right text-gray-400">{c.count}</div>
                      <div className={`text-right font-medium ${c.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{c.winRate.toFixed(0)}%</div>
                      <div className="text-right text-gray-400">${fmt(c.invested, 1)}</div>
                      <div className={`text-right font-bold ${pnlColor(c.roi)}`}>{c.roi >= 0 ? '+' : ''}{c.roi.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* By Price Bucket */}
            {d.byPriceBucket.length > 0 && (
              <details open className="rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white hover:text-blue-300 transition flex items-center gap-2">
                  <span>💰</span> Por Precio Entrada
                  <span className="ml-auto text-xs text-gray-600">click para colapsar</span>
                </summary>
                <div className="p-4 pt-2 space-y-2">
                  <div className="grid grid-cols-6 gap-1 text-[9px] text-gray-500 font-medium uppercase tracking-wider px-2">
                    <div className="col-span-2">Bucket</div>
                    <div className="text-right">Ops</div>
                    <div className="text-right">Win%</div>
                    <div className="text-right">P&L</div>
                    <div className="text-right">ROI</div>
                  </div>
                  {d.byPriceBucket.map(b => (
                    <div key={b.bucket} className="grid grid-cols-6 gap-1 items-center rounded-lg bg-slate-900/50 px-2 py-2 text-xs">
                      <div className="col-span-2 text-white font-medium">{b.label}</div>
                      <div className="text-right text-gray-400">{b.count}</div>
                      <div className={`text-right font-medium ${b.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{b.winRate.toFixed(0)}%</div>
                      <div className={`text-right ${pnlColor(b.pnl)}`}>${fmt(b.pnl, 1)}</div>
                      <div className={`text-right font-bold ${pnlColor(b.roi)}`}>{b.roi >= 0 ? '+' : ''}{b.roi.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* By Side */}
            {d.bySide.length > 0 && (
              <details open className="rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white hover:text-blue-300 transition flex items-center gap-2">
                  <span>↔️</span> Por Lado (Yes/No)
                </summary>
                <div className="p-4 pt-2 space-y-2">
                  {d.bySide.map(s => (
                    <div key={s.side} className="rounded-lg bg-slate-900/50 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-sm font-bold ${s.side === 'Yes' ? 'text-emerald-400' : 'text-red-400'}`}>{s.side === 'Yes' ? 'YES' : 'NO'}</span>
                        <span className="text-xs text-gray-500">{s.count} operaciones</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-center text-xs">
                        <div>
                          <p className={`text-lg font-bold ${s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{s.winRate.toFixed(1)}%</p>
                          <p className="text-[10px] text-gray-500">Win Rate</p>
                        </div>
                        <div>
                          <p className={`text-lg font-bold ${pnlColor(s.pnl)}`}>${fmt(s.pnl, 1)}</p>
                          <p className="text-[10px] text-gray-500">P&L</p>
                        </div>
                        <div>
                          <p className={`text-lg font-bold ${pnlColor(s.roi)}`}>{s.roi >= 0 ? '+' : ''}{s.roi.toFixed(1)}%</p>
                          <p className="text-[10px] text-gray-500">ROI</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* By Type */}
            {d.byType.length > 0 && (
              <details open className="rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white hover:text-blue-300 transition flex items-center gap-2">
                  <span>🌡️</span> Por Tipo (Highest/Lowest)
                </summary>
                <div className="p-4 pt-2 space-y-2">
                  {d.byType.map(t => (
                    <div key={t.type} className="rounded-lg bg-slate-900/50 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold text-blue-400">{t.type === 'highest' ? 'Highest Temp' : 'Lowest Temp'}</span>
                        <span className="text-xs text-gray-500">{t.count} operaciones</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-center text-xs">
                        <div>
                          <p className={`text-lg font-bold ${t.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>{t.winRate.toFixed(1)}%</p>
                          <p className="text-[10px] text-gray-500">Win Rate</p>
                        </div>
                        <div>
                          <p className={`text-lg font-bold ${pnlColor(t.pnl)}`}>${fmt(t.pnl, 1)}</p>
                          <p className="text-[10px] text-gray-500">P&L</p>
                        </div>
                        <div>
                          <p className={`text-lg font-bold ${pnlColor(t.roi)}`}>{t.roi >= 0 ? '+' : ''}{t.roi.toFixed(1)}%</p>
                          <p className="text-[10px] text-gray-500">ROI</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Best Trades */}
          {d.bestTrades.length > 0 && (
            <details className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-emerald-400 hover:text-emerald-300 transition flex items-center gap-2">
                <span>🏆</span> Mejores Operaciones
                <span className="ml-auto text-xs text-gray-600">Top {d.bestTrades.length}</span>
              </summary>
              <div className="p-4 pt-2 space-y-1.5 max-h-80 overflow-y-auto">
                {d.bestTrades.map((t, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center rounded-lg bg-slate-900/50 px-3 py-2 text-xs">
                    <div className="col-span-1 text-emerald-500 font-bold">#{i + 1}</div>
                    <div className="col-span-3 text-white truncate">{t.city}</div>
                    <div className="col-span-2 text-gray-400">{t.date}</div>
                    <div className="col-span-2 text-blue-400">{t.tempStr}</div>
                    <div className="col-span-1 text-gray-400">{t.outcome}</div>
                    <div className="col-span-1 text-right text-gray-400">{t.entryPriceCents}¢</div>
                    <div className={`col-span-2 text-right font-bold ${pnlColor(t.cashPnl)}`}>{t.cashPnl >= 0 ? '+' : ''}{fmt(t.cashPnl)}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Worst Trades */}
          {d.worstTrades.length > 0 && (
            <details className="rounded-xl bg-red-500/5 border border-red-500/20 overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-red-400 hover:text-red-300 transition flex items-center gap-2">
                <span>💀</span> Peores Operaciones
                <span className="ml-auto text-xs text-gray-600">Bottom {d.worstTrades.length}</span>
              </summary>
              <div className="p-4 pt-2 space-y-1.5 max-h-80 overflow-y-auto">
                {d.worstTrades.map((t, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center rounded-lg bg-slate-900/50 px-3 py-2 text-xs">
                    <div className="col-span-1 text-red-500 font-bold">#{i + 1}</div>
                    <div className="col-span-3 text-white truncate">{t.city}</div>
                    <div className="col-span-2 text-gray-400">{t.date}</div>
                    <div className="col-span-2 text-blue-400">{t.tempStr}</div>
                    <div className="col-span-1 text-gray-400">{t.outcome}</div>
                    <div className="col-span-1 text-right text-gray-400">{t.entryPriceCents}¢</div>
                    <div className={`col-span-2 text-right font-bold ${pnlColor(t.cashPnl)}`}>{t.cashPnl >= 0 ? '+' : ''}{fmt(t.cashPnl)}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Resolved held losses + Open positions cost */}
          {(d.resolvedHeldLosses > 0 || d.openCost > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {d.resolvedHeldLosses > 0 && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-center">
                  <p className="text-2xl font-bold text-red-400">{d.resolvedHeldLosses}</p>
                  <p className="text-[10px] text-gray-500 mt-1">PERDIDAS HOLD HASTA EXPIRACION</p>
                  <p className="text-xs text-red-300 mt-1">-${fmt(d.resolvedHeldLossAmount)} total</p>
                </div>
              )}
              {d.openCost > 0 && (
                <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-4 text-center">
                  <p className="text-2xl font-bold text-blue-400">{d.openPositions.length}</p>
                  <p className="text-[10px] text-gray-500 mt-1">POSICIONES ABIERTAS</p>
                  <p className="text-xs text-blue-300 mt-1">${fmt(d.openCost)} invertado</p>
                </div>
              )}
            </div>
          )}

          {/* Open Positions */}
          {d.openPositions.length > 0 && (
            <details className="rounded-xl bg-blue-500/5 border border-blue-500/20 overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-blue-400 hover:text-blue-300 transition flex items-center gap-2">
                <span>📊</span> Posiciones Abiertas
                <span className="ml-auto text-xs text-gray-600">{d.openPositions.length} activas</span>
              </summary>
              <div className="p-4 pt-2 space-y-1.5">
                {d.openPositions.map((p, i) => (
                  <div key={i} className="grid grid-cols-7 gap-2 items-center rounded-lg bg-slate-900/50 px-3 py-2 text-xs">
                    <div className="col-span-2 text-white truncate">{p.city}</div>
                    <div className="col-span-1 text-gray-400">{p.temp}°C</div>
                    <div className="col-span-1 text-blue-400">{p.outcome}</div>
                    <div className="col-span-1 text-right text-gray-400">{p.priceCents}¢</div>
                    <div className="col-span-1 text-right text-gray-400">{p.size.toFixed(1)}</div>
                    <div className="col-span-1 text-right text-gray-300">${fmt(p.invested, 1)}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Full Trade Log */}
          {d.allTrades.length > 0 && (
            <details className="rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-400 hover:text-white transition flex items-center gap-2">
                <span>📋</span> Todas las Operaciones
                <span className="ml-auto text-xs text-gray-600">{d.allTrades.length} registros</span>
              </summary>
              <div className="p-4 pt-2">
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-800">
                      <tr className="text-[9px] text-gray-500 uppercase tracking-wider">
                        <th className="text-left py-2 px-2">Fecha</th>
                        <th className="text-left py-2 px-2">Ciudad</th>
                        <th className="text-left py-2 px-2">Temp</th>
                        <th className="text-left py-2 px-2">Lado</th>
                        <th className="text-right py-2 px-2">Entrada</th>
                        <th className="text-right py-2 px-2">Invertido</th>
                        <th className="text-right py-2 px-2">P&L</th>
                        <th className="text-right py-2 px-2">ROI%</th>
                        <th className="text-center py-2 px-2">Res.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...d.allTrades].sort((a, b) => b.date.localeCompare(a.date)).map((t, i) => (
                        <tr key={i} className="border-t border-gray-800/50 hover:bg-slate-800/50">
                          <td className="py-1.5 px-2 text-gray-400">{t.date}</td>
                          <td className="py-1.5 px-2 text-white">{t.city}</td>
                          <td className="py-1.5 px-2 text-blue-400">{t.tempStr}</td>
                          <td className="py-1.5 px-2">
                            <span className={t.outcome === 'Yes' ? 'text-emerald-400' : 'text-red-400'}>{t.outcome}</span>
                          </td>
                          <td className="py-1.5 px-2 text-right text-gray-400">{t.entryPriceCents}¢</td>
                          <td className="py-1.5 px-2 text-right text-gray-400">${fmt(t.invested, 1)}</td>
                          <td className={`py-1.5 px-2 text-right font-medium ${pnlColor(t.cashPnl)}`}>{t.cashPnl >= 0 ? '+' : ''}{fmt(t.cashPnl)}</td>
                          <td className={`py-1.5 px-2 text-right ${pnlColor(t.percentPnl)}`}>{t.percentPnl >= 0 ? '+' : ''}{t.percentPnl.toFixed(0)}%</td>
                          <td className="py-1.5 px-2 text-center">
                            {t.won ? <span className="text-emerald-400">W</span> : <span className="text-red-400">L</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
