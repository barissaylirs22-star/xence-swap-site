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
import { PortfolioSection } from "@/components/portfolio/PortfolioSection";
import { AlertsEvaluator } from "@/components/alerts/AlertsEvaluator";
import { AlertsProvider } from "@/lib/alerts/AlertsProvider";
import { AxiomDiscoveryProvider } from "@/lib/discovery/AxiomDiscoveryProvider";
import { applyInitialScroll } from "@/lib/nav/initialScroll";
import { SwapIntentProvider } from "@/lib/swap/SwapIntentProvider";

export default function App() {
  useEffect(() => {
    applyInitialScroll();
  }, []);

  return (
    <SwapIntentProvider>
      <AlertsProvider>
        <div className="app-shell" id="top">
          <a className="skip-link" href="#live">
            Skip to Axiom Live
          </a>
          <AmbientBackground />
          <Header />
          <main style={{ position: "relative", zIndex: 1 }}>
            <Hero />
            <AxiomDiscoveryProvider>
              <AlertsEvaluator />
              <AxiomLiveSection />
              <AxiomRadarSection />
              <TradingPreview />
              <PortfolioSection />
            </AxiomDiscoveryProvider>
            <LaunchSection />
            <JourneySection />
            <VisionSlider />
            <CommunitySection />
          </main>
          <Footer />
          <StickyLaunchCta />
        </div>
      </AlertsProvider>
    </SwapIntentProvider>
  );
}
