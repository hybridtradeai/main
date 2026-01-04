import { NextRequest } from 'next/server'
import { supabaseServer } from '../../../../lib/supabaseServer'
import crypto from 'crypto'

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
    const supabase = supabaseServer

    const secret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY || ''
    const sig = req.headers.get('x-paystack-signature') || ''
    const raw = await req.text()
    if (!secret || !sig) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
    const h = crypto.createHmac('sha512', secret).update(raw).digest('hex')
    if (h !== sig) return new Response(JSON.stringify({ error: 'invalid_signature' }), { status: 401 })

    const body = JSON.parse(raw)
    const event = String(body?.event || '')
    const data = body?.data || {}
    const reference = String(data?.reference || '')
    const amountKobo = Number(data?.amount || 0)
    const amount = Number((amountKobo / 100).toFixed(2))
    const currency = String(data?.currency || 'NGN')
    const email = String(data?.customer?.email || '')
    
    if (!reference) return new Response(JSON.stringify({ error: 'invalid_reference' }), { status: 400 })

    // Search for transaction by reference in the JSON string or exact match
    // Since we can't easily do a "JSON contains" query with this client setup efficiently without filters,
    // we'll try to find by ID if reference is an ID, or search 'reference' column.
    // In our deposit route, we store: reference: JSON.stringify({ provider: 'paystack', reference, ... })
    // So we can't search exact match on 'reference' column.
    // However, we might have stored the Paystack reference as the ID? No, we use UUID.
    // We should have stored the Paystack reference in the 'reference' column? 
    // No, we stored a JSON.
    // So we need to use the `ilike` operator to find the reference string inside the JSON string.
    
    const { data: txs, error: txError } = await supabase
      .from('Transaction')
      .select('*')
      .ilike('reference', `%${reference}%`)
      .limit(1)

    const tx = txs?.[0]

    if (txError || !tx) {
        console.error('Transaction not found for reference:', reference)
        return new Response(JSON.stringify({ error: 'transaction_not_found' }), { status: 404 })
    }

    // Prevent double processing
    if (tx.status === 'COMPLETED') {
      return new Response(JSON.stringify({ ok: true, message: 'already_processed' }), { status: 200 })
    }

    const uid = String(tx.userId)
    // Parse reference to get metadata-like info
    const meta = tx.reference && (tx.reference.startsWith('{') || tx.reference.startsWith('[')) 
      ? (() => { try { return JSON.parse(tx.reference) } catch { return {} } })()
      : {}
    const curr = String(meta.currency || currency)

    if (event === 'charge.success') {
      // Update transaction status
      await supabase
        .from('Transaction')
        .update({ status: 'COMPLETED', updatedAt: new Date().toISOString() })
        .eq('id', tx.id)

      // Find or create wallet
      let { data: wallet } = await supabase
        .from('Wallet')
        .select('*')
        .eq('userId', uid)
        .eq('currency', curr)
        .maybeSingle()

      if (!wallet) {
        // Create wallet
        const { data: newWallet, error: wErr } = await supabase
          .from('Wallet')
          .insert({
            id: crypto.randomUUID(),
            userId: uid,
            currency: curr,
            balance: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
          .select()
          .single()
        
        if (wErr) {
            console.error('Failed to create wallet:', wErr)
            // Try fetching again in case of race condition
             const { data: existing } = await supabase.from('Wallet').select('*').eq('userId', uid).eq('currency', curr).maybeSingle()
             wallet = existing
        } else {
            wallet = newWallet
        }
      }

      if (!wallet) {
         console.error('Could not find or create wallet for user:', uid)
         return new Response(JSON.stringify({ error: 'wallet_error' }), { status: 500 })
      }

      const walletId = wallet.id
      const current = Number(wallet.balance || 0)
      const newBal = Number((current + amount).toFixed(8))

      // Credit the wallet (Deposit)
      await supabase
        .from('Wallet')
        .update({ balance: newBal, updatedAt: new Date().toISOString() })
        .eq('id', walletId)
      
      // Log Wallet Credit
      await supabase
        .from('WalletTransaction')
        .insert({
            id: crypto.randomUUID(),
            walletId,
            amount,
            type: 'CREDIT',
            source: 'deposit',
            reference: reference, // Paystack reference
            performedBy: uid,
            createdAt: new Date().toISOString()
        })

      // Auto-activate investment if requested
      if (meta.autoActivate && meta.planId) {
          try {
              // Find plan
              const { data: plan } = await supabase
                  .from('InvestmentPlan')
                  .select('*')
                  .or(`id.eq.${meta.planId},name.eq.${meta.planId}`)
                  .maybeSingle()
            
            if (plan) {
                // Check if balance is sufficient (it should be, we just credited it)
                if (newBal >= amount) {
                    // Debit Wallet for Investment
                    const afterInvestBal = Number((newBal - amount).toFixed(8))
                    await supabase
                        .from('Wallet')
                        .update({ balance: afterInvestBal, updatedAt: new Date().toISOString() })
                        .eq('id', walletId)

                    // Log Wallet Debit
                    await supabase
                        .from('WalletTransaction')
                        .insert({
                            id: crypto.randomUUID(),
                            walletId,
                            amount,
                            type: 'DEBIT',
                            source: 'investment_creation',
                            reference: JSON.stringify({ slug: plan.slug, note: `Auto-investment in ${plan.name}` }),
                            performedBy: uid,
                            createdAt: new Date().toISOString()
                        })

                    // Create Active Investment
                    const invId = crypto.randomUUID()
                    const { data: inv, error: invErr } = await supabase
                        .from('Investment')
                        .insert({
                            id: invId,
                            userId: uid,
                            planId: plan.id,
                            principal: amount,
                            status: 'ACTIVE',
                            // payoutFrequency: 'WEEKLY', // Check if exists
                            startDate: new Date().toISOString(),
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        })
                        .select()
                        .single()
                    
                    if (invErr) {
                        console.error('Investment insert failed:', invErr)
                        throw invErr
                    }

                    // Create Investment Transaction Record
                    await supabase
                        .from('Transaction')
                        .insert({
                            id: crypto.randomUUID(),
                            userId: uid,
                            investmentId: invId,
                            type: 'DEPOSIT', // Using DEPOSIT to signify money going into the plan
                            amount,
                            currency: curr,
                            provider: 'paystack',
                            status: 'COMPLETED',
                            reference: JSON.stringify({ 
                                currency: curr, 
                                planId: plan.id, 
                                planName: plan.name,
                                autoActivated: true,
                                sourceDepositId: tx.id,
                                provider: 'paystack'
                            }),
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString()
                        })
                }
            }
        } catch (e) {
            console.error('Auto-activation failed:', e)
            // Don't fail the webhook response, just log it. 
        }
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (e: any) {
    console.error('Paystack webhook error:', e)
    return new Response(JSON.stringify({ error: 'server_error', details: e?.message || 'error' }), { status: 500 })
  }
}
