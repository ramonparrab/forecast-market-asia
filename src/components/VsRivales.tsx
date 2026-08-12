import { useState, useEffect, useCallback } from 'react'

interface RivalCity {
  slug: string
  nombre: string
  nuestro: number | null
  ecmwf: number | null
  gfs: number | null
  icon: number | null
  best_match: number | null
  real: number | null
  error_nuestro: number | null
  error_ecmwf: number | null
  error_gfs: number | null
  error_icon: number | null
  error_best: number | null
}

interface RivalResponse {
  fecha: string
  ciudades: RivalCity[]
  mae: {
    nuestro: number
    ecmwf: number
    gfs: number
    icon: number
    best_match: number
  }
  total_con_real: number
}

function errorColor(err: number | null): string {
  if (err === null) return 'text-gray-600'
  if (err <= 1) return 'text-emerald-400'
  if (err <= 2) return 'text-amber-400'
  return 'text-red-400'
}

function errorBg(err: number | null): string {
  if (err === null) return 'bg-gray-900/30'
  if (err <= 1) return 'bg-emerald-500/10'
  if (err <= 2) return 'bg-amber-500/10'
  return 'bg-red-500/10'
}

function tempCell(temp: number | null, err: number | null, highlight?: 'nuestro' | 'best' | 'real') {
  if (temp === null) return <span className="text-gray-600">——</span>
  const cls = highlight === 'nuestro'
    ? 'font-bold text-cyan-300'
    : highlight === 'real'
      ? 'font-bold text-white'
      : highlight === 'best'
        ? 'text-emerald-300'
        : 'text-gray-200'
  return <span className={cls}>{temp}°C</span>
}

function errorBadge(err: number | null) {
  if (err === null) return null
  return (
    <span className={`text-[10px] ml-1 px-1 rounded ${errorBg(err)} ${errorColor(err)}`}>
      {err >= 0 ? '+' : ''}{err.toFixed(1)}°
    </span>
  )
}

export default function VsRivales() {
  const [data, setData] = useState<RivalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fecha, setFecha] = useState('')

  const fetchData = useCallback(async (dateStr: string) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(`/api/vs-rivales?fecha=${dateStr}`)
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${resp.status}`)
      }
      const json: RivalResponse = await resp.json()
      setData(json)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Default: yesterday's date (most recent with real data)
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().slice(0, 10)
    setFecha(dateStr)
    fetchData(dateStr)
  }, [fetchData])

  const handleFechaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setFecha(val)
    fetchData(val)
  }

  // Find best model per city (lowest error)
  const getBestSource = (city: RivalCity): string | null => {
    const sources = [
      { name: 'NOSOTROS', err: city.error_nuestro },
      { name: 'ECMWF', err: city.error_ecmwf },
      { name: 'GFS', err: city.error_gfs },
      { name: 'ICON', err: city.error_icon },
      { name: 'Best Match', err: city.error_best },
    ].filter(s => s.err !== null) as { name: string; err: number }[]
    if (sources.length === 0) return null
    sources.sort((a, b) => a.err - b.err)
    return sources[0].name
  }

  const mae = data?.mae
  const maeEntries = mae
    ? [
        { name: 'NOSOTROS', val: mae.nuestro, label: 'Nuestro' },
        { name: 'ECMWF', val: mae.ecmwf, label: 'ECMWF' },
        { name: 'GFS', val: mae.gfs, label: 'GFS' },
        { name: 'ICON', val: mae.icon, label: 'ICON' },
        { name: 'Best Match', val: mae.best_match, label: 'Best Match' },
      ].sort((a, b) => a.val - b.val)
    : []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>⚔️</span> NUESTRO PRONÓSTICO vs Modelos Rivales vs REAL
          </h2>
          <p className="text-[11px] text-gray-400 mt-1 max-w-2xl">
            NUESTRO = mejor valor entre la corrida de 10PM y 11PM según el MAE histórico real de cada ciudad.
            Fuentes rivales: ECMWF, GFS, ICON, Best Match vía Open-Meteo (configuración oficial de cada modelo).
            Los valores son el máximo (PO) del día local. El error se calcula vs el real una vez registrado en forecast_history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fecha}
            onChange={handleFechaChange}
            className="bg-gray-800 text-white text-sm px-3 py-1.5 rounded-lg border border-gray-700 focus:border-cyan-500 focus:outline-none"
          />
          <button
            onClick={() => fetchData(fecha)}
            disabled={loading}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
          >
            {loading ? '⏳' : '🔄'} Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
          Error: {error}
        </div>
      )}

      {loading && !data && (
        <div className="text-center text-gray-400 py-8">Cargando datos de modelos rivales...</div>
      )}

      {data && (
        <>
          {/* MAE Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {maeEntries.map((m) => (
              <div
                key={m.name}
                className={`rounded-lg p-2 text-center border ${
                  m.name === 'NOSOTROS'
                    ? 'bg-cyan-900/20 border-cyan-700/50'
                    : m.val === maeEntries[0]?.val
                      ? 'bg-emerald-900/20 border-emerald-700/50'
                      : 'bg-gray-900/30 border-gray-700/50'
                }`}
              >
                <div className="text-[10px] text-gray-400 uppercase">MAE {m.label}</div>
                <div className={`text-lg font-bold ${m.val === maeEntries[0]?.val ? 'text-emerald-400' : m.name === 'NOSOTROS' ? 'text-cyan-400' : 'text-gray-300'}`}>
                  {m.val.toFixed(2)}°C
                </div>
                {m.val === maeEntries[0]?.val && m.val > 0 && (
                  <div className="text-[9px] text-emerald-400">🏆 Mejor</div>
                )}
              </div>
            ))}
          </div>

          <div className="text-[11px] text-gray-500 text-right">
            {data.total_con_real} de {data.ciudades.length} ciudades con temp. real registrada
          </div>

          {/* Comparison Table */}
          <div className="overflow-x-auto rounded-lg border border-gray-700/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800/80">
                  <th className="text-left px-3 py-2 text-gray-300 font-medium text-xs">Ciudad</th>
                  <th className="text-center px-2 py-2 text-cyan-400 font-medium text-xs">NOSOTROS</th>
                  <th className="text-center px-2 py-2 text-gray-300 font-medium text-xs">ECMWF</th>
                  <th className="text-center px-2 py-2 text-gray-300 font-medium text-xs">GFS</th>
                  <th className="text-center px-2 py-2 text-gray-300 font-medium text-xs">ICON</th>
                  <th className="text-center px-2 py-2 text-gray-300 font-medium text-xs">Best Match</th>
                  <th className="text-center px-2 py-2 text-white font-bold text-xs">REAL</th>
                  <th className="text-center px-2 py-2 text-gray-300 font-medium text-xs">Mejor</th>
                </tr>
              </thead>
              <tbody>
                {data.ciudades.map((city) => {
                  const best = getBestSource(city)
                  const hasReal = city.real !== null
                  return (
                    <tr
                      key={city.slug}
                      className={`border-t border-gray-800 ${hasReal ? '' : 'opacity-60'}`}
                    >
                      <td className="px-3 py-2 text-white font-medium whitespace-nowrap">
                        {city.nombre}
                      </td>
                      <td className={`text-center px-2 py-2 ${errorBg(city.error_nuestro)} rounded-l`}>
                        {tempCell(city.nuestro, city.error_nuestro, 'nuestro')}
                        {errorBadge(city.error_nuestro)}
                      </td>
                      <td className={`text-center px-2 py-2 ${errorBg(city.error_ecmwf)}`}>
                        {tempCell(city.ecmwf, city.error_ecmwf, best === 'ECMWF' ? 'best' : undefined)}
                        {errorBadge(city.error_ecmwf)}
                      </td>
                      <td className={`text-center px-2 py-2 ${errorBg(city.error_gfs)}`}>
                        {tempCell(city.gfs, city.error_gfs, best === 'GFS' ? 'best' : undefined)}
                        {errorBadge(city.error_gfs)}
                      </td>
                      <td className={`text-center px-2 py-2 ${errorBg(city.error_icon)}`}>
                        {tempCell(city.icon, city.error_icon, best === 'ICON' ? 'best' : undefined)}
                        {errorBadge(city.error_icon)}
                      </td>
                      <td className={`text-center px-2 py-2 ${errorBg(city.error_best)}`}>
                        {tempCell(city.best_match, city.error_best, best === 'Best Match' ? 'best' : undefined)}
                        {errorBadge(city.error_best)}
                      </td>
                      <td className="text-center px-2 py-2">
                        {tempCell(city.real, null, 'real')}
                      </td>
                      <td className="text-center px-2 py-2">
                        {best ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            best === 'NOSOTROS'
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : 'bg-emerald-500/20 text-emerald-300'
                          }`}>
                            {best}
                          </span>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-[10px] text-gray-500">
            <span>Verde: error ≤ 1°C</span>
            <span>Amarillo: error 1-2°C</span>
            <span>Rojo: error &gt; 2°C</span>
            <span>——: sin datos</span>
          </div>
        </>
      )}
    </div>
  )
}