// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 — the release artifact may carry N package manifests, and BOTH
 * shapes are read.
 *
 * The decision this file pins, in the record's own terms:
 *
 *   - `packages` present → iterate it.
 *   - `packages` absent  → treat `manifest` (singular) as a single-element list.
 *
 * `manifest` is RETAINED, not replaced: "A *replacement* of `manifest` by
 * `packages` would break every artifact already built — the schema shape is the
 * compatibility mechanism." So the acceptance criterion is a NEGATIVE one as
 * much as a positive one — nothing about an existing single-`manifest` artifact
 * may move — and that half is pinned here first.
 *
 * ## The structural reservation, and why it gets its own pins
 *
 * D4 reserves the segmented-artifact key POSITION at schema time and
 * deliberately does not build it: each entry in `packages` is an **object**
 * whose manifest body sits under `manifest:`, never the manifest body inlined
 * flat as the array element. That is the whole reason a future
 * `{ ref, integrity }` external segment is an ADDITIVE key rather than a
 * reshape. A reservation nothing asserts is a reservation the next author
 * flattens away without noticing — an artifact schema is on disk at every
 * customer, so this is the cheapest possible moment to hold the shape.
 *
 * ⛔ Segmented loading itself is an explicit ADR-0130 Non-goal and is NOT
 * implemented. So is the load path that iterates the list (D5, its own card)
 * and the `installPackage` co-ownership gate (D1/D3, its own card). This file
 * pins the SCHEMA, and says so where a reader might otherwise read a green test
 * as "multi-package artifacts install".
 *
 * ## Rejection-pin convention
 *
 * Schema-layer rejections assert the Zod issue's **`code` and `path`** (plus
 * the offending key where the issue carries one), matching
 * `stack-top-level-strict.test.ts`: `status` is the publish door's uniform
 * ADR-0112 wrap, applied where a parse failure crosses the HTTP boundary, not
 * minted per-schema. A bare `expect(...).toThrow()` would be no pin at all
 * here — every one of these inputs is refused by SOME issue, and the point is
 * WHICH.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  ArtifactPackageEntrySchema,
  ObjectStackDefinitionSchema,
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
};

const cpqManifest = {
  id: 'com.example.crm.cpq',
  name: 'cpq',
  version: '1.0.0',
  type: 'module' as const,
  namespace: 'crm',
};

/** A representative artifact of the shape that exists on disk TODAY. */
const singleManifestArtifact = () => ({
  manifest: { ...crmManifest },
  objects: [
    { name: 'crm_account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } },
  ],
  apps: [],
  requires: ['automation'],
});

const parse = (raw: Record<string, unknown>) => ObjectStackDefinitionSchema.safeParse(raw);

/** The single issue at `path`, or `undefined` — pins read one issue, not a set. */
const issueAt = (
  result: ReturnType<typeof parse>,
  path: (string | number)[],
) => {
  if (result.success) return undefined;
  return result.error.issues.find(
    (i) => JSON.stringify(i.path) === JSON.stringify(path),
  );
};

// ─── D4 branch 2 — `packages` absent: nothing moves ─────────────────

describe('ADR-0130 D4 — an existing single-`manifest` artifact is untouched', () => {
  it('parses, and every value it declared survives', () => {
    const input = singleManifestArtifact();
    const result = parse(input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.manifest).toMatchObject(crmManifest);
    expect(result.data.objects?.[0]).toMatchObject({ name: 'crm_account', label: 'Account' });
    expect(result.data.requires).toEqual(['automation']);
  });

  it('adds NO top-level key to the parsed artifact — the compile output does not move', () => {
    // ⚠️ Read what this asserts and what it does not. The parse legitimately
    // fills DEFAULTS deep inside (`field.required: false`, `object.datasource`
    // …), so the parsed value is not equal to the input and never was — a pin
    // written that way fails on `main` for reasons that have nothing to do with
    // this change. What this change could actually break is the TOP-LEVEL key
    // set, and that is what is pinned: a `.default([])` on `packages` (the
    // obvious near-miss) would materialise `"packages": []` into every
    // artifact, rewriting the compile output of every project on its next
    // build and putting a second source of truth for the same fact in the file.
    //
    // `os compile` writes `JSON.stringify(finalBundle, null, 2)` with
    // `finalBundle` spread from this parse result
    // (packages/cli/src/commands/compile.ts), so "no new top-level key" is the
    // schema-layer half of the byte-unchanged criterion. The end-to-end half is
    // measured against the pre-change compiler in the PR body.
    const input = singleManifestArtifact();
    const result = parse(input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data).sort()).toEqual(Object.keys(input).sort());
  });

  it('does NOT invent a `packages` key when the artifact has none', () => {
    // The read-both rule makes `manifest` a single-element list at the LOAD
    // path (ADR-0130 D5's card). The schema must not materialise that list into
    // the artifact.
    const result = parse(singleManifestArtifact());

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect('packages' in (result.data as Record<string, unknown>)).toBe(false);
    expect(result.data.packages).toBeUndefined();
    expect(JSON.stringify(result.data)).not.toContain('"packages"');
  });

  it('keeps `packages` OPTIONAL — an artifact with neither key still parses', () => {
    const result = parse({ objects: [] });
    expect(result.success).toBe(true);
  });
});

// ─── D4 branch 1 — `packages` present ───────────────────────────────

describe('ADR-0130 D4 — `packages` carries N manifests', () => {
  it('accepts an artifact carrying two co-owning packages, in order', () => {
    const result = parse({
      packages: [{ manifest: crmManifest }, { manifest: cpqManifest }],
      objects: [],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.packages?.map((p) => p.manifest.id)).toEqual([
      'com.example.crm',
      'com.example.crm.cpq',
    ]);
  });

  it('accepts BOTH keys on one artifact — `manifest` is retained, not replaced', () => {
    // A producer may keep writing the singular `manifest` so an older runtime
    // still loads the artifact (D4's forward-compatibility posture rides
    // `manifest.engines.protocol`, ADR-0025 — not a new negotiation
    // mechanism). The schema must therefore not treat the two keys as mutually
    // exclusive.
    const result = parse({
      manifest: crmManifest,
      packages: [{ manifest: crmManifest }, { manifest: cpqManifest }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.manifest?.id).toBe('com.example.crm');
    expect(result.data.packages).toHaveLength(2);
  });

  it('accepts an EMPTY list — an empty artifact is not a schema error', () => {
    // Whether an empty `packages` is meaningful is a LOAD-path question (it
    // registers nothing), and inventing a `.min(1)` here would refuse an
    // artifact the load path can read perfectly well.
    expect(parse({ packages: [] }).success).toBe(true);
  });

  it('carries the whole manifest, `engines.protocol` included (ADR-0025)', () => {
    // D4: "Forward compatibility rides on the mechanism that already exists:
    // `manifest.engines.protocol`." That only holds if the per-entry manifest
    // is the REAL manifest schema rather than a reduced copy of it.
    const result = parse({
      packages: [{ manifest: { ...cpqManifest, engines: { protocol: '>=18 <19' } } }],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.packages?.[0].manifest.engines?.protocol).toBe('>=18 <19');
  });
});

// ─── D4 — the structural reservation ────────────────────────────────

describe('ADR-0130 D4 — each `packages` entry is an OBJECT wrapping its manifest', () => {
  it('refuses a manifest body inlined flat as the array element', () => {
    // THE reservation pin. `packages: [{ id, name, version, … }]` is the shape
    // that would make a future `{ ref, integrity }` segment a reshape instead
    // of an added key, so it must be refused now, while nothing has shipped it.
    const result = parse({ packages: [{ ...crmManifest }] });

    expect(result.success).toBe(false);
    const issue = issueAt(result, ['packages', 0]);
    expect(issue?.code).toBe('unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(
      expect.arrayContaining(['id', 'name', 'version', 'type', 'namespace']),
    );
    // The refusal must teach the wrapper, not merely deny the input.
    expect(issue?.message).toContain('manifest');
  });

  it('refuses a non-object entry, naming the entry position', () => {
    const result = parse({ packages: ['com.example.crm.cpq'] });

    expect(result.success).toBe(false);
    const issue = issueAt(result, ['packages', 0]);
    expect(issue?.code).toBe('invalid_type');
  });

  it('refuses an entry with no manifest at all', () => {
    const result = parse({ packages: [{}] });

    expect(result.success).toBe(false);
    expect(issueAt(result, ['packages', 0, 'manifest'])?.code).toBe('invalid_type');
  });

  it('refuses `packages` that is not an array', () => {
    const result = parse({ packages: { 'com.example.crm': crmManifest } });

    expect(result.success).toBe(false);
    expect(issueAt(result, ['packages'])?.code).toBe('invalid_type');
  });

  it('refuses TODAY\'s runtime the future `{ ref, integrity }` segment — cleanly', () => {
    // ⚠️ DELIBERATE, and it is the forward half of the reservation: an older
    // runtime must refuse a newer artifact rather than mis-parse it into a
    // half-registered install (D4, ADR-0025). The refusal names `ref` because
    // the entry is strict.
    //
    // When segmented loading lands (its own decision — an ADR-0130 Non-goal
    // here), this pin is UPDATED on purpose, and the update is the visible
    // record that the key position was spent.
    const result = parse({
      packages: [{ ref: './segments/cpq.json', integrity: 'sha256-deadbeef' }],
    });

    expect(result.success).toBe(false);
    const issue = issueAt(result, ['packages', 0]);
    expect(issue?.code).toBe('unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual(
      expect.arrayContaining(['ref', 'integrity']),
    );
  });

  it('exports the entry schema so the load path judges the same shape', () => {
    // #14162's iteration and any consumer that reads one entry must reuse this
    // schema rather than re-derive the wrapper — a second declaration of one
    // shape is the drift ADR-0116 exists about, in miniature.
    expect(ArtifactPackageEntrySchema.safeParse({ manifest: crmManifest }).success).toBe(true);
    expect(ArtifactPackageEntrySchema.safeParse(crmManifest).success).toBe(false);
  });
});

// ─── Composition — the disposition is declared, not defaulted ───────

describe('ADR-0130 D4 — `packages` has a declared composition rule', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  const raw = (o: Record<string, unknown>): ObjectStackDefinition =>
    defineStack(o as never, { strict: false });

  it('concatenates entries in stack order', () => {
    const composed = composeStacks([
      raw({ manifest: crmManifest, packages: [{ manifest: crmManifest }] }),
      raw({ manifest: cpqManifest, packages: [{ manifest: cpqManifest }] }),
    ]) as unknown as { packages: { manifest: { id: string } }[] };

    expect(composed.packages.map((p) => p.manifest.id)).toEqual([
      'com.example.crm',
      'com.example.crm.cpq',
    ]);
  });

  it('does not warn about an undeclared composition rule (#5005 rule 3)', () => {
    composeStacks([
      raw({ manifest: crmManifest, packages: [{ manifest: crmManifest }] }),
      raw({ manifest: cpqManifest }),
    ]);

    const warnings: string[] = warnSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(warnings.some((w: string) => w.includes("'packages'"))).toBe(false);
  });

  it('leaves the singular `manifest` pick-one semantics alone BY DEFAULT', () => {
    // ⚠️ UPDATED, on purpose, by ADR-0130's follow-up row 3 — the card that
    // added `composeStacks`' preserve mode. This pin was written to make that
    // follow-up a VISIBLE change rather than a silent one, so here is what it
    // now records: the assertions below did not move. Preserve is **opt-in**
    // (`{ manifest: 'preserve' }`), the default is still `'last'`, and a caller
    // that passes no options gets byte-for-byte what it got before — one
    // manifest kept, and NO `packages` key minted underneath it.
    //
    // Only the pin's stated reason changed: "until the follow-up lands" became
    // "the follow-up landed and deliberately did not touch this path". The
    // preserve mode's own behaviour is pinned in
    // `compose-stacks-manifest-preserve.test.ts`.
    const composed = composeStacks([raw({ manifest: crmManifest }), raw({ manifest: cpqManifest })]);

    expect(composed.manifest?.id).toBe('com.example.crm.cpq');
    expect((composed as Record<string, unknown>).packages).toBeUndefined();
  });
});
