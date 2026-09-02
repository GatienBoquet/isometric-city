'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { GameProvider } from '@/context/GameContext';
import { MultiplayerContextProvider } from '@/context/MultiplayerContext';
import Game from '@/components/Game';
import { takeLaunchMode } from '@/lib/launchGame';
import { useIsClient } from '@/hooks/useIsClient';
import { T } from 'gt-next';

export default function PlayPage() {
  const router = useRouter();
  const isClient = useIsClient();

  if (!isClient) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-white/60"><T>Loading...</T></div>
      </main>
    );
  }

  // Idempotent: the first call consumes the sessionStorage flag and caches it,
  // so re-renders keep resolving to the same mode.
  const fresh = takeLaunchMode() === 'new';

  return (
    <MultiplayerContextProvider>
      <GameProvider startFresh={fresh}>
        <main className="h-screen w-screen overflow-hidden">
          <Game onExit={() => router.push('/')} />
        </main>
      </GameProvider>
    </MultiplayerContextProvider>
  );
}
