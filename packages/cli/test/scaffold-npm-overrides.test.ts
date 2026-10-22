// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — every standalone manifest `os init` and `os create` emit carries the
 * npm `overrides` block, built from the vitest constant and the two `uuid`
 * constants (the `uuid` entry is an advisory route; its pins are at the end).
 *
 * ## The defect
 *
 * vitest 4.1.12 shipped a self-contradicting peer set (it peers
 * `@vitest/browser-webdriverio ^4.1.11`, whose only release peers `vitest:
 * 4.1.11` exactly). npm 10 — the npm Node 22 bundles — reaches it through
 * OPTIONAL `vitest` peers in the `@objectstack/cli` closure, even with vitest
 * pinned to `~4.0.0` at the project root, and its arborist crashes with
 * `Cannot read properties of null (reading 'edgesOut')`. Measured 2026-10-16:
 * `os init -t app`, `-t plugin` and `-t empty` all failed `npm install` on npm
 * 10.9.9; with `"overrides": { "vitest": "~4.0.0" }` all of them, and `os
 * create plugin`, installed on npm 10.9.9 and npm 11.21.1. The range has since
 * moved to `~4.1.12` (GHSA-qxg6-89mg-rqv8 has no 4.0.x fix), and the override
 * still decides it: re-measured 2026-10-22, without it `os init -t app`, `-t
 * plugin` and `os create plugin` each crash npm 10.9.9, and with it the
 * emissions install on npm 10.9.4, 10.9.9 and 11.21.1. The full readings are on `SCAFFOLD_VITEST_RANGE` and
 * `SCAFFOLD_NPM_OVERRIDES` in `src/commands/init.ts`.
 *
 * ## What is asserted, and why no range is written down here
 *
 * Every equality is DERIVED from the exported constants, never a literal: a
 * pin comparing against a spelled-out range would stay green on a tree where
 * the constant moved and one emission was left behind — the drift it exists
 * to catch. The literals are LOWER bounds, the advisories' fixed releases, in
 * the floor pins at the end of this file.
 *
 *   1. Each emission's `overrides.vitest` IS `SCAFFOLD_VITEST_RANGE`.
 *   2. Where an emission also declares `vitest` directly, the two are equal —
 *      npm refuses an override that differs from the direct dependency's own
 *      spec (`EOVERRIDE`), so a mismatch is an install failure of its own.
 *   3. `os create plugin --in-repo` emits NO `overrides`: npm reads the field
 *      only from the root manifest and pnpm never reads it, so inside the
 *      workspace it would be a declaration nothing honours.
 *
 * That the emitted manifests really install is not decidable here; the npm
 * matrix above is the measurement, and `create-objectstack`'s bundled template
 * reaches the same constant through `scripts/sync-scaffold-emission-policy.mjs`
 * (`pnpm check:scaffold-emission-policy`).
 */

import { describe, it, expect } from 'vitest';
import {
  renderScaffoldPackageJson,
  SCAFFOLD_NPM_OVERRIDES,
  SCAFFOLD_UUID_OVERRIDE_RANGE,
  SCAFFOLD_UUID_OVERRIDE_SELECTOR,
  SCAFFOLD_VITEST_RANGE,
  TEMPLATES,
} from '../src/commands/init.js';
import { DEFAULT_PLACEMENT, templates } from '../src/commands/create.js';

const PROBE_NAME = 'overrides-probe';

type Manifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

/** Every standalone manifest the two commands emit, derived from the live maps. */
function standaloneManifests(): Array<{ id: string; manifest: Manifest }> {
  const out: Array<{ id: string; manifest: Manifest }> = [];
  for (const [key, template] of Object.entries(TEMPLATES)) {
    out.push({ id: `os init -t ${key}`, manifest: renderScaffoldPackageJson(PROBE_NAME, template) as Manifest });
  }
  for (const [key, template] of Object.entries(templates)) {
    const render = template.filesFor(DEFAULT_PLACEMENT)['package.json'];
    if (!render) continue;
    out.push({ id: `os create ${key}`, manifest: render(PROBE_NAME) as Manifest });
  }
  return out;
}

describe('npm overrides in every standalone scaffold manifest', () => {
  it('harvests every emission, and the default placement IS standalone (control)', () => {
    expect(DEFAULT_PLACEMENT).toBe('standalone');
    const ids = standaloneManifests().map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(['os init -t app', 'os init -t plugin', 'os create plugin']));
    // Assertion 2 below must range over something, or it certifies nothing.
    const direct = standaloneManifests().filter((m) => m.manifest.devDependencies?.vitest !== undefined);
    expect(direct.map((m) => m.id)).toEqual(expect.arrayContaining(['os init -t plugin', 'os create plugin']));
  });

  it('the override map is built from the vitest and uuid constants, and nothing else', () => {
    expect(SCAFFOLD_NPM_OVERRIDES.vitest).toBe(SCAFFOLD_VITEST_RANGE);
    expect(SCAFFOLD_NPM_OVERRIDES[SCAFFOLD_UUID_OVERRIDE_SELECTOR]).toBe(SCAFFOLD_UUID_OVERRIDE_RANGE);
    expect(Object.keys(SCAFFOLD_NPM_OVERRIDES).sort()).toEqual(['vitest', SCAFFOLD_UUID_OVERRIDE_SELECTOR].sort());
    expect(Object.isFrozen(SCAFFOLD_NPM_OVERRIDES)).toBe(true);
  });

  it.each(standaloneManifests())('$id emits overrides.vitest = SCAFFOLD_VITEST_RANGE', ({ manifest }) => {
    expect(manifest.overrides).toEqual({ ...SCAFFOLD_NPM_OVERRIDES });
    expect(manifest.overrides?.vitest).toBe(SCAFFOLD_VITEST_RANGE);
  });

  it.each(standaloneManifests())(
    '$id: every override naming a direct dependency equals that dependency (npm EOVERRIDE)',
    ({ manifest }) => {
      const direct = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };
      for (const [name, range] of Object.entries(manifest.overrides ?? {})) {
        if (direct[name] === undefined) continue;
        expect(range, `overrides.${name} vs the direct ${name} dependency`).toBe(direct[name]);
      }
    },
  );

  it('os create --in-repo emits no overrides block — npm and pnpm both ignore it in a workspace member', () => {
    const render = templates.plugin.filesFor('in-repo')['package.json'];
    const manifest = render(PROBE_NAME) as Manifest;
    // Control: the in-repo manifest is a real one, with vitest declared.
    expect(manifest.devDependencies?.vitest).toBe(SCAFFOLD_VITEST_RANGE);
    expect(manifest).not.toHaveProperty('overrides');
  });
});

/**
 * The floor every scaffold's vitest range must keep: the first release of each
 * major outside GHSA-qxg6-89mg-rqv8 (`@vitest/mocker` from 2.1.0-beta.7 up to
 * the fix in 4.1.12, and from 5.0.0-beta.1 up to the fix in 5.0.3; read from
 * the npm registry's advisory endpoint, 2026-10-22; the same floors clear
 * GHSA-xp26-3454-mjgp, GHSA-82fw-gwwq-j7x9 and vitest's own
 * GHSA-5xrq-8626-4rwp by that reading). vitest depends on its own
 * `@vitest/mocker` at the exact same version, so a vitest floor is a mocker
 * floor. A major with no row here is refused rather than passed: moving the
 * scaffold to it is the moment to read the advisory for that line.
 */
const FIXED_FLOOR_BY_MAJOR: Readonly<Record<number, readonly [number, number, number]>> = {
  4: [4, 1, 12],
  5: [5, 0, 3],
};

describe('the scaffold vitest range stays outside GHSA-qxg6-89mg-rqv8', () => {
  it('its lowest admitted version is at or above the advisory fix for its major', () => {
    // Only the two spellings the scaffold uses: an unreadable range is a
    // failure here, never a pass.
    const match = /^[~^](\d+)\.(\d+)\.(\d+)$/.exec(SCAFFOLD_VITEST_RANGE);
    expect(match, `SCAFFOLD_VITEST_RANGE "${SCAFFOLD_VITEST_RANGE}" is not a ~X.Y.Z or ^X.Y.Z range`).not.toBeNull();
    const floor = match!.slice(1).map(Number) as [number, number, number];
    const fixed = FIXED_FLOOR_BY_MAJOR[floor[0]];
    expect(fixed, `no advisory floor is recorded for vitest ${floor[0]}.x — read the advisory, then add the row`).toBeDefined();
    const atOrAbove = floor[1] !== fixed![1] ? floor[1] > fixed![1] : floor[2] >= fixed![2];
    expect(atOrAbove, `SCAFFOLD_VITEST_RANGE "${SCAFFOLD_VITEST_RANGE}" admits ${floor.join('.')}, below the fix ${fixed!.join('.')}`).toBe(true);
  });
});

/**
 * The `uuid` override must keep routing exceljs's `uuid ^8.3.0` (reached
 * through `@objectstack/rest`) out of GHSA-w5hq-g745-h8pq. The advisory affects
 * `uuid` below 11.1.1, and 12.0.0 and 13.0.0; the fixed releases are 11.1.1,
 * 12.0.1 and 13.0.1 (read from the npm registry's bulk advisory endpoint,
 * 2026-10-22).
 * Two properties, both read off the constants:
 *
 *   1. The TARGET's lowest admitted version is at or above the fix for its
 *      major. A major with no row is refused: moving the target there is the
 *      moment to read the advisory for that line.
 *   2. The SELECTOR is `uuid@<M.0.0` with M the major right above the target,
 *      so every edge that can resolve below the fix is rewritten (the
 *      exceljs edge is `^8.3.0`), and a later advisory on the target line
 *      moves the target alone.
 */
const UUID_FIXED_FLOOR_BY_MAJOR: Readonly<Record<number, readonly [number, number, number]>> = {
  11: [11, 1, 1],
  12: [12, 0, 1],
  13: [13, 0, 1],
};

describe('the scaffold uuid override stays outside GHSA-w5hq-g745-h8pq', () => {
  it('its target admits nothing below the advisory fix for its major', () => {
    const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(SCAFFOLD_UUID_OVERRIDE_RANGE);
    expect(match, `SCAFFOLD_UUID_OVERRIDE_RANGE "${SCAFFOLD_UUID_OVERRIDE_RANGE}" is not a ^X.Y.Z range`).not.toBeNull();
    const floor = match!.slice(1).map(Number) as [number, number, number];
    const fixed = UUID_FIXED_FLOOR_BY_MAJOR[floor[0]];
    expect(fixed, `no advisory floor is recorded for uuid ${floor[0]}.x — read the advisory, then add the row`).toBeDefined();
    const atOrAbove = floor[1] !== fixed![1] ? floor[1] > fixed![1] : floor[2] >= fixed![2];
    expect(
      atOrAbove,
      `SCAFFOLD_UUID_OVERRIDE_RANGE "${SCAFFOLD_UUID_OVERRIDE_RANGE}" admits ${floor.join('.')}, below the fix ${fixed!.join('.')}`,
    ).toBe(true);
  });

  it('its selector covers every version below the target line, bounded at the next major', () => {
    const selector = /^uuid@<(\d+)\.0\.0$/.exec(SCAFFOLD_UUID_OVERRIDE_SELECTOR);
    expect(selector, `SCAFFOLD_UUID_OVERRIDE_SELECTOR "${SCAFFOLD_UUID_OVERRIDE_SELECTOR}" is not uuid@<M.0.0`).not.toBeNull();
    const targetMajor = Number(/^\^(\d+)\./.exec(SCAFFOLD_UUID_OVERRIDE_RANGE)?.[1]);
    expect(Number(selector![1])).toBe(targetMajor + 1);
  });
});
