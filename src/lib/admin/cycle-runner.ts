
import { supabaseServer } from '../supabaseServer';
import crypto from 'crypto';

function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}

export async function runProfitDistributionCycle() {
  if (!supabaseServer) {
    console.error('Supabase server not configured');
    return { ok: false, error: 'server_configuration_error' };
  }
  const supabase = supabaseServer;

  // Fetch settings from DB
  let serviceFeePct = Number(process.env.SERVICE_FEE_PCT ?? 5);
  try {
    // Try PascalCase
    const { data: s1, error: e1 } = await supabase
      .from('Setting')
      .select('value')
      .eq('key', 'fee_percent')
      .maybeSingle();
    
    let settings = s1;
    if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
        const { data: s2 } = await supabase.from('settings').select('value').eq('key', 'fee_percent').maybeSingle();
        settings = s2;
    }
    
    if (settings?.value) {
      serviceFeePct = parseFloat(settings.value);
    }
  } catch (err) {
    console.error('Error fetching settings, using default:', err);
  }

  // Fetch Investments
  let investments: any[] = [];
  // Try PascalCase
  const { data: d1, error: e1 } = await supabase
    .from('Investment')
    .select(`
        id, userId, planId, principal, status, createdAt,
        plan:InvestmentPlan (
        returnPercentage,
        duration,
        payoutFrequency
    )
  `)
  .eq('status', 'ACTIVE');

  if (!e1 && d1) {
      investments = d1;
  } else if (e1 && (e1.message.includes('relation') || e1.code === '42P01')) {
      // Fallback to lowercase
      const { data: d2, error: e2 } = await supabase
        .from('investments')
        .select(`
            id, user_id, plan_id, principal, status, created_at,
            plan:investment_plans (
            return_percentage,
            duration,
            payout_frequency
        )
      `)
      .eq('status', 'ACTIVE'); // Enum might be 'active' or 'ACTIVE' depending on DB. Assuming 'ACTIVE' for now.
      
      if (d2) {
          investments = d2.map((inv: any) => ({
              id: inv.id,
              userId: inv.user_id,
              planId: inv.plan_id,
              principal: inv.principal,
              status: inv.status,
              createdAt: inv.created_at,
              plan: Array.isArray(inv.plan) ? inv.plan[0] : inv.plan ? {
                  returnPercentage: inv.plan.return_percentage,
                  duration: inv.plan.duration,
                  payoutFrequency: inv.plan.payout_frequency
              } : null
          }));
      }
  }

  const now = new Date();
  const results: any[] = [];

  for (const inv of investments) {
    const planData = Array.isArray(inv.plan) ? inv.plan[0] : inv.plan;
    const durationDays = Number(planData?.duration || 14);
    const roiPct = Number(planData?.returnPercentage || 0);
    const payoutFreq = planData?.payoutFrequency || 'WEEKLY'; // Or 'weekly'
    
    // Calculate maturity date based on dynamic duration
    const maturityDate = addDays(inv.createdAt, durationDays);

    // --- 1. PROCESS ROI PAYMENTS (Weekly) ---
    // Note: Enum checks might need to be case-insensitive if mixed
    if ((String(payoutFreq).toUpperCase() === 'WEEKLY') && roiPct > 0) {
        const weeks = Math.floor(durationDays / 7);
        
        for (let i = 1; i <= weeks; i++) {
            const weekEnding = addDays(inv.createdAt, i * 7);
            
            // Only process if the week has ended
            if (now >= weekEnding) {
                // Check if ProfitLog exists
                let alreadyPaid = false;
                
                // Try PascalCase
                const { data: pl1, error: ple1 } = await supabase
                    .from('ProfitLog')
                    .select('id')
                    .eq('investmentId', inv.id)
                    .eq('weekEnding', weekEnding.toISOString())
                    .maybeSingle();
                
                if (!ple1 && pl1) alreadyPaid = true;
                
                if (!alreadyPaid && ple1 && (ple1.message.includes('relation') || ple1.code === '42P01')) {
                     const { data: pl2 } = await supabase
                        .from('profit_logs')
                        .select('id')
                        .eq('investment_id', inv.id)
                        .eq('week_ending', weekEnding.toISOString())
                        .maybeSingle();
                     if (pl2) alreadyPaid = true;
                }

                // Fallback: Check for existing transaction if ProfitLog is missing
                if (!alreadyPaid) {
                    const minDate = addDays(weekEnding.toISOString(), -3);
                    const maxDate = addDays(weekEnding.toISOString(), 3);
                    
                    // Try PascalCase
                    const { data: lt1, error: lte1 } = await supabase
                        .from('Transaction')
                        .select('id')
                        .eq('investmentId', inv.id)
                        .eq('type', 'PROFIT')
                        .gte('createdAt', minDate.toISOString())
                        .lte('createdAt', maxDate.toISOString())
                        .limit(1);
                    
                    if (!lte1 && lt1 && lt1.length > 0) alreadyPaid = true;

                    if (!alreadyPaid && lte1 && (lte1.message.includes('relation') || lte1.code === '42P01')) {
                         const { data: lt2 } = await supabase
                            .from('transactions')
                            .select('id')
                            .eq('investment_id', inv.id)
                            .eq('type', 'PROFIT')
                            .gte('created_at', minDate.toISOString())
                            .lte('created_at', maxDate.toISOString())
                            .limit(1);
                         if (lt2 && lt2.length > 0) alreadyPaid = true;
                    }
                }

                if (!alreadyPaid) {
                    const gross = Number(inv.principal) * (roiPct / 100);
                    const net = Number((gross * (1 - serviceFeePct / 100)).toFixed(2));

                    // Upsert USD wallet
                    let walletId = '';
                    let currentBalance = 0;
                    
                    // Try PascalCase
                    const { data: w1, error: we1 } = await supabase
                        .from('Wallet')
                        .select('id,balance')
                        .eq('userId', inv.userId)
                        .eq('currency', 'USD')
                        .maybeSingle();
                        
                    let useLowercaseWallet = false;
                    if (we1 && (we1.message.includes('relation') || we1.code === '42P01')) {
                        useLowercaseWallet = true;
                    }

                    if (!useLowercaseWallet) {
                        if (w1?.id) {
                            walletId = w1.id;
                            currentBalance = Number(w1.balance);
                            await supabase
                                .from('Wallet')
                                .update({ balance: currentBalance + net, updatedAt: new Date().toISOString() })
                                .eq('id', walletId);
                        } else {
                            walletId = crypto.randomUUID();
                            await supabase
                                .from('Wallet')
                                .insert({ 
                                    id: walletId,
                                    userId: inv.userId, 
                                    currency: 'USD', 
                                    balance: net,
                                    updatedAt: new Date().toISOString()
                                });
                        }
                    } else {
                         // Lowercase Wallet
                         const { data: w2 } = await supabase
                            .from('wallets')
                            .select('id,balance')
                            .eq('user_id', inv.userId)
                            .eq('currency', 'USD')
                            .maybeSingle();
                        
                        if (w2?.id) {
                            walletId = w2.id;
                            currentBalance = Number(w2.balance);
                            await supabase
                                .from('wallets')
                                .update({ balance: currentBalance + net, updated_at: new Date().toISOString() })
                                .eq('id', walletId);
                        } else {
                            walletId = crypto.randomUUID();
                            await supabase
                                .from('wallets')
                                .insert({ 
                                    id: walletId,
                                    user_id: inv.userId, 
                                    currency: 'USD', 
                                    balance: net,
                                    updated_at: new Date().toISOString()
                                });
                        }
                    }

                    // Create Transaction
                    const txId = crypto.randomUUID();
                    const txData = {
                        id: txId,
                        userId: inv.userId, 
                        type: 'PROFIT',
                        amount: net,
                        currency: 'USD',
                        provider: 'system',
                        status: 'COMPLETED',
                        investmentId: inv.id,
                        reference: JSON.stringify({ 
                            week: i, 
                            weekEnding: weekEnding.toISOString(),
                            applied_weekly_roi: roiPct, 
                            service_fee_pct: serviceFeePct 
                        }),
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };

                    // Try PascalCase
                    const { error: txe1 } = await supabase.from('Transaction').insert(txData);
                    if (txe1 && (txe1.message.includes('relation') || txe1.code === '42P01')) {
                         await supabase.from('transactions').insert({
                             ...txData,
                             user_id: txData.userId,
                             investment_id: txData.investmentId,
                             created_at: txData.createdAt,
                             updated_at: txData.updatedAt
                         });
                    }

                    // Create ProfitLog
                    const plId = crypto.randomUUID();
                    const plData = {
                        id: plId,
                        investmentId: inv.id,
                        amount: net,
                        weekEnding: weekEnding.toISOString(),
                        createdAt: new Date().toISOString()
                    };
                    
                    // Try PascalCase
                    const { error: ple1 } = await supabase.from('ProfitLog').insert(plData);
                    if (ple1 && (ple1.message.includes('relation') || ple1.code === '42P01')) {
                        await supabase.from('profit_logs').insert({
                            id: plId,
                            investment_id: plData.investmentId,
                            amount: plData.amount,
                            week_ending: plData.weekEnding,
                            created_at: plData.createdAt
                        });
                    }

                    results.push({ investmentId: inv.id, action: 'roi_credited', week: i, net });
                }
            }
        }
    }

    // --- 2. PROCESS PRINCIPAL RELEASE (Maturity) ---
    // Check for existing release transaction
    let released = false;
    
    // Try PascalCase
    const { data: rel1, error: rele1 } = await supabase
      .from('Transaction')
      .select('id')
      .eq('userId', inv.userId)
      .eq('type', 'TRANSFER')
      .eq('investmentId', inv.id)
      .eq('reference', 'principal_release')
      .limit(1);
    
    if (!rele1 && rel1 && rel1.length > 0) released = true;
    
    if (!released && rele1 && (rele1.message.includes('relation') || rele1.code === '42P01')) {
        const { data: rel2 } = await supabase
          .from('transactions')
          .select('id')
          .eq('user_id', inv.userId)
          .eq('type', 'TRANSFER')
          .eq('investment_id', inv.id)
          .eq('reference', 'principal_release')
          .limit(1);
        if (rel2 && rel2.length > 0) released = true;
    }

    if (now >= maturityDate && !released) {
      // Credit principal to wallet
      let walletId = '';
      
      // Upsert Wallet Logic (Reuse logic?)
      // Try PascalCase
      const { data: w1, error: we1 } = await supabase
        .from('Wallet')
        .select('id,balance')
        .eq('userId', inv.userId)
        .eq('currency', 'USD')
        .maybeSingle();
      
      let useLowercaseWallet = false;
      if (we1 && (we1.message.includes('relation') || we1.code === '42P01')) {
          useLowercaseWallet = true;
      }
      
      if (!useLowercaseWallet) {
           if (w1?.id) {
               walletId = w1.id;
               await supabase
                 .from('Wallet')
                 .update({ balance: Number(w1.balance) + Number(inv.principal), updatedAt: new Date().toISOString() })
                 .eq('id', walletId);
           } else {
               const { data: newWallet } = await supabase
                 .from('Wallet')
                 .insert({ 
                   id: crypto.randomUUID(),
                   userId: inv.userId, 
                   currency: 'USD', 
                   balance: inv.principal,
                   updatedAt: new Date().toISOString()
                  })
                  .select()
                  .single();
               if (newWallet) walletId = newWallet.id;
           }
      } else {
           const { data: w2 } = await supabase
             .from('wallets')
             .select('id,balance')
             .eq('user_id', inv.userId)
             .eq('currency', 'USD')
             .maybeSingle();
             
           if (w2?.id) {
               walletId = w2.id;
               await supabase
                 .from('wallets')
                 .update({ balance: Number(w2.balance) + Number(inv.principal), updated_at: new Date().toISOString() })
                 .eq('id', walletId);
           } else {
               const { data: newWallet } = await supabase
                 .from('wallets')
                 .insert({ 
                   id: crypto.randomUUID(),
                   user_id: inv.userId, 
                   currency: 'USD', 
                   balance: inv.principal,
                   updated_at: new Date().toISOString()
                  })
                  .select()
                  .single();
               if (newWallet) walletId = newWallet.id;
           }
      }

      // Create WalletTransaction
      if (walletId) {
          const wtData = {
              id: crypto.randomUUID(),
              walletId,
              amount: inv.principal,
              type: 'CREDIT',
              source: 'principal_return',
              reference: JSON.stringify({ 
                  investmentId: inv.id,
                  note: 'Principal Return'
              }),
              performedBy: 'admin_cycle',
              createdAt: new Date().toISOString()
          };
          
          // Try PascalCase
          const { error: wte1 } = await supabase.from('WalletTransaction').insert(wtData);
          if (wte1 && (wte1.message.includes('relation') || wte1.code === '42P01')) {
               await supabase.from('wallet_transactions').insert({
                   ...wtData,
                   wallet_id: wtData.walletId,
                   created_at: wtData.createdAt,
                   performed_by: wtData.performedBy
               });
          }
      }

      // Create Transaction
      const txData = { 
          id: crypto.randomUUID(),
          userId: inv.userId, 
          type: 'TRANSFER', 
          amount: inv.principal, 
          currency: 'USD',
          provider: 'system',
          status: 'COMPLETED',
          investmentId: inv.id,
          reference: 'principal_release',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
      };
      
      const { error: txe1 } = await supabase.from('Transaction').insert(txData);
      if (txe1 && (txe1.message.includes('relation') || txe1.code === '42P01')) {
          await supabase.from('transactions').insert({
              ...txData,
              user_id: txData.userId,
              investment_id: txData.investmentId,
              created_at: txData.createdAt,
              updated_at: txData.updatedAt
          });
      }

      // Update Investment Status
      // Try PascalCase
      const { error: ie1 } = await supabase
        .from('Investment')
        .update({ status: 'MATURED' })
        .eq('id', inv.id);
        
      if (ie1 && (ie1.message.includes('relation') || ie1.code === '42P01')) {
           await supabase
            .from('investments')
            .update({ status: 'MATURED' }) 
            .eq('id', inv.id);
      }

      results.push({ investmentId: inv.id, action: 'principal_released', amount: inv.principal });
    }
  }

  return { ok: true, results };
}
