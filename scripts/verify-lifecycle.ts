
import dotenv from 'dotenv';
import path from 'path';

// Load .env.local first
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config(); // Fallback to .env

import { supabaseServer } from '../src/lib/supabaseServer';
import { runProfitDistributionCycle } from '../src/lib/admin/cycle-runner';
import crypto from 'crypto';

async function main() {
    console.log('--- Starting Investment Lifecycle Verification ---');

    if (!supabaseServer) {
        console.error('Supabase server not configured');
        process.exit(1);
    }
    const supabase = supabaseServer;

    // 1. Setup Test User
    const testEmail = `test.lifecycle.${Date.now()}@example.com`;
    console.log(`[Setup] Creating auth user: ${testEmail}`);
    
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email: testEmail,
        email_confirm: true,
        user_metadata: { name: 'Lifecycle Test User' }
    });

    if (authError) {
        console.error('Failed to create auth user:', authError);
        return;
    }

    const userId = authUser.user.id;
    console.log(`[Setup] Created auth user: ${userId}`);

    // Try insert User (public profile) if not auto-created by triggers
    // We check if it exists first
    const { data: existingUser } = await supabase.from('User').select('id').eq('id', userId).maybeSingle();
    const { data: existingUserLow } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
    
    if (!existingUser && !existingUserLow) {
        console.log('[Setup] Creating public user profile...');
        const { data: uData, error: uErr } = await supabase.from('User').insert({
            id: userId,
            email: testEmail,
            name: 'Lifecycle Test User',
            role: 'USER',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }).select();
        
        console.log('[Debug] User insert result:', uData, uErr);
        
        if (uErr) {
            if (uErr.message.includes('relation') || uErr.code === '42P01') {
                console.log('[Debug] User table missing, trying lowercase users...');
                const { data: uData2, error: uErr2 } = await supabase.from('users').insert({
                    id: userId,
                    email: testEmail,
                    name: 'Lifecycle Test User',
                    role: 'USER',
                    created_at: new Date().toISOString()
                }).select();
                console.log('[Debug] users insert result:', uData2, uErr2);
            } else {
                console.error('Failed to create public user:', uErr);
            }
        }
    } else {
        console.log('[Setup] Public user profile already exists (trigger likely).');
    }

    // Verify User Exists in 'User' table
    const { data: verifyUser, error: verifyErr } = await supabase.from('User').select('id').eq('id', userId).maybeSingle();
    if (verifyUser) {
        console.log('[Debug] User confirmed in "User" table.');
    } else {
        console.error('[Debug] User NOT found in "User" table.', verifyErr);
        // Check 'users' table
        const { data: verifyUserLow } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
        if (verifyUserLow) console.log('[Debug] User found in "users" table instead.');
    }

    // 2. Setup Wallet
    console.log('[Setup] Creating USD Wallet with $10,000');
    const walletId = crypto.randomUUID();
    const { error: wErr } = await supabase.from('Wallet').insert({
        id: walletId,
        userId,
        currency: 'USD',
        balance: 10000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    if (wErr && (wErr.message.includes('relation') || wErr.code === '42P01')) {
        await supabase.from('wallets').insert({
            id: walletId,
            user_id: userId,
            currency: 'USD',
            balance: 10000,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    }

    // 3. Get Plan (Starter)
    console.log('[Setup] Fetching Starter Plan');
    let plan: any = null;
    const { data: p1 } = await supabase.from('InvestmentPlan').select('*').ilike('name', '%Starter%').limit(1).maybeSingle();
    plan = p1;
    if (!plan) {
         const { data: p2 } = await supabase.from('investment_plans').select('*').ilike('name', '%Starter%').limit(1).maybeSingle();
         if (p2) plan = { ...p2, returnPercentage: p2.return_percentage, payoutFrequency: p2.payout_frequency };
    }
    
    if (!plan) {
        console.error('[Error] Starter plan not found. Aborting.');
        return;
    }
    console.log(`[Setup] Plan found: ${plan.name} (ROI: ${plan.returnPercentage}%, Freq: ${plan.payoutFrequency})`);

    // 4. Simulate Investment (Backdated 8 days to trigger payout)
    const investAmount = 1000;
    console.log(`[Action] Creating Backdated Investment ($${investAmount}) - 8 Days Ago`);
    
    const backdatedDate = new Date();
    backdatedDate.setDate(backdatedDate.getDate() - 8);
    const backdatedStr = backdatedDate.toISOString();

    const invId = crypto.randomUUID();
    let investmentCreated = false;

    // Insert Investment
    const { error: iErr } = await supabase.from('Investment').insert({
        id: invId,
        userId,
        planId: plan.id,
        principal: investAmount,
        status: 'ACTIVE',
        startDate: backdatedStr,
        createdAt: backdatedStr,
        updatedAt: backdatedStr
    });
    
    if (iErr && (iErr.message.includes('relation') || iErr.code === '42P01')) {
        const { error: iErr2 } = await supabase.from('investments').insert({
            id: invId,
            user_id: userId,
            plan_id: plan.slug || 'starter',
            amount_usd: investAmount,
            status: 'active',
            created_at: backdatedStr
        });
        if (!iErr2) investmentCreated = true;
        else console.error('Invest Insert Failed (lowercase):', iErr2);
    } else if (!iErr) {
        investmentCreated = true;
    } else {
        console.error('Invest Insert Failed (Pascal):', iErr);
    }

    if (!investmentCreated) {
        console.error('Failed to create investment. Aborting.');
        return;
    }

    // Deduct Wallet
    console.log('[Action] Deducting Wallet Balance');
    // Simplified deduction for test
    await supabase.from('Wallet').update({ balance: 9000 }).eq('id', walletId);
    await supabase.from('wallets').update({ balance: 9000 }).eq('id', walletId); // Try both just in case

    // 5. Run Cycle
    console.log('[Action] Running Profit Distribution Cycle...');
    const result = await runProfitDistributionCycle();
    console.log('[Result] Cycle Output:', JSON.stringify(result, null, 2));

    // 6. Verify Payout
    console.log('[Verify] Checking Wallet Balance for Profit...');
    
    let balance = 0;
    const { data: wCheck1 } = await supabase.from('Wallet').select('balance').eq('id', walletId).maybeSingle();
    if (wCheck1) balance = Number(wCheck1.balance);
    else {
        const { data: wCheck2 } = await supabase.from('wallets').select('balance').eq('id', walletId).maybeSingle();
        if (wCheck2) balance = Number(wCheck2.balance);
    }

    console.log(`[Verify] New Balance: $${balance}`);
    
    const expectedProfit = investAmount * (Number(plan.returnPercentage) / 100);
    const fee = expectedProfit * 0.05; // 5% fee
    const net = expectedProfit - fee;
    
    console.log(`[Verify] Expected Net Profit: $${net.toFixed(2)}`);
    
    if (balance > 9000) {
        console.log('✅ SUCCESS: Profit was credited!');
    } else {
        console.log('❌ FAILURE: Balance did not increase.');
    }

    // 7. Cleanup
    console.log('[Cleanup] Removing test data...');
    await supabase.from('Transaction').delete().eq('userId', userId);
    await supabase.from('transactions').delete().eq('user_id', userId);
    await supabase.from('ProfitLog').delete().eq('investmentId', invId);
    await supabase.from('profit_logs').delete().eq('investment_id', invId);
    await supabase.from('Investment').delete().eq('id', invId);
    await supabase.from('investments').delete().eq('id', invId);
    await supabase.from('WalletTransaction').delete().eq('walletId', walletId);
    await supabase.from('wallet_transactions').delete().eq('wallet_id', walletId);
    await supabase.from('Wallet').delete().eq('id', walletId);
    await supabase.from('wallets').delete().eq('id', walletId);
    await supabase.from('User').delete().eq('id', userId);
    await supabase.from('users').delete().eq('id', userId);
    await supabase.auth.admin.deleteUser(userId);
    
    console.log('--- Verification Complete ---');
}

main().catch(console.error);
