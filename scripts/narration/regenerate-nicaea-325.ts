// Local, explicit regeneration of the Nicaea I narration (#82). NOT part of build, verify or CI:
// those only verify the committed WAVs against the VideoSpec locks (ADR 0002). This script needs a
// local Kokoro-82M runtime and a checkout of asset-tooling at the pinned upstream revision; it never
// changes the asset-tooling package pin the app and CI use.
//
//   ASSET_TOOLING_CHECKOUT=~/privat/asset-tooling            # at 502e955 (checked)
//   ASSET_TOOLING_KOKORO_PYTHON=~/.cache/asset-tooling/kokoro-venv/bin/python
//   ASSET_TOOLING_KOKORO_MODEL_ZIP=~/.cache/asset-tooling/models/kokoro-82M-f3ff357/model.zip
//   ASSET_TOOLING_KOKORO_THREADS=2                            # optional, default 2
//   bun scripts/narration/regenerate-nicaea-325.ts [--retime] [--only <scene id>,…]
//
// For every storyboard scene it runs asset-tooling's `audio.model.generate@2` with the Kokoro
// adapter through `runAssetOperation` (operation-result reuse: an unchanged request is a verified
// hit in the local store `.cache/narration-store`, nothing re-executes), copies the output WAV to
// src/content/councils/nicaea-325/narration/<scene>.wav (Git LFS), derives the subtitle cue timing
// from the audio itself (cue boundaries on measured pauses) and writes the VideoSpec and its
// sidecar request manifest with each slot locked to the AssetRef the operation produced.
// `--retime` skips generation and re-derives timing, spec and sidecar from the committed WAVs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { assertVideoSpec, serializeVideoSpec } from '../../src/spec/video-spec';

import { assertCleanAssetToolingCheckout } from './asset-tooling-checkout';

type Json = Record<string, any>;

const ROOT = resolve(import.meta.dirname, '..', '..');
const PROJECT = 'council-nicaea-325';
const CONTENT = join(ROOT, 'src', 'content', 'councils', 'nicaea-325');
const NARRATION_DIR = join(CONTENT, 'narration');
const SPEC_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.videospec.json`);
const REQUESTS_PATH = join(ROOT, 'src', 'spec', 'fixtures', `${PROJECT}.asset-requests.json`);
const STORE = join(ROOT, '.cache', 'narration-store');

const ASSET_TOOLING_REVISION = '502e955';
const KOKORO = {
  modelId: 'hexgrad/Kokoro-82M',
  modelRevision: 'f3ff3571791e39611d31c381e3a41a3af07b4987',
  bundleSha256: '115b504bedbf242d7794bab72deff3abb1ab069ebf7c5c985f19dcc65f47211d',
};
const VOICE = 'af_heart';
const SEED = '325';
const SAMPLE_RATE = 24_000;
const EVIDENCE = {
  license: 'Apache-2.0',
  trainingDataCaveat:
    "Kokoro-82M's model card says its training data includes synthetic audio from closed commercial TTS providers. Accepted for the initial Seven Councils narration by Decision Atlas 3.24 (asset-tooling docs/kokoro.md).",
};

// Scene timing around the narration audio (format moenarch-short v1 bounds both at 1000 ms).
const LEAD_IN_MS = 100;
const LEAD_OUT_MS = 200;

// Pause detection, on the same 20 ms RMS frames the acceptance test measures.
const FRAME_MS = 20;
const MIN_PAUSE_FRAMES = 7; // 140 ms
const CUE_PAD_BEFORE_MS = 60;
const CUE_PAD_AFTER_MS = 80;
const BOUNDARY_PAD_MS = 40;

const readJson = (path: string): Json => JSON.parse(readFileSync(path, 'utf8'));
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const slotId = (sceneId: string) => `narration.${sceneId}`;
const wavPath = (sceneId: string) => join(NARRATION_DIR, `${sceneId}.wav`);
const repoPath = (absolute: string) => absolute.slice(ROOT.length + 1);

function args() {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
  return { retime: argv.includes('--retime'), only };
}

/** The storyboard's cues per section must be exactly script.json's section texts. */
function checkScript(storyboard: Json, script: Json) {
  for (const section of script.sections as Json[]) {
    const spoken = (storyboard.scenes as Json[]).filter((scene) => scene.section === section.id).flatMap((scene) => scene.say).join(' ');
    if (normalize(spoken) !== normalize(section.text)) {
      throw new Error(`section ${section.id}: the storyboard cues are not the script text\n  storyboard: ${spoken}\n  script:     ${section.text}`);
    }
  }
  const sections = new Set((script.sections as Json[]).map((section) => section.id));
  for (const scene of storyboard.scenes as Json[]) {
    if (!sections.has(scene.section)) throw new Error(`scene ${scene.id} names unknown section ${scene.section}`);
  }
}

function parameters(prompt: string, lexicon: Json) {
  return {
    modelId: KOKORO.modelId,
    modelRevision: KOKORO.modelRevision,
    prompt,
    seed: SEED,
    sampleRate: SAMPLE_RATE,
    channels: 1,
    adapterParameters: { voice: VOICE, lexicon },
  };
}

async function generate(storyboard: Json, lexicon: Json, only: Set<string> | null) {
  const checkout = process.env.ASSET_TOOLING_CHECKOUT;
  const python = process.env.ASSET_TOOLING_KOKORO_PYTHON;
  const modelZip = process.env.ASSET_TOOLING_KOKORO_MODEL_ZIP;
  const threads = Number(process.env.ASSET_TOOLING_KOKORO_THREADS ?? '2');
  if (!checkout || !python || !modelZip) {
    throw new Error('set ASSET_TOOLING_CHECKOUT, ASSET_TOOLING_KOKORO_PYTHON and ASSET_TOOLING_KOKORO_MODEL_ZIP (see the header)');
  }
  // Pinned revision and a clean tree: the imported working tree must be exactly that commit.
  const head = assertCleanAssetToolingCheckout(checkout, ASSET_TOOLING_REVISION);
  const store = await import(join(checkout, 'src', 'asset-store.ts'));
  const operations = await import(join(checkout, 'src', 'audio-model-operations.ts'));
  const backends = await import(join(checkout, 'src', 'model-backends.ts'));

  mkdirSync(STORE, { recursive: true });
  mkdirSync(NARRATION_DIR, { recursive: true });
  const bundle = readFileSync(modelZip);
  const bundleSha = createHash('sha256').update(bundle).digest('hex');
  if (bundleSha !== KOKORO.bundleSha256) throw new Error(`model.zip is sha256 ${bundleSha}, expected ${KOKORO.bundleSha256}`);
  const model = (await store.storeAssetObject(STORE, { bytes: bundle, kind: 'model', mediaType: 'application/zip', metadata: {} })).asset;

  const adapter = backends.createKokoroAudioModelAdapter({ python, threads });
  const execute = operations.createAudioModelGenerateV2OperationExecutor(adapter);
  const receipt: Json = { assetTooling: head, threads, scenes: {} };
  const receiptPath = join(NARRATION_DIR, 'regeneration-receipt.json');
  if (existsSync(receiptPath)) Object.assign(receipt.scenes, readJson(receiptPath).scenes);
  for (const scene of storyboard.scenes as Json[]) {
    if (only && !only.has(scene.id)) continue;
    const invocation = { parameters: parameters((scene.say as string[]).join(' '), lexicon), inputs: { model } };
    const build = await operations.createAudioModelGenerateV2OperationBuildIdentity(adapter, invocation);
    const started = Date.now();
    const run = await store.runAssetOperation(
      STORE,
      { descriptor: operations.AUDIO_MODEL_GENERATE_V2_OPERATION, implementation: build.implementation, execute: (root: string, executed: Json) => execute(root, executed) },
      invocation,
    );
    const output = run.result.outputs.output;
    writeFileSync(wavPath(scene.id), await store.resolveAssetObject(STORE, output));
    receipt.scenes[scene.id] = { status: run.status, cacheKey: run.cacheKey, asset: output, phonemes: run.result.observations?.backend?.phonemes ?? run.result.observations?.phonemes ?? null };
    console.error(`${scene.id}: ${run.status} ${output.sha256} ${(output.metadata.audio.frameCount / SAMPLE_RATE).toFixed(2)} s (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return model;
}

/** 24 kHz mono PCM16 samples of a canonical WAV. */
function samplesOf(bytes: Buffer): Int16Array {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString('latin1');
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'data') return new Int16Array(bytes.buffer.slice(bytes.byteOffset + offset + 8, bytes.byteOffset + offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

/**
 * Cue windows for one scene, timed from its audio: speech starts and ends where the 20 ms RMS
 * crosses a tenth of the loud (95th percentile) level, and each boundary between two cues is the
 * measured pause (at least 140 ms) that best fits the cue's share of the text.
 */
function timeCues(sceneId: string, cues: string[], samples: Int16Array) {
  const perFrame = (SAMPLE_RATE * FRAME_MS) / 1000;
  const rms: number[] = [];
  for (let start = 0; start + perFrame <= samples.length; start += perFrame) {
    let sum = 0;
    for (let index = start; index < start + perFrame; index += 1) sum += samples[index] * samples[index];
    rms.push(Math.sqrt(sum / perFrame));
  }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.95)];
  const speech = loud * 0.1;
  const voiced = rms.map((value) => value >= speech);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  const pauses: { from: number; to: number }[] = [];
  for (let index = first; index <= last; ) {
    if (voiced[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end <= last && !voiced[end]) end += 1;
    if (end - index >= MIN_PAUSE_FRAMES) pauses.push({ from: index, to: end });
    index = end;
  }
  const durationMs = Math.round((samples.length / SAMPLE_RATE) * 1000);
  const speechFrom = first * FRAME_MS;
  const speechTo = (last + 1) * FRAME_MS;
  const lengths = cues.map((cue) => cue.replace(/[^\p{L}\p{N}]/gu, '').length);
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const boundaries: { from: number; to: number }[] = [];
  let consumed = 0;
  let after = first;
  for (let index = 0; index + 1 < cues.length; index += 1) {
    consumed += lengths[index];
    const expected = speechFrom + ((speechTo - speechFrom) * consumed) / total;
    const candidates = pauses.filter((pause) => pause.from > after);
    if (candidates.length === 0) throw new Error(`${sceneId}: no pause left for the boundary after cue ${index}`);
    const score = (pause: { from: number; to: number }) => (pause.to - pause.from) * FRAME_MS - 0.5 * Math.abs(((pause.from + pause.to) / 2) * FRAME_MS - expected);
    const best = candidates.reduce((winner, pause) => (score(pause) > score(winner) ? pause : winner));
    boundaries.push(best);
    after = best.to;
  }
  const windows = cues.map((text, index) => {
    const startMs = index === 0 ? Math.max(0, speechFrom - CUE_PAD_BEFORE_MS) : boundaries[index - 1].to * FRAME_MS - BOUNDARY_PAD_MS;
    const endMs = index === cues.length - 1 ? Math.min(durationMs, speechTo + CUE_PAD_AFTER_MS) : boundaries[index].from * FRAME_MS + BOUNDARY_PAD_MS;
    return { startMs, endMs, text };
  });
  for (const [index, window] of windows.entries()) {
    const chars = lengths[index];
    console.error(`  ${sceneId}[${index}] ${window.startMs}-${window.endMs} ms, ${(chars / ((window.endMs - window.startMs) / 1000)).toFixed(1)} chars/s  ${window.text}`);
  }
  return { durationMs, cues: windows };
}

async function main() {
  const { retime, only } = args();
  const storyboard = readJson(join(CONTENT, 'storyboard.json'));
  const script = readJson(join(CONTENT, 'script.json'));
  const lexicon = readJson(join(CONTENT, 'lexicon.json'));
  checkScript(storyboard, script);

  let model: Json;
  if (retime) {
    const previous = readJson(REQUESTS_PATH);
    model = (Object.values(previous.slots)[0] as Json).inputs.model;
  } else {
    model = await generate(storyboard, lexicon, only);
  }

  const receipt = readJson(join(NARRATION_DIR, 'regeneration-receipt.json'));
  const assets: Json[] = [];
  const scenes: Json[] = [];
  const slots: Json = {};
  for (const scene of storyboard.scenes as Json[]) {
    const lock = receipt.scenes[scene.id].asset as Json;
    const bytes = readFileSync(wavPath(scene.id));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== lock.sha256 || bytes.length !== lock.byteLength) throw new Error(`${scene.id}: the WAV is not the recorded operation output`);
    const timing = timeCues(scene.id, scene.say, samplesOf(bytes));
    assets.push({ id: slotId(scene.id), kind: 'audio', asset: lock });
    scenes.push({
      kind: scene.kind,
      id: scene.id,
      narration: { audio: { asset: slotId(scene.id), durationMs: timing.durationMs }, leadInMs: LEAD_IN_MS, leadOutMs: LEAD_OUT_MS, cues: timing.cues },
      payload: scene.payload,
    });
    slots[slotId(scene.id)] = {
      committed: repoPath(wavPath(scene.id)),
      operation: { id: 'audio.model.generate', version: '2' },
      adapter: { id: 'kokoro', version: '1' },
      parameters: parameters((scene.say as string[]).join(' '), lexicon),
      inputs: { model },
      evidence: EVIDENCE,
    };
  }
  const spec = assertVideoSpec({
    specVersion: 2,
    project: { id: PROJECT, title: 'The First Council of Nicaea (325)' },
    format: { id: 'moenarch-short', version: 1 },
    output: { width: 1080, height: 1920, fps: 30 },
    assets,
    scenes,
  });
  writeFileSync(SPEC_PATH, serializeVideoSpec(spec));
  const sorted = Object.fromEntries(Object.keys(slots).sort().map((key) => [key, slots[key]]));
  writeFileSync(REQUESTS_PATH, `${JSON.stringify({ schema: 'interactive-videos/asset-requests', schemaVersion: 1, project: PROJECT, slots: sorted }, null, 2)}\n`);
  const seconds = scenes.reduce((sum, scene) => sum + scene.narration.audio.durationMs + LEAD_IN_MS + LEAD_OUT_MS, 0) / 1000;
  console.error(`wrote ${repoPath(SPEC_PATH)} (${scenes.length} scenes, about ${seconds.toFixed(1)} s) and ${repoPath(REQUESTS_PATH)}`);
}

await main();
