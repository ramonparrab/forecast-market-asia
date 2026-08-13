type Regimen = 'ESTABLE' | 'TRANSICION' | 'CRITICO'

interface RegimenDetalle {
  regimen: Regimen
  delta1: number | null
  tendencia: number | null
  motivo: string
  sd: number
  factorBankroll: number
}

function fmt(v: number | null): string {
  if (v === null) return '—'
  return `${v >= 0 ? '+' : ''}${Math.round(v * 100) / 100}`
}

/**
 * Detecta el régimen del pronóstico para una ciudad:
 * - CRITICO: salto de 1 día ≥ 2° Y tendencia de 2-3 días ≥ 3° (frente/régimen en curso) → NO APOSTAR
 * - TRANSICION: salto de 1 día ≥ 2° → apuesta con σ ampliada y mitad de bankroll
 * - ESTABLE: variación < 2° → juego completo
 * Los deltas se miden sobre temp_pronosticada (consenso crudo), que es la que
 * reacciona primero a los cambios de régimen.
 */
export function detectarRegimen(
  historial: { fecha_objetivo: string; temp_pronosticada: number | null }[],
  fechaHoy: string
): RegimenDetalle {
  const sorted = [...historial].sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))
  const idx = sorted.findIndex(r => r.fecha_objetivo === fechaHoy)
  if (idx < 0) {
    return {
      regimen: 'ESTABLE', delta1: null, tendencia: null,
      motivo: 'Sin historial suficiente para detectar régimen',
      sd: 0.85, factorBankroll: 1,
    }
  }

  const hoy = sorted[idx]
  const prev1 = idx > 0 ? sorted[idx - 1] : null
  const prevs = [prev1, idx > 1 ? sorted[idx - 2] : null, idx > 2 ? sorted[idx - 3] : null]
    .filter((r): r is { fecha_objetivo: string; temp_pronosticada: number | null } => !!r)

  let delta1: number | null = null
  let tendencia: number | null = null

  if (hoy.temp_pronosticada != null && prev1 && prev1.temp_pronosticada != null) {
    delta1 = hoy.temp_pronosticada - prev1.temp_pronosticada
  }
  const prevsValidos = prevs.filter(r => r.temp_pronosticada != null)
  if (hoy.temp_pronosticada != null && prevsValidos.length >= 2) {
    const media = prevsValidos.reduce((s, r) => s + (r.temp_pronosticada as number), 0) / prevsValidos.length
    tendencia = hoy.temp_pronosticada - media
  }

  const abs1 = Math.abs(delta1 ?? 0)
  const absT = Math.abs(tendencia ?? 0)

  if (abs1 >= 2 && absT >= 3) {
    return {
      regimen: 'CRITICO', delta1, tendencia,
      motivo: `Salto de 1 día ${fmt(delta1)}° y tendencia de ${fmt(tendencia)}° vs días previos — frente o cambio de régimen en curso. El sesgo histórico no es confiable.`,
      sd: 1.5, factorBankroll: 0,
    }
  }
  if (abs1 >= 2) {
    return {
      regimen: 'TRANSICION', delta1, tendencia,
      motivo: `Salto de ${fmt(delta1)}° vs día anterior — pronóstico en transición. Se amplía la incertidumbre (σ×1.5) y se reduce el bankroll a la mitad.`,
      sd: 1.25, factorBankroll: 0.5,
    }
  }
  return {
    regimen: 'ESTABLE', delta1, tendencia,
    motivo: `Variación de ${fmt(delta1)}° vs día anterior — régimen estable. El blend sesgo-corregido es confiable.`,
    sd: 0.85, factorBankroll: 1,
  }
}