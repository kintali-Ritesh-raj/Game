import type { Metadata, Viewport } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Barlow_Condensed } from 'next/font/google';
import '../style.css';
import './multiplayer.css';
import './readable-board.css';
import './classic-board.css';
import './tabletop.css';
import './board-premium.css';
import './dark.css';
import './effects.css';
// Served from this site (no chained request to Google Fonts), so it does not hold up the first paint.
const barlow = Barlow_Condensed({ weight: ['500', '600', '700', '800'], subsets: ['latin'], display: 'swap', variable: '--font-barlow' });
export const metadata: Metadata = { title: 'MONOPOLY · No Mercy', description: 'An online strategy board game for 2–6 players. Buy land, collect color sets, build and outlast your rivals.', icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' }, appleWebApp: { capable: true, title: 'No Mercy', statusBarStyle: 'default' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#d5eaf2' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en" className={barlow.variable} suppressHydrationWarning><head>
  {/* Apply the saved theme before first paint to avoid a light flash. */}
  <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('market-wars-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}" }} />
</head><body>{children}<SpeedInsights /></body></html>; }
