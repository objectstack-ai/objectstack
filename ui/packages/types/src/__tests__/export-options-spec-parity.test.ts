// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `exportOptions` ↔ the INSTALLED `@objectstack/spec`, on BOTH local faces
 * (objectui#4535 for the TS declaration, objectui#6956 for the zod mirror).
 *
 * The card this file was written for was filed because a comment claimed
 * alignment with `@objectstack/spec`'s `ListViewSchema.exportOptions` and was
 * false in both directions. objectstack#8010 fixed the upstream half; objectui's
 * half restated the spec's five keys locally, under a NOTE explaining that the
 * object form was not importable from the pin.
 *
 * Both halves have since moved, and that is the hazard this file exists for. The
 * pin bumped to `@objectstack/spec@17.2.0`, which DOES carry the object form —
 * so the NOTE went stale, and the prose went false again, by nobody touching it.
 * A comment that has already gone false twice is not the instrument to trust a
 * third time.
 *
 * So the claim is made falsifiable instead: every assertion below reads the
 * shape out of the spec package that is actually installed, at test time, and
 * compares it to the local declaration. Nothing here restates the contract — a
 * restatement is a third copy, and the copy is what drifts (the lesson
 * `list-view-spec-parity.test.ts` already records for the enclosing schema).
 *
 * Why the TS interface is a mirror at all, rather than `z.infer` of the spec
 * symbol: `ListViewExportOptionsSchema` is internal to the spec bundle and NOT
 * among the package's public exports — measured, not assumed, by the floor test
 * below. Only the enclosing `ListViewSchema` is exported, and its `exportOptions`
 * is a two-branch union (legacy-array lift ∪ object), whose inferred type is a
 * union and not this interface. When upstream exports the symbol, derive from it
 * and delete both the mirror and this file's key-set tests.
 *
 * The ZOD mirror has no such excuse, and since objectui#6956 it makes none:
 * `ListViewSchema.exportOptions` in `src/zod/objectql.zod.ts` is the spec field
 * BOUND BY REFERENCE (`SpecListViewSchema.shape.exportOptions`), not a
 * restatement. Before that it declared a pre-#8010 shape of its own — `'pdf'`
 * accepted in both spellings, no `streaming`, a non-strict object — and because
 * `ListViewInferred` is `z.input` of that mirror, the `ListViewSchema` TYPE the
 * ListView renderer is written against disagreed with its sibling
 * `ObjectGridSchema['exportOptions']`. The second `describe` below pins the
 * mirror: identity with the spec field, the four verdicts the card names, the
 * survival of `streaming` through a parse, and the TS face that follows.
 *
 * SCOPE, stated rather than implied: the first `describe` covers the TypeScript
 * declaration in `objectql.ts`; the second covers the zod mirror and the
 * `ListViewSchema` type derived from it. Both are `@object-ui/types` surfaces.
 */

import { describe, it, expect } from 'vitest';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ListViewSchema as MirrorListViewSchema } from '../zod/objectql.zod.js';
import type { ListViewExportFormat, ListViewExportOptions, ListViewSchema } from '../index';

/* ── Type-level helpers (house form: `objectql.exportOptions.test.ts`) ────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/* ── The local declaration, as runtime-enumerable data ────────────────────── */

/**
 * `Record<keyof T, true>` is exhaustive BOTH ways at compile time: a key added
 * to the interface and missing here is a TS2741, and a key here that the
 * interface dropped is a TS2353. That makes this object a faithful runtime
 * projection of the type — which the type itself, erased at runtime, cannot be.
 */
const LOCAL_OPTION_KEYS: Record<keyof ListViewExportOptions, true> = {
  formats: true,
  maxRecords: true,
  includeHeaders: true,
  fileNamePrefix: true,
  streaming: true,
};

/** Same device for the format union, so the enum comparison is also exhaustive. */
const LOCAL_FORMATS: Record<ListViewExportFormat, true> = {
  csv: true,
  xlsx: true,
  json: true,
};

/* ── Reaching the spec's object branch ────────────────────────────────────── */

type ZodLike = {
  unwrap?: () => ZodLike;
  options?: ZodLike[];
  shape?: Record<string, ZodLike>;
  element?: ZodLike;
  safeParse: (v: unknown) => {
    success: boolean;
    data?: unknown;
    error?: { issues: { message: string; path: PropertyKey[] }[] };
  };
  _zod?: { def?: { type?: string; element?: ZodLike; entries?: Record<string, string> } };
};

const specExportOptions = (SpecListViewSchema as unknown as { shape: Record<string, ZodLike> })
  .shape.exportOptions;

/** Peel `.optional()` (and any further wrapper) until the union itself. */
function toUnion(schema: ZodLike): ZodLike {
  let cur = schema;
  for (let i = 0; i < 5 && cur && !cur.options && typeof cur.unwrap === 'function'; i++) {
    cur = cur.unwrap();
  }
  return cur;
}

const specUnion = toUnion(specExportOptions);
/**
 * The object branch — the one with a `shape`. The other branch is the legacy
 * bare-format-array lift, which is a `ZodPipe` and has none.
 */
const specObjectBranch = specUnion.options?.find((o) => o.shape);

function specFormatEnumValues(): string[] {
  let f = specObjectBranch?.shape?.formats;
  for (let i = 0; i < 5 && f && f._zod?.def?.type !== 'array' && typeof f.unwrap === 'function'; i++) {
    f = f.unwrap();
  }
  const element = f?._zod?.def?.element ?? f?.element;
  return Object.keys(element?._zod?.def?.entries ?? {});
}

/* ── Tests: the TS declaration ───────────────────────────────────────────── */

describe('exportOptions ↔ installed @objectstack/spec (objectui#4535)', () => {
  it('finds the spec shape it is about to compare against', () => {
    // Non-vacuity floor. Every assertion below reads through `specObjectBranch`,
    // and a spec refactor that moved the shape would otherwise turn each of them
    // into a comparison against `undefined` — which some would pass.
    expect(specExportOptions).toBeDefined();
    expect(specUnion.options).toHaveLength(2);
    expect(specObjectBranch).toBeDefined();
    expect(Object.keys(specObjectBranch?.shape ?? {}).length).toBe(5);
    expect(specFormatEnumValues().length).toBeGreaterThan(0);
  });

  it('records WHY the TS mirror exists: the spec does not export the symbol', async () => {
    // The reason in the doc comment, measured. If this ever fails, the mirror is
    // obsolete: derive `ListViewExportOptions` from the exported symbol and
    // delete it, rather than leaving a hand copy beside an importable schema.
    const specUi = (await import('@objectstack/spec/ui')) as unknown as Record<string, unknown>;
    expect(specUi.ListViewSchema).toBeDefined();
    expect(specUi.ListViewExportOptionsSchema).toBeUndefined();
  });

  it('declares exactly the keys the spec object branch declares', () => {
    expect(Object.keys(LOCAL_OPTION_KEYS).sort())
      .toEqual(Object.keys(specObjectBranch?.shape ?? {}).sort());
  });

  it('offers exactly the formats the spec enum offers — `pdf` is gone from both', () => {
    expect(Object.keys(LOCAL_FORMATS).sort()).toEqual(specFormatEnumValues().sort());
    expect(specFormatEnumValues()).not.toContain('pdf');
  });

  it('is strict upstream: a sixth key is refused, so declaring one here is unauthorable', () => {
    // The other end of the local key-set assertion in `objectql.exportOptions.test.ts`.
    // That one stops a sixth key being DECLARED locally; this one is the reason —
    // the platform would refuse metadata carrying it.
    expect(specExportOptions.safeParse({ formats: ['csv'], compression: 'gzip' }).success).toBe(false);
    expect(specExportOptions.safeParse({
      formats: ['csv'], maxRecords: 1, includeHeaders: true, fileNamePrefix: 'p', streaming: false,
    }).success).toBe(true);
  });

  it('refuses a retired `pdf` format with a migration prescription, not a bare rejection', () => {
    const refused = specExportOptions.safeParse(['csv', 'pdf']);
    expect(refused.success).toBe(false);
    // The prescription is the half that makes the refusal actionable for an
    // author; asserting only `success === false` would stay green if it were
    // reduced to "Invalid input".
    const messages = (refused.error?.issues ?? []).map((i) => i.message).join('\n');
    expect(messages).toMatch(/pdf/);
    // Was `/8010|1301/` — the issue numbers. 17.3.0 stripped those citations
    // and kept the prescriptive half, so the assertion moves to the half this
    // test's own comment above calls the point: the actionable repair (which
    // values survive) and the migration command that lists the edits.
    expect(messages).toMatch(/'csv', 'xlsx' and 'json'/);
    expect(messages).toMatch(/os migrate meta/);
  });

  it('lifts a bare format array at PARSE — which is why the renderer still needs its own tolerance', () => {
    // objectui#4535 item 4. The lift is real, but it only runs for whoever calls
    // `.parse()`. Nothing on objectui's render path does: `normalizeListViewSchema`
    // (@object-ui/core) does not touch `exportOptions`, and the ListView surface is
    // typed `z.input` precisely because the renderer receives metadata as authored.
    // So a stored bare array still arrives as an array, and `ListView`'s
    // `resolvedExportOptions` fold is load-bearing rather than legacy.
    const lifted = specExportOptions.safeParse(['csv', 'xlsx']);
    expect(lifted.success).toBe(true);
    expect(lifted.data).toEqual({ formats: ['csv', 'xlsx'] });
  });
});

/* ── Tests: the zod mirror and the ListView TS face it derives ───────────── */

/**
 * The `ListViewSchema` TYPE's `exportOptions`, `undefined` stripped. This is
 * `z.input` of the mirror member — i.e. what the ListView renderer is written
 * against — so the pins below are about the renderer's contract, not a test
 * fixture's.
 */
type ListViewExportFace = NonNullable< ListViewSchema['exportOptions'] >;

/**
 * The face is the spec's INPUT type: the bare format array (the legacy
 * spelling, admitted on input because nothing on the render path parses) OR the
 * five-key object — and the object arm IS `ListViewExportOptions`, the same type
 * `ObjectGridSchema['exportOptions']` and `NamedListView['exportOptions']` carry.
 * One spec key, one type, on every local authoring surface.
 */
type _FaceIsTheSpecInput = Expect< Equal< ListViewExportFace, ListViewExportFormat[] | ListViewExportOptions > >;

/** `streaming` is on the face, as the spec's optional boolean — no cast needed to read it. */
type _FaceCarriesStreaming = Expect<
  Equal< Exclude< ListViewExportFace, unknown[] >['streaming'], boolean | undefined >
>;

/** The array arm's vocabulary is the spec's three formats — `'pdf'` is not among them. */
type _ArrayArmIsCsvXlsxJson = Expect<
  Equal< Extract< ListViewExportFace, unknown[] >[number], 'csv' | 'xlsx' | 'json' >
>;

/** A minimal, valid `list-view` node — the envelope every parse below rides on. */
const NODE = { type: 'list-view', objectName: 'accounts' } as const;

/** The four readings the card names, in the order it names them. */
const FOUR_READINGS: readonly unknown[] = [
  ['csv', 'xlsx'],
  ['csv', 'pdf'],
  { formats: ['csv'], compression: 'gzip' },
  { formats: ['csv'], streaming: true },
];

describe('the zod mirror binds exportOptions to the spec field (objectui#6956)', () => {
  const mirrorExportOptions = (MirrorListViewSchema as unknown as { shape: Record<string, ZodLike> })
    .shape.exportOptions;

  it('is the spec field BY REFERENCE — the same schema object, not a restatement', () => {
    // The reading that makes the derivation real. A restated copy — even a
    // verbatim one — passes every verdict test below on the day it is written
    // and drifts afterwards; identity cannot.
    expect(mirrorExportOptions).toBeDefined();
    expect(mirrorExportOptions).toBe(specExportOptions);
  });

  it('lifts a bare format array to `{ formats }` at parse, and still admits the array on the INPUT type', () => {
    const lifted = MirrorListViewSchema.safeParse({ ...NODE, exportOptions: ['csv', 'xlsx'] });
    expect(lifted.success).toBe(true);
    expect(lifted.data?.exportOptions).toEqual({ formats: ['csv', 'xlsx'] });
    // The TS face: an authored bare array is a legal INPUT. Compile-time pin —
    // `satisfies` refuses the literal if the array arm leaves `z.input`.
    const authored = ['csv', 'xlsx'] satisfies ListViewSchema['exportOptions'];
    expect(Array.isArray(authored)).toBe(true);
  });

  it("refuses 'pdf' in both spellings, on the `exportOptions` path, with the migration prescription", () => {
    const spellings: readonly unknown[] = [['csv', 'pdf'], { formats: ['csv', 'pdf'] }];
    for (const exportOptions of spellings) {
      const refused = MirrorListViewSchema.safeParse({ ...NODE, exportOptions });
      expect(refused.success).toBe(false);
      const issues = refused.error?.issues ?? [];
      expect(issues.some((i) => i.path[0] === 'exportOptions')).toBe(true);
      const messages = issues.map((i) => i.message).join('\n');
      expect(messages).toMatch(/pdf/);
      // Was `/8010|1301/` — the issue numbers. `@objectstack/spec` 17.3.0
      // stripped those citations from its refusal messages and kept the
      // prescriptive half, so this assertion moves to that half — exactly as
      // the sibling pin in this file's `objectui#4535` block already does. The
      // durable content of a refusal is the repair it prescribes; the citation
      // is the half upstream felt free to drop.
      expect(messages).toMatch(/'csv', 'xlsx' and 'json'/);
      expect(messages).toMatch(/os migrate meta/);
    }
    // And the TYPE refuses it too, in both spellings — the renderer's contract
    // cannot be handed a value the platform refuses at publish.
    // @ts-expect-error 'pdf' left the spec's format enum in @objectstack/spec 17.0.0 (objectstack#8010)
    const pdfArray: ListViewSchema['exportOptions'] = ['csv', 'pdf'];
    // @ts-expect-error 'pdf' left the spec's format enum in @objectstack/spec 17.0.0 (objectstack#8010)
    const pdfObject: ListViewSchema['exportOptions'] = { formats: ['pdf'] };
    expect([pdfArray, pdfObject]).toHaveLength(2);
  });

  it('refuses a sixth key on the object branch — strict, as upstream, no silent strip', () => {
    const refused = MirrorListViewSchema.safeParse({
      ...NODE, exportOptions: { formats: ['csv'], compression: 'gzip' },
    });
    expect(refused.success).toBe(false);
    expect((refused.error?.issues ?? []).some((i) => i.path[0] === 'exportOptions')).toBe(true);
    // The TYPE refuses it as well.
    // @ts-expect-error `compression` is not one of the spec's five exportOptions keys
    const sixth: ListViewSchema['exportOptions'] = { formats: ['csv'], compression: 'gzip' };
    expect(sixth).toBeDefined();
  });

  it('accepts `streaming: true` and `streaming: false`, and the value SURVIVES the parse', () => {
    // A non-strict `z.object` would accept both and strip the key — green on
    // `success`, silently dropping the opt-out the renderer honours. Assert the
    // value comes back, not just that the parse passed.
    for (const streaming of [true, false] as const) {
      const parsed = MirrorListViewSchema.safeParse({ ...NODE, exportOptions: { formats: ['csv'], streaming } });
      expect(parsed.success).toBe(true);
      const out = parsed.data?.exportOptions as { streaming?: boolean } | undefined;
      expect(out?.streaming).toBe(streaming);
    }
    // And the face admits it without a cast (compile-time pin).
    const declared = { formats: ['csv'], streaming: false } satisfies ListViewSchema['exportOptions'];
    expect(declared.streaming).toBe(false);
  });

  it('agrees with the spec verdict-for-verdict, and output-for-output, on the four readings', () => {
    const verdicts = FOUR_READINGS.map((input) => {
      const spec = specExportOptions.safeParse(input);
      const mirror = mirrorExportOptions.safeParse(input);
      expect(mirror.success).toBe(spec.success);
      expect(mirror.data).toEqual(spec.data);
      return spec.success;
    });
    // Non-vacuity: these are the four readings the card names, with the four
    // verdicts it records — lift, refuse, refuse, accept. A spec whose
    // `exportOptions` accepted everything would agree with itself trivially.
    expect(verdicts).toEqual([true, false, false, true]);
  });

  it('control: neighbouring members keep their accept sets', () => {
    // `conditionalFormatting` sits next to `exportOptions` in the same
    // `.extend()` block and is untouched by objectui#6956: its `{ condition, style }`
    // rule still parses and a non-array is still refused. (The native
    // `{ field, operator, value }` shape it also took then is retired since
    // objectui#11533 and pinned in `grid-list-view-conditional-formatting-11533.test.ts`.)
    const cf = MirrorListViewSchema.shape.conditionalFormatting;
    expect(cf.safeParse([{ condition: '${record.amount > 100}', style: { color: 'red' } }]).success).toBe(true);
    expect(cf.safeParse('nope').success).toBe(false);
    // `allowExport`, the local boolean the export menu is gated on.
    expect(MirrorListViewSchema.shape.allowExport.safeParse(true).success).toBe(true);
    expect(MirrorListViewSchema.shape.allowExport.safeParse('yes').success).toBe(false);
    // And the envelope itself: a node with no `exportOptions` at all is unchanged.
    expect(MirrorListViewSchema.safeParse(NODE).success).toBe(true);
  });
});
