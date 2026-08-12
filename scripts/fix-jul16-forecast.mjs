import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || 'https://dzgxnpazxcusbjbkpnqn.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY

if (!supabaseKey) {
  console.error('SUPABASE_KEY env var required')
  process.exit(1)
}

const client = createClient(supabaseUrl, supabaseKey)

// Correct temp_corregida for July 16: the improved model gives 38.97
// This is the bias-corrected ensemble without nowcast corruption
const correctValue = 38.97

// 1. Update forecast_history
const { data: histUpdate, error: histErr } = await client
  .from('forecast_history')
  .update({ temp_corregida: correctValue })
  .eq('slug', 'chongqing')
  .eq('fecha_objetivo', '2026-07-16')
  .is('temp_real', null)
  .select()

if (histErr) {
  console.error('Update forecast_history error:', histErr)
} else {
  console.log('Updated forecast_history:', JSON.stringify(histUpdate))
}

// 2. Update daily_runs records - fix the resultados JSON for Chongqing
const { data: dailyRuns, error: drError } = await client
  .from('daily_runs')
  .select('id, resultados')
  .eq('fecha_objetivo', '2026-07-16')
  .order('id', { ascending: true })

if (drError) {
  console.error('Query daily_runs error:', drError)
} else {
  for (const dr of (dailyRuns ?? [])) {
    const resultados = typeof dr.resultados === 'string' ? JSON.parse(dr.resultados) : dr.resultados
    const cqIdx = resultados.findIndex(c => c.slug === 'chongqing')
    if (cqIdx >= 0) {
      resultados[cqIdx].forecast.temp_corregida = correctValue
      const { error: updErr } = await client
        .from('daily_runs')
        .update({ resultados: JSON.stringify(resultados) })
        .eq('id', dr.id)
      if (updErr) {
        console.error(`Error updating daily_runs id=${dr.id}:`, updErr)
      } else {
        console.log(`Updated daily_runs id=${dr.id} temp_corregida=${correctValue}`)
      }
    }
  }
}

console.log('Done')
