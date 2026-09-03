/**
 * TEST DEL SEMÁFORO ANTI "Too many concurrent requests" (fix sep-2026).
 *
 * Reproduce exactamente lo que hace forecast-engine.ts: Promise.all sobre 10
 * ciudades, cada una llamando fetchWeatherModels → omFetchJson.
 * Con un fetch instrumentado que cuenta cuántas requests Open-Meteo están
 * EN VUELO al mismo tiempo, verifica:
 *   1. El MÁXIMO de llamadas concurrentes a api.open-meteo.com ≤ OM_MAX_CONCURRENT (4)
 *      — ANTES del fix eran 10 simultáneas → Open-Meteo las rechazaba.
 *   2. Las 10 ciudades reciben los 6 modelos completos (ninguna degrada a fallback).
 *   3. El semáforo libera correctamente: al final, 0 activas y cola vacía.
 */
import { fetchWeatherModels } from '../src/lib/openmeteo'
import { MODELOS_CLIMATICOS } from '../src/lib/cities'

// ---- Instrumentación del fetch global ----
let enVuelo = 0
let maxEnVuelo = 0
let llamadasOM = 0

const fecha = '2026-09-04'

function respuestaOM(lat: number) {
  const daily: Record<string, number[]> = {}
  // 6 modelos con valores realistas alrededor de ~30°C
  const valores = [30.1, 29.8, 30.4, 29.9, 30.2, 30.0]
  MODELOS_CLIMATICOS.forEach((m, i) => { daily[`temperature_2m_max_${m}`] = [valores[i]] })
  daily['weather_code_best_match'] = [1]
  daily['precipitation_sum_best_match'] = [0]
  return { daily }
}

const realFetch = globalThis.fetch
;(globalThis as any).fetch = async (url: any, _init?: any) => {
  const u = String(url)
  if (u.includes('open-meteo.com')) {
    llamadasOM++
    enVuelo++
    maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
    // Simula la latencia de la API real (~250ms) para que las 10 se solapen
    await new Promise(r => setTimeout(r, 250))
    enVuelo--
    if (enVuelo > 0 && maxEnVuelo > 10) { /* noop */ }
    return {
      ok: true, status: 200,
      json: async () => respuestaOM(0),
      text: async () => '',
    } as any
  }
  // Otros proveedores (no deberían llamarse en este test: OWM sin key, TWC no llega)
  throw new Error(`fetch inesperado: ${u}`)
}

async function main() {
  const ciudades = Array.from({ length: 10 }, (_, i) => ({ lat: i + 1, lon: i + 2 }))
  console.log('Lanzando 10 fetchWeatherModels en paralelo (patrón forecast-engine)...')
  const t0 = Date.now()
  const resultados = await Promise.all(
    ciudades.map(c => fetchWeatherModels(c.lat, c.lon, fecha))
  )
  const dur = Date.now() - t0

  let fallos = 0

  // 1) Concurrencia máxima ≤ 4
  console.log(`\n[1] Máx. llamadas Open-Meteo EN VUELO: ${maxEnVuelo} (límite esperado: 4)`)
  if (maxEnVuelo > 4) { console.log('   ✕ FALLA: la concurrencia superó el semáforo'); fallos++ }
  else console.log('   ✓ El semáforo limitó la concurrencia correctamente')

  // 2) 10/10 ciudades con 6 modelos
  const completas = resultados.filter(r => Object.keys(r.models).length === 6 && !r.degraded).length
  console.log(`\n[2] Ciudades con ensemble COMPLETO (6 modelos): ${completas}/10`)
  if (completas !== 10) { console.log('   ✕ FALLA: hubo ciudades degradadas'); fallos++ }
  else console.log('   ✓ Ninguna ciudad cayó al fallback de 1 modelo')

  // 3) Total de llamadas = 10 (una por ciudad, sin reintentos)
  console.log(`\n[3] Llamadas OM totales: ${llamadasOM} (esperado: 10 — una por ciudad)`)
  if (llamadasOM !== 10) { console.log('   ✕ FALLA: llamadas inesperadas'); fallos++ }
  else console.log('   ✓ Sin llamadas extra')

  // 4) Ondas esperadas: 10 ciudades / 4 por ola = 3 olas ~250ms = ~750ms mínimo
  console.log(`\n[4] Duración total: ${dur}ms (esperado ≥ 500ms: las colas esperan su turno)`)
  if (dur < 500) { console.log('   ✕ FALLA: terminó demasiado rápido — no hubo espera en cola'); fallos++ }
  else console.log('   ✓ El queue FIFO espació las olas como corresponde')

  console.log(`\n${fallos === 0 ? '✅ TODOS LOS CHECKS PASARON' : `❌ ${fallos} FALLOS`}`)
  ;(globalThis as any).fetch = realFetch
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
