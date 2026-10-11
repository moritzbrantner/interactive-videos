import { describe, expect, it } from 'vitest';

import { parseVideoSpec } from '@/spec/video-spec';
import fixture from '@/spec/fixtures/moenarch-narration.videospec.json';

// Regressions for the Codex review on PR #51.
type Dict = Record<string, any>;
const narrated = (): Dict => {
  const spec = structuredClone(fixture) as Dict;
  return spec;
};
const firstAudioScene = (spec: Dict) => spec.scenes.find((scene: Dict) => scene.narration?.audio);
const messagesAt = (spec: Dict, suffix: string) => {
  const result = parseVideoSpec(spec);
  return result.ok ? [] : result.diagnostics.filter((d) => d.path.endsWith(suffix)).map((d) => d.message);
};

describe('narration review regressions', () => {
  it('an invalid hold timestamp gets exactly one diagnostic', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    scene.narration.holds = [{ atMs: -1, durationMs: 100 }];
    expect(messagesAt(spec, 'holds[0].atMs')).toHaveLength(1);
  });

  it('a word that rounds to an empty frame window is rejected', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    const cue = scene.narration.cues[0];
    // Two timestamps inside one frame interval at 30 fps (frames are 33.3 ms apart).
    const start = Math.ceil((Math.ceil((cue.startMs * 30) / 1000) * 1000) / 30) + 1;
    scene.narration.words = [{ startMs: start, endMs: start + 5, text: 'tick' }];
    expect(messagesAt(spec, '.words[0]')).toContain('is not on screen on any rendered frame');
  });
});

describe('narration hold validation after an invalid predecessor', () => {
  it('still reports an independent problem of the next hold', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    scene.narration.holds = [
      { atMs: -1, durationMs: 100 },
      { atMs: 999999, durationMs: 100 },
    ];
    expect(messagesAt(spec, 'holds[1].atMs').join(' ')).toContain('must be inside the narration audio');
  });

  it('an unsafe integer timestamp gets exactly one diagnostic', () => {
    const spec = narrated();
    const scene = firstAudioScene(spec);
    scene.narration.holds = [{ atMs: Number.MAX_SAFE_INTEGER + 1, durationMs: 100 }];
    expect(messagesAt(spec, 'holds[0].atMs')).toHaveLength(1);
  });
});
