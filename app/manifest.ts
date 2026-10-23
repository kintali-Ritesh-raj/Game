import type { MetadataRoute } from 'next';

// Lets players install the game as an app on Android, Windows, macOS and iPad (and add it to the iPhone home screen).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Monopoly: No Mercy',
    short_name: 'No Mercy',
    description: 'An online strategy board game for 2–6 players. Buy land, collect color sets, build and outlast your rivals.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f4f0e6',
    theme_color: '#d5eaf2',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
