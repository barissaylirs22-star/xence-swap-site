import { useEffect } from "react";
import { AmbientBackground } from "@/components/visual/AmbientBackground";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { StickyLaunchCta } from "@/components/layout/StickyLaunchCta";
import { Hero } from "@/components/hero/Hero";
import { AxiomLiveSection } from "@/components/hero/AxiomLiveSection";
import { AxiomRadarSection } from "@/components/radar/AxiomRadarSection";
import { JourneySection } from "@/components/journey/JourneySection";
import { VisionSlider } from "@/components/vision/VisionSlider";
import { LaunchSection } from "@/components/launch/LaunchSection";
import { TradingPreview } from "@/components/launch/TradingPreview";
import { CommunitySection } from "@/components/community/CommunitySection";
import { applyInitialScroll } from "@/lib/nav/initialScroll";
import { SwapIntentProvider } from "@/lib/swap/SwapIntentProvider";

export default function App() {
  useEffect(() => {
    applyInitialScroll();
  }, []);

  return (
    <SwapIntentProvider>
      <div className="app-shell" id="top">
        <a className="skip-link" href="#live">
          Skip to Axiom Live
        </a>
        <AmbientBackground />
        <Header />
        <main style={{ position: "relative", zIndex: 1 }}>
          <Hero />
          <AxiomLiveSection />
          <AxiomRadarSection />
          <TradingPreview />
          <JourneySection />
          <VisionSlider />
          <LaunchSection />
          <CommunitySection />
        </main>
        <Footer />
        <StickyLaunchCta />
      </div>
    </SwapIntentProvider>
  );
}
