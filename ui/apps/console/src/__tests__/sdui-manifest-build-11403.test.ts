/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11403 — the console build ships `dist/sdui.manifest.json`, and it is
 * the one generator's output for the console's own registry.
 *
 * A host serving this Console registers that file under
 * `@objectstack/metadata-protocol`'s `SDUI_MANIFEST_SERVICE`; with no file it
 * prints one boot line and judges no page save. Four facts:
 *
 *   1. WIRED — the package's `build` script runs the manifest step after
 *      `vite build` (which empties `dist`), so the step's output survives.
 *   2. ONE FILE — the step writes `sdui.manifest.json` and nothing else into
 *      the published `dist`, while `buildArtifacts` itself writes three files
 *      (the control that makes "nothing else" a reading).
 *   3. ONE GENERATOR — its bytes are the bytes `buildArtifacts` in
 *      `packages/sdui-parser/scripts/gen-manifest.ts` writes for the same
 *      registry.
 *   4. THE SHAPE THE HOST READS — `isUsableSduiManifest` accepts a value only
 *      when it and its `components` are each a non-array object; the record is
 *      populated, including a block the console registers only lazily.
 *
 * The registry is the module the step itself imports
 * (`dev/manifest-registry.ts`), RUN here rather than mirrored.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
// Module scope, not a hook: the whole registration graph loads at import time.
import '../../dev/manifest-registry';
import { buildArtifacts } from '../../../../packages/sdui-parser/scripts/gen-manifest';
import { SDUI_MANIFEST_FILE, emitSduiManifest } from '../../scripts/emit-sdui-manifest';

const CONSOLE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sdui-manifest-11403-'));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** The predicate `isUsableSduiManifest` applies (`isRec`), restated: the package is not installed here. */
const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const emitted = scratch();
emitSduiManifest(emitted);
const generator = scratch();
buildArtifacts(generator);

describe('the console build ships dist/sdui.manifest.json (objectui#11403)', () => {
  it('runs the manifest step after `vite build` in the package build script', () => {
    const pkg = JSON.parse(readFileSync(join(CONSOLE_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const steps = pkg.scripts.build.split('&&').map((step) => step.trim());
    const viteBuild = steps.indexOf('vite build');
    const manifestStep = steps.indexOf('pnpm build:sdui-manifest');
    expect(viteBuild).toBeGreaterThanOrEqual(0);
    expect(manifestStep).toBeGreaterThan(viteBuild);
    expect(pkg.scripts['build:sdui-manifest']).toContain('scripts/build-sdui-manifest.ts');
  });

  it('writes the manifest and nothing else, where the generator writes three files', () => {
    expect(readdirSync(emitted)).toEqual([SDUI_MANIFEST_FILE]);
    expect(readdirSync(generator).sort()).toEqual(['sdui-blocks.md', 'sdui-intrinsics.d.ts', SDUI_MANIFEST_FILE].sort());
  });

  it('is byte for byte what buildArtifacts writes for the same registry', () => {
    expect(readFileSync(join(emitted, SDUI_MANIFEST_FILE), 'utf8')).toBe(
      readFileSync(join(generator, SDUI_MANIFEST_FILE), 'utf8'),
    );
  });

  it('carries the populated components record the host reads', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(emitted, SDUI_MANIFEST_FILE), 'utf8'));
    expect(isRec(manifest)).toBe(true);
    const components = isRec(manifest) ? manifest.components : undefined;
    expect(isRec(components)).toBe(true);
    if (!isRec(components)) return;
    // `object-map` is registered only lazily in `src/register-plugins.ts`; its
    // declared inputs reach the manifest only through the eager registry.
    const map = components['object-map'];
    expect(isRec(map) && Array.isArray(map.inputs) && map.inputs.length > 0).toBe(true);
  });
});
