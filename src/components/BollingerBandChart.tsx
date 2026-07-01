import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'
import { CIUDADES_ASIA } from '@/lib/cities'

const TEMP_MIN = -10
const TEMP_MAX = 50

function isTemp(v: any): v is number {
  return typeof v === 'number' && !isNaN(v) && v >= TEMP_MIN && v <= TEMP_MAX
}

function safeTemp(v: any): number {
  const n = Number(v)
  if (isNaN(n)) return TEMP_MIN
  if (n < TEMP_MIN) return TEMP_MIN
  if (n > TEMP_MAX) return TEMP_MAX
  return n
}

interface CityData {
  slug: string
  ciudad: string
  pairs: { fecha: string; pronostico: number; real: number | null }[]
  std: number
  mae: number
  bias: number
  n: number
}

export default function BollingerBandChart() {
  const [cities, setCities] = useState<CityData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCity, setSelectedCity] = useState<string>('all')
  const [k, setK] = useState(2)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const r = await fetch('/api/forecast-vs-actual')
      if (!r.ok) throw new Error(String(r.status))
      const j = await r.json()
      if (j.status !== 'ok') throw new Error('bad status')

      const raw = (j.records || []) as any[]
      if (!raw.length) { setCities([]); setLoading(false); return }

      const grouped: Record<string, any[]> = {}
      for (const rec of raw) {
        if (!grouped[rec.slug]) grouped[rec.slug] = []
        if (isTemp(rec.temp_corregida) && isTemp(rec.temp_real)) {
          grouped[rec.slug].push(rec)
        }
      }

      const result: CityData[] = Object.entries(grouped).map(([slug, recs]) => {
        const errs = recs.map((x: any) => Number(x.error)).filter((e: number) => !isNaN(e))
        const n = errs.length
        const mean = errs.reduce((s, v) => s + v, 0) / n
        const std = Math.sqrt(errs.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
        const mae = errs.reduce((s, v) => s + Math.abs(v), 0) / n
        const sorted = [...recs].sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))
        const info = CIUDADES_ASIA.find(c => c.slug === slug)
        return {
          slug, ciudad: info?.nombre ?? slug,
          pairs: sorted.map(x => ({
            fecha: String(x.fecha_objetivo).slice(0, 10),
            pronostico: safeTemp(x.temp_corregida),
            real: isTemp(x.temp_real) ? Number(x.temp_real) : null,
          })),
          std: Math.round(std * 100) / 100,
          mae: Math.round(mae * 100) / 100,
          bias: Math.round(mean * 100) / 100,
          n,
        }
      }).filter(c => c.pairs.length >= 2)

      setCities(result)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const list = selectedCity === 'all' ? cities : cities.filter(c => c.slug === selectedCity)

  if (loading) return <div className="card text-center py-8 text-gray-500">Cargando...</div>
  if (!cities.length) return <div className="card text-center py-8 text-gray-500">Sin datos historicos</div>

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-gradient-to-r from-purple-600/10 via-blue-600/10 to-cyan-600/10 border border-purple-500/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Bandas de Error</h2>
            <p className="text-xs text-gray-400">Rango +/-{k} del error historico</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)}
              className="rounded bg-slate-800 border border-gray-600 px-3 py-1.5 text-xs text-white">
              <option value="all">Todas</option>
              {cities.map(c => <option key={c.slug} value={c.slug}>{c.ciudad}</option>)}
            </select>
            <select value={k} onChange={e => setK(Number(e.target.value))}
              className="rounded bg-slate-800 border border-gray-600 px-2 py-1.5 text-xs text-white">
              <option value={1}>x1</option><option value={1.5}>x1.5</option>
              <option value={2}>x2</option><option value={2.5}>x2.5</option><option value={3}>x3</option>
            </select>
            <button onClick={loadData} className="text-xs text-purple-400">Actualizar</button>
          </div>
        </div>
      </div>

      {list.map(city => {
        const half = city.std * k
        const chartData = city.pairs.map(p => ({
          f: p.fecha,
          p: p.pronostico,
          r: p.real,
          up: safeTemp(p.pronostico + half),
          lo: safeTemp(p.pronostico - half),
        }))
        const someOut = chartData.some(d => d.r !== null && (d.r > d.up || d.r < d.lo))
        const allY = chartData.flatMap(d => [d.lo, d.up, d.p, d.r].filter((v): v is number => v !== null && !isNaN(v)))
        const yMin = Math.floor(Math.min(...allY) - 1)
        const yMax = Math.ceil(Math.max(...allY) + 1)

        return (
          <div key={city.slug} className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-base font-bold text-white">{city.ciudad}</h3>
                <p className="text-[10px] text-gray-500">
                  ={city.std}C MAE={city.mae}C bias={city.bias > 0 ? '+' : ''}{city.bias}C ({city.n} reg)
                </p>
              </div>
            </div>

            <div className="h-72 sm:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="f" stroke="#64748b" tick={{ fontSize: 10 }}
                    tickFormatter={v => { const d = new Date(v + 'T12:00:00'); return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 11 }}
                    domain={[yMin, yMax]}
                    label={{ value: 'C', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 8, fontSize: 12 }}
                    labelFormatter={l => { const d = new Date(l + 'T12:00:00'); return d.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) }}
                    formatter={(v: number, n: string) => [`${v.toFixed(1)}C`, { p: 'Pronostico', r: 'Real', up: 'Banda Sup', lo: 'Banda Inf' }[n] || n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {/* Band fill via stackId: lo area invisible, up area stacked on top -> fills only between lo and up */}
                  <Area dataKey="lo" stackId="band" fill="#a78bfa" fillOpacity={0} stroke="none" />
                  <Area dataKey="up" stackId="band" fill="#a78bfa" fillOpacity={0.85} stroke="none" />
                  {/* Band border lines */}
                  <Line dataKey="up" stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line dataKey="lo" stroke="#a78bfa" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  {/* Forecast line */}
                  <Line dataKey="p" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }} activeDot={{ r: 5 }} />
                  {/* Actual temps */}
                  <Line dataKey="r" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3, fill: '#10b981', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center gap-4 text-[10px] text-gray-500 justify-center mt-2">
              <span><span className="inline-block h-2 w-2 rounded bg-blue-400 mr-1"></span>Pronostico</span>
              <span><span className="inline-block h-2 w-2 rounded bg-emerald-400 mr-1"></span>Real</span>
              <span><span className="inline-block h-2 w-2 bg-purple-400 mr-1" style={{ opacity: 0.85 }}></span>Banda +/-{k}({half.toFixed(1)}C)</span>
            </div>
            {someOut && <div className="mt-1 text-[10px] text-amber-400 text-center">Real fuera de banda</div>}
          </div>
        )
      })}
    </div>
  )
}
