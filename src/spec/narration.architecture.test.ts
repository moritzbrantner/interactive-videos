// Architecture acceptance for issue #14 (narration, cue and subtitle timing), written before the
// implementation.
//
// - Audio timing needs no LLM, no speech synthesis and no network at render time: compositions
//   consume resolved audio assets and declared timing metadata. No app source (src/, tests
//   excluded) calls the network (fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon) or
//   speech synthesis, and no LLM/TTS SDK is a dependency or imported.
// - The schedule is plain TypeScript: `src/spec/narration-schedule.ts` imports nothing from React
//   or Remotion and reads no clock or randomness.
// - moenarch-short renders subtitles through the installed remotion-primitives `Subtitles`
//   (`@/components/remotion/subtitles`) and plays narration with Remotion's `Audio`.
// Test files are not scanned. Comments are scanned too: keep the forbidden names out of them.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'src');
const SCHEDULE = join(SRC, 'spec', 'narration-schedule.ts');
const PACK_DIR = join(SRC, 'formats', 'moenarch-short');

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(ROOT, path);

/** LLM, speech-synthesis and AI-provider SDKs; none belongs in the render path. */
const FORBIDDEN_PACKAGES = [
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  '@google/genai',
  '@google-cloud/text-to-speech',
  '@google-cloud/vertexai',
  'elevenlabs',
  '@elevenlabs/elevenlabs-js',
  'microsoft-cognitiveservices-speech-sdk',
  '@aws-sdk/client-polly',
  '@aws-sdk/client-bedrock-runtime',
  'say',
  'gtts',
  'node-gtts',
  'google-tts-api',
  'ai',
  'langchain',
  'replicate',
  'cohere-ai',
  'ollama',
  'groq-sdk',
  '@mistralai/mistralai',
  '@huggingface/inference',
];
const FORBIDDEN_SCOPES = ['@ai-sdk/', '@langchain/', '@elevenlabs/', '@openai/'];

const isForbiddenPackage = (name: string) =>
  FORBIDDEN_PACKAGES.includes(name) || FORBIDDEN_SCOPES.some((scope) => name.startsWith(scope));

/** Bare package names a source file imports (static, dynamic or require). */
function importedPackages(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"./][^'"]*)['"]/g)) {
    const spec = match[1];
    const parts = spec.split('/');
    names.push(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
  }
  return names;
}

const NETWORK_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'fetch', pattern: /(?<![\w$.])fetch\s*\(|\b(?:window|globalThis|self)\.fetch\b/ },
  { name: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', pattern: /\bWebSocket\b/ },
  { name: 'EventSource', pattern: /\bEventSource\b/ },
  { name: 'sendBeacon', pattern: /\bsendBeacon\b/ },
  { name: 'speech synthesis', pattern: /\bspeechSynthesis\b|\bSpeechSynthesisUtterance\b/ },
];

const CLOCK_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'clock reads', pattern: /\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/ },
  { name: 'randomness', pattern: /\bMath\.random\b|\bcrypto\.getRandomValues\b/ },
  { name: 'wall-clock timers', pattern: /\b(?:requestAnimationFrame|setTimeout|setInterval)\s*\(/ },
];

const violations = (text: string, rules: { name: string; pattern: RegExp }[]) =>
  rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);

describe('narration timing architecture', () => {
  it('has the schedule module', () => {
    expect(existsSync(SCHEDULE)).toBe(true);
  });

  it('declares and imports no LLM or speech-synthesis SDK', () => {
    const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as Record<string, Record<string, string> | undefined>;
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies });
    expect(declared.filter(isForbiddenPackage)).toEqual([]);
    const offenders = sourceFiles(SRC).flatMap((path) =>
      importedPackages(read(path))
        .filter(isForbiddenPackage)
        .map((name) => `${rel(path)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it('makes no network or speech-synthesis calls anywhere in the app source', () => {
    const offenders = sourceFiles(SRC).flatMap((path) => violations(read(path), NETWORK_RULES).map((name) => `${rel(path)}: ${name}`));
    expect(offenders).toEqual([]);
  });

  it('keeps the schedule pure: no React, Remotion, clock or randomness', () => {
    const text = read(SCHEDULE);
    expect(text).not.toMatch(/from ['"](?:react|react-dom|remotion|@remotion\/[^'"]+)['"]/);
    expect(violations(text, CLOCK_RULES)).toEqual([]);
    expect(violations(text, NETWORK_RULES)).toEqual([]);
    // It is built on the VideoSpec module and nothing outside src/spec.
    const local = [...text.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1]);
    expect(local.every((path) => path.startsWith('./') || path.startsWith('@/spec/'))).toBe(true);
  });

  it('renders moenarch subtitles through the installed Subtitles primitive and plays audio with Remotion', () => {
    const files = sourceFiles(PACK_DIR).map(read);
    expect(files.some((text) => /import\s*\{[^}]*\bSubtitles\b[^}]*\}\s*from\s*['"]@\/components\/remotion\/subtitles['"]/.test(text))).toBe(true);
    expect(files.some((text) => /import\s*\{[^}]*\b(?:Audio|Html5Audio)\b[^}]*\}\s*from\s*['"]remotion['"]/.test(text))).toBe(true);
  });

  it('rules catch the violations they name', () => {
    const network: [string, string][] = [
      ["const res = await fetch('https://api.example.com');", 'fetch'],
      ['window.fetch(url)', 'fetch'],
      ['new XMLHttpRequest()', 'XMLHttpRequest'],
      ["new WebSocket('wss://x')", 'WebSocket'],
      ["new EventSource('/stream')", 'EventSource'],
      ['navigator.sendBeacon(url, body)', 'sendBeacon'],
      ['speechSynthesis.speak(new SpeechSynthesisUtterance(text))', 'speech synthesis'],
    ];
    for (const [sample, rule] of network) expect(violations(sample, NETWORK_RULES), sample).toContain(rule);
    for (const sample of ['const prefetched = plan.cues;', 'refetchCount += 1;', 'const audio = schedule.audio;']) {
      expect(violations(sample, NETWORK_RULES), sample).toEqual([]);
    }
    expect(importedPackages("import OpenAI from 'openai';").filter(isForbiddenPackage)).toEqual(['openai']);
    expect(importedPackages("const { generateText } = await import('ai');").filter(isForbiddenPackage)).toEqual(['ai']);
    expect(importedPackages("import { openai } from '@ai-sdk/openai';").filter(isForbiddenPackage)).toEqual(['@ai-sdk/openai']);
    expect(importedPackages("import { Audio } from 'remotion';").filter(isForbiddenPackage)).toEqual([]);
    expect(importedPackages("import { x } from './ai';").filter(isForbiddenPackage)).toEqual([]);
    expect(violations('const t = Date.now();', CLOCK_RULES)).toContain('clock reads');
    expect(violations('Math.random()', CLOCK_RULES)).toContain('randomness');
  });
});
