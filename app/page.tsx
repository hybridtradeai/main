export const dynamic = "force-dynamic";

import HeroSection from '@/components/landing/HeroSection'
import FeaturesSection from '@/components/landing/FeaturesSection'
import StatsSection from '@/components/landing/StatsSection'
import LiveDemoSection from '@/components/landing/LiveDemoSection'
import CTASection from '@/components/landing/CTASection'

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050A18] text-white overflow-x-hidden">
      <HeroSection />
      <StatsSection />
      <FeaturesSection />
      <LiveDemoSection />
      <CTASection />
    </main>
  );
}
