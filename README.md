# 🌤️ Forecast Market · Asia v3.0

Pronóstico de temperatura máxima para 9 ciudades asiáticas usando ensemble de 6 modelos meteorológicos vs precios de Polymarket.

**Stack**: Next.js 14 + TypeScript + Tailwind CSS + Recharts + Supabase

## 🚀 Deploy gratis en Vercel (5 minutos)

### 1. Sube el código a GitHub
```bash
# Crea un repo en https://github.com/new (público, sin templates)
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TU-USUARIO/forecast-market-asia.git
git push -u origin main
```

### 2. Crea Supabase (base de datos gratis)
1. Ve a https://supabase.com → "Start your project"
2. Elige región **US East** (más cerca de Vercel)
3. Una vez creado, ve a **Project Settings → API**
4. Copia `Project URL` y `anon public key`
5. Ve a **SQL Editor** → pega el contenido de `supabase-schema.sql` → **Run**

### 3. Despliega en Vercel
1. Ve a https://vercel.com/new
2. Importa tu repo de GitHub
3. En **Environment Variables**, agrega:
   - `NEXT_PUBLIC_SUPABASE_URL` = tu Project URL de Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = tu anon key de Supabase
4. **Deploy** → en 2 minutos estará funcionando 🎉

### 4. Programa el cron diario (10 PM Caracas)
Vercel ejecutará automáticamente `/api/cron/daily` a las **2:00 AM UTC** (= 10:00 PM Caracas UTC-4) según `vercel.json`.

Para verificar: Ve a tu proyecto en Vercel → **Cron Jobs** → debería aparecer "daily" con schedule `0 2 * * *`.

## 🧠 Mejoras vs v2.x

| Característica | v2.x (Python) | v3.0 (Web) |
|---|---|---|
| Modelos climáticos | 4 (ECMWF, GFS, ICON, best_match) | **6** (+JMA, +MeteoFrance) |
| Biases | Estáticos (backtest 3 años) | **Dinámicos** (EMA de errores recientes) |
| Pesos del ensemble | Fijos por ciudad | **Adaptativos** (menos error = más peso) |
| Calibración | ❌ No | **Platt Scaling** con búsqueda de parámetros |
| API Polymarket | Scraping (frágil) | **Gamma API directa** |
| Base de datos | ❌ No | **PostgreSQL** (histórico completo) |
| Dashboard | CLI | **Web** con gráficos Recharts |
| Métricas | ❌ No | MAE, RMSE, Bias, Brier Score, ±2°C |
| Kelly | Fraccional 0.25 | Fraccional 0.25 + filtros mejorados |
| Ejecución | Manual | **Auto** a 10PM Caracas (cron) |
| Hosting | Local | **Gratis** (Vercel + Supabase) |

## 📊 APIs disponibles

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/forecast` | GET/POST | Ejecuta análisis completo para hoy |
| `/api/forecast?fecha=YYYY-MM-DD` | GET | Análisis para fecha específica |
| `/api/history` | GET | Historial de predicciones |
| `/api/metrics` | GET | Métricas de precisión (MAE, RMSE, etc.) |
| `/api/cron/daily` | GET | Cron job automático (Vercel) |

## 🏙️ Ciudades

Seúl, Beijing, Shanghái, Hong Kong, Tokio, Shenzhen, Wuhan, Chongqing, Chengdu

## 🔧 Arquitectura de auto-mejora

1. **Biases dinámicos**: Cada día se recalcula el sesgo con EMA de los últimos errores
2. **Pesos adaptativos**: Modelos con mejor MAE reciente pesan más en el ensemble
3. **Calibración Platt**: Las probabilidades crudas de Monte Carlo se calibran con sigmoide
4. **Kelly ajustado**: Edge, consenso y arbitraje determinan la asignación de $10/día

## 📝 Licencia

Solo señales — no se colocan órdenes reales. No es consejo financiero.
