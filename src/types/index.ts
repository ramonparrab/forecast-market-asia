export interface City {
  slug: string
  nombre: string
  lat: number
  lon: number
  estacion: string
}

export interface ModelTemps {
  [model: string]: number
}

export interface ForecastResult {
  temp_ponderada: number
  temp_corregida: number
  volatilidad: number
  consenso: string
  ensemble_raw: ModelTemps
  sesgo_aplicado: number
  ensemble_members?: number[]
}

export interface PolymarketContract {
  token_id: string
  texto: string
  tipo: 'exacto' | 'superior' | 'inferior' | 'rango'
  valor: number | [number, number]
  prob_mkt: number
  prob_ia_raw?: number
  prob_ia_norm?: number
  // Liquidity fields
  volume_24h?: number
  spread?: number
  liquidity?: 'ALTA' | 'MEDIA' | 'BAJA'
  ev?: number
}

export interface NowcastInfo {
  activo: boolean
  peso_observacion: number
  temp_observada: number | null
  estacion: string
  hora_local: number
}

export interface CityAnalysis {
  ciudad: string
  slug: string
  contratos: PolymarketContract[]
  forecast: ForecastResult
  arbitraje: { desvio: number; nivel: string }
  nowcast: NowcastInfo
  // Probabilidad de que el pronóstico acierte el bucket correcto (±2°C)
  exito_pct: number
  explicacion: string
  // Liquidity summary
  liquidity_avg?: 'ALTA' | 'MEDIA' | 'BAJA'
  volume_total?: number
  avg_spread?: number
}

export interface BetRecommendation {
  ciudad: string
  slug: string
  contrato: string
  tipo: string
  mkt_pct: number
  ia_pct: number
  edge: number
  ev_dollar: number
  temp_corregida: number
  consenso: string
  arbitraje: string
  monto: number
  peso: number
  status: string
  exito_pct?: number
  explicacion?: string
}

export interface DailyRun {
  id?: number
  fecha_ejecucion: string
  fecha_objetivo: string
  resultados: CityAnalysis[]
  recomendaciones: BetRecommendation[]
  total_asignado: number
  created_at?: string
}

export interface HistoricalRecord {
  id?: number
  fecha_ejecucion: string
  fecha_objetivo: string
  ciudad: string
  slug: string
  temp_pronosticada: number
  temp_corregida: number
  temp_real: number | null
  error: number | null
  modelos_usados: number
  consenso: string
  created_at?: string
}

export interface AccuracyMetrics {
  ciudad: string
  slug: string
  mae: number
  rmse: number
  bias: number
  muestras: number
}

export interface ForecastVsActual {
  fecha_objetivo: string
  ciudad: string
  slug: string
  temp_pronosticada: number
  temp_corregida: number
  temp_real: number
  error: number
}

export interface GlobalMetrics {
  overall_mae: number
  overall_rmse: number
  overall_bias: number
  brier_score: number
  total_muestras: number
  accuracy_pct: number
  por_ciudad: AccuracyMetrics[]
  evolucion_diaria: { fecha: string; mae: number; rmse: number }[]
  /** Backtest-derived metrics for comparison (more samples) */
  backtest?: {
    total_muestras: number
    overall_mae: number
    overall_rmse: number
    overall_bias: number
    accuracy_2c: number
    accuracy_1c: number
    total_dias: number
    por_ciudad: AccuracyMetrics[]
  }
}

export interface CityImprovement {
  slug: string
  ciudad: string
  mejora_mae_pct: number
  mejora_bias_pct: number
  accuracy_pct: number
  muestras: number
  tendencia: 'mejorando' | 'estable' | 'empeorando'
  impacto_proximo_pct: number
  descripcion_impacto: string
  ultima_mejora_fecha: string
  ultima_mejora_desc: string
}

export interface WalkForwardResult {
  method: string
  min_train_days: number
  test_window: number
  overall: {
    n_cities: number
    n_tests: number
    mae_f: number
    rmse_f: number
    bias_f: number
    within_2f_pct: number
    within_4f_pct: number
  }
  per_city: Record<string, {
    n_tests: number
    mae_f: number
    rmse_f: number
    bias_f: number
    within_2f_pct: number
  }>
}

export interface DailyAnalysis {
  fecha: string
  fecha_objetivo: string
  message: string
  cities: CityAnalysis[]
  recommendations: BetRecommendation[]
  total_allocated: number
  global_metrics: GlobalMetrics | null
  arbitrage_alerts: string[]
}
