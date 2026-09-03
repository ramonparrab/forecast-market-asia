/**
 * TEST de la lógica de slots dobles del cron (src/lib/cron-slot.ts).
 *
 * Escenario que MOTIVÓ el cambio: el cron de 10:30PM (02:30 UTC) se retrasa
 * más de 30 min → cruza a la hora 23 Caracas → con la lógica vieja (reloj) se
 * etiquetaba '11PM' y CONTAMINABA el registro final de la noche. Con la
 * etiqueta por SCHEDULE (header x-vercel-cron-schedule) eso es imposible.
 */
import { slotFromSchedule, resolveRunLabel, resolveFechaObjetivo } from '../src/lib/cron-slot'

let fallos = 0
function check(desc: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fallos++; console.log(`  ✕ ${desc}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
  else console.log(`  ✓ ${desc}`)
}

console.log('── 1. slotFromSchedule: los 4 schedules del proyecto ──')
check('"0 2 * * *" (10:00PM) → 10PM', slotFromSchedule('0 2 * * *'), '10PM')
check('"30 2 * * *" (10:30PM) → 10PM', slotFromSchedule('30 2 * * *'), '10PM')
check('"0 3 * * *" (11:00PM) → 11PM', slotFromSchedule('0 3 * * *'), '11PM')
check('"30 3 * * *" (11:30PM) → 11PM', slotFromSchedule('30 3 * * *'), '11PM')
check('path "/api/cron/daily" (no schedule) → null', slotFromSchedule('/api/cron/daily'), null)
check('schedule ajeno "15 14 * * 1" → null', slotFromSchedule('15 14 * * 1'), null)
check('vacío → null', slotFromSchedule(''), null)

console.log('\n── 2. resolveRunLabel: EL caso crítico (retraso que cruza la ventana) ──')
// 10:30PM dispara a las 23:05 Caracas (35 min tarde) — ANTES: '11PM' (bug)
const late1030 = resolveRunLabel({ schedHeader: '30 2 * * *', caracasHour: 23 })
check('10:30PM dispara 23:05 Caracas → sigue 10PM', late1030.label, '10PM')
check('  vía: cron-schedule', late1030.via, 'cron-schedule')

// 11:30PM dispara a las 00:10 Caracas (40 min tarde) — ANTES: '00:00' no legítima
const late1130 = resolveRunLabel({ schedHeader: '30 3 * * *', caracasHour: 0 })
check('11:30PM dispara 00:10 Caracas → sigue 11PM', late1130.label, '11PM')

console.log('\n── 3. resolveRunLabel: manual y fallback de reloj ──')
check('slot=10PM manual a las 23:50 → 10PM', resolveRunLabel({ slotParam: '10PM', caracasHour: 23 }).label, '10PM')
check('sin header, hora 22 → 10PM', resolveRunLabel({ caracasHour: 22 }).label, '10PM')
check('sin header, hora 23 → 11PM', resolveRunLabel({ caracasHour: 23 }).label, '11PM')
check('sin header, hora 01 (manual tardío) → 11PM', resolveRunLabel({ caracasHour: 1 }).label, '11PM')
check('sin header, hora 05 → 11PM (último límite nocturno)', resolveRunLabel({ caracasHour: 5 }).label, '11PM')
check('sin header, hora 06 (fin de ventana) → "06:00" no legítima', resolveRunLabel({ caracasHour: 6 }).label, '06:00')
check('sin header, hora 14 → "14:00" no legítima', resolveRunLabel({ caracasHour: 14 }).label, '14:00')

console.log('\n── 4. resolveFechaObjetivo ──')
// 2-sep 22:30 Caracas (10PM normal) → objetivo 3-sep
check('22:30 del 2-sep → 2026-09-03', resolveFechaObjetivo(22, Date.parse('2026-09-02T22:30:00Z')), '2026-09-03')
// 2-sep 23:30 (11PM normal) → 3-sep
check('23:30 del 2-sep → 2026-09-03', resolveFechaObjetivo(23, Date.parse('2026-09-02T23:30:00Z')), '2026-09-03')
// 3-sep 00:30 (11PM tardío) → 3-sep (HOY, no mañana)
check('00:30 del 3-sep → 2026-09-03 (hoy, no mañana)', resolveFechaObjetivo(0, Date.parse('2026-09-03T00:30:00Z')), '2026-09-03')
// 3-sep 04:50 → 3-sep
check('04:50 del 3-sep → 2026-09-03', resolveFechaObjetivo(4, Date.parse('2026-09-03T04:50:00Z')), '2026-09-03')
// 3-sep 05:59 → 3-sep; 06:00 ya es off-window
check('05:59 del 3-sep → 2026-09-03', resolveFechaObjetivo(5, Date.parse('2026-09-03T05:59:00Z')), '2026-09-03')
check('06:30 del 3-sep (off-window) → 2026-09-04', resolveFechaObjetivo(6, Date.parse('2026-09-03T06:30:00Z')), '2026-09-04')

console.log(`\n${fallos === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${fallos} FALLOS`}`)
process.exit(fallos === 0 ? 0 : 1)
