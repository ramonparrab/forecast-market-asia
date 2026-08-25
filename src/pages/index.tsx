import { useState, useEffect, useCallback } from 'react'
import Layout from '@/components/Layout'
import CityCard from '@/components/CityCard'
import AllocationPanel from '@/components/AllocationPanel'
import MetricsChart from '@/components/MetricsChart'
import ForecastVsActualChart from '@/components/ForecastVsActualChart'
import ArbitragePanel from '@/components/ArbitragePanel'
import ForecastTable from '@/components/ForecastTable'
import BacktestChart from '@/components/BacktestChart'
import ExecutiveSummaryPanel from '@/components/ExecutiveSummary'
import ComparisonPanel from '@/components/ComparisonPanel'
import SignalsPanel from '@/components/SignalsPanel'
import CoberturaSiNo from '@/components/CoberturaSiNo'
import MejoraContinua from '@/components/MejoraContinua'
import BacktestSi from '@/components/BacktestSi'
import PerformanceAnalisis from '@/components/PerformanceAnalisis'
import LadderBetting from '@/components/LadderBetting'
import Arquitectura from '@/components/Arquitectura'
import VsRivales from '@/components/VsRivales'
import TomarDecision from '@/components/TomarDecision'
import WalletAnalysis from '@/components/WalletAnalysis'

import { DailyAnalysis, GlobalMetrics, CityAnalysis } from '@/types'
import { getModeloNombre } from '@/lib/modelo-selector'

export async function getServerSideProps() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseKey) {
    return { props: { initialAnalysis: null, initialMetrics: null, initialAvailableDates: [], hindcastDays: 0 } }
  }

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const client = createClient(supabaseUrl, supabaseKey)

    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    const fecha = nowCaracas.toISOString().slice(0, 10)

    // ===== STEP 1 + 2 + 4: Paralelizar llamadas independientes =====
    const HINDCAST_DAYS = 30

    const [runsResult, ayerResult, existingActualsResult, datesResult, supabaseFns, snapshotsResult] = await Promise.all([
      // Query del día — obtener 10PM y 11PM por separado
      client.from('daily_runs' as any).select('*').eq('fecha_objetivo', fecha).order('fecha_ejecucion', { ascending: false } as any).limit(2),
      // Query del día anterior (fallback)
      (() => {
        const yc = new Date(Date.now() + (-4 * 60 * 60000))
        return client.from('daily_runs' as any).select('*').eq('fecha_objetivo', yc.toISOString().slice(0, 10)).order('fecha_ejecucion', { ascending: false } as any).limit(1)
      })(),
      // Check si hay datos históricos con temp_real
      client.from('forecast_history' as any).select('fecha_objetivo').not('temp_real', 'is', null).order('fecha_objetivo', { ascending: false } as any).limit(1),
      // Fechas disponibles
      client.from('daily_runs' as any).select('fecha_objetivo').order('fecha_objetivo', { ascending: false } as any).limit(90),
      // Importar funciones de supabase en paralelo con queries
      import('@/lib/supabase').then(m => m),
      // Snapshots bloqueados para determinar qué corrida mostrar
      client.from('forecast_snapshot' as any).select('slug, run_type_ganadora').eq('fecha_objetivo', fecha).is('temp_real', null),
    ])

    const { getHistoricalAccuracy, getHistoricalAccuracyInteger, computeGlobalMetrics } = supabaseFns
    const runs = runsResult.data as any[] | undefined
    const ayerData = ayerResult.data as any[] | undefined
    const existingActuals = existingActualsResult.data as any[] | undefined
    const datesData = datesResult.data as any[]
    const snapshots = snapshotsResult.data as any[] | undefined

    // Parsear pronóstico del día o de ayer
    let analysis: DailyAnalysis | null = null
    const parseRun = (row: any) => {
      const parsedCities = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : row.resultados
      if (!parsedCities || !Array.isArray(parsedCities) || parsedCities.length === 0) return null
      return {
        fecha: row.fecha_ejecucion,
        fecha_objetivo: row.fecha_objetivo,
        message: `Pronóstico del ${new Date(row.fecha_ejecucion).toLocaleDateString('es-ES', { timeZone: 'America/Caracas' })}`,
        cities: parsedCities,
        recommendations: typeof row.recomendaciones === 'string' ? JSON.parse(row.recomendaciones) : row.recomendaciones,
        total_allocated: row.total_asignado ?? 0,
        global_metrics: null,
        arbitrage_alerts: [],
        historicalErrors: {},
      }
    }

    // Elegir la corrida correcta basado en snapshots
    // Si hay snapshots, determinar qué run_type ganó en mayoría
    if ((runs as any[] | undefined)?.length) {
      const allRuns = runs as any[]
      if (allRuns.length === 1) {
        analysis = parseRun(allRuns[0])
      } else {
        // Hay 10PM y 11PM — usar snapshots para decidir
        const snapWins: Record<string, number> = {}
        for (const s of (snapshots ?? [])) {
          snapWins[s.run_type_ganadora] = (snapWins[s.run_type_ganadora] ?? 0) + 1
        }
        // Si mayoría de snapshots prefieren 10PM, usar esa corrida
        const wins10 = snapWins['10PM'] ?? 0
        const wins11 = snapWins['11PM'] ?? 0
        const preferred = wins10 > wins11 ? '10PM' : '11PM'
        const chosen = allRuns.find((r: any) => r.run_type === preferred) ?? allRuns[0]
        analysis = parseRun(chosen)
      }
    }
    if (!analysis && (ayerData as any[] | undefined)?.length) {
      analysis = parseRun((ayerData as any[])[0])
    }

    // Fechas disponibles
    const raw = ((datesData as any[] | undefined)?.map((r: any) => r.fecha_objetivo) ?? [])
    const availableDates = Array.from(new Set<string>(raw))

    // ===== STEP 2: Hindcast (solo si no hay datos históricos) =====
    const needsHindcast = !(existingActuals as any[] | undefined)?.length
    let hindcastDays = 0

    if (needsHindcast) {
      console.log('[HINDCAST] No hay datos históricos con temp_real. Ejecutando backtest 30 días...')
      const { saveForecastRecords, getServiceClient } = supabaseFns
      const { runBacktest } = await import('@/lib/backtest-engine')

      const hoy = new Date()
      const hace30 = new Date(hoy)
      hace30.setDate(hoy.getDate() - HINDCAST_DAYS)
      const startStr = hace30.toISOString().slice(0, 10)

      const serviceClient = getServiceClient()
      if (serviceClient) {
        await serviceClient.from('forecast_history' as any).delete().gte('fecha_objetivo', startStr).lt('fecha_objetivo', fecha)
      }

      const backtest = await runBacktest(HINDCAST_DAYS)
      const hindcastRecords = backtest.resultados.map((r: any) => ({
        fecha_ejecucion: r.fecha + 'T22:00:00',
        fecha_objetivo: r.fecha,
        ciudad: r.ciudad,
        slug: r.slug,
        temp_pronosticada: r.temp_pronosticada,
        temp_corregida: r.temp_corregida,
        temp_real: r.temp_real,
        error: r.error,
        modelos_usados: r.modelos_usados,
        consenso: r.consenso,
      }))

      for (let i = 0; i < hindcastRecords.length; i += 50) {
        await saveForecastRecords(hindcastRecords.slice(i, i + 50))
      }
      hindcastDays = HINDCAST_DAYS
      console.log(`[HINDCAST] Guardados ${hindcastRecords.length} registros (${HINDCAST_DAYS} días x ${backtest.total_ciudades} ciudades)`)
    }

    // ===== STEP 3: Recalcular exito_pct en paralelo por ciudad =====
    const [metrics] = await Promise.all([
      computeGlobalMetrics(),
    ])
    const globalAccuracyPct = metrics?.accuracy_pct ?? 50

    if (analysis?.cities) {
      const accuracyResults = await Promise.all(
        analysis.cities.map(async (city) => {
          const [hist, histInt] = await Promise.all([
            getHistoricalAccuracy(city.slug),
            getHistoricalAccuracyInteger(city.slug),
          ])
          return { city, hist, histInt }
        })
      )

      for (const { city, hist, histInt } of accuracyResults) {
        let exitoPct: number
        if (hist.muestras >= 5) {
          const priorStrength = 10
          exitoPct = Math.round(
            (hist.accuracy * hist.muestras + globalAccuracyPct * priorStrength)
            / (hist.muestras + priorStrength)
          )
        } else {
          exitoPct = Math.round(globalAccuracyPct)
        }
        if (city.forecast.weather?.code === 3) {
          exitoPct = Math.max(10, exitoPct - 1)
        }
        city.exito_pct = exitoPct

        if (histInt.muestras >= 5) {
          city.exito_pct_integer = Math.round(
            (histInt.accuracy * histInt.muestras + globalAccuracyPct * 10)
            / (histInt.muestras + 10)
          )
        } else {
          city.exito_pct_integer = Math.round(globalAccuracyPct)
        }
      }
    }

    return {
      props: {
        initialAnalysis: JSON.parse(JSON.stringify(analysis)),
        initialMetrics: metrics ? JSON.parse(JSON.stringify(metrics)) : null,
        initialAvailableDates: availableDates,
        hindcastDays,
      }
    }
  } catch (e) {
    console.error('[getServerSideProps]', e)
    return { props: { initialAnalysis: null, initialMetrics: null, initialAvailableDates: [], hindcastDays: 0 } }
  }
}

type View = 'executive' | 'dashboard' | 'table' | 'metrics' | 'comparison' | 'backtest' | 'arbitrage' | 'architecture' | 'signals' | 'coverage' | 'mejora-continua' | 'backtest-si' | 'performance' | 'ladder' | 'rivales' | 'wallet' | 'decision'

/** Returns a friendly confidence label + color class */
function getConfidence(city: CityAnalysis): { label: string; color: string; bg: string } {
  const pct = city.exito_pct
  if (pct >= 80) return { label: 'MUY ALTA', color: 'text-emerald-400', bg: 'bg-emerald-500/10' }
  if (pct >= 55) return { label: 'ALTA', color: 'text-green-400', bg: 'bg-green-500/10' }
  if (pct >= 45) return { label: 'MEDIA', color: 'text-amber-400', bg: 'bg-amber-500/10' }
  return { label: 'BAJA', color: 'text-red-400', bg: 'bg-red-500/10' }
}

function TargetDateBanner({ fechaObjetivo, caracasTime, isHistorical }: { fechaObjetivo: string; caracasTime: string; isHistorical: boolean }) {
  const targetDate = new Date(fechaObjetivo + 'T12:00:00')
  const dayName = targetDate.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <div className="rounded-xl bg-gradient-to-r from-blue-600/20 via-blue-500/10 to-blue-600/20 border border-blue-500/20 p-4 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📅</span>
          <div>
            <p className="text-sm text-blue-300 font-medium">DÍA DEL PRONÓSTICO</p>
            <p className="text-xl font-bold text-white">{dayName}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-center">
            <p className="text-gray-500">Ahora en Caracas</p>
            <p className="text-lg font-semibold text-white">{caracasTime}</p>
          </div>
          <div className="h-8 w-px bg-gray-700"></div>
          <div className="text-center">
            <p className="text-gray-500">Ejecución automática</p>
            <p className="text-lg font-semibold text-blue-400">22:00 Caracas</p>
          </div>
          <div className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${isHistorical ? 'bg-blue-500/10 border-blue-500/30 text-blue-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'}`}>
            {isHistorical ? '📡 Cron 10PM' : '⚡ Análisis fresco'}
          </div>
        </div>
      </div>
    </div>
  )
}

function ImprovementLegend() {
  return (
    <details className="mb-6 rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-blue-400 hover:text-blue-300 transition flex items-center gap-2">
        <span>⚡</span>
        Modelo Global v6.0 — 7 de 9 mejoras activas
        <span className="ml-auto text-xs text-gray-500">(click para expandir)</span>
      </summary>
      <div className="p-4 pt-2 space-y-4">

        {/* Header */}
        <div className="rounded-xl bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-emerald-600/10 border border-blue-500/20 p-4">
          <p className="text-sm font-bold text-white mb-1">Modelo Unificado v6.0</p>
          <p className="text-xs text-gray-400">Combina las 6 mejoras del sistema en un pipeline coherente. Backtest validado con train/test split.</p>
        </div>

        {/* Grid of improvements */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">

          {/* 1. ECMWF ENS 51 + Empirical CDF */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-emerald-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] text-emerald-400 font-bold">ACTIVO</div>
            <p className="font-semibold text-emerald-400 mb-1 text-xs">1. ECMWF ENS 51 + Empirical CDF</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-emerald-300">Qué hace:</strong> Usa 51 miembros del ensemble europeo para calcular probabilidades directamente sin asumir distribución.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-emerald-300">Cómo:</strong> Cuenta fracción de miembros que caen dentro de cada bucket (±1°C). Reemplaza Student-t cuando hay ≥20 miembros.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-emerald-300">Impacto:</strong> CDF empírica es SIEMPRE más precisa que distribución paramétrica. Elimina error de especificación de modelo.
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-emerald-400">ensemble.ts:102-125</code>, <code className="text-emerald-400">forecast-engine.ts:133-168</code>
            </div>
          </div>

          {/* 2. Platt Scaling */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-purple-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-gray-500/20 px-2 py-0.5 text-[9px] text-gray-400 font-bold">EN ESPERA</div>
            <p className="font-semibold text-purple-400 mb-1 text-xs">2. Platt Scaling (Calibración)</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-purple-300">Qué hace:</strong> Ajusta probabilidades crudas vía función sigmoide (logit). Corrige sesgos sistemáticos del ensemble.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-purple-300">Cómo:</strong> Transforma probabilidad cruda → logit → aplica α·logit + β → sigmoid → probabilidad calibrada.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-gray-300">Estado:</strong> Requiere pares reales (prob_predicha, outcome) por contrato. Actualmente forecast_history solo guarda temp+error, no probabilidades. Necesita nuevas columnas en Supabase.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed">
              <strong className="text-purple-300">Backtest previo:</strong> Platt supera PAVA isotonic en datos meteorológicos (2.5% mejor Brier, 17.9% mejor ECE) cuando se dispone de pares reales.
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-purple-400">calibration.ts:238-250</code>, <code className="text-purple-400">forecast-engine.ts:194-199</code>
            </div>
          </div>

          {/* 3. EWMA Weights */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-amber-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] text-amber-400 font-bold">ACTIVO</div>
            <p className="font-semibold text-amber-400 mb-1 text-xs">3. EWMA Model Weights</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-amber-300">Qué hace:</strong> Asigna pesos a cada modelo meteorológico basado en rendimiento reciente con decaimiento exponencial.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-amber-300">Cómo:</strong> Calcula MAE ponderado por EWMA (decay=0.15) por modelo. Errores recientes pesan 85% más que errores antiguos. Peso = 1/(MAE_ewma + 0.1).
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-amber-300">Impacto:</strong> Modelo GFS con errores recientes altos recibe menos peso automáticamente. ECMWF estable gana peso.
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-amber-400">bias-correction.ts:64-105</code>, <code className="text-amber-400">ensemble.ts:52-63</code>
            </div>
          </div>

          {/* 4. Z-score Filter */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-red-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] text-red-400 font-bold">ACTIVO</div>
            <p className="font-semibold text-red-400 mb-1 text-xs">4. Z-score Outlier Filter</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-red-300">Qué hace:</strong> Excluye modelos outlier del ensemble antes de calcular el promedio ponderado.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-red-300">Cómo:</strong> Calcula media y desvío estándar de todos los modelos. Si |z| = |T_modelo - μ| / σ &gt; 3.0, el modelo se descarta.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-red-300">Impacto:</strong> GFS produce valores extremos a veces. Filtro lo excluye automáticamente sin intervenir manualmente.
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-red-400">ensemble.ts:34-50</code>
            </div>
          </div>

          {/* 5. Nowcasting METAR */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-cyan-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-cyan-500/20 px-2 py-0.5 text-[9px] text-cyan-400 font-bold">ACTIVO</div>
            <p className="font-semibold text-cyan-400 mb-1 text-xs">5. Nowcasting METAR</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-cyan-300">Qué hace:</strong> Incorpora observaciones en vivo del aeropuerto local para ajustar el pronóstico durante el día.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-cyan-300">Cómo:</strong> Peso de observación sube de 0% a 80% durante el día. Temperatura observada → blend con pronóstico modelo.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-cyan-300">Impacto:</strong> Captura tendencias del día en tiempo real. Mejora precisión cuando la temperatura se desvía del pronóstico matutino.
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-cyan-400">nowcaster.ts:65-120</code>
            </div>
          </div>

          {/* 6. Dynamic Bias Correction */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-blue-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-blue-500/20 px-2 py-0.5 text-[9px] text-blue-400 font-bold">ACTIVO</div>
            <p className="font-semibold text-blue-400 mb-1 text-xs">6. Dynamic Bias Correction</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-blue-300">Qué hace:</strong> Corrige sesgo sistemático del ensemble basado en errores históricos recientes.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-blue-300">Cómo:</strong> EMA (α=0.3) de errores últimos 30 días. Bias dinámico se mezcla con bias estático estacional según cantidad de datos.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-blue-300">Impacto:</strong> Si el ensemble sobreestima consistentemente, bias corrige automáticamente. Cada pronóstico se beneficia del anterior.
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-blue-400">bias-correction.ts:32-57</code>, <code className="text-blue-400">ensemble.ts:65-71</code>
            </div>
          </div>

          {/* 7. Kelly Fractional */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-rose-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-rose-500/20 px-2 py-0.5 text-[9px] text-rose-400 font-bold">ACTIVO</div>
            <p className="font-semibold text-rose-400 mb-1 text-xs">7. Kelly Fractional (0.25)</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-rose-300">Qué hace:</strong> Calcula asignación óptima de $10/día maximizando crecimiento logarítmico a largo plazo.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-rose-300">Cómo:</strong> f* = (p·b - q) / b × 0.25. Solo aplica si edge &gt; 6%. Monto entre $1-5 por apuesta.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-rose-300">Impacto:</strong> Apuestas conservadoras. Fractional 0.25 reduce volatilidad vs Kelly completo. Edge mínimo 6% filtra señales débiles.
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-rose-400">kelly.ts:14-85</code>
            </div>
          </div>

          {/* 8. Resumen Ejecutivo */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-yellow-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-yellow-500/20 px-2 py-0.5 text-[9px] text-yellow-400 font-bold">NUEVO</div>
            <p className="font-semibold text-yellow-400 mb-1 text-xs">8. Resumen Ejecutivo Diario</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-yellow-300">Qué hace:</strong> Pestaña dedicada con recomendaciones del día, comparación vs ayer, y oportunidades rankeadas.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-yellow-300">Qué muestra:</strong> Recomendación grande del día, precisión global delta, TOP oportunidades (Edge × Precision), señales FUERTES/MEDIA/DEBIL.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-yellow-300">Dinámico:</strong> Compara automáticamente con día anterior. Muestra tendencias (↗ mejorando, ↘ empeorando).
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-yellow-400">ExecutiveSummary.tsx</code>, <code className="text-yellow-400">unified-model.ts</code>
            </div>
          </div>

          {/* 9. Supabase + Hindcast */}
          <div className="rounded-lg bg-slate-900/50 p-3 border border-indigo-500/20 relative">
            <div className="absolute top-2 right-2 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[9px] text-indigo-400 font-bold">ACTIVO</div>
            <p className="font-semibold text-indigo-400 mb-1 text-xs">9. Supabase + Hindcast 30d</p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-indigo-300">Qué hace:</strong> Almacena pronósticos en Supabase. Ejecuta hindcast 30 días automáticamente al detectar sin datos históricos.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-indigo-300">Cómo:</strong> Cada día guarda forecast_history. Cuando temp_real está disponible, calcula error real. Precisión se vuelve REAL tras 5+ registros.
            </p>
            <p className="text-gray-400 text-[10px] leading-relaxed mb-2">
              <strong className="text-indigo-300">Impacto:</strong> Base de datos crece automáticamente. Precisión real reemplaza estimación teórica. Análisis de tendencias día a día.
            </p>
            <div className="text-[9px] text-gray-500 mt-2">
              Archivos: <code className="text-indigo-400">supabase.ts</code>, <code className="text-indigo-400">index.tsx:76-122</code>
            </div>
          </div>

        </div>

        {/* Pipeline flow */}
        <div className="rounded-xl bg-slate-900/50 border border-gray-700/20 p-4">
          <p className="text-xs font-bold text-white mb-3">Pipeline del Modelo Unificado v6.0</p>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="rounded-full bg-emerald-500/20 px-2 py-1 text-emerald-400 font-bold">① Open-Meteo 6 modelos</span>
            <span className="text-gray-600">→</span>
            <span className="rounded-full bg-red-500/20 px-2 py-1 text-red-400 font-bold">② Z-score filter</span>
            <span className="text-gray-600">→</span>
            <span className="rounded-full bg-amber-500/20 px-2 py-1 text-amber-400 font-bold">③ EWMA weights</span>
            <span className="text-gray-600">→</span>
            <span className="rounded-full bg-blue-500/20 px-2 py-1 text-blue-400 font-bold">④ Bias correction</span>
            <span className="text-gray-600">→</span>
            <span className="rounded-full bg-cyan-500/20 px-2 py-1 text-cyan-400 font-bold">⑤ Nowcasting</span>
            <span className="text-gray-600">→</span>
            <span className="rounded-full bg-purple-500/20 px-2 py-1 text-purple-400 font-bold">⑥ Platt calibración</span>
            <span className="text-gray-600">→</span>
            <span className="rounded-full bg-rose-500/20 px-2 py-1 text-rose-400 font-bold">⑦ Kelly allocation</span>
            <span className="text-gray-600">→</span>
            <span className="rounded-full bg-yellow-500/20 px-2 py-1 text-yellow-400 font-bold">⑧ Resumen Ejecutivo</span>
          </div>
        </div>

      </div>
    </details>
  )
}

function CitySuccessSummary({ cities }: { cities: CityAnalysis[] }) {
  if (cities.length === 0) return null
  const high = cities.filter(c => c.exito_pct >= 55).length
  const medium = cities.filter(c => c.exito_pct >= 45 && c.exito_pct < 55).length
  const low = cities.filter(c => c.exito_pct < 45).length
  const best = cities.reduce((a, b) => a.exito_pct > b.exito_pct ? a : b)
  const worst = cities.reduce((a, b) => a.exito_pct < b.exito_pct ? a : b)
  const bestConf = getConfidence(best)
  const worstConf = getConfidence(worst)

  return (
    <div className="grid gap-3 sm:grid-cols-3 mb-6">
      <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-4 text-center">
        <p className="text-2xl font-bold text-emerald-400">{high}</p>
        <p className="text-xs text-gray-400">Ciudades con precisión <span className="text-emerald-400">ALTA</span> (≥55%)</p>
      </div>
      <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 text-center">
        <p className="text-2xl font-bold text-amber-400">{medium}</p>
        <p className="text-xs text-gray-400">Ciudades con precisión <span className="text-amber-400">MEDIA</span> (45-54%)</p>
      </div>
      <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-4 text-center">
        <p className="text-2xl font-bold text-red-400">{low}</p>
        <p className="text-xs text-gray-400">Ciudades con precisión <span className="text-red-400">BAJA</span> (&lt;45%)</p>
      </div>
      <div className="sm:col-span-3 rounded-xl bg-slate-800/30 p-3 text-xs text-gray-400 text-center">
        <span className="text-emerald-400 font-medium">🏆 Mejor: {best.ciudad}</span>
        <span className="mx-2">·</span>
        <span className={`font-medium ${bestConf.color}`}>{best.exito_pct}% acierto estimado</span>
        <span className="mx-2">·</span>
        <span className="text-red-400 font-medium">⚠️ Peor: {worst.ciudad}</span>
        <span className="mx-2">·</span>
        <span className={`font-medium ${worstConf.color}`}>{worst.exito_pct}% acierto estimado</span>
      </div>
    </div>
  )
}

interface HomeProps {
  initialAnalysis: DailyAnalysis | null
  initialMetrics: GlobalMetrics | null
  initialAvailableDates: string[]
  hindcastDays: number
}

export default function Home({ initialAnalysis, initialMetrics, initialAvailableDates, hindcastDays }: HomeProps) {
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(initialAnalysis)
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(initialMetrics)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<View>('executive')
  const [lastUpdated, setLastUpdated] = useState<string>(initialAnalysis ? `Auto ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : '')
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [availableDates, setAvailableDates] = useState<string[]>(initialAvailableDates)
  const [isHistorical, setIsHistorical] = useState(false)
  const [previousAnalysis, setPreviousAnalysis] = useState<DailyAnalysis | null>(null)
  const [previousMetrics, setPreviousMetrics] = useState<GlobalMetrics | null>(null)

  const getDefaultTargetDate = () => {
    const caracasOffset = -4 * 60 * 60000
    const nowCaracas = new Date(Date.now() + caracasOffset)
    nowCaracas.setDate(nowCaracas.getDate() + 1)
    return nowCaracas.toISOString().slice(0, 10)
  }

  useEffect(() => {
    const init = async () => {
      const targetDate = getDefaultTargetDate()
      setSelectedDate(targetDate)

      // Lanzar las 3 llamadas independientes en PARALELO (no secuencial)
      const [metricsResult, datesResult, forecastResult] = await Promise.all([
        fetch('/api/metrics').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/forecast-history?action=dates').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/forecast-history?fecha=${targetDate}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ])

      // Procesar métricas
      if (metricsResult && metricsResult.overall_mae !== undefined) {
        setMetrics(metricsResult)
      }

      // Procesar fechas disponibles
      const dates: string[] = datesResult?.dates ?? []
      setAvailableDates(dates)

      // Procesar pronóstico cargado
      if (forecastResult && forecastResult.cities) {
        setAnalysis(forecastResult)
        setIsHistorical(true)
        setLastUpdated(`Cargado: ${new Date(forecastResult.fecha).toLocaleDateString('en-CA', { timeZone: 'America/Caracas' })} (cron 10PM)`)

        // Buscar día anterior SIN re-fetch de dates (ya lo tenemos)
        const sortedDates = [...dates].sort().reverse()
        const currentIdx = sortedDates.indexOf(forecastResult.fecha_objetivo)
        if (currentIdx >= 0 && currentIdx < sortedDates.length - 1) {
          const prevDate = sortedDates[currentIdx + 1]
          const [prevData, prevMetrics] = await Promise.all([
            fetch(`/api/forecast-history?fecha=${prevDate}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/metrics?fecha=${prevDate}`).then(r => r.ok ? r.json() : null).catch(() => null),
          ])
          if (prevData && prevData.cities) setPreviousAnalysis(prevData)
          if (prevMetrics && prevMetrics.overall_mae !== undefined) setPreviousMetrics(prevMetrics)
        }
      }
    }
    init()
  }, [])

  async function fetchAvailableDates(): Promise<string[]> {
    try {
      const resp = await fetch('/api/forecast-history?action=dates')
      if (resp.ok) {
        const data = await resp.json()
        const dates = data.dates ?? []
        setAvailableDates(dates)
        return dates
      }
    } catch { /* silent */ }
    return []
  }

  async function fetchMetrics() {
    try {
      const resp = await fetch('/api/metrics')
      if (resp.ok) {
        const data = await resp.json()
        if (data && data.overall_mae !== undefined) setMetrics(data)
      }
    } catch { /* silent */ }
  }

  const runAnalysis = useCallback(async (fecha?: string) => {
    setLoading(true)
    setError(null)
    try {
      const targetDate = fecha || selectedDate || getDefaultTargetDate()
      const resp = await fetch(`/api/forecast?fecha=${targetDate}`, { method: 'POST' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data: DailyAnalysis = await resp.json()
      setAnalysis(data)
      setIsHistorical(false)
      setSelectedDate(data.fecha_objetivo)
      setLastUpdated(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
    // Cargar metrics, dates y día anterior en background (no bloquea el botón)
    const dates = await fetchAvailableDates()
    fetchMetrics()
    const sortedDates = [...dates].sort().reverse()
    const targetDate = fecha || selectedDate || getDefaultTargetDate()
    const idx = sortedDates.indexOf(targetDate)
    if (idx >= 0 && idx < sortedDates.length - 1) {
      const prevDate = sortedDates[idx + 1]
      Promise.all([
        fetch(`/api/forecast-history?fecha=${prevDate}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/metrics?fecha=${prevDate}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]).then(([prevData, prevMetrics]) => {
        if (prevData && prevData.cities) setPreviousAnalysis(prevData)
        if (prevMetrics && prevMetrics.overall_mae !== undefined) setPreviousMetrics(prevMetrics)
      })
    }
  }, [selectedDate])

  const loadHistoricalDate = useCallback(async (fecha: string) => {
    setLoading(true)
    setError(null)
    setSelectedDate(fecha)
    try {
      const resp = await fetch(`/api/forecast-history?fecha=${fecha}`)
      if (resp.ok) {
        const data: DailyAnalysis = await resp.json()
        setAnalysis(data)
        setIsHistorical(true)
        setLastUpdated(`Historial: ${data.fecha_objetivo}`)
      } else if (resp.status === 404) {
        setAnalysis(null)
        setError(`No hay pronóstico guardado para ${fecha}. Ejecuta el análisis.`)
        setIsHistorical(false)
      } else {
        throw new Error(`HTTP ${resp.status}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const now = new Date()
  const caracasTime = now.toLocaleTimeString('es-ES', {
    timeZone: 'America/Caracas',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  // Tabs agrupados lógicamente: Operación → Análisis → Avanzado
  const views: { key: View; label: string; icon: string; desc: string; group?: string }[] = [
    { key: 'executive', label: 'Resumen', icon: '🎯', desc: 'Recomendaciones del día', group: 'op' },
    { key: 'dashboard', label: 'Dashboard', icon: '🏠', desc: 'Vista general por ciudad', group: 'op' },
    { key: 'table', label: 'Tabla', icon: '📊', desc: 'Datos completos', group: 'op' },
    { key: 'signals', label: 'Señales', icon: '📡', desc: 'Datos para cobertura', group: 'an' },
    { key: 'metrics', label: 'Precisión', icon: '📈', desc: 'Métricas históricas', group: 'an' },
    { key: 'comparison', label: 'Comparación', icon: '📉', desc: 'Pronóstico vs Real', group: 'an' },
    { key: 'backtest', label: 'Backtest', icon: '⏳', desc: '90 días históricos', group: 'an' },
    { key: 'arbitrage', label: 'Arbitraje', icon: '🔍', desc: 'Alertas de ineficiencia', group: 'an' },
    { key: 'architecture', label: 'Arquitectura', icon: '🏗️', desc: 'Pipeline del sistema', group: 'av' },
    { key: 'coverage', label: 'Cobertura SI/NO', icon: '🛡️', desc: 'YES+NO pairs', group: 'av' },
    { key: 'mejora-continua', label: 'Mejora Continua', icon: '🔬', desc: 'Modelos actuales vs mejoras', group: 'av' },
    { key: 'backtest-si', label: 'Backtest SI', icon: '🎲', desc: 'Simular apuestas SI', group: 'av' },
    { key: 'performance', label: 'Performance', icon: '📈', desc: 'Precisión 10PM/11PM vs Real', group: 'av' },
    { key: 'ladder', label: 'Ladder Betting', icon: '🪜', desc: 'Escalera Kelly vs Polymarket', group: 'av' },
    { key: 'rivales', label: 'VS RIVALES', icon: '⚔️', desc: 'Nuestro vs modelos vs REAL', group: 'av' },
    { key: 'wallet', label: 'POLYMARKET x WALLET', icon: 'PM', desc: 'The World\'s Largest Prediction Market', group: 'ex' },
    { key: 'decision', label: 'TOMAR DECISIÓN', icon: '🎯', desc: 'MC vs KALMAN completo para apostar', group: 'av' },
  ]

  return (
    <Layout lastUpdated={lastUpdated}>
      {/* Controls */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => runAnalysis()}
            disabled={loading}
            className="btn-primary flex items-center gap-2 text-sm px-5 py-2.5"
          >
            {loading ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                Analizando 10 ciudades...
              </>
            ) : (
              <>
                <span>🚀</span>
                {analysis ? 'Actualizar' : 'Ejecutar'}
              </>
            )}
          </button>
          {analysis && analysis.cities.length > 0 && (
            <span className="text-xs text-gray-500">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1"></span>
              {analysis.cities.length} ciudades · {analysis.recommendations.length} recom. · ${analysis.total_allocated.toFixed(2)} asignados
            </span>
          )}
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={e => loadHistoricalDate(e.target.value)}
            className="rounded-lg bg-slate-800 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          {availableDates.length > 0 && (
            <select
              value={selectedDate}
              onChange={e => loadHistoricalDate(e.target.value)}
              className="rounded-lg bg-slate-800 border border-gray-600 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 max-w-[140px]"
            >
              {availableDates.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          {isHistorical && (
            <button
              onClick={() => { setSelectedDate(getDefaultTargetDate()); runAnalysis() }}
              className="rounded-lg bg-blue-600/20 border border-blue-500/30 px-3 py-2 text-xs text-blue-400 hover:bg-blue-600/30 transition"
            >
              ↻ Hoy
            </button>
          )}
        </div>

        {/* View switcher — scroll horizontal en mobile, wrap en desktop */}
        <nav className="-mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="relative">
            <div className="flex gap-1 overflow-x-auto rounded-lg bg-slate-800 p-1 sm:flex-wrap snap-x snap-mandatory scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {views.map(v => (
                <button
                  key={v.key}
                  onClick={() => setActiveView(v.key)}
                  className={`flex-shrink-0 rounded-md px-3 py-2 text-xs font-medium transition whitespace-nowrap snap-start min-h-[36px] ${
                    activeView === v.key
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                      : 'text-gray-400 hover:text-gray-200 active:bg-slate-700'
                  }`}
                  title={v.desc}
                >
                  {v.icon} {v.label}
                </button>
              ))}
            </div>
            {/* Mobile scroll indicators */}
            <div className="sm:hidden flex justify-between px-1 mt-1">
              <span className="text-[9px] text-gray-600">← desliza →</span>
              <span className="text-[9px] text-gray-600">{views.findIndex(v => v.key === activeView) + 1}/{views.length}</span>
            </div>
          </div>
        </nav>
      </div>

      {/* Target Date Banner */}
      {analysis?.fecha_objetivo && (
        <TargetDateBanner fechaObjetivo={analysis.fecha_objetivo} caracasTime={caracasTime} isHistorical={isHistorical} />
      )}
      {isHistorical && (
        <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-sm text-amber-400 flex items-center gap-2">
          <span>📖</span>
          <span>Viendo pronóstico histórico del {analysis?.fecha_objetivo}. Los datos de nowcasting y precios pueden no reflejar el estado en tiempo real.</span>
        </div>
      )}

      {/* Improvements Legend */}
      <ImprovementLegend />

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-400">
          <p className="font-medium">⚠️ Error en el análisis</p>
          <p className="text-xs mt-1 text-red-300">{error}</p>
        </div>
      )}

      {/* No data state */}
      {!analysis && !loading && !error && (
        <div className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-gray-700/30 py-16 px-6 text-center">
          <div className="mb-4 text-6xl">🌤️</div>
          <h2 className="mb-2 text-2xl font-bold text-white">Forecast Market · Asia</h2>
          <p className="mb-2 text-gray-400 max-w-lg mx-auto">
            Pronóstico de temperatura máxima para <span className="font-semibold text-blue-400">{getDefaultTargetDate()}</span> en 10 ciudades asiáticas
          </p>
          <p className="mb-6 text-sm text-gray-500 max-w-md mx-auto">
            Ejecuta el análisis a las 22:00 hora Caracas. El sistema compara la temperatura máxima pronosticada por 6 modelos meteorológicos contra los precios de cierre en Polymarket, identificando ineficiencias y calculando la asignación óptima vía Kelly.
          </p>
          <button onClick={() => runAnalysis()} className="btn-primary text-base px-8 py-3">
            🚀 Comenzar Análisis
          </button>
          <div className="mt-6 flex justify-center gap-6 text-xs text-gray-600 flex-wrap">
            <span>7 modelos (ECMWF ENS 51)</span>
            <span>·</span>
            <span>Empirical CDF</span>
            <span>·</span>
            <span>Isotonic PAVA</span>
            <span>·</span>
            <span>EWMA + Z-score</span>
            <span>·</span>
            <span>Walk-Forward</span>
          </div>
        </div>
      )}

      {/* Dashboard View */}
      {activeView === 'dashboard' && analysis && (
        <div className="space-y-6">
          {/* City Success Summary */}
          <CitySuccessSummary cities={analysis.cities} />

          {/* 10PM Caracas Forecast Banner — reference value */}
          {analysis.cities.length > 0 && (
            <details open className="group rounded-2xl bg-gradient-to-br from-slate-900 via-blue-900/20 to-slate-900 border border-blue-500/20 overflow-hidden">
              <summary className="cursor-pointer p-4 sm:p-6 text-center hover:bg-blue-500/5 transition list-none">
                <p className="text-xs text-blue-300 font-semibold tracking-wider mb-2">🌙 VALOR DE REFERENCIA · PRONÓSTICO 10PM CARACAS</p>
                <div className="flex items-baseline justify-center gap-4 mb-1 flex-wrap">
                  <span className="text-6xl sm:text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-blue-300 to-cyan-300">
                    {(analysis.cities.reduce((s, c) => s + c.forecast.temp_corregida, 0) / analysis.cities.length).toFixed(1)}°C
                  </span>
                  <span className="text-sm text-gray-500">promedio {analysis.cities.length} ciudades</span>
                </div>
                <div className="flex justify-center gap-6 text-xs text-gray-500">
                  <span>📡 {analysis.cities.filter(c => c.nowcast?.activo).length}/{analysis.cities.length} nowcast activo</span>
                  <span>🎯 Meta: ±1°C &gt;55%</span>
                </div>
                <p className="text-[10px] text-gray-600 mt-2 group-open:hidden">click para ver detalle por ciudad</p>
              </summary>
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 divide-x divide-blue-500/10 border-t border-blue-500/10">
                {analysis.cities.sort((a, b) => b.exito_pct - a.exito_pct).map(city => (
                  <div key={city.slug} className="p-3 text-center hover:bg-blue-500/5 transition">
                    <p className="text-[10px] text-gray-500 truncate">{city.ciudad.split(',')[0]}</p>
                    <p className="text-lg sm:text-xl font-bold text-emerald-400">{city.forecast.temp_corregida.toFixed(1)}°C</p>
                    {city.forecast.modelo_activo && (
                      <p className={`text-[8px] font-bold mt-0.5 ${city.forecast.modelo_activo === 'KALMAN' ? 'text-cyan-400' : 'text-emerald-400'}`}>
                        {getModeloNombre(city.slug, city.forecast.modelo_activo)}
                      </p>
                    )}
                    <p className="text-[9px] text-gray-600">{city.exito_pct}% acierto</p>
                    <p className="text-[8px] text-blue-400 mt-0.5">corrección: {city.forecast.sesgo_aplicado > 0 ? '+' : ''}{city.forecast.sesgo_aplicado.toFixed(1)}°C</p>
                    <p className="text-[7px] text-gray-600">{Object.keys(city.forecast.ensemble_raw ?? {}).length} modelos · {city.forecast.consenso}</p>
                  </div>
                ))}
              </div>
              {hindcastDays > 0 && (
                <div className="px-4 py-2 text-[10px] text-emerald-400 border-t border-blue-500/10 text-center">
                  ✅ {hindcastDays} días de hindcast cargados automáticamente para precisión y comparación
                </div>
              )}
            </details>
          )}

          {/* City Cards Grid — colapsable */}
          <details open>
            <summary className="cursor-pointer text-sm font-medium text-white hover:text-blue-300 transition mb-3 flex items-center gap-2">
              <span>🏙️</span>
              <span>Detalle por Ciudad</span>
              <span className="text-xs text-gray-500">({analysis.cities.length} ciudades)</span>
              <span className="ml-auto text-xs text-gray-600">click para colapsar</span>
            </summary>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {analysis.cities.sort((a, b) => b.exito_pct - a.exito_pct).map(city => (
                <CityCard key={city.slug} data={city} />
              ))}
            </div>
          </details>

          {/* Model legend — colapsable */}
          <details className="rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-gray-400 hover:text-gray-200 transition list-none">
              🧠 Modelo base del pronóstico por ciudad (click para expandir)
            </summary>
            <div className="px-4 pb-3 text-xs text-gray-400 flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block rounded-md bg-cyan-500/15 border border-cyan-400/30 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">Kalman 1D</span>
                Corrección adaptativa 1D (gana en Seúl, Beijing, Shanghái, HK, Shenzhen, Singapur)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block rounded-md bg-emerald-500/15 border border-emerald-400/30 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">St·Adapt / Combinado</span>
                Mejora Continua (gana en Tokio, Wuhan, Chongqing, Chengdu)
              </span>
            </div>
          </details>

          {/* Allocation */}
          <AllocationPanel
            recommendations={analysis.recommendations}
            totalAllocated={analysis.total_allocated}
          />
        </div>
      )}

      {/* Table View */}
      {activeView === 'table' && analysis && <ForecastTable data={analysis} />}

      {/* Executive Summary View */}
      {activeView === 'executive' && (
        <ExecutiveSummaryPanel
          analysis={analysis}
          metrics={metrics}
          previousAnalysis={previousAnalysis}
          previousMetrics={previousMetrics}
        />
      )}

      {/* Signals View */}
      {activeView === 'signals' && <SignalsPanel />}

      {/* Metrics View - Per city with backtesting data */}
      {activeView === 'metrics' && <MetricsChart />}

      {/* Comparison View - Forecast vs Actual per city */}
      {activeView === 'comparison' && (
        <div className="space-y-6">
          <ForecastVsActualChart metrics={metrics} currentForecasts={analysis.cities} fechaObjetivo={analysis.fecha_objetivo} />
          <details className="rounded-xl bg-slate-800/50 border border-gray-700/30 overflow-hidden">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-blue-400 hover:text-blue-300 transition flex items-center gap-2">
              <span>📋</span>
              Ver comparación clásica por ciudad (30 días)
              <span className="ml-auto text-xs text-gray-500">(click para expandir)</span>
            </summary>
            <div className="p-4 pt-2">
              <ComparisonPanel />
            </div>
          </details>
        </div>
      )}

      {/* Backtest View */}
      {activeView === 'backtest' && <BacktestChart />}

      {/* Arbitrage View */}
      {activeView === 'arbitrage' && <ArbitragePanel />}

      {/* Cobertura SI/NO View */}
      {activeView === 'coverage' && <CoberturaSiNo />}

      {/* Mejora Continua View */}
      {activeView === 'mejora-continua' && <MejoraContinua />}

      {/* Backtest SI View */}
      {activeView === 'backtest-si' && <BacktestSi />}

      {/* Análisis Performance View */}
      {activeView === 'performance' && <PerformanceAnalisis />}

      {/* Ladder Betting View */}
      {activeView === 'ladder' && <LadderBetting />}

      {/* VS RIVALES View */}
      {activeView === 'rivales' && <VsRivales />}
      {/* Polymarket Wallet Analysis View */}
      {activeView === 'wallet' && <WalletAnalysis />}

      {/* TOMAR DECISIÓN View */}
      {activeView === 'decision' && <TomarDecision />}

      {/* System Architecture View */}
      {activeView === 'architecture' && <Arquitectura />}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="card animate-pulse">
              <div className="mb-3 h-5 w-24 rounded bg-slate-700"></div>
              <div className="mb-3 h-16 rounded bg-slate-700"></div>
              <div className="mb-2 h-3 w-full rounded bg-slate-700"></div>
              <div className="h-3 w-3/4 rounded bg-slate-700"></div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  )
}

