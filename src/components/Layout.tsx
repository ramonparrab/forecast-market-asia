import { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
  lastUpdated?: string
}

export default function Layout({ children, lastUpdated }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-gray-700/50 bg-slate-900/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
                <span className="text-3xl">🌤️</span>
                Forecast Market · Asia
              </h1>
              <p className="mt-1 text-sm text-gray-400">
                Ensemble (ECMWF · GFS · ICON · JMA · CMA) vs precios live de Polymarket · run diario 22:00 Caracas
              </p>
            </div>
            {lastUpdated && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
                actualizado {lastUpdated}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-700/30 bg-slate-900/50 py-4 text-center text-xs text-gray-600">
        v3.0 · Bias dinámicos · Pesos adaptativos · Calibración Platt · Kelly 0.25
      </footer>
    </div>
  )
}
