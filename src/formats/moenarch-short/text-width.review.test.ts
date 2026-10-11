// Regression for the Codex review on PR #55: combining marks and zero-width characters render as
// part of the preceding glyph, so they add no width to a planned line.
import { describe, expect, it } from 'vitest';

import { estimateLineWidth } from './layout';
import { moenarchShortV1Tokens as tokens } from './tokens';

describe('estimateLineWidth with decomposed text', () => {
  it('measures a decomposed accent like its composed form', () => {
    const decomposed = 'é'.repeat(7);
    expect(estimateLineWidth(decomposed, tokens, 'headline')).toBe(estimateLineWidth('e'.repeat(7), tokens, 'headline'));
    expect(estimateLineWidth(decomposed, tokens, 'headline')).toBeLessThanOrEqual(840);
  });

  it('gives zero-width joiners and variation selectors no advance', () => {
    expect(estimateLineWidth('a‍b️', tokens, 'body')).toBe(estimateLineWidth('ab', tokens, 'body'));
  });
});
