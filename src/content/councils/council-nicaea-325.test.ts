// Acceptance contract for issue #82 (Nicaea I pilot, slice 1: narrated English watch-through on
// Pages), written by an independent acceptance context before any implementation, against baseline
// 3c8ad7b. Intent: Decision Atlas 1.1, 3.1, 3.2, 3.6, 3.10 (English part), 3.16, 3.22, 3.24; owner
// decision on #82 (2026-10-16): the generated narration WAV is committed through Git LFS together
// with its request and provenance; CI and Pages verify the bytes against the VideoSpec lock and
// never run the model. Upstream: asset-tooling 502e955 (`audio.model.generate@2`, Kokoro adapter,
// docs/kokoro.md). Companion tests: src/assets/materialize-committed.test.ts (materialization in
// CI), e2e/council-nicaea-325.spec.ts (Pages journey), src/render/council-nicaea-325.smoke.test.ts.
//
// Seams (all new; names chosen to match the existing repository layout):
//
// 1. Project id `council-nicaea-325`, stable URL `?project=council-nicaea-325`, registered in
//    src/projects.ts. Its VideoSpec v2 and its sidecar request manifest stay where #16/#17 keep
//    every catalog spec, so the existing loaders apply unchanged:
//      src/spec/fixtures/council-nicaea-325.videospec.json
//      src/spec/fixtures/council-nicaea-325.asset-requests.json
//    Subtitle cues are the spec's existing narration cues (`scenes[].narration.cues`, audio clock,
//    rendered through the installed `Subtitles` primitive / @remotion/captions); no second cue file.
//
// 2. Reviewable episode content, data only (no JSX), in src/content/councils/nicaea-325/:
//      script.json   { schema: "interactive-videos/council-script", schemaVersion: 1,
//                      project: "council-nicaea-325", language: "en",
//                      perspective: { statement: string, scene: <scene id> },   // shown on screen in that scene
//                      disclosure: { syntheticNarration: string },              // visible in the episode
//                      sections: [{ id, text, sources: [<source id>, …] }, …] } // narration in spoken order
//      sources.json  { schema: "interactive-videos/council-sources", schemaVersion: 1,
//                      project: "council-nicaea-325",
//                      sources: [{ id, kind: "primary" | "secondary" | "magisterial" | "reference",
//                                  title, author?, url? (https), reference? }, …] }   // url or reference
//      narration/*.wav  the generated narration, one file per narration audio slot, tracked by Git LFS
//    The concatenated section texts are the narration script. The spoken text of each narration
//    slot (its request `prompt`) and the subtitle cues are that script.
//
// 3. Committed narration request. A sidecar slot may be declared as
//      { "committed": "<repository-relative file>",
//        "operation": { "id": "audio.model.generate", "version": "2" },
//        "adapter": { "id": "kokoro", "version": "1" },
//        "parameters": { modelId: "hexgrad/Kokoro-82M", modelRevision: "f3ff…4987", prompt, seed,
//                        sampleRate: 24000, channels: 1,
//                        adapterParameters: { voice, lexicon: { version, entries }, speed? } },
//        "inputs": { "model": { kind: "model", mediaType: "application/zip", sha256, byteLength, … } },
//        "evidence": { license: "Apache-2.0", trainingDataCaveat: string } }
//    It records how the bytes were generated (locally, an explicit regeneration step) without CI
//    executing it: materialization verifies the committed file against the slot lock and reports
//    `{ status: "committed", operation: { id: "audio.model.generate", version: "2" }, cacheKey: null }`.
//    The slot lock is the full asset-tooling AssetRef the operation produced (canonical audio
//    metadata plus provenance naming the model input), so the lock itself is evidence of origin.
//
// 4. English subtitles in the Player: see e2e/council-nicaea-325.spec.ts (selectable track, DOM).
//
// Non-automated acceptance (stays on the PR / issue): the independent historical/theological review
// of the script against the cited sources, and the owner's post-deployment listening check.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { catalog } from '@/projects';
import { narrationSchedule } from '@/spec/narration-schedule';
import { resolveTimeline, type Scene, type VideoSpec } from '@/spec/video-spec';

type Json = Record<string, any>;

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PROJECT = 'council-nicaea-325';
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.videospec.json`);
const REQUESTS_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.asset-requests.json`);
const CONTENT = join(ROOT, 'src', 'content', 'councils', 'nicaea-325');
const SCRIPT_PATH = join(CONTENT, 'script.json');
const SOURCES_PATH = join(CONTENT, 'sources.json');

/** The catalog projects on baseline 3c8ad7b; every one must keep loading. */
const EXISTING_PROJECTS = [
  'latency-explainer',
  'catalog-title-card',
  'moenarch-specimen',
  'moenarch-scene-gallery',
  'moenarch-narration',
  'moenarch-typography',
  'interactive-showcase',
  'moenarch-materialized-audio',
];

// asset-tooling 502e955, docs/kokoro.md and src/model-backends.ts.
const KOKORO = {
  modelId: 'hexgrad/Kokoro-82M',
  modelRevision: 'f3ff3571791e39611d31c381e3a41a3af07b4987',
  /** The acquired model.zip, the operation's `model` input. */
  bundle: { sha256: '115b504bedbf242d7794bab72deff3abb1ab069ebf7c5c985f19dcc65f47211d', byteLength: 363_333_339 },
  sampleRate: 24_000,
  voices: [
    'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova',
    'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam',
    'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
    'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
  ],
  usPhonemes: new Set([...'AIOWYbdfhijklmnpstuvwzæðŋɑɔəɛɜɡɪɹɾʃʊʌʒʔʤʧˈˌθᵊᵻ']),
  gbPhonemes: new Set([...'AIQWYabdfhijklmnpstuvwzðŋɑɒɔəɛɜɡɪɹʃʊʌʒʤʧˈˌːθᵊ']),
  /** docs/kokoro.md: misaki's dictionaries do not cover these words; they need lexicon entries. */
  notInMisaki: ['Arius', 'homoousios', 'homoiousios', 'Athanasius', 'Hosius', 'Nicomedia', 'Bithynia', 'Sylvester', 'Nicaea'],
} as const;

/** Terms the issue requires the episode lexicon to cover explicitly (docs/kokoro.md: not in misaki). */
const REQUIRED_LEXICON = ['Arius', 'Athanasius', 'homoousios', 'Nicaea'];

const readJson = (path: string): Json => {
  expect(existsSync(path), `${path.slice(ROOT.length + 1)} exists`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8'));
};

function spec(): VideoSpec {
  const registered = catalog.spec(PROJECT);
  expect(registered, `${PROJECT} is registered in the catalog (src/projects.ts)`).toBeDefined();
  return registered!;
}
const requests = () => readJson(REQUESTS_PATH);
const script = () => readJson(SCRIPT_PATH);
const sources = () => readJson(SOURCES_PATH);

/** Lowercase words only: punctuation, quotes and whitespace differences are ignored. */
const normalizeText = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const words = (text: string) => text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

const narratedScenes = () => spec().scenes.filter((scene) => scene.narration?.audio);
const narrationSlotIds = () => [...new Set(narratedScenes().map((scene) => scene.narration!.audio!.asset))];
const slotOf = (id: string) => (spec().assets as unknown as Json[]).find((slot) => slot.id === id)!;
const sceneText = (scene: Scene) => scene.narration!.cues.map((cue) => cue.text).join(' ');

/** A canonical PCM16 WAV: format, frame count and samples. */
function parseWav(bytes: Buffer, label: string) {
  expect(bytes.subarray(0, 4).toString('latin1'), `${label} is a RIFF/WAVE file (an LFS pointer means: run git lfs pull)`).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString('latin1'), label).toBe('WAVE');
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined;
  let data: Buffer | undefined;
  while (offset + 8 <= bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString('latin1');
    const size = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + size);
    if (id === 'fmt ') {
      format = { audioFormat: body.readUInt16LE(0), channels: body.readUInt16LE(2), sampleRate: body.readUInt32LE(4), bitsPerSample: body.readUInt16LE(14) };
    } else if (id === 'data') {
      data = body;
    }
    offset += 8 + size + (size % 2);
  }
  expect(format, `${label} has a fmt chunk`).toBeDefined();
  expect(data, `${label} has a data chunk`).toBeDefined();
  expect(format, label).toEqual({ audioFormat: 1, channels: 1, sampleRate: KOKORO.sampleRate, bitsPerSample: 16 });
  const frameCount = data!.length / 2;
  const samples = new Int16Array(data!.buffer.slice(data!.byteOffset, data!.byteOffset + data!.length));
  return { ...format!, frameCount, samples, durationMs: (frameCount / format!.sampleRate) * 1000 };
}

/** The committed narration file of a slot, read from the working tree. */
function committedWav(slotId: string) {
  const request = requests().slots?.[slotId] as Json | undefined;
  expect(request, `the sidecar has a request for ${slotId}`).toBeDefined();
  expect(typeof request!.committed, `${slotId} is a committed request`).toBe('string');
  const path = join(ROOT, request!.committed);
  expect(existsSync(path), `${request!.committed} exists`).toBe(true);
  const bytes = readFileSync(path);
  return { path: request!.committed as string, bytes, wav: parseWav(bytes, request!.committed) };
}

const git = (...args: string[]) => {
  const run = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  expect(run.status, `git ${args.join(' ')}\n${run.stderr}`).toBe(0);
  return run.stdout;
};

describe('#82 catalog', () => {
  it('registers council-nicaea-325 under its stable id and resolves it', () => {
    const summary = catalog.projects.find((project) => project.id === PROJECT);
    expect(summary, `${PROJECT} is listed`).toBeDefined();
    expect(summary!.title).toMatch(/Nicaea/);
    const resolved = catalog.resolve(PROJECT);
    expect(resolved.ok, resolved.ok ? '' : resolved.message).toBe(true);
    // The spec lives where every other catalog spec and sidecar live (#16, #17).
    expect(existsSync(SPEC_PATH), 'src/spec/fixtures/council-nicaea-325.videospec.json').toBe(true);
    expect(JSON.parse(readFileSync(SPEC_PATH, 'utf8')).project.id).toBe(PROJECT);
  });

  it('keeps every existing project in the catalog, resolvable', () => {
    const ids = catalog.projects.map((project) => project.id);
    for (const id of EXISTING_PROJECTS) {
      expect(ids, id).toContain(id);
      const resolved = catalog.resolve(id);
      expect(resolved.ok, `${id}: ${resolved.ok ? '' : resolved.message}`).toBe(true);
    }
    expect(catalog.defaultId).toBe('latency-explainer');
  });
});

describe('#82 duration and narration audio', () => {
  it('lasts between 120 and 180 seconds (Atlas 3.1)', () => {
    const { durationInFrames } = resolveTimeline(spec());
    const seconds = durationInFrames / spec().output.fps;
    expect(seconds).toBeGreaterThanOrEqual(120);
    expect(seconds).toBeLessThanOrEqual(180);
  });

  it('is narrated: every scene with narration has audio, and narration audio fills most of the episode', () => {
    const all = spec().scenes;
    for (const scene of all) {
      if (scene.narration) expect(scene.narration.audio, `scene ${scene.id} has narration cues and audio`).toBeDefined();
    }
    expect(narratedScenes().length).toBeGreaterThan(0);
    const audioMs = narratedScenes().reduce((sum, scene) => sum + scene.narration!.audio!.durationMs, 0);
    const episodeMs = (resolveTimeline(spec()).durationInFrames / spec().output.fps) * 1000;
    expect(audioMs / episodeMs, 'share of the episode with spoken narration').toBeGreaterThanOrEqual(0.75);
  });

  it('declares each narration audio length as the committed WAV length (within 20 ms)', () => {
    for (const scene of narratedScenes()) {
      const { wav, path } = committedWav(scene.narration!.audio!.asset);
      expect(Math.abs(wav.durationMs - scene.narration!.audio!.durationMs), `${scene.id}: ${path}`).toBeLessThanOrEqual(20);
    }
  });

  it('locks each narration slot to the AssetRef audio.model.generate@2 produced from the Kokoro bundle', () => {
    for (const slotId of narrationSlotIds()) {
      const slot = slotOf(slotId);
      const { bytes, wav } = committedWav(slotId);
      expect(slot.kind).toBe('audio');
      expect({
        schemaVersion: slot.asset.schemaVersion,
        kind: slot.asset.kind,
        mediaType: slot.asset.mediaType,
        sha256: slot.asset.sha256,
        byteLength: slot.asset.byteLength,
      }, slotId).toEqual({
        schemaVersion: 1,
        kind: 'audio',
        mediaType: 'audio/wav',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteLength: bytes.length,
      });
      // asset-tooling's canonical audio metadata (createCanonicalAudioMetadata) of a model output.
      expect(slot.asset.metadata, slotId).toEqual({
        audio: {
          channelLayout: 'mono',
          channels: 1,
          codec: 'pcm-s16le',
          duration: { denominator: KOKORO.sampleRate, numerator: wav.frameCount },
          frameCount: wav.frameCount,
          sampleRate: KOKORO.sampleRate,
          schemaVersion: 1,
        },
        provenance: {
          inputs: [{ port: 'model', sha256: KOKORO.bundle.sha256 }],
          operation: { id: 'audio.model.generate', version: '2' },
        },
      });
    }
  });

  it('tracks every committed narration file with Git LFS: attribute, LFS file list and a pointer blob equal to the lock', () => {
    expect(existsSync(join(ROOT, '.gitattributes')), '.gitattributes exists').toBe(true);
    const attributes = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
    expect(attributes).toMatch(/filter=lfs/);
    const lfsFiles = git('lfs', 'ls-files', '--name-only').split('\n').map((line) => line.trim());
    for (const slotId of narrationSlotIds()) {
      const { path } = committedWav(slotId);
      const lock = slotOf(slotId).asset;
      expect(git('check-attr', 'filter', 'diff', 'merge', '--', path), path).toMatch(/filter: lfs[\s\S]*diff: lfs[\s\S]*merge: lfs/);
      expect(lfsFiles, `git lfs ls-files lists ${path}`).toContain(path);
      // The committed blob is an LFS pointer (not the WAV itself) whose oid and size are the lock.
      const blob = git('ls-files', '-s', '--', path).trim().split(/\s+/)[1];
      expect(blob, `${path} is in the index`).toMatch(/^[0-9a-f]{40,64}$/);
      const pointer = git('cat-file', '-p', blob);
      expect(pointer, `${path} is stored as an LFS pointer`).toMatch(/^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/);
      expect(pointer).toContain(`oid sha256:${lock.sha256}\n`);
      expect(pointer).toContain(`size ${lock.byteLength}\n`);
    }
  });

  it('checks out LFS objects in CI and Pages, and neither workflow installs or runs a speech model', () => {
    for (const name of ['ci.yml', 'pages.yml']) {
      const workflow = readFileSync(join(ROOT, '.github', 'workflows', name), 'utf8');
      const checkout = workflow.match(/uses: actions\/checkout@[^\n]*\n(?:\s+with:\n(?:\s{8,}[^\n]*\n)+)?/);
      expect(checkout, `${name} checks out the repository`).not.toBeNull();
      expect(checkout![0], `${name} checks out with lfs: true`).toMatch(/\blfs:\s*true\b/);
      expect(workflow, name).not.toMatch(/kokoro|torch|pip install|uv (?:venv|pip)|requirements-kokoro|setup-python/i);
    }
    // Build and verify never regenerate narration; regeneration is an explicit local step.
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
    for (const name of ['build', 'build:budget', 'test', 'test:render', 'test:budget', 'verify']) {
      expect(scripts[name], name).not.toMatch(/kokoro|narration:(?:generate|regenerate)|generate-narration/i);
    }
  });

  it('records the committed-narration decision in an ADR', () => {
    const adrDir = join(ROOT, 'docs', 'adr');
    const adrs = readdirSync(adrDir).filter((file) => file.endsWith('.md') && !file.startsWith('0001-'));
    const matching = adrs.filter((file) => {
      const text = readFileSync(join(adrDir, file), 'utf8');
      return /Git LFS/i.test(text) && /audio\.model\.generate/.test(text) && /\block\b/i.test(text);
    });
    expect(matching, 'an ADR besides 0001 records Git LFS narration verified against the lock').not.toEqual([]);
  });
});

describe('#82 narration provenance (sidecar)', () => {
  it('declares every spec slot, and each narration slot as a committed Kokoro audio.model.generate@2 request', () => {
    const manifest = requests();
    expect({ schema: manifest.schema, schemaVersion: manifest.schemaVersion, project: manifest.project }).toEqual({
      schema: 'interactive-videos/asset-requests',
      schemaVersion: 1,
      project: PROJECT,
    });
    expect(Object.keys(manifest.slots).sort()).toEqual(spec().assets.map((slot) => slot.id).sort());
    expect(narrationSlotIds().length).toBeGreaterThan(0);
    for (const slotId of narrationSlotIds()) {
      const request = manifest.slots[slotId] as Json;
      expect(Object.keys(request).sort(), slotId).toEqual(['adapter', 'committed', 'evidence', 'inputs', 'operation', 'parameters']);
      expect(request.committed, slotId).toMatch(/^src\/content\/councils\/nicaea-325\/narration\/[a-z0-9._-]+\.wav$/);
      expect(request.operation, slotId).toEqual({ id: 'audio.model.generate', version: '2' });
      expect(request.adapter, slotId).toEqual({ id: 'kokoro', version: '1' });
      expect(Object.keys(request.inputs), slotId).toEqual(['model']);
      expect(request.inputs.model, slotId).toMatchObject({ kind: 'model', mediaType: 'application/zip', sha256: KOKORO.bundle.sha256, byteLength: KOKORO.bundle.byteLength });
      const parameters = request.parameters as Json;
      expect(Object.keys(parameters).sort(), `${slotId}: closed parameters, no frameCount`).toEqual(
        ['adapterParameters', 'channels', 'modelId', 'modelRevision', 'prompt', 'sampleRate', 'seed'].sort(),
      );
      expect(parameters.modelId).toBe(KOKORO.modelId);
      expect(parameters.modelRevision).toBe(KOKORO.modelRevision);
      expect(parameters.sampleRate).toBe(KOKORO.sampleRate);
      expect(parameters.channels).toBe(1);
      expect(['string', 'number']).toContain(typeof parameters.seed);
      expect(typeof parameters.prompt === 'string' && parameters.prompt.trim().length > 0, `${slotId} prompt`).toBe(true);
      const adapter = parameters.adapterParameters as Json;
      expect(Object.keys(adapter).filter((key) => !['voice', 'lexicon', 'speed'].includes(key)), `${slotId} adapterParameters`).toEqual([]);
      expect(KOKORO.voices, `${slotId} voice`).toContain(adapter.voice);
      expect(typeof adapter.lexicon?.version === 'string' && adapter.lexicon.version.trim() !== '', `${slotId} lexicon version`).toBe(true);
      expect(typeof adapter.lexicon?.entries, `${slotId} lexicon entries`).toBe('object');
      if (adapter.speed !== undefined) expect(adapter.speed).toBeGreaterThan(0);
      // Atlas 3.24: the upstream training-data caveat travels with the licence evidence.
      expect(request.evidence.license).toBe('Apache-2.0');
      expect(request.evidence.trainingDataCaveat).toMatch(/synthetic/i);
      expect(request.evidence.trainingDataCaveat).toMatch(/closed|commercial/i);
    }
  });

  it('uses one voice and one versioned lexicon for the whole episode', () => {
    const adapters = narrationSlotIds().map((slotId) => requests().slots[slotId].parameters.adapterParameters as Json);
    expect(new Set(adapters.map((adapter) => adapter.voice)).size).toBe(1);
    expect(new Set(adapters.map((adapter) => JSON.stringify(adapter.lexicon))).size).toBe(1);
  });

  it('speaks exactly the subtitled script: each slot prompt is the cue text of the scenes it narrates', () => {
    for (const slotId of narrationSlotIds()) {
      const spoken = narratedScenes()
        .filter((scene) => scene.narration!.audio!.asset === slotId)
        .map(sceneText)
        .join(' ');
      expect(normalizeText(requests().slots[slotId].parameters.prompt), slotId).toBe(normalizeText(spoken));
    }
  });
});

describe('#82 pronunciation lexicon', () => {
  const lexicon = () => {
    const [first] = narrationSlotIds();
    expect(first, 'a narration slot').toBeDefined();
    return requests().slots[first].parameters.adapterParameters as Json;
  };
  const entryFor = (entries: Record<string, string>, word: string) =>
    Object.entries(entries).find(([key]) => key.toLocaleLowerCase() === word.toLocaleLowerCase())?.[1];

  it('has explicit entries for Arius, Athanasius, homoousios and Nicaea (not covered by misaki, docs/kokoro.md)', () => {
    const { lexicon: { entries } } = lexicon();
    for (const word of REQUIRED_LEXICON) {
      const phonemes = entryFor(entries, word);
      expect(typeof phonemes === 'string' && phonemes.trim() !== '', `lexicon entry for ${word}`).toBe(true);
    }
  });

  it('covers every word of the script that misaki is documented not to know', () => {
    const { lexicon: { entries } } = lexicon();
    const spoken = new Set(narrationSlotIds().flatMap((slotId) => words(requests().slots[slotId].parameters.prompt)).map((word) => word.toLocaleLowerCase()));
    for (const word of KOKORO.notInMisaki) {
      if (spoken.has(word.toLocaleLowerCase())) expect(entryFor(entries, word), `lexicon entry for spoken word ${word}`).toBeDefined();
    }
  });

  it('writes entries as single words in the phoneme set of the chosen voice', () => {
    const { voice, lexicon: { entries } } = lexicon();
    const allowed = String(voice).startsWith('b') ? KOKORO.gbPhonemes : KOKORO.usPhonemes;
    for (const [word, phonemes] of Object.entries(entries as Record<string, string>)) {
      expect(word, 'one word per entry').toMatch(/^[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*$/u);
      const outside = [...String(phonemes)].filter((symbol) => symbol !== ' ' && !allowed.has(symbol));
      expect(outside, `${word}: phonemes outside the ${String(voice).startsWith('b') ? 'GB' : 'US'} misaki set`).toEqual([]);
    }
  });
});

describe('#82 English subtitles', () => {
  it('has non-empty cues in order and without overlap across the whole episode', () => {
    const cues = narrationSchedule(spec()).scenes.flatMap((scene) => scene.cues);
    expect(cues.length).toBeGreaterThan(10);
    cues.forEach((cue, index) => {
      expect(cue.text.trim().length, `cue ${index}`).toBeGreaterThan(0);
      expect(cue.durationInFrames, `cue ${index}`).toBeGreaterThan(0);
      if (index > 0) {
        const previous = cues[index - 1];
        expect(cue.from, `cue ${index} starts after cue ${index - 1} ends`).toBeGreaterThanOrEqual(previous.from + previous.durationInFrames);
      }
    });
  });

  it('covers each narration audio: starts near its start, ends near its end, no gap over 2 s', () => {
    for (const scene of narratedScenes()) {
      const { cues, audio } = scene.narration!;
      expect(cues[0].startMs, `${scene.id}: first cue`).toBeLessThanOrEqual(1000);
      expect(cues.at(-1)!.endMs, `${scene.id}: last cue`).toBeGreaterThanOrEqual(audio!.durationMs - 1000);
      cues.slice(1).forEach((cue, index) => {
        expect(cue.startMs - cues[index].endMs, `${scene.id}: gap before cue ${index + 1}`).toBeLessThanOrEqual(2000);
      });
    }
  });

  it('is timed from the generated audio: speech lies inside cues, and adjacent cues meet at a pause', () => {
    for (const scene of narratedScenes()) {
      const { wav } = committedWav(scene.narration!.audio!.asset);
      const frameMs = 20;
      const perFrame = (wav.sampleRate * frameMs) / 1000;
      const rms: number[] = [];
      for (let start = 0; start + perFrame <= wav.samples.length; start += perFrame) {
        let sum = 0;
        for (let index = start; index < start + perFrame; index += 1) sum += wav.samples[index] * wav.samples[index];
        rms.push(Math.sqrt(sum / perFrame));
      }
      const sorted = [...rms].sort((a, b) => a - b);
      const loud = sorted[Math.floor(sorted.length * 0.95)];
      expect(loud, `${scene.id}: the narration is audible`).toBeGreaterThan(500);
      const speech = loud * 0.1;
      const energy = (from: number, to: number) => rms.slice(Math.max(0, Math.floor(from / frameMs)), Math.ceil(to / frameMs)).reduce((sum, value) => sum + value * value, 0);
      const total = energy(0, wav.durationMs);
      const { cues } = scene.narration!;
      const inside = cues.reduce((sum, cue) => sum + energy(cue.startMs, cue.endMs), 0);
      expect(inside / total, `${scene.id}: share of speech energy inside cue windows`).toBeGreaterThanOrEqual(0.97);
      for (const [index, cue] of cues.entries()) {
        const frames = rms.slice(Math.floor(cue.startMs / frameMs), Math.ceil(cue.endMs / frameMs));
        const voiced = frames.filter((value) => value >= speech).length / Math.max(1, frames.length);
        expect(voiced, `${scene.id}: cue ${index} "${cue.text}" is over speech`).toBeGreaterThanOrEqual(0.3);
        const next = cues[index + 1];
        if (next && next.startMs - cue.endMs < 200) {
          // Kokoro pauses about 300 ms at a comma and 700 ms at a full stop, but under 140 ms
          // between words: a cue boundary must sit at a real pause, not inside a phrase.
          const boundary = (cue.endMs + next.startMs) / 2;
          const around = rms.slice(Math.max(0, Math.floor((boundary - 300) / frameMs)), Math.ceil((boundary + 300) / frameMs));
          let run = 0;
          let longest = 0;
          for (const value of around) {
            run = value < speech ? run + 1 : 0;
            longest = Math.max(longest, run);
          }
          expect(longest * frameMs, `${scene.id}: a pause of at least 140 ms near the boundary of cues ${index}/${index + 1} at ${Math.round(boundary)} ms`).toBeGreaterThanOrEqual(140);
        }
      }
    }
  });

  it('concatenates to the script text (whitespace and punctuation ignored)', () => {
    const subtitles = narratedScenes().map(sceneText).join(' ');
    const narration = (script().sections as Json[]).map((section) => section.text).join(' ');
    expect(normalizeText(subtitles)).toBe(normalizeText(narration));
  });
});

describe('#82 script, perspective, disclosure and sources', () => {
  it('is reviewable data with a complete arc (Atlas 3.2): context, council, Creed, aftermath', () => {
    const data = script();
    expect({ schema: data.schema, schemaVersion: data.schemaVersion, project: data.project, language: data.language }).toEqual({
      schema: 'interactive-videos/council-script',
      schemaVersion: 1,
      project: PROJECT,
      language: 'en',
    });
    const sections = data.sections as Json[];
    expect(sections.length).toBeGreaterThanOrEqual(4);
    expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
    const text = sections.map((section) => section.text).join(' ');
    for (const term of ['Arius', 'Alexander', 'Constantine', 'Nicaea', 'Creed', 'homoousios', 'Athanasius', 'Catholic']) {
      expect(text, `the narration mentions ${term}`).toMatch(new RegExp(`\\b${term}\\b`, 'i'));
    }
    // Other traditions are acknowledged where reception differs (Atlas 3.2, 3.6).
    expect(text).toMatch(/\b(Orthodox|Protestant|Anglican|Lutheran|Reformed|Eastern)\b/);
    // #61: do not claim the council selected the Biblical canon.
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (/\bcanon\b/i.test(sentence) && /\b(bible|biblical|scripture|scriptures|books)\b/i.test(sentence)) {
        expect(sentence, 'a sentence about the Biblical canon must deny, not claim, a Nicene selection').toMatch(/\b(not|never|no|did ?n[o’']t)\b/i);
      }
    }
  });

  it('states the Catholic perspective on screen in a named scene (Atlas 3.6), not only in a disclosure', () => {
    const { perspective } = script();
    expect(perspective.statement).toMatch(/\bCatholic\b/);
    expect(spec().scenes.map((scene) => scene.id), 'perspective.scene names a scene of the spec').toContain(perspective.scene);
    expect(normalizeText(perspective.statement)).not.toBe(normalizeText(script().disclosure.syntheticNarration));
  });

  it('discloses the synthetic narration in a visible text (Atlas 3.22)', () => {
    const { disclosure } = script();
    expect(disclosure.syntheticNarration).toMatch(/synthetic|text-to-speech|computer-generated|AI-generated/i);
    expect(disclosure.syntheticNarration).toMatch(/narrat|voice/i);
  });

  it('cites at least five sources, two of them primary, each with a title and a URL or reference', () => {
    const data = sources();
    expect({ schema: data.schema, schemaVersion: data.schemaVersion, project: data.project }).toEqual({
      schema: 'interactive-videos/council-sources',
      schemaVersion: 1,
      project: PROJECT,
    });
    const list = data.sources as Json[];
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(new Set(list.map((source) => source.id)).size).toBe(list.length);
    for (const source of list) {
      expect(source.id, 'source id').toMatch(/^[a-z0-9][a-z0-9._-]*$/);
      expect(['primary', 'secondary', 'magisterial', 'reference'], `${source.id} kind`).toContain(source.kind);
      expect(String(source.title ?? '').trim().length, `${source.id} title`).toBeGreaterThan(0);
      const url = typeof source.url === 'string' ? source.url : '';
      const reference = typeof source.reference === 'string' ? source.reference.trim() : '';
      expect(/^https:\/\/\S+$/.test(url) || reference.length > 0, `${source.id} has an https URL or a bibliographic reference`).toBe(true);
    }
    expect(list.filter((source) => source.kind === 'primary').length).toBeGreaterThanOrEqual(2);
  });

  it('references at least one known source from every script section, and cites every source', () => {
    const known = new Set((sources().sources as Json[]).map((source) => source.id));
    const cited = new Set<string>();
    for (const section of script().sections as Json[]) {
      expect(Array.isArray(section.sources) && section.sources.length > 0, `section ${section.id} cites a source`).toBe(true);
      for (const id of section.sources) {
        expect(known, `section ${section.id} cites ${id}`).toContain(id);
        cited.add(id);
      }
    }
    expect([...known].filter((id) => !cited.has(id)), 'uncited sources').toEqual([]);
  });
});

describe('#82 historical images (Atlas 3.16, only the visuals actually used)', () => {
  it('gives every image slot attribution metadata and every media reveal a caption', () => {
    const images = (spec().assets as unknown as Json[]).filter((slot) => slot.kind === 'image');
    for (const slot of images) {
      const attribution = slot.asset.metadata?.attribution as Json | undefined;
      expect(attribution, `${slot.id} has metadata.attribution`).toBeDefined();
      for (const field of ['title', 'source', 'license']) {
        expect(String(attribution![field] ?? '').trim().length, `${slot.id} attribution.${field}`).toBeGreaterThan(0);
      }
      expect(['documentary', 'later-artwork', 'illustration', 'reconstruction'], `${slot.id} attribution.depiction`).toContain(attribution!.depiction);
    }
    for (const scene of spec().scenes) {
      if (scene.kind !== 'mediaReveal') continue;
      expect(String(scene.payload.caption ?? '').trim().length, `${scene.id} has a visible caption`).toBeGreaterThan(0);
    }
    // No image without a request: image bytes are local sources the build can verify.
    for (const slot of images) expect(Object.keys(requests().slots[slot.id] ?? {}), slot.id).toEqual(['local']);
  });
});
