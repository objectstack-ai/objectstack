// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17527 — `collectMetadataStats` counted the TOP LEVEL alone, so an ADR-0130
 * D4 / option-B project (every definition inside `packages[]`, none flattened
 * up) was reported as declaring nothing by all three commands that print the
 * summary.
 *
 * Measured through the real binaries on `origin/main` `aaacf1d5`, on the card's
 * own repro:
 *
 * ```
 * os validate            exit 0    Data: 0 Objects
 *                                  ⚠ No objects defined — this stack has no data model
 * os validate --strict   exit 1    ✗ Strict mode: warnings treated as errors
 * os build               exit 0    Data: 0 Objects
 * os info                exit 0    Data: 0 Objects
 * ```
 *
 * The `--strict` exit is what makes it p1 rather than cosmetic: the warning it
 * gates on is `No objects defined — this stack has no data model`, raised by
 * `validate.ts` from `stats.objects === 0`, on a stack that declares a data
 * model. A conforming project could not pass its own validator, and the
 * sentence it died on was false on its face.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * It pins the READER (`collectMetadataStats`), not the three command bodies —
 * the fold lives inside the reader precisely so one seam answers for all three
 * call sites (`commands/validate.ts`, `commands/compile.ts`,
 * `commands/info.ts`), and so the option-B acceptance probe can attach a row to
 * it. `test/option-b-reader-acceptance.pin.test.ts` carries that row and is
 * where a REGRESSION on the full collection zoo goes red; this file is where
 * the union semantics and the refusal envelope are stated.
 *
 * ⚠️ The double-count hazard is the reason the fold reuses
 * `authoringRuleUnionStack` rather than adding a second one. A corrected count
 * that over-counts is the same defect with the opposite sign, and there are two
 * ways to get there: an object reachable from BOTH the top level and a
 * `packages[]` entry, and the same package reached twice. Both are measured
 * below, each against a positive control that proves the assertion can move.
 */

import { describe, expect, it } from 'vitest';

import { collectMetadataStats, type MetadataStats } from './format.js';

/** One object, one field — the smallest thing the summary can count. */
const ORDER = {
  name: 'ob_order',
  label: 'Order',
  sharingModel: 'private',
  fields: { number: { type: 'text', label: 'Number' } },
} as const;

const body = (extra: Record<string, unknown> = {}) => ({
  id: 'com.example.ob',
  name: 'ob',
  version: '1.0.0',
  type: 'app',
  namespace: 'ob',
  ...extra,
});

/** An ADR-0130 D4 package entry: the body under `manifest:`, per D4's reserved slot. */
const pkg = (extra: Record<string, unknown>) => ({ manifest: body(extra) });

/**
 * Every member of {@link MetadataStats} at zero — spelled out so the
 * expectations below are FULL-OBJECT comparisons. A partial assertion
 * (`expect(stats.objects).toBe(1)`) would not notice a fold that reached
 * `objects` and skipped every other member, which is exactly the shape of the
 * defect being fixed.
 */
const ZEROES: MetadataStats = {
  objects: 0,
  objectExtensions: 0,
  fields: 0,
  views: 0,
  pages: 0,
  apps: 0,
  dashboards: 0,
  reports: 0,
  actions: 0,
  flows: 0,
  workflows: 0,
  agents: 0,
  apis: 0,
  positions: 0,
  permissions: 0,
  datasources: 0,
  plugins: 0,
  devPlugins: 0,
};

describe('#17527 — collectMetadataStats counts the stack the author declared, in BOTH ADR-0130 D4 shapes', () => {
  it('the card\'s repro: an option-B stack reports its objects and fields instead of zero', () => {
    const optionB = {
      manifest: body(),
      packages: [
        pkg({
          objects: [
            {
              name: 'ob_order',
              label: 'Order',
              sharingModel: 'private',
              fields: {
                number: { type: 'text', label: 'Number' },
                ghost: { type: 'lookup', label: 'Ghost', reference: 'ob_order' },
              },
            },
          ],
        }),
      ],
    };

    expect(collectMetadataStats(optionB)).toEqual({ ...ZEROES, objects: 1, fields: 2 });
  });

  it('the fold reaches EVERY counted member, not just `objects`', () => {
    // One item in four different package-owned collections. A fold wired for
    // `objects` alone passes the test above and fails this one.
    const optionB = {
      manifest: body(),
      packages: [
        pkg({
          objects: [ORDER],
          apps: [{ name: 'ob_app', label: 'OB', navigation: [] }],
          flows: [{ name: 'ob_flow', label: 'Flow', type: 'autolaunched', nodes: [], edges: [] }],
          agents: [{ name: 'ob_agent', label: 'Agent', role: 'assistant', instructions: 'Answer questions.' }],
        }),
      ],
    };

    expect(collectMetadataStats(optionB)).toEqual({
      ...ZEROES,
      objects: 1,
      fields: 1,
      apps: 1,
      flows: 1,
      agents: 1,
    });
  });

  it('a TOP-LEVEL-ONLY stack answers exactly what it answered before the fold', () => {
    // The control the card carries: `Data: 1 Objects  2 Fields`, one warning.
    // Every stack the platform emits today is this shape, and
    // `authoringRuleUnionStack` returns it by IDENTITY, so this answer is the
    // pre-#17527 answer unchanged.
    const topLevel = {
      manifest: body(),
      objects: [
        {
          name: 'ob_order',
          label: 'Order',
          sharingModel: 'private',
          fields: {
            number: { type: 'text', label: 'Number' },
            ghost: { type: 'lookup', label: 'Ghost', reference: 'ob_order' },
          },
        },
      ],
    };

    expect(collectMetadataStats(topLevel)).toEqual({ ...ZEROES, objects: 1, fields: 2 });
  });

  it('a stack that declares nothing at all still reports zeroes, and does not throw', () => {
    expect(collectMetadataStats({ manifest: body() })).toEqual(ZEROES);
    expect(collectMetadataStats({})).toEqual(ZEROES);
  });

  // ── The double-count controls ────────────────────────────────────────────

  it('UNION, not SUM — an object reachable from BOTH the top level and `packages[]` counts ONCE', () => {
    const both = {
      manifest: body(),
      objects: [ORDER],
      packages: [pkg({ objects: [ORDER] })],
    };

    // The top-level array already IS the union in today's additive shape
    // (`composeStacks` flattened it), which is why the seam lets it win rather
    // than concatenating. Counting 2 here is the defect wearing the other sign.
    expect(collectMetadataStats(both).objects).toBe(1);
    expect(collectMetadataStats(both).fields).toBe(1);
  });

  it('POSITIVE CONTROL for the row above — two DISTINCT packages really do add up', () => {
    // Without this, `toBe(1)` is also satisfied by a fold that silently stopped
    // reading `packages[]` at the first entry. Two packages, two different
    // objects, no top-level key: the answer must be 2.
    const twoPackages = {
      manifest: body(),
      packages: [
        pkg({ id: 'com.example.a', objects: [{ ...ORDER, name: 'a_order' }] }),
        pkg({ id: 'com.example.b', objects: [{ ...ORDER, name: 'b_order' }] }),
      ],
    };

    expect(collectMetadataStats(twoPackages).objects).toBe(2);
    expect(collectMetadataStats(twoPackages).fields).toBe(2);
  });

  it('the same package reached TWICE is REFUSED at the seam, so it cannot double-count', () => {
    const duplicated = {
      manifest: body(),
      packages: [pkg({ objects: [ORDER] }), pkg({ objects: [ORDER] })],
    };

    // ADR-0112 envelope, not a bare throw: `resolveArtifactPackageOrder` is the
    // one gate on artifact package identity and it answers `code` + `status`.
    // Asserting only `toThrow()` would stay green against an unnamed `Error`.
    let thrown: unknown;
    try {
      collectMetadataStats(duplicated);
    } catch (error) {
      thrown = error;
    }

    expect(thrown, 'a duplicate package id must be refused, never silently folded twice')
      .toBeInstanceOf(Error);
    expect((thrown as { code?: string }).code).toBe('DUPLICATE_ARTIFACT_PACKAGE');
    expect((thrown as { status?: number }).status).toBe(422);
  });

  it('a top-level key that is PRESENT wins even when it is empty — the seam\'s rule, unchanged', () => {
    // `objects: []` is the shape that makes "present wins" load-bearing rather
    // than stylistic: re-expressing the rule as "fold whenever the top level is
    // empty" would union an array that already is the union. Pinned here so a
    // later edit cannot quietly change the fold's precedence while every other
    // row above stays green.
    const emptyTopLevel = {
      manifest: body(),
      objects: [],
      packages: [pkg({ objects: [ORDER] })],
    };

    expect(collectMetadataStats(emptyTopLevel).objects).toBe(0);
  });
});
