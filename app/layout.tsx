import type { Metadata, Viewport } from 'next';
import '../style.css';
import './multiplayer.css';
export const metadata: Metadata = { title: 'MARKET WARS · Monopolists vs Competitors', description: 'An online strategy board game for 2–4 players. Build an empire or compete on your own terms.', icons: {icon:'/icon.svg'} };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#d5eaf2' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
