// Test fixture generator for the narration fixture audio (issue #14 acceptance). Not app code: the
// renderer never synthesizes audio; it plays the committed files under public/fixtures/narration/.
//
// Each file is a tiny mono 8-bit PCM WAV at 8000 Hz: a quiet square tone computed with integer
// arithmetic only, so the bytes are identical on every machine. 8 samples per millisecond, so a
// file is exactly `durationMs` long. `narration-fixture.test.ts` regenerates every file and
// compares it byte for byte with the committed one.

export const NARRATION_WAV_SAMPLE_RATE = 8000;

/** A WAV file of exactly `durationMs` milliseconds with a square tone of `toneHz`. */
export function narrationWav(durationMs: number, toneHz: number): Uint8Array {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1) throw new Error('durationMs must be a positive integer');
  const samples = (durationMs * NARRATION_WAV_SAMPLE_RATE) / 1000;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, NARRATION_WAV_SAMPLE_RATE, true);
  view.setUint32(28, NARRATION_WAV_SAMPLE_RATE, true); // byte rate: 1 byte per sample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  for (let index = 0; index < samples; index += 1) {
    // Half periods of the tone, in whole samples; 8-bit PCM is unsigned around 128.
    const high = Math.floor((index * toneHz * 2) / NARRATION_WAV_SAMPLE_RATE) % 2 === 0;
    bytes[44 + index] = high ? 140 : 116;
  }
  return bytes;
}

/** The committed narration fixture files: public path below `public/` and how they are generated. */
export const NARRATION_FIXTURE_FILES = [
  { path: 'fixtures/narration/hook.wav', durationMs: 2450, toneHz: 220 },
  { path: 'fixtures/narration/point.wav', durationMs: 3000, toneHz: 330 },
] as const;

/** Duration in ms of a mono 8-bit PCM WAV, read from its header. */
export function wavDurationMs(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteRate = view.getUint32(28, true);
  const dataBytes = view.getUint32(40, true);
  return (dataBytes * 1000) / byteRate;
}
