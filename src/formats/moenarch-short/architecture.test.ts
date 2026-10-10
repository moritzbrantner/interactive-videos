// Architecture acceptance for issue #12 (moenarch-short-v1 format pack).
//
// - Motion comes from Remotion frame APIs only: no second animation framework anywhere in the app,
//   and no CSS/Web-Animations timing, clocks or randomness in the pack.
// - Format choices live in tokens.ts only: other pack files and the project registry do not
//   restate colours, font families or easing curves.
// - tokens.ts and plan.ts are plain TypeScript (no React/Remotion), so they can be read by tests,
//   tooling and later the headless renderer.
// Test files (*.test.ts[x]) are not scanned. Comments are scanned too: keep literals out of them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PACK_DIR = join(ROOT, 'src', 'formats', 'moenarch-short');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(ROOT, path);

const FORBIDDEN_PACKAGES = [
  'framer-motion',
  'motion',
  'gsap',
  'animejs',
  'popmotion',
  'react-spring',
  '@react-spring/web',
  'react-motion',
  'react-transition-group',
  'velocity-animate',
  'mo-js',
  '@mojs/core',
  'lottie-web',
  'lottie-react',
  '@lottiefiles/react-lottie-player',
  'tweenjs',
  '@tweenjs/tween.js',
  'animate.css',
];

/** Rules for non-token pack files; each names what it catches. */
const PACK_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'CSS keyframes', pattern: /@keyframes/ },
  // A CSS transition: a timing property, or a transition value with a duration. A `transition:`
  // key naming a vocabulary entry (e.g. the reduced-motion token) is not CSS timing.
  { name: 'CSS transition timing', pattern: /\btransition(?:Property|Duration|TimingFunction|Delay)\s*:|\btransition\s*:\s*['"`][^'"`]*\d(?:ms|s)\b/ },
  { name: 'CSS transition shorthand', pattern: /\btransition\s*:\s*[\w-]+\s+[\d.]+m?s\b/ },
  { name: 'CSS animation', pattern: /\banimation(?:Name|Duration|TimingFunction|Delay|IterationCount)\s*:|\banimation\s*:\s*['"`]?[\w-]+\s+[\d.]+m?s\b/ },
  { name: 'Web Animations API', pattern: /\.animate\s*\(/ },
  { name: 'wall-clock timers', pattern: /\b(?:requestAnimationFrame|setTimeout|setInterval)\s*\(/ },
  { name: 'randomness', pattern: /\bMath\.random\b/ },
  { name: 'clock reads', pattern: /\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/ },
];

/** Literals that restate format choices; allowed in tokens.ts only. */
const STYLE_LITERAL_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: 'functional colour', pattern: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]/ },
  { name: 'font family literal', pattern: /\bfontFamily\s*:\s*['"`]|font-family\s*:/ },
  { name: 'CSS easing literal', pattern: /\bcubic-bezier\(|\b(?:ease-in-out|ease-in|ease-out)\b/ },
  // Easing.bezier(...tokens...) is how token curves become Remotion easing; any other Easing use
  // (presets, numeric control points) is a restated choice.
  { name: 'Remotion easing literal', pattern: /\bEasing\.(?!bezier\(\s*(?:\.\.\.)?\(?\s*[A-Za-z_$])/ },
];

function violations(text: string, rules: { name: string; pattern: RegExp }[]) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);
}

describe('moenarch-short architecture', () => {
  it('has the token, plan and pack modules', () => {
    const names = sourceFiles(PACK_DIR).map(rel);
    expect(names).toContain('src/formats/moenarch-short/tokens.ts');
    expect(names).toContain('src/formats/moenarch-short/plan.ts');
    expect(names.some((name) => /^src\/formats\/moenarch-short\/index\.tsx?$/.test(name))).toBe(true);
  });

  it('adds no second animation framework over Remotion', () => {
    const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as Record<string, Record<string, string> | undefined>;
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
    expect(declared.filter((name) => FORBIDDEN_PACKAGES.includes(name))).toEqual([]);
    const importsForbidden = (text: string) =>
      FORBIDDEN_PACKAGES.filter((name) => new RegExp(`(?:from|import\\(?)\\s*['"]${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?:/[^'"]*)?['"]`).test(text));
    const offenders = sourceFiles(join(ROOT, 'src')).flatMap((path) =>
      importsForbidden(read(path)).map((name) => `${rel(path)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('animates with Remotion frame APIs, not CSS timing, clocks or randomness', () => {
    const files = sourceFiles(PACK_DIR);
    const offenders = files.flatMap((path) => violations(read(path), PACK_RULES).map((name) => `${rel(path)}: ${name}`));
    expect(offenders).toEqual([]);
    // The pack does draw with Remotion: some file reads the current frame.
    expect(files.some((path) => /from ['"]remotion['"]/.test(read(path)) && /\buseCurrentFrame\s*\(/.test(read(path)))).toBe(true);
  });

  it('keeps tokens and the timing plan free of React and Remotion', () => {
    for (const name of ['tokens.ts', 'plan.ts']) {
      const text = read(join(PACK_DIR, name));
      expect(text, name).not.toMatch(/from ['"](?:react|react-dom|remotion|@remotion\/[^'"]+)['"]/);
    }
  });

  it('states colours, fonts and easing only in the token module', () => {
    const scanned = [...sourceFiles(PACK_DIR).filter((path) => rel(path) !== 'src/formats/moenarch-short/tokens.ts'), join(ROOT, 'src', 'projects.ts')];
    const offenders = scanned.flatMap((path) =>
      violations(read(path), STYLE_LITERAL_RULES).map((name) => `${rel(path)}: ${name}`),
    );
    expect(offenders).toEqual([]);
    // The token module is where those choices are made.
    expect(read(join(PACK_DIR, 'tokens.ts'))).toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('rules catch the violations they name and allow token-driven code', () => {
    const bad: [string, string][] = [
      ['@keyframes rise { from { opacity: 0 } }', 'CSS keyframes'],
      ["style={{ transition: 'opacity 200ms' }}", 'CSS transition timing'],
      ["style={{ transitionDuration: duration }}", 'CSS transition timing'],
      ['const css = `transition: transform 0.3s linear`;', 'CSS transition shorthand'],
      ["{ animation: 'fade 1s' }", 'CSS animation'],
      ['node.animate([{ opacity: 0 }], 300)', 'Web Animations API'],
      ['requestAnimationFrame(tick)', 'wall-clock timers'],
      ['const jitter = Math.random();', 'randomness'],
      ['const t = Date.now();', 'clock reads'],
    ];
    for (const [sample, rule] of bad) expect(violations(sample, PACK_RULES), sample).toContain(rule);
    const badStyle: [string, string][] = [
      ["background: '#0b0d12'", 'hex colour'],
      ['color: rgba(0, 0, 0, 0.5)', 'functional colour'],
      ["fontFamily: 'Inter, sans-serif'", 'font family literal'],
      ["easing: 'cubic-bezier(0.2, 0, 0, 1)'", 'CSS easing literal'],
      ['easing: Easing.bezier(0.2, 0, 0, 1)', 'Remotion easing literal'],
      ['easing: Easing.inOut(Easing.ease)', 'Remotion easing literal'],
    ];
    for (const [sample, rule] of badStyle) expect(violations(sample, STYLE_LITERAL_RULES), sample).toContain(rule);
    const good = [
      'const frame = useCurrentFrame();',
      'const state = { transition: null, sceneIds };',
      'transition: { name, progress },',
      'easing: Easing.bezier(...tokens.easing[transition.easing])',
      'Easing.bezier(...(curve as [number, number, number, number]))',
      "reducedMotion: { transition: 'fade' },",
      'style={{ opacity: progress, transform: `translateY(${offset}px)` }}',
      'style={{ color: tokens.palette.text, fontFamily: tokens.typography.fontFamily }}',
    ];
    for (const sample of good) {
      expect(violations(sample, PACK_RULES), sample).toEqual([]);
      expect(violations(sample, STYLE_LITERAL_RULES), sample).toEqual([]);
    }
  });
});
