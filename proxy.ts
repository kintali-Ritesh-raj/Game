import type { NextRequest } from 'next/server';
import { updateSession } from '@/utils/supabase/middleware';

// Next.js 16 calls this proxy.ts; this is the session refresh middleware.
export async function proxy(request: NextRequest) { return updateSession(request); }
export const config = { matcher: ['/', '/game/:path*'] };
