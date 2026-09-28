// Bar reveal timing. Pure and dependency-free so the render budget tests can derive exact
// expected render counts from the same numbers the video uses.
export const REVEAL_START = 30;
export const REVEAL_STAGGER = 2;
export const REVEAL_DURATION = 18;

export function barRevealStart(index: number) {
  return REVEAL_START + index * REVEAL_STAGGER;
}

/** Reveal progress in [0, 1] for the bar at `index` on `frame`. */
export function barRevealProgress(index: number, frame: number) {
  const progress = (frame - barRevealStart(index)) / REVEAL_DURATION;
  return Math.min(1, Math.max(0, progress));
}

/** Frame from which the bar at `index` is fully revealed and clickable. */
export function barRevealEnd(index: number) {
  return barRevealStart(index) + REVEAL_DURATION;
}
