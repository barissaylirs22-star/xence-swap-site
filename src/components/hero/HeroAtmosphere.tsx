import styles from "./HeroAtmosphere.module.css";

/**
 * Decorative hero flanks only — DATA (left) → SIGNAL (right).
 * No live values, no API/RPC. Purely visual atmosphere.
 */
export function HeroAtmosphere() {
  return (
    <div className={styles.root} aria-hidden>
      <div className={styles.bridge} />

      <aside className={`${styles.panel} ${styles.left}`}>
        <svg
          className={styles.svg}
          viewBox="0 0 280 360"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="heroDataFade" x1="0" y1="180" x2="280" y2="180">
              <stop offset="0%" stopColor="rgba(158,182,255,0.42)" />
              <stop offset="70%" stopColor="rgba(158,182,255,0.16)" />
              <stop offset="100%" stopColor="rgba(158,182,255,0)" />
            </linearGradient>
            <radialGradient id="heroDataNode" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(200,220,255,0.95)" />
              <stop offset="100%" stopColor="rgba(180,210,255,0)" />
            </radialGradient>
          </defs>

          {/* Soft lattice */}
          <g stroke="url(#heroDataFade)" strokeWidth="0.85" opacity="0.8">
            <path d="M24 48H118M40 96H160M18 152H140M52 208H168M28 264H132M60 312H150" />
            <path d="M48 40V320M96 56V300M144 72V280" />
          </g>

          {/* Network edges */}
          <g
            className={styles.edges}
            stroke="rgba(158,182,255,0.48)"
            strokeWidth="1"
          >
            <path d="M52 86L98 128L74 176L128 210" />
            <path d="M98 128L148 110L168 168" />
            <path d="M74 176L42 230L88 268" />
            <path d="M128 210L168 168L196 236" />
            <path d="M88 268L148 292" />
          </g>

          {/* Nodes */}
          <g className={styles.nodes}>
            <circle cx="52" cy="86" r="2.4" fill="rgba(210,225,255,0.95)" />
            <circle cx="98" cy="128" r="3" fill="url(#heroDataNode)" />
            <circle cx="148" cy="110" r="2.2" fill="rgba(200,220,255,0.88)" />
            <circle cx="74" cy="176" r="2.6" fill="rgba(190,215,255,0.9)" />
            <circle cx="168" cy="168" r="2.8" fill="url(#heroDataNode)" />
            <circle cx="128" cy="210" r="2.3" fill="rgba(200,220,255,0.88)" />
            <circle cx="42" cy="230" r="2" fill="rgba(180,210,255,0.8)" />
            <circle cx="196" cy="236" r="2.4" fill="rgba(200,220,255,0.85)" />
            <circle cx="88" cy="268" r="2.5" fill="url(#heroDataNode)" />
            <circle cx="148" cy="292" r="2.1" fill="rgba(190,215,255,0.85)" />
          </g>

          {/* Pulse dots (decorative) */}
          <circle className={styles.pulseA} cx="98" cy="128" r="8" />
          <circle className={styles.pulseB} cx="168" cy="168" r="7" />
        </svg>

        <div className={styles.labels}>
          <span className={styles.label} style={{ top: "18%", left: "8%" }}>
            HOLDERS
          </span>
          <span className={styles.label} style={{ top: "46%", left: "4%" }}>
            LIQ
          </span>
          <span className={styles.label} style={{ top: "72%", left: "12%" }}>
            VOL
          </span>
        </div>
      </aside>

      <aside className={`${styles.panel} ${styles.right}`}>
        <svg
          className={styles.svg}
          viewBox="0 0 280 360"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="heroSignalFade" x1="280" y1="180" x2="0" y2="180">
              <stop offset="0%" stopColor="rgba(158,182,255,0.38)" />
              <stop offset="65%" stopColor="rgba(158,182,255,0.14)" />
              <stop offset="100%" stopColor="rgba(158,182,255,0)" />
            </linearGradient>
            <linearGradient id="heroWaveStroke" x1="40" y1="0" x2="250" y2="0">
              <stop offset="0%" stopColor="rgba(158,182,255,0)" />
              <stop offset="25%" stopColor="rgba(125,211,252,0.55)" />
              <stop offset="75%" stopColor="rgba(110,231,183,0.5)" />
              <stop offset="100%" stopColor="rgba(158,182,255,0)" />
            </linearGradient>
          </defs>

          {/* Faint reference rails */}
          <g stroke="url(#heroSignalFade)" strokeWidth="0.8" opacity="0.72">
            <path d="M40 96H250M40 168H250M40 240H250" />
            <path d="M70 60V300M140 70V290M210 80V280" strokeDasharray="2 6" />
          </g>

          {/* Market-wave path (decorative — not live data) */}
          <path
            className={styles.wave}
            d="M36 210 C58 198, 72 168, 92 176 C112 184, 124 228, 148 214 C172 200, 186 148, 208 156 C230 164, 242 188, 258 172"
            stroke="url(#heroWaveStroke)"
            strokeWidth="1.65"
            strokeLinecap="round"
          />
          <path
            className={styles.waveSoft}
            d="M36 236 C60 248, 78 220, 98 228 C118 236, 132 268, 156 254 C180 240, 194 206, 218 214 C240 222, 248 246, 258 238"
            stroke="rgba(167,139,250,0.28)"
            strokeWidth="1.15"
            strokeLinecap="round"
          />

          {/* Signal points */}
          <g fill="rgba(200,220,255,0.9)">
            <circle cx="92" cy="176" r="2.3" />
            <circle cx="148" cy="214" r="2.6" />
            <circle cx="208" cy="156" r="2.4" />
            <circle className={styles.signalDot} cx="148" cy="214" r="6" />
          </g>

          {/* Vertical signal ticks */}
          <g stroke="rgba(110,231,183,0.45)" strokeWidth="1">
            <path className={styles.tick} d="M148 198V230" />
            <path d="M208 142V170" opacity="0.8" />
          </g>
        </svg>

        <div className={styles.labels}>
          <span
            className={`${styles.label} ${styles.labelMomentum}`}
            style={{ top: "16%", right: "10%" }}
          >
            MOMENTUM
          </span>
          <span
            className={`${styles.label} ${styles.labelRisk}`}
            style={{ top: "44%", right: "6%" }}
          >
            RISK
          </span>
          <span
            className={`${styles.label} ${styles.labelSignal}`}
            style={{ top: "70%", right: "14%" }}
          >
            SIGNAL
          </span>
        </div>
      </aside>
    </div>
  );
}
