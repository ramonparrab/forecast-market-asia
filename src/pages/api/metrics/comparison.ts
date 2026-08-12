import { NextApiRequest, NextApiResponse } from 'next'
import { getForecastVsActual } from '@/lib/supabase'
import { CIUDADES_ASIA } from '@/lib/cities'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const slug = req.query.slug as string

    if (slug) {
      const records = await getForecastVsActual(slug)
      return res.status(200).json({ slug, records })
    }

    const all = await Promise.all(
      CIUDADES_ASIA.map(async (city) => {
        const records = await getForecastVsActual(city.slug)
        return { slug: city.slug, records }
      })
    )

    return res.status(200).json({ cities: all })
  } catch (error) {
    console.error('Comparison API error:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
