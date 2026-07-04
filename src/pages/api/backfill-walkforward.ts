import { NextApiRequest, NextApiResponse } from 'next'
import { getServiceClient } from '@/lib/supabase'
import { computeDynamicBias } from '@/lib/bias-correction'

interface HistoryRecord {
  id: number
  slug: string
  fecha_objetivo: string
  temp_pronosticada: number
  temp_corregida: number
  temp_real: number
  error: number | null
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const client = getServiceClient()
    if (!client) return res.status(500).json({ error: 'No Supabase client' })

    const { data, error } = await (client as any)
      .from('forecast_history')
      .select('id, slug, fecha_objetivo, temp_pronosticada, temp_corregida, temp_real, error')
      .not('temp_real', 'is', null)
      .not('temp_pronosticada', 'is', null)
      .order('fecha_objetivo', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })
    if (!data || (data as any[]).length === 0) {
      return res.status(200).json({ message: 'No records found', total: 0 })
    }

    // Dedup by (slug, fecha_objetivo) — keep latest id
    const seen = new Map<string, any>()
    for (const r of (data as any[])) {
      const key = `${r.slug}|${r.fecha_objetivo}`
      if (!seen.has(key) || r.id > seen.get(key).id) {
        seen.set(key, r)
      }
    }

    const all = Array.from(seen.values()) as HistoryRecord[]

    // Group by slug and sort by fecha_objetivo
    const bySlug: Record<string, HistoryRecord[]> = {}
    for (const r of all) {
      if (!bySlug[r.slug]) bySlug[r.slug] = []
      bySlug[r.slug].push(r)
    }
    for (const slug of Object.keys(bySlug)) {
      bySlug[slug].sort((a, b) => a.fecha_objetivo.localeCompare(b.fecha_objetivo))
    }

    let totalUpdated = 0
    let totalSkipped = 0
    const cityResults: { slug: string; old_bias: number; new_bias: number; old_accuracy: number; new_accuracy: number; updated: number; skipped: number }[] = []

    for (const [slug, records] of Object.entries(bySlug)) {
      const pastErrors: { error: number }[] = []
      let updated = 0
      let skipped = 0

      for (const record of records) {
        const mes = new Date(record.fecha_objetivo + 'T12:00:00').getMonth() + 1
        const sesgo = computeDynamicBias(slug, mes, pastErrors)

        const newTempCorregida = Math.round(Math.max(0, record.temp_pronosticada + sesgo) * 100) / 100
        const newError = Math.round((record.temp_real - newTempCorregida) * 100) / 100

        // Check if correction actually changes the value
        const diff = Math.abs(newTempCorregida - record.temp_corregida)
        if (diff < 0.05) {
          pastErrors.push({ error: record.error ?? newError })
          skipped++
          continue
        }

        // Update DB
        const { error: updateErr } = await (client as any)
          .from('forecast_history')
          .update({ temp_corregida: newTempCorregida, error: newError })
          .eq('id', record.id)

        if (updateErr) {
          pastErrors.push({ error: record.error ?? newError })
          skipped++
        } else {
          updated++
          pastErrors.push({ error: newError })
        }
      }

      totalUpdated += updated
      totalSkipped += skipped

      // Old vs new accuracy
      const oldWithin = records.filter(r => Math.abs(r.error ?? 0) <= 0.5).length
      const oldAcc = records.length > 0 ? Math.round(oldWithin / records.length * 100) : 0
      // For new accuracy, re-fetch would be needed, estimate from what we changed
      cityResults.push({ slug, old_bias: 0, new_bias: 0, old_accuracy: oldAcc, new_accuracy: 0, updated, skipped })
    }

    return res.status(200).json({
      status: 'ok',
      message: `Walk-forward completado: ${totalUpdated} actualizados, ${totalSkipped} sin cambio`,
      total: all.length,
      updated: totalUpdated,
      skipped: totalSkipped,
      cities: cityResults.map(c => `${c.slug}: ${c.updated} upd, ${c.skipped} skip, old_acc=${c.old_accuracy}%`),
    })
  } catch (error) {
    return res.status(500).json({ status: 'error', message: (error as Error).message })
  }
}
