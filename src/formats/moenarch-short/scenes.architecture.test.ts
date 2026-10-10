// Architecture acceptance for issue #13 (editorial scene archetypes), written before the
// implementation.
//
// - Scene renderers live in `src/formats/moenarch-short/scenes/`, one module per archetype:
//   title, statement, media-reveal, comparison, quote, data-point, list, conclusion (.tsx).
// - Scenes read no wall clock and no ambient randomness, and use no CSS/Web-Animations timing.
//   The pure modules (layout.ts, plan.ts, tokens.ts) are held to the same rule.
// - Scenes do not do their own motion math: they import no frame or interpolation API from
//   Remotion (useCurrentFrame, interpolate, spring, Easing, ...). Generic motion comes from the
//   installed remotion-primitives in `@/components/remotion/*` (at least one scene uses one), or
//   from the pack's token-driven transition code; nothing in the pack re-implements a primitive
//   (Fade, Slide, Scale, Blur, Stagger, ...).
// - Layout is computed once by the plan: `layout.ts` is plain TypeScript, and neither the scenes
//   nor the composition (video.tsx) import a runtime value from it (`import type` is fine).
// Test files are not scanned. Comments are scanned too: keep the forbidden names out of them.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PACK_DIR = join(ROOT, 'src', 'formats', 'moenarch-short');
const SCENES_DIR = join(PACK_DIR, 'scenes');

const SCENE_MODULES = ['title', 'statement', 'media-reveal', 'comparison', 'quote', 'data-point', 'list', 'conclusion'];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(ROOT, path);

type Rule = { name: string; test: (text: string) => boolean };
const pattern = (name: string, regex: RegExp): Rule => ({ name, test: (text) => regex.test(text) });

/** No wall clock, randomness or CSS/WAAPI timing. */
const DETERMINISM_RULES: Rule[] = [
  pattern('randomness', /\bMath\.random\b|\bcrypto\.(?:getRandomValues|randomUUID)\b/),
  pattern('clock reads', /\bDate\.now\b|\bnew Date\b|\bDate\(\s*\)|\bperformance\.now\b|\bperformance\.timeOrigin\b/),
  pattern('wall-clock timers', /\b(?:requestAnimationFrame|requestIdleCallback|setTimeout|setInterval)\s*\(/),
  pattern('document timeline', /\bdocument\.timeline\b|\.currentTime\b/),
  pattern('CSS keyframes', /@keyframes/),
  pattern('CSS transition timing', /\btransition(?:Property|Duration|TimingFunction|Delay)\s*:|\btransition\s*:\s*['"`][^'"`]*\d(?:ms|s)\b/),
  pattern('CSS animation', /\banimation(?:Name|Duration|TimingFunction|Delay|IterationCount)\s*:|\banimation\s*:\s*['"`]?[\w-]+\s+[\d.]+m?s\b/),
  pattern('Web Animations API', /\.animate\s*\(/),
];

/** Remotion APIs that read the frame or compute motion; scenes get motion from primitives. */
const MOTION_MATH = ['useCurrentFrame', 'interpolate', 'interpolateColors', 'spring', 'measureSpring', 'Easing'];

function remotionImports(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+['"]remotion['"]/g)) {
    if (match[1]) continue;
    const clause = match[2];
    if (/\*\s+as\s+\w+/.test(clause)) names.push('* (namespace import)');
    const braces = clause.match(/\{([^}]*)\}/);
    for (const part of braces ? braces[1].split(',') : []) {
      const spec = part.trim();
      if (!spec || spec.startsWith('type ')) continue;
      names.push(spec.split(/\s+as\s+/)[0].trim());
    }
  }
  // Dynamic imports and requires are not ways around the rule either.
  if (/import\(\s*['"]remotion['"]\s*\)|require\(\s*['"]remotion['"]\s*\)/.test(text)) names.push('* (dynamic import)');
  return names;
}

const motionMathViolations = (text: string) =>
  remotionImports(text).filter((name) => name.startsWith('*') || MOTION_MATH.includes(name));

/** A component or function named like a remotion-primitives motion helper. */
const PRIMITIVE_REIMPLEMENTATION =
  /\b(?:function|const|let|class)\s+(?:Fade|Slide|Scale|Blur|BlurReveal|Stagger|EnterExit|Typewriter|AnimatedNumber|Zoom|Wipe)(?:In|Out|Up|Down|Left|Right)?\b/;

const usesPrimitive = (text: string) => /from\s+['"]@\/components\/remotion\/[\w-]+['"]/.test(text);

/** A runtime (non-type-only) import of the layout module. */
const VALUE_LAYOUT_IMPORT =
  /import\s+(?!type\b)[^;]*?from\s+['"](?:\.{1,2}\/)+layout['"]|import\s+(?!type\b)[^;]*?from\s+['"]@\/formats\/moenarch-short\/layout['"]|import\(\s*['"][^'"]*\/layout['"]\s*\)/;

describe('moenarch-short scene architecture', () => {
  it('has one scene module per archetype in scenes/', () => {
    const names = sourceFiles(SCENES_DIR).map(rel);
    for (const name of SCENE_MODULES) {
      expect(names, name).toContain(`src/formats/moenarch-short/scenes/${name}.tsx`);
    }
  });

  it('keeps scenes and the pure modules free of clocks, randomness and CSS timing', () => {
    const scanned = [...sourceFiles(SCENES_DIR), ...['layout.ts', 'plan.ts', 'tokens.ts'].map((name) => join(PACK_DIR, name))];
    expect(sourceFiles(SCENES_DIR).length).toBeGreaterThanOrEqual(SCENE_MODULES.length);
    const offenders = scanned.flatMap((path) =>
      existsSync(path)
        ? DETERMINISM_RULES.filter((rule) => rule.test(read(path))).map((rule) => `${rel(path)}: ${rule.name}`)
        : [`${rel(path)}: missing`],
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the layout module plain TypeScript', () => {
    const path = join(PACK_DIR, 'layout.ts');
    expect(existsSync(path), 'src/formats/moenarch-short/layout.ts').toBe(true);
    expect(read(path)).not.toMatch(/from ['"](?:react|react-dom|remotion|@remotion\/[^'"]+|@\/components\/[^'"]+)['"]/);
  });

  it('gets scene motion from remotion-primitives instead of frame math', () => {
    const scenes = sourceFiles(SCENES_DIR);
    expect(scenes.length).toBeGreaterThan(0);
    const offenders = scenes.flatMap((path) => motionMathViolations(read(path)).map((name) => `${rel(path)}: ${name}`));
    expect(offenders).toEqual([]);
    // Reuse is real: scenes animate through the installed primitives.
    expect(scenes.filter((path) => usesPrimitive(read(path))).map(rel)).not.toEqual([]);
  });

  it('re-implements no remotion-primitives motion helper anywhere in the pack', () => {
    const offenders = sourceFiles(PACK_DIR)
      .filter((path) => PRIMITIVE_REIMPLEMENTATION.test(read(path)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('lays scenes out in the plan, not in per-frame code', () => {
    const drawing = [...sourceFiles(SCENES_DIR), join(PACK_DIR, 'video.tsx')].filter(existsSync);
    const offenders = drawing.filter((path) => VALUE_LAYOUT_IMPORT.test(read(path))).map(rel);
    expect(offenders).toEqual([]);
    // The plan is what calls the layout.
    expect(read(join(PACK_DIR, 'plan.ts'))).toMatch(/from\s+['"]\.\/layout['"]/);
  });

  it('rules catch the violations they name and allow primitive-driven code', () => {
    const bad: [string, string][] = [
      ['const jitter = Math.random();', 'randomness'],
      ['const id = crypto.randomUUID();', 'randomness'],
      ['const t = Date.now();', 'clock reads'],
      ['const today = new Date();', 'clock reads'],
      ['const t0 = performance.now();', 'clock reads'],
      ['setTimeout(() => setShown(true), 300);', 'wall-clock timers'],
      ['requestAnimationFrame(tick)', 'wall-clock timers'],
      ['const t = document.timeline.currentTime;', 'document timeline'],
      ["style={{ transition: 'opacity 200ms' }}", 'CSS transition timing'],
      ["{ animation: 'fade 1s' }", 'CSS animation'],
      ['node.animate([{ opacity: 0 }], 300)', 'Web Animations API'],
    ];
    for (const [sample, rule] of bad) {
      expect(DETERMINISM_RULES.filter((candidate) => candidate.test(sample)).map((candidate) => candidate.name), sample).toContain(rule);
    }
    expect(motionMathViolations("import { AbsoluteFill, interpolate } from 'remotion';")).toEqual(['interpolate']);
    expect(motionMathViolations("import { useCurrentFrame as useFrame } from 'remotion';")).toEqual(['useCurrentFrame']);
    expect(motionMathViolations("import * as R from 'remotion';")).toEqual(['* (namespace import)']);
    expect(motionMathViolations("import { Easing, spring } from 'remotion';")).toEqual(['Easing', 'spring']);
    expect(motionMathViolations("import { AbsoluteFill, Img, Sequence, staticFile } from 'remotion';")).toEqual([]);
    expect(motionMathViolations("import type { CalculateMetadataFunction } from 'remotion';")).toEqual([]);
    expect(PRIMITIVE_REIMPLEMENTATION.test('function FadeIn({ children }: Props) {')).toBe(true);
    expect(PRIMITIVE_REIMPLEMENTATION.test('const Slide = ({ children }: Props) =>')).toBe(true);
    expect(PRIMITIVE_REIMPLEMENTATION.test("import { Fade } from '@/components/remotion/fade';")).toBe(false);
    expect(PRIMITIVE_REIMPLEMENTATION.test('function MediaRevealScene() {')).toBe(false);
    expect(usesPrimitive("import { Slide } from '@/components/remotion/slide';")).toBe(true);
    expect(VALUE_LAYOUT_IMPORT.test("import { layoutMoenarchScene } from '../layout';")).toBe(true);
    expect(VALUE_LAYOUT_IMPORT.test("import { layoutMoenarchScene } from '@/formats/moenarch-short/layout';")).toBe(true);
    expect(VALUE_LAYOUT_IMPORT.test("import type { MoenarchSceneLayout } from '../layout';")).toBe(false);
    expect(VALUE_LAYOUT_IMPORT.test("import type { MoenarchTextBlock } from './layout';")).toBe(false);
  });
});
