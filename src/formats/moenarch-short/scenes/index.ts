import type { ComponentType } from 'react';

import type { SceneKind } from '@/spec/video-spec';

import { ComparisonScene } from './comparison';
import { ConclusionScene } from './conclusion';
import { DataPointScene } from './data-point';
import { ListScene } from './list';
import { MediaRevealScene } from './media-reveal';
import type { MoenarchSceneProps } from './parts';
import { QuoteScene } from './quote';
import { StatementScene } from './statement';
import { TitleScene } from './title';

export type { MoenarchSceneProps } from './parts';

/** The scene renderer of each archetype the format draws (`binnedChart` is not one). */
export const MOENARCH_SCENES: Record<Exclude<SceneKind, 'binnedChart'>, ComponentType<MoenarchSceneProps>> = {
  title: TitleScene,
  statement: StatementScene,
  mediaReveal: MediaRevealScene,
  comparison: ComparisonScene,
  quote: QuoteScene,
  dataPoint: DataPointScene,
  list: ListScene,
  conclusion: ConclusionScene,
};
