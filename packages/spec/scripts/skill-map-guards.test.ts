// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Negative tests for the `SKILL_MAP` guards in `lib/skill-map-guards.ts`.
 *
 * Each guard exists because a shipped skill index was found wrong by a human
 * reading it, and `check:skill-refs` was green the whole time: that gate
 * compares the artifact against the generator, so a wrong map produces a
 * faithful artifact and a green verdict. The guards ask their question of the
 * MAP instead, and these tests assert they REFUSE — a guard that only ever
 * returns an empty array is the failure mode a positive-only test cannot see.
 *
 * Two legs, failing differently, as `query-pointer-row.test.ts` does one layer
 * up:
 *
 *  - the BEHAVIOUR leg drives each guard over fabricated maps: one that must
 *    be refused, and one that must pass, so neither an always-green nor an
 *    always-red guard survives;
 *  - the WIRING leg reads `build-skill-references.ts` and asserts each guard is
 *    actually called there. A guard nobody calls is green in this file and
 *    absent from the gate, which is exactly the state the map was already in.
 *
 * The live corpus is deliberately NOT re-asserted here: `check:skill-refs` runs
 * the real generator over the real map on every CI run, and it fails on any
 * problem these guards report. Restating that in vitest would buy a second
 * spelling of one fact, not a second fact.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SHARED_CORE_SCHEMAS,
  TRANSITIVE_ALLOWLIST,
  checkCoreEntryShape,
  checkSingleOwner,
  checkTransitiveAllowlist,
  stripInternalIssueIds,
  type SkillCoreMap,
} from './lib/skill-map-guards';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const GENERATOR = path.resolve(HERE, 'build-skill-references.ts');

describe('checkCoreEntryShape — a core entry that emits no row is refused', () => {
  it('refuses a non-.zod.ts core entry', () => {
    const map: SkillCoreMap = {
      'objectstack-demo': ['data/field.zod.ts', 'contracts/plugin-lifecycle-events.ts'],
    };
    const problems = checkCoreEntryShape(map);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('contracts/plugin-lifecycle-events.ts');
    expect(problems[0]).toContain('objectstack-demo');
  });

  it('passes a map whose entries are all schema paths', () => {
    // Without this leg a guard that returned a problem for every entry would
    // satisfy the refusal test above and break every real run.
    expect(checkCoreEntryShape({ 'objectstack-demo': ['data/field.zod.ts'] })).toEqual([]);
  });

  it('names every offending entry, not just the first', () => {
    const problems = checkCoreEntryShape({
      a: ['x.ts'],
      b: ['data/field.zod.ts', 'y.md'],
    });
    expect(problems).toHaveLength(2);
  });
});

describe('checkSingleOwner — one schema file, one owning package', () => {
  const twoOwners: SkillCoreMap = {
    'objectstack-query': ['data/query.zod.ts', 'data/date-macros.zod.ts'],
    'objectstack-formula': ['shared/expression.zod.ts', 'data/date-macros.zod.ts'],
  };

  it('refuses an undeclared duplicate and names both packages', () => {
    const problems = checkSingleOwner(twoOwners, {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('data/date-macros.zod.ts');
    expect(problems[0]).toContain('objectstack-query');
    expect(problems[0]).toContain('objectstack-formula');
  });

  it('accepts the same duplicate once it is declared with a reason', () => {
    expect(checkSingleOwner(twoOwners, { 'data/date-macros.zod.ts': 'because …' })).toEqual([]);
  });

  it('refuses a declaration with no reason — that is an allowlist, not a ledger', () => {
    const problems = checkSingleOwner(twoOwners, { 'data/date-macros.zod.ts': '   ' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('empty reason');
  });

  it('refuses a declaration whose sharing is gone, so the ledger cannot rot', () => {
    const oneOwner: SkillCoreMap = { 'objectstack-query': ['data/date-macros.zod.ts'] };
    const problems = checkSingleOwner(oneOwner, { 'data/date-macros.zod.ts': 'because …' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Delete the declaration');
  });

  it('passes a map with no duplicates and no declarations', () => {
    // The always-red twin of the always-green failure the refusal tests catch.
    expect(
      checkSingleOwner({ a: ['data/field.zod.ts'], b: ['data/object.zod.ts'] }, {}),
    ).toEqual([]);
  });

  it('every shipped declaration carries a real reason', () => {
    // The ledger is read by a human deciding whether a second owner is right.
    // A row that said only "allowed" would pass the guard and teach nothing.
    for (const [file, reason] of Object.entries(SHARED_CORE_SCHEMAS)) {
      expect(reason.trim().length, `${file} has no reason`).toBeGreaterThan(40);
    }
  });
});

describe('checkTransitiveAllowlist — a constraint that constrains nothing is refused', () => {
  const map: SkillCoreMap = { 'objectstack-i18n': ['system/translation.zod.ts'] };
  const closures = {
    'objectstack-i18n': ['system/translation.zod.ts', 'shared/identifiers.zod.ts'],
  };

  it('accepts a list naming a file the closure really reaches', () => {
    expect(
      checkTransitiveAllowlist(map, { 'objectstack-i18n': ['shared/identifiers.zod.ts'] }, closures),
    ).toEqual([]);
  });

  it('accepts an empty list — publishing no transitive pointer is a real answer', () => {
    expect(checkTransitiveAllowlist(map, { 'objectstack-i18n': [] }, closures)).toEqual([]);
  });

  it('refuses a package name that is not in the map', () => {
    // The failure this exists for: a typo leaves the over-eager closure fully
    // published while the map LOOKS constrained.
    const problems = checkTransitiveAllowlist(map, { 'objectstack-i18nn': [] }, closures);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not a SKILL_MAP package');
  });

  it('refuses a file the closure never reaches', () => {
    const problems = checkTransitiveAllowlist(
      map,
      { 'objectstack-i18n': ['data/query.zod.ts'] },
      closures,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('does not exist');
  });

  it('refuses a file that is already a core entry', () => {
    const problems = checkTransitiveAllowlist(
      map,
      { 'objectstack-i18n': ['system/translation.zod.ts'] },
      closures,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('already a core entry');
  });

  it('refuses a file listed twice', () => {
    const problems = checkTransitiveAllowlist(
      map,
      { 'objectstack-i18n': ['shared/identifiers.zod.ts', 'shared/identifiers.zod.ts'] },
      closures,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('listed twice');
  });

  it('every shipped list names a package the map has', () => {
    // The one fact about the real list this file can assert without re-running
    // the generator; reachability of each row is `check:skill-refs`'s job,
    // because only it has the closure.
    for (const skillName of Object.keys(TRANSITIVE_ALLOWLIST)) {
      expect(skillName).toMatch(/^objectstack-/);
    }
  });
});

describe('stripInternalIssueIds — the catalog carries no tracker ids', () => {
  it('drops a trailing citation and the parenthesis it sat in', () => {
    expect(
      stripInternalIssueIds('Config contracts for the flat IO builtins — `notify` and `http` (#4045).'),
    ).toBe('Config contracts for the flat IO builtins — `notify` and `http`.');
  });

  it('drops the owner/repo spelling whole', () => {
    expect(stripInternalIssueIds('removed in objectstack-ai/objectstack#4286 — use the rule'))
      .toBe('removed in — use the rule');
  });

  it('drops a mid-sentence id and leaves one space behind', () => {
    expect(stripInternalIssueIds('Metadata Protection Model — Phase 1 (#1234) and later'))
      .toBe('Metadata Protection Model — Phase 1 and later');
  });

  // The other half of the criterion: what must survive. Each of these is a
  // shape `check:doc-authoring` explicitly allows, so stripping it here would
  // silently rewrite prose the gate never objected to.
  it.each([
    ['the #1 authoring mistake', 'an ordinal is one digit, below the floor'],
    ['colour #ff00aa is the accent', 'a hex colour starts with no digit'],
    ['id #123456789 is not a tracker id', 'nine digits is above the ceiling'],
    ['HTTP 404 is not a citation', 'no # at all'],
    ['array##4045 is not a citation', 'a doubled # is excluded by the lookbehind'],
  ])('leaves %j alone (%s)', (text) => {
    expect(stripInternalIssueIds(text)).toBe(text);
  });
});

describe('the generator wires the guards in', () => {
  const source = (): string => fs.readFileSync(GENERATOR, 'utf-8');

  it('reads the generator at all', () => {
    // Nothing read means nothing asserted, and "no missing call" would read as
    // green — the failure mode a source-text pin actually has.
    expect(source().length).toBeGreaterThan(1000);
  });

  it('calls checkCoreEntryShape on SKILL_MAP', () => {
    expect(source()).toContain('checkCoreEntryShape(SKILL_MAP)');
  });

  it('calls checkSingleOwner on SKILL_MAP and the declared ledger', () => {
    expect(source()).toContain('checkSingleOwner(SKILL_MAP, SHARED_CORE_SCHEMAS)');
  });

  it('calls checkTransitiveAllowlist, and filters the emitted set by the list', () => {
    // Both halves matter: the guard alone would validate a list the emit path
    // never reads, which is the shape of a constraint that constrains nothing.
    expect(source()).toContain('checkTransitiveAllowlist(SKILL_MAP, TRANSITIVE_ALLOWLIST, closures)');
    expect(source()).toContain('allowed.includes(f)');
  });

  it('strips internal ids on the description path, not somewhere unreachable', () => {
    expect(source()).toContain('stripInternalIssueIds(clean.split');
    expect(source()).toContain('stripInternalIssueIds(exportListDescription(content)');
  });
});
