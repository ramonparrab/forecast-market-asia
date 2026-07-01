import { useState, useEffect } from 'react'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'
import { CIUDADES_ASIA } from '@/lib/cities'

interface CityBollingerData {
  slug: string
  ciudad: string
  records: {
    fecha: string
    pronosticado: number
    real: number | null
    banda_superior: number
    banda_inferior: number
    error: number | null
  }[]
  stats: {
    std: number
    mae: number
    bias: number
    n: number
  }
}

export default function BollingerBandChart() {
  const [cities, setCities] = useState<CityBollingerData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCity, setSelectedCity] = useState<string>('all')
  const [bandMultiplier, setBandMultiplier] = useState(2)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const resp = await fetch('/api/forecast-vs-actual')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = await resp.json()
      if (json.status !== 'ok') throw new Error('API error')

      const records = json.records as any[]
      if (!records || records.length === 0) {
        setCities([])
        setLoading(false)
        return
      }

      const byCity: Record<string, any[]> = {}
      for (const r of records) {
        if (!byCity[r.slug]) byCity[r.slug] = []
        byCity[r.slug].push(r)
      }

      const result: CityBollingerData[] = Object.entries(byCity).map(([slug, recs]) => {
        const errors = recs.map((r: any) => r.error).filter((e: number | null) => e !== null) as number[]
        const n = errors.length
        const mean = errors.reduce((s, v) => s + v, 0) / n
        const std = Math.sqrt(errors.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
        const mae = errors.reduce((s, v) => s + Math.abs(v), 0) / n

        const sorted = [...recs].sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))

        const records = sorted.map(r => ({
          fecha: r.fecha_objetivo,
          pronosticado: r.temp_corregida,
          real: r.temp_real,
          banda_superior: r.temp_corregida + std * 2,
          banda_inferior: r.temp_corregida - std * 2,
          error: r.error,
        }))

        const cityInfo = CIUDADES_ASIA.find(c => c.slug === slug)
        return {
          slug,
          ciudad: cityInfo?.nombre ?? slug,
          records,
          stats: {
            std: Math.round(std * 100) / 100,
            mae: Math.round(mae * 100) / 100,
            bias: Math.round(mean * 100) / 100,
            n,
          },
        }
      })

      setCities(result)
    } catch (e) {
      console.error('Bollinger data error:', e)
    }
    setLoading(false)
  }

  const filtered = selectedCity === 'all' ? cities : cities.filter(c => c.slug === selectedCity)

  if (loading) {
    return <div className="card text-center py-8 text-gray-500">Cargando bandas de error...</div>
  }

  if (cities.length === 0) {
    return (
      <div className="card text-center py-8 text-gray-500">
        Sin datos históricos. Ejecuta el análisis y backfill para generar el gráfico de bandas.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-gradient-to-r from-purple-600/10 via-blue-600/10 to-cyan-600/10 border border-purple-500/20 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-2xl">📊</span>
              Bandas de Error: Pronóstico vs Real
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Las bandas muestran el rango probable de la temperatura real basado en el error histórico del modelo (±{bandMultiplier}σ)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedCity}
              onChange={e => setSelectedCity(e.target.value)}
              className="rounded-lg bg-slate-800 border border-gray-600 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
            >
              <option value="all">🏙️ Todas las ciudades</option>
              {cities.map(c => (
                <option key={c.slug} value={c.slug}>{c.ciudad}</option>
              ))}
            </select>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-400">σ ×</span>
              <select
                value={bandMultiplier}
                onChange={e => setBandMultiplier(Number(e.target.value))}
                className="rounded-lg bg-slate-800 border border-gray-600 px-2 py-1.5 text-xs text-white focus:outline-none focus:border-purple-500"
              >
                <option value={1}>1</option>
                <option value={1.5}>1.5</option>
                <option value={2}>2</option>
                <option value={2.5}>2.5</option>
                <option value={3}>3</option>
              </select>
            </div>
            <button onClick={loadData} className="text-xs text-purple-400 hover:text-purple-300 transition">
              🔄
            </button>
          </div>
        </div>
      </div>

      {filtered.map(city => {
        const chartData = city.records.map(r => ({
          ...r,
          banda_superior: r.pronosticado + city.stats.std * bandMultiplier,
          banda_inferior: r.pronosticado - city.stats.std * bandMultiplier,
        }))

        const actuals = chartData.filter(d => d.real !== null)
        const bandaInColor = actuals.some(d => d.real !== null && (d.real > d.banda_superior || d.real < d.banda_inferior))

        return (
          <div key={city.slug} className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-base font-bold text-white">{city.ciudad}</h3>
                <p className="text-[10px] text-gray-500">
                  σ={city.stats.std.toFixed(2)}°C · MAE={city.stats.mae.toFixed(2)}°C · Bias={city.stats.bias > 0 ? '+' : ''}{city.stats.bias.toFixed(2)}°C · {city.stats.n} registros
                </p>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded bg-blue-400"></span>
                  <span className="text-gray-400">Pronóstico</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded bg-emerald-400"></span>
                  <span className="text-gray-400">Real</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded bg-purple-400/40"></span>
                  <span className="text-gray-400">±{bandMultiplier}σ</span>
                </span>
              </div>
            </div>

            <div className="h-72 sm:h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="fecha"
                    stroke="#64748b"
                    tick={{ fontSize: 10 }}
                    tickFormatter={v => {
                      const d = new Date(v + 'T12:00:00')
                      return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
                    }}
                  />
                  <YAxis
                    stroke="#64748b"
                    tick={{ fontSize: 11 }}
                    domain={['dataMin - 2', 'dataMax + 2']}
                    label={{ value: '°C', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px', fontSize: '12px' }}
                    labelStyle={{ color: '#f1f5f9', fontWeight: 'bold' }}
                    formatter={(value: number, name: string) => {
                      const labels: Record<string, string> = {
                        pronosticado: 'Pronóstico',
                        real: 'Real',
                        banda_superior: 'Banda Superior',
                        banda_inferior: 'Banda Inferior',
                      }
                      return [`${value.toFixed(1)}°C`, labels[name] || name]
                    }}
                    labelFormatter={label => {
                      const d = new Date(label + 'T12:00:00')
                      return d.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line
                    type="monotone"
                    dataKey="banda_superior"
                    stroke="#8b5cf6"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    dot={false}
                    name="banda_superior"
                  />
                  <Line
                    type="monotone"
                    dataKey="banda_inferior"
                    stroke="#8b5cf6"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    dot={false}
                    name="banda_inferior"
                  />
                  <Line
                    type="monotone"
                    dataKey="pronosticado"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                    name="pronosticado"
                  />
                  <Line
                    type="monotone"
                    dataKey="real"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#10b981', strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                    name="real"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-500 justify-center">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full bg-blue-400"></span>
                <span>Pronóstico corregido</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full bg-emerald-400"></span>
                <span>Temperatura real</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-0 border-l-2 border-dashed border-purple-400 rotate-90"></span>
                <span>Banda ±{bandMultiplier}σ ({city.stats.std.toFixed(2)}°C)</span>
              </span>
            </div>

            {bandaInColor && (
              <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-[10px] text-amber-300 text-center">
                ⚠️ Hay temperaturas reales fuera de la banda ±{bandMultiplier}σ — el error real superó el rango esperado
              </div>
            )}
          </div>
        )
      })}

      <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 p-3 text-[10px] text-gray-500">
        <p className="font-medium text-gray-400 mb-1">📖 ¿Cómo leer este gráfico?</p>
        <ul className="space-y-0.5">
          <li><strong className="text-blue-300">Línea azul</strong> = Temperatura pronosticada por el ensemble (corregida con bias dinámico)</li>
          <li><strong className="text-emerald-300">Línea verde</strong> = Temperatura máxima real que ocurrió</li>
          <li><strong className="text-purple-300">Banda morada</strong> = Rango esperado del error ±{bandMultiplier}σ (desviación estándar histórica del error)</li>
          <li>Si la línea verde sale de la banda morada, el error fue mayor al esperado — el modelo estaba menos seguro de lo que indicaba</li>
        </ul>
      </div>
    </div>
  )
}
