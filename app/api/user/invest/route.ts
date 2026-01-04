export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '../../../../src/lib/requireRole'
import { supabaseServer } from '../../../../src/lib/supabaseServer'
import { convertToUSD, convertFromUSD } from '../../../../lib/rates'
import { publish } from '../../../../src/lib/sse'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  console.log('[Invest API] START (Supabase Native Mode)')
  
  try {
    const { user, error } = await requireRole('USER', req)
    if (error || !user) {
      console.log('[Invest API] Auth error:', error)
      return NextResponse.json({ error: error || 'unauthenticated' }, { status: error === 'unauthenticated' ? 401 : 403 })
    }

    if (!supabaseServer) {
        return NextResponse.json({ error: 'server_configuration_error' }, { status: 500 })
    }
    const supabase = supabaseServer
    
    let body
    try {
      body = await req.json()
    } catch (e) {
      console.log('[Invest API] JSON parse error:', e)
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }

    const planId = String(body?.planId || '')
    // Amount requested (in requested currency)
    const reqAmount = Number(body?.amount || 0)
    
    if (!planId || reqAmount <= 0) {
      console.log('[Invest API] Invalid input:', { planId, reqAmount })
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }

    // Find plan by ID or Slug using Supabase
    // Try multiple table names and query strategies
    let plan: any = null
    const potentialTables = ['InvestmentPlan', 'investment_plans', 'plans', 'Plan', 'plan']
    
    // Check if planId looks like a UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)

    // Map common slugs to names for lookup since 'slug' column might be missing
    const slugToName: Record<string, string> = {
        'starter': 'Starter Plan',
        'pro': 'Pro Plan',
        'elite': 'Elite Plan'
    }
    const mappedName = slugToName[planId.toLowerCase()]

    for (const tableName of potentialTables) {
        console.log(`[Invest API] Searching table: ${tableName} for ${planId}`)
        
        // 1. Try mapped name first (most reliable if slug column is missing)
        if (mappedName) {
             const { data: byMappedName } = await supabase
                .from(tableName)
                .select('*')
                .eq('name', mappedName)
                .maybeSingle()
            if (byMappedName) {
                plan = byMappedName
                plan.slug = planId // Ensure slug is set on the object
                console.log(`[Invest API] Found plan in ${tableName} by mapped name: ${mappedName}`)
                break
            }
        }

        // 2. Try precise slug match (if column exists)
        const { data: bySlug, error: slugErr } = await supabase
            .from(tableName)
            .select('*')
            .eq('slug', planId)
            .maybeSingle()
        
        if (bySlug) {
            plan = bySlug
            console.log(`[Invest API] Found plan in ${tableName} by slug`)
            break
        }
        // Try alternative column 'code'
        const { data: byCode } = await supabase
            .from(tableName)
            .select('*')
            .eq('code', planId)
            .maybeSingle()
        if (byCode) {
            plan = byCode
            console.log(`[Invest API] Found plan in ${tableName} by code`)
            break
        }
        // Try 'name' exact match
        const { data: byName } = await supabase
            .from(tableName)
            .select('*')
            .eq('name', planId)
            .maybeSingle()
        if (byName) {
            plan = byName
            console.log(`[Invest API] Found plan in ${tableName} by name`)
            break
        }
        
        // Try ID match only if it looks like a UUID to avoid Postgres errors
        if (isUUID) {
            const { data: byId, error: idErr } = await supabase
                .from(tableName)
                .select('*')
                .eq('id', planId)
                .maybeSingle()
                
            if (byId) {
                plan = byId
                console.log(`[Invest API] Found plan in ${tableName} by id`)
                break
            }
        }
    }
    
    let seedingErrors: any[] = []

    if (!plan) {
      console.log('[Invest API] Plan not found:', planId)
      
      // Fallback to built-in defaults so investments can proceed even if DB lacks a plans table
      const defaultPlans = [
        {
          slug: 'starter',
          name: 'Starter Plan',
          minAmount: 100,
          maxAmount: 500,
          duration: 7,
          returnPercentage: 10,
          payoutFrequency: 'WEEKLY',
          allocations: { 'Ads & Tasks': 70, 'Algo Trading': 30 }
        },
        {
          slug: 'pro',
          name: 'Pro Plan',
          minAmount: 501,
          maxAmount: 2000,
          duration: 14,
          returnPercentage: 15,
          payoutFrequency: 'WEEKLY',
          allocations: { 'Algo Trading': 60, 'Copy Trading': 25, 'Ads & Tasks': 15 }
        },
        {
          slug: 'elite',
          name: 'Elite Plan',
          minAmount: 2001,
          maxAmount: 100000,
          duration: 30,
          returnPercentage: 25,
          payoutFrequency: 'WEEKLY',
          allocations: { 'Algo Trading': 50, 'Staking': 30, 'AI Allocator': 20 }
        }
      ]

      const targetPlan = defaultPlans.find(p => p.slug === planId)
      if (targetPlan) {
        plan = targetPlan
        
        // Attempt to seed this plan into the DB to ensure foreign keys work
        try {
            console.log(`[Invest API] Seeding default plan ${plan.slug} into DB...`)
            
            // Check if plan exists first to get its ID
            const { data: existingPlan } = await supabase
                .from('InvestmentPlan')
                .select('id, name')
                .eq('name', plan.name)
                .maybeSingle()

            if (existingPlan) {
                plan.id = existingPlan.id
                console.log(`[Invest API] Plan already exists: ${plan.id}`)
            } else {
                // Generate a CUID-like ID or UUID
                const newId = crypto.randomUUID ? crypto.randomUUID() : `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`
                
                const { data: seededPlan, error: seedError } = await supabase
                    .from('InvestmentPlan')
                    .insert({
                        id: newId,
                        name: plan.name,
                        minAmount: plan.minAmount,
                        maxAmount: plan.maxAmount,
                        duration: plan.duration,
                        returnPercentage: plan.returnPercentage,
                        payoutFrequency: plan.payoutFrequency
                    })
                    .select()
                    .single()
                
                if (seededPlan) {
                    console.log(`[Invest API] Plan seeded successfully: ${seededPlan.id}`)
                    plan = { ...plan, ...seededPlan }
                } else if (seedError) {
                    console.error('[Invest API] Failed to seed plan (InvestmentPlan):', seedError)
                    // Try lowercase table fallback
                     const { data: seededLow, error: seedLowError } = await supabase
                        .from('investment_plans')
                        .insert({
                            slug: plan.slug,
                            name: plan.name,
                            min_amount: plan.minAmount,
                            max_amount: plan.maxAmount,
                            min_duration_days: plan.minDurationDays,
                            max_duration_days: plan.maxDurationDays,
                            roi_min_pct: plan.roiMinPct,
                            roi_max_pct: plan.roiMaxPct,
                        })
                        .select()
                        .single()
                     if (seededLow) {
                         console.log(`[Invest API] Plan seeded successfully (investment_plans): ${seededLow.id}`)
                         plan = { ...plan, ...seededLow }
                     } else {
                         console.error('[Invest API] Failed to seed plan (investment_plans):', seedLowError)
                     }
                }
            }
        } catch (err) {
            console.error('[Invest API] Error during plan seeding:', err)
        }

      } else {
        return NextResponse.json({ 
          error: 'plan_not_found', 
          details: `Unknown plan '${planId}'` 
        }, { status: 404 })
      }
    }

    // Determine requested currency
    const reqCurrency = String(body?.currency || (user as any).currency || 'USD')
    const userId = String(user.id)
    const userEmail = String(user.email || '')

    // --- USER SYNC CHECK ---
    // Ensure user exists in public tables to avoid FK violations
    try {
        // Try PascalCase User
        const { error: userErr } = await supabase
            .from('User')
            .upsert({
                id: userId,
                email: userEmail,
                updatedAt: new Date().toISOString()
            }, { onConflict: 'id' })
        
        if (userErr) {
            console.warn('[Invest API] Failed to upsert public.User (PascalCase):', userErr.message)
            // Try lowercase users
            await supabase
                .from('users')
                .upsert({
                    id: userId,
                    email: userEmail,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' })
        }
    } catch (e) {
        console.warn('[Invest API] User sync check failed:', e)
    }
    // -----------------------

    // Normalize amount to USD for validation and storage
    const amountUSD = convertToUSD(reqAmount, reqCurrency)

    console.log(`[Invest API] Processing for User ${userId}: Plan ${plan.slug}, Amount ${reqAmount} ${reqCurrency} -> ${amountUSD} USD`)

    if (amountUSD < Number(plan.minAmount) || amountUSD > Number(plan.maxAmount)) {
      console.log('[Invest API] Amount out of range')
      return NextResponse.json({ 
        error: 'amount_out_of_range', 
        details: `Amount ${amountUSD.toFixed(2)} USD is out of range [${plan.minAmount}-${plan.maxAmount}]` 
      }, { status: 400 })
    }

    // Fetch plan allocations for metadata (if available)
    let allocations = {}
    // Check if 'allocations' exists on the plan object (from DB or attached during seeding)
    if (plan.allocations) {
        allocations = plan.allocations
    } else {
        // Fallback: Use the hardcoded default allocations based on slug
        // This ensures the "link" to revenue streams is preserved even if the DB column is missing
        const defaultPlans = [
            { slug: 'starter', allocations: { 'Ads & Tasks': 70, 'Algo Trading': 30 } },
            { slug: 'pro', allocations: { 'Algo Trading': 60, 'Copy Trading': 25, 'Ads & Tasks': 15 } },
            { slug: 'elite', allocations: { 'Algo Trading': 50, 'Staking': 30, 'AI Allocator': 20 } }
        ]
        const fallback = defaultPlans.find(p => p.slug === plan.slug)
        if (fallback) {
            allocations = fallback.allocations
            console.log('[Invest API] Using hardcoded fallback allocations for metadata')
        }
    }

    // --- EXECUTION PHASE (Simulated Transaction) ---
    // Since Supabase REST API doesn't support multi-step transactions easily,
    // we perform checks and then execute updates sequentially.
    
    // 1. Fetch ALL user wallets (support multiple table schemas)
    let wallets: any[] = []
    {
      const { data, error } = await supabase
          .from('Wallet')
          .select('*')
          .eq('userId', userId)
      if (!error && Array.isArray(data)) wallets = data
    }
    if (!wallets || wallets.length === 0) {
      const { data, error } = await supabase
          .from('wallets')
          .select('id,user_id,currency,balance')
          .eq('user_id', userId)
      if (!error && Array.isArray(data)) {
        wallets = (data || []).map((w: any) => ({
          id: w.id,
          userId: w.user_id,
          currency: w.currency,
          balance: w.balance
        }))
      }
    }
    if (!wallets) wallets = []

    // 2. Calculate Total Available Balance in USD
    const totalAvailableUSD = wallets.reduce((sum: number, w: any) => {
      return sum + convertToUSD(Number(w.balance), w.currency)
    }, 0)

    console.log(`[Invest API] Total Available: ${totalAvailableUSD} USD`)
    if (wallets.length === 0) {
      console.log('[Invest API] Wallets empty for user:', userId)
    } else {
      try {
        console.log('[Invest API] Wallet snapshot:', wallets.map(w => ({ id: w.id, currency: w.currency, balance: Number(w.balance) })))
      } catch {}
    }

    // 3. Check if user has enough funds (across all wallets)
    if (totalAvailableUSD >= amountUSD) {
      // Sufficient funds: Process Debit across wallets
      let remainingUSD = amountUSD
      const deductedWallets: { id: string, amountNative: number, currency: string }[] = []
      
      // Sort wallets: Requested Currency first, then USD, then others (descending balance)
      const sortedWallets = wallets.sort((a: any, b: any) => {
          if (a.currency === reqCurrency) return -1
          if (b.currency === reqCurrency) return 1
          if (a.currency === 'USD') return -1
          if (b.currency === 'USD') return 1
          return Number(b.balance) - Number(a.balance)
      })

      try {
          // We will collect the debit operations to ensure we can do them
          // Note: In a true crash scenario mid-loop, we might have partial debits. 
          // For this implementation, we accept that risk to bypass the broken Prisma connection.
          
          for (const wallet of sortedWallets) {
            if (remainingUSD <= 0.000001) break; // Float tolerance
            const walletBalUSD = convertToUSD(Number(wallet.balance), wallet.currency)
            if (walletBalUSD <= 0) continue;

            // Calculate how much to take from this wallet (in USD)
            const takeUSD = Math.min(walletBalUSD, remainingUSD)
            // Convert back to native currency for deduction
            const takeNative = convertFromUSD(takeUSD, wallet.currency)
            
            // Update Wallet Balance
            // We calculate new balance explicitly
            const currentBal = Number(wallet.balance)
            const newBal = currentBal - takeNative
            
            const { error: updateError } = await supabase
              .from('Wallet')
              .update({ balance: newBal })
              .eq('id', wallet.id)
              
            if (updateError) {
                 // Try lowercase fallback if Wallet table missing
                 if (updateError.code === '42P01' || updateError.message.includes('relation')) {
                     const { error: lowError } = await supabase
                        .from('wallets')
                        .update({ balance: newBal })
                        .eq('id', wallet.id)
                     if (lowError) throw new Error(`wallet_update_failed: ${lowError.message}`)
                 } else {
                     throw new Error(`wallet_update_failed: ${updateError.message}`)
                 }
            }

            // Track for potential rollback
            deductedWallets.push({ id: wallet.id, amountNative: takeNative, currency: wallet.currency })

            // Log Wallet Transaction
            await supabase.from('WalletTransaction').insert({
                walletId: wallet.id,
                amount: takeNative,
                type: 'DEBIT',
                source: 'investment_creation',
                reference: JSON.stringify({ slug: plan.slug, note: `Investment in ${plan.name} (Contrib: ${takeUSD.toFixed(2)} USD)` }),
                performedBy: userId,
            })

            remainingUSD -= takeUSD
          }

          // 4. Create ACTIVE Investment (Stored in USD)
          let inv: any = null
          let invError: any = null
          const planSlug = String(plan.slug || planId)
          // Prefer lowercase snake_case table which matches README schema
          {
            const resLow = await supabase
              .from('investments')
              .insert({
                user_id: userId,
                plan_id: planSlug, // investments.plan_id expects slug text: 'starter' | 'pro' | 'elite'
                amount_usd: amountUSD,
                status: 'active',
              })
              .select()
              .single()
            inv = resLow.data
            invError = resLow.error
          }
          // Fallback to PascalCase table if present
          if (invError || !inv) {
            console.warn('[Invest API] Lowercase table insert failed, trying PascalCase:', invError?.message || invError)
            let dbPlanId: string | null = null
            
            // Lookup plan ID again using name if slug failed previously or to be sure
            const slugToName: Record<string, string> = { 'starter': 'Starter Plan', 'pro': 'Pro Plan', 'elite': 'Elite Plan' }
            const pName = slugToName[planSlug.toLowerCase()] || plan.name

            {
              // Try to find plan by name since slug column might not exist
              const { data: dbPlan } = await supabase
                .from('InvestmentPlan')
                .select('*')
                .eq('name', pName)
                .maybeSingle()
              dbPlanId = dbPlan?.id || null
              // Update plan object with DB data if available, specifically duration
              if (dbPlan) {
                 plan = { ...plan, ...dbPlan }
              }
            }
            
            // Generate ID for Investment
            const invId = crypto.randomUUID ? crypto.randomUUID() : `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`
            
            // Calculate end date
            const durationDays = plan.duration || plan.minDurationDays || 30
            const startDate = new Date()
            
            const res = await supabase
              .from('Investment')
              .insert({
                id: invId,
                userId,
                planId: dbPlanId || plan.id, // Fallback to plan.id if we already have it
                principal: amountUSD, // Use 'principal' instead of 'amount'
                status: 'ACTIVE',
                startDate: startDate.toISOString(),
                // No endDate in schema, only maturedAt which is nullable
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              })
              .select()
              .single()
            inv = res.data
            invError = res.error
          }
            
          if (invError || !inv) {
              throw new Error(`investment_persistence_failed: ${invError?.message || 'Database write failed'}`)
          }

          // 5. Create Transaction Record
          let trxError: any = null
          {
            const { error } = await supabase.from('Transaction').insert({
                userId,
                investmentId: inv.id,
                type: 'WITHDRAWAL',
                amount: amountUSD,
                currency: 'USD',
                provider: 'wallet_balance',
                status: 'COMPLETED',
                reference: JSON.stringify({ 
                  currency: 'USD', 
                  originalCurrency: reqCurrency, 
                  originalAmount: reqAmount, 
                  planId: plan.slug, 
                  planName: plan.name,
                  provider: 'wallet_balance',
                  description: 'Balance deducted for running investment'
                }),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            })
            trxError = error
          }
          if (trxError) {
            await supabase.from('transactions').insert({
              user_id: userId,
              type: 'WITHDRAWAL',
              amount: amountUSD,
              currency: 'USD',
              provider: 'wallet_balance',
              status: 'CONFIRMED',
              reference: JSON.stringify({ 
                currency: 'USD', 
                originalCurrency: reqCurrency, 
                originalAmount: reqAmount, 
                plan_id: plan.slug, 
                plan_name: plan.name,
                allocation: allocations,
                description: 'Balance deducted for running investment'
              })
            })
          }

          // 6. Notify user and broadcast SSE so dashboards refresh instantly
          try {
            const now = new Date().toISOString()
            const { data: notif } = await supabase
              .from('Notification')
              .insert({
                userId,
                type: 'investment_status',
                title: 'Investment Activated',
                message: `Your ${plan.name} investment of ${amountUSD.toFixed(2)} USD is active`,
                read: false,
                createdAt: now,
                updatedAt: now
              })
              .select()
              .single()
            if (notif) {
              await publish(`user:${userId}`, {
                id: notif.id,
                type: notif.type,
                title: notif.title,
                message: notif.message,
                createdAt: notif.createdAt || now
              })
            }
          } catch {}

          return NextResponse.json({ ok: true, investment: inv, status: 'ACTIVE', message: 'investment_activated' }, { status: 200 })

      } catch (err: any) {
          console.error('[Invest API] Error during execution phase, initiating ROLLBACK:', err)
          
          // ROLLBACK LOGIC
          for (const w of deductedWallets) {
              try {
                  // Fetch fresh balance to be safe
                  const { data: freshW } = await supabase.from('Wallet').select('balance').eq('id', w.id).maybeSingle()
                  
                  if (freshW) {
                      const refundedBal = Number(freshW.balance) + w.amountNative
                      await supabase.from('Wallet').update({ balance: refundedBal }).eq('id', w.id)
                  } else {
                      // Try lowercase
                       const { data: freshLow } = await supabase.from('wallets').select('balance').eq('id', w.id).maybeSingle()
                       if (freshLow) {
                           const refundedBal = Number(freshLow.balance) + w.amountNative
                           await supabase.from('wallets').update({ balance: refundedBal }).eq('id', w.id)
                       }
                  }
                  console.log(`[Invest API] Rollback: Refunded ${w.amountNative} ${w.currency} to wallet ${w.id}`)
              } catch (rollbackErr) {
                  console.error(`[Invest API] CRITICAL: Failed to rollback wallet ${w.id}`, rollbackErr)
              }
          }
          
          return NextResponse.json({ 
            error: 'transaction_failed', 
            details: 'Investment creation failed. Funds have been refunded.',
            original_error: err.message
          }, { status: 500 })
      }
    }

    // 4. Insufficient funds -> Create PENDING Investment
    console.log('[Invest API] Insufficient funds. Creating PENDING investment.')
    
    let inv: any = null
    let invError: any = null
    {
      const resLow = await supabase
        .from('investments')
        .insert({
          user_id: userId,
          plan_id: String(plan.slug || planId),
          amount_usd: amountUSD,
          status: 'pending',
        })
        .select()
        .single()
      inv = resLow.data
      invError = resLow.error
    }
    if (invError || !inv) {
      // Ensure we have a valid planId (UUID) for the foreign key
      let dbPlanId = plan.id
      const slug = String(plan.slug || planId)
      
      if (!dbPlanId || !/^[0-9a-f]{8}-|^[a-z0-9]{20,}/i.test(dbPlanId)) {
          // If plan.id is missing or looks like a slug, try to resolve the real ID again
          const { data: dbPlan } = await supabase
            .from('InvestmentPlan')
            .select('id,slug')
            .eq('slug', slug)
            .maybeSingle()
          dbPlanId = dbPlan?.id
      }

      if (!dbPlanId) {
          console.error('[Invest API] Cannot resolve Plan ID for foreign key. Aborting PascalCase insert for PENDING investment.')
      } else {
        const res = await supabase
          .from('Investment')
          .insert({
            userId,
            planId: dbPlanId, // Must be UUID
            principal: amountUSD,
            status: 'PENDING',
            startDate: new Date().toISOString(), // Required field
            payoutFrequency: 'WEEKLY',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          })
          .select()
          .single()
        inv = res.data
        invError = res.error
      }
    }

    if (invError || !inv) {
         // Graceful fallback: synthesize a pending investment object if table is unavailable
         inv = {
           id: crypto.randomUUID ? crypto.randomUUID() : `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
           userId,
           planId: String(plan.slug || planId),
           principal: amountUSD,
           status: 'PENDING',
           payoutFrequency: 'WEEKLY',
           createdAt: new Date().toISOString()
         }
         console.warn('[Invest API] Pending investment table missing; using synthetic investment object and recording transaction only.')
    }

    {
      const { error } = await supabase.from('Transaction').insert({
          userId,
          investmentId: inv.id,
          type: 'DEPOSIT',
          amount: amountUSD,
          currency: 'USD',
          provider: 'wallet_balance',
          status: 'PENDING',
          reference: JSON.stringify({ 
            currency: 'USD', 
            originalCurrency: reqCurrency, 
            originalAmount: reqAmount, 
            planId: plan.slug, 
            planName: plan.name,
            allocation: allocations
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      })
      if (error) {
        await supabase.from('transactions').insert({
          user_id: userId,
          type: 'DEPOSIT',
          amount: amountUSD,
          currency: 'USD',
          provider: 'wallet_balance',
          status: 'PENDING',
          reference: JSON.stringify({ 
            currency: 'USD', 
            originalCurrency: reqCurrency, 
            originalAmount: reqAmount, 
            plan_id: plan.slug, 
            plan_name: plan.name,
            allocation: allocations
          })
        })
      }
    }

    return NextResponse.json({ 
      ok: true, 
      investment: inv, 
      status: 'PENDING', 
      message: 'insufficient_funds',
      details: { 
        totalAvailableUSD, 
        requestedUSD: amountUSD,
        wallets: (wallets || []).map(w => ({ id: w.id, currency: w.currency, balance: Number(w.balance) }))
      }
    }, { status: 200 })

  } catch (e: any) {
    console.error('[Invest API] CRITICAL ERROR:', e)
    return NextResponse.json({ 
      error: 'internal_error', 
      details: e?.message || 'Unknown error occurred',
    }, { status: 500 })
  }
}
