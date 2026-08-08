export type TipoAlerta = 'FRENTE_FRIO' | 'FRENTE_CALUROSO' | 'NIEVE' | 'LLUVIA_FUERTE' | 'TORMENTA_SEVERA'

export interface AlertaClima {
  tipo: TipoAlerta
  icono: string
  titulo: string
  severidad: 'CRITICA' | 'ALTA' | 'MODERADA'
  descripcion: string
}

export interface DatosDia {
  tmax: number
  tmin: number
  precip: number
  prob: number
  wind: number
  code: number
}

const TORMENTA_SEVERA_CODES = new Set([96, 99])
const NIEVE_CODES = new Set([71, 73, 75, 77, 85, 86])
const LLUVIA_TORRENCIAL_CODES = new Set([82, 86, 95, 96, 99, 65, 67])
const AGUACERO_CODES = new Set([80, 81, 82])

export function detectarAlertas(hoy: DatosDia, prev1: DatosDia | null, prev2: DatosDia | null): AlertaClima[] {
  const alertas: AlertaClima[] = []
  if (!prev1 || !prev2) return alertas
  const promedioPrev = (prev1.tmax + prev2.tmax) / 2
  const delta = hoy.tmax - promedioPrev
  const hayPrecip = hoy.precip >= 1.5 || hoy.prob >= 35
  const hayViento = hoy.wind >= 30

  // 1) FRENTE FRÍO: caída drástica de máxima + precipitación o viento
  if (delta <= -3.2 && (hayPrecip || hayViento)) {
    const severidad: AlertaClima['severidad'] = delta <= -5.5 ? 'CRITICA' : delta <= -4.2 ? 'ALTA' : 'MODERADA'
    alertas.push({
      tipo: 'FRENTE_FRIO',
      icono: '🌬️',
      titulo: 'FRENTE FRÍO',
      severidad,
      descripcion: `Descenso de ~${Math.abs(delta).toFixed(1)}°C vs los 2 días previos. Máx ${hoy.tmax.toFixed(1)}°C / Mín ${hoy.tmin.toFixed(1)}°C. Lluvia ${hoy.precip.toFixed(1)}mm (${Math.round(hoy.prob)}%), viento ${Math.round(hoy.wind)} km/h. El pronóstico podría quedar por encima del real.`,
    })
  }

  // 2) FRENTE CALUROSO / OLA DE CALOR: subida drástica o extremo térmico
  if (delta >= 3.5 || hoy.tmax >= 38.5) {
    const severidad: AlertaClima['severidad'] = delta >= 5 || hoy.tmax >= 40 ? 'CRITICA' : delta >= 3.5 ? 'ALTA' : 'MODERADA'
    alertas.push({
      tipo: 'FRENTE_CALUROSO',
      icono: hoy.tmax >= 38.5 ? '🥵' : '🔥',
      titulo: 'FRENTE CALUROSO',
      severidad,
      descripcion: `Subida de +${delta.toFixed(1)}°C vs media de los 2 días previos. Máx ${hoy.tmax.toFixed(1)}°C / Mín ${hoy.tmin.toFixed(1)}°C. El entero podría quedar por encima del pronóstico.`,
    })
  }

  // 3) NIEVE: código de nieve (eventualmente con frío grave)
  if (NIEVE_CODES.has(hoy.code)) {
    alertas.push({
      tipo: 'NIEVE',
      icono: '🌨️',
      titulo: 'NIEVE',
      severidad: 'ALTA',
      descripcion: `Nevada pronosticada. Mín ${hoy.tmin.toFixed(1)}°C, máx ${hoy.tmax.toFixed(1)}°C. La nieve puede hundir la temperatura real (entero +2).`,
    })
  }

  // 4) LLUVIA FUERTE / TORMENTA SEVERA
  // Activadores: precipitación alta, tormenta severa, o aguacero con viento/prob alta
  const esAguaceroViento = AGUACERO_CODES.has(hoy.code) && (hoy.wind >= 35 || hoy.prob >= 75)
  const esTormenta = LLUVIA_TORRENCIAL_CODES.has(hoy.code)
  if (hoy.precip >= 15 || (hoy.precip >= 5 && hoy.prob >= 70) || esTormenta || esAguaceroViento) {
    const esTorrential = TORMENTA_SEVERA_CODES.has(hoy.code) || hoy.precip >= 45
    const severidad: AlertaClima['severidad'] =
      esTorrential || hoy.precip >= 30 || (esTorrential || hoy.wind >= 50) ? 'CRITICA'
      : hoy.precip >= 15 || esAguaceroViento ? 'ALTA' : 'MODERADA'
    alertas.push({
      tipo: esTorrential ? 'TORMENTA_SEVERA' : 'LLUVIA_FUERTE',
      icono: esTorrential ? '⛈️' : '🌧️',
      titulo: esTorrential ? 'TORMENTA SEVERA' : 'LLUVIA FUERTE',
      severidad,
      descripcion: `Precipitación ${hoy.precip.toFixed(0)}mm (${Math.round(hoy.prob)}% prob.), viento ${Math.round(hoy.wind)} km/h. La nubosidad y la lluvia frenan la máxima (entero debajo del pronóstico).`,
    })
  }

  return alertas
}