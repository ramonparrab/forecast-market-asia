import { DailyAnalysis } from '@/types'

interface ForecastTableProps {
  data: DailyAnalysis
}

export default function ForecastTable({ data }: ForecastTableProps) {
  const allBets = data.cities.flatMap(city =>
    city.contratos.map(c => ({
      ciudad: city.ciudad,
      slug: city.slug,
      contrato: c.texto,
      mkt: c.prob_mkt,
      ia: Math.round((c.prob_ia_norm ?? 0) * 10000) / 100,
      temp: city.forecast.temp_corregida,
      consenso: city.forecast.consenso,
      arb: city.arbitraje.nivel,
    }))
  ).sort((a, b) => {
    const edgeA = a.ia - a.mkt
    const edgeB = b.ia - b.mkt
    return edgeB - edgeA
  }).slice(0, 30)

  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-4 text-lg font-semibold text-white">📊 Tabla Completa</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-left text-xs uppercase tracking-wider text-gray-500">
            <th className="pb-2 pr-3">Ciudad</th>
            <th className="pb-2 pr-3">Contrato</th>
            <th className="pb-2 pr-3 text-right">Mkt%</th>
            <th className="pb-2 pr-3 text-right">IA%</th>
            <th className="pb-2 pr-3 text-right">Edge</th>
            <th className="pb-2 pr-3 text-right">Temp°</th>
            <th className="pb-2 pr-3">Consenso</th>
            <th className="pb-2">Arb</th>
          </tr>
        </thead>
        <tbody>
          {allBets.map((row, i) => {
            const edge = row.ia - row.mkt
            let edgeClass = 'text-gray-400'
            if (edge > 8) edgeClass = 'text-emerald-400 font-bold'
            else if (edge > 5) edgeClass = 'text-blue-400'
            else if (edge > 2) edgeClass = 'text-amber-400'
            else edgeClass = 'text-red-400'

            return (
              <tr key={i} className="border-b border-gray-800/50 hover:bg-slate-700/30">
                <td className="py-2 pr-3 font-medium text-white">{row.ciudad}</td>
                <td className="py-2 pr-3 text-gray-300">{row.contrato}</td>
                <td className="py-2 pr-3 text-right text-gray-400">{row.mkt}</td>
                <td className="py-2 pr-3 text-right text-blue-300">{row.ia}</td>
                <td className={`py-2 pr-3 text-right font-mono ${edgeClass}`}>
                  {edge > 0 ? '+' : ''}{edge.toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-right text-gray-300">{row.temp.toFixed(1)}</td>
                <td className="py-2 pr-3">
                  <ConsensoTag value={row.consenso} />
                </td>
                <td className="py-2">
                  <ArbTag value={row.arb} />
                </td>
              </tr>
            )
          })}
          {allBets.length === 0 && (
            <tr>
              <td colSpan={8} className="py-8 text-center text-gray-500">
                No hay datos disponibles. Ejecuta un análisis primero.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function ConsensoTag({ value }: { value: string }) {
  if (value === 'MUY FUERTE') return <span className="text-xs text-emerald-400">✅ {value}</span>
  if (value === 'FUERTE') return <span className="text-xs text-blue-400">✅ {value}</span>
  if (value === 'ACEPTABLE') return <span className="text-xs text-amber-400">🟡 {value}</span>
  return <span className="text-xs text-red-400">⚠️ {value}</span>
}

function ArbTag({ value }: { value: string }) {
  if (value.includes('ALTO')) return <span className="text-xs text-red-400">⚠️ {value.slice(0, 6)}</span>
  if (value.includes('MEDIO')) return <span className="text-xs text-amber-400">{value}</span>
  return <span className="text-xs text-emerald-400">{value}</span>
}
