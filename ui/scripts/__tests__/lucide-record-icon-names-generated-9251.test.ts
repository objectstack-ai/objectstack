/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9251 — the legal icon-name set is BUILD-GENERATED, and ⛔ not
 * derived from `Object.keys(icons)`.
 *
 * The maintainer ruling of 2026-09-13 (decision batch #132 item 4, 「同意」) is
 * specific about the source, and about why:
 *
 *   「合法图标名集合由构建期生成的静态名单提供(⛔ 不从 `Object.keys(icons)`
 *     推导 ⇒ #9204 救援 A 拒绝)」
 *
 * Indexing the record is what put all 1,781 icon modules into the console's
 * eager closure. A membership set read from `Object.keys(icons)` is that same
 * import, so it would pin the record eager while LOOKING like a name list — the
 * shape objectui#9204's rescue option A proposed and this ruling refused by
 * name. The rows below hold that shut from the test side; part 4 of
 * `scripts/check-lucide-icon-record-names.mjs` holds it shut in CI.
 *
 * ⚠️ Every "does not import the record" row runs its probe against a POSITIVE
 * CONTROL first — a file in this tree that does import it. Without that, a
 * probe that had stopped matching anything would report the same silence as a
 * clean tree, and the silence is what the rows are made of.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveRecordIconNamePairs,
  renderModule,
  TARGET,
} from '../regenerate-lucide-record-icon-names.mjs';
import {
  GENERATED_NAME_LIST_TARGET,
  RECORD_FREE_MODULES,
  RECORD_IMPORT_POSITIVE_CONTROL,
  icons,
  importsRecordEntry,
  judgeGeneratedNameList,
} from '../check-lucide-icon-record-names.mjs';

/**
 * The repo root, walked up from THIS FILE rather than taken from
 * `process.cwd()` — the package-level and repo-root vitest invocations have
 * different working directories and a cwd-rooted assertion reads a different
 * tree in each (AGENTS.md, objectui#7791 / objectui#7799).
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the generated legal icon-name list (objectui#9251)', () => {
  it('is REGENERABLE — the committed file is exactly what the generator renders', () => {
    const committed = readFileSync(join(repoRoot, TARGET), 'utf8');
    expect(TARGET).toBe(GENERATED_NAME_LIST_TARGET);
    expect(committed).toBe(renderModule(deriveRecordIconNamePairs(repoRoot)));
  });

  it('is the RECORD vocabulary, key for key — a superset would bless retired spellings', () => {
    // lucide's dynamic surface carries 258 names the record dropped (`edit`,
    // `smile`, `filter`, `alert-triangle`). Taking membership from the wrong
    // one is the defect `check-lucide-icon-record-names.mjs` exists for, and it
    // would be invisible: those names render as components and resolve to
    // nothing as strings.
    const derived = new Set(deriveRecordIconNamePairs(repoRoot).map(([pascal]) => pascal));
    const recordKeys = Object.keys(icons);
    expect(recordKeys.length).toBeGreaterThan(1000);
    expect([...derived].sort()).toEqual([...recordKeys].sort());
  });

  it('does NOT come from `Object.keys(icons)` — nothing on the path imports the record', () => {
    // The probe must be shown to fire. This control is a TEST file, which is
    // allowed to import the record because tests are not bundled into a page.
    expect(importsRecordEntry(repoRoot, RECORD_IMPORT_POSITIVE_CONTROL)).toBe(true);
    expect(RECORD_FREE_MODULES.length).toBeGreaterThan(0);
    for (const file of RECORD_FREE_MODULES) {
      expect(importsRecordEntry(repoRoot, file), file).toBe(false);
    }
    // The generator and the seam are both on that list, named here so a future
    // edit that drops one from `RECORD_FREE_MODULES` fails rather than shrinks
    // the population in silence.
    expect(RECORD_FREE_MODULES).toContain('scripts/regenerate-lucide-record-icon-names.mjs');
    expect(RECORD_FREE_MODULES).toContain('packages/components/src/renderers/action/resolve-icon.ts');
    expect(RECORD_FREE_MODULES).toContain(GENERATED_NAME_LIST_TARGET);
  });

  it('carries the kebab spelling lucide ships, which a conversion rule cannot produce', () => {
    const pairs = new Map(deriveRecordIconNamePairs(repoRoot));
    // The plain cases, so the rows below are not only about the exceptions.
    expect(pairs.get('House')).toBe('house');
    expect(pairs.get('AirVent')).toBe('air-vent');
    // The ones a PascalCase-to-kebab regex gets wrong. Each of these would
    // become `arrow-down01` / `arrow-down10` / `axis3d`, none of which lucide
    // can load — and the failure is an icon that draws nothing, with no error.
    //
    // ⛔ The row here was `Trash2 -> trash-2` until lucide retired that
    // spelling out of the manifest this list is derived from. A row pinned to a
    // name the library can drop fails on an upgrade that broke nothing, so the
    // three below are live names carrying the same digit split.
    expect(pairs.get('ArrowDown01')).toBe('arrow-down-0-1');
    expect(pairs.get('ArrowDown10')).toBe('arrow-down-1-0');
    expect(pairs.get('Axis3d')).toBe('axis-3d');
    const naive = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const diverging = [...pairs].filter(([key, kebab]) => naive(key) !== kebab);
    expect(diverging.length).toBeGreaterThan(50);
  });

  it('is judged by the census gate itself, which reports no findings on this tree', () => {
    expect(judgeGeneratedNameList(repoRoot)).toEqual([]);
  });
});
