import { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '')
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !supabaseKey) return res.status(500).json({ error: 'No Supabase config' })

  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/forecast_history?select=id,slug,fecha_objetivo,ciudad,temp_real,error&order=id.asc`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'count=exact',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return res.status(500).json({ error: `Supabase HTTP ${resp.status}` })

    const allRecords: any[] = await resp.json()
    const total = allRecords.length

    const groups = new Map<string, any[]>()
    for (const r of allRecords) {
      const key = `${r.slug}|${r.fecha_objetivo}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }

    const duplicates: { key: string; count: number; ids: number[]; ciudad: string; error: number | null; temp_real: number | null }[] = []
    const toDelete: number[] = []
    for (const [key, records] of Array.from(groups.entries())) {
      if (records.length > 1) {
        records.sort((a, b) => b.id - a.id)
        const keep = records[0]
        const remove = records.slice(1).map(r => r.id)
        toDelete.push(...remove)
        duplicates.push({
          key,
          count: records.length,
          ids: records.map(r => r.id),
          ciudad: records[0].ciudad,
          error: keep.error,
          temp_real: keep.temp_real,
        })
      }
    }

    let deleted = 0
    if (req.method === 'POST' && toDelete.length > 0) {
      for (let i = 0; i < toDelete.length; i += 100) {
        const batch = toDelete.slice(i, i + 100)
        const idsParam = batch.join(',')
        await fetch(`${supabaseUrl}/rest/v1/forecast_history?id=in.(${idsParam})`, {
          method: 'DELETE',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Prefer: 'count=exact',
          },
          signal: AbortSignal.timeout(30000),
        })
        deleted += batch.length
      }
    }

    const uniqueCount = groups.size
    const dupCount = total - uniqueCount

    return res.status(200).json({
      total_records: total,
      unique_records: uniqueCount,
      duplicate_records: dupCount,
      duplicate_groups: duplicates.length,
      duplicates: req.query.detail === '1' ? duplicates : duplicates.map(d => ({ key: d.key, count: d.count, ciudad: d.ciudad })),
      deleted: req.method === 'POST' ? deleted : 0,
      note: 'GET para inspeccionar, POST para eliminar duplicados (conserva el id más alto)',
    })
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message })
  }
}
