/**
 * TEST 2 DEL FIX: reintento cuando Open-Meteo devuelve
 *   {"error":true,"reason":"Too many concurrent requests"}
 * — que llega como HTTP 400 (no 429). ANTES del fix, un 400 se trataba como
 * error PERMANENTE (no reintenta) y la ciudad degradaba al fallback OWM/TWC
 * de 1 modelo → "pocos modelos". AHORA se reintenta con backoff.
 */
import { fetchWeatherModels } from '../src/lib/openmeteo'
import { MODELOS_CLIMATICOS } from '../src/lib/cities'

let intentosOM = 0
let enVuelo = 0
let maxEnVuelo = 0

function respuestaOM() {
  const daily: Record<string, number[]> = {}
  const valores = [30.1, 29.8, 30.4, 29.9, 30.2, 30.0]
  MODELOS_CLIMATICOS.forEach((m, i) => { daily[`temperature_2m_max_${m}`] = [valores[i]] })
  daily['weather_code_best_match'] = [1]
  daily['precipitation_sum_best_mask'] = [0]
  daily['precipitation_sum_best_match'] = [0]
  return { daily }
}

const realFetch = globalThis.fetch
;(globalThis as any).fetch = async (url: any) => {
  const u = String(url)
  if (!u.includes('open-meteo.com')) throw new Error(`fetch inesperado: ${u}`)
  intentosOM++
  enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
  await new Promise(r => setTimeout(r, 60))
  // Rechazo de concurrencia como lo manda Open-Meteo: HTTP 400 con body JSON
  // (los primeros 2 intentos fallan; el 3.º debe triunfar — omFetchJson hace
  // 3 intentos totales: 1 original + 2 reintentos)
  if (intentosOM <= 2) {
    enVuelo--
    return {
      ok: false, status: 400,
      json: async () => ({ error: true, reason: 'Too many concurrent requests' }),
      text: async () => '{"error":true,"reason":"Too many concurrent requests"}',
    } as any
  }
  enVuelo--
  return { ok: true, status: 200, json: async () => respuestaOM(), text: async () => '' } as any
}

async function main() {
  console.log('Simulando 1 ciudad: primeros 2 intentos → HTTP 400 "Too many concurrent requests", 3.º exitoso...')
  const r = await fetchWeatherModels(37.5, 127, '2026-09-04')
  let fallos = 0

  const modelos = Object.keys(r.models)
  console.log(`\n[1] Intentos OM realizados: ${intentosOM} (esperado: 3 — 2 rechazos + 1 exitoso))`)
  if (intentosOM !== 3) { console.log('   ✕ FALLA: no reintentó como se esperaba'); fallos++ }
  else console.log('   ✓ El 400 con "Too many concurrent" SÍ se reintenta ahora')

  console.log(`\n[2] Modelos devueltos: ${modelos.length} (esperado 6), degraded=${r.degraded ?? false}`)
  if (modelos.length !== 6 || r.degraded) { console.log('   ✕ FALLA: cayó al fallback'); fallos++ }
  else console.log('   ✓ La ciudad NO degradó — ensemble completo tras vencer el rechazo')

  console.log(`\n${fallos === 0 ? '✅ REINTENTO 400-TOO-MANY-CONCURRENT: OK' : `❌ ${fallos} FALLOS`}`)
  ;(globalThis as any).fetch = realFetch
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
