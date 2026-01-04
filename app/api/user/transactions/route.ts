import { NextRequest } from 'next/server'
import { requireRole } from '@lib/requireRole'
import { publish } from '@lib/sse'
import { supabaseServer } from '@lib/supabaseServer'
import { sendEmail } from '@lib/email'
import crypto from 'crypto'

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user, error } = await requireRole('USER', req)
  if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
  
  if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
  const supabase = supabaseServer

  const url = new URL(req.url)
  const page = Math.max(1, Number(url.searchParams.get('page') || '1'))
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '25')))
  const type = String(url.searchParams.get('type') || '')
  const status = String(url.searchParams.get('status') || '')
  
  try {
    // Try PascalCase "Transaction" first
    let data: any[] | null = null
    let count: number | null = 0
    let dbError: any = null

    // 1. Try PascalCase
    {
        let query = supabase
        .from('Transaction')
        .select('*', { count: 'exact' })
        .eq('userId', user.id)
        
        if (type) query = (query as any).in('type', [type.toLowerCase(), type.toUpperCase()])
        if (status) query = (query as any).in('status', [status.toLowerCase(), status.toUpperCase()])
        
        const res = await query
        .order('createdAt', { ascending: false })
        .range((page - 1) * limit, page * limit - 1)
        
        data = res.data
        count = res.count
        dbError = res.error
    }

    // 2. Fallback to lowercase 'transactions' if relation missing
    if (dbError && (dbError.message?.includes('relation') || dbError.code === '42P01')) {
        let query = supabase
        .from('transactions')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)

        if (type) query = (query as any).in('type', [type.toLowerCase(), type.toUpperCase()])
        if (status) query = (query as any).in('status', [status.toLowerCase(), status.toUpperCase()])

        const res = await query
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1)
        
        data = res.data
        count = res.count
        dbError = res.error
    }

    if (dbError) {
      console.error('Database error:', dbError)
      return new Response(JSON.stringify({ error: 'database_error', details: dbError.message || String(dbError) }), { status: 500 })
    }

    const items = Array.isArray(data)
      ? (data as any[]).map((t) => {
          const details = t.reference && (t.reference.startsWith('{') || t.reference.startsWith('[')) 
            ? (() => { try { return JSON.parse(t.reference) } catch { return t.reference } })() 
            : undefined;
          
          return {
            id: String(t.id),
            user_id: String(t.userId || t.user_id || user.id),
            type: String(t.type || '').toLowerCase(),
            amount: typeof t.amount === 'number' ? t.amount : undefined,
            amount_usd: typeof (t.amountUsd ?? t.amount_usd) === 'number' ? (t.amountUsd ?? t.amount_usd) : undefined,
            currency: String(t.currency || details?.currency || ''),
            status: String(t.status || '').toLowerCase(),
            tx_hash: t.txHash ?? t.tx_hash ?? details?.txHash ?? details?.hash ?? undefined,
            reference: t.reference || undefined,
            details: details,
            created_at: String(t.createdAt || t.created_at || new Date().toISOString()),
          }
        })
      : []
    return new Response(JSON.stringify({ items, total: typeof count === 'number' ? count : items.length, page, limit }), { status: 200 })
  } catch (e) {
    console.error('Database error:', e)
    return new Response(JSON.stringify({ error: 'database_error', details: e }), { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  console.log('[Withdrawal] Request received')
  try {
    const { user, error } = await requireRole('USER', req)
    if (error || !user) return new Response(JSON.stringify({ error: error || 'unauthenticated' }), { status: error === 'unauthenticated' ? 401 : 403 })
    
    if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
    const supabase = supabaseServer

    console.log('[Withdrawal] User auth:', user?.id)

    let body: any
    try {
      body = await req.json()
    } catch (e) {
      return new Response(JSON.stringify({ error: 'invalid_json_body' }), { status: 400 })
    }

    const kind = String(body?.kind || '')
    const amount = Number(body?.amount || 0)
    const currency = String(body?.currency || (user as any).currency || 'USD')
    
    if (!kind || amount <= 0) return new Response(JSON.stringify({ error: 'invalid' }), { status: 400 })
    
    if (kind === 'deposit') {
        // Ported from Prisma to Supabase JS
        const provider = String(body?.provider || 'paystack')
        const newId = crypto.randomUUID()
        const now = new Date().toISOString()
        
        // Using "Transaction" (PascalCase) and camelCase columns
        const { data: txn, error: txnErr } = await supabase
            .from('Transaction')
            .insert({
                id: newId,
                userId: user.id,
                type: 'DEPOSIT',
                amount: amount,
                currency: currency,
                provider: provider,
                status: 'PENDING',
                createdAt: now,
                updatedAt: now,
                reference: JSON.stringify({
                    provider,
                    currency,
                    kind: 'deposit'
                })
            })
            .select()
            .single()

        if (txnErr) {
             console.error('Database error:', txnErr)
             return new Response(JSON.stringify({ error: 'database_error', details: txnErr.message }), { status: 500 })
        }
       
       return new Response(JSON.stringify({ ok: true, transaction: txn, paystack: { authorizationUrl: '', reference: txn.id } }), { status: 200 })
    }

    if (kind === 'withdraw') {
        const destinationAddress = String(body?.destinationAddress || '')
        const network = String(body?.network || '')
        
        if (!destinationAddress) {
           return new Response(JSON.stringify({ error: 'missing_destination_address' }), { status: 400 })
        }

        // 1. Optional KYC check via Supabase profiles
        const { data: profile } = await supabase
            .from('profiles')
            .select('kyc_status')
            .eq('user_id', user.id)
            .maybeSingle()

        // 2. Limits
        const MIN_WITHDRAWAL = 10
        const MAX_WITHDRAWAL = 50000
        const FEE_PERCENT = 0.01
        
        if (amount < MIN_WITHDRAWAL) return new Response(JSON.stringify({ error: `Minimum withdrawal is $${MIN_WITHDRAWAL}` }), { status: 400 })
        if (amount > MAX_WITHDRAWAL) return new Response(JSON.stringify({ error: `Maximum withdrawal is $${MAX_WITHDRAWAL}` }), { status: 400 })

        const fee = Number((amount * FEE_PERCENT).toFixed(2))
        const netAmount = amount - fee

        // 3. Check Wallet (Supabase - lowercase tables/columns)
        let { data: wallet, error: walletErr } = await supabase
            .from('wallets')
            .select('id,user_id,currency,balance')
            .eq('user_id', user.id)
            .eq('currency', currency)
            .maybeSingle()
        if (walletErr) {
            const alt = await supabase
                .from('Wallet')
                .select('id,user_id:userId,currency,balance')
                .eq('userId', user.id)
                .eq('currency', currency)
                .maybeSingle()
            if (!alt.error && alt.data) {
                wallet = alt.data
                walletErr = null
            }
        }

        // Fallback to USD wallet if specific currency wallet is missing or insufficient (1:1 peg to USD)
        if ((walletErr || !wallet || Number((wallet as any).balance) < amount) && currency !== 'USD') {
            console.log('[Withdrawal] Checking USD wallet fallback...')
            const { data: usdWallet, error: usdErr } = await supabase
                .from('wallets')
                .select('id,user_id,currency,balance')
                .eq('user_id', user.id)
                .eq('currency', 'USD')
                .maybeSingle()
            if (!usdErr && usdWallet && Number((usdWallet as any).balance) >= amount) {
                console.log('[Withdrawal] Using USD wallet fallback')
                wallet = usdWallet
                walletErr = null
            } else {
                const altUsd = await supabase
                    .from('Wallet')
                    .select('id,user_id:userId,currency,balance')
                    .eq('userId', user.id)
                    .eq('currency', 'USD')
                    .maybeSingle()
                if (!altUsd.error && altUsd.data && Number((altUsd.data as any).balance) >= amount) {
                    wallet = altUsd.data
                    walletErr = null
                }
            }
        }

        if (walletErr || !wallet) {
            console.error('[Withdrawal] Wallet not found:', walletErr)
            return new Response(JSON.stringify({ error: 'insufficient_balance' }), { status: 400 })
        }

        if (Number(wallet.balance) < amount) {
            return new Response(JSON.stringify({ error: 'insufficient_balance' }), { status: 400 })
        }

        // 4. Ensure Prisma-style User row exists for FK on Transaction
        const newId = crypto.randomUUID()
        const now = new Date().toISOString()
        try {
            const { data: existingUser, error: userCheckErr } = await supabase
                .from('User')
                .select('id')
                .eq('id', user.id)
                .maybeSingle()
            if (userCheckErr || !existingUser) {
                const { data: prof } = await supabase
                    .from('profiles')
                    .select('email')
                    .eq('user_id', user.id)
                    .maybeSingle()
                const email = String((prof as any)?.email || `${user.id}@users.local`)
                await supabase
                    .from('User')
                    .insert({
                        id: user.id,
                        email,
                        createdAt: now,
                        updatedAt: now
                    })
            }
        } catch {}

        const { data: txn, error: txnErr } = await supabase
            .from('Transaction')
            .insert({
                id: newId,
                userId: user.id,
                type: 'WITHDRAWAL',
                amount: amount,
                currency: currency,
                status: 'PENDING',
                createdAt: now,
                updatedAt: now,
                reference: JSON.stringify({
                    destinationAddress,
                    network,
                    currency,
                    kind: 'withdraw'
                })
            })
            .select()
            .maybeSingle()

        if (txnErr) {
            console.error('[Withdrawal] Failed to create txn:', txnErr)
            return new Response(JSON.stringify({ error: 'database_error', details: txnErr.message }), { status: 500 })
        }

        // Send Email Notification
        try {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email, first_name')
            .eq('user_id', user.id)
            .maybeSingle()
          
          const userEmail = profile?.email || (user as any).email
          
          if (userEmail) {
            const html = `
              <h2>Withdrawal Request Received</h2>
              <p>Hello ${profile?.first_name || 'User'},</p>
              <p>We have received your withdrawal request for <strong>${amount} ${currency}</strong>.</p>
              <p><strong>Destination:</strong> ${destinationAddress}</p>
              <p><strong>Status:</strong> PENDING</p>
              <p>Your request is being processed. You will be notified once it is confirmed.</p>
              <br/>
              <p>If you did not make this request, please contact support immediately.</p>
            `
            await sendEmail(userEmail, 'Withdrawal Request Received - Hybrid Trade AI', html)
            
            // Notify Admin
            const adminEmail = process.env.ADMIN_EMAIL_NOTIFY
            if (adminEmail) {
               await sendEmail(adminEmail, 'New Withdrawal Request', `
                 <h2>New Withdrawal Request</h2>
                 <p><strong>User:</strong> ${userEmail} (${user.id})</p>
                 <p><strong>Amount:</strong> ${amount} ${currency}</p>
                 <p><strong>Address:</strong> ${destinationAddress}</p>
                 <p><strong>Network:</strong> ${network}</p>
               `)
            }
          }
        } catch (emailErr) {
          console.error('Failed to send withdrawal email:', emailErr)
          // Continue execution, don't fail the transaction just because email failed
        }

        // 5. Deduct Balance from wallets (lowercase)
        const newBal = Number((wallet as any).balance) - amount
        let updateErr: any = null
        {
            const upd = await supabase
                .from('wallets')
                .update({ balance: newBal, updated_at: now })
                .eq('id', (wallet as any).id)
            updateErr = upd.error
        }
        if (updateErr) {
            const upd2 = await supabase
                .from('Wallet')
                .update({ balance: newBal, updatedAt: now })
                .eq('id', (wallet as any).id)
            updateErr = upd2.error
        }
        
        if (updateErr) {
            console.error('[Withdrawal] Failed to deduct balance:', updateErr)
            if ((txn as any)?.id) {
                await supabase.from('transactions').update({ status: 'failed' }).eq('id', (txn as any).id)
            }
            return new Response(JSON.stringify({ error: 'database_error', details: 'balance_update_failed' }), { status: 500 })
        }
        
        try {
            const details = { destinationAddress, network, fee, netAmount, method: 'crypto' }
            const wtxId = crypto.randomUUID()
            await supabase.from('WalletTransaction').insert({
                id: wtxId,
                walletId: (wallet as any).id,
                amount: amount,
                type: 'DEBIT',
                source: 'withdrawal_request',
                // Store details in reference since note/metadata are missing
                reference: JSON.stringify({ ...details, txnId: (txn as any).id }), 
                performedBy: user.id,
                createdAt: now
            })
        } catch {}

        await publish(`user:${String(user.id)}`, { id: `req:${(txn as any)?.id || 'new'}`, type: 'withdrawal_status', title: 'Withdrawal Requested', message: `Requested ${amount} ${currency}`, createdAt: now })
        return new Response(JSON.stringify({ ok: true, transaction: txn }), { status: 200 })
    }

    return new Response(JSON.stringify({ error: 'invalid_kind' }), { status: 400 })
  } catch (err: any) {
    console.error('POST /transactions error:', err)
    return new Response(JSON.stringify({ error: 'server_error', details: err.message, stack: err.stack }), { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
    return new Response(JSON.stringify({ error: 'not_implemented' }), { status: 501 })
}
