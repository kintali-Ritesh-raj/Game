import type { Metadata, Viewport } from 'next';
import '../style.css';
import './multiplayer.css';
import './readable-board.css';
import './classic-board.css';
import './tabletop.css';
import './dark.css';
export const metadata: Metadata = { title: 'MARKET WARS · Monopolists vs Competitors', description: 'An online strategy board game for 2–4 players. Build an empire or compete on your own terms.', icons: {icon:'/icon.svg'} };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#d5eaf2' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en" suppressHydrationWarning><head>
  {/* Apply the saved theme before first paint to avoid a light flash. */}
  <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('market-wars-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}" }} />
</head><body>{children}</body></html>; }
