import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Resolves a Polymarket username to a wallet address.
 * 
 * Strategy:
 * 1. Static known mappings (hardcoded)
 * 2. In-memory cache populated at runtime when users search by wallet
 * 3. The wallet-analysis API already returns `username` — the frontend
 *    auto-registers mappings via POST so future username searches work.
 */

// Hardcoded known mappings
const KNOWN: Record<string, string> = {
  'ramonparrab': '0xe8c8D14846C9Ef7FEEc45EAB36c21B7881c7C0fa',
}

// Runtime cache (populated via POST /api/resolve-username)
const usernameToAddr = new Map<string, string>(
  Object.entries(KNOWN).map(([k, v]) => [k.toLowerCase(), v])
)
const addrToUsername = new Map<string, string>(
  Object.entries(KNOWN).map(([k, v]) => [v.toLowerCase(), k])
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleResolve(req, res)
  if (req.method === 'POST') return handleRegister(req, res)
  res.status(405).end()
}

function handleResolve(req: NextApiRequest, res: NextApiResponse) {
  const q = (req.query.q as string || '').trim()
  if (!q) return res.status(400).json({ error: '?q requerido' })

  // Already a wallet?
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
    const username = addrToUsername.get(q.toLowerCase()) || ''
    return res.status(200).json({ address: q, username })
  }

  // Username lookup
  const addr = usernameToAddr.get(q.toLowerCase())
  if (addr) {
    return res.status(200).json({ address: addr, username: q })
  }

  res.status(404).json({ error: `No se encontro wallet para "${q}". Busca por wallet primero para registrar el mapeo.` })
}

function handleRegister(req: NextApiRequest, res: NextApiResponse) {
  const { username, address } = req.body as { username?: string; address?: string }
  if (!username || !address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'username y address validos requeridos' })
  }
  usernameToAddr.set(username.toLowerCase(), address)
  addrToUsername.set(address.toLowerCase(), username)
  res.status(200).json({ ok: true })
}
