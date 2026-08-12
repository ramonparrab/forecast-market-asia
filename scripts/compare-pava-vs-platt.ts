/**
 * compare-pava-vs-platt.ts
 *
 * Backtest comparing PAVA isotonic (trained on historical pairs) vs Platt scaling.
 * Uses train/test split to avoid overfitting.
 *
 * Run: npx tsx scripts/compare-pava-vs-platt.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv(): { url: string; key: string } {
  const envPath = path.resolve(__dirname, '..', '.env')
  const raw = fs.readFileSync(envPath, 'utf-8')
  const get = (k: string) => {
    const m = raw.match(new RegExp(`^${k}=(.+)$`, 'm'))
    return m?.[1]?.trim() ?? ''
  }
  return { url: get('NEXT_PUBLIC_SUPABASE_URL'), key: get('NEXT_PUBLIC_SUPABASE_ANON_KEY') }
}

function logistic(x: number): number { return 1.0 / (1.0 + Math.exp(-x)) }
function mean(arr: number[]): number { return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length }
function std(arr: number[]): number { if (arr.length < 2) return 0; const m = mean(arr); return Math.sqrt(arr.map(v => (v - m) ** 2).reduce((s, v) => s + v, 0) / (arr.length - 1)) }
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }
function erf(x: number): number { const sign = x >= 0 ? 1 : -1; const ax = Math.abs(x); const t = 1 / (1 + 0.3275911 * ax); const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))); return sign * (1 - poly * Math.exp(-ax * ax)) }

function plattCalibrate(rawProbs: number[], alpha: number, beta: number): number[] {
  return rawProbs.map(p => { const c = clamp(p, 0.001, 0.999); const logit = Math.log(c / (1 - c)); return clamp(Math.round(logistic(alpha * logit + beta) * 10000) / 10000, 0.001, 0.999) })
}

function isotonicRegressionPAVA(y: number[]): { fitted: number[] } {
  const n = y.length; if (n === 0) return { fitted: [] }; if (n === 1) return { fitted: [y[0]] }
  const blocks: { sum: number; cnt: number; start: number; end: number }[] = y.map((v, i) => ({ sum: v, cnt: 1, start: i, end: i }))
  let i = 0
  while (i < blocks.length - 1) {
    const cur = blocks[i]; const nxt = blocks[i + 1]
    if (cur.sum / cur.cnt > nxt.sum / nxt.cnt) { blocks[i] = { sum: cur.sum + nxt.sum, cnt: cur.cnt + nxt.cnt, start: cur.start, end: nxt.end }; blocks.splice(i + 1, 1); i = Math.max(0, i - 1) } else { i++ }
  }
  const fitted: number[] = new Array(n)
  for (const blk of blocks) { const m = blk.sum / blk.cnt; for (let j = blk.start; j <= blk.end; j++) fitted[j] = m }
  return { fitted }
}

function buildIsotonicCalibration(pairs: { predicted: number; outcome: number }[], nBins: number = 10): { binMin: number; binMax: number; ratio: number }[] {
  if (pairs.length < 20) return []
  const sorted = [...pairs].sort((a, b) => a.predicted - b.predicted)
  const binSize = Math.max(1, Math.floor(sorted.length / nBins))
  const bins: { predictedMean: number; actualRate: number }[] = []
  for (let i = 0; i < sorted.length; i += binSize) {
    const batch = sorted.slice(i, i + binSize)
    if (batch.length < 2) continue
    const predMean = batch.reduce((s, p) => s + p.predicted, 0) / batch.length
    const actRate = batch.reduce((s, p) => s + p.outcome, 0) / batch.length
    bins.push({ predictedMean: predMean, actualRate: actRate })
  }
  if (bins.length < 2) return []
  const rates = bins.map(b => b.actualRate)
  const { fitted } = isotonicRegressionPAVA(rates)
  const calibration: { binMin: number; binMax: number; ratio: number }[] = []
  for (let i = 0; i < bins.length; i++) {
    const binMin = i === 0 ? 0 : (bins[i - 1].predictedMean + bins[i].predictedMean) / 2
    const binMax = i === bins.length - 1 ? 1 : (bins[i].predictedMean + bins[i + 1].predictedMean) / 2
    const ratio = bins[i].predictedMean > 0.001 ? fitted[i] / bins[i].predictedMean : 1.0
    calibration.push({ binMin, binMax, ratio })
  }
  return calibration
}

function applyIsotonicCalibration(calibration: { binMin: number; binMax: number; ratio: number }[], rawProb: number): number {
  if (calibration.length === 0) return rawProb
  const p = clamp(rawProb, 0.001, 0.999)
  for (const pt of calibration) { if (p >= pt.binMin && p <= pt.binMax) return clamp(p * pt.ratio, 0.01, 0.95) }
  const nearest = calibration.reduce((best, pt) => Math.abs(pt.binMin - p) < Math.abs(best.binMin - p) ? pt : best)
  return clamp(p * nearest.ratio, 0.01, 0.95)
}

function findBestPlattParams(rawProbs: number[], outcomes: number[]): [number, number] {
  let bestBrier = Infinity; let bestA = 1.0; let bestB = 0.0
  for (let a = 0.3; a <= 2.0; a += 0.1) {
    for (let b = -1.5; b <= 1.5; b += 0.1) {
      const cal = plattCalibrate(rawProbs, a, b)
      let brier = 0; for (let i = 0; i < cal.length; i++) brier += (cal[i] - outcomes[i]) ** 2; brier /= cal.length
      if (brier < bestBrier) { bestBrier = brier; bestA = a; bestB = b }
    }
  }
  return [Math.round(bestA * 100) / 100, Math.round(bestB * 100) / 100]
}

function brierScore(probs: number[], outcomes: number[]): number { let s = 0; for (let i = 0; i < probs.length; i++) s += (probs[i] - outcomes[i]) ** 2; return s / probs.length }
function mae(probs: number[], outcomes: number[]): number { let s = 0; for (let i = 0; i < probs.length; i++) s += Math.abs(probs[i] - outcomes[i]); return s / probs.length }
function ece(probs: number[], outcomes: number[], nBins: number = 10): number {
  const n = probs.length; if (n === 0) return 0
  const indexed = probs.map((p, i) => ({ p, o: outcomes[i] })); const sorted = [...indexed].sort((a, b) => a.p - b.p)
  const binSize = Math.max(1, Math.floor(n / nBins)); let totalErr = 0; let totalN = 0
  for (let i = 0; i < n; i += binSize) {
    const batch = sorted.slice(i, Math.min(i + binSize, n)); if (batch.length === 0) continue
    const predMean = batch.reduce((s, b) => s + b.p, 0) / batch.length; const actMean = batch.reduce((s, b) => s + b.o, 0) / batch.length
    totalErr += batch.length * Math.abs(predMean - actMean); totalN += batch.length
  }
  return totalN > 0 ? totalErr / totalN : 0
}

function generateContracts(tempCorregida: number, tempReal: number, sigma: number) {
  const offsets = [-3, -2, -1, 0, 1, 2, 3]; const contracts: { label: string; rawProb: number; outcome: number }[] = []
  for (const off of offsets) {
    const bucketCenter = Math.round(tempCorregida + off)
    const zLo = (bucketCenter - 0.5 - tempCorregida) / sigma; const zHi = (bucketCenter + 0.5 - tempCorregida) / sigma
    const cdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2))
    const rawProb = clamp(cdf(zHi) - cdf(zLo), 0.001, 0.999)
    const outcome = Math.abs(tempReal - bucketCenter) <= 0.5 ? 1 : 0
    contracts.push({ label: `${bucketCenter}°C`, rawProb, outcome })
  }
  return contracts
}

async function main() {
  console.log('=== PAVA vs Platt Calibration Backtest (Train/Test Split) ===\n')
  const { url, key } = loadEnv()
  if (!url || !key) { console.error('ERROR: Missing env vars'); process.exit(1) }
  const supabase = createClient(url, key)

  console.log('Fetching historical records...')
  const { data: records, error } = await supabase.from('forecast_history').select('*').not('temp_real', 'is', null).not('error', 'is', null).order('fecha_ejecucion', { ascending: false }).limit(200)
  if (error || !records || records.length < 30) { console.error(`Insufficient records: ${records?.length ?? 0}`); process.exit(1) }
  console.log(`Fetched ${records.length} records\n`)

  // Generate all contracts
  const allContracts: { label: string; rawProb: number; outcome: number }[] = []
  for (const rec of records) {
    const tc = Number(rec.temp_corregida); const tr = Number(rec.temp_real)
    if (isNaN(tc) || isNaN(tr)) continue
    allContracts.push(...generateContracts(tc, tr, 2.0))
  }

  // Train/test split: 70% train, 30% test
  const n = allContracts.length
  const nTrain = Math.floor(n * 0.7)
  const trainPairs = allContracts.slice(0, nTrain).map(c => ({ predicted: c.rawProb, outcome: c.outcome }))
  const testContracts = allContracts.slice(nTrain)
  const testProbs = testContracts.map(c => c.rawProb)
  const testOutcomes = testContracts.map(c => c.outcome)

  console.log(`Train: ${nTrain} pairs | Test: ${testContracts.length} pairs\n`)

  // Raw baseline
  const brierRaw = brierScore(testProbs, testOutcomes)
  const eceRaw = ece(testProbs, testOutcomes)

  // Platt: train on train set, apply to test set
  const [bestAlpha, bestBeta] = findBestPlattParams(trainPairs.map(p => p.predicted), trainPairs.map(p => p.outcome))
  console.log(`Platt params: α=${bestAlpha}, β=${bestBeta}`)
  const plattProbs = plattCalibrate(testProbs, bestAlpha, bestBeta)
  const brierPlatt = brierScore(plattProbs, testOutcomes)
  const ecePlatt = ece(plattProbs, testOutcomes)

  // PAVA: build calibration from train set, apply to test set
  const isotonicCal = buildIsotonicCalibration(trainPairs)
  console.log(`PAVA calibration bins: ${isotonicCal.length}\n`)
  const pavaProbs = testProbs.map(p => applyIsotonicCalibration(isotonicCal, p))
  const brierPava = brierScore(pavaProbs, testOutcomes)
  const ecePava = ece(pavaProbs, testOutcomes)

  // Results
  const sep = '─'.repeat(60)
  console.log(sep)
  console.log('  RESULTS (Test set only — no overfitting)')
  console.log(sep)
  console.log(`  ${'Method'.padEnd(22)} ${'Brier ↓'.padStart(10)} ${'ECE ↓'.padStart(10)} ${'MAE ↓'.padStart(10)}`)
  console.log(`  ${'─'.repeat(22)} ${'─'.repeat(10)} ${'─'.repeat(10)} ${'─'.repeat(10)}`)
  console.log(`  ${'Raw (no calibración)'.padEnd(22)} ${brierRaw.toFixed(4).padStart(10)} ${eceRaw.toFixed(4).padStart(10)} ${mae(testProbs, testOutcomes).toFixed(4).padStart(10)}`)
  console.log(`  ${'Platt scaling'.padEnd(22)} ${brierPlatt.toFixed(4).padStart(10)} ${ecePlatt.toFixed(4).padStart(10)} ${mae(plattProbs, testOutcomes).toFixed(4).padStart(10)}`)
  console.log(`  ${'PAVA isotonic'.padEnd(22)} ${brierPava.toFixed(4).padStart(10)} ${ecePava.toFixed(4).padStart(10)} ${mae(pavaProbs, testOutcomes).toFixed(4).padStart(10)}`)

  console.log('')
  console.log(sep)
  console.log('  VEREDICTO')
  console.log(sep)
  if (brierPava < brierPlatt && ecePava <= ecePlatt) {
    const brierImprove = ((brierRaw - brierPava) / brierRaw * 100).toFixed(1)
    const eceImprove = ((eceRaw - ecePava) / (eceRaw || 0.001) * 100).toFixed(1)
    console.log(`  ★ PAVA MEJORA a Platt en este dataset.`)
    console.log(`    Brier: ${brierImprove}% mejor que baseline`)
    console.log(`    ECE: ${eceImprove}% mejor que baseline`)
  } else if (brierPlatt < brierPava && ecePlatt <= ecePava) {
    const brierImprove = ((brierRaw - brierPlatt) / brierRaw * 100).toFixed(1)
    const eceImprove = ((eceRaw - ecePlatt) / (eceRaw || 0.001) * 100).toFixed(1)
    console.log(`  ★ Platt MEJORA a PAVA en este dataset.`)
    console.log(`    Brier: ${brierImprove}% mejor que baseline`)
    console.log(`    ECE: ${eceImprove}% mejor que baseline`)
  } else {
    console.log(`  ★ Resultados mixtos — ambos métodos mejoran sobre baseline.`)
  }
  console.log('')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
