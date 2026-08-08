import { useEffect, useState, useCallback } from 'react'

export interface AlertaDatos {
  tmax: number | null
  tmin: number | null
  precip: number | null
  prob: number | null
  wind: number | null
  code: number | null
}

export interface AlertaClimaUI {
  tipo: 'FRENTE_FRIO' | 'FRENTE_CALUROSO' | 'NIEVE' | 'LLUVIA_FUERTE' | 'TORMENTA_SEVERA'
  icono: string
  titulo: string
  severidad: 'CRITICA' | 'ALTA' | 'MODERADA'
  descripcion: string
}

export interface AlertaCiudadUI {
  slug: string
  nombre: string
  fecha_objetivo: string
  temp_corregida: number | null
  alertas: AlertaClimaUI[]
  datos: AlertaDatos
}

const peso = (c: AlertaCiudadUI) => Math.max(1, ...c.alertas.map(a => a.severidad === 'CRITICA' ? 3 : a.severidad === 'ALTA' ? 2 : 1))

export default function AlertaClimaBanner({ compact = false }: { compact?: boolean }) {
  const [ciudades, setCiudades] = useState<AlertaCiudadUI[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(() => {
    setError(null)
    fetch('/api/alerta-clima')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(j => setCiudades(j.ciudades ?? []))
      .catch(e => setError(e.message))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (error) {
    return (
      <div className="rounded-xl bg-slate-800/40 border border-gray-700/30 p-3 text-xs text-gray-500">
        ⚠️ Alerta climática no disponible ({error})
      </div>
    )
  }
  if (!ciudades) {
    return <div className="h-4" />
  }

  const conAlertas = ciudades.filter(c => c.alertas.length > 0).sort((a, b) => peso(b) - peso(a))
  const sinAlertas = ciudades.filter(c => c.alertas.length === 0)
  const hayCriticas = conAlertas.some(c => c.alertas.some(a => a.severidad !== 'MODERADA'))

  if (conAlertas.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-300">
        ✅ Sin alertas climáticas para {sinAlertas.length ? sinAlertas.map(c => c.nombre).join(', ') : 'el próximo día'} — sin frente frío, calor extremo, nieve ni lluvia fuerte pronosticada.
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border-2 ${hayCriticas ? 'border-red-500 bg-red-950/40' : 'border-amber-500 bg-amber-950/30'} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-3xl">🚨</span>
        <div>
          <p className={`text-lg font-black uppercase tracking-wide ${hayCriticas ? 'text-red-400' : 'text-amber-400'}`}>
            ALERTA CLIMÁTICA · {conAlertas.length} {conAlertas.length === 1 ? 'ciudad' : 'ciudades'} con evento extremo
          </p>
          <p className="text-[11px] text-gray-400">
            {new Date().toLocaleDateString()} — el próximo día pronosticado puede desviar la temperatura de forma drástica
          </p>
        </div>
      </div>
      <div className={`grid gap-2 ${compact ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
        {conAlertas.map(c => (
          <div key={c.slug} className={`rounded-lg border-2 p-3 ${c.alertas.some(a => a.severidad === 'CRITICA') ? 'border-red-500 bg-red-900/30' : c.alertas.some(a => a.severidad === 'ALTA') ? 'border-red-400/60 bg-red-950/20' : 'border-amber-400/60 bg-amber-950/20'}`}>
            <div className="flex items-center justify-between gap-1">
              <p className="text-xs font-black text-white uppercase">{c.nombre}</p>
              <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[9px] text-gray-300">{c.fecha_objetivo}</span>
            </div>
            <div className="mt-1 space-y-1">
              {c.alertas.map((a, i) => (
                <div key={i} className={`flex items-start gap-1.5 rounded px-1.5 py-1 text-[11px] ${a.severidad === 'CRITICA' ? 'bg-red-500/20 text-red-100' : 'bg-red-400/10 text-red-200'}`}>
                  <span className="text-base">{a.icono}</span>
                  <div>
                    <p className="font-black uppercase">
                      {a.titulo}
                      {a.severidad === 'CRITICA' && <span className="ml-1 rounded bg-red-500 px-1 py-px text-[8px] text-white">CRÍTICO</span>}
                    </p>
                    <p className="text-[10px] leading-snug">{a.descripcion}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1 text-[9px] text-gray-400">
              <span>Tmax {c.datos.tmax ?? '—'}°</span>
              <span>Tmin {c.datos.tmin ?? '—'}°</span>
              <span>🌧 {c.datos.precip ?? '—'}mm ({c.datos.prob ?? '—'}%)</span>
              <span>💨 {c.datos.wind ?? '—'}km/h</span>
              {c.temp_corregida != null && (
                <span className="rounded bg-blue-500/20 px-1 py-px text-blue-300">pronóstico app: {c.temp_corregida.toFixed(1)}°</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}