// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectGridSchema.exportOptions` is the spec's OBJECT arm, by reference, and the bare
 * format array is refused BY NAME (objectui#7762, `domain:spec` routing ruling).
 *
 * ## The defect this pins closed
 *
 * `ObjectGrid.tsx` reads `schema.exportOptions?.formats` and nothing else, and the
 * `useEffect` that warns about dropped formats reads `.formats` too and returns early when
 * it is absent. A bare format array has no `.formats`, so `['csv', 'json']` — the default —
 * won, with no error, no warning and no console line, while `!!schema.exportOptions` kept
 * the export button on screen. The mirror declared no `exportOptions` member at all, and
 * `BaseSchema` is `.passthrough()`, so the array validated GREEN and came back verbatim.
 * Same for a retired `'pdf'` value and a sixth key: this node admitted both, where the
 * `list-view` mirror (objectui#6956) refuses them.
 *
 * The ruling: the contract REFUSES the bare array on this node, by name, with a message
 * pointing at the object shape the renderer actually reads. ⛔ NOT a fold at the renderer's
 * read site — `packages/plugin-grid/**` is untouched and its read is held to be correct.
 *
 * ## Why the object arm is PEELED rather than bound whole, and why not restated
 *
 * `SpecListViewSchema.shape.exportOptions` — what the sibling `ListViewSchema` mirror binds
 * — is a TWO-ARM union whose first arm LIFTS a bare array to `{ formats }` at parse.
 * Binding that reference here would make this mirror ACCEPT AND LIFT: the opposite of the
 * ruled refusal. So the object arm is peeled out and the lifting arm left behind. It is
 * peeled rather than restated because a local copy of the five keys is a third copy of one
 * contract, and the copy is what drifts — the lesson `objectql.ts`'s `ListViewExportOptions`
 * docblock already records for the TypeScript face.
 *
 * Identity is therefore the load-bearing assertion below: a restated copy passes every
 * verdict test on the day it is written and drifts afterwards; `toBe` cannot.
 *
 * ## Non-vacuity
 *
 * Membership is read off `.shape`, not off acceptance: the base is `.passthrough()`, so
 * acceptance cannot distinguish "declared" from "admitted unexamined" and was green before
 * the fix too. Every refusal assertion carries the live control that was green BEFORE this
 * card (the sibling `list-view` mirror still lifting the same array), so a mirror that had
 * simply stopped parsing anything could not pass this file.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ObjectGridSchema, ListViewSchema as MirrorListViewSchema } from '../zod/objectql.zod';
import type { ObjectGridSchema as TsObjectGridSchema, ListViewExportOptions } from '../objectql';

/* ── Type-level helpers (invariant equality, house form) ─────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/**
 * The mirror's AUTHORING face (`z.input`) for this key is the interface's type — object
 * only, no array arm. This is the half `zod-mirror-parity.test.ts` reconciles as a pair;
 * pinned here too so a widening that keeps the ledger green is still visible on the card.
 */
export type _FaceIsTheObjectFormOnly = Expect<
  Equal< NonNullable< z.input< typeof ObjectGridSchema >['exportOptions'] >, ListViewExportOptions >
>;

/** And the interface face is unchanged by this card. */
export type _InterfaceFaceUnchanged = Expect<
  Equal< NonNullable< TsObjectGridSchema['exportOptions'] >, ListViewExportOptions >
>;

/* ── Reaching the spec's object arm, the way the sibling parity test does ── */

type ZodLike = {
  unwrap?: () => ZodLike;
  options?: ZodLike[];
  shape?: Record<string, unknown>;
};

const specExportOptions = (SpecListViewSchema as unknown as { shape: Record<string, ZodLike> })
  .shape.exportOptions;

const specUnion = ((): ZodLike => {
  let cur = specExportOptions;
  for (let i = 0; i < 5 && cur && !cur.options && typeof cur.unwrap === 'function'; i++) cur = cur.unwrap();
  return cur;
})();

const specObjectArm = specUnion.options?.find((o) => o.shape);

/** A minimal legal `object-grid` node: the two required keys and nothing else. */
const NODE = { type: 'object-grid' as const, objectName: 'accounts' };

const parse = (exportOptions: unknown) => ObjectGridSchema.safeParse({ ...NODE, exportOptions });

describe('ObjectGridSchema.exportOptions — the spec object arm, by reference (objectui#7762)', () => {
  it('finds the spec shape it is about to compare against (non-vacuity floor)', () => {
    // Every identity assertion below reads through `specObjectArm`. A spec refactor that
    // moved the shape would otherwise turn each of them into a comparison against
    // `undefined`, and `toBe(undefined) === toBe(undefined)` would pass.
    expect(specExportOptions).toBeDefined();
    expect(specUnion.options).toHaveLength(2);
    expect(specObjectArm).toBeDefined();
    expect(Object.keys(specObjectArm?.shape ?? {}).sort())
      .toEqual(['fileNamePrefix', 'formats', 'includeHeaders', 'maxRecords', 'streaming']);
  });

  it('is a member of the mirror shape (membership cannot be read off acceptance under passthrough)', () => {
    expect('exportOptions' in ObjectGridSchema.shape).toBe(true);
    // Live positive control and a negative one, so the `true` above is a reading rather
    // than an artefact of how `in` behaves on this object.
    expect('bulkActions' in ObjectGridSchema.shape).toBe(true);
    expect('zzNoSuchKey' in ObjectGridSchema.shape).toBe(false);
  });

  it('takes every member schema FROM the spec arm — identity, not a restatement', () => {
    const mirrorArm = (ObjectGridSchema.shape.exportOptions as unknown as { unwrap: () => { shape: Record<string, unknown> } })
      .unwrap();
    const specShape = specObjectArm?.shape ?? {};
    expect(Object.keys(mirrorArm.shape).sort()).toEqual(Object.keys(specShape).sort());
    for (const key of Object.keys(specShape)) {
      // `toBe`, not `toEqual`: a verbatim hand copy would satisfy `toEqual` on the day it
      // was written. Identity is what makes a spec-side change move this member too.
      expect(mirrorArm.shape[key]).toBe(specShape[key]);
    }
  });

  it('⛔ is NOT the spec union itself — that reference lifts, and lifting is the defect', () => {
    // The single most likely wrong fix, pinned so it cannot land silently. The sibling
    // `list-view` mirror DOES bind the union and MUST keep lifting: that is the live
    // control proving this file measures a difference between the two nodes rather than a
    // validator that stopped working.
    expect(ObjectGridSchema.shape.exportOptions).not.toBe(specExportOptions);
    const lifted = MirrorListViewSchema.safeParse({
      type: 'list-view', objectName: 'accounts', exportOptions: ['csv', 'xlsx'],
    });
    expect(lifted.success).toBe(true);
    expect(lifted.data?.exportOptions).toEqual({ formats: ['csv', 'xlsx'] });
  });
});

describe('the four authored readings (objectui#7762)', () => {
  it('REFUSES a bare format array by name — one issue, invalid_type, at the key', () => {
    const refused = parse(['csv', 'xlsx']);
    expect(refused.success).toBe(false);
    const issues = refused.error?.issues ?? [];
    // Exactly one: a refusal that also reported the array's ELEMENTS would be reporting on
    // a shape this node does not model, and would bury the actionable line.
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('invalid_type');
    expect(issues[0]?.path).toEqual(['exportOptions']);
    // The message is the point of the ruling, not an incidental string: it must name the
    // shape the renderer reads, or an author meets zod's own "expected object, received
    // array" and is told nothing about what to write.
    expect(issues[0]?.message).toMatch(/formats/);
    expect(issues[0]?.message).toMatch(/list-view/);
    expect(issues[0]?.message).toMatch(/object-grid/);
  });

  it('ACCEPTS the five-key object form and returns it VERBATIM', () => {
    // A non-strict object would accept and STRIP — green on `success` while silently
    // dropping the opt-out the renderer honours. Assert the values come back.
    const authored = {
      formats: ['csv', 'xlsx'], maxRecords: 10, includeHeaders: true,
      fileNamePrefix: 'accounts', streaming: false,
    };
    const parsed = parse(authored);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.exportOptions).toEqual(authored);
  });

  it("REFUSES a retired 'pdf' format, carrying the SPEC's own migration prescription", () => {
    const refused = parse({ formats: ['csv', 'pdf'] });
    expect(refused.success).toBe(false);
    const issues = refused.error?.issues ?? [];
    expect(issues.some((i) => i.path[0] === 'exportOptions')).toBe(true);
    const messages = issues.map((i) => i.message).join('\n');
    // The prescription, not the citation: @objectstack/spec 17.3.0 stripped the issue
    // numbers and kept the actionable half, the same move `export-options-spec-parity.test.ts`
    // already followed. Asserting only `success === false` would stay green if this member
    // were replaced by a local restatement that had never heard of the retirement.
    expect(messages).toMatch(/'csv', 'xlsx' and 'json'/);
    expect(messages).toMatch(/os migrate meta/);
  });

  it('REFUSES a sixth key — strict, as upstream, and no silent strip', () => {
    const refused = parse({ formats: ['csv'], compression: 'gzip' });
    expect(refused.success).toBe(false);
    const issues = refused.error?.issues ?? [];
    expect(issues.some((i) => i.code === 'unrecognized_keys' && i.path[0] === 'exportOptions')).toBe(true);
    // The key is named, so the author can act without reading the schema.
    expect(issues.map((i) => i.message).join('\n')).toMatch(/compression/);
  });
});

describe('the narrowing does not reach anything else (objectui#7762)', () => {
  it('a node with no exportOptions at all is unchanged', () => {
    expect(ObjectGridSchema.safeParse(NODE).success).toBe(true);
  });

  it('control: neighbouring members keep their accept sets', () => {
    // `bulkActions` and `pagination` sit in the same `.extend()` block and are untouched.
    expect(ObjectGridSchema.shape.bulkActions.safeParse(['delete']).success).toBe(true);
    expect(ObjectGridSchema.shape.bulkActions.safeParse('delete').success).toBe(false);
    expect(ObjectGridSchema.shape.pagination.safeParse({ pageSize: 25 }).success).toBe(true);
  });

  it('the guidance string feeds BOTH author-facing channels, so they cannot drift', () => {
    // The `./tombstone.zod.ts` house discipline: one string, the `.describe()` metadata
    // generated docs publish AND the parse-time issue message. Read them off the live
    // schema and compare, rather than restating either.
    const described = ObjectGridSchema.shape.exportOptions.description;
    const refused = parse(['csv']);
    expect(described).toBeDefined();
    expect(refused.error?.issues[0]?.message).toBe(described);
  });
});
