import { describe, expect, test } from 'vitest';

import { moenarchShort } from '@/formats/moenarch-short';

// Regressions for the Codex review on PR #36: overrides fail closed on every own key and never read
// through a prototype.
describe('moenarch-short overrides reject hidden and inherited properties', () => {
  test('an inherited accent is rejected', () => {
    expect(() => moenarchShort(Object.create({ accent: 'brick' }))).toThrow();
  });

  test('non-enumerable and symbol-keyed unknown fields are rejected', () => {
    const hidden = Object.defineProperty({}, 'palette', { value: {}, enumerable: false });
    expect(() => moenarchShort(hidden as never)).toThrow();
    expect(() => moenarchShort({ [Symbol('x')]: 1 } as never)).toThrow();
  });

  test('an accessor accent is rejected', () => {
    const getter = Object.defineProperty({}, 'accent', { get: () => 'brick', enumerable: true });
    expect(() => moenarchShort(getter as never)).toThrow();
  });

  test('a plain own accent still applies', () => {
    const accents = moenarchShort().tokens.accents as Record<string, string>;
    const [name] = Object.keys(accents).filter((key) => accents[key] !== moenarchShort().tokens.palette.accent);
    expect(moenarchShort({ accent: name } as never).tokens.palette.accent).toBe(accents[name!]);
  });
});
