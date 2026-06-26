import { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
  lastUpdated?: string
}

export default function Layout({ children, lastUpdated }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-gray-700/50 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <h1 className="flex items-center gap-2 text-xl font-bold text-white sm:text-2xl">
                <span className="text-2xl sm:text-3xl">🌤️</span>
                Forecast Market · Asia
              </h1>
              <p className="text-xs text-gray-400 sm:text-sm">
                6 modelos (ECMWF · GFS · ICON · JMA · MeteoFrance) vs precios Polymarket · Nowcasting · Student-t ν=4
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {lastUpdated && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
                  <span>actualizado {lastUpdated}</span>
                </div>
              )}
              <a
                href="https://github.com/ramonparrab/forecast-market-asia"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1 text-gray-500 hover:text-gray-300 transition"
              >
                <span>GitHub</span>
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-700/30 bg-slate-900/50 py-4">
        <div className="mx-auto max-w-7xl px-4 text-center text-xs text-gray-600">
          <p className="mb-1">v4.0 · Student-t ν=4 · Nowcasting METAR · Bias dinámicos · Pesos adaptativos · Calibración Platt · Kelly 0.25</p>
          <p className="text-gray-700">Ejecución automática 22:00 Caracas (02:00 UTC) · No es consejo financiero</p>
        </div>
      </footer>
    </div>
  )
}
