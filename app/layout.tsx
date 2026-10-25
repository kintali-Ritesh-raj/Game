import type { Metadata, Viewport } from 'next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import '../style.css';
import './multiplayer.css';
import './readable-board.css';
import './classic-board.css';
import './tabletop.css';
import './board-premium.css';
import './dark.css';
import './effects.css';
export const metadata: Metadata = { title: 'MONOPOLY · No Mercy', description: 'An online strategy board game for 2–6 players. Buy land, collect color sets, build and outlast your rivals.', icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' }, appleWebApp: { capable: true, title: 'No Mercy', statusBarStyle: 'default' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#d5eaf2' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en" suppressHydrationWarning><head>
  {/* Apply the saved theme before first paint to avoid a light flash. */}
  <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('market-wars-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}" }} />
</head><body>{children}<SpeedInsights /></body></html>; }
