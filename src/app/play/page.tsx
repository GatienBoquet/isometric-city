'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GameProvider } from '@/context/GameContext';
import { MultiplayerContextProvider } from '@/context/MultiplayerContext';
import Game from '@/components/Game';
import { takeLaunchMode } from '@/lib/launchGame';
import { T } from 'gt-next';

export default function PlayPage() {
  const router = useRouter();
  const [fresh, setFresh] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setFresh(takeLaunchMode() === 'new');
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-white/60"><T>Loading...</T></div>
      </main>
    );
  }

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
