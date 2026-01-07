import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'

type Breakdown = { currency: string; total: number }

export default function ProofOfReservesPage() {
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [reserve, setReserve] = useState<{ currentAmount: number; totalAUM: number; updatedAt: string | null } | null>(null)
  const [aumUSD, setAumUSD] = useState(0)
  const [walletsUSD, setWalletsUSD] = useState(0)
  const [coveragePct, setCoveragePct] = useState(0)
  const [breakdown, setBreakdown] = useState<Breakdown[]>([])
  const [breakdownUSD, setBreakdownUSD] = useState<{ currency: string; total: number; usd: number }[]>([])
  const [proof, setProof] = useState<any | null>(null)
  const [userMessage, setUserMessage] = useState('')
  const [hideMerkleSection, setHideMerkleSection] = useState(false)
  const [liquidityLevel, setLiquidityLevel] = useState('')
  const [coverageApprox, setCoverageApprox] = useState(0)
  const [userInvestedUSD, setUserInvestedUSD] = useState(0)
  const [userWeeklyMinUSD, setUserWeeklyMinUSD] = useState(0)
  const [userWeeklyMaxUSD, setUserWeeklyMaxUSD] = useState(0)
  const [userLast30USD, setUserLast30USD] = useState(0)
  const [stats, setStats] = useState<any | null>(null)
  const [personalRoiPct, setPersonalRoiPct] = useState(0)
  const [personalOwedUSD, setPersonalOwedUSD] = useState(0)

  async function fetchTransparency() {
    setLoading(true)
    setMsg('')
    try {
      const pub = await fetch('/api/transparency/public')
      const pjson = await pub.json()
      if (pub.ok) {
        setLiquidityLevel(String(pjson?.liquidityLevel || ''))
        setCoverageApprox(Number(pjson?.coverageApprox || 0))
      }
      const res = await fetch('/api/transparency/published')
      const json = await res.json()
      if (!res.ok) throw new Error(String(json?.error || 'Failed'))
      setReserve(json.reserveBuffer)
      setAumUSD(Number(json.aumUSD || 0))
      setWalletsUSD(Number(json.walletsUSDTotal || 0))
      setCoveragePct(Number(json.coveragePct || 0))
      setBreakdown((json.currencyBreakdown as Breakdown[]) || [])
      setBreakdownUSD((json.currencyBreakdownUSD as any[]) || [])
      setUserMessage(String(json?.userMessage || ''))
      setHideMerkleSection(json?.hideMerkleSection === true)

      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (token) {
        const us = await fetch('/api/user/investments/summary', { headers: { Authorization: `Bearer ${token}` } })
        const ujson = await us.json()
        if (us.ok) {
          setUserInvestedUSD(Number(ujson?.totalInvestedUSD || 0))
          setUserWeeklyMinUSD(Number(ujson?.projectedWeeklyMinUSD || 0))
          setUserWeeklyMaxUSD(Number(ujson?.projectedWeeklyMaxUSD || 0))
          setUserLast30USD(Number(ujson?.last30DaysRoiUSD || 0))
        }
        const roiRes = await fetch('/api/user/proof/roi', { headers: { Authorization: `Bearer ${token}` } })
        const roiJson = await roiRes.json()
        if (roiRes.ok) {
          setPersonalRoiPct(Number(roiJson?.roiPct || 0))
          setPersonalOwedUSD(Number(roiJson?.owedUSD || 0))
        }
      }
      const sres = await fetch('/api/platform/stats', { cache: 'no-store' })
      const sjson = await sres.json()
      if (sres.ok) setStats(sjson)
    } catch (e: any) {
      setMsg(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTransparency() }, [])

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/platform/stats', { cache: 'no-store' })
        const json = await res.json()
        if (res.ok) setStats(json)
      } catch {}
    }, 30000)
    return () => { clearInterval(id) }
  }, [])

  async function verifyMyBalance() {
    setMsg('')
    setProof(null)
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Please login')
      const res = await fetch('/api/transparency/proof', { headers: { Authorization: `Bearer ${token}` } })
      const json = await res.json()
      if (!res.ok) throw new Error(String(json?.error || 'Failed'))
      setProof(json)
    } catch (e: any) {
      setMsg(String(e?.message || e))
    }
  }

  return (
    <div className="space-y-6">
      <div className="card-neon">
        <h1 className="text-2xl font-semibold">Proof of Reserves</h1>
        <p className="mt-2 text-sm text-white/80">Transparent overview of assets and liabilities with user-verifiable inclusion.</p>
      </div>

      {msg && <div className="glass rounded-xl p-3 border border-destructive/40 text-sm">{msg}</div>}
      {userMessage && <div className="glass rounded-xl p-3 border border-white/20 text-sm">{userMessage}</div>}

      <div className="grid md:grid-cols-3 gap-4">
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Platform Liquidity</div>
          <div className="mt-2 text-2xl font-semibold">{liquidityLevel ? liquidityLevel.replace('_',' ').toUpperCase() : '—'}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Coverage (Approx)</div>
          <div className="mt-2 text-2xl font-semibold">{coverageApprox.toFixed(2)}%</div>
          <div className="mt-1 text-xs text-white/60">Updated {reserve?.updatedAt ? new Date(reserve.updatedAt).toLocaleString() : '—'}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Coverage Ratio</div>
          <div className="mt-2 text-2xl font-semibold">{coveragePct.toFixed(2)}%</div>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Current platform activity</div>
          <div className="mt-2 text-2xl font-semibold">{Number(stats?.activity?.lastHour || 0).toLocaleString()}</div>
          <div className="mt-1 text-xs text-white/60">Deposits {Number(stats?.activity?.deposits || 0)}, Withdrawals {Number(stats?.activity?.withdrawals || 0)}, ROI {Number(stats?.activity?.roiCredits || 0)}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Users joined</div>
          <div className="mt-2 text-2xl font-semibold">{Number(stats?.usersJoined || 0).toLocaleString()}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Active traders online</div>
          <div className="mt-2 text-2xl font-semibold">{Number(stats?.activeTradersOnline || 0).toLocaleString()}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">AUM</div>
          <div className="mt-2 text-2xl font-semibold">${Number(stats?.aumUSD || aumUSD || 0).toLocaleString()}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Your Active Investments</div>
          <div className="mt-2 text-2xl font-semibold">${userInvestedUSD.toFixed(2)}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Projected Weekly ROI</div>
          <div className="mt-2 text-2xl font-semibold">${userWeeklyMinUSD.toFixed(2)} – ${userWeeklyMaxUSD.toFixed(2)}</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">ROI Last 30 Days</div>
          <div className="mt-2 text-2xl font-semibold">${userLast30USD.toFixed(2)}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Your personal ROI</div>
          <div className="mt-2 text-2xl font-semibold">{personalRoiPct.toFixed(2)}%</div>
        </div>
        <div className="glass rounded-xl p-4 border border-white/10">
          <div className="text-sm text-white/70">Exact amount owed</div>
          <div className="mt-2 text-2xl font-semibold">${personalOwedUSD.toFixed(2)}</div>
        </div>
      </div>

      <div className="glass rounded-2xl p-6 border border-white/10">
        <div className="font-semibold">Wallet Breakdown</div>
        <div className="mt-3 grid md:grid-cols-4 gap-3">
          {breakdown.map((b) => (
            <div key={b.currency} className="glass rounded-lg p-3 border border-white/10">
              <div className="text-sm text-white/70">{b.currency}</div>
              <div className="mt-1 font-semibold">{b.total.toFixed(4)}</div>
            </div>
          ))}
          <div className="glass rounded-lg p-3 border border-white/10">
            <div className="text-sm text-white/70">USD Total</div>
            <div className="mt-1 font-semibold">${walletsUSD.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="text-sm text-white/70">USD‑normalized by currency</div>
          <div className="mt-2 grid md:grid-cols-4 gap-3">
            {breakdownUSD.map((b) => (
              <div key={b.currency} className="glass rounded-lg p-3 border border-white/10">
                <div className="text-sm text-white/70">{b.currency}</div>
                <div className="mt-1">Raw: {b.total.toFixed(4)}</div>
                <div className="mt-1 font-semibold">USD: ${b.usd.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!hideMerkleSection && (
      <div className="glass rounded-2xl p-6 border border-white/10">
        <div className="font-semibold">User Verification</div>
        <p className="mt-2 text-sm text-white/80">Generate a Merkle proof of inclusion for your USD wallet balance.</p>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={verifyMyBalance} className="btn-neon">Verify My Balance</button>
          <Link href="/auth/login" className="text-neon-blue text-sm">Login</Link>
        </div>
        {proof && (
          <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
            <div className="glass rounded-lg p-3 border border-white/10">
              <div className="text-white/70">Merkle Root</div>
              <div className="mt-1 break-words text-xs">{String(proof.root)}</div>
            </div>
            <div className="glass rounded-lg p-3 border border-white/10">
              <div className="text-white/70">Leaf</div>
              <div className="mt-1 break-words text-xs">{String(proof.leaf)}</div>
              <div className="mt-2 text-white/70">Amount</div>
              <div className="mt-1">${Number(proof.amount || 0).toFixed(8)} USD</div>
            </div>
            <div className="glass rounded-lg p-3 border border-white/10 md:col-span-2">
              <div className="text-white/70">Path</div>
              <div className="mt-1 text-xs break-words">{(proof.path || []).map((p: any, i: number) => `${i+1}:${p.position}:${p.sibling}`).join(' | ')}</div>
              <div className="mt-3">
                <button className="btn-neon" onClick={async () => {
                  try {
                    function toHex(buf: ArrayBuffer) {
                      const v = new Uint8Array(buf)
                      return Array.from(v).map((b) => b.toString(16).padStart(2, '0')).join('')
                    }
                    async function sha256Hex(s: string) {
                      const enc = new TextEncoder().encode(s)
                      const dig = await crypto.subtle.digest('SHA-256', enc)
                      return toHex(dig)
                    }
                    let cur = String(proof.leaf)
                    for (const step of (proof.path || [])) {
                      const left = step.position === 'left' ? step.sibling : cur
                      const right = step.position === 'left' ? cur : step.sibling
                      cur = await sha256Hex(left + right)
                    }
                    const ok = cur === String(proof.root)
                    alert(ok ? 'Verified ✓' : 'Verification failed')
                  } catch (e) { alert('Verification error') }
                }}>Verify Path</button>
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      <div className="text-xs text-white/60">All returns are variable. This page provides transparency and a user-verifiable proof of inclusion.</div>
    </div>
  )
}
