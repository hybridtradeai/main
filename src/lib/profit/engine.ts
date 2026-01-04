import { supabaseServer } from '@lib/supabaseServer'
import { publish } from '@lib/sse'
import * as Sentry from '@sentry/node'
import { logInfo, logError } from '../observability/logger'
import crypto from 'crypto'

type BaselineInput = { weekEnding: string | Date; dryRun?: boolean }
type StreamInput = { weekEnding: string | Date; performance?: Record<string, number>; dryRun?: boolean }

function toDate(value: string | Date) {
  return typeof value === 'string' ? new Date(value) : value
}

function feePct() {
  const v = Number(process.env.SERVICE_FEE_PCT || process.env.SERVICE_FEE_PCT?.toString() || '0')
  return Math.max(0, v)
}

const DEFAULT_ALLOCATIONS: Record<string, Record<string, number>> = {
  starter: { ads_tasks: 70, trading: 30 },
  pro: { trading: 60, copy_trading: 25, ads_tasks: 15 },
  elite: { trading: 50, staking_yield: 30, ai: 20 }
};

function normalizeJson<T = Record<string, any>>(obj: T | string | null | undefined): T {
  if (!obj) return {} as T;
  if (typeof obj === 'string') {
    try { return JSON.parse(obj) as T; } catch { return {} as T; }
  }
  return obj as T;
}

function normalizeStreams(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const key = k.trim().toLowerCase();
    const mapped =
      key === 'ads' || key === 'tasks' || key === 'ads_tasks' ? 'ads_tasks' :
      key === 'hft' || key === 'arbitrage' || key === 'trading' ? 'trading' :
      key === 'staking' || key === 'yield' || key === 'staking_yield' ? 'staking_yield' :
      key === 'copytrading' || key === 'copy_trading' ? 'copy_trading' :
      key === 'ai' ? 'ai' : key;
    out[mapped] = Number(v) || 0;
  }
  return out;
}

async function upsertReserveBuffer(currentAmountDelta: number, totalAUM: number) {
  if (!supabaseServer) throw new Error('Supabase not configured')
  const supabase = supabaseServer
  // Try PascalCase
  const { data, error } = await supabase.from('ReserveBuffer').select('*').eq('id', 'main').maybeSingle()
  
  let table = 'ReserveBuffer'
  let columns = { currentAmount: 'currentAmount', totalAUM: 'totalAUM', id: 'id' }
  
  if (error && (error.message.includes('relation') || error.code === '42P01')) {
      table = 'reserve_buffer'
      columns = { currentAmount: 'current_amount', totalAUM: 'total_aum', id: 'id' }
  }

  // Check if exists
  const { data: existing } = await supabase.from(table).select('*').eq(columns.id, 'main').maybeSingle()

  if (existing) {
      const newAmount = Number(existing[columns.currentAmount]) + currentAmountDelta
      await supabase.from(table).update({
          [columns.currentAmount]: newAmount,
          [columns.totalAUM]: totalAUM
      }).eq(columns.id, 'main')
  } else {
      await supabase.from(table).insert({
          [columns.id]: 'main',
          [columns.currentAmount]: currentAmountDelta,
          [columns.totalAUM]: totalAUM
      })
  }
}

function getSlug(name: string) {
    const n = (name || '').toLowerCase()
    if (n.includes('pro')) return 'pro'
    if (n.includes('elite') || n.includes('vip')) return 'elite'
    return 'starter'
}

async function checkKycStatus(userId: string) {
    if (!supabaseServer) throw new Error('Supabase not configured')
    const supabase = supabaseServer
    // Try PascalCase Profile
    const { data: p1, error: e1 } = await supabase
        .from('Profile')
        .select('kycStatus')
        .eq('userId', userId)
        .maybeSingle()
    
    if (!e1 && p1) return p1.kycStatus === 'APPROVED'

    // Try snake_case profiles
    const { data: p2 } = await supabase
        .from('profiles')
        .select('kyc_status')
        .eq('user_id', userId)
        .maybeSingle()
    
    if (p2) return p2.kyc_status === 'approved'
    
    return false // Default to false if no profile or status found
}

async function getActiveInvestments(week: Date) {
    if (!supabaseServer) throw new Error('Supabase not configured')
    const supabase = supabaseServer
    // Try PascalCase
    const { data: d1, error: e1 } = await supabase
        .from('Investment')
        .select('*, plan:InvestmentPlan(*), user:User(*)')
        .eq('status', 'ACTIVE')
        .or(`endDate.is.null,endDate.gt.${week.toISOString()}`)
    
    let investments: any[] = []
    
    if (!e1 && d1) {
        investments = d1
    } else if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
        // Try lowercase
        const { data: d2, error: e2 } = await supabase
            .from('investments')
            .select('*, plan:investment_plans(*), user:users(*)')
            .eq('status', 'ACTIVE')
            .or(`end_date.is.null,end_date.gt.${week.toISOString()}`)
            
        if (!e2 && d2) {
            investments = d2.map((inv: any) => ({
                ...inv,
                id: inv.id,
                userId: inv.user_id,
                planId: inv.plan_id,
                principal: inv.principal,
                status: inv.status,
                maturedAt: inv.end_date,
                plan: inv.plan ? { ...inv.plan, name: inv.plan.name, returnPercentage: inv.plan.return_percentage } : null,
                user: inv.user ? { ...inv.user, id: inv.user.id, currency: inv.user.currency, referrerId: inv.user.referrer_id } : null
            }))
        } else if (e2) {
             console.error('Error fetching investments (fallback):', e2)
        }
    } else {
        console.error('Error fetching investments:', e1)
    }

    // Filter by KYC
    const verifiedInvestments: any[] = []
    for (const inv of investments) {
        const isKycApproved = await checkKycStatus(inv.userId)
        if (isKycApproved) {
            verifiedInvestments.push(inv)
        } else {
            console.log(`Skipping investment ${inv.id}: KYC not approved for user ${inv.userId}`)
        }
    }
    
    return verifiedInvestments
}

async function getTotalAUM() {
    if (!supabaseServer) throw new Error('Supabase not configured')
    const supabase = supabaseServer
    // Try PascalCase
    const { data: d1, error: e1 } = await supabase.from('Investment').select('principal').eq('status', 'ACTIVE')
    if (!e1 && d1) return d1.reduce((sum: number, i: any) => sum + Number(i.principal), 0)

    // Try lowercase
    if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
        const { data: d2 } = await supabase.from('investments').select('principal').eq('status', 'ACTIVE')
        if (d2) return d2.reduce((sum: number, i: any) => sum + Number(i.principal), 0)
    }
    return 0
}

export async function runBaselineCycle(input: BaselineInput) {
  if (!supabaseServer) throw new Error('Supabase not configured')
  const supabase = supabaseServer
  const week = toDate(input.weekEnding)
  const active = await getActiveInvestments(week)
  
  const f = feePct()
  let totalProfit = 0
  for (const inv of active) {
    const roi = Number(inv.plan.returnPercentage)
    const gross = Number(inv.principal) * roi / 100
    const net = gross * (1 - f / 100)
    totalProfit += net
  }
  
  const totalAUM = await getTotalAUM()

  if (input.dryRun) {
    logInfo('profit_engine.baseline.dry_run', { count: active.length, totalProfit, totalAUM })
    return { ok: true, totalProfit, totalAUM, count: active.length, dryRun: true }
  }
  
  let created = 0
  let creditedProfit = 0
  for (const inv of active) {
    const roi = Number(inv.plan.returnPercentage)
    const gross = Number(inv.principal) * roi / 100
    const net = gross * (1 - f / 100)
    
    // Create ProfitLog
    try {
        const plData = { investmentId: inv.id, amount: net, weekEnding: week.toISOString() }
        const { error: plErr } = await supabase.from('ProfitLog').insert(plData)
        if (plErr && (plErr.message.includes('relation') || plErr.code === '42P01')) {
            await supabase.from('profit_logs').insert({
                investment_id: plData.investmentId,
                amount: plData.amount,
                week_ending: plData.weekEnding
            })
        }
    } catch (e: any) {
       // P2002 is unique constraint. Supabase returns 23505
       if (e?.code === '23505' || e?.message?.includes('duplicate')) continue
       logError('profit_engine.baseline.error', { investmentId: inv.id, step: 'create_profit_log', error: e?.message })
       Sentry.captureException(e)
       throw e
    }

    // Create Transaction
    const txData = {
        userId: inv.userId,
        investmentId: inv.id,
        type: 'PROFIT',
        amount: net,
        status: 'COMPLETED',
        reference: JSON.stringify({ description: `ROI paid for investment (Week ending ${week.toISOString().split('T')[0]})` }),
        createdAt: new Date().toISOString()
    }
    const { error: txErr } = await supabase.from('Transaction').insert(txData)
    if (txErr) {
        if (txErr.message.includes('relation') || txErr.code === '42P01') {
            await supabase.from('transactions').insert({
                ...txData,
                user_id: txData.userId,
                investment_id: txData.investmentId,
                created_at: txData.createdAt
            })
        } else {
            console.error('Profit transaction insert failed:', txErr)
        }
    }

    // Update Wallet
    const currency = String(inv.user?.currency || 'USD')
    const { data: w1, error: wErr1 } = await supabase.from('Wallet').select('*').eq('userId', inv.userId).eq('currency', currency).maybeSingle()
    
    let wallet = w1
    if (wErr1 && (wErr1.message.includes('relation') || wErr1.code === '42P01')) {
         const { data: w2 } = await supabase.from('wallets').select('*').eq('user_id', inv.userId).eq('currency', currency).maybeSingle()
         if (w2) wallet = { ...w2, id: w2.id, balance: w2.balance }
    }
    
    if (wallet) {
        const newBalance = Number(wallet.balance) + net
        const { error: uErr } = await supabase.from('Wallet').update({ balance: newBalance }).eq('id', wallet.id)
        if (uErr && (uErr.message.includes('relation') || uErr.code === '42P01')) {
             await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id)
        }
    }

    // Notification
    try {
      const nData = { userId: inv.userId, type: 'profit', title: 'Weekly ROI', message: `Credited ${net.toFixed(2)}`, read: false, createdAt: new Date().toISOString() }
      let notif: any = null
      const { data: n1, error: nErr1 } = await supabase.from('Notification').insert(nData).select().single()
      
      if (nErr1 && (nErr1.message.includes('relation') || nErr1.code === '42P01')) {
           const { data: n2 } = await supabase.from('notifications').insert({
               ...nData,
               user_id: nData.userId,
               created_at: nData.createdAt
           }).select().single()
           if (n2) notif = { ...n2, userId: n2.user_id, createdAt: n2.created_at }
      } else {
          notif = n1
      }
      
      if (notif) {
          await publish(`user:${String(inv.userId)}`, { id: notif.id, type: notif.type, title: notif.title, message: notif.message, createdAt: notif.createdAt })
      }
    } catch {}

    created++
    creditedProfit += net
  }
  
  await upsertReserveBuffer(creditedProfit, totalAUM)
  logInfo('profit_engine.baseline.complete', { count: created, totalProfit, totalAUM })
  return { ok: true, totalProfit, totalAUM, count: created }
}

export async function runStreamDistribution(input: StreamInput) {
  if (!supabaseServer) throw new Error('Supabase not configured')
  const supabase = supabaseServer
  const week = toDate(input.weekEnding)
  const perf = input.performance || {}
  
  // If no performance provided, fetch latest from DB
  if (Object.keys(perf).length === 0) {
      // Try PascalCase
      const { data: p1, error: e1 } = await supabase
          .from('Performance')
          .select('streamRois')
          .order('weekEnding', { ascending: false })
          .limit(1)
          .maybeSingle()
      
      if (!e1 && p1) {
          // @ts-ignore
          Object.assign(perf, typeof p1.streamRois === 'string' ? JSON.parse(p1.streamRois) : p1.streamRois)
      } else if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
          // Try snake_case
          const { data: p2 } = await supabase
              .from('performance')
              .select('stream_rois')
              .order('week_ending', { ascending: false })
              .limit(1)
              .maybeSingle()
          
          if (p2) {
              // @ts-ignore
              Object.assign(perf, typeof p2.stream_rois === 'string' ? JSON.parse(p2.stream_rois) : p2.stream_rois)
          }
      }
  }

  const streamRois = normalizeStreams(perf)
  const active = await getActiveInvestments(week)
  const f = feePct()
  
  let totalProfit = 0
  for (const inv of active) {
    const slug = getSlug(inv.plan.name)
    
    // Allocations: try from plan object; fallback to default
    let allocations: Record<string, number> = DEFAULT_ALLOCATIONS[slug] || {};
    const planAlloc = normalizeJson<Record<string, number>>(inv.plan?.allocations);
    if (planAlloc && Object.keys(planAlloc).length > 0) allocations = planAlloc;

    // Compute weighted ROI (%)
    let weightedPct = 0;
    for (const streamName of Object.keys(allocations)) {
        const allocPct = Number(allocations[streamName] || 0);
        const streamRoiPct = Number(streamRois[streamName] || 0); 
        weightedPct += (allocPct / 100) * streamRoiPct;
    }

    const gross = Number(inv.principal) * weightedPct / 100
    const net = gross * (1 - f / 100)
    totalProfit += net
  }
  const totalAUM = await getTotalAUM()

  if (input.dryRun) {
    logInfo('profit_engine.stream.dry_run', { count: active.length, totalProfit, totalAUM })
    return { ok: true, totalProfit, totalAUM, count: active.length, dryRun: true }
  }

  let created = 0
  let creditedProfit = 0
  for (const inv of active) {
    const slug = getSlug(inv.plan.name)
    
    // Allocations: try from plan object; fallback to default
    let allocations: Record<string, number> = DEFAULT_ALLOCATIONS[slug] || {};
    const planAlloc = normalizeJson<Record<string, number>>(inv.plan?.allocations);
    if (planAlloc && Object.keys(planAlloc).length > 0) allocations = planAlloc;

    // Compute weighted ROI (%)
    let weightedPct = 0;
    for (const streamName of Object.keys(allocations)) {
        const allocPct = Number(allocations[streamName] || 0);
        const streamRoiPct = Number(streamRois[streamName] || 0); 
        weightedPct += (allocPct / 100) * streamRoiPct;
    }

    const gross = Number(inv.principal) * weightedPct / 100
    const net = gross * (1 - f / 100)
    
    // Create ProfitLog
    try {
        const plData = { 
            investmentId: inv.id, 
            amount: net, 
            weekEnding: week.toISOString(),
            weightedPct,
            grossProfit: gross,
            fee: gross - net,
            streamRois
        }
        
        // Try PascalCase insert
        const { error: plErr } = await supabase.from('ProfitLog').insert(plData)
        
        if (plErr && (plErr.message.includes('relation') || plErr.code === '42P01')) {
            // Fallback to snake_case
             await supabase.from('profit_logs').insert({
                investment_id: plData.investmentId,
                amount: plData.amount,
                week_ending: plData.weekEnding,
                weighted_pct: plData.weightedPct,
                gross_profit: plData.grossProfit,
                fee: plData.fee,
                stream_rois: plData.streamRois
            })
        }
    } catch (e: any) {
        if (e?.code === '23505' || e?.message?.includes('duplicate')) continue
        logError('profit_engine.stream.error', { investmentId: inv.id, step: 'create_profit_log', error: e?.message })
        Sentry.captureException(e)
        throw e
    }

    // Transaction
    const txData = { 
        userId: inv.userId, 
        investmentId: inv.id, 
        type: 'PROFIT', 
        amount: net, 
        status: 'COMPLETED', 
        reference: JSON.stringify({ 
            weekEnding: week, 
            weightedPct, 
            description: `ROI paid for investment (Week ending ${week.toISOString().split('T')[0]})` 
        }),
        createdAt: new Date().toISOString()
    }
    const { error: txErr } = await supabase.from('Transaction').insert(txData)
    if (txErr && (txErr.message.includes('relation') || txErr.code === '42P01')) {
        await supabase.from('transactions').insert({
            ...txData,
            user_id: txData.userId,
            investment_id: txData.investmentId,
            created_at: txData.createdAt
        })
    }

    // Wallet
    const currency = String(inv.user?.currency || 'USD')
    const { data: w1, error: wErr1 } = await supabase.from('Wallet').select('*').eq('userId', inv.userId).eq('currency', currency).maybeSingle()
    let wallet = w1
    if (wErr1 && (wErr1.message.includes('relation') || wErr1.code === '42P01')) {
         const { data: w2 } = await supabase.from('wallets').select('*').eq('user_id', inv.userId).eq('currency', currency).maybeSingle()
         if (w2) wallet = { ...w2, id: w2.id, balance: w2.balance }
    }
    
    if (wallet) {
        const newBalance = Number(wallet.balance) + net
        const { error: uErr } = await supabase.from('Wallet').update({ balance: newBalance }).eq('id', wallet.id)
        if (uErr && (uErr.message.includes('relation') || uErr.code === '42P01')) {
             await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id)
        }
    }

    // Notification
    try {
      const nData = { userId: inv.userId, type: 'profit', title: 'Performance ROI', message: `Credited ${net.toFixed(2)}`, read: false, createdAt: new Date().toISOString() }
      let notif: any = null
      const { data: n1, error: nErr1 } = await supabase.from('Notification').insert(nData).select().single()
      if (nErr1 && (nErr1.message.includes('relation') || nErr1.code === '42P01')) {
           const { data: n2 } = await supabase.from('notifications').insert({
               ...nData,
               user_id: nData.userId,
               created_at: nData.createdAt
           }).select().single()
           if (n2) notif = { ...n2, userId: n2.user_id, createdAt: n2.created_at }
      } else {
          notif = n1
      }
      
      if (notif) {
          await publish(`user:${String(inv.userId)}`, { id: notif.id, type: notif.type, title: notif.title, message: notif.message, createdAt: notif.createdAt })
      }
    } catch {}

    await processReferral(inv as any, net, !!input.dryRun)

    created++
    creditedProfit += net
  }
  
  await upsertReserveBuffer(creditedProfit, totalAUM)
  logInfo('profit_engine.stream.complete', { count: created, totalProfit, totalAUM })
  return { ok: true, totalProfit, totalAUM, count: created }
}

async function processReferral(inv: any, net: number, dryRun: boolean) {
  if (!supabaseServer) return
  const supabase = supabaseServer
  const referrerId = String(inv.user?.referrerId || '')
  if (!referrerId) return
  const slug = getSlug(inv.plan?.name || '')
  const rate = slug === 'elite' ? 0.10 : slug === 'pro' ? 0.07 : 0.05
  const bonus = Math.max(0, net * rate)
  if (dryRun || bonus <= 0) return
  const currency = 'USD'
  
  // Upsert wallet for referrer
  let walletId = ''
  let walletBalance = 0
  
  const { data: w1, error: wErr1 } = await supabase.from('Wallet').select('*').eq('userId', referrerId).eq('currency', currency).maybeSingle()
  
  if (wErr1 && (wErr1.message.includes('relation') || wErr1.code === '42P01')) {
      const { data: w2 } = await supabase.from('wallets').select('*').eq('user_id', referrerId).eq('currency', currency).maybeSingle()
      if (w2) {
          walletId = w2.id
          walletBalance = Number(w2.balance)
          // Update
          await supabase.from('wallets').update({ balance: walletBalance + bonus }).eq('id', walletId)
      } else {
          // Create
          const { data: wNew } = await supabase.from('wallets').insert({ user_id: referrerId, currency, balance: bonus }).select().single()
          if (wNew) walletId = wNew.id
      }
  } else {
      if (w1) {
          walletId = w1.id
          walletBalance = Number(w1.balance)
          await supabase.from('Wallet').update({ balance: walletBalance + bonus }).eq('id', walletId)
      } else {
          const { data: wNew } = await supabase.from('Wallet').insert({ userId: referrerId, currency, balance: bonus }).select().single()
          if (wNew) walletId = wNew.id
      }
  }

  try {
    const txData = {
        userId: referrerId,
        type: 'TRANSFER',
        amount: bonus,
        currency: 'USD',
        provider: 'system',
        status: 'COMPLETED',
        reference: JSON.stringify({ sourceUserId: inv.userId, investmentId: inv.id, kind: 'referral_credit' }),
        createdAt: new Date().toISOString()
    }
    const { error: txErr } = await supabase.from('Transaction').insert(txData)
    if (txErr && (txErr.message.includes('relation') || txErr.code === '42P01')) {
        await supabase.from('transactions').insert({
            ...txData,
            user_id: txData.userId,
            created_at: txData.createdAt
        })
    }

    const nData = {
        userId: referrerId,
        type: 'referral_credit',
        title: 'Referral Bonus',
        message: `Credited ${bonus.toFixed(2)} from referral`,
        read: false,
        createdAt: new Date().toISOString()
    }
    let notif: any = null
    const { data: n1, error: nErr1 } = await supabase.from('Notification').insert(nData).select().single()
    if (nErr1 && (nErr1.message.includes('relation') || nErr1.code === '42P01')) {
        const { data: n2 } = await supabase.from('notifications').insert({
            ...nData,
            user_id: nData.userId,
            created_at: nData.createdAt
        }).select().single()
        if (n2) notif = { ...n2, userId: n2.user_id, createdAt: n2.created_at }
    } else {
        notif = n1
    }

    if (notif) {
        await publish(`user:${referrerId}`, { id: notif.id, type: notif.type, title: notif.title, message: notif.message, createdAt: notif.createdAt })
    }
  } catch (e) {}
}
