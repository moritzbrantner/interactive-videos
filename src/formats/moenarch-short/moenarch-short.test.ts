// Acceptance for issue #12 (moenarch-short-v1 format pack), written before the implementation.
//
// Contract for the implementer (see also architecture.test.ts and e2e/moenarch-short.spec.ts):
// - `src/formats/moenarch-short/tokens.ts` exports `moenarchShortV1Tokens`: every format choice of
//   moenarch-short v1 as one deep-frozen, JSON-serializable data object (no React/Remotion import).
// - `src/formats/moenarch-short/plan.ts` (plain TS, no React/Remotion) exports
//   `planMoenarchShort(spec, tokens?)` and `moenarchFrameState(plan, frame, { reducedMotion })`,
//   the pure timing model the composition renders.
// - `src/formats/moenarch-short/index.ts(x)` exports `MOENARCH_SHORT_FORMAT` and the pack factory
//   `moenarchShort(overrides?)`, which returns a FormatPack plus the resolved `tokens`.
// - `src/projects.ts` registers `src/spec/fixtures/moenarch-specimen.videospec.json` with it.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCatalog } from '@/catalog/catalog';
import { MOENARCH_SHORT_FORMAT, moenarchShort } from '@/formats/moenarch-short';
import { moenarchFrameState, planMoenarchShort } from '@/formats/moenarch-short/plan';
import { moenarchShortV1Tokens as tokens } from '@/formats/moenarch-short/tokens';
import { catalog } from '@/projects';
import latencyFixture from '@/spec/fixtures/latency-explainer.videospec.json';
import specimenFixture from '@/spec/fixtures/moenarch-specimen.videospec.json';
import { assertVideoSpec, resolveTimeline } from '@/spec/video-spec';

const SPECIMEN_ID = 'moenarch-specimen';
const clone = <T,>(value: T): T => structuredClone(value);
const specimen = assertVideoSpec(specimenFixture);

// Loosely typed views, so the tests state the contract instead of inheriting the implementation's types.
type Dict = Record<string, unknown>;
const t = tokens as unknown as Dict;
const group = (name: string) => t[name] as Dict;
const vocabulary = () => group('transitions') as Record<string, { durationInFrames: number; motion: boolean; easing: string }>;

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(stringLeaves);
}

describe('moenarch-short v1 tokens', () => {
  it('are one versioned module identifying the format', () => {
    expect(t.id).toBe('moenarch-short');
    expect(t.version).toBe(1);
    expect(MOENARCH_SHORT_FORMAT).toEqual({ id: 'moenarch-short', version: 1 });
  });

  it('own every format choice the issue lists, as non-empty groups', () => {
    const groups = [
      'output', // portrait output profile + safe areas
      'typography', // type scale, text density, line length
      'palette',
      'surfaces',
      'spacing', // spacing / framing
      'pacing', // default scene durations and pacing ranges
      'transitions', // transition vocabulary
      'easing',
      'media', // image/video crop and treatment
      'subtitles', // subtitle placement
      'signature', // intro / outro / recurring signature
      'reducedMotion',
      'accents', // the only values a project may choose between (see overrides)
    ];
    for (const name of groups) {
      const value = t[name];
      expect(value, name).toBeTypeOf('object');
      expect(value, name).not.toBeNull();
      expect(Array.isArray(value), name).toBe(false);
      expect(Object.keys(value as Dict).length, name).toBeGreaterThan(0);
    }
  });

  it('are plain, deep-frozen data, so a version cannot drift at runtime', () => {
    expect(JSON.parse(JSON.stringify(tokens))).toEqual(tokens);
    expect(isDeepFrozen(tokens)).toBe(true);
  });

  it('define the portrait output profile and safe areas inside the frame', () => {
    const output = group('output') as { width: number; height: number; fps: number; safeArea: Dict };
    expect({ width: output.width, height: output.height, fps: output.fps }).toEqual({ width: 1080, height: 1920, fps: 30 });
    const safe = output.safeArea as { top: number; right: number; bottom: number; left: number };
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(Number.isFinite(safe[side]), side).toBe(true);
      expect(safe[side], side).toBeGreaterThanOrEqual(0);
    }
    expect(safe.top + safe.bottom).toBeLessThan(output.height);
    expect(safe.left + safe.right).toBeLessThan(output.width);
    expect(safe.top + safe.right + safe.bottom + safe.left).toBeGreaterThan(0);
  });

  it('define typography with a scale and text density / line length rules', () => {
    const typography = group('typography') as { fontFamily: string; scale: Dict; density: Dict };
    expect(typography.fontFamily).toMatch(/\S/);
    expect(Object.keys(typography.scale).length).toBeGreaterThan(1);
    const { maxCharsPerLine, maxLines } = typography.density as { maxCharsPerLine: number; maxLines: number };
    expect(Number.isInteger(maxCharsPerLine) && maxCharsPerLine > 0).toBe(true);
    expect(Number.isInteger(maxLines) && maxLines > 0).toBe(true);
  });

  it('define colours as hex values, with the accent chosen from the named accents', () => {
    for (const colour of stringLeaves(group('palette'))) expect(colour).toMatch(HEX);
    const accents = group('accents') as Record<string, string>;
    expect(Object.keys(accents).length).toBeGreaterThanOrEqual(2);
    for (const colour of Object.values(accents)) expect(colour).toMatch(HEX);
    expect(Object.values(accents)).toContain(group('palette').accent);
  });

  it('define pacing ranges that the specimen scenes respect', () => {
    const { minSceneDurationInFrames: min, defaultSceneDurationInFrames: def, maxSceneDurationInFrames: max } =
      group('pacing') as Record<string, number>;
    for (const value of [min, def, max]) expect(Number.isInteger(value) && value > 0).toBe(true);
    expect(min).toBeLessThanOrEqual(def);
    expect(def).toBeLessThanOrEqual(max);
    for (const scene of specimen.scenes) {
      expect(scene.durationInFrames, scene.id).toBeGreaterThanOrEqual(min);
      expect(scene.durationInFrames, scene.id).toBeLessThanOrEqual(max);
    }
  });

  it('define a transition vocabulary with durations, motion flags and named easings', () => {
    const entries = Object.entries(vocabulary());
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const easing = group('easing') as Record<string, unknown>;
    for (const [name, transition] of entries) {
      expect(Number.isInteger(transition.durationInFrames) && transition.durationInFrames >= 0, name).toBe(true);
      expect(transition.motion, name).toBeTypeOf('boolean');
      expect(Object.keys(easing), name).toContain(transition.easing);
    }
    // Easings are data (cubic-bezier control points), turned into Remotion easing by the pack.
    for (const [name, curve] of Object.entries(easing)) {
      expect(Array.isArray(curve) && curve.length === 4, name).toBe(true);
      const [x1, , x2] = curve as number[];
      expect((curve as number[]).every(Number.isFinite), name).toBe(true);
      expect(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1, name).toBe(true);
    }
    expect(entries.some(([, transition]) => transition.motion && transition.durationInFrames > 0)).toBe(true);
  });

  it('name an existing, motionless transition for reduced motion', () => {
    const reduced = group('reducedMotion').transition as string;
    expect(Object.keys(vocabulary())).toContain(reduced);
    expect(vocabulary()[reduced].motion).toBe(false);
  });

  it('define intro and outro lengths for the signature treatment', () => {
    const signature = group('signature') as { intro: Dict; outro: Dict };
    for (const part of [signature.intro, signature.outro]) {
      const frames = part.durationInFrames as number;
      expect(Number.isInteger(frames) && frames > 0).toBe(true);
    }
  });
});

describe('per-project overrides', () => {
  const accentKeys = () => Object.keys(group('accents'));
  const otherAccent = () => {
    const accents = group('accents') as Record<string, string>;
    const key = accentKeys().find((name) => accents[name] !== group('palette').accent);
    if (!key) throw new Error('no non-default accent');
    return key;
  };

  it('default to the v1 tokens unchanged', () => {
    const pack = moenarchShort();
    expect(pack.id).toBe('moenarch-short');
    expect(pack.version).toBe(1);
    expect(pack.tokens).toEqual(tokens);
    expect(moenarchShort({}).tokens).toEqual(tokens);
  });

  it('can pick a named accent and change nothing else', () => {
    const key = otherAccent();
    const pack = moenarchShort({ accent: key } as never);
    const expected = clone(tokens) as unknown as { palette: Dict; accents: Dict };
    expected.palette.accent = expected.accents[key];
    expect(pack.tokens).toEqual(expected);
    // An override is still the same format and version.
    expect({ id: pack.id, version: pack.version }).toEqual({ id: 'moenarch-short', version: 1 });
    expect(isDeepFrozen(pack.tokens)).toBe(true);
    // The shared v1 tokens are untouched.
    expect(t.palette).toEqual(clone(tokens).palette);
    expect(moenarchShort().tokens).toEqual(tokens);
  });

  it('reject unknown keys and values outside the allowed set', () => {
    const bad: unknown[] = [
      { accent: '#ff0000' },
      { accent: 'not-an-accent' },
      { accent: 1 },
      { palette: { accent: '#ff0000' } },
      { typography: { fontFamily: 'Comic Sans MS' } },
      { transitions: {} },
      { accent: accentKeys()[0], extra: true },
    ];
    for (const overrides of bad) expect(() => moenarchShort(overrides as never), JSON.stringify(overrides)).toThrow();
  });
});

describe('moenarch-short plan', () => {
  const plan = () => planMoenarchShort(specimen);

  it('keeps the spec timeline: scenes and total length come from the spec', () => {
    const timeline = resolveTimeline(specimen);
    const result = plan();
    expect(result.durationInFrames).toBe(timeline.durationInFrames);
    expect(result.scenes.map(({ id, from, durationInFrames }) => ({ id, from, durationInFrames }))).toEqual(
      timeline.scenes.map(({ id, from, durationInFrames }) => ({ id, from, durationInFrames })),
    );
  });

  it('places one vocabulary transition on every scene boundary', () => {
    const result = plan();
    const scenes = result.scenes;
    expect(result.transitions).toHaveLength(scenes.length - 1);
    result.transitions.forEach((transition, index) => {
      const [previous, next] = [scenes[index], scenes[index + 1]];
      expect(transition.fromSceneId).toBe(previous.id);
      expect(transition.toSceneId).toBe(next.id);
      expect(Object.keys(vocabulary())).toContain(transition.name);
      expect(transition.durationInFrames).toBe(vocabulary()[transition.name].durationInFrames);
      // The window spans the boundary and stays inside the two scenes.
      expect(transition.from).toBeGreaterThanOrEqual(previous.from);
      expect(transition.from).toBeLessThanOrEqual(next.from);
      expect(transition.from + transition.durationInFrames).toBeGreaterThanOrEqual(next.from);
      expect(transition.from + transition.durationInFrames).toBeLessThanOrEqual(next.from + next.durationInFrames);
    });
  });

  it('demonstrates every transition in the vocabulary in the specimen', () => {
    const used = new Set(plan().transitions.map((transition) => transition.name));
    expect([...used].sort()).toEqual(Object.keys(vocabulary()).sort());
  });

  it('overlays the intro and outro inside the spec timeline', () => {
    const result = plan();
    const signature = group('signature') as { intro: { durationInFrames: number }; outro: { durationInFrames: number } };
    expect(result.intro).toEqual({ from: 0, durationInFrames: signature.intro.durationInFrames });
    expect(result.outro).toEqual({
      from: result.durationInFrames - signature.outro.durationInFrames,
      durationInFrames: signature.outro.durationInFrames,
    });
  });

  it('refuses scenes the format cannot draw and text over the density limit', () => {
    const chart = assertVideoSpec({ ...clone(latencyFixture), format: { id: 'moenarch-short', version: 1 } });
    expect(() => planMoenarchShort(chart)).toThrow();
    const { maxCharsPerLine, maxLines } = (group('typography').density as { maxCharsPerLine: number; maxLines: number });
    const long = clone(specimenFixture);
    long.scenes[1].payload.heading = 'word '.repeat(Math.ceil((maxCharsPerLine * maxLines) / 5) + 2).trim();
    expect(() => planMoenarchShort(assertVideoSpec(long))).toThrow();
  });
});

describe('moenarch-short frame state', () => {
  afterEach(() => vi.restoreAllMocks());
  const plan = () => planMoenarchShort(specimen);
  const frames = (count: number) => Array.from({ length: count }, (_, frame) => frame);

  it('is a pure function of plan and frame: same answer in any order, no clock or randomness', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random in the format pack');
    });
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now in the format pack');
    });
    const first = plan();
    expect(planMoenarchShort(specimen)).toEqual(first);
    for (const reducedMotion of [false, true]) {
      const all = frames(first.durationInFrames);
      const forward = all.map((frame) => moenarchFrameState(first, frame, { reducedMotion }));
      const backward = [...all].reverse().map((frame) => moenarchFrameState(plan(), frame, { reducedMotion })).reverse();
      expect(backward).toEqual(forward);
      expect(JSON.parse(JSON.stringify(forward))).toEqual(forward);
    }
  });

  it('rejects frames outside the video', () => {
    const result = plan();
    expect(() => moenarchFrameState(result, -1, { reducedMotion: false })).toThrow();
    expect(() => moenarchFrameState(result, result.durationInFrames, { reducedMotion: false })).toThrow();
    expect(() => moenarchFrameState(result, 1.5, { reducedMotion: false })).toThrow();
  });

  it('reports the visible scenes, transition, intro, outro and subtitle per frame', () => {
    const result = plan();
    for (const frame of frames(result.durationInFrames)) {
      const state = moenarchFrameState(result, frame, { reducedMotion: false });
      const transition = result.transitions.find(
        (candidate) => frame >= candidate.from && frame < candidate.from + candidate.durationInFrames,
      );
      if (transition) {
        expect(state.transition?.name, `frame ${frame}`).toBe(transition.name);
        expect(state.transition?.progress).toBeCloseTo((frame - transition.from) / transition.durationInFrames, 6);
        expect(state.sceneIds).toEqual([transition.fromSceneId, transition.toSceneId]);
      } else {
        const scene = result.scenes.find((candidate) => frame >= candidate.from && frame < candidate.from + candidate.durationInFrames)!;
        expect(state.transition, `frame ${frame}`).toBeNull();
        expect(state.sceneIds).toEqual([scene.id]);
      }
      expect(state.intro).toBe(frame < result.intro.durationInFrames);
      expect(state.outro).toBe(frame >= result.outro.from);
    }
  });

  it('shows the narration cue of the current scene as the subtitle', () => {
    const result = plan();
    const fps = specimen.output.fps;
    for (const [index, scene] of specimen.scenes.entries()) {
      for (const cue of scene.narration?.cues ?? []) {
        const middleMs = (cue.startMs + cue.endMs) / 2;
        const frame = result.scenes[index].from + Math.round((middleMs * fps) / 1000);
        expect(moenarchFrameState(result, frame, { reducedMotion: false }).subtitle, cue.text).toBe(cue.text);
      }
    }
    // Between cues there is no subtitle.
    expect(moenarchFrameState(result, 0, { reducedMotion: false }).subtitle).toBeNull();
  });

  it('replaces moving transitions with the reduced-motion transition, keeping their windows', () => {
    const result = plan();
    const reduced = group('reducedMotion').transition as string;
    let replaced = 0;
    for (const transition of result.transitions) {
      if (transition.durationInFrames === 0) continue;
      const middle = transition.from + Math.floor(transition.durationInFrames / 2);
      const normal = moenarchFrameState(result, middle, { reducedMotion: false });
      const calm = moenarchFrameState(result, middle, { reducedMotion: true });
      const expected = vocabulary()[transition.name].motion ? reduced : transition.name;
      if (expected !== transition.name) replaced += 1;
      expect(calm.transition?.name, transition.name).toBe(expected);
      expect(calm.transition?.progress).toBe(normal.transition?.progress);
      expect(calm.sceneIds).toEqual(normal.sceneIds);
      expect(calm.subtitle).toBe(normal.subtitle);
    }
    // The specimen exercises the rule at least once.
    expect(replaced).toBeGreaterThan(0);
  });
});

describe('moenarch-short in the catalog', () => {
  it('opens the specimen by id with its portrait output profile from the spec', () => {
    expect(catalog.projects).toContainEqual({ id: SPECIMEN_ID, title: 'Moenarch short specimen' });
    const result = catalog.resolve(SPECIMEN_ID);
    if (!result.ok) throw new Error(result.message);
    const { component, renderInsight, ...metadata } = result.composition;
    expect(metadata).toEqual({
      id: SPECIMEN_ID,
      title: 'Moenarch short specimen',
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: resolveTimeline(specimen).durationInFrames,
    });
    expect(component).toBeTypeOf('function');
    expect(renderInsight).toBeUndefined();
  });

  it('reports specs the pack cannot draw as unrenderable, not as a fallback', () => {
    const withChart = clone(specimenFixture) as unknown as { scenes: unknown[]; assets: unknown[] };
    withChart.assets = clone(latencyFixture.assets);
    withChart.scenes.push(clone(latencyFixture.scenes[0]));
    const result = createCatalog([{ spec: withChart, format: moenarchShort() }], SPECIMEN_ID).resolve(SPECIMEN_ID);
    expect(result).toMatchObject({ ok: false, reason: 'unrenderable' });
  });

  it('treats another version of the format as a mismatch', () => {
    const spec = clone(specimenFixture);
    spec.format.version = 2;
    const result = createCatalog([{ spec, format: moenarchShort() }], SPECIMEN_ID).resolve(SPECIMEN_ID);
    expect(result).toMatchObject({ ok: false, reason: 'format-mismatch' });
  });
});
