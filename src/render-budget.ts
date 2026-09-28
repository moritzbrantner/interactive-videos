import type { PlayerRef } from '@remotion/player';
import { useRenderCounter } from 'react-render-budget/react';

// Render counters exist only in the dedicated `vite build --mode render-budget` build that the
// Playwright budget tests run against; normal builds get a no-op and ship no counter code.
export const RENDER_BUDGET = import.meta.env.MODE === 'render-budget';

// Counts every call of the calling component, including renders driven by the Player's frame
// context, which a wrapper such as withRenderCounter cannot see.
export const useBudgetCounter: (name: string) => void = RENDER_BUDGET
  ? useRenderCounter
  : () => undefined;

declare global {
  interface Window {
    __latencyPlayer?: PlayerRef;
  }
}

export function exposePlayerForBudgetTests(player: PlayerRef | null) {
  if (RENDER_BUDGET && player) window.__latencyPlayer = player;
}
