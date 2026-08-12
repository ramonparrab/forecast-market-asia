import { NextApiRequest, NextApiResponse } from 'next'
import { getCityMetrics } from '@/lib/supabase'
import { CIUDADES_ASIA } from '@/lib/cities'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const slug = req.query.slug as string

    if (slug) {
      const result = await getCityMetrics(slug)
      return res.status(200).json(result)
    }

    // Return ALL cities if no slug
    const all = await Promise.all(
      CIUDADES_ASIA.map(async (city) => {
        const r = await getCityMetrics(city.slug)
        return { slug: city.slug, ...r }
      })
    )

    return res.status(200).json({ cities: all })
  } catch (error) {
    console.error('City metrics API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
