function landingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MeetsGo — Scheduling, simplified.</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script>
    (function(){var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');else if(t==='light')document.documentElement.setAttribute('data-theme','light');else{var d=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',d);}})();
  </script>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --primary: #2892D7;
      --primary-light: #3BA3E8;
      --primary-dark: #1B6FA8;
      --accent: #6DAEDB;
      --bg: #0A0E14;
      --bg-card: rgba(255,255,255,0.03);
      --bg-card-hover: rgba(255,255,255,0.06);
      --text: #F0F4F8;
      --text-secondary: #8B95A5;
      --border: rgba(255,255,255,0.08);
      --glow: rgba(40, 146, 215, 0.15);
      --nav-bg: rgba(10, 14, 20, 0.7);
      --nav-bg-scroll: rgba(10, 14, 20, 0.9);
      --shadow-card: rgba(0,0,0,0.2);
      --orb-opacity: 0.4;
      --grid-line: rgba(255,255,255,0.02);
    }

    [data-theme="light"] {
      --bg: #F8FAFB;
      --bg-card: rgba(0,0,0,0.02);
      --bg-card-hover: rgba(0,0,0,0.04);
      --text: #1A2332;
      --text-secondary: #5F6B7A;
      --border: rgba(0,0,0,0.08);
      --glow: rgba(40, 146, 215, 0.1);
      --nav-bg: rgba(248, 250, 251, 0.8);
      --nav-bg-scroll: rgba(248, 250, 251, 0.95);
      --shadow-card: rgba(0,0,0,0.06);
      --orb-opacity: 0.15;
      --grid-line: rgba(0,0,0,0.03);
    }

    html {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      scroll-behavior: smooth;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    body {
      min-height: 100vh;
      position: relative;
    }

    /* ─── Ambient Background ─── */
    .ambient {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      overflow: hidden;
    }

    .ambient-orb {
      position: absolute;
      border-radius: 50%;
      filter: blur(120px);
      opacity: 0.4;
      animation: orbFloat 20s ease-in-out infinite;
    }

    .ambient-orb:nth-child(1) {
      width: 600px; height: 600px;
      background: var(--primary);
      top: -200px; left: -100px;
      animation-delay: 0s;
    }

    .ambient-orb:nth-child(2) {
      width: 500px; height: 500px;
      background: var(--accent);
      bottom: -150px; right: -100px;
      animation-delay: -7s;
      opacity: 0.25;
    }

    .ambient-orb:nth-child(3) {
      width: 300px; height: 300px;
      background: #5B8DEF;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      animation-delay: -14s;
      opacity: 0.15;
    }

    @keyframes orbFloat {
      0%, 100% { transform: translate(0, 0) scale(1); }
      33% { transform: translate(30px, -40px) scale(1.05); }
      66% { transform: translate(-20px, 30px) scale(0.95); }
    }

    /* ─── Grid Pattern ─── */
    .grid-pattern {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
      background-size: 80px 80px;
      mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, black 20%, transparent 70%);
      -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 30%, black 20%, transparent 70%);
    }

    /* ─── Content ─── */
    .content {
      position: relative;
      z-index: 1;
    }

    /* ─── Nav ─── */
    .nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      padding: 20px 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      background: var(--nav-bg);
      border-bottom: 1px solid var(--border);
      transition: background 0.3s ease;
    }

    .nav-logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .nav-logo img {
      height: 28px;
      opacity: 0;
      animation: fadeSlideDown 0.6s ease forwards;
    }

    .nav-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 24px;
      background: var(--primary);
      color: white;
      border-radius: 10px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: -0.01em;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease, box-shadow 0.2s ease;
      box-shadow: 0 4px 16px rgba(40, 146, 215, 0.3);
      opacity: 0;
      animation: fadeSlideDown 0.6s ease 0.1s forwards;
    }

    .nav-cta:hover {
      transform: scale(1.04) translateY(-1px);
      background: var(--primary-light);
      box-shadow: 0 8px 32px rgba(40, 146, 215, 0.4);
    }

    .nav-cta:active {
      transform: scale(0.97);
    }

    /* ─── Hero ─── */
    .hero {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 120px 24px 80px;
      gap: 32px;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 100px;
      font-size: 13px;
      font-weight: 500;
      color: var(--accent);
      opacity: 0;
      animation: fadeSlideUp 0.7s ease 0.2s forwards;
    }

    .hero-badge::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--primary);
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(1.5); }
    }

    .hero h1 {
      font-size: clamp(3rem, 8vw, 5.5rem);
      font-weight: 800;
      line-height: 1.05;
      letter-spacing: -0.04em;
      max-width: 800px;
      opacity: 0;
      animation: fadeSlideUp 0.8s ease 0.3s forwards;
    }

    .hero h1 .gradient {
      background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 50%, #A8D4F0 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .hero-sub {
      font-size: clamp(1rem, 2.5vw, 1.25rem);
      color: var(--text-secondary);
      max-width: 520px;
      line-height: 1.6;
      font-weight: 400;
      opacity: 0;
      animation: fadeSlideUp 0.8s ease 0.45s forwards;
    }

    .hero-actions {
      display: flex;
      gap: 16px;
      align-items: center;
      opacity: 0;
      animation: fadeSlideUp 0.8s ease 0.6s forwards;
    }

    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 16px 32px;
      background: var(--primary);
      color: white;
      border-radius: 14px;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      letter-spacing: -0.01em;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease, box-shadow 0.3s ease;
      box-shadow: 0 4px 24px rgba(40, 146, 215, 0.3), inset 0 1px 0 rgba(255,255,255,0.1);
    }

    .btn-primary:hover {
      transform: scale(1.04) translateY(-2px);
      background: var(--primary-light);
      box-shadow: 0 12px 40px rgba(40, 146, 215, 0.4), inset 0 1px 0 rgba(255,255,255,0.15);
    }

    .btn-primary:active { transform: scale(0.97); }

    .btn-secondary {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 16px 32px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 14px;
      text-decoration: none;
      font-weight: 500;
      font-size: 16px;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease, border-color 0.2s ease;
    }

    .btn-secondary:hover {
      transform: scale(1.03) translateY(-1px);
      background: var(--bg-card-hover);
      border-color: rgba(255,255,255,0.15);
    }

    .btn-secondary:active { transform: scale(0.97); }

    /* ─── Hero Visual ─── */
    .hero-visual {
      position: relative;
      width: 100%;
      max-width: 900px;
      margin-top: 40px;
      opacity: 0;
      animation: fadeScaleUp 1s ease 0.8s forwards;
    }

    .hero-mockup {
      width: 100%;
      border-radius: 20px;
      background: linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02));
      border: 1px solid var(--border);
      padding: 24px;
      backdrop-filter: blur(10px);
      box-shadow: 0 40px 100px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05);
    }

    .mockup-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
    }

    .mockup-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
    }

    .mockup-dot:nth-child(1) { background: #FF5F57; }
    .mockup-dot:nth-child(2) { background: #FEBC2E; }
    .mockup-dot:nth-child(3) { background: #28C840; }

    .mockup-body {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
    }

    .mockup-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      opacity: 0;
      animation: cardReveal 0.6s ease forwards;
    }

    .mockup-card:nth-child(1) { animation-delay: 1.2s; }
    .mockup-card:nth-child(2) { animation-delay: 1.4s; }
    .mockup-card:nth-child(3) { animation-delay: 1.6s; }

    @keyframes cardReveal {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .mockup-card-icon {
      width: 36px; height: 36px;
      border-radius: 10px;
      background: var(--glow);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
      font-size: 18px;
    }

    .mockup-card h4 {
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--text);
    }

    .mockup-card p {
      font-size: 11px;
      color: var(--text-secondary);
      line-height: 1.4;
    }

    .mockup-bar {
      height: 6px;
      border-radius: 3px;
      background: var(--border);
      margin-top: 12px;
      overflow: hidden;
    }

    .mockup-bar-fill {
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, var(--primary), var(--accent));
      animation: barGrow 2s ease 1.8s forwards;
      width: 0%;
    }

    @keyframes barGrow {
      to { width: 72%; }
    }

    /* ─── Features ─── */
    .features {
      padding: 120px 24px;
      max-width: 1100px;
      margin: 0 auto;
    }

    .features-header {
      text-align: center;
      margin-bottom: 80px;
    }

    .features-header h2 {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 16px;
    }

    .features-header p {
      color: var(--text-secondary);
      font-size: 1.1rem;
      max-width: 500px;
      margin: 0 auto;
    }

    .features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
    }

    .feature-card {
      position: relative;
      padding: 32px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 20px;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.3s ease, box-shadow 0.3s ease;
      overflow: hidden;
      opacity: 0;
      transform: translateY(30px);
    }

    .feature-card.visible {
      opacity: 1;
      transform: translateY(0);
      transition: opacity 0.6s ease, transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .feature-card:hover {
      transform: translateY(-4px) scale(1.01);
      border-color: rgba(40, 146, 215, 0.3);
      box-shadow: 0 20px 60px rgba(40, 146, 215, 0.1);
    }

    .feature-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--primary), transparent);
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .feature-card:hover::before { opacity: 1; }

    .feature-icon {
      width: 48px; height: 48px;
      border-radius: 14px;
      background: var(--glow);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 20px;
      font-size: 22px;
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .feature-card:hover .feature-icon {
      transform: scale(1.1) rotate(-3deg);
    }

    .feature-card h3 {
      font-size: 1.1rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }

    .feature-card p {
      font-size: 0.9rem;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    /* ─── CTA Section ─── */
    .cta-section {
      padding: 120px 24px;
      text-align: center;
      position: relative;
    }

    .cta-section::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, var(--glow) 0%, transparent 70%);
      pointer-events: none;
    }

    .cta-content {
      position: relative;
      z-index: 1;
    }

    .cta-content h2 {
      font-size: clamp(2rem, 5vw, 3.5rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 16px;
    }

    .cta-content p {
      color: var(--text-secondary);
      font-size: 1.1rem;
      margin-bottom: 32px;
    }

    /* ─── Footer ─── */
    .footer {
      padding: 40px 24px;
      text-align: center;
      border-top: 1px solid var(--border);
      color: var(--text-secondary);
      font-size: 13px;
    }

    /* ─── Floating Cards (Hero) ─── */
    .hero-floating-cards {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }

    .floating-card {
      position: absolute;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      background: rgba(255,255,255,0.06);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      white-space: nowrap;
      opacity: 0;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }

    .floating-card svg {
      flex-shrink: 0;
    }

    .fc-1 { top: 18%; left: 6%; animation: floatCard 0.6s ease 1.2s forwards, floatBob 6s ease-in-out 1.8s infinite; }
    .fc-2 { top: 30%; right: 5%; animation: floatCard 0.6s ease 1.6s forwards, floatBob 6s ease-in-out 2.2s infinite; }
    .fc-3 { bottom: 28%; left: 4%; animation: floatCard 0.6s ease 2.0s forwards, floatBob 6s ease-in-out 2.6s infinite; }
    .fc-4 { bottom: 15%; right: 8%; animation: floatCard 0.6s ease 2.4s forwards, floatBob 6s ease-in-out 3.0s infinite; }

    @keyframes floatCard {
      from { opacity: 0; transform: translateY(16px) scale(0.9); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes floatBob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }

    /* ─── How It Works ─── */
    .how-it-works {
      padding: 120px 24px;
      max-width: 900px;
      margin: 0 auto;
    }

    .how-it-works-header {
      text-align: center;
      margin-bottom: 64px;
    }

    .how-it-works-header h2 {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 12px;
    }

    .how-it-works-header p {
      color: var(--text-secondary);
      font-size: 1.05rem;
    }

    .steps {
      display: flex;
      flex-direction: column;
      gap: 0;
      position: relative;
    }

    .steps::before {
      content: '';
      position: absolute;
      left: 24px;
      top: 48px;
      bottom: 48px;
      width: 2px;
      background: linear-gradient(180deg, var(--primary), var(--accent), transparent);
      border-radius: 1px;
    }

    .step {
      display: flex;
      align-items: flex-start;
      gap: 28px;
      padding: 32px 0;
      opacity: 0;
      transform: translateX(-20px);
      transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .step.visible {
      opacity: 1;
      transform: translateX(0);
    }

    .step-number {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--bg);
      border: 2px solid var(--primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      color: var(--primary);
      flex-shrink: 0;
      position: relative;
      z-index: 1;
      transition: background 0.3s ease, color 0.3s ease;
    }

    .step.visible .step-number {
      background: var(--primary);
      color: white;
    }

    .step-content h3 {
      font-size: 1.2rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }

    .step-content p {
      color: var(--text-secondary);
      font-size: 0.95rem;
      line-height: 1.6;
    }

    /* ─── Integrations ─── */
    .integrations {
      padding: 100px 24px;
      text-align: center;
    }

    .integrations h2 {
      font-size: clamp(1.8rem, 4vw, 2.5rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 12px;
    }

    .integrations p {
      color: var(--text-secondary);
      font-size: 1.05rem;
      margin-bottom: 48px;
    }

    .integrations-grid {
      display: flex;
      justify-content: center;
      gap: 32px;
      flex-wrap: wrap;
      max-width: 600px;
      margin: 0 auto;
    }

    .integration-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 24px 32px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.3s ease, box-shadow 0.3s ease;
      opacity: 0;
      transform: translateY(20px);
    }

    .integration-item.visible {
      opacity: 1;
      transform: translateY(0);
      transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .integration-item:hover {
      transform: translateY(-4px) scale(1.03);
      border-color: rgba(255,255,255,0.15);
      box-shadow: 0 12px 40px rgba(0,0,0,0.2);
    }

    .integration-item svg {
      width: 40px;
      height: 40px;
    }

    .integration-item span {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    /* ─── Footer ─── */
    .footer {
      padding: 60px 24px 40px;
      border-top: 1px solid var(--border);
      max-width: 1100px;
      margin: 0 auto;
    }

    .footer-grid {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 48px;
      margin-bottom: 48px;
    }

    .footer-brand img {
      height: 28px;
      margin-bottom: 16px;
      opacity: 0.9;
    }

    .footer-brand p {
      color: var(--text-secondary);
      font-size: 13px;
      line-height: 1.6;
      max-width: 260px;
    }

    .footer-col h4 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text);
      margin-bottom: 16px;
    }

    .footer-col a {
      display: block;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 13px;
      padding: 4px 0;
      transition: color 0.2s ease;
    }

    .footer-col a:hover {
      color: var(--primary);
    }

    .footer-bottom {
      padding-top: 24px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--text-secondary);
      font-size: 12px;
    }

    /* ─── Animations ─── */
    @keyframes fadeSlideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes fadeSlideDown {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes fadeScaleUp {
      from { opacity: 0; transform: scale(0.95) translateY(30px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    /* ─── Scroll-triggered stagger ─── */
    .stagger-1 { transition-delay: 0.05s; }
    .stagger-2 { transition-delay: 0.1s; }
    .stagger-3 { transition-delay: 0.15s; }

    /* ─── Light Mode Overrides ─── */
    [data-theme="light"] .ambient-orb { opacity: 0.15; }
    [data-theme="light"] .ambient-orb:nth-child(2) { opacity: 0.1; }
    [data-theme="light"] .ambient-orb:nth-child(3) { opacity: 0.08; }
    [data-theme="light"] .grid-pattern { background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px); }
    [data-theme="light"] .hero h1 .gradient { background: linear-gradient(135deg, var(--primary-dark) 0%, var(--primary) 50%, var(--accent) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    [data-theme="light"] .hero-badge { color: var(--primary-dark); }
    [data-theme="light"] .btn-primary { box-shadow: 0 4px 24px rgba(40,146,215,0.2), inset 0 1px 0 rgba(255,255,255,0.2); }
    [data-theme="light"] .btn-secondary { background: white; border-color: rgba(0,0,0,0.12); color: var(--text); }
    [data-theme="light"] .btn-secondary:hover { background: #F0F4F8; border-color: rgba(0,0,0,0.18); }
    [data-theme="light"] .hero-mockup { background: linear-gradient(145deg, rgba(255,255,255,0.9), rgba(255,255,255,0.7)); border-color: rgba(0,0,0,0.08); box-shadow: 0 40px 100px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04); }
    [data-theme="light"] .mockup-card { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.06); }
    [data-theme="light"] .floating-card { background: rgba(255,255,255,0.85); border-color: rgba(0,0,0,0.08); box-shadow: 0 8px 32px rgba(0,0,0,0.08); }
    [data-theme="light"] .feature-card { background: white; border-color: rgba(0,0,0,0.06); }
    [data-theme="light"] .feature-card:hover { border-color: rgba(40,146,215,0.3); box-shadow: 0 20px 60px rgba(40,146,215,0.08); }
    [data-theme="light"] .step-number { background: white; }
    [data-theme="light"] .integration-item { background: white; border-color: rgba(0,0,0,0.06); }
    [data-theme="light"] .integration-item:hover { border-color: rgba(0,0,0,0.12); box-shadow: 0 12px 40px rgba(0,0,0,0.06); }
    [data-theme="light"] .nav-cta { box-shadow: 0 4px 16px rgba(40,146,215,0.2); }
    [data-theme="light"] .cta-section::before { background: radial-gradient(circle, rgba(40,146,215,0.06) 0%, transparent 70%); }

    /* ─── Reduced Motion ─── */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.2s !important;
      }
      .ambient-orb { animation: none; opacity: 0.2; }
      .feature-card, .step, .integration-item { opacity: 1; transform: none; }
      .floating-card { opacity: 0 !important; animation: none !important; }
    }

    /* ─── Mobile ─── */
    @media (max-width: 768px) {
      .nav { padding: 16px 20px; }
      .hero { padding: 100px 20px 60px; }
      .mockup-body { grid-template-columns: 1fr; }
      .hero-actions { flex-direction: column; width: 100%; }
      .hero-actions a { width: 100%; justify-content: center; }
      .features { padding: 80px 20px; }
      .features-grid { grid-template-columns: 1fr; }
      .floating-card { display: none; }
      .steps::before { left: 23px; }
      .footer-grid { flex-direction: column; gap: 32px; }
      .integrations-grid { gap: 16px; }
      .integration-item { padding: 20px 24px; }
    }
  </style>
</head>
<body>
  <!-- Ambient Background -->
  <div class="ambient">
    <div class="ambient-orb"></div>
    <div class="ambient-orb"></div>
    <div class="ambient-orb"></div>
  </div>
  <div class="grid-pattern"></div>

  <!-- Content -->
  <div class="content">
    <!-- Nav -->
    <nav class="nav">
      <div class="nav-logo">
        <img src="/img/logo.svg" alt="MeetsGo" style="height: 32px;">
      </div>
      <a href="/admin/login" class="nav-cta">Get Started</a>
    </nav>

    <!-- Hero -->
    <section class="hero">
      <div class="hero-floating-cards">
        <div class="floating-card fc-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#28C840" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          Meeting Booked
        </div>
        <div class="floating-card fc-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg>
          Calendar Synced
        </div>
        <div class="floating-card fc-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FEBC2E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Reminder Sent
        </div>
        <div class="floating-card fc-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Team Invited
        </div>
      </div>
      <span class="hero-badge">Scheduling made easy</span>
      <h1>Scheduling,<br><span class="gradient">simplified.</span></h1>
      <p class="hero-sub">Share your availability, let others book time with you. No back-and-forth emails. Just simple scheduling.</p>
      <div class="hero-actions">
        <a href="/admin/register" class="btn-primary">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Start for free
        </a>
        <a href="/home#features" class="btn-secondary">See features</a>
      </div>

      <!-- Hero Visual -->
      <div class="hero-visual">
        <div class="hero-mockup">
          <div class="mockup-header">
            <div class="mockup-dot"></div>
            <div class="mockup-dot"></div>
            <div class="mockup-dot"></div>
          </div>
          <div class="mockup-body">
            <div class="mockup-card">
              <div class="mockup-card-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg></div>
              <h4>Today's Meetings</h4>
              <p>3 confirmed bookings</p>
              <div class="mockup-bar"><div class="mockup-bar-fill"></div></div>
            </div>
            <div class="mockup-card">
              <div class="mockup-card-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
              <h4>Quick Setup</h4>
              <p>Profile ready in 2 min</p>
              <div class="mockup-bar"><div class="mockup-bar-fill" style="animation-delay: 2s;"></div></div>
            </div>
            <div class="mockup-card">
              <div class="mockup-card-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg></div>
              <h4>Share Link</h4>
              <p>One link, all availability</p>
              <div class="mockup-bar"><div class="mockup-bar-fill" style="animation-delay: 2.2s;"></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="features" id="features">
      <div class="features-header">
        <h2>Everything you need</h2>
        <p>Powerful scheduling without the complexity.</p>
      </div>
      <div class="features-grid">
        <div class="feature-card stagger-1">
          <div class="feature-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M9 16l2 2 4-4"/></svg></div>
          <h3>Calendar Sync</h3>
          <p>Connect Google, Microsoft, or Zoho calendars. Real-time conflict detection keeps you double-booking free.</p>
        </div>
        <div class="feature-card stagger-2">
          <div class="feature-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
          <h3>Flexible Duration</h3>
          <p>Offer multiple meeting lengths. Let bookers choose 15, 30, or 60 minutes — whatever fits.</p>
        </div>
        <div class="feature-card stagger-3">
          <div class="feature-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>
          <h3>Customizable</h3>
          <p>Custom profiles, dark mode booking pages, and your own domain. Make it yours.</p>
        </div>
      </div>
    </section>

    <!-- How It Works -->
    <section class="how-it-works">
      <div class="how-it-works-header">
        <h2>How it works</h2>
        <p>Three steps to effortless scheduling.</p>
      </div>
      <div class="steps">
        <div class="step">
          <div class="step-number">1</div>
          <div class="step-content">
            <h3>Set your availability</h3>
            <p>Define when you're free. Set buffer times, meeting durations, and daily limits — all in one place.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-number">2</div>
          <div class="step-content">
            <h3>Share your link</h3>
            <p>Send your personal booking link. Guests see your real-time availability and pick a slot that works.</p>
          </div>
        </div>
        <div class="step">
          <div class="step-number">3</div>
          <div class="step-content">
            <h3>Meet with confidence</h3>
            <p>Bookings appear on your calendar automatically. Both sides get confirmations — no manual follow-up.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Integrations -->
    <section class="integrations">
      <h2>Connects with your calendar</h2>
      <p>Sync in seconds. Stay conflict-free.</p>
      <div class="integrations-grid">
        <div class="integration-item">
          <svg viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          <span>Google</span>
        </div>
        <div class="integration-item">
          <svg viewBox="0 0 24 24" fill="none"><path d="M11.4 24H2.6A2.6 2.6 0 0 1 0 21.4v-8.8h11.4V24z" fill="#007940"/><path d="M11.4 0H2.6A2.6 2.6 0 0 0 0 2.6v8.8h11.4V0z" fill="#FF3E00"/><path d="M24 2.6A2.6 2.6 0 0 0 21.4 0H11.4v11.4H24V2.6z" fill="#FFB900"/><path d="M11.4 12.6H24v8.8a2.6 2.6 0 0 1-2.6 2.6H11.4V12.6z" fill="#00A4EF"/></svg>
          <span>Microsoft</span>
        </div>
        <div class="integration-item">
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="#C8202B"/></svg>
          <span>Zoho</span>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="cta-section">
      <div class="cta-content">
        <h2>Ready to simplify your schedule?</h2>
        <p>Get started in under 3 minutes. Free to use.</p>
        <a href="/admin/register" class="btn-primary">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Create your account
        </a>
      </div>
    </section>

    <!-- Footer -->
    <footer class="footer">
      <div class="footer-grid">
        <div class="footer-brand">
          <img src="/img/logo.svg" alt="MeetsGo">
          <p>Simple, beautiful scheduling for professionals and teams.</p>
        </div>
        <div class="footer-col">
          <h4>Account</h4>
          <a href="/admin/login">Log In</a>
          <a href="/admin/register">Sign Up</a>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; 2026 MeetsGo. All rights reserved.</span>
        <span>Made with care.</span>
      </div>
    </footer>
  </div>

  <script>
    // Intersection Observer for scroll-reveal
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.feature-card, .step, .integration-item').forEach(el => observer.observe(el));

    // Parallax on mouse move for hero visual
    const heroVisual = document.querySelector('.hero-visual');
    if (heroVisual && window.matchMedia('(min-width: 768px)').matches) {
      document.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.5) * 8;
        const y = (e.clientY / window.innerHeight - 0.5) * 4;
        heroVisual.style.transform = \`perspective(1000px) rotateY(\${x}deg) rotateX(\${-y}deg)\`;
      });
    }

    // Smooth nav background on scroll
    const nav = document.querySelector('.nav');
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          nav.style.background = window.scrollY > 50 ? 'var(--nav-bg-scroll)' : 'var(--nav-bg)';
          ticking = false;
        });
        ticking = true;
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { landingPage };
