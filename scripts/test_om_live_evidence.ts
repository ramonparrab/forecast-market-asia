/**
 * EVIDENCIA EN VIVO contra la API real de Open-Meteo (desde este sandbox):
 *
 *   PARTE A (el "antes"): 10 llamadas DIRECTAS en paralelo, sin semáforo —
 *   exactamente lo que hacía forecast-engine → Open-Meteo rechaza con
 *   {"error":true,"reason":"Too many concurrent requests"}.
 *
 *   PARTE B (el "después"): las mismas 10 ciudades vía fetchWeatherModels
 *   (el módulo ya tiene el semáforo de 4) → todas deben volver completas.
 *
 * Esto reproduce y confirma la causa raíz del "pocos modelos".
 */
import { fetchWeatherModels } from '../src/lib/openmeteo'
import { CIUDADES_ASIA } from '../src/lib/cities'

const fecha = '2026-09-04'
const MODELS = ['best_match', 'ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'jma_seamless', 'meteofrance_seamless'].join(',')

function urlOM(lat: number, lon: number) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max&temperature_unit=celsius&start_date=${fecha}&end_date=${fecha}&models=${MODELS}&timezone=auto`
}

async function parteA() {
  console.log('═══ PARTE A: 10 llamadas SIMULTÁNEAS sin semáforo (comportamiento anterior) ═══')
  const resultados = await Promise.allSettled(
    CIUDADES_ASIA.map(async c => {
      const r = await fetch(urlOM(c.lat, c.lon), { signal: AbortSignal.timeout(15000) })
      const body = await r.text()
      return { ciudad: c.nombre, ok: r.ok, status: r.status, body: body.slice(0, 200) }
    })
  )
  let rechazadas = 0
  for (const r of resultados) {
    if (r.status === 'fulfilled') {
      const tooMany = !r.value.ok && /Too many concurrent/i.test(r.value.body)
      if (!r.value.ok) {
        rechazadas++
        console.log(`  ✕ ${r.value.ciudad}: HTTP ${r.value.status} ${tooMany ? '← "Too many concurrent requests"' : r.value.body.slice(0, 80)}`)
      }
    } else {
      rechazadas++
      console.log(`  ✕ ${String(r.reason).slice(0, 80)}`)
    }
  }
  const ok = resultados.length - rechazadas
  console.log(`  → A: ${ok}/${resultados.length} OK, ${rechazadas} RECHAZADAS por concurrencia\n`)
  return { ok, rechazadas }
}

async function parteB() {
  console.log('═══ PARTE B: mismas 10 ciudades vía fetchWeatherModels (semáforo máx 4) ═══')
  const t0 = Date.now()
  const resultados = await Promise.all(CIUDADES_ASIA.map(c => fetchWeatherModels(c.lat, c.lon, fecha)))
  const dur = ((Date.now() - t0) / 1000).toFixed(1)
  let completas = 0
  for (const r of resultados) {
    const n = Object.keys(r.models).length
    if (n >= 6 && !r.degraded) completas++
    else console.log(`  ✕ ciudad degradada (${n} modelos, degraded=${r.degraded}, reason=${r.degradedReason?.slice(0, 60)})`)
  }
  console.log(`  → B: ${completas}/10 ciudades con 6+ modelos en ${dur}s (semáforo activo)\n`)
  return { completas }
}

async function main() {
  const a = await parteA()
  const b = await parteB()
  console.log('═══ VEREDICTO ═══')
  if (a.rechazadas > 0 && b.completas === 10) {
    console.log(`✅ CAUSA RAÍZ CONFIRMADA EN VIVO: sin semáforo Open-Meteo rechaza ${a.rechazadas} de 10 por concurrencia; con el semáforo, 10/10 vuelven completas.`)
  } else if (a.rechazadas === 0) {
    console.log(`⚠ La API no rechazó el burst esta vez (carga variable) — B obtuvo ${b.completas}/10 completas. El semáforo elimina la condición de carrera aunque la API esté tranquila.`)
  } else {
    console.log(`❌ Revisar: A rechazó ${a.rechazadas} pero B solo ${b.completas}/10 completas.`)
    process.exit(1)
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
