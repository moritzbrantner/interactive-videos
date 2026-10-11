// Acceptance for issue #15: the render command is documented and `bun run verify` runs a cheap
// render smoke (src/render/render.smoke.test.ts, a few frames of the title-card fixture), not a full
// production render. The smoke runs in its own Vitest config so the unit run stays fast.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const scripts: Record<string, string> = JSON.parse(read('package.json')).scripts;

describe('render command wiring', () => {
  it('defines the documented `bun run video:render` command', () => {
    expect(scripts['video:render']).toBeTypeOf('string');
    expect(read('README.md')).toMatch(/bun run video:render --project/);
  });

  it('runs the render smoke from `bun run verify` through test:render', () => {
    expect(scripts['test:render']).toMatch(/vitest run\b.*--config[ =]vitest\.render\.config\.ts/);
    const steps = scripts.verify.split('&&').map((step) => step.trim());
    expect(steps).toContain('bun run test:render');
  });

  it('keeps the smoke out of the unit run and in the render config only', () => {
    expect(read('vitest.config.ts')).toMatch(/smoke\.test/);
    expect(read('vitest.render.config.ts')).toMatch(/src\/render\/\*\*\/\*\.smoke\.test\.ts/);
  });

  it('ignores default render output and keeps CI installing the Playwright Chromium the renderer uses', () => {
    expect(read('.gitignore').split('\n').map((line) => line.trim())).toContain('out/');
    const ci = read('.github/workflows/ci.yml');
    const install = ci.indexOf('playwright install --with-deps chromium');
    expect(install).toBeGreaterThan(-1);
    expect(ci.indexOf('bun run verify')).toBeGreaterThan(install);
  });
});
