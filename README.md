# Polyclawd + Forecast Market Asia

Monorepo con dos proyectos:

| Proyecto | Stack | Directorio | Descripción |
|----------|-------|------------|-------------|
| **Polyclawd** | Python FastAPI | `./api/`, `./signals/` | Paper trading bot + weather ensemble engine |
| **Forecast Market Web** | Next.js 14 + TypeScript | `./pages/`, `./components/` | Dashboard web de pronóstico de clima |

---

## Polyclawd — Weather Ensemble Engine

7-source probabilistic forecasting with 57+ ensemble members (ECMWF ENS 51 + 6 models):

- **ECMWF ENS 51 members** → Empirical CDF (no parametric assumption)
- **Isotonic PAVA calibration** → Self-correcting probability curves
- **EWMA dynamic weighting** → Source weights tuned per city (30d decay)
- **Z-score anomaly filter** → Excludes outlier models >3σ
- **Walk-forward backtesting** → No look-ahead bias metrics
- **31 global cities** → US + International Polymarket weather markets

## Forecast Market Web — Asia Dashboard

Pronóstico de temperatura máxima para 9 ciudades asiáticas usando ensemble de 6 modelos.

**Stack**: Next.js 14 + TypeScript + Tailwind CSS + Recharts + Supabase

[Deploy en Vercel →](https://vercel.com/new)

---

## Polyclawd Quick Start

```bash
uvicorn api.main:app --host 127.0.0.1 --port 8420
```

## Forecast Market Web Quick Start

```bash
cd forecast-market-web
npm install
npm run dev
```

## License

Proprietary
