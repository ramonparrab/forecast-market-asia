import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ScatterChart, Scatter, ZAxis, Cell
} from 'recharts'
import { CIUDADES_ASIA } from '@/lib/cities'

const CITY_COLORS: Record<string, string> = {
  seoul: '#3b82f6',
  beijing: '#ef4444',
  shanghai: '#f59e0b',
  'hong-kong': '#10b981',
  tokyo: '#8b5cf6',
  shenzhen: '#ec4899',
  wuhan: '#06b6d4',
  chongqing: '#f97316',
  chengdu: '#84cc16',
  singapore: '#e879f9',
}

type ContractRow = {
  ciudad: string; slug: string; texto: string
  tipo: 'exacto' | 'superior' | 'inferior' | 'rango'
  valor: number | [number, number]
  prob_mkt: number; si_pct: number; no_pct: number
  prob_ia_norm: number | null; prob_ia_raw: number | null
  edge: number | null; ev: number | null
  volume_24h: number | null; spread: number | null; liquidity: string | null
}

type CityArb = {
  ciudad: string; slug: string
  temp_corregida: number; consenso: string; exito_pct: number
  contratos: ContractRow[]
  arbitraje_desvio: number; arbitraje_nivel: string
  total_contracts: number; best_edge: number | null; worst_edge: number | null; avg_edge: number | null
  total_volume: number
}

type ArbitrajeData = {
  fecha_objetivo: string; run_type: string
  cities: CityArb[]; all_contracts: ContractRow[]
  resumen: {
    total_contracts: number; total_cities: number; contracts_with_edge: number
    avg_edge: number; best_edge: number; total_volume: number; high_ev_count: number
  }
}

type SortKey = 'edge' | 'ev' | 'spread' | 'volume'

function getEdgeColor(edge: number | null): string {
  if (edge === null) return 'text-gray-500'
  if (Math.abs(edge) > 5) return 'text-emerald-400'
  if (Math.abs(edge) > 2) return 'text-amber-400'
  return 'text-gray-400'
}

function getLiqColor(liq: string | null): string {
  if (liq === 'ALTA') return 'text-emerald-400'
  if (liq === 'MEDIA') return 'text-amber-400'
  return 'text-red-400'
}

function getTipoColor(tipo: string): string {
  if (tipo === 'exacto') return 'bg-blue-500/10 text-blue-400'
  if (tipo === 'superior') return 'bg-amber-500/10 text-amber-400'
  if (tipo === 'inferior') return 'bg-purple-500/10 text-purple-400'
  return 'bg-gray-500/10 text-gray-400'
}

function Row({ c, i }: { c: ContractRow; i: number }) {
  const edgeColor = getEdgeColor(c.edge)
  const liqColor = getLiqColor(c.liquidity)
  const evPos = (c.ev ?? 0) > 0.05
  return (
    <tr key={`${c.slug}-${i}`} className="border-t border-gray-700/20 hover:bg-slate-800/40 transition">
      <td className="py-2 pr-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CITY_COLORS[c.slug] ?? '#6b7280' }} />
          <span className="text-gray-300 font-medium whitespace-nowrap">{c.ciudad}</span>
        </div>
      </td>
      <td className="py-2 pr-2 text-gray-400 max-w-[200px] truncate" title={c.texto}>{c.texto}</td>
      <td className="py-2 pr-2">
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${getTipoColor(c.tipo)}`}>{c.tipo}</span>
      </td>
      <td className="py-2 pr-2 text-right font-mono text-gray-300">{c.prob_mkt}%</td>
      <td className="py-2 pr-2 text-right font-mono text-emerald-400">{c.prob_ia_norm ?? '—'}%</td>
      <td className={`py-2 pr-2 text-right font-mono font-bold ${edgeColor}`}>
        {c.edge !== null ? `${c.edge > 0 ? '+' : ''}${c.edge}%` : '—'}
      </td>
      <td className={`py-2 pr-2 text-right font-mono ${evPos ? 'text-emerald-400' : 'text-gray-500'}`}>
        {c.ev !== null ? c.ev.toFixed(3) : '—'}
      </td>
      <td className="py-2 pr-2 text-right font-mono text-gray-400">
        {c.spread !== null ? c.spread.toFixed(4) : '—'}
      </td>
      <td className="py-2 pr-2 text-right font-mono text-gray-400">
        {c.volume_24h ? `$${c.volume_24h.toLocaleString()}` : '—'}
      </td>
      <td className={`py-2 text-right font-medium ${liqColor}`}>{c.liquidity ?? '—'}</td>
    </tr>
  )
}

export default function ArbitragePanel() {
  const [data, setData] = useState<ArbitrajeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterCity, setFilterCity] = useState<string>('all')
  const [filterTipo, setFilterTipo] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortKey>('edge')
  const [selectedCity, setSelectedCity] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'all' | 'opportunities'>('all')

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/arbitraje')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => {
        if (j.data) setData(j.data)
        else setError(j.error || 'Sin datos')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!data) return []
    let contracts = [...data.all_contracts]
    if (filterCity !== 'all') contracts = contracts.filter(c => c.slug === filterCity)
    if (filterTipo !== 'all') contracts = contracts.filter(c => c.tipo === filterTipo)
    if (viewMode === 'opportunities') {
      contracts = contracts.filter(c => c.edge !== null && Math.abs(c.edge) > 2)
    }
    contracts.sort((a, b) => {
      switch (sortBy) {
        case 'edge': return Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0)
        case 'ev': return (b.ev ?? 0) - (a.ev ?? 0)
        case 'spread': return (a.spread ?? 1) - (b.spread ?? 1)
        case 'volume': return (b.volume_24h ?? 0) - (a.volume_24h ?? 0)
        default: return 0
      }
    })
    return contracts
  }, [data, filterCity, filterTipo, sortBy, viewMode])

  const scatterData = useMemo(() => {
    if (!data) return []
    const src = selectedCity
      ? data.all_contracts.filter(c => c.slug === selectedCity)
      : data.all_contracts
    return src
      .filter(c => c.prob_ia_norm !== null)
      .map(c => ({
        x: c.prob_mkt, y: c.prob_ia_norm!, z: c.volume_24h ?? 100,
        ciudad: c.ciudad, slug: c.slug, texto: c.texto, edge: c.edge,
      }))
  }, [data, selectedCity])

  const cityBarData = useMemo(() => {
    if (!data) return []
    return data.cities.map(c => ({
      ciudad: c.ciudad, slug: c.slug,
      avg_edge: c.avg_edge ?? 0, best_edge: c.best_edge ?? 0,
      contracts: c.total_contracts, volume: c.total_volume, desvio: c.arbitraje_desvio,
    }))
  }, [data])

  if (loading) {
    return (
      <div className="card text-center py-16">
        <div className="mb-3 text-3xl animate-pulse">🔍</div>
        <p className="text-gray-400 text-sm">Cargando arbitraje...</p>
      </div>
    )
  }

  if (error || !data || data.cities.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-red-400 text-sm">⚠️ {error || 'Sin contratos disponibles para hoy'}</p>
      </div>
    )
  }

  const r = data.resumen

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">🔍 Arbitraje Polymarket</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {data.fecha_objetivo} · Run {data.run_type} · {r.total_cities} ciudades · {r.total_contracts} contratos
            </p>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode('all')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${viewMode === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-gray-400 hover:text-gray-200'}`}
            >Todos</button>
            <button
              onClick={() => setViewMode('opportunities')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${viewMode === 'opportunities' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-gray-400 hover:text-gray-200'}`}
            >Oportunidades</button>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MiniCard label="Contratos" value={`${r.total_contracts}`} desc={`${r.total_cities} ciudades`} color="text-blue-400" />
        <MiniCard label="Avg Edge" value={`${r.avg_edge > 0 ? '+' : ''}${r.avg_edge}%`} desc={r.avg_edge > 0 ? 'IA sobreestima' : r.avg_edge < 0 ? 'IA subestima' : 'Neutral'} color={Math.abs(r.avg_edge) > 3 ? 'text-emerald-400' : 'text-gray-400'} />
        <MiniCard label="Best Edge" value={`${r.best_edge > 0 ? '+' : ''}${r.best_edge}%`} desc={`${r.contracts_with_edge} con |edge|>2%`} color={r.best_edge > 5 ? 'text-emerald-400' : 'text-amber-400'} />
        <MiniCard label="Volumen 24h" value={`$${(r.total_volume / 1000).toFixed(1)}K`} desc={`${r.high_ev_count} con EV>0.05`} color="text-purple-400" />
      </div>

      {/* Scatter: IA vs Mercado */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
          <h3 className="text-sm font-medium text-gray-400">Prob IA vs Prob Mercado</h3>
          <div className="flex flex-wrap gap-1.5">
            {data.cities.map(c => (
              <button
                key={c.slug}
                onClick={() => setSelectedCity(selectedCity === c.slug ? null : c.slug)}
                className={`rounded-full px-2 py-0.5 text-[9px] font-medium border transition-all ${selectedCity === c.slug ? 'text-white border-transparent' : 'text-gray-500 border-gray-700 bg-slate-800/60 hover:text-gray-300'}`}
                style={selectedCity === c.slug ? { backgroundColor: CITY_COLORS[c.slug] ?? '#6b7280' } : undefined}
              >{c.ciudad}</button>
            ))}
          </div>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="x" name="Mercado %" stroke="#64748b" tick={{ fontSize: 9 }} type="number" domain={[0, 100]} />
              <YAxis dataKey="y" name="IA %" stroke="#64748b" tick={{ fontSize: 9 }} type="number" domain={[0, 100]} />
              <ZAxis dataKey="z" range={[20, 200]} name="Volumen" />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: 11 }}
                labelStyle={{ color: '#94a3b8' }}
                content={({ payload }) => {
                  if (!payload || payload.length === 0) return null
                  const d = payload[0].payload
                  return (
                    <div style={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 10, fontSize: 11 }}>
                      <p style={{ color: '#94a3b8', marginBottom: 4 }}>{d.ciudad}</p>
                      <p style={{ color: '#e2e8f0' }}>{d.texto}</p>
                      <p style={{ color: '#3b82f6' }}>Mercado: {d.x}%</p>
                      <p style={{ color: '#10b981' }}>IA: {d.y}%</p>
                      <p style={{ color: (d.edge as number) > 0 ? '#10b981' : '#ef4444' }}>Edge: {d.edge > 0 ? '+' : ''}{d.edge}%</p>
                    </div>
                  )
                }}
              />
              <ReferenceLine x={50} stroke="#475569" strokeDasharray="2 4" strokeOpacity={0.3} />
              <ReferenceLine y={50} stroke="#475569" strokeDasharray="2 4" strokeOpacity={0.3} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.3} />
              <Scatter data={scatterData}>
                {scatterData.map((d, i) => (
                  <Cell key={i} fill={CITY_COLORS[d.slug] ?? '#6b7280'} fillOpacity={0.7} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[10px] text-gray-600 text-center">
          Puntos sobre la linea dorada = IA ve mas prob que el mercado · Tamano = volumen
        </p>
      </div>

      {/* Bar chart: Edge por ciudad */}
      <div className="card">
        <h3 className="mb-3 text-sm font-medium text-gray-400">Edge promedio por ciudad</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cityBarData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="ciudad" stroke="#64748b" tick={{ fontSize: 9 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={v => `${v > 0 ? '+' : ''}${v}%`} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: 11 }} labelStyle={{ color: '#94a3b8' }} />
              <ReferenceLine y={0} stroke="#475569" />
              <ReferenceLine y={2} stroke="#10b981" strokeDasharray="2 4" strokeOpacity={0.4} />
              <ReferenceLine y={-2} stroke="#10b981" strokeDasharray="2 4" strokeOpacity={0.4} />
              <Bar dataKey="avg_edge" radius={[4, 4, 0, 0]} name="Avg Edge %">
                {cityBarData.map(c => (
                  <Cell key={c.slug} fill={CITY_COLORS[c.slug] ?? '#6b7280'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filters + Contract table */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <h3 className="text-sm font-medium text-gray-400">
            {viewMode === 'opportunities' ? 'Oportunidades' : 'Todos los contratos'}
            <span className="text-gray-600 ml-2">({filtered.length})</span>
          </h3>
          <div className="flex flex-wrap gap-2 items-center">
            <select value={filterCity} onChange={e => setFilterCity(e.target.value)} className="rounded-lg bg-slate-800 border border-gray-700 px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-blue-500">
              <option value="all">Todas las ciudades</option>
              {data.cities.map(c => <option key={c.slug} value={c.slug}>{c.ciudad}</option>)}
            </select>
            <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} className="rounded-lg bg-slate-800 border border-gray-700 px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-blue-500">
              <option value="all">Todos los tipos</option>
              <option value="exacto">Exacto</option>
              <option value="superior">Superior</option>
              <option value="inferior">Inferior</option>
              <option value="rango">Rango</option>
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} className="rounded-lg bg-slate-800 border border-gray-700 px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-blue-500">
              <option value="edge">Ordenar: |Edge|</option>
              <option value="ev">Ordenar: EV</option>
              <option value="spread">Ordenar: Spread</option>
              <option value="volume">Ordenar: Volumen</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-700/50">
                <th className="pb-2 pr-2 font-medium">Ciudad</th>
                <th className="pb-2 pr-2 font-medium">Contrato</th>
                <th className="pb-2 pr-2 font-medium">Tipo</th>
                <th className="pb-2 pr-2 font-medium text-right">Mkt %</th>
                <th className="pb-2 pr-2 font-medium text-right">IA %</th>
                <th className="pb-2 pr-2 font-medium text-right">Edge</th>
                <th className="pb-2 pr-2 font-medium text-right">EV</th>
                <th className="pb-2 pr-2 font-medium text-right">Spread</th>
                <th className="pb-2 pr-2 font-medium text-right">Vol 24h</th>
                <th className="pb-2 font-medium text-right">Liquidez</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => <Row key={`${c.slug}-${i}`} c={c} i={i} />)}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <p className="text-center text-gray-500 text-xs py-4">No hay contratos con estos filtros</p>
        )}
        <p className="mt-3 text-[10px] text-gray-600">
          Edge = IA% - Mkt% | EV = valor esperado | Spread = ask - bid | Fuente: daily_runs + forecast_snapshot
        </p>
      </div>

      {/* City cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.cities.map(city => {
          const arbBg = city.arbitraje_nivel === 'ALTO' ? 'bg-red-500/10' : city.arbitraje_nivel === 'MEDIO' ? 'bg-amber-500/10' : 'bg-emerald-500/10'
          const arbText = city.arbitraje_nivel === 'ALTO' ? 'text-red-400' : city.arbitraje_nivel === 'MEDIO' ? 'text-amber-400' : 'text-emerald-400'
          const avgEdgeColor = (city.avg_edge ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'
          return (
            <div key={city.slug} className="rounded-xl bg-slate-900/50 border border-gray-700/30 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CITY_COLORS[city.slug] ?? '#6b7280' }} />
                  <h4 className="font-semibold text-white">{city.ciudad}</h4>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${arbBg} ${arbText}`}>{city.arbitraje_nivel}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                <div><span className="text-gray-500">Temp:</span> <span className="text-gray-300">{city.temp_corregida}°C</span></div>
                <div><span className="text-gray-500">Consenso:</span> <span className="text-gray-300">{city.consenso}</span></div>
                <div><span className="text-gray-500">Exito:</span> <span className="text-gray-300">{city.exito_pct}%</span></div>
                <div><span className="text-gray-500">Contratos:</span> <span className="text-gray-300">{city.total_contracts}</span></div>
                <div><span className="text-gray-500">Best edge:</span> <span className="text-emerald-400 font-mono">{city.best_edge !== null ? `${city.best_edge > 0 ? '+' : ''}${city.best_edge}%` : '—'}</span></div>
                <div><span className="text-gray-500">Avg edge:</span> <span className={`font-mono ${avgEdgeColor}`}>{city.avg_edge !== null ? `${city.avg_edge > 0 ? '+' : ''}${city.avg_edge}%` : '—'}</span></div>
              </div>
              <div className="text-[10px] text-gray-600">Vol: ${city.total_volume.toLocaleString()} · Desv: {city.arbitraje_desvio}pts</div>
            </div>
          )
        })}
      </div>

      {/* Guide */}
      <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 p-4 text-xs text-gray-500">
        <p className="font-medium text-gray-400 mb-2">Guia</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><strong className="text-gray-400">Edge:</strong> Diferencia IA vs mercado. +2% = oportunidad SI.</div>
          <div><strong className="text-gray-400">EV:</strong> Valor esperado. mayor a 0.05 = rentable largo plazo.</div>
          <div><strong className="text-gray-400">Spread:</strong> ask-bid. Menor = mejor liquidez.</div>
          <div><strong className="text-gray-400">Scatter:</strong> Sobre linea dorada = IA ve mas prob que mercado.</div>
          <div className="sm:col-span-2"><strong className="text-gray-400">Fuente:</strong> Contratos Polymarket desde daily_runs (winner 10PM/11PM) — misma data que RESUMEN.</div>
        </div>
      </div>
    </div>
  )
}

function MiniCard({ label, value, desc, color }: { label: string; value: string; desc: string; color: string }) {
  return (
    <div className="rounded-lg bg-slate-900/50 border border-gray-800 p-3 text-center">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${color}`}>{value}</div>
      <div className="text-[9px] text-gray-600 mt-0.5">{desc}</div>
    </div>
  )
}