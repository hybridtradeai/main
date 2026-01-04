import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { supabaseServer } from '../../../../lib/supabaseServer'

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!supabaseServer) return new Response(JSON.stringify({ error: 'server_configuration_error' }), { status: 500 })
    const supabase = supabaseServer

    const raw = await req.text()
    let body: any = {}
    try { 
      body = JSON.parse(raw) 
    } catch { 
      return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 })
    }

    // NOWPayments IPN signature verification
    const sig = req.headers.get('x-nowpayments-sig') || ''
    const secret = process.env.NOWPAYMENTS_IPN_SECRET || ''
    
    if (secret && sig) {
      // NOWPayments uses HMAC-SHA512 with the IPN secret
      const hmac = crypto.createHmac('sha512', secret)
      hmac.update(raw)
      const calculatedSig = hmac.digest('hex')
      
      if (calculatedSig !== sig) {
        console.error('NOWPayments IPN signature mismatch', { received: sig, calculated: calculatedSig })
        return new Response(JSON.stringify({ error: 'invalid_signature' }), { status: 401 })
      }
    }

    // Extract payment data from NOWPayments IPN
    const orderId = String(body?.order_id || '')
    const paymentId = String(body?.payment_id || '')
    const paymentStatus = String(body?.payment_status || '').toLowerCase()
    const priceAmount = Number(body?.price_amount || 0)
    const priceCurrency = String(body?.price_currency || 'usd').toUpperCase()
    const payAmount = Number(body?.pay_amount || 0)
    const payCurrency = String(body?.pay_currency || '').toUpperCase()
    
    console.log('NOWPayments IPN received:', { orderId, paymentId, paymentStatus, priceAmount, priceCurrency })

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'invalid_order' }), { status: 400 })
    }

    // Find transaction by order_id
    const { data: tx, error: txError } = await supabase
      .from('Transaction')
      .select('*')
      .eq('id', orderId)
      .single()
    
    if (txError || !tx) {
      console.error('Transaction not found for order_id:', orderId, txError)
      return new Response(JSON.stringify({ error: 'transaction_not_found' }), { status: 404 })
    }

    // Update transaction with payment status
    const meta = tx.reference ? JSON.parse(tx.reference) : {}
    const updateRef = {
      ...meta,
      paymentId,
      paymentStatus,
      payAmount,
      payCurrency,
      ipnReceived: new Date().toISOString(),
      ipnData: body,
    }

    // Handle confirmed/paid payments
    if (paymentStatus === 'confirmed' || paymentStatus === 'finished' || paymentStatus === 'paid') {
      
      // Prevent double processing
      if (tx.status === 'COMPLETED') {
        return new Response(JSON.stringify({ ok: true, message: 'already_processed' }), { status: 200 })
      }

      // Update transaction status
      await supabase
        .from('Transaction')
        .update({ 
          status: 'COMPLETED',
          reference: JSON.stringify(updateRef),
          updatedAt: new Date().toISOString()
        })
        .eq('id', orderId)

      // Credit user wallet
      const uid = String(tx.userId)
      const curr = String(meta.currency || priceCurrency)
      const creditAmount = priceAmount > 0 ? priceAmount : Number(tx.amount || 0)

      // Find or create wallet
      let { data: wallet } = await supabase
        .from('Wallet')
        .select('*')
        .eq('userId', uid)
        .eq('currency', curr)
        .single()
      
      if (!wallet) {
        const { data: newWallet, error: walletError } = await supabase
          .from('Wallet')
          .insert({
            id: crypto.randomUUID(),
            userId: uid,
            currency: curr,
            balance: 0,
            updatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
          })
          .select()
          .single()
        
        if (walletError) {
             console.error('Failed to create wallet:', walletError)
             // fallback to find again in case of race condition
             const { data: existing } = await supabase.from('Wallet').select('*').eq('userId', uid).eq('currency', curr).single()
             wallet = existing
        } else {
             wallet = newWallet
        }
      }

      if (!wallet) {
         throw new Error('Could not find or create wallet')
      }

      const walletId = wallet.id
      const current = Number(wallet.balance || 0)

      // Credit the wallet
      const newBal = Number((current + creditAmount).toFixed(8))
      await supabase
        .from('Wallet')
        .update({ 
            balance: newBal,
            updatedAt: new Date().toISOString()
        })
        .eq('id', walletId)

      // Log Wallet Credit (Deposit)
      await supabase
        .from('WalletTransaction')
        .insert({
            id: crypto.randomUUID(),
            walletId,
            amount: creditAmount,
            type: 'CREDIT',
            source: 'deposit',
            reference: orderId, // storing orderId in reference for linkage
            performedBy: uid,
            createdAt: new Date().toISOString()
        })

      console.log('Wallet credited successfully:', { walletId, oldBalance: current, newBalance: newBal, creditAmount })
      
      // Auto-activate investment if autoActivate is true in metadata
      const autoActivate = Boolean(meta.autoActivate)
      const planId = String(meta.planId || '')
      
      if (autoActivate && planId) {
        // Create investment record
        try {
            // Find plan by ID or Name
            const { data: plan } = await supabase
                .from('InvestmentPlan')
                .select('*')
                .or(`id.eq.${planId},name.eq.${planId}`)
                .single()
            
            if (plan) {
                // Debit Wallet for Investment
                // Check if balance is sufficient (it is, we just credited it)
                const afterInvestBal = Number((newBal - creditAmount).toFixed(8))
                
                await supabase
                    .from('Wallet')
                    .update({ 
                        balance: afterInvestBal,
                        updatedAt: new Date().toISOString()
                    })
                    .eq('id', walletId)

                // Log Wallet Debit (Investment)
                await supabase
                    .from('WalletTransaction')
                    .insert({
                        id: crypto.randomUUID(),
                        walletId,
                        amount: creditAmount,
                        type: 'DEBIT',
                        source: 'investment_creation',
                        reference: JSON.stringify({ slug: plan.slug || plan.name, note: `Auto-investment in ${plan.name}` }),
                        performedBy: uid,
                        createdAt: new Date().toISOString()
                    })

                // Create Active Investment
                const invId = crypto.randomUUID()
                const { data: inv, error: invError } = await supabase
                    .from('Investment')
                    .insert({
                        id: invId,
                        userId: uid,
                        planId: plan.id,
                        principal: creditAmount,
                        status: 'ACTIVE',
                        // payoutFrequency: 'WEEKLY', // Removed if not in schema or default
                        startDate: new Date().toISOString(),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    })
                    .select()
                    .single()

                if (invError) {
                    console.error('Investment creation failed:', invError)
                    throw invError
                }
                
                // Create Investment Transaction Record
                await supabase
                    .from('Transaction')
                    .insert({
                        id: crypto.randomUUID(),
                        userId: uid,
                        investmentId: inv.id,
                        type: 'DEPOSIT', // Using DEPOSIT to signify money going into the plan
                        amount: creditAmount,
                        currency: curr,
                        provider: 'nowpayments',
                        status: 'COMPLETED',
                        reference: JSON.stringify({ 
                            currency: curr, 
                            planId: plan.id, 
                            planName: plan.name,
                            autoActivated: true,
                            sourceDepositId: orderId,
                            provider: 'nowpayments'
                        }),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    })
                
                console.log('Auto-activated investment:', { investmentId: inv.id, amount: creditAmount })
            } else {
                console.error('Plan not found for auto-activate:', planId)
            }
        } catch (e) {
            console.error('Auto-activate failed:', e)
        }
      }

      return new Response(JSON.stringify({ ok: true, message: 'Payment confirmed and wallet credited' }), { status: 200 })
    }

    // For other statuses (waiting, confirming, etc.), just acknowledge
    await supabase
        .from('Transaction')
        .update({ 
            reference: JSON.stringify(updateRef),
            updatedAt: new Date().toISOString()
        })
        .eq('id', orderId)

    return new Response(JSON.stringify({ ok: true, message: 'IPN received' }), { status: 200 })
  } catch (e: any) {
    console.error('NOWPayments webhook error:', e)
    return new Response(JSON.stringify({ error: 'server_error', details: e?.message || 'error' }), { status: 500 })
  }
}
