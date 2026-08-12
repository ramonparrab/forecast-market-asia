import { useState, useMemo, useEffect, useCallback } from 'react'
import { DailyAnalysis } from '@/types'
import { kellyBetSize } from '@/lib/kelly'

interface CoveragePlan {
  ciudad: string
  slug: string
  yes: { valor: number; probMkt: number; probIA: number; edge: number }
  no: { valor: number; probMkt: number; probIA: number; edge: number }
  montoPar: number
  yesMonto: number
  noMonto: number
  totalInvertido: number
  consenso: string
  exitoPct: number
  score: number
  gananciaSI: number
  gananciaNO: number
  gananciaOtro: number
  perdidaAmbos: number
}

function calcScore(consenso: string, exitoPct: number, edgeTotal: number): number {
  const cf = consenso === 'MUY FUERTE' ? 1.3 : consenso === 'FUERTE' ? 1.1 : consenso === 'ACEPTABLE' ? 0.9 : 0.5
  return Math.round(edgeTotal * (exitoPct / 50) * cf * 10) / 10
}

function consensoFuerte(consenso: string): boolean {
  return consenso === 'MUY FUERTE' || consenso === 'FUERTE' || consenso === 'ACEPTABLE'
}

export default function CoveragePlanner({ analysis, fechaObjetivo }: { analysis: DailyAnalysis | null; fechaObjetivo?: string }) {
  const [bankroll, setBankroll] = useState(5)
  const [inputBr, setInputBr] = useState('5')
  const [fecha, setFecha] = useState(fechaObjetivo || '')
  const [fetching, setFetching] = useState(false)
  const [localAnalysis, setLocalAnalysis] = useState<DailyAnalysis | null>(null)
  const [mostrarDebiles, setMostrarDebiles] = useState(false)

  useEffect(() => {
    if (fechaObjetivo && !fecha) setFecha(fechaObjetivo)
  }, [fechaObjetivo])

  const fetchAnalysis = useCallback(async (date: string) => {
    setFetching(true)
    try {
      const resp = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: date }),
      })
      if (resp.ok) {
        const data = await resp.json()
        setLocalAnalysis(data)
      }
    } catch { /* ignore */ }
    setFetching(false)
  }, [])

  const aplicarBankroll = useCallback(() => {
    const val = parseInt(inputBr) || 1
    setBankroll(Math.max(1, val))
  }, [inputBr])

  const displayAnalysis = localAnalysis || analysis
  const effectiveFecha = fecha || fechaObjetivo || displayAnalysis?.fecha_objetivo || ''

  const allPairs = useMemo(() => {
    if (!displayAnalysis?.cities) return []
    const raw: CoveragePlan[] = []

    for (const city of displayAnalysis.cities) {
      const contratos = (city.contratos || [])
        .filter(c => c.tipo === 'exacto' && typeof c.valor === 'number' && c.prob_ia_norm != null)
      if (contratos.length < 2) continue

      for (let i = 0; i < contratos.length; i++) {
        const y = contratos[i]
        const yEdge = (y.prob_ia_norm! * 100) - y.prob_mkt
        if (yEdge <= 3) continue
        const yIA = y.prob_ia_norm! * 100
        const yMkt = y.prob_mkt
        const yScore = yIA - yMkt

        for (let j = 0; j < contratos.length; j++) {
          if (i === j) continue
          const n = contratos[j]
          const nMkt = n.prob_mkt
          const nIAReal = n.prob_ia_norm! * 100
          const nEdge = (100 - nIAReal) - (100 - nMkt)
          if (nEdge <= 3) continue
          const nScore = (100 - nIAReal) - (100 - nMkt)

          const yesBet = kellyBetSize(yIA, yMkt, 100)
          const noBet = kellyBetSize(100 - nIAReal, 100 - nMkt, 100)
          if (yesBet < 0.1 && noBet < 0.1) continue

          const pctParaYes = yesBet / (yesBet + noBet)
          const pctParaNo = noBet / (yesBet + noBet)

          const edgeTotal = Math.round((yEdge + nEdge) * 10) / 10
          const score = calcScore(city.forecast?.consenso || '', city.exito_pct_integer ?? city.exito_pct ?? 0, edgeTotal)

          raw.push({
            ciudad: city.ciudad,
            slug: city.slug,
            yes: { valor: y.valor as number, probMkt: yMkt, probIA: yIA, edge: Math.round(yEdge * 10) / 10 },
            no: { valor: n.valor as number, probMkt: nMkt, probIA: nIAReal, edge: Math.round(nEdge * 10) / 10 },
            montoPar: 0,
            yesMonto: 0,
            noMonto: 0,
            totalInvertido: 0,
            consenso: city.forecast?.consenso || '',
            exitoPct: city.exito_pct_integer ?? city.exito_pct ?? 0,
            score,
            gananciaSI: 0,
            gananciaNO: 0,
            gananciaOtro: 0,
            perdidaAmbos: 0,
          })
        }
      }
    }

    return raw.sort((a, b) => b.score - a.score)
  }, [displayAnalysis])

  const visiblePairs = useMemo(() => {
    const filtered = mostrarDebiles ? allPairs : allPairs.filter(p => consensoFuerte(p.consenso))

    if (filtered.length === 0) return []

    const topN = Math.min(5, filtered.length)
    const totalScore = filtered.slice(0, topN).reduce((s, p) => s + p.score, 0)
    if (totalScore === 0) return filtered.slice(0, topN).map(p => ({ ...p, montoPar: 0 }))

    return filtered.slice(0, topN).map(p => {
      const montoPar = Math.round((p.score / totalScore) * bankroll * 100) / 100
      const pctYes = p.yes.edge / (p.yes.edge + p.no.edge)
      const yesMonto = Math.round(montoPar * pctYes * 100) / 100
      const noMonto = Math.round((montoPar - yesMonto) * 100) / 100

      const ganSI = Math.round((yesMonto * (100 / p.yes.probMkt - 1) + noMonto * (100 / (100 - p.no.probMkt) - 1)) * 100) / 100
      const ganNO = Math.round((-yesMonto - noMonto) * 100) / 100
      const ganOtro = Math.round((noMonto * (100 / (100 - p.no.probMkt) - 1) - yesMonto) * 100) / 100

      return {
        ...p,
        montoPar,
        yesMonto,
        noMonto,
        totalInvertido: montoPar,
        gananciaSI: ganSI,
        gananciaNO: ganNO,
        perdidaAmbos: -montoPar,
        gananciaOtro: ganOtro,
      }
    })
  }, [allPairs, mostrarDebiles, bankroll])

  const totalAsignado = visiblePairs.reduce((s, p) => s + p.montoPar, 0)
  const hasDebiles = allPairs.some(p => !consensoFuerte(p.consenso))

  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-4 sm:p-6 overflow-hidden">
      <div className="flex flex-col gap-3 mb-5">
        <h2 className="text-lg sm:text-xl font-bold text-white">COBERTURA SI/NO</h2>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">Fecha</label>
            <input
              type="date"
              value={effectiveFecha}
              onChange={e => setFecha(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && fecha) fetchAnalysis(fecha) }}
              className="bg-slate-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs sm:text-sm text-white w-28 sm:w-36"
            />
            <button
              onClick={() => { if (fecha) fetchAnalysis(fecha) }}
              disabled={fetching || !fecha}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-[10px] sm:text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
            >
              {fetching ? '...' : 'Ir'}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-[10px] sm:text-xs text-gray-400 whitespace-nowrap">$</label>
            <input
              type="number"
              value={inputBr}
              onChange={e => setInputBr(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') aplicarBankroll() }}
              className="bg-slate-700 border border-gray-600 rounded-lg px-2 py-1.5 text-xs sm:text-sm text-white w-16 sm:w-20 text-center"
            />
            <button
              onClick={aplicarBankroll}
              className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] sm:text-xs font-bold px-2.5 py-1.5 rounded-lg transition"
            >
              Aplicar
            </button>
          </div>

          {hasDebiles && (
            <label className="flex items-center gap-1.5 cursor-pointer ml-1">
              <input type="checkbox" checked={mostrarDebiles} onChange={e => setMostrarDebiles(e.target.checked)} className="accent-blue-500" />
              <span className={`text-[10px] sm:text-xs ${mostrarDebiles ? 'text-amber-400' : 'text-gray-500'}`}>Incluir DÉBIL</span>
            </label>
          )}
        </div>
      </div>

      <div className="text-[10px] sm:text-xs text-gray-500 mb-4">
        {displayAnalysis ? `${displayAnalysis.cities.length} ciudades · ` : ''}
        Bankroll ${bankroll} · Asignado ${Math.round(totalAsignado * 100) / 100} · Fecha {effectiveFecha || '—'}
        {!mostrarDebiles && hasDebiles && ' · DÉBIL excluido'}
      </div>

      {!displayAnalysis && (
        <div className="text-center py-8 text-gray-500 text-sm">Selecciona una fecha y presiona Ir para analizar.</div>
      )}

      {displayAnalysis && allPairs.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">No se encontraron pares SI/NO con edge positivo para esta fecha.</div>
      )}

      {visiblePairs.length === 0 && allPairs.length > 0 && (
        <div className="text-center py-4 text-amber-400 text-xs sm:text-sm border border-amber-500/20 rounded-lg bg-amber-500/5 mb-4">
          Solo hay oportunidades en ciudades con consenso DÉBIL. Marca "Incluir DÉBIL" para verlas.
        </div>
      )}

      {visiblePairs.length > 0 && (
        <div className="space-y-3">
          {visiblePairs.map((plan, idx) => (
            <div
              key={`${plan.slug}-${plan.yes.valor}-${plan.no.valor}`}
              className={`rounded-xl border ${
                idx === 0
                  ? 'border-yellow-500/60 bg-gradient-to-r from-yellow-500/10 via-slate-800/80 to-slate-800/80'
                  : 'border-gray-700/50 bg-slate-800/50'
              }`}
            >
              <div className="p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {idx === 0 && <span className="text-[10px] font-bold text-yellow-400 bg-yellow-500/20 px-2 py-0.5 rounded-full">★ MEJOR</span>}
                    <span className="font-bold text-sm sm:text-base text-white">{plan.ciudad}</span>
                    <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      plan.consenso === 'MUY FUERTE' ? 'bg-emerald-500/20 text-emerald-300' :
                      plan.consenso === 'FUERTE' ? 'bg-blue-500/20 text-blue-300' :
                      plan.consenso === 'ACEPTABLE' ? 'bg-amber-500/20 text-amber-300' :
                      'bg-red-500/20 text-red-300'
                    }`}>
                      {plan.consenso}
                    </span>
                    <span className="text-[9px] sm:text-[10px] text-gray-500">{plan.exitoPct}% hist</span>
                    <span className="text-[9px] sm:text-[10px] text-gray-600">Score {plan.score}</span>
                  </div>
                  <span className="text-xs sm:text-sm font-mono text-gray-300">${plan.montoPar.toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-2">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 sm:p-3">
                    <div className="text-[9px] sm:text-[10px] text-emerald-400 font-semibold">SI {plan.yes.valor}°C</div>
                    <div className="text-[10px] sm:text-xs text-gray-400">
                      Mkt {plan.yes.probMkt}% · IA {plan.yes.probIA.toFixed(0)}% · Edge <span className="text-emerald-400 font-bold">+{plan.yes.edge}%</span>
                    </div>
                    <div className="text-base sm:text-lg font-bold text-emerald-300 mt-0.5">${plan.yesMonto.toFixed(2)}</div>
                  </div>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 sm:p-3">
                    <div className="text-[9px] sm:text-[10px] text-red-400 font-semibold">NO {plan.no.valor}°C</div>
                    <div className="text-[10px] sm:text-xs text-gray-400">
                      Mkt {plan.no.probMkt}% · IA {plan.no.probIA.toFixed(0)}% · Edge <span className="text-emerald-400 font-bold">+{plan.no.edge}%</span>
                    </div>
                    <div className="text-base sm:text-lg font-bold text-red-300 mt-0.5">${plan.noMonto.toFixed(2)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-center text-[9px] sm:text-[10px]">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-1.5 sm:p-2">
                    <div className="font-medium text-emerald-300">= {plan.yes.valor}°C</div>
                    <div className="text-gray-400">✅SI ✅NO</div>
                    <div className="font-bold text-emerald-400">+${plan.gananciaSI.toFixed(2)}</div>
                  </div>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-1.5 sm:p-2">
                    <div className="font-medium text-red-300">= {plan.no.valor}°C</div>
                    <div className="text-gray-400">❌SI ❌NO</div>
                    <div className="font-bold text-red-400">-${(-plan.perdidaAmbos).toFixed(2)}</div>
                  </div>
                  <div className="bg-gray-700/50 border border-gray-600/30 rounded-lg p-1.5 sm:p-2">
                    <div className="font-medium text-gray-300">≠ otro</div>
                    <div className="text-gray-400">❌SI ✅NO</div>
                    <div className="font-bold text-emerald-400">+${plan.gananciaOtro.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="text-center text-[10px] sm:text-xs text-gray-500 pt-2 border-t border-gray-700/30">
            Total asignado: ${Math.round(totalAsignado * 100) / 100} de ${bankroll} · {visiblePairs.length} pares · Score = edge × (exito/50) × consenso
          </div>
        </div>
      )}
    </div>
  )
}