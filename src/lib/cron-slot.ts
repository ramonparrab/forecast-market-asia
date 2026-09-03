/**
 * Determinación del SLOT nocturno (10PM / 11PM Caracas) para el cron daily.
 *
 * Redundancia doble por slot (vercel.json, sep-2026):
 *   02:00 y 02:30 UTC → ambos registro '10PM'   (10:00 / 10:30 PM Caracas)
 *   03:00 y 03:30 UTC → ambos registro '11PM'   (11:00 / 11:30 PM Caracas)
 *
 * REGLA DE ORO — etiqueta por SCHEDULE, no por reloj: Vercel envía el header
 * x-vercel-cron-schedule con el schedule exacto que disparó la invocación.
 * El cron de Hobby dispara ~20-25 min tarde; sin esta regla, el disparo de
 * 02:30 UTC (10:30PM) que se retrase más de 30 min cruzaría a la hora 23
 * Caracas y se etiquetaría '11PM' — contaminando el registro final de la
 * noche. Con la regla, el slot queda anclado al schedule que lo disparó.
 */

export const CARACAS_OFFSET_MS = -4 * 60 * 60000

/** Map schedule cron ("30 2 * * *") → slot. Solo los 4 schedules del proyecto. */
export function slotFromSchedule(schedule: string): '10PM' | '11PM' | null {
  const parts = schedule.trim().split(/\s+/)
  const h = parseInt(parts[1] ?? '', 10)
  if (h === 2) return '10PM' // 02:00 / 02:30 UTC = 10:00 / 10:30 PM Caracas
  if (h === 3) return '11PM' // 03:00 / 03:30 UTC = 11:00 / 11:30 PM Caracas
  return null
}

export interface RunLabelResult {
  label: string
  via: 'cron-schedule' | 'manual-slot-param' | 'clock-fallback'
}

/**
 * Prioridad de etiqueta:
 *   1. ?slot=10PM|11PM (trigger manual explícito)
 *   2. header x-vercel-cron-schedule (disparo automático de Vercel)
 *   3. hora de reloj Caracas: 22→10PM; 23 y 00-05→11PM (ventana tardía de
 *      recuperación); 06-21→"HH:00" (no legítima, solo forecast_history)
 */
export function resolveRunLabel(opts: {
  schedHeader?: string
  slotParam?: string
  caracasHour: number
}): RunLabelResult {
  const slotParam = (opts.slotParam ?? '').trim()
  if (slotParam === '10PM' || slotParam === '11PM') {
    return { label: slotParam, via: 'manual-slot-param' }
  }
  const fromHeader = opts.schedHeader ? slotFromSchedule(opts.schedHeader) : null
  if (fromHeader) return { label: fromHeader, via: 'cron-schedule' }

  const h = opts.caracasHour
  if (h === 22) return { label: '10PM', via: 'clock-fallback' }
  if (h === 23 || (h >= 0 && h <= 5)) return { label: '11PM', via: 'clock-fallback' }
  return { label: `${String(h).padStart(2, '0')}:00`, via: 'clock-fallback' }
}

/**
 * Día asiático objetivo (fecha_objetivo) según la hora Caracas de la corrida:
 *   22-23h → mañana Caracas (D+1 asiático) — corrida nocturna normal
 *   00-05h → HOY Caracas — corrida tardía de recuperación: el día asiático
 *            ya comenzó y su mercado aún no resuelve (16:00Z)
 *   06-21h → mañana (manual off-window; etiqueta no legítima igualmente)
 */
export function resolveFechaObjetivo(caracasHour: number, nowCaracasMs: number): string {
  const target = caracasHour >= 22 || caracasHour < 6
    ? caracasHour >= 22
      ? new Date(nowCaracasMs + 24 * 3600 * 1000) // 22-23h → mañana
      : new Date(nowCaracasMs)                    // 00-05h → hoy
    : new Date(nowCaracasMs + 24 * 3600 * 1000)   // 06-21h → mañana
  return target.toISOString().slice(0, 10)
}
