import RequireAuth from '../components/RequireAuth';
import { useEffect, useState } from 'react';
import { getCurrentUserId, getReferralByUser } from '../lib/db';
import { supabase } from '../lib/supabase';
import { useI18n } from '../hooks/useI18n';
import Head from 'next/head';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import FuturisticBackground from '../components/ui/FuturisticBackground';
import { ArrowLeft, User, Share2, Copy, CheckCircle2, AlertCircle, Sparkles, ShieldCheck, Wallet, Trophy } from 'lucide-react';

export default function Profile() {
  const { t, nf } = useI18n();
  const [userId, setUserId] = useState<string | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [totalEarnings, setTotalEarnings] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string>('');

  useEffect(() => {
    (async () => {
      const id = await getCurrentUserId();
      setUserId(id);
      if (id) {
        const ref = await getReferralByUser(id);
        if (ref?.code) setReferralCode(ref.code);
        if (ref?.total_earnings) setTotalEarnings(ref.total_earnings);
      }
    })();
  }, []);

  const generateReferral = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) {
        setShareError(t('please_login_first'));
        return;
      }
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
      const res = await fetch('/api/referral', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      setReferralCode(data.referralCode);
    } finally {
      setLoading(false);
    }
  };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const referralLink = referralCode ? `${siteUrl}/auth/register?ref=${referralCode}` : '';

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const shareLink = async () => {
    if (!referralLink) return;
    setShareError('');
    try {
      if (navigator.share) {
        await navigator.share({ title: t('share_title'), url: referralLink });
      } else {
        await navigator.clipboard.writeText(referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch (e: any) {
      setShareError(e?.message || t('unable_to_share'));
    }
  };

  return (
    <RequireAuth>
      <Head>
        <title>{t('profile_title')} | HybridTrade AI</title>
      </Head>
      <FuturisticBackground />

      <div className="relative min-h-screen pt-24 pb-12 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto space-y-8">
          
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-4"
          >
            <Link href="/dashboard" className="p-2 rounded-xl bg-black/40 border border-white/10 hover:bg-white/10 transition-all text-muted-foreground hover:text-white backdrop-blur-md group">
              <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-cyan-200 to-blue-400 bg-clip-text text-transparent">
                {t('profile_title')}
              </h1>
              <p className="text-muted-foreground mt-1">Manage your account and referrals</p>
            </div>
          </motion.div>

          {/* User ID Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-[0_0_40px_rgba(0,0,0,0.2)]"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-2xl bg-white/5 text-gray-300">
                  <User size={24} />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-medium text-white">{t('user_id_label')}</h3>
                  <p className="font-mono text-cyan-400 text-lg tracking-wider">{userId || 'Loading...'}</p>
                  <p className="text-xs text-gray-500">This is your unique identifier in the system.</p>
                </div>
              </div>
              
              <div className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20">
                <ShieldCheck size={16} className="text-green-400" />
                <span className="text-xs font-bold text-green-400 uppercase tracking-wider">Verified Account</span>
              </div>
            </div>
          </motion.div>

          {/* Referral Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-[0_0_40px_rgba(0,0,0,0.2)]"
          >
            <div className="flex items-start gap-4 mb-6">
              <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 text-cyan-400">
                <Sparkles size={24} />
              </div>
              <div>
                <h3 className="text-lg font-medium text-white">{t('referral_title')}</h3>
                <p className="text-sm text-gray-400 mt-1">Invite friends and earn rewards when they join.</p>
              </div>
            </div>

            {referralCode ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center text-center group hover:bg-white/10 transition-colors">
                      <div className="mb-2 p-2 rounded-full bg-yellow-500/20 text-yellow-400 group-hover:scale-110 transition-transform">
                        <Trophy size={20} />
                      </div>
                      <div className="text-2xl font-bold text-white mb-1">{nf(0)}</div>
                      <div className="text-xs text-gray-400 uppercase tracking-wider">Invited Users</div>
                   </div>
                   <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center text-center group hover:bg-white/10 transition-colors">
                      <div className="mb-2 p-2 rounded-full bg-green-500/20 text-green-400 group-hover:scale-110 transition-transform">
                        <Wallet size={20} />
                      </div>
                      <div className="text-2xl font-bold text-white mb-1">${nf(totalEarnings)}</div>
                      <div className="text-xs text-gray-400 uppercase tracking-wider">Total Earnings</div>
                   </div>
                </div>

                <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-4">
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('referral_code_label')}</div>
                    <div className="text-2xl font-mono font-bold text-white tracking-widest">{referralCode}</div>
                  </div>
                  
                  <div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{t('referral_link_label')}</div>
                    <div className="text-sm text-cyan-400 truncate font-mono bg-black/20 p-2 rounded border border-white/5 select-all">
                      {referralLink}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={copyLink}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {copied ? <CheckCircle2 size={18} className="text-green-400" /> : <Copy size={18} />}
                    {copied ? 'Copied!' : t('btn_copy_link')}
                  </button>
                  <button 
                    onClick={shareLink}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-medium transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Share2 size={18} />
                    {t('btn_share')}
                  </button>
                </div>

                <AnimatePresence>
                  {(copied || shareError) && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className={`text-xs flex items-center gap-2 ${copied ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 size={12} />
                          {t('copied_feedback')}
                        </>
                      ) : (
                        <>
                          <AlertCircle size={12} />
                          {shareError}
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="text-center py-6">
                <button 
                  onClick={generateReferral} 
                  disabled={loading}
                  className="px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold transition-all shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {t('generating')}
                    </span>
                  ) : (
                    t('btn_generate_referral')
                  )}
                </button>
                <p className="text-xs text-gray-500 mt-4">Click to generate your unique referral link</p>
              </div>
            )}
          </motion.div>

        </div>
      </div>
    </RequireAuth>
  );
}
