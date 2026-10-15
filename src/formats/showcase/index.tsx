import type { FormatPack, FormatRendering } from '@/catalog/catalog';
import { TITLE_CARD_FORMAT, titleCardFormat } from '@/formats/title-card';
import { resolveTimeline, type VideoSpec } from '@/spec/video-spec';

import { createShowcaseOverlay, type ShowcaseDisclosure } from './overlay';

export const SHOWCASE_FORMAT = { id: 'showcase', version: 1 } as const;

/**
 * Showcase format: the title-card video plus browser-only disclosures anchored to specific
 * scenes. The rendered video is exactly the title-card composition; every interaction lives in
 * the Player overlay, so headless renders never depend on UI state.
 */
export function showcaseFormat(disclosures: readonly ShowcaseDisclosure[]): FormatPack {
  return {
    ...SHOWCASE_FORMAT,
    compose(spec: VideoSpec): FormatRendering {
      const { component } = titleCardFormat.compose({ ...spec, format: { ...TITLE_CARD_FORMAT } });
      const timeline = resolveTimeline(spec).scenes;
      const windows = disclosures.map((disclosure) => {
        const scene = timeline.find((candidate) => candidate.id === disclosure.sceneId);
        if (!scene) throw new Error(`showcase disclosure "${disclosure.kind}" names unknown scene "${disclosure.sceneId}"`);
        return { ...disclosure, from: scene.from, to: scene.from + scene.durationInFrames };
      });
      return { component, Overlay: createShowcaseOverlay(windows) };
    },
  };
}
