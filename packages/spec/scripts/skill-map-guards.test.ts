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

import { checkCoreEntryShape, type SkillCoreMap } from './lib/skill-map-guards';

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
});
