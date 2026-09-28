import type { ComponentType } from 'react';
import { withRenderCounter } from 'react-render-budget/react';

import type { PlayerRef } from '@remotion/player';

// Render counters exist only in the dedicated `vite build --mode render-budget` build that the
// Playwright budget tests run against; normal builds keep the original components.
export const RENDER_BUDGET = import.meta.env.MODE === 'render-budget';

// Returns the component's own type: widening it to ComponentType makes the Player's prop inference
// for `component={...}` extremely slow to type-check.
export function counted<Component extends ComponentType<never>>(component: Component, name: string) {
  return (
    RENDER_BUDGET ? withRenderCounter(component as ComponentType<object>, name) : component
  ) as Component;
}

declare global {
  interface Window {
    __latencyPlayer?: PlayerRef;
  }
}

export function exposePlayerForBudgetTests(player: PlayerRef | null) {
  if (RENDER_BUDGET && player) window.__latencyPlayer = player;
}
