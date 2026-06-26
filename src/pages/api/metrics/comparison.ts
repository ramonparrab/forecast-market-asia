import { NextApiRequest, NextApiResponse } from 'next'
import { getForecastVsActual } from '@/lib/supabase'
import { CIUDADES_ASIA } from '@/lib/cities'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const slug = req.query.slug as string
    const limit = parseInt(req.query.limit as string) || 60

    if (slug) {
      const records = await getForecastVsActual(slug, limit)
      return res.status(200).json({ slug, records })
    }

    // Return ALL cities
    const all = await Promise.all(
      CIUDADES_ASIA.map(async (city) => {
        const records = await getForecastVsActual(city.slug, limit)
        return { slug: city.slug, records }
      })
    )

    return res.status(200).json({ cities: all })
  } catch (error) {
    console.error('Comparison API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
