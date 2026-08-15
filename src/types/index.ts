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

export interface WeatherCondition {
  code: number
  precipitation: number
  label: string
  icon: string
  severity: 'none' | 'low' | 'moderate' | 'severe'
}

export interface ForecastResult {
  temp_ponderada: number
  temp_corregida: number
  volatilidad: number
  consenso: string
  ensemble_raw: ModelTemps
  sesgo_aplicado: number
  ensemble_members?: number[]
  weather?: WeatherCondition
  /** Modelo ganador aplicado en vivo: 'MEJORA CONTINUA' | 'KALMAN' */
  modelo_activo?: 'MEJORA CONTINUA' | 'KALMAN'
  /** Sesgo extra aplicado por el modelo ganador (temp_corregida - base) */
  sesgo_modelo?: number
  /** Muestras usadas por el modelo ganador para calibrarse */
  modelo_muestras?: number
  /** Base del ensemble (sin el ajuste del modelo ganador), se persiste en forecast_history */
  temp_corregida_base?: number
  /** Temperatura corregida por el modelo PERDEDOR (para comparación estable en backtest) */
  temp_corregida_alt?: number
  /** Modelo perdedor: el que NO fue seleccionado */
  modelo_alt?: 'MEJORA CONTINUA' | 'KALMAN'
  /** Sesgo del modelo perdedor */
  sesgo_alt?: number
  /** Seoul usa ICON crudo como base en vez del ensemble ponderado */
  icon_base?: boolean
}

export interface PolymarketContract {
  token_id: string
  texto: string
  tipo: 'exacto' | 'superior' | 'inferior' | 'rango'
  valor: number | [number, number]
  prob_mkt: number
  prob_ia_raw?: number
  prob_ia_norm?: number
  // Precios SI/NO crudos de Polymarket (pct)
  si_pct?: number
  no_pct?: number
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
  // Probability of forecast being within ±1°C of actual (the ONLY metric that matters for betting)
  exito_pct: number
  // Polymarket integer-round precision (forecast rounded to integer, matching Polymarket resolution)
  exito_pct_integer: number
  explicacion: string
  // Liquidity summary
  liquidity_avg?: 'ALTA' | 'MEDIA' | 'BAJA'
  volume_total?: number
  avg_spread?: number
  // Real accuracy data
  totalRecords?: number
  avgError?: number
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
  exito_pct_integer?: number
  explicacion?: string
}

export interface DailyRun {
  id?: number
  fecha_ejecucion: string
  fecha_objetivo: string
  resultados: CityAnalysis[]
  recomendaciones: BetRecommendation[]
  total_asignado: number
  /** '10PM' o '11PM' — hora de la corrida en Caracas */
  run_type?: '10PM' | '11PM'
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
  /** '10PM' o '11PM' — hora de la corrida en Caracas */
  run_type?: string
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
  historicalErrors: Record<string, number[]>
}

/** Pronóstico ganador bloqueado por día (tabla forecast_snapshot) */
export interface ForecastSnapshot {
  id?: number
  fecha_objetivo: string
  slug: string
  ciudad: string
  run_type_ganadora: '10PM' | '11PM'
  modelo_ganador: string
  temp_pronosticada: number | null
  temp_corregida: number | null
  temp_ponderada: number | null
  consenso: string | null
  modelos_usados: number
  temp_10pm: number | null
  temp_11pm: number | null
  modelo_10pm: string | null
  modelo_11pm: string | null
  temp_real: number | null
  error: number | null
  created_at?: string
  updated_at?: string
}
