'use client';

import React, { useEffect, useRef } from 'react';
import { TILE_HEIGHT, TILE_WIDTH } from '@/components/game/types';
import { gridToScreen } from '@/components/game/utils';
import { useAgentOptional } from '@/context/AgentContext';

type Viewport = {
  offset: { x: number; y: number };
  zoom: number;
  canvasSize: { width: number; height: number };
};

const COLORS: Record<string, { fill: string; stroke: string }> = {
  problem: { fill: 'rgba(239, 68, 68, 0.38)', stroke: '#f87171' },
  focus: { fill: 'rgba(56, 189, 248, 0.35)', stroke: '#7dd3fc' },
  ghost: { fill: 'rgba(250, 204, 21, 0.42)', stroke: '#facc15' },
  ok: { fill: 'rgba(74, 222, 128, 0.32)', stroke: '#4ade80' },
};

export function AgentOverlayCanvas({ viewport }: { viewport: Viewport | null }) {
  const agent = useAgentOptional();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !viewport) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = viewport.canvasSize;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!agent || agent.highlights.length === 0) return;

    ctx.scale(dpr, dpr);
    ctx.translate(viewport.offset.x, viewport.offset.y);
    ctx.scale(viewport.zoom, viewport.zoom);

    for (const mark of agent.highlights) {
      const { screenX, screenY } = gridToScreen(mark.x, mark.y, 0, 0);
      const palette = COLORS[mark.kind] || COLORS.focus;
      const w = TILE_WIDTH;
      const h = TILE_HEIGHT;
      ctx.beginPath();
      ctx.moveTo(screenX + w / 2, screenY);
      ctx.lineTo(screenX + w, screenY + h / 2);
      ctx.lineTo(screenX + w / 2, screenY + h);
      ctx.lineTo(screenX, screenY + h / 2);
      ctx.closePath();
      ctx.fillStyle = palette.fill;
      ctx.fill();
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 2 / viewport.zoom;
      ctx.stroke();
    }
  }, [agent, agent?.highlights, viewport]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10 pointer-events-none"
      data-testid="agent-overlay"
    />
  );
}
