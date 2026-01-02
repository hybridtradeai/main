import React from 'react'
import Head from 'next/head'
import LandingNavbar from '@/components/landing/LandingNavbar'
import HeroSection from '@/components/landing/HeroSection'
import StatsSection from '@/components/landing/StatsSection'
import FeaturesSection from '@/components/landing/FeaturesSection'
import MobileSection from '@/components/landing/MobileSection'
import CTASection from '@/components/landing/CTASection'
import LiveDemoSection from '@/components/landing/LiveDemoSection'
import StoryLine from '@/components/ui/StoryLine'

export default function Home() {
  return (
    <>
      <Head>
        <title>HybridTradeAI – Modern Fintech Investing</title>
        <meta name="description" content="AI-assisted signals, weekly ROI tracking, and secure withdrawals. Start investing with HybridTradeAI." />
      </Head>
      <main className="min-h-screen bg-[#050A18] text-white relative">
        <StoryLine />
        <LandingNavbar />
        <HeroSection />
        <StatsSection />
        <LiveDemoSection />
        <FeaturesSection />
        <MobileSection />
        <CTASection />
        
        {/* Footer */}
        <footer className="py-12 px-6 md:px-16 lg:px-24 border-t border-white/10 bg-[#02050c]">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-sm text-gray-500">
              &copy; {new Date().getFullYear()} HybridTradeAI. All rights reserved.
            </div>
            <div className="flex gap-6 text-sm text-gray-400">
              <a href="/terms" className="hover:text-white transition-colors">Terms</a>
              <a href="/privacy" className="hover:text-white transition-colors">Privacy</a>
              <a href="/cookies" className="hover:text-white transition-colors">Cookies</a>
            </div>
          </div>
        </footer>
      </main>
    </>
  )
}
