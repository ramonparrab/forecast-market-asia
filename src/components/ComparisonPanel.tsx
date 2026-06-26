import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'

interface ComparisonRecord {
  fecha_objetivo: string
  temp_pronosticada: number
  temp_corregida: number
  temp_real: number
  error: number
}

interface CityComparison {
  slug: string
  records: ComparisonRecord[]
}

export default function ComparisonPanel() {
  const [cities, setCities] = useState<CityComparison[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/metrics/comparison').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.cities?.length) setCities(d.cities)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="card text-center py-8 text-gray-500">Cargando comparación...</div>
  }

  if (!cities.length) {
    return <div className="card text-center py-8 text-gray-500">No hay datos de comparación en los últimos 30 días</div>
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-white">📊 Comparación: Pronóstico 10PM Caracas vs Cierre</h2>
            <p className="text-xs text-gray-500 mt-0.5">Últimos 30 días · Azul = pronóstico corregido (10PM Caracas), naranja = temperatura real al cierre</p>
          </div>
          <button onClick={() => { setLoading(true); fetch('/api/metrics/comparison').then(r => r.ok ? r.json() : null).then(d => { if (d?.cities?.length) setCities(d.cities); setLoading(false) }).catch(() => setLoading(false)) }} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1">🔄</button>
        </div>
      </div>

      {cities.map(({ slug, records }) => {
        const ciudad = CIUDADES_ASIA.find(c => c.slug === slug)
        const items = [...records].sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))
        const chartData = items.map(i => ({
          fecha: i.fecha_objetivo.slice(8, 10) + '/' + i.fecha_objetivo.slice(5, 7),
          pronostico: i.temp_corregida,
          real: i.temp_real,
          error: i.error,
        }))

        const avgError = items.reduce((s, i) => s + i.error, 0) / items.length

        return (
          <div key={slug} className="card">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-semibold text-white">{ciudad?.nombre || slug}</h3>
                <p className="text-[10px] text-gray-500">
                  Error medio: <span className={avgError <= 1.5 ? 'text-emerald-400' : 'text-amber-400'}>{avgError.toFixed(2)}°C</span>
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${avgError <= 1.5 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                {items.length} registros
              </span>
            </div>

            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="fecha" stroke="#64748b" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} domain={['dataMin - 1', 'dataMax + 1']} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} labelStyle={{ color: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Line type="monotone" dataKey="pronostico" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Pronóstico 10PM Caracas" />
                  <Line type="monotone" dataKey="real" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Temp. Real" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      })}

      <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 p-3 text-xs text-gray-500">
        <p className="font-medium text-gray-400 mb-1">📖 Leyenda</p>
        <ul className="space-y-0.5">
          <li><span className="text-blue-400">Pronóstico 10PM Caracas</span>: Temperatura corregida del ensemble a las 10PM hora Caracas</li>
          <li><span className="text-amber-400">Temp. Real</span>: Temperatura máxima real del día objetivo (cierre del mercado)</li>
          <li><span className="text-gray-400">Ventana 30 días</span>: Datos de <code className="text-blue-300">forecast_history</code> — auto-renovable, sin backtesting manual</li>
          <li>Cada ciudad tiene su propio gráfico independiente</li>
        </ul>
      </div>
    </div>
  )
}
