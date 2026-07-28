import { useState, useEffect } from 'react'
import { CIUDADES_ASIA } from '@/lib/cities'

interface PipelineStep {
  paso: number
  etapa: string
  desc: string
  aplicado: boolean
  detalle: string
}

interface CityData {
  slug: string
  nombre: string
  modelo: string
  pipeline: PipelineStep[]
  mejoras: Record<string, { mae_actual: number; mae_mejorado: number; mejora_mae_pct: number }>
}

interface ApiData {
  ciudades: Record<string, CityData>
}

const STEPS_BASE = [
  { paso: 1, etapa: 'Modelos Meteorológicos', desc: 'best_match, ecmwf_ifs025, gfs_seamless, icon_seamless, jma_seamless, meteofrance_seamless' },
  { paso: 2, etapa: 'Z-score Filter', desc: 'Excluye modelos outlier |z| > 3σ' },
  { paso: 3, etapa: 'EWMA Pesos Adaptativos', desc: 'Pesos dinámicos por MAE histórico con α=0.15' },
  { paso: 4, etapa: 'Ensemble Promedio', desc: 'temp_ponderada = promedio ponderado de modelos filtrados' },
  { paso: 5, etapa: 'Backtest Bias Estacional', desc: 'Bias por ciudad+mes desde backtest histórico' },
  { paso: 6, etapa: 'Dynamic EMA Bias', desc: 'Corrección dinámica EMA α=0.3 sobre últimos 30 días' },
]

const STEPS_MEJORA = [
  { paso: 8, etapa: 'Station Bias', desc: 'Corrige sesgo grid→estación meteorológica real' },
  { paso: 9, etapa: 'Range Bias', desc: 'Bias distinto según rango de temperatura (<20, 20-25, 25-30, 30-35, 35+)' },
  { paso: 10, etapa: 'Rapid Warming Boost', desc: '+0.5°C si forecast > temp_real ayer + 3°C (olas de calor)' },
]

const STEPS_POST = [
  { paso: 12, etapa: 'Monte Carlo 20K Sims', desc: '20,000 simulaciones con Student-t ν=4 o CDF empírica ECMWF ENS' },
  { paso: 13, etapa: 'Probabilidad por Bucket', desc: '% de simulaciones que caen en cada bucket de Polymarket' },
  { paso: 14, etapa: 'Normalización', desc: 'prob_ia_norm = prob_ia_raw / sum. Identity scaling' },
  { paso: 15, etapa: 'Kelly Allocation', desc: 'f=0.25, edge mínimo 6%, $10/día' },
]

type SubView = 'global' | 'por-ciudad'

export default function Arquitectura() {
  const [subView, setSubView] = useState<SubView>('global')
  const [slug, setSlug] = useState('chongqing')
  const [data, setData] = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (subView !== 'por-ciudad') return
    setLoading(true)
    setError(null)
    fetch(`/api/mejora-continua?dias=90`)
      .then(r => r.json())
      .then(j => { setData(j); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [subView])

  const ciudad = slug && data?.ciudades?.[slug]

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex rounded-lg bg-slate-800 border border-gray-600 overflow-hidden">
        <button
          onClick={() => setSubView('global')}
          className={`flex-1 px-3 py-2.5 text-xs font-bold transition ${subView === 'global' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
        >
          GLOBAL
        </button>
        <button
          onClick={() => setSubView('por-ciudad')}
          className={`flex-1 px-3 py-2.5 text-xs font-bold transition ${subView === 'por-ciudad' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
        >
          POR CIUDAD
        </button>
      </div>

      {subView === 'global' && <GlobalView />}
      {subView === 'por-ciudad' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-6">
            <h2 className="text-xl font-bold text-white mb-1">🏗️ Pipeline por Ciudad</h2>
            <p className="text-sm text-gray-400 mb-6">Compara el pipeline actual vs el mejorado para cada ciudad</p>

            <div className="flex gap-3 mb-6">
              <div className="w-64">
                <label className="block text-xs text-gray-500 mb-1.5">Ciudad</label>
                <select
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  className="w-full rounded-lg bg-slate-800 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  {CIUDADES_ASIA.map(c => (
                    <option key={c.slug} value={c.slug}>{c.nombre}</option>
                  ))}
                </select>
              </div>
            </div>

            {loading && (
              <div className="animate-pulse space-y-4">
                <div className="h-24 rounded-xl bg-slate-800/50" />
                <div className="h-64 rounded-xl bg-slate-800/50" />
              </div>
            )}

            {error && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">{error}</div>
            )}

            {ciudad && !loading && <CityPipelineView ciudad={ciudad} />}
          </div>
        </div>
      )}
    </div>
  )
}

function CityPipelineView({ ciudad }: { ciudad: CityData }) {
  const isAdaptive = ciudad.modelo !== 'combinado_estandar'
  const modeloLabel = ciudad.modelo === 'combinado_estandar' ? 'Combinado Estándar' :
    ciudad.modelo === 'wuhan_adaptive' ? 'Wuhan Adaptive (solo Station)' :
    ciudad.modelo === 'shanghai_adaptive' ? 'Shanghai Adaptive (solo Range)' :
    ciudad.modelo === 'hongkong_adaptive' ? 'HongKong Adaptive (solo Station)' :
    ciudad.modelo === 'seoul_adaptive' ? 'Seoul Adaptive (solo Station)' :
    ciudad.modelo === 'singapore_adaptive' ? 'Singapore Adaptive (solo Station)' :
    ciudad.modelo === 'beijing_adaptive' ? 'Beijing Adaptive (solo Station)' :
    ciudad.modelo === 'chengdu_adaptive' ? 'Chengdu Adaptive (solo Station)' :
    ciudad.modelo === 'shenzhen_adaptive' ? 'Shenzhen Adaptive (solo Station)' :
    ciudad.modelo === 'tokyo_adaptive' ? 'Tokyo Adaptive (solo Station)' :
    ciudad.modelo

  return (
    <>
      {/* City Info */}
      <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-bold text-white">{ciudad.nombre}</h3>
            <p className="text-xs text-gray-400">Modelo: <span className={`font-semibold ${isAdaptive ? 'text-amber-400' : 'text-blue-400'}`}>{modeloLabel}</span></p>
          </div>
          <div className="text-right text-xs">
            {ciudad.mejoras?.combinado && (
              <>
                <p className="text-gray-500">MAE Actual: <span className="text-blue-400 font-medium">{ciudad.mejoras.combinado.mae_actual.toFixed(2)}°C</span></p>
                <p className="text-gray-500">MAE Mejorado: <span className="text-emerald-400 font-medium">{ciudad.mejoras.combinado.mae_mejorado.toFixed(2)}°C</span></p>
                <p className={`font-bold ${ciudad.mejoras.combinado.mejora_mae_pct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {ciudad.mejoras.combinado.mejora_mae_pct >= 0 ? '+' : ''}{ciudad.mejoras.combinado.mejora_mae_pct.toFixed(1)}%
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline Comparison */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* PIPELINE ACTUAL */}
        <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 overflow-hidden">
          <div className="bg-slate-800/80 px-4 py-3 border-b border-gray-700/30">
            <h4 className="text-sm font-bold text-blue-400">PIPELINE ACTUAL</h4>
            <p className="text-[10px] text-gray-500">Estado actual del pipeline en producción para esta ciudad</p>
          </div>
          <PipelineColumn
            title="PIPELINE ACTUAL"
            titleColor="text-blue-400"
            subtitle="Forecast que se usa hoy en producción"
            ciudad={ciudad}
            isActual={true}
          />
        </div>

        {/* PIPELINE MEJORA CONTINUA */}
        <div className="rounded-xl bg-slate-800/30 border border-gray-700/30 overflow-hidden">
          <PipelineColumn
            title="PIPELINE MEJORA CONTINUA"
            titleColor="text-amber-400"
            subtitle="Forecast mejorado aplicando correcciones adicionales"
            ciudad={ciudad}
            isActual={false}
          />
        </div>
      </div>
    </>
  )
}

function PipelineColumn({ title, titleColor, subtitle, ciudad, isActual }: { title: string; titleColor: string; subtitle: string; ciudad: CityData; isActual: boolean }) {
  const mejoraPaso = (etapa: string) => ciudad.pipeline.find(p => p.etapa === etapa)

  function mejoraActivaEnMejora(etapa: string): boolean {
    const m = ciudad.modelo
    if (m === 'combinado_estandar') return true
    if (m === 'wuhan_adaptive' || m === 'hongkong_adaptive' || m === 'seoul_adaptive' || m === 'singapore_adaptive' || m === 'beijing_adaptive' || m === 'chengdu_adaptive' || m === 'shenzhen_adaptive' || m === 'tokyo_adaptive') return etapa === 'Station Bias'
    if (m === 'shanghai_adaptive') return etapa === 'Range Bias'
    return false
  }

  const step7 = {
    paso: 7,
    etapa: isActual ? 'temp_corregida (ACTUAL)' : 'temp_corregida (BASE)',
    desc: isActual
      ? 'Forecast punto final del sistema de producción actual — sin station/range/rapid'
      : 'Forecast base antes de aplicar mejoras — mismo cálculo que el sistema actual'
  }

  return (
    <div>
      <div className="bg-slate-800/80 px-4 py-3 border-b border-gray-700/30">
        <h4 className={`text-sm font-bold ${titleColor}`}>{title}</h4>
        <p className="text-[10px] text-gray-500">{subtitle}</p>
      </div>
      <div className="p-3 space-y-1.5">
        {STEPS_BASE.map(s => (
          <StepRow key={s.paso} paso={s.paso} etapa={s.etapa} desc={s.desc} active={true} />
        ))}
        <StepRow paso={step7.paso} etapa={step7.etapa} desc={step7.desc} active={true} />

        {STEPS_MEJORA.map(s => {
          const p = mejoraPaso(s.etapa)
          const isActive = isActual ? false : mejoraActivaEnMejora(s.etapa)
          return <StepRow key={s.paso} paso={s.paso} etapa={s.etapa} desc={p?.detalle || s.desc} active={isActive} detail={p?.detalle} />
        })}

        {!isActual && (
          <StepRow paso={11} etapa="temp_corregida MEJORADA" desc="Forecast punto final del sistema mejorado — temp_corregida + correcciones activas" active={true} />
        )}

        {STEPS_POST.map(s => (
          <StepRow key={s.paso} paso={s.paso} etapa={s.etapa} desc={s.desc} active={true} />
        ))}
      </div>
    </div>
  )
}

function StepRow({ paso, etapa, desc, active, detail }: { paso: number; etapa: string; desc: string; active: boolean; detail?: string }) {
  const isMejora = paso >= 8 && paso <= 11
  const badgeColor = active ? (isMejora ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400') : 'bg-gray-700/30 text-gray-500'
  const rowColor = active ? (isMejora ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-slate-900/50 border border-gray-700/30') : 'bg-slate-900/20 border border-gray-800/50 opacity-40'
  const circleColor = active ? (isMejora ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400') : 'bg-gray-700/30 text-gray-600'
  const textColor = !active ? 'text-gray-600' : (isMejora ? 'text-amber-300' : 'text-white')
  return (
    <div className={`rounded-lg px-3 py-2 transition ${rowColor}`}>
      <div className="flex items-center gap-2">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${circleColor}`}>
          {paso}
        </span>
        <span className={`text-xs font-semibold ${textColor}`}>
          {etapa}
        </span>
        <span className={`ml-auto text-[10px] font-bold uppercase ${badgeColor} px-2 py-0.5 rounded`}>
          {active ? 'ACTIVO' : 'INACTIVO'}
        </span>
      </div>
      <p className={`text-[10px] mt-1 ml-8 leading-relaxed ${!active ? 'text-gray-600' : 'text-gray-500'}`}>
        {detail || desc}
      </p>
    </div>
  )
}

/* =========== GLOBAL VIEW =========== */
function GlobalView() {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 border border-gray-700/30 p-6">
      <h2 className="text-xl font-bold text-white mb-1">🏗️ Arquitectura del Sistema</h2>
      <p className="text-sm text-gray-400 mb-6">Pipeline completo de forecasting meteorológico con mejoras implementadas</p>

      {/* Pipeline Flow */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
        <div className="rounded-xl bg-blue-500/5 border border-blue-500/20 p-4">
          <div className="text-2xl mb-2">📡</div>
          <h3 className="font-semibold text-blue-400 text-sm mb-2">1. Datos Meteorológicos</h3>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• Open-Meteo: 6 modelos + ECMWF ENS 51 miembros</li>
            <li>• Nowcasting METAR: observaciones en vivo</li>
            <li>• Archive API: temperatura real histórica</li>
          </ul>
        </div>

        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4">
          <div className="text-2xl mb-2">🔬</div>
          <h3 className="font-semibold text-emerald-400 text-sm mb-2">2. Ensemble + Filtros</h3>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• Z-score filter: excluye modelos outlier (&gt;3σ)</li>
            <li>• EWMA weighting: pesos dinámicos por precisión</li>
            <li>• Bias correction dinámico (EMA últimos 30 días)</li>
          </ul>
        </div>

        <div className="rounded-xl bg-purple-500/5 border border-purple-500/20 p-4">
          <div className="text-2xl mb-2">🎯</div>
          <h3 className="font-semibold text-purple-400 text-sm mb-2">3. Calibración</h3>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• Empirical CDF: ECMWF ENS 51 miembros</li>
            <li>• Platt Scaling: calibración sigmoide (activo)</li>
            <li>• Isotonic PAVA: alternativa disponible (no-normales)</li>
          </ul>
        </div>

        <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4">
          <div className="text-2xl mb-2">📊</div>
          <h3 className="font-semibold text-amber-400 text-sm mb-2">4. Probabilidad Monte Carlo</h3>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• 20,000 simulaciones por contrato</li>
            <li>• Student-t ν=4 (colas gordas)</li>
            <li>• Empirical CDF cuando hay ≥20 miembros</li>
          </ul>
        </div>

        <div className="rounded-xl bg-rose-500/5 border border-rose-500/20 p-4">
          <div className="text-2xl mb-2">💰</div>
          <h3 className="font-semibold text-rose-400 text-sm mb-2">5. Kelly + Asignación</h3>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• Fractional Kelly (0.25)</li>
            <li>• Edge mínimo 6%</li>
            <li>• $10/día presupuesto, $1-5 por apuesta</li>
          </ul>
        </div>

        <div className="rounded-xl bg-cyan-500/5 border border-cyan-500/20 p-4">
          <div className="text-2xl mb-2">✅</div>
          <h3 className="font-semibold text-cyan-400 text-sm mb-2">6. Validación Walk-Forward</h3>
          <ul className="text-xs text-gray-400 space-y-1">
            <li>• Backtest walk-forward: sin look-ahead bias</li>
            <li>• 30 días training + test secuencial</li>
            <li>• MAE/RMSE/bias por ciudad</li>
          </ul>
        </div>
      </div>

      {/* Model Details */}
      <div className="rounded-xl bg-slate-800/50 border border-gray-700/30 p-4 mb-4">
        <h3 className="font-semibold text-white text-sm mb-3">🧩 Detalle de Modelos (Open-Meteo)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">best_match</span><p className="text-gray-500">Mejor modelo por coordenada</p></div>
          <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">ecmwf_ifs025</span><p className="text-gray-500">ECMWF HRES (~9km)</p></div>
          <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">gfs_seamless</span><p className="text-gray-500">NOAA GFS (~13km)</p></div>
          <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">icon_seamless</span><p className="text-gray-500">DWD ICON (~13km)</p></div>
          <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">jma_seamless</span><p className="text-gray-500">JMA Japonés (~20km)</p></div>
          <div className="bg-slate-900/50 rounded-lg p-2"><span className="text-blue-400">meteofrance_seamless</span><p className="text-gray-500">Météo France (~10km)</p></div>
          <div className="bg-slate-900/50 rounded-lg p-2 col-span-2"><span className="text-emerald-400 font-medium">ecmwf_ens</span><p className="text-gray-500">ECMWF ENS: 51 miembros + control → Empirical CDF</p></div>
        </div>
      </div>

      {/* ECMWF ENS 51 */}
      <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 mb-4">
        <h3 className="font-semibold text-emerald-400 text-sm mb-2">🟢 ECMWF ENS 51 Miembros</h3>
        <p className="text-xs text-gray-400 mb-2">Mejora más importante: el Ensemble del Centro Europeo proporciona 51 perturbaciones del mismo modelo, dando una distribución de probabilidad REAL. Esto reemplaza la suposición paramétrica (Student-t) con una CDF empírica, eliminando el mayor error de calibración.</p>
        <div className="text-xs text-gray-500">Cada miembro: misma fecha, misma ciudad, condiciones iniciales ligeramente perturbadas → spread realista</div>
      </div>

      {/* PAVA */}
      <div className="rounded-xl bg-purple-500/5 border border-purple-500/20 p-4 mb-4">
        <h3 className="font-semibold text-purple-400 text-sm mb-2">🟣 Calibración: Platt Scaling (Activo)</h3>
        <p className="text-xs text-gray-400 mb-2">Platt Scaling ajusta probabilidades via sigmoide (logit). Backtest muestra que en datos meteorológicos (distribución aproximadamente normal), Platt supera a PAVA isotonic: 2.5% mejor Brier score, 17.9% mejor ECE.</p>
        <div className="text-xs text-gray-500">PAVA isotonic está disponible como alternativa para datasets no-normales. ECE (Expected Calibration Error) &lt;3% = excelente.</div>
      </div>

      {/* EWMA + Z-score */}
      <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 mb-4">
        <h3 className="font-semibold text-amber-400 text-sm mb-2">🟠 EWMA + Z-score Filter</h3>
        <p className="text-xs text-gray-400 mb-2">EWMA (Exponentially Weighted Moving Average) aplica pesos dinámicos por modelo con decaimiento exponencial (decay=0.15). Z-score filter excluye modelos con |z| &gt; 3σ antes del promedio, eliminando outliers como GFS cuando produce valores extremos.</p>
      </div>

      {/* Walk-forward */}
      <div className="rounded-xl bg-cyan-500/5 border border-cyan-500/20 p-4">
        <h3 className="font-semibold text-cyan-400 text-sm mb-2">🔵 Walk-Forward Backtest</h3>
        <p className="text-xs text-gray-400 mb-2">El gold standard de validación: para cada día, el sesgo se calcula SOLO con datos anteriores a esa fecha. Esto da la precisión real del sistema en producción, sin look-ahead bias. El backtest normal (que entrena con todos los datos) sobrestima la precisión.</p>
        <div className="grid grid-cols-2 gap-4 mt-3 text-xs">
          <div className="bg-slate-900/50 rounded-lg p-2">
            <p className="text-gray-500">Backtest Simple</p>
            <p className="text-gray-400">Entrena con datos pasados → sesgo calculado con 90 días</p>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-2">
            <p className="text-emerald-400">Walk-Forward</p>
            <p className="text-gray-400">Cada día solo ve datos anteriores → precisión real</p>
          </div>
        </div>
      </div>
    </div>
  )
}