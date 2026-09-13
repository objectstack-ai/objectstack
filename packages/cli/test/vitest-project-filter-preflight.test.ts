// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A named path that selects no test file is reported, and a run that loses
 * nothing is byte-identical (#17853).
 *
 * `../vitest-filter-preflight.ts` carries the mechanism, the vitest readings
 * and the reason the reading is taken from a reporter rather than from
 * `process.argv`. What is pinned HERE is the pair of directions the ruling on
 * this card made non-negotiable, plus the wiring, and the three are pinned
 * separately because they fail separately:
 *
 *  1. **LOST IS LOUD.** A filter that selected nothing is returned by
 *     `lostFilters`, attributed to the tier it really lives in, and rendered
 *     into a notice that names the path, that tier and a command that runs it.
 *     ⛔ Asserting only that the notice is non-empty would pass on a notice
 *     that says nothing useful, so each of the three is asserted by name.
 *
 *  2. **HEALTHY IS SILENT — the half that makes this accurate instead of merely
 *     loud.** `renderLostFilterNotice` returns the EMPTY STRING whenever no
 *     filter was lost, and the reporter writes only what that function returns.
 *     Zero bytes is the whole contract: a narrowed run that loses nothing must
 *     read exactly as it read before this module existed.
 *
 *  3. **THE WIRING.** A preflight that nobody registered is a phantom check —
 *     it evaluates never, and deleting it leaves every assertion in this file
 *     just as green. So the config's own source is read, comments masked, and
 *     the registration asserted in CODE position. This is the same instrument
 *     `vitest-tiers-partition.test.ts` uses on the same file for the same
 *     reason.
 *
 * ⚠️ What this file deliberately does NOT do is spawn vitest. An end-to-end
 * pin would have to run vitest inside vitest, which the tier predicate
 * classifies as `integration` (SPAWN) — a permanently expensive file in the
 * tier this very card is not authorised to reshape. The end-to-end reading is
 * taken once, by hand, and recorded in the PR that landed this; case 3 is what
 * keeps the unit-level pins from going phantom in the meantime.
 *
 * Runs in the `unit` tier: pure functions plus one source read, no child
 * process and no kernel.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import {
  lostFilters,
  matchesVitestFilter,
  renderLostFilterNotice,
} from '../vitest-filter-preflight.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');

const UNIT = ['src/utils/format.exit-code.test.ts', 'test/commands.test.ts'];
const INTEGRATION = ['test/i18n-extract-companion-orphan.test.ts'];
const POPULATIONS = { unit: UNIT, integration: INTEGRATION };
const abs = (rel: string): string => resolve(PKG, rel);

describe('direction ① — a filter that selected nothing is reported by name', () => {
  // The exact shape #16872 delivered on: several unit-tier paths that DID
  // match, one integration-tier path that did not, and `--project unit`.
  const collected = UNIT.map(abs);
  const filters = [...UNIT, ...INTEGRATION];
  const lost = lostFilters(filters, collected, POPULATIONS, PKG);

  it('returns exactly the filter that selected nothing', () => {
    expect(lost.map((l) => l.filter)).toEqual(INTEGRATION);
  });

  it('attributes it to the tier it actually lives in', () => {
    expect(lost[0]?.foundIn).toEqual(['integration']);
  });

  it('renders a notice naming the path, its tier and a command that runs it', () => {
    const notice = renderLostFilterNotice(lost, filters.length, ['unit']);
    expect(notice).toContain(INTEGRATION[0]);
    expect(notice).toContain('`integration`');
    expect(notice).toContain(`--project integration ${INTEGRATION[0]}`);
    // The count must describe the caller's command line, not the lost set.
    expect(notice).toContain(`1 of the ${filters.length} path(s)`);
  });

  it('says so even when EVERY filter was lost, and still names the selected project', () => {
    // vitest is already red here, but its own message is generic; this run
    // collected nothing, so a selected-project list inferred from the collected
    // set would wrongly read "every project".
    const allLost = lostFilters(INTEGRATION, [], POPULATIONS, PKG);
    expect(allLost).toHaveLength(1);
    expect(renderLostFilterNotice(allLost, 1, ['unit'])).toContain('this run selected project `unit`');
  });

  it('distinguishes a path that is in no tier at all from one in the other tier', () => {
    const [typo] = lostFilters(['test/no-such-file.test.ts'], collected, POPULATIONS, PKG);
    expect(typo?.foundIn).toEqual([]);
    expect(renderLostFilterNotice([typo!], 1, ['unit'])).toContain('matches no test file in this package');
  });
});

describe('direction ② — a run that loses nothing contributes zero bytes', () => {
  it('finds nothing lost when every named path selected a file', () => {
    expect(lostFilters(UNIT, UNIT.map(abs), POPULATIONS, PKG)).toEqual([]);
  });

  it('renders the EMPTY STRING, which is what keeps the output byte-identical', () => {
    expect(renderLostFilterNotice([], 2, ['unit'])).toBe('');
  });

  it('finds nothing lost when no filter was given at all', () => {
    expect(lostFilters([], [...UNIT, ...INTEGRATION].map(abs), POPULATIONS, PKG)).toEqual([]);
  });

  it('treats a directory-ish prefix spanning both tiers as a legitimate narrowing', () => {
    // `test/` selects files in both tiers; under `--project unit` only the unit
    // ones are collected, and that is the caller asking for exactly that.
    // ⛔ Refusing this would make the gate louder and wrong.
    expect(lostFilters(['test/'], [abs('test/commands.test.ts')], POPULATIONS, PKG)).toEqual([]);
  });
});

describe('the matcher mirrors vitest 4.1.11 `TestProject.filterFiles`', () => {
  it('matches a substring of the project-relative path', () => {
    expect(matchesVitestFilter(abs('test/commands.test.ts'), 'commands', PKG)).toBe(true);
  });

  it('matches case-insensitively, as vitest does', () => {
    expect(matchesVitestFilter(abs('test/commands.test.ts'), 'COMMANDS.TEST', PKG)).toBe(true);
  });

  it('matches an absolute filter by prefix', () => {
    expect(matchesVitestFilter(abs('test/commands.test.ts'), abs('test'), PKG)).toBe(true);
  });

  it('does not match an unrelated path', () => {
    expect(matchesVitestFilter(abs('test/commands.test.ts'), 'i18n-extract', PKG)).toBe(false);
  });
});

describe('the preflight is still registered — ⛔ an unregistered one is a phantom check', () => {
  const config = maskComments(readFileSync(join(PKG, 'vitest.config.ts'), 'utf8'));

  it('imports the preflight in code position', () => {
    expect(config).toContain("from './vitest-filter-preflight.js'");
  });

  it('registers it as a reporter alongside the default one', () => {
    expect(config).toMatch(/reporters:\s*\[\s*'default',\s*tierFilterPreflight\(/);
  });

  it('feeds it the SAME derived arrays the projects use as their `include`', () => {
    // ⛔ A second derivation here would be a copy of a fact already on disk and
    // would go stale exactly where the first one cannot.
    expect(config).toMatch(/populations:\s*\{\s*unit:\s*UNIT_FILES,\s*integration:\s*INTEGRATION_FILES\s*\}/);
  });
});
