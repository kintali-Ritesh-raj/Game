import GameClient from '@/components/GameClient';
import { notFound } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) notFound();
  return <GameClient initialCode={code} />;
}
