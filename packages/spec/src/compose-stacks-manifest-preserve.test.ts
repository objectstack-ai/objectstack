// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 follow-up row 3 — `composeStacks`' `manifest: 'preserve'` mode.
 *
 * ## What the mode is for
 *
 * `manifest: 'first' | 'last' | <index>` is a deliberate **pick-one**:
 * composition keeps one manifest and the other N−1 package identities are gone
 * from the output. ADR-0130 needs the other case — a release artifact that
 * **carries** N packages, each keeping its own identity, so a product splits
 * into modules **without renaming a single object** (the object `name` IS the
 * table name, the REST path, the formula token and the saved-view key —
 * ADR-0129 D1–D2).
 *
 * `'preserve'` folds every input's package identity into `packages` (ADR-0130
 * D4) instead of discarding all but one.
 *
 * ## The two halves this file pins, and why BOTH are load-bearing
 *
 * 1. **The default did not move.** ADR-0130's compatibility claim is that
 *    existing callers are unaffected, and the mode is opt-in. A pin that only
 *    demonstrated the new value would leave "and nothing else changed" as a
 *    reviewer's reading of a diff rather than a machine criterion — the exact
 *    substitution ADR-0130 D7 refuses ("Reviewer attention is not a
 *    mechanism"). So `'first'`, `'last'` and the index strategies are pinned
 *    here against their OUTPUT — including the negative half: none of them
 *    mints a `packages` key.
 * 2. **Preserve's output is the artifact schema's shape.** Every emitted
 *    element is the `{ manifest: … }` wrapper object, asserted by feeding the
 *    composed result to the schemas themselves — `ArtifactPackageEntrySchema`
 *    per entry and `ObjectStackDefinitionSchema` over the whole artifact —
 *    rather than by eyeballing a literal. The wrapper is the structural
 *    position D4 reserves so a future `{ ref, integrity }` external segment is
 *    an ADDITIVE key rather than a reshape; a pin that accepted a flat inlined
 *    manifest body would be a pin that lets the next author spend that
 *    position without noticing.
 *
 * ⛔ Still NOT implemented, and not asserted here: the load path that iterates
 * `packages` (D5, its own card) and the `installPackage` co-ownership gate
 * (D1/D3, its own card). A green run of this file means a composed artifact
 * CARRIES N package identities — not that a multi-package artifact installs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  ArtifactPackageEntrySchema,
  ObjectStackDefinitionSchema,
  ComposeStacksOptionsSchema,
  composeStacks,
  defineStack,
  type ObjectStackDefinition,
} from './stack.zod';

// ─── Fixtures ───────────────────────────────────────────────────────

const crmManifest = {
  id: 'com.example.crm',
  name: 'crm',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'crm',
  dependencies: { automation: '^1.0.0' },
};

const cpqManifest = {
  id: 'com.example.crm.cpq',
  name: 'cpq',
  version: '1.0.0',
  type: 'module' as const,
  namespace: 'crm',
  dependencies: { 'com.example.crm': '^1.0.0' },
};

const billingManifest = {
  id: 'com.example.crm.billing',
  name: 'billing',
  version: '1.0.0',
  type: 'module' as const,
  namespace: 'crm',
};

/** `strict: false` so a hand-built stack shape reaches composition as written. */
const raw = (o: Record<string, unknown>): ObjectStackDefinition =>
  defineStack(o as never, { strict: false });

const packagesOf = (composed: ObjectStackDefinition): unknown[] | undefined =>
  (composed as unknown as { packages?: unknown[] }).packages;

const idsOf = (composed: ObjectStackDefinition): (string | undefined)[] =>
  ((packagesOf(composed) ?? []) as { manifest?: { id?: string } }[]).map((e) => e.manifest?.id);

// ─── Half 1 — the existing pick-one strategies are bit-unchanged ────

describe("ADR-0130 row 3 — today's pick-one strategies do not move", () => {
  const stacks = () => [
    raw({ manifest: crmManifest }),
    raw({ manifest: cpqManifest }),
    raw({ manifest: billingManifest }),
  ];

  it("`'last'` (the default) keeps the last manifest and mints no `packages`", () => {
    const explicit = composeStacks(stacks(), { manifest: 'last' });
    const byDefault = composeStacks(stacks());

    expect(explicit.manifest?.id).toBe('com.example.crm.billing');
    expect(packagesOf(explicit)).toBeUndefined();
    // The default IS `'last'` — pinned as an equality, not as two assertions
    // that happen to agree today.
    expect(byDefault).toEqual(explicit);
  });

  it("`'first'` keeps the first manifest and mints no `packages`", () => {
    const composed = composeStacks(stacks(), { manifest: 'first' });

    expect(composed.manifest?.id).toBe('com.example.crm');
    expect(packagesOf(composed)).toBeUndefined();
  });

  it('an index keeps that stack\'s manifest and mints no `packages`', () => {
    const composed = composeStacks(stacks(), { manifest: 1 });

    expect(composed.manifest?.id).toBe('com.example.crm.cpq');
    expect(packagesOf(composed)).toBeUndefined();
  });

  it('the option schema still defaults to `last`', () => {
    // The widening added a value; it must not have moved the default, which is
    // the whole of ADR-0130's "existing callers are unaffected" for this card.
    expect(ComposeStacksOptionsSchema.parse({}).manifest).toBe('last');
  });

  it('rejects a manifest strategy that is neither a known value nor an index', () => {
    // The accept set widened by exactly one value. Asserting the refusal of a
    // neighbouring spelling is what makes that a measurement rather than a
    // claim — `unrecognized` must not have become acceptable alongside
    // `preserve`.
    const result = ComposeStacksOptionsSchema.safeParse({ manifest: 'preserve-all' });

    expect(result.success).toBe(false);
    expect(ComposeStacksOptionsSchema.safeParse({ manifest: 'preserve' }).success).toBe(true);
    expect(ComposeStacksOptionsSchema.safeParse({ manifest: -1 }).success).toBe(false);
  });
});

// ─── Half 2 — preserve keeps every package identity ─────────────────

describe("ADR-0130 row 3 — `manifest: 'preserve'` keeps all N identities", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('folds N single-`manifest` stacks into `packages`, in stack order', () => {
    const composed = composeStacks(
      [raw({ manifest: crmManifest }), raw({ manifest: cpqManifest }), raw({ manifest: billingManifest })],
      { manifest: 'preserve' },
    );

    expect(idsOf(composed)).toEqual([
      'com.example.crm',
      'com.example.crm.cpq',
      'com.example.crm.billing',
    ]);
  });

  it('keeps each package\'s identity READABLE — id, namespace and dependencies', () => {
    // The card's acceptance criterion is not "N elements exist" but "N package
    // identities are completely readable", so it is asserted field by field on
    // the sub-package, not by counting.
    const composed = composeStacks([raw({ manifest: crmManifest }), raw({ manifest: cpqManifest })], {
      manifest: 'preserve',
    });
    const entries = packagesOf(composed) as { manifest: Record<string, unknown> }[];

    expect(entries[1].manifest).toMatchObject({
      id: 'com.example.crm.cpq',
      name: 'cpq',
      version: '1.0.0',
      type: 'module',
      namespace: 'crm',
      dependencies: { 'com.example.crm': '^1.0.0' },
    });
    // ADR-0130 D5 sorts by declared dependencies (ADR-0116's one sorter). The
    // input to that sort is this field surviving composition — a preserve mode
    // that dropped it would leave the ordering card nothing to sort by.
    expect(entries[0].manifest.dependencies).toEqual({ automation: '^1.0.0' });
  });

  it('emits the `{ manifest: … }` wrapper — judged by the schema, not by a literal', () => {
    // ⛔ The wrapper shape is NOT re-derived here. `ArtifactPackageEntrySchema`
    // is the single declaration (ADR-0116 drift), and it refuses a flat
    // inlined manifest body — which is exactly the mistake this asserts the
    // composer did not make.
    const composed = composeStacks([raw({ manifest: crmManifest }), raw({ manifest: cpqManifest })], {
      manifest: 'preserve',
    });

    // The count first, deliberately: a `for` over an absent list is vacuously
    // green, so without this line the pin would pass on an implementation where
    // preserve does nothing at all. (It did — measured in this card's ablation
    // leg, which is how the line got here.)
    const entries = packagesOf(composed);
    expect(entries).toHaveLength(2);
    for (const entry of entries ?? []) {
      expect(ArtifactPackageEntrySchema.safeParse(entry).success).toBe(true);
    }
    // The negative half: an entry that WERE the flat body would not parse.
    expect(ArtifactPackageEntrySchema.safeParse(crmManifest).success).toBe(false);
  });

  it('produces an artifact the artifact schema accepts', () => {
    const composed = composeStacks([raw({ manifest: crmManifest }), raw({ manifest: cpqManifest })], {
      manifest: 'preserve',
    });

    const result = ObjectStackDefinitionSchema.safeParse(composed);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.packages?.map((p) => p.manifest.id)).toEqual([
      'com.example.crm',
      'com.example.crm.cpq',
    ]);
  });

  it('is ADDITIVE — the singular `manifest` is still selected, by the default rule', () => {
    // Preserve does not delete a key every previous output carried. The
    // artifact keeps an artifact-level identity (D6 — one artifact, one
    // version), and D4's read-both rule means nothing is registered twice: a
    // `packages`-carrying artifact is read through `packages`, and `manifest`
    // is the fallback branch for artifacts that have none.
    const stacks = [raw({ manifest: crmManifest }), raw({ manifest: cpqManifest })];
    const preserved = composeStacks(stacks, { manifest: 'preserve' });
    const byDefault = composeStacks(stacks);

    // "Additive" is only a claim if something was added: assert the addition
    // before asserting that nothing else moved — otherwise this pin is green on
    // an implementation that adds nothing (measured in the ablation leg).
    expect(idsOf(preserved)).toEqual(['com.example.crm', 'com.example.crm.cpq']);
    expect(preserved.manifest?.id).toBe('com.example.crm.cpq');
    expect(preserved.manifest).toEqual(byDefault.manifest);
    // Stated as the whole-object relation, so "additive" is a machine
    // criterion: preserve's output is the default's output plus `packages`.
    expect({ ...preserved, packages: undefined }).toEqual({ ...byDefault, packages: undefined });
  });

  it("applies D4's read-both rule per input — a stack carrying `packages` contributes those", () => {
    // A stack that declares BOTH must not contribute its manifest twice. The
    // rule is the same one the load path applies to an artifact, applied to
    // each composition input — not a second rule, and not a de-duplication
    // pass bolted on afterwards.
    const composed = composeStacks(
      [
        raw({ manifest: crmManifest, packages: [{ manifest: crmManifest }, { manifest: cpqManifest }] }),
        raw({ manifest: billingManifest }),
      ],
      { manifest: 'preserve' },
    );

    expect(idsOf(composed)).toEqual([
      'com.example.crm',
      'com.example.crm.cpq',
      'com.example.crm.billing',
    ]);
  });

  it('agrees with the declared `concat` disposition when every stack carries `packages`', () => {
    // `packages` has a declared COMPOSE_KEY_DISPOSITIONS rule of `'concat'`.
    // Preserve must not quietly mean something else for the same key: where
    // concat has entries to work with, both produce the same list.
    const stacks = [
      raw({ manifest: crmManifest, packages: [{ manifest: crmManifest }] }),
      raw({ manifest: cpqManifest, packages: [{ manifest: cpqManifest }] }),
    ];

    expect(idsOf(composeStacks(stacks, { manifest: 'preserve' }))).toEqual(
      idsOf(composeStacks(stacks)),
    );
  });

  it('leaves `packages` absent when there is nothing to preserve', () => {
    // Not `[]`. Composing manifest-less stacks must not mint a key where today
    // there is none — an empty `packages` would read downstream as "an
    // artifact carrying zero packages", which is a different claim from "an
    // artifact that does not use the multi-package shape".
    const composed = composeStacks([raw({ apps: [] }), raw({ apps: [] })], { manifest: 'preserve' });

    expect(packagesOf(composed)).toBeUndefined();
    expect(composed.manifest).toBeUndefined();
  });

  it('skips a manifest-less stack rather than emitting a hole', () => {
    const composed = composeStacks(
      [raw({ manifest: crmManifest }), raw({ apps: [] }), raw({ manifest: cpqManifest })],
      { manifest: 'preserve' },
    );

    expect(idsOf(composed)).toEqual(['com.example.crm', 'com.example.crm.cpq']);
  });

  it('does not warn about an undeclared composition rule (#5005 rule 3)', () => {
    composeStacks([raw({ manifest: crmManifest }), raw({ manifest: cpqManifest })], {
      manifest: 'preserve',
    });

    const warnings: string[] = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warnings.some((w: string) => w.includes("'packages'"))).toBe(false);
  });

  it('short-circuits on a single stack, exactly as every other strategy does', () => {
    // `composeStacks` returns a lone stack unchanged before options are even
    // parsed. No identity is lost by that: an artifact with a singular
    // `manifest` and no `packages` IS "one package" — it is D4's read-both
    // branch 2, the same rule preserve applies to every other input. Pinned so
    // nobody "fixes" preserve into rewriting a single stack's shape (which
    // would also mean mutating the caller's own object, since this path returns
    // it by identity).
    const only = raw({ manifest: crmManifest });
    const composed = composeStacks([only], { manifest: 'preserve' });

    expect(composed).toBe(only);
    expect(packagesOf(composed)).toBeUndefined();
  });
});
