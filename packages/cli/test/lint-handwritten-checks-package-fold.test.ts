// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17528 — `os lint`'s HAND-WRITTEN checks and `scoreMetadata` judge the stack
 * the author declared, in either ADR-0130 D4 shape.
 *
 * ## The defect
 *
 * `lintConfig` runs two families: the shared author-time rule registry (#4409)
 * and `os lint`'s own rubric — naming, labels, structure, the intra-package
 * duplicate advisory, hook-body lowering, the data-model conventions. #17069
 * taught the REGISTRY call inside that function to resolve `packages[]` and
 * scoped itself the way `compile.ts` scopes it, writing down exactly what it
 * left: "the hand-written checks above and `scoreMetadata` … keep reading the
 * caller's own stack".
 *
 * Under option B every definition lives in `packages[]` and the top level
 * carries none, so the family that was left behind read an EMPTY stack. Driven
 * through the real binary on the card's own repro — one object, authored two
 * ways, byte-identical metadata:
 *
 *     packages[]   os lint   exit 0   ✓ All checks passed
 *     top level    os lint   exit 0   ⚠ convention/label-case    at objects[0].label
 *                                     ℹ object/missing-name-field at objects[0].fields
 *
 * `scoreMetadata` reaches the same function, so the same project's
 * metadata-quality rubric was computed over nothing and published `100/100 (A)`
 * — the #15658 shape ("the linter found nothing" and "the linter never ran"
 * collapsed into the better-looking one), arriving through the INPUT this time
 * rather than through a swallowed crash.
 *
 * ## What this file pins, and why PARITY rather than presence
 *
 * A test asserting only "a finding appears on the option-B shape" would stay
 * green against a fold that reached one check and missed four. So the assertion
 * is that the two shapes return the SAME findings — every field of every issue,
 * in order — for metadata that differs only in where it is declared. Three
 * shapes are compared, not two, because the third is the one that can regress
 * silently: today's ADDITIVE artifact carries each definition twice (flattened
 * AND inside `packages[]`), and a fold that unioned instead of resolving would
 * report every finding twice on it while both other shapes stayed correct.
 *
 * `NAMED_HAND_WRITTEN_COVERAGE` below is the anti-vacuity half: the parity
 * assertion is satisfied by two EMPTY lists, so the rules it covers are named
 * and counted. Adding a check to `lintConfig` that this fixture does not
 * provoke is not a failure here; deleting one it does provoke is.
 *
 * ## Two limits of this instrument, stated rather than implied
 *
 * 1. **The fixture must be SCHEMA-VALID.** `authoringRuleUnionStack` resolves
 *    package order through `resolveArtifactPackageOrder`, whose ADR-0112
 *    refusals are deliberately not swallowed — so a `packages[]` stack whose
 *    package body does not parse throws `INVALID_ARTIFACT_PACKAGE_ENTRY` before
 *    any rule runs. (It already did: `lintConfig` has called that seam for the
 *    registry tier since #17069, so this is not new behaviour.) That is why the
 *    defects below are lint-level only.
 * 2. Consequently `naming/snake-case` and `structure/no-fields` are NOT covered:
 *    every carrier they fire on (a non-snake_case machine name, an object with
 *    no `fields` at all) is refused by the schema first, so no option-B stack
 *    can reach them. They read the same `stack.<collection>` locals every
 *    covered rule reads.
 */

import { describe, expect, it } from 'vitest';

import { lintConfig } from '../src/commands/lint';
import { scoreMetadata } from '../src/lint/score';
import { lowerCallables } from '../src/utils/lower-callables';
import { authoringRuleUnionStack } from '../src/utils/stack-collections';

// ─── One set of definitions, three shapes ───────────────────────────────────

const MANIFEST = {
  id: 'com.example.probe',
  name: 'probe',
  version: '1.0.0',
  type: 'app',
  namespace: 'probe',
  engines: { protocol: '^17' },
};

/** A module-scope binding, so the hook handler below cannot be lowered. */
const OUTER_BINDING = 7;

/**
 * The declarations, lint-dirty and schema-valid, provoking one member of each
 * hand-written read site this fixture can reach. Rebuilt per call so no shape
 * shares a mutable object with another.
 */
const definitions = () => ({
  objects: [
    {
      name: 'probe_order',
      label: 'order', // convention/label-case + object/missing-name-field
      sharingModel: 'private',
      fields: { number: { type: 'text', label: 'number' } }, // convention/label-case
    },
    {
      name: 'probe_line', // required/label + structure/empty-fields
      sharingModel: 'private',
      fields: {},
    },
  ],
  views: [
    {
      name: 'probe_view',
      object: 'probe_order',
      list: { label: 'order list', columns: ['number'] }, // convention/label-case
    },
  ],
  apps: [
    { name: 'probe_app', label: 'shell' }, // convention/label-case
    { name: 'probe_app', label: 'Shell Again' }, // naming/namespace-prefix
  ],
  flows: [
    { name: 'probe_flow', label: 'Probe Flow', type: 'autolaunched', nodes: [], edges: [] },
    { name: 'probe_flow', label: 'Probe Flow Again', type: 'autolaunched', nodes: [], edges: [] },
  ], // naming/namespace-prefix on a SECOND collection key
  agents: [
    { name: 'probe_agent', label: 'Probe Agent', role: 'assistant', instructions: 'Be helpful.' },
  ],
  hooks: [
    {
      name: 'probe_hook',
      label: 'Probe Hook',
      object: 'probe_order',
      events: ['beforeInsert'],
      handler: () => OUTER_BINDING, // hook-body/not-lowerable
    },
  ],
});

/** The shape every single-package project has today. */
const topLevelShape = () => ({ manifest: { ...MANIFEST }, ...definitions() });

/** ADR-0130 D4 / option B: `packages[]` carries the definitions, exactly once. */
const packagesShape = () => ({
  manifest: { ...MANIFEST },
  packages: [{ manifest: { ...MANIFEST, ...definitions() } }],
});

/** Today's emitted multi-package artifact: flattened top level AND `packages[]`. */
const additiveShape = () => ({
  manifest: { ...MANIFEST },
  ...definitions(),
  packages: [{ manifest: { ...MANIFEST, ...definitions() } }],
});

/**
 * The hand-written checks this fixture provokes, and how many findings each
 * one owes. ⛔ Never relax a count to make a run green — a count that fell is a
 * check that stopped reading the declared stack, which is the whole defect.
 */
const NAMED_HAND_WRITTEN_COVERAGE: ReadonlyArray<readonly [rule: string, count: number]> = [
  // `stack.objects` (object label, field label), `stack.views`, `stack.apps`
  ['convention/label-case', 4],
  // `stack.objects` — a declared object with no label at all
  ['required/label', 1],
  // `stack.objects[i].fields`
  ['structure/empty-fields', 1],
  // the PREFIXED_TYPES loop's `stack[key]`, on TWO different keys
  ['naming/namespace-prefix', 2],
  // `checkHookBodyLowering(stack)` — `stack.hooks`
  ['hook-body/not-lowerable', 1],
  // `lintDataModel(objects)`, fed from the same `stack.objects` local
  ['object/missing-name-field', 1],
];

const ruleCounts = (issues: ReadonlyArray<{ rule: string }>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.rule, (counts.get(issue.rule) ?? 0) + 1);
  return counts;
};

describe('#17528 — os lint judges the stack the author declared, in either ADR-0130 D4 shape', () => {
  it('THE PARITY — the same metadata reports the same findings wherever it is declared', () => {
    const fromTopLevel = lintConfig(topLevelShape());
    const fromPackages = lintConfig(packagesShape());

    expect(
      fromPackages,
      `The two shapes declare byte-identical metadata and must be judged identically. ` +
        `top-level reported ${fromTopLevel.length} finding(s), packages[] reported ` +
        `${fromPackages.length}:\n` +
        `  top-level: ${fromTopLevel.map((i) => `${i.rule}@${i.path}`).join(', ')}\n` +
        `  packages[]: ${fromPackages.map((i) => `${i.rule}@${i.path}`).join(', ')}`,
    ).toEqual(fromTopLevel);
  });

  it('ANTI-VACUITY — the parity covers NAMED checks, not "a finding appeared"', () => {
    // Two empty lists satisfy the assertion above, and so does a fold that
    // reached one check and missed four. This is what makes the parity a
    // measurement of the family rather than of one rule.
    const counts = ruleCounts(lintConfig(packagesShape()));
    for (const [rule, expected] of NAMED_HAND_WRITTEN_COVERAGE) {
      expect(
        counts.get(rule) ?? 0,
        `The hand-written check \`${rule}\` reported ${counts.get(rule) ?? 0} finding(s) on the ` +
          `packages[]-only shape, not the ${expected} it owes. A check that stopped reading the ` +
          `declared stack is exactly the defect #17528 removed — fix the read, not this number.`,
      ).toBe(expected);
    }
  });

  it('NO DOUBLE COUNT — today\'s additive artifact is judged once, not twice', () => {
    // `authoringRuleUnionStack` is present-wins: a key the top level carries
    // WINS, because in the additive shape that array already IS the union. A
    // fold that concatenated instead would double every finding here while both
    // other shapes stayed correct.
    const fromAdditive = lintConfig(additiveShape());
    expect(fromAdditive).toEqual(lintConfig(topLevelShape()));
  });

  it('IDENTITY — the fold never mutates the caller\'s stack', () => {
    // The seam returns a fresh object when it fills a key and the caller's own
    // object when it does not; either way the input must come back untouched,
    // because `os lint` goes on to hand the same `normalized` object to the docs
    // linter, the i18n coverage reader and `scoreMetadata`.
    const stack = packagesShape();
    const before = JSON.stringify(stack, (_k, v) => (typeof v === 'function' ? '[fn]' : v));
    lintConfig(stack);
    expect(JSON.stringify(stack, (_k, v) => (typeof v === 'function' ? '[fn]' : v))).toBe(before);
    expect(Object.keys(stack).sort()).toEqual(['manifest', 'packages']);
  });

  it('THE SCORER — `scoreMetadata` grades both shapes the same, and stops publishing a number it did not earn', () => {
    const fromTopLevel = scoreMetadata(topLevelShape());
    const fromPackages = scoreMetadata(packagesShape());

    expect(fromPackages.schemaErrors, 'the fixture must be schema-valid in both shapes').toEqual([]);
    expect(fromTopLevel.schemaErrors).toEqual([]);
    expect(fromPackages.lintError, 'the lint half must have RUN, not crashed').toBeUndefined();

    expect(fromPackages.score).toBe(fromTopLevel.score);
    expect(fromPackages.grade).toBe(fromTopLevel.grade);
    expect(fromPackages.counts).toEqual(fromTopLevel.counts);
    expect(fromPackages.issues).toEqual(fromTopLevel.issues);

    // The defect's own signature: a rubric computed over an empty stack scores
    // the project PERFECT. Naming the direction keeps the assertion above from
    // being satisfied by two equally-blind runs.
    expect(
      fromPackages.score,
      'a packages[]-only project with six lint defects must not score 100',
    ).toBeLessThan(100);
    expect(fromPackages.counts.warnings).toBeGreaterThan(0);
  });

  it('THE CHAIN — `lowerCallables` carries the folded collections through, so the `parsed` tier really is folded', () => {
    // `lintConfig` folds ONCE, at its entry, and then hands the rule registry
    // `normalized: stack` and `parsed: lowered`, where `lowered` is
    // `lowerCallables(stack)`. Dropping the second `authoringRuleUnionStack(…)`
    // call that used to wrap `parsed` rests on a claim — that `lowerCallables`
    // shallow-clones the top level it is handed, so the folded collections
    // survive it — and `test/validate-build-gate-parity.test.ts`'s resolver now
    // trusts that claim when it follows the binding chain. A claim a guard
    // trusts belongs in a test, not only in a comment. This is that test.
    const stack = authoringRuleUnionStack(packagesShape() as unknown as Record<string, unknown>);
    const { lowered } = lowerCallables(stack);

    for (const key of ['objects', 'views', 'apps', 'flows', 'agents', 'hooks']) {
      const folded = (stack as Record<string, unknown>)[key];
      expect(Array.isArray(folded), `the fold did not fill \`${key}\` — the fixture moved`).toBe(true);
      expect(
        ((lowered as Record<string, unknown>)[key] as unknown[] | undefined)?.length,
        `lowerCallables dropped or truncated \`${key}\`, so the \`parsed\` tier would be judged ` +
          `over less than the author declared.`,
      ).toBe((folded as unknown[]).length);
    }

    // …and re-folding the lowered stack is a no-op BY IDENTITY, which is why
    // the second call was removed rather than kept as a cheap insurance policy:
    // a call that can only ever return its argument is not insurance, it is a
    // spelling a guard can be satisfied by while the surrounding code rots.
    expect(authoringRuleUnionStack(lowered)).toBe(lowered);
  });

  it("THE CARD'S REPRO — one object, authored two ways, judged the same", () => {
    // The minimal repro from #17528, verbatim: today one shape reported nothing
    // and the other reported two findings.
    const object = () => ({
      name: 'ob_order',
      label: 'order',
      sharingModel: 'private',
      fields: { number: { type: 'text', label: 'Number' } },
    });
    const manifest = {
      id: 'com.example.ob', name: 'ob', version: '1.0.0', type: 'app', namespace: 'ob',
      engines: { protocol: '^17' },
    };

    const fromPackages = lintConfig({
      manifest: { ...manifest },
      packages: [{ manifest: { ...manifest, objects: [object()] } }],
    });
    const fromTopLevel = lintConfig({ manifest: { ...manifest }, objects: [object()] });

    expect(fromPackages).toEqual(fromTopLevel);
    expect(fromPackages.map((i) => `${i.rule} at ${i.path}`)).toEqual([
      'convention/label-case at objects[0].label',
      'object/missing-name-field at objects[0].fields',
    ]);
  });
});
