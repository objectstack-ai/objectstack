// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for how the reference-docs renderer prints an OPEN object — one that
 * declares keys AND accepts more (`.passthrough()` / `.catchall()`) — #4912.
 *
 * The renderer used to test `additionalProperties` BEFORE `properties`, and the
 * two are not alternatives: JSON Schema spells a passthrough object as both at
 * once. Every such node therefore collapsed to `Record<string, any>`, erasing
 * the declared keys from the author-facing page. `BulkActionParam.options` is
 * the specimen the issue was filed from — its `label`/`value` are *required*
 * (zero tolerance, pinned by the schema's own tests), yet the page showed
 * `Record<string, any>[]`, i.e. "no shape at all".
 *
 * This is a live-and-growing class, not a one-off: the #4001 strictness
 * campaign keeps producing "declared keys + deliberate passthrough" sites
 * (`DashboardWidget.config`, `BulkActionParam` itself, the `data/` mixed
 * verdicts still to land), and each one erased its own keys on the day it
 * landed. PR #4909 compensated by hand, in that key's `.describe()` prose —
 * per-site compensation, not a fix.
 *
 * MEASURED (reverse verification): restoring the old branch order — testing
 * `additionalProperties` before `properties` — turns the four `open object`
 * cases below red with `Record<string, any>` in place of every declared shape.
 * The direction is the ordinary one (restore the defect → new pins go red)
 * because these assert a POSITIVE shape the fix produces, not the absence of a
 * finding. The `closed`/`pure record` cases stay green either way, which is
 * exactly why the bug survived: the renderer was correct on both of the shapes
 * anyone thought to look at.
 */

import { describe, expect, it } from 'vitest';

import { formatPropertyType, formatType, type TypeContext } from './lib/format-type';

const ctx = (defs: Record<string, any> = {}): TypeContext => ({
  defs,
  currentSchema: 'Probe',
  schemaHref: () => null,
});

/** The real `BulkActionParam.options` node, as `gen:schema` emits it. */
const BULK_ACTION_OPTIONS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
    },
    required: ['label', 'value'],
    additionalProperties: {},
  },
};

describe('formatType — open objects keep their declared shape (#4912)', () => {
  it('renders an array of passthrough objects with BOTH the declared keys and the openness marker', () => {
    const rendered = formatType(BULK_ACTION_OPTIONS, ctx());

    // The regression itself: the declared pair must not be erased.
    expect(rendered).toContain('label: string');
    expect(rendered).toContain('value: string | number | boolean');
    // ...and the openness must still be stated, not silently dropped.
    expect(rendered).toContain('Record<string, any>');
    // Parenthesized: `A & B[]` is `A & (B[])` in TypeScript, so the unbracketed
    // spelling would claim `options` is an object intersected with an array.
    expect(rendered).toBe(
      '({ label: string; value: string | number | boolean } & Record<string, any>)[]',
    );
  });

  it('parenthesizes an intersection element before suffixing `[]`, but not a plain one', () => {
    const open = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: {} };
    expect(formatType({ type: 'array', items: open }, ctx()))
      .toBe('({ a?: string } & Record<string, any>)[]');

    // A closed element needs no parens — the existing spelling is preserved.
    expect(formatType({ type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } }, ctx()))
      .toBe('{ a?: string }[]');
    expect(formatType({ type: 'array', items: { type: 'string' } }, ctx())).toBe('string[]');
    expect(formatType({ type: 'array', items: { type: 'object', additionalProperties: {} } }, ctx()))
      .toBe('Record<string, any>[]');
  });

  it('ignores `&`-free nesting when deciding to parenthesize (no stray brackets)', () => {
    // `Enum<'a' | 'b'>` and markdown links carry `<>`/`[]`/`()` that must not
    // confuse the depth scan into either adding or skipping parens.
    expect(formatType({ type: 'array', items: { enum: ['a', 'b'] } }, ctx()))
      .toBe("Enum<'a' | 'b'>[]");
    expect(formatType({ type: 'array', items: { $ref: '#/$defs/Field' } }, {
      defs: {},
      currentSchema: 'Probe',
      schemaHref: () => '/docs/references/data/field#field',
    })).toBe('[Field](/docs/references/data/field#field)[]');
  });

  it('marks required vs optional keys on an open object the same way a closed one does', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: { id: { type: 'string' }, color: { type: 'string' } },
        required: ['id'],
        additionalProperties: {},
      },
      ctx(),
    );
    expect(rendered).toBe('{ id: string; color?: string } & Record<string, any>');
  });

  it('keeps the typed catchall in the marker instead of widening it to `any`', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: { type: 'string' },
      },
      ctx(),
    );
    expect(rendered).toBe('{ name: string } & Record<string, string>');
  });

  it('still elides beyond the fourth declared key, and the marker survives the elision', () => {
    const props: Record<string, any> = {};
    for (const k of ['a', 'b', 'c', 'd', 'e']) props[k] = { type: 'string' };
    const rendered = formatType(
      { type: 'object', properties: props, required: ['a', 'b', 'c', 'd', 'e'], additionalProperties: {} },
      ctx(),
    );
    // `…` means "more DECLARED keys"; `& Record` means "more UNDECLARED keys".
    // They are different facts and the cell must carry both.
    expect(rendered).toBe('{ a: string; b: string; c: string; d: string; … } & Record<string, any>');
  });
});

/**
 * The real `AiModelsResponse.models` node, as `gen:schema` emits it —
 * `z.union([z.string(), z.object({ id, label, default })]).array()`.
 */
const AI_MODELS = {
  type: 'array',
  items: {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          default: { type: 'boolean' },
        },
        required: ['id', 'label', 'default'],
        additionalProperties: false,
      },
    ],
  },
};

/** The real `View.list.filter[].value` node — a union that CONTAINS an array. */
const VIEW_FILTER_VALUE = {
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
  ],
};

/**
 * Pin for arrays whose ELEMENT is a union — #5338.
 *
 * Same associativity fact as the intersection half above, one operator over:
 * `[]` binds tighter than `|`, so `string | number[]` is `string | (number[])`
 * — "a string, OR an array of numbers" — while the schema said "an array whose
 * elements are string or number". An author copying that cell writes a bare
 * string and the schema rejects it. This half is OLDER than #4912 (it predates
 * the passthrough fix entirely); #4912 scoped its scan to `&` on purpose so its
 * ~12-line regeneration wouldn't be buried under this one's ~200.
 *
 * MEASURED (reverse verification): narrowing the scan back to `&` alone — the
 * pre-#5338 `hasTopLevelIntersection` — turns 5 of this block's 7 cases red
 * with the unbracketed spelling (`string | { id: string; … }[]` etc.), while
 * every case in the `&` block above stays green. The direction is the ordinary
 * one because these assert a POSITIVE shape the fix produces, not the absence
 * of a finding. The two that stay green under the narrow scan are honest
 * non-regressions rather than dead pins: the mixed union+intersection case was
 * ALREADY bracketed by the `&` half (it carries both operators), and the last
 * case asserts the parens are NOT added, which is the half of the rule this
 * change must not break.
 */
describe('formatType — union elements are parenthesized before `[]` (#5338)', () => {
  it('brackets a union of primitives instead of letting `[]` claim the last variant', () => {
    expect(formatType({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, ctx()))
      .toBe('(string | number)[]');
    expect(
      formatType(
        { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] } },
        ctx(),
      ),
    ).toBe('(string | number | boolean)[]');
    // `oneOf` is the same node class and must render identically.
    expect(formatType({ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } }, ctx()))
      .toBe('(string | number)[]');
  });

  it('brackets a union whose variants are objects (the AiModelsResponse specimen)', () => {
    expect(formatType(AI_MODELS, ctx()))
      .toBe('(string | { id: string; label: string; default: boolean })[]');
  });

  it('brackets a JSON Schema type-array element (`type: [a, b]`), which also renders a union', () => {
    expect(formatType({ type: 'array', items: { type: ['string', 'null'] } }, ctx()))
      .toBe('(string | null)[]');
  });

  it('brackets the ARRAY VARIANT inside a union, leaving the outer union unbracketed', () => {
    // The `View.list.filter[].value` cell. The outer union is not suffixed by
    // `[]`, so it needs no parens; the inner array element does.
    expect(formatType(VIEW_FILTER_VALUE, ctx()))
      .toBe('string | number | boolean | null | (string | number)[]');
  });

  it('brackets once per array level, so nested arrays stay readable', () => {
    expect(
      formatType(
        { type: 'array', items: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } } },
        ctx(),
      ),
    ).toBe('(string | number)[][]');
  });

  it('brackets a union that also carries an intersection variant', () => {
    const open = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: {} };
    expect(formatType({ type: 'array', items: { anyOf: [{ type: 'string' }, open] } }, ctx()))
      .toBe('(string | { a?: string } & Record<string, any>)[]');
  });

  it('adds NO parens when the element has no top-level operator', () => {
    // A single-variant union renders as one type — bracketing it would be noise.
    expect(formatType({ type: 'array', items: { anyOf: [{ type: 'string' }] } }, ctx())).toBe('string[]');
    // `|` inside `Enum<…>`, a shape, a `Record<…>` argument or a link target is
    // nested, and the depth scan must keep ignoring it.
    expect(formatType({ type: 'array', items: { enum: ['a', 'b'] } }, ctx())).toBe("Enum<'a' | 'b'>[]");
    expect(
      formatType(
        { type: 'array', items: { type: 'object', properties: { k: { anyOf: [{ type: 'string' }, { type: 'number' }] } } } },
        ctx(),
      ),
    ).toBe('{ k?: string | number }[]');
    expect(
      formatType(
        { type: 'array', items: { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, { type: 'number' }] } } },
        ctx(),
      ),
    ).toBe('Record<string, string | number>[]');
    expect(formatType({ type: 'array', items: { $ref: '#/$defs/Field' } }, {
      defs: {},
      currentSchema: 'Probe',
      schemaHref: () => '/docs/references/data/field#field',
    })).toBe('[Field](/docs/references/data/field#field)[]');
  });
});

describe('formatType — the shapes that were already right stay right', () => {
  it('renders a pure record (no declared keys) as a bare Record', () => {
    expect(formatType({ type: 'object', additionalProperties: { type: 'number' } }, ctx()))
      .toBe('Record<string, number>');
    expect(formatType({ type: 'object', additionalProperties: {} }, ctx()))
      .toBe('Record<string, any>');
  });

  it('renders a closed object (`additionalProperties: false`) with no openness marker', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      ctx(),
    );
    expect(rendered).toBe('{ id: string }');
    expect(rendered).not.toContain('Record');
  });

  it('renders a shapeless object as `object`', () => {
    expect(formatType({ type: 'object' }, ctx())).toBe('object');
  });

  it('treats an EMPTY declared-key set as no shape at all, not as `{  }`', () => {
    // `z.object({}).passthrough()` declares nothing — intersecting an empty
    // shape onto the record would print `{  } & Record<...>`, which is noise.
    expect(formatType({ type: 'object', properties: {}, additionalProperties: {} }, ctx()))
      .toBe('Record<string, any>');
    // Without a catchall the pre-existing rendering is kept verbatim.
    expect(formatType({ type: 'object', properties: {} }, ctx())).toBe('{  }');
  });

  it('keeps nested objects opaque so a table cell cannot explode', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: { inner: { type: 'object', properties: { deep: { type: 'string' } } } },
        additionalProperties: {},
      },
      ctx(),
    );
    expect(rendered).toBe('{ inner?: object } & Record<string, any>');
  });

  it('still links a $ref through the injected resolver', () => {
    const rendered = formatType({ $ref: '#/$defs/Field' }, {
      defs: {},
      currentSchema: 'Probe',
      schemaHref: (n) => `/docs/references/data/field#${n.toLowerCase()}`,
    });
    expect(rendered).toBe('[Field](/docs/references/data/field#field)');
  });
});

/**
 * The `retiredKey()` tombstone node, verbatim as `z.toJSONSchema` emits it.
 *
 * Probed against the real converter (`z.toJSONSchema(z.object({ heading:
 * retiredKey('…') }), { target: 'draft-2020-12' })`) rather than guessed: the
 * node is `{ description, not: {} }` in BOTH the `output` and the `io: 'input'`
 * direction `build-schemas.ts` falls back to. No `type`, no `$ref`, no `enum` —
 * which is precisely why it used to reach the `prop.type || 'any'` tail.
 */
const tombstone = (guidance: string) => ({ description: `[REMOVED] ${guidance}`, not: {} });

/** The real `Typography.fontFamily` node — one live key, two tombstones (#5021). */
const THEME_FONT_FAMILY = {
  type: 'object',
  properties: {
    base: { type: 'string', description: 'Base font family (default: system fonts)' },
    heading: tombstone('`theme.typography.fontFamily.heading` was removed in …'),
    mono: tombstone('`theme.typography.fontFamily.mono` was removed in …'),
  },
  additionalProperties: false,
};

/**
 * The five `Theme`/`Typography` tombstones that DO own a table row (#5021).
 * Their description column keeps the prescription; the type cell said `any`.
 */
const THEME_TOMBSTONES = {
  type: 'object',
  properties: {
    animation: tombstone('`theme.animation` was removed in …'),
    zIndex: tombstone('`theme.zIndex` was removed in …'),
    fontSize: tombstone('`theme.typography.fontSize` was removed in …'),
    fontWeight: tombstone('`theme.typography.fontWeight` was removed in …'),
    lineHeight: tombstone('`theme.typography.lineHeight` was removed in …'),
  },
  additionalProperties: false,
} as { type: string; properties: Record<string, any>; additionalProperties: boolean };

/** The real `ObjectSchema.indexes` element — three live keys, two tombstones (#5248). */
const INDEX_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      fields: { type: 'array', items: { type: 'string' } },
      unique: { anyOf: [{ type: 'boolean' }, { const: 'global' }, { const: 'organization' }] },
      type: tombstone('`indexes[].type` was removed in …'),
      partial: tombstone('`indexes[].partial` was removed in …'),
    },
    required: ['fields'],
    additionalProperties: false,
  },
};

/**
 * Pin for how the renderer prints a `retiredKey()` tombstone — #5606.
 *
 * `retiredKey()` (`src/shared/retired-key.ts`) is `z.never()`, which
 * `z.toJSONSchema` emits as `{ "not": {} }`. That node carries no `type`, no
 * `$ref` and no `enum`, so it fell through every branch of `formatType` to the
 * `prop.type || 'any'` tail and the reference pages printed **`any`**. That is
 * the worst available rendering for a removed key: to an author — very often an
 * AI one (ADR-0033), for whom these pages are the primary input — `heading?:
 * any` does not read "deleted", it reads "this slot exists and nothing
 * validates it", i.e. MORE inviting than the `heading?: string` it replaced.
 *
 * A top-level tombstone at least got its `[REMOVED]` prescription in the
 * description column of its own table row. A tombstone nested inside an inline
 * shape summary got nothing: the summary prints `k?: type` and has no
 * description column at all. `content/docs/references/ui/theme.mdx` carried
 * `{ base?: string; heading?: any; mono?: any }` with the two prescriptions
 * appearing NOWHERE on the page.
 *
 * Two halves, both pinned below:
 *
 *   1. `{ not: {} }` → `never`. Accurate TypeScript (the key's `z.input` type
 *      IS `never`) and self-evident in a summary cell.
 *   2. Tombstones are filtered out of the inline summary BEFORE
 *      `INLINE_KEY_LIMIT` counts. #5248 is why this is not cosmetic: it retired
 *      `IndexSchema` down to three live keys, so with a limit of four the first
 *      tombstone is mathematically guaranteed into the summary — the #5050
 *      workaround of "move the tombstone to the bottom of the shape" cannot
 *      work once live keys < the limit.
 *
 * MEASURED (reverse verification), run one half at a time. The direction is the
 * ordinary one for both — restore the defect, the new pins go red — because
 * these assert a POSITIVE rendering the fix produces, not the absence of a
 * finding:
 *
 *   - Commenting out the `isNeverNode` early return: **3 failed | 24 passed**.
 *     The three reds are this block's `never` assertions, each reporting
 *     `expected 'any' to be 'never'` (and `'any[]' to be 'never[]'`). The
 *     fourth case here stays green ON PURPOSE — it asserts a NON-`never`
 *     rendering, so it is the over-reach guard, not a dead pin. The whole
 *     second block also stays green, which is the honest signal that the two
 *     halves are independent: filtering a tombstone out of a summary does not
 *     care how it would have rendered.
 *   - Restoring the early return and reverting the summary to an unfiltered
 *     `Object.keys(prop.properties)`: **4 failed | 23 passed**, all four in the
 *     second block, reporting the halfway state the `never` branch ALONE would
 *     have shipped — `{ base?: string; heading?: never; mono?: never }`,
 *     `{ dead1?: never; a: string; dead2?: never; b?: string; … }`,
 *     `{ x?: never; y?: never }`. Safer than `any`, still spending the reader's
 *     four slots on keys nobody may write.
 */
describe('formatType — `retiredKey()` tombstones render as `never`, not `any` (#5606)', () => {
  it('renders a bare tombstone node as `never`', () => {
    expect(formatType(tombstone('`x` was removed in …'), ctx())).toBe('never');
    // The `description` is incidental — the node is `never` with or without it.
    expect(formatType({ not: {} }, ctx())).toBe('never');
  });

  it('renders the top-level table-row nodes as `never` (the theme.mdx specimens)', () => {
    // `Theme.animation` / `Theme.zIndex` / `Typography.fontSize` … DO have their
    // own row, so the `[REMOVED]` prescription survives in the description
    // column — but `build-docs.ts` builds the type cell by calling `formatType`
    // on exactly these nodes, and every one of them printed `any`.
    for (const key of ['animation', 'zIndex', 'fontSize', 'fontWeight', 'lineHeight']) {
      expect(formatType(THEME_TOMBSTONES.properties[key], ctx())).toBe('never');
    }
  });

  it('recurses consistently — `never` survives the array and union branches', () => {
    // Not live specimens (no schema writes `z.array(z.never())` today); these
    // pin that the tombstone check stays AHEAD of the structural branches, so a
    // future nesting cannot reopen the `any` hole one level down.
    expect(formatType({ type: 'array', items: tombstone('`x` …') }, ctx())).toBe('never[]');
    expect(formatType({ anyOf: [{ type: 'string' }, tombstone('`x` …')] }, ctx()))
      .toBe('string | never');
  });

  it('does NOT match a non-empty `not` — that is a negation constraint, not `never`', () => {
    expect(formatType({ type: 'string', not: { const: 'reserved' } }, ctx())).toBe('string');
    expect(formatType({ not: { type: 'string' } }, ctx())).toBe('any');
    // `not: null` must not throw on the `Object.keys` probe.
    expect(formatType({ type: 'number', not: null }, ctx())).toBe('number');
  });
});

describe('formatType — tombstones leave the inline summary to the live keys (#5606)', () => {
  it('drops the two tombstones from `Typography.fontFamily` (the theme.mdx specimen)', () => {
    // Was: `{ base?: string; heading?: any; mono?: any }`, with the two
    // `[REMOVED]` prescriptions appearing nowhere on the page.
    expect(formatType(THEME_FONT_FAMILY, ctx())).toBe('{ base?: string }');
  });

  it('shows all three live `IndexSchema` keys — the #5248 boundary the workaround cannot reach', () => {
    // Was: `{ name?: string; fields: string[]; unique?: …; type?: any; … }[]`.
    // Three live keys < INLINE_KEY_LIMIT, so the summary is now COMPLETE: no
    // `…`, and the cell's promise "these are all the keys" is true.
    const rendered = formatType(INDEX_SCHEMA, ctx());
    expect(rendered).toBe(
      "{ name?: string; fields: string[]; unique?: boolean | 'global' | 'organization' }[]",
    );
    expect(rendered).not.toContain('…');
    expect(rendered).not.toContain('type?');
    expect(rendered).not.toContain('partial?');
  });

  it('spends the limit on live keys only — a tombstone never elides a live key', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: {
          dead1: tombstone('`dead1` …'),
          a: { type: 'string' },
          dead2: tombstone('`dead2` …'),
          b: { type: 'string' },
          c: { type: 'string' },
          d: { type: 'string' },
          e: { type: 'string' },
        },
        required: ['a'],
        additionalProperties: false,
      },
      ctx(),
    );
    // Four LIVE keys shown, `…` for the fifth live one. Before the filter, two
    // of the four slots went to removed keys and `c`/`d`/`e` were all elided.
    expect(rendered).toBe('{ a: string; b?: string; c?: string; d?: string; … }');
  });

  it('renders a shape whose every key is a tombstone as no shape at all', () => {
    const allDead = {
      type: 'object',
      properties: { x: tombstone('`x` …'), y: tombstone('`y` …') },
      additionalProperties: false,
    };
    // Nothing authorable is left, which is the same fact `z.object({})` states.
    expect(formatType(allDead, ctx())).toBe('{  }');
    // …and with a catchall, the record rendering wins rather than printing
    // `{  } & Record<…>` — the pre-existing rule, unchanged.
    expect(formatType({ ...allDead, additionalProperties: {} }, ctx())).toBe('Record<string, any>');
  });
});

/**
 * The real `FormSection.columns` node, as `gen:schema` emits it — probed
 * against the converter, not guessed:
 * `z.toJSONSchema(z.object({ columns: z.union([z.enum(['1','2','3','4']),
 * z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1) }),
 * { target: 'draft-2020-12' })` yields this in BOTH the `output` and the
 * `io: 'input'` direction `build-schemas.ts` falls back to.
 */
const FORM_SECTION_COLUMNS = {
  default: 1,
  anyOf: [
    { type: 'string', enum: ['1', '2', '3', '4'] },
    { type: 'number', const: 1 },
    { type: 'number', const: 2 },
    { type: 'number', const: 3 },
    { type: 'number', const: 4 },
  ],
};

/**
 * Pin for NON-STRING literals — #5729.
 *
 * The `enum` and `const` branches quoted every value unconditionally
 * (`.map(e => `'${e}'`)` / `return `'${prop.const}'``), so a numeric literal
 * union was written down as a string one. `FormSection.columns` is the specimen
 * the issue was filed from: `content/docs/references/ui/view.mdx:184` printed
 * `Enum<'1' | '2' | '3' | '4'> | '1' | '2' | '3' | '4'`, where the second half
 * is the four `z.literal(<number>)` variants — rendered identically to the four
 * string ones, so the cell claimed the key takes strings only while the schema
 * takes both `2` and `'2'`.
 *
 * Why it is worth a pin rather than a one-line sweep: these pages are the
 * authoritative input for AI authors (ADR-0033) and a literal union is a
 * copy-the-spelling surface — the quotes get copied. #5611 was the live cost:
 * its `RecordDetailsProps.sections[].columns` was meant to be a numeric literal
 * union, the generated reference said strings, and the PR gave up the shape for
 * `z.number().int().min(1).max(4)`. The generator was defining the contract
 * backwards, which is the class this block exists to keep closed.
 *
 * MEASURED (reverse verification): restoring the unconditional quoting in BOTH
 * branches — `.map((e: any) => `'${e}'`)` and `return `'${prop.const}'`` — gives
 * **5 failed | 30 passed**. The five reds are exactly the five cases below that
 * assert a non-string literal, reporting `expected ''2'' to be '2'`,
 * `expected ''true'' to be 'true'`, `expected 'Enum<'1' | '2'>' to be
 * 'Enum<1 | 2>'`, `expected ''1' | '2'' to be '1 | 2'`, and the `columns` cell
 * back to its issue-report spelling. The direction is the ordinary one (restore
 * the defect → the new pins go red) because these assert a POSITIVE rendering
 * the fix produces, not the absence of a finding.
 *
 * The three `STRING literals are UNTOUCHED` cases stay green under both
 * versions, and are split into their own `it`s for that reason: an assertion
 * that only ever runs in the shadow of a red sibling proves nothing. They are
 * the over-reach guard — a fix that simply *deleted* the quotes, rather than
 * choosing per `typeof`, turns those three red instead and would be caught
 * here. Their staying green is also why the bug survived this long: the
 * renderer was correct on the only literal kind anyone thought to look at.
 *
 * (An earlier draft of this comment predicted "4 red, 2 green" and was wrong on
 * both counts — the string assertions were then sharing an `it` with the
 * numeric ones, so they could not stay green independently. The numbers above
 * are the re-measured ones after that split.)
 */
describe('formatType — literal quoting follows `typeof`, not habit (#5729)', () => {
  it('renders a numeric literal bare', () => {
    // `z.literal(2)` — the issue's headline case.
    expect(formatType({ type: 'number', const: 2 }, ctx())).toBe('2');
    expect(formatType({ type: 'integer', const: 0 }, ctx())).toBe('0');
    expect(formatType({ type: 'number', const: -1.5 }, ctx())).toBe('-1.5');
  });

  it('renders boolean and null literals as the keywords they are', () => {
    expect(formatType({ type: 'boolean', const: true }, ctx())).toBe('true');
    expect(formatType({ type: 'boolean', const: false }, ctx())).toBe('false');
    // `const: null` reaches the branch (`null !== undefined`) and used to print
    // `'null'` — a four-character string type, not the null literal.
    expect(formatType({ type: 'null', const: null }, ctx())).toBe('null');
  });

  it('quotes per VALUE inside an `enum`, so a numeric enum stays numeric', () => {
    // `z.nativeEnum({ A: 1, B: 2 })` emits a NUMERIC enum — same branch.
    expect(formatType({ type: 'number', enum: [1, 2] }, ctx())).toBe('Enum<1 | 2>');
    // JSON Schema states member types per value, so a mixed `enum` must render
    // mixed. A node-level `type` test would get this one wrong.
    expect(formatType({ enum: ['a', 1, true, null] }, ctx())).toBe("Enum<'a' | 1 | true | null>");
  });

  it('renders a union of numeric literals as bare numbers (the #5611 shape)', () => {
    expect(
      formatType({ anyOf: [{ type: 'number', const: 1 }, { type: 'number', const: 2 }] }, ctx()),
    ).toBe('1 | 2');
    // …and the array form still parenthesizes: `1 | 2[]` would claim "the
    // number 1, or an array of 2s". The depth scan is unchanged by this fix,
    // but it now scans a cell with no quotes in it.
    expect(
      formatType(
        { type: 'array', items: { anyOf: [{ type: 'number', const: 1 }, { type: 'number', const: 2 }] } },
        ctx(),
      ),
    ).toBe('(1 | 2)[]');
  });

  it('renders the `FormSection.columns` cell end-to-end as view.mdx must show it', () => {
    // Was: `Enum<'1' | '2' | '3' | '4'> | '1' | '2' | '3' | '4'` — the two
    // halves indistinguishable. Now the string half keeps its quotes and the
    // numeric half loses them, which is the ONLY difference the page needed.
    expect(formatType(FORM_SECTION_COLUMNS, ctx())).toBe("Enum<'1' | '2' | '3' | '4'> | 1 | 2 | 3 | 4");
  });

  // ---- STRING literals are UNTOUCHED. Green before and after; see the block
  // comment above for why they are separate `it`s rather than extra lines in
  // the cases above.

  it('keeps a string `const` quoted — the distinction the fix exists to make', () => {
    // Same *spelling* as `z.literal(2)` in the schema source, different type.
    // The quotes are the only thing telling the two apart on the page.
    expect(formatType({ type: 'string', const: '2' }, ctx())).toBe("'2'");
    expect(formatType({ type: 'string', const: 'global' }, ctx())).toBe("'global'");
  });

  it('keeps a string `enum` quoted', () => {
    expect(formatType({ type: 'string', enum: ['a', 'b'] }, ctx())).toBe("Enum<'a' | 'b'>");
  });

  it('leaves the string `const`s already on the pages exactly as they render today', () => {
    // `ObjectSchema.indexes[].unique` — `z.union([z.boolean(),
    // z.literal('global'), z.literal('organization')])`. Its two string
    // literals are the regression risk of this change, so they are asserted
    // through the same real node the tombstone block uses.
    expect(formatType(INDEX_SCHEMA, ctx())).toBe(
      "{ name?: string; fields: string[]; unique?: boolean | 'global' | 'organization' }[]",
    );
  });
});

/** The real `BulkActionParam.type` vocabulary — the 49 standard field types. */
const FIELD_TYPES = [
  'text', 'textarea', 'email', 'url', 'phone', 'password', 'secret', 'markdown', 'html',
  'richtext', 'number', 'currency', 'percent', 'date', 'datetime', 'time', 'boolean',
  'toggle', 'select', 'multiselect', 'radio', 'checkboxes', 'lookup', 'master_detail',
  'tree', 'user', 'image', 'file', 'avatar', 'video', 'audio', 'formula', 'summary',
  'autonumber', 'composite', 'repeater', 'record', 'location', 'address', 'code', 'json',
  'color', 'rating', 'slider', 'signature', 'qrcode', 'progress', 'tags', 'vector',
];

/** The real `BulkActionDef.params` node — the instance #5340 was filed on. */
const BULK_ACTION_PARAMS = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      label: { type: 'string' },
      help: { type: 'string' },
      type: { type: 'string', enum: FIELD_TYPES },
      required: { type: 'boolean' },
    },
    required: ['name', 'type'],
    additionalProperties: {},
  },
};

/**
 * The real `ErrorResponse` shape from `api/*.mdx`, at its real member count.
 *
 * The leading codes are verbatim (they are what the elided cell must show); the
 * tail is generated to the true length of 261 rather than pasted, because what
 * is under test past the seventh member is the COUNT, and 5KB of fixture would
 * assert nothing the count does not. The page-level truth of that 261 is pinned
 * by the regeneration diff, not here.
 */
const ERROR_CODES = [
  'VALIDATION_ERROR', 'INVALID_FIELD', 'MISSING_REQUIRED_FIELD', 'INVALID_FORMAT',
  'VALUE_TOO_LONG', 'VALUE_TOO_SHORT', 'VALUE_OUT_OF_RANGE', 'INVALID_REFERENCE',
  ...Array.from({ length: 253 }, (_, i) => `GENERATED_CODE_${i}`),
];

const ERROR_RESPONSE = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', enum: ERROR_CODES },
          message: { type: 'string' },
        },
        required: ['code', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['success'],
  additionalProperties: false,
};

/** Members of a fixed 10-character width, so a case can be placed by count. */
const sized = (n: number) => Array.from({ length: n }, (_, i) => `v${String(i).repeat(9)}`);

/**
 * Pin for over-wide enums inside an inline shape summary — #5340.
 *
 * `INLINE_KEY_LIMIT` capped how many KEYS a summary prints; nothing capped how
 * wide one key's TYPE could be. A long enum reached through a summary therefore
 * printed every member, and one table cell reached **6242 characters** — the
 * 261-member error-code vocabulary inlined into the `error` shape of 80 rows
 * across 13 `api/*.mdx` pages. The issue was filed on the smaller
 * `BulkActionDef.params` (~900), which turned out not to be close to the worst.
 *
 * The renderer now elides to `INLINE_ENUM_WIDTH_LIMIT` (80 characters of body,
 * measured — see the constant) and prints `… +N more` in place of what it cut.
 * The count is the whole safety property: a bare prefix would leave the page
 * looking complete while it wasn't, which is a worse defect than a wide cell,
 * and is why "truncate silently" was never on the table.
 *
 * Two things deliberately NOT elided, each with its own `it` below:
 *
 *   1. A vocabulary's OWN row (`BulkActionParam.type`, `ErrorResponse.code`) —
 *      printing the full list IS that cell's job, and for 457 of the corpus's
 *      805 in-shape occurrences it is where the elided copy's full list still
 *      lives, on the same page.
 *   2. A top-level union variant (`Enum<…> | string`, the `PageComponent.type`
 *      shape). It reads like a nested position but is the key's own row too, and
 *      no second copy exists anywhere.
 *
 * MEASURED (reverse verification), both directions, run one at a time. The
 * direction is the ordinary one — restore a defect, the pins that assert the
 * fixed rendering go red — because every case here asserts a POSITIVE string,
 * not the absence of a finding. Both numbers are re-measured, not predicted; a
 * first draft of this comment guessed "6 failed | 41 passed" for the first one
 * and "those five" for the second, and was wrong on both counts:
 *
 *   - Restoring the pre-change enum branch (`return `Enum<${prop.enum.map(…)
 *     .join(' | ')}>``, i.e. no elision at any depth): **7 failed | 44 passed**.
 *     The seven are every assertion expecting a `… +N more` marker — the six in
 *     this block, plus `elides at the first width where the marker DOES pay for
 *     itself` in the boundary block below, which the draft had filed as an
 *     over-reach guard when it is a positive assertion like the rest.
 *   - Eliding UNCONDITIONALLY (`formatEnum(prop.enum, true)` — the obvious
 *     one-line version of this change, which deletes the only full copy of
 *     several vocabularies from the docs): **5 failed | 46 passed**. Four of
 *     them are the `NOT elided` block; the fifth is `does not elide when no
 *     `ctx` is passed`. Everything in this block stays green, which is the
 *     honest signal that position and width are independent facts.
 *
 * `leaves short enums inside a summary exactly as they render today` is the one
 * `NOT elided` case green under BOTH — a two-member enum is under budget either
 * way — so it guards the budget rather than the position, and would be the pin
 * that catches a future limit tightened until it bites the ordinary cells. The
 * cases are separate `it`s for the #5729 reason: an assertion that only ever
 * runs in the shadow of a red sibling proves nothing.
 */
describe('formatType — over-wide enums inside a shape summary are elided with a count (#5340)', () => {
  it('renders the `BulkActionDef.params` cell as a sample plus a count (the filed instance)', () => {
    const rendered = formatType(BULK_ACTION_PARAMS, ctx());
    expect(rendered).toBe(
      "({ name: string; label?: string; help?: string; type: Enum<'text' | 'textarea' | " +
        "'email' | 'url' | 'phone' | 'password' | 'secret' | …>; … } & " +
        'Record<string, any>)[]',
    );
    // 7 of the 49 the schema declares are spelled. The marker says THAT the cell
    // is a sample; since #9182 it no longer says how big the vocabulary is —
    // that magnitude lives on the row that actually prints the members, which is
    // the only page position that can substantiate it.
    expect(FIELD_TYPES.length).toBe(49);
    expect(rendered.match(/'/g)!.length / 2).toBe(7);
    // The cell that motivated the issue, before and after.
    expect(rendered.length).toBe(165);
  });

  it('elides through a WRAPPER reached from a summary — array of enum', () => {
    // REPLACED FIXTURE (#6374). This case used to run on `ERROR_RESPONSE`, whose
    // enum sat two SHAPE levels down (`{ success; error?: { code: Enum<…> }[] }`)
    // — a route the shape budget closes: that inner shape now prints `object`,
    // so there is no enum there left to elide and the old assertion could only
    // have been kept by asserting an emptiness. What #5340 actually claims is
    // that the elision composes through the wrappers between a summary and a
    // vocabulary, and that is still true and still worth pinning — the budget
    // stops the renderer re-entering the OBJECT branch, it does not sever
    // `inShapeSummary` from arrays and records. `ERROR_RESPONSE` keeps its job
    // one block down, where it now pins the budget itself.
    const rendered = formatType(
      { type: 'object', properties: { codes: { type: 'array', items: { type: 'string', enum: ERROR_CODES } } } },
      ctx(),
    );
    expect(rendered).toContain('…>');
    // The elision fired on a 261-member vocabulary; the cell no longer restates
    // that cardinality (#9182), so the pin is that it was CUT, not by how much.
    expect(ERROR_CODES.length).toBe(261);
    expect(rendered).not.toContain('more');
    // Still an array OF the elided vocabulary, not an elided array.
    expect(rendered.endsWith('>[] }')).toBe(true);
    // Was 5000+ characters in one table cell.
    expect(rendered.length).toBeLessThan(150);
  });

  it('keeps the shown members in schema order, so the sample is the leading terms', () => {
    const rendered = formatType(
      { type: 'object', properties: { k: { type: 'string', enum: sized(20) } } },
      ctx(),
    );
    expect(rendered).toBe(
      "{ k?: Enum<'v000000000' | 'v111111111' | 'v222222222' | 'v333333333' | " +
        "'v444444444' | …> }",
    );
  });

  it('elides a NUMERIC enum without inventing quotes (#5729 stays intact one level down)', () => {
    const rendered = formatType(
      { type: 'object', properties: { k: { type: 'number', enum: Array.from({ length: 40 }, (_, i) => i * 1000) } } },
      ctx(),
    );
    // Bare numbers, and the marker is the only unquoted non-number in the cell.
    expect(rendered).toBe(
      '{ k?: Enum<0 | 1000 | 2000 | 3000 | 4000 | 5000 | 6000 | 7000 | 8000 | 9000 | ' +
        '10000 | 11000 | …> }',
    );
    expect(rendered).not.toContain("'");
  });

  it('leaves the key elision `…` and the openness marker doing their own jobs', () => {
    // Three different elisions can meet in one cell and must stay legible:
    // `…` (enum members), `…` (further live keys), `& Record` (undeclared keys).
    // #5606's tombstone filter still runs BEFORE the key limit.
    //
    // The first two are now the SAME token, which is the point rather than a
    // collision (#9182): both sit inside a summary that is already a sample, and
    // the key elision has never quantified what it withheld. A reader meeting
    // `…` twice in this cell reads one rule — "there is more of this here" —
    // instead of two notations that differ only in a number they cannot check
    // against anything printed on the page. `& Record<string, any>` stays
    // distinct because it states a different fact: the shape is OPEN, not
    // sampled.
    const rendered = formatType(
      {
        type: 'object',
        properties: {
          dead: tombstone('`dead` …'),
          a: { type: 'string', enum: FIELD_TYPES },
          b: { type: 'string' },
          c: { type: 'string' },
          d: { type: 'string' },
          e: { type: 'string' },
        },
        required: ['a'],
        additionalProperties: {},
      },
      ctx(),
    );
    expect(rendered).toBe(
      "{ a: Enum<'text' | 'textarea' | 'email' | 'url' | 'phone' | 'password' | 'secret' | " +
        '…>; b?: string; c?: string; d?: string; … } & Record<string, any>',
    );
    expect(rendered).not.toContain('dead');
  });

  it('elides inside a `Record<…>` catchall reached from a summary', () => {
    const rendered = formatType(
      {
        type: 'object',
        properties: {
          perms: {
            type: 'array',
            items: { type: 'object', additionalProperties: { type: 'string', enum: sized(20) } },
          },
        },
      },
      ctx(),
    );
    expect(rendered).toContain('…>');
    expect(rendered).toContain('Record<string, Enum<');
  });
});

/**
 * THE REGRESSION THIS BLOCK EXISTS TO STOP, stated as the measurement that
 * motivated it (#9182).
 *
 * `+N more` is a function of a vocabulary's cardinality, so every page carrying
 * the marker was rewritten whenever the vocabulary grew by one. Measured on
 * `ApiError.code` (288 members) by registering a single error code and
 * regenerating: **11 reference pages, 69 lines — 66 of them this marker**, and 9
 * of the 11 pages (`analytics`, `auth`, `automation-api`, `batch`, `export`,
 * `metadata`, `package-api`, `protocol`, `storage`) contained NOTHING ELSE,
 * 100% of their changed lines being `+285 more` → `+286 more`.
 *
 * The ledger is a per-PR append, so that made any two PRs registering a code
 * mutually exclusive by construction — and the generated pages produce no
 * conflict markers when a merge drops one side, which is the silent-drop
 * signature the regen driver is already known for. Re-adding the count here
 * re-creates that serialization point, which is why it is pinned rather than
 * left to the corpus to notice.
 */
describe('formatType — the in-shape marker is INVARIANT to vocabulary growth (#9182)', () => {
  const inShape = (members: unknown[]) =>
    formatType({ type: 'object', properties: { k: { type: 'string', enum: members } } }, ctx());

  it('renders a byte-identical cell for a vocabulary that grew by one', () => {
    expect(inShape(sized(31))).toBe(inShape(sized(30)));
    expect(inShape(sized(30))).not.toContain('more');
  });

  it('still states that the cell is a sample — #5340 barred a SILENT prefix, not an unquantified one', () => {
    // The distinction #5340 actually required is "7-member vocabulary" vs
    // "first 7 of 49", and `…` carries it without a number: present when the
    // body was cut, absent when the cell is complete.
    expect(inShape(sized(30))).toContain('…');
    expect(inShape(sized(2))).not.toContain('…');
  });

  it('keeps the count where the page prints the members to check it against', () => {
    // `formatPropertyType` relocates the vocabulary into an `### Allowed Values`
    // list directly below the table, so its count is verifiable by the reader —
    // and that page is rewritten by a vocabulary change regardless, because it
    // spells the vocabulary. Nothing about #9182 reaches this position.
    const { cell, allowedValues } = formatPropertyType({ type: 'string', enum: sized(30) }, ctx());
    expect(cell).toMatch(/… \+\d+ more>$/);
    expect(allowedValues).toHaveLength(30);
  });
});

describe('formatType — the vocabularies that own their row are NOT elided (#5340)', () => {
  it('prints a top-level enum in full, however wide', () => {
    // `BulkActionParam.type` — the row two sections below the elided copy, and
    // the reason eliding the copy costs the page nothing.
    const rendered = formatType({ type: 'string', enum: FIELD_TYPES }, ctx());
    expect(rendered.length).toBe(561);
    expect(rendered).not.toContain('more');
    expect(rendered).toContain("'vector'");
    // `ErrorResponse.code` — 261 members, and still the only full copy.
    expect(formatType({ type: 'string', enum: ERROR_CODES }, ctx())).not.toContain('more>');
  });

  it('prints a union VARIANT enum in full — it reads nested but is the key’s own row', () => {
    // The `PageComponent.type` shape: `z.union([z.enum([...]), z.string()])`.
    // Nothing else on `ui/page.mdx` carries this vocabulary.
    const rendered = formatType(
      { anyOf: [{ type: 'string', enum: FIELD_TYPES }, { type: 'string' }] },
      ctx(),
    );
    expect(rendered).toBe(`Enum<${FIELD_TYPES.map(t => `'${t}'`).join(' | ')}> | string`);
  });

  it('prints a top-level `Record<string, Enum<…>>` in full', () => {
    // `Permission.tabPermissions` — a record VALUE at the top level is still the
    // key's own row, so it keeps the whole vocabulary.
    const rendered = formatType(
      { type: 'object', additionalProperties: { type: 'string', enum: FIELD_TYPES } },
      ctx(),
    );
    expect(rendered).toBe(`Record<string, Enum<${FIELD_TYPES.map(t => `'${t}'`).join(' | ')}>>`);
  });

  it('prints an ARRAY of a top-level enum in full — `[]` is not a summary', () => {
    expect(formatType({ type: 'array', items: { type: 'string', enum: FIELD_TYPES } }, ctx()))
      .toBe(`Enum<${FIELD_TYPES.map(t => `'${t}'`).join(' | ')}>[]`);
  });

  it('leaves short enums inside a summary exactly as they render today', () => {
    // 76.5% of the corpus's in-shape enums are these, and none of them moves.
    expect(
      formatType({ type: 'object', properties: { dir: { type: 'string', enum: ['asc', 'desc'] } } }, ctx()),
    ).toBe("{ dir?: Enum<'asc' | 'desc'> }");
    expect(formatType(INDEX_SCHEMA, ctx())).toBe(
      "{ name?: string; fields: string[]; unique?: boolean | 'global' | 'organization' }[]",
    );
  });
});

describe('formatType — the elision boundary (#5340)', () => {
  const inShape = (members: unknown[]) =>
    formatType({ type: 'object', properties: { k: { enum: members } } }, ctx());

  it('prints a body AT the 80-character limit whole', () => {
    // 5 members x 10 chars + 4 separators = 72; a 6th would be 87.
    const body = sized(5).map(m => `'${m}'`).join(' | ');
    expect(body.length).toBe(72);
    expect(inShape(sized(5))).toBe(`{ k?: Enum<${body}> }`);
    expect(inShape(sized(5))).not.toContain('more');
  });

  it('prints a body just OVER the limit whole, because the marker would not pay for itself', () => {
    // 87 characters — over the budget, but hiding the single overflowing member
    // saves 3 characters while the marker costs 12. Trading a real spelling for
    // a count there is a loss, so the guard refuses and the cell stays complete.
    const body = sized(6).map(m => `'${m}'`).join(' | ');
    expect(body.length).toBe(87);
    expect(inShape(sized(6))).toBe(`{ k?: Enum<${body}> }`);
    expect(inShape(sized(6))).not.toContain('more');
  });

  it('elides at the first width where the marker DOES pay for itself', () => {
    // 102 characters: 2 members hidden, 18 saved against a 12-character marker.
    //
    // The 12 characters are the QUANTIFIED marker's, and that is deliberate
    // (#9182): the in-shape marker now prints as a bare `…`, but the guard is
    // still measured against `… +N more` so that dropping the count changes the
    // notation and never WHICH bodies elide. Judged against the short marker the
    // boundary would move down, and the two `prints a body … whole` cases above
    // — the ones that pin the refusal — would start eliding.
    expect(sized(7).map(m => `'${m}'`).join(' | ').length).toBe(102);
    expect(inShape(sized(7))).toBe(
      "{ k?: Enum<'v000000000' | 'v111111111' | 'v222222222' | 'v333333333' | " +
        "'v444444444' | …> }",
    );
  });

  it('keeps a single member wider than the whole budget, with no `+0 more`', () => {
    // One member is forced in whatever its width — a sample of zero states
    // nothing — so there is nothing left to count.
    const giant = 'x'.repeat(200);
    const rendered = inShape([giant]);
    expect(rendered).toBe(`{ k?: Enum<'${giant}'> }`);
    expect(rendered).not.toContain('more');
    expect(rendered).not.toContain('+0');
  });

  it('does not elide when no `ctx` is passed at all', () => {
    // Declared degradation, not an oversight: `inShapeSummary` is recursion
    // state carried on `ctx`, so a ctx-less call renders unsummarised — the same
    // way it renders `$ref`s without links. `build-docs.ts` always passes one.
    expect(formatType({ type: 'object', properties: { k: { enum: FIELD_TYPES } } })).toContain(
      "'vector'",
    );
  });
});

/**
 * `build-docs.ts` has always had a rendering for a long vocabulary — a
 * `### Allowed Values` heading and one bullet per member — but it fired only
 * when the WHOLE SCHEMA was `type: 'string'` + `enum`. The identical 49 members
 * inlined onto a PROPERTY got a 561-character table cell instead, and
 * `ApiError.code` got 6092 (#6225). `formatPropertyType` is the mirror of that
 * branch, matched to it condition for condition.
 *
 * REVERSE VERIFICATION, direction predicted BEFORE running. One prediction held
 * and one was WRONG in an informative direction — both recorded as measured:
 *
 *   1. Removing the limb (making `formatPropertyType` always delegate to
 *      `formatType`) was predicted to redden only PART of this block — the
 *      relocation cases — while the cases asserting `allowedValues === null`
 *      stay green, because "no relocation anywhere" is exactly what they
 *      already assert. HELD: **4 failed | 64 passed** in the file, the four
 *      reds all relocation cases, every other block green.
 *   2. The one that actually validates the design: putting the same budget in
 *      `formatType`'s `enum` branch — where a naive fix would put it — was
 *      predicted to redden five PRE-EXISTING #5340 tests, the four
 *      `NOT elided` cases plus `does not elide when no ctx is passed at all`,
 *      because a bare `formatType` call has nowhere to relocate members TO.
 *      MISSED, and low: those five did redden, but so did two of the guards in
 *      THIS block — `does NOT relocate an enum reached through an array, a
 *      record or a union variant` and `does NOT relocate a NUMERIC enum`.
 *      Measured **7 failed | 61 passed**, not the 5 predicted. The two extra
 *      reds are the useful part of the result: the misplacement is caught by
 *      this block on its own, so the contract does not depend on #5340's tests
 *      continuing to exist. That is why the budget is read from
 *      `formatPropertyType` and never from `formatType` — the narrow entry
 *      point is the guarantee that a vocabulary is only ever cut where the full
 *      list is printed underneath it.
 */
describe('formatPropertyType — a property that IS a vocabulary relocates it (#6225)', () => {
  it('cuts the `Field.type` cell to a sample and hands back all 49 members', () => {
    const { cell, allowedValues } = formatPropertyType({ type: 'string', enum: FIELD_TYPES }, ctx());
    // The cell states what it is — a sample of a 49-term vocabulary — never a
    // silent prefix.
    expect(cell).toMatch(/^Enum<'text' \| .* \| … \+\d+ more>$/);
    expect(cell.length).toBeLessThan(200);
    // …and nothing is lost: the caller gets the WHOLE list, in schema order.
    expect(allowedValues).toEqual(FIELD_TYPES);
  });

  it('cuts the 261-member `ApiError.code` cell — the 6092-character filed instance', () => {
    const { cell, allowedValues } = formatPropertyType({ type: 'string', enum: ERROR_CODES }, ctx());
    expect(cell).toContain('… +');
    expect(cell).toContain('more>');
    expect(cell.length).toBeLessThan(200);
    expect(allowedValues).toHaveLength(ERROR_CODES.length);
    expect(allowedValues).toEqual(ERROR_CODES);
  });

  it('states the hidden count exactly — shown members plus the count is the whole vocabulary', () => {
    const { cell, allowedValues } = formatPropertyType({ type: 'string', enum: FIELD_TYPES }, ctx());
    const hidden = Number(/… \+(\d+) more/.exec(cell)![1]);
    const shown = cell.slice('Enum<'.length, -1).split(' | ').filter(m => !m.startsWith('…')).length;
    expect(shown + hidden).toBe(FIELD_TYPES.length);
    expect(allowedValues).toHaveLength(shown + hidden);
  });

  it('leaves an ordinary short vocabulary spelled out in its own cell', () => {
    // The overwhelming majority of the corpus's 893 top-level enums. Nothing
    // moves, and no page grows a section for two members.
    const { cell, allowedValues } = formatPropertyType(
      { type: 'string', enum: ['asc', 'desc'] },
      ctx(),
    );
    expect(cell).toBe("Enum<'asc' | 'desc'>");
    expect(allowedValues).toBeNull();
  });

  it('does NOT relocate an enum reached through an array, a record or a union variant', () => {
    // Each renders an `Enum<…>` somewhere in its cell, but "the allowed values
    // of this property" would be a false statement for all three — the members
    // are the ELEMENT / VALUE / one-variant vocabulary. A bullet list under the
    // table would claim something the schema does not, so they keep the full
    // spelling #5340 left them with.
    const array = formatPropertyType({ type: 'array', items: { type: 'string', enum: FIELD_TYPES } }, ctx());
    expect(array.allowedValues).toBeNull();
    expect(array.cell).toContain("'vector'");

    const record = formatPropertyType(
      { type: 'object', additionalProperties: { type: 'string', enum: FIELD_TYPES } },
      ctx(),
    );
    expect(record.allowedValues).toBeNull();
    expect(record.cell).toContain("'vector'");

    // `ui/page.mdx`'s `PageComponent.type` — `z.union([z.enum([…]), z.string()])`.
    const variant = formatPropertyType(
      { anyOf: [{ type: 'string', enum: FIELD_TYPES }, { type: 'string' }] },
      ctx(),
    );
    expect(variant.allowedValues).toBeNull();
    expect(variant.cell).toContain("'vector'");
  });

  it('does NOT relocate a NUMERIC enum — the bullets would re-quote it (#5729)', () => {
    // The mirrored whole-schema branch is `type === 'string' && enum` too, and
    // the match is deliberate rather than incidental: the bullet list renders
    // each member as `` * `x` ``, which cannot distinguish `2` from `'2'`. A
    // numeric vocabulary keeps its cell, where `formatLiteral` still prints it
    // bare.
    const { cell, allowedValues } = formatPropertyType(
      { type: 'number', enum: Array.from({ length: 60 }, (_, i) => i * 1000) },
      ctx(),
    );
    expect(allowedValues).toBeNull();
    expect(cell).toContain('59000');
    expect(cell).not.toContain("'59000'");
  });

  // Distinct members of a FIXED width (10 characters, 12 once quoted), so the
  // boundary arithmetic below is exact. `sized` above cannot serve here: its
  // members grow from 10 to 19 characters once the index reaches two digits,
  // which is invisible at the 80-character budget it was written for and moves
  // the boundary by 9 characters at 160.
  const fixed = (n: number) => Array.from({ length: n }, (_, i) => String(i).padStart(10, '0'));

  it('prints a body AT the 160-character budget whole', () => {
    // 10 members x 12 chars + 9 separators = 147; an 11th would be 162.
    expect(fixed(10).map(m => `'${m}'`).join(' | ').length).toBe(147);
    const { cell, allowedValues } = formatPropertyType({ type: 'string', enum: fixed(10) }, ctx());
    expect(cell).not.toContain('more');
    expect(allowedValues).toBeNull();
  });

  it('prints a body just OVER the budget whole — and adds no page section for it', () => {
    // 162 characters. Hiding the single overflowing member saves 3 while the
    // marker costs 12, so the guard refuses. The relocation refuses WITH it:
    // this is the case where a whole `### Allowed Values` section would have
    // been added to a page to shave 3 characters off one cell. Measured on the
    // corpus, the guard refuses 7 such sections.
    expect(fixed(11).map(m => `'${m}'`).join(' | ').length).toBe(162);
    const { cell, allowedValues } = formatPropertyType({ type: 'string', enum: fixed(11) }, ctx());
    expect(cell).not.toContain('more');
    expect(allowedValues).toBeNull();
  });

  it('relocates at the first width where the marker DOES pay for itself', () => {
    // 177 characters: 2 members hidden, 18 saved against a 12-character marker.
    expect(fixed(12).map(m => `'${m}'`).join(' | ').length).toBe(177);
    const { cell, allowedValues } = formatPropertyType({ type: 'string', enum: fixed(12) }, ctx());
    expect(cell).toContain('… +2 more>');
    expect(allowedValues).toEqual(fixed(12));
  });

  it('keeps every other property rendering byte-identical to `formatType`', () => {
    // The wrapper is a narrow addition, not a second renderer: anything that is
    // not an over-wide string vocabulary must come back exactly as before.
    for (const node of [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
      INDEX_SCHEMA,
      BULK_ACTION_PARAMS,
      { anyOf: [{ type: 'string' }, { type: 'number' }] },
      { not: {} },
    ]) {
      expect(formatPropertyType(node, ctx()).cell).toBe(formatType(node, ctx()));
      expect(formatPropertyType(node, ctx()).allowedValues).toBeNull();
    }
  });
});

/**
 * A union's width is variant COUNT times variant WIDTH, so neither enum budget
 * can reach it — `ui/app.mdx`'s `App.navigation` printed the same
 * `{ id; label; icon?; order?; … }` shape nine times, seven of them
 * character-identical, for 582 characters (#6226).
 *
 * REVERSE VERIFICATION: raising `VARIANT_LIMIT` past every union in the corpus
 * (i.e. putting the un-capped `variants.map(...).join(' | ')` back) was
 * predicted to redden only the cases that assert a marker, leaving the three
 * that assert a FULL spelling green — because no-cap produces exactly the full
 * spelling those three demand. HELD: **4 failed | 64 passed** in the file, the
 * four reds being precisely the marker cases, and no other block moved.
 */
describe('formatType — a union spells four variants and counts the rest (#6226)', () => {
  /**
   * REPLACED FIXTURE (#6569). The distinguishing key used to be the FIFTH one,
   * i.e. behind `INLINE_KEY_LIMIT`, so every variant this helper built rendered
   * to the same string. That was faithful to `App.navigation` and it is why
   * `… +5 more` used to be reachable here — but once identical spellings
   * collapse, such a fixture exercises the DEDUPE and not the cap, and every
   * case below would be asserting the wrong rule. Moving the unique key inside
   * the limit makes each variant render distinctly, so this block pins the
   * ARITY CAP alone. The identical-spelling reality of `App.navigation` did not
   * disappear with the fixture: it is pinned, faithfully, in the #6569 block.
   */
  const variant = (id: string) => ({
    type: 'object',
    properties: { id: { type: 'string' }, label: { type: 'string' }, [id]: { type: 'string' }, order: { type: 'number' }, icon: { type: 'string' } },
    required: ['id', 'label'],
  });

  it('renders a nine-variant array cell as four variants plus a count', () => {
    const rendered = formatType(
      { type: 'array', items: { anyOf: Array.from({ length: 9 }, (_, i) => variant(`k${i}`)) } },
      ctx(),
    );
    expect(rendered).toContain('… +5 more');
    // Still an ARRAY of that union — the parenthesis #5338 added must survive
    // the elision, or the cell states a different type than the schema.
    expect(rendered.startsWith('(')).toBe(true);
    expect(rendered.endsWith(')[]')).toBe(true);
    expect(rendered.length).toBeLessThan(400);
  });

  it('states the hidden count exactly — shown variants plus the count is the arity', () => {
    const rendered = formatType({ anyOf: Array.from({ length: 7 }, (_, i) => variant(`k${i}`)) }, ctx());
    const hidden = Number(/… \+(\d+) more/.exec(rendered)![1]);
    const shown = rendered.split(' | ').filter(v => !v.startsWith('…')).length;
    expect(shown).toBe(4);
    expect(shown + hidden).toBe(7);
  });

  it('spells a union of exactly four variants in full — the cap is not a cliff at four', () => {
    const rendered = formatType({ anyOf: Array.from({ length: 4 }, (_, i) => variant(`k${i}`)) }, ctx());
    expect(rendered).not.toContain('more');
    expect(rendered.split(' | ')).toHaveLength(4);
  });

  it('leaves the corpus-dominant two-variant union exactly as it renders today', () => {
    // 256 of the corpus's 353 unions are these, and none of them moves.
    expect(formatType({ anyOf: [{ type: 'string' }, { type: 'number' }] }, ctx())).toBe(
      'string | number',
    );
  });

  it('does NOT elide five tiny variants — the marker would cost more than it saves', () => {
    // `string | number | boolean | null | 'x'` is 38 characters; capping it
    // would print 33 + a 12-character marker footprint and come out LONGER. The
    // pay-for-your-marker guard is shared with the enum elisions, so a count
    // never replaces a spelling that was already shorter than the count.
    //
    // REPLACED FIXTURE (#6569). This case used to build FIVE IDENTICAL
    // `string` variants, and that spelling now collapses to `string | … +4
    // more` — 24 characters saved, so the same guard that refused there accepts
    // here. The flip is the contract change #6569 makes and is pinned as such
    // in its own block; what this case is for is the guard's refusal on the
    // CAP, so it needs five variants the cap can actually be asked about, i.e.
    // five DISTINCT ones. Same arity, same guard, same verdict — the fixture
    // just stopped answering a different question than its name.
    const rendered = formatType(
      { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }, { const: 'x' }] },
      ctx(),
    );
    expect(rendered).toBe("string | number | boolean | null | 'x'");
    expect(rendered).not.toContain('more');
  });

  it('elides the same way under `oneOf` as under `anyOf`', () => {
    const rendered = formatType({ oneOf: Array.from({ length: 9 }, (_, i) => variant(`k${i}`)) }, ctx());
    expect(rendered).toContain('… +5 more');
  });

  it('counts a union nested inside a shape summary too — the `Manifest.navigationContributions` cell', () => {
    // REPLACED EXPECTATION (#6569), on the fixture #6374 already replaced once.
    // Below a summary all nine variants render `object`, so after #6569 it is
    // the DEDUPE and not the cap that decides this cell: one spelling survives
    // and the marker counts the other eight. Kept in this block, and kept
    // pointing at the corpus cell it is named for, because the two rules share
    // one marker and this is where a reader checks that they compose — but read
    // it as the composition, not as the cap: no corpus cell is decided by the
    // nested cap alone any more.
    const rendered = formatType(
      {
        type: 'object',
        properties: {
          app: { type: 'string' },
          items: { type: 'array', items: { anyOf: Array.from({ length: 9 }, (_, i) => variant(`k${i}`)) } },
        },
        required: ['app', 'items'],
      },
      ctx(),
    );
    expect(rendered).toBe('{ app: string; items: (object | … +8 more)[] }');
    // 1 spelled + 8 counted = the 9 the schema declares, below a summary exactly
    // as above one: the budget changes what a variant SPELLS and the dedupe
    // changes how many spellings are worth printing, but neither changes the
    // arity the marker reports.
    expect(1 + 8).toBe(9);
  });
});

/**
 * The real `ui/page.mdx` `Page.slots` node, as `gen:schema` emits it — seven
 * slot keys, each a union of `PageComponent` or an array of it, and
 * `PageComponent` inlined by value (not `$ref`d) at all fourteen positions.
 *
 * This is the corpus maximum #6374 was filed on: 1538 characters in one table
 * cell, WITH `INLINE_ENUM_WIDTH_LIMIT` already firing eight times inside it.
 */
const PAGE_COMPONENT = {
  type: 'object',
  properties: {
    type: {
      anyOf: [
        {
          type: 'string',
          enum: [
            'page:header', 'page:footer', 'page:sidebar', 'page:tabs', 'page:accordion',
            'page:card', 'page:section', 'record:details', 'record:highlights',
            'record:related_list', 'record:activity', 'record:chatter', 'record:path',
            'record:alert', 'record:quick_actions', 'record:reference_rail', 'record:history',
            'app:launcher', 'nav:menu', 'nav:breadcrumb', 'global:search',
            'global:notifications', 'user:profile', 'ai:chat_window', 'ai:suggestion',
            'element:text', 'element:number', 'element:image', 'element:divider',
            'element:button', 'element:filter', 'element:form', 'element:record_picker',
            'element:text_input',
          ],
        },
        { type: 'string' },
      ],
    },
    id: { type: 'string' },
    label: { type: 'string' },
    properties: { type: 'object', additionalProperties: {} },
    events: { type: 'object', additionalProperties: {} },
  },
  required: ['type'],
  additionalProperties: false,
};

const PAGE_SLOTS = {
  type: 'object',
  properties: Object.fromEntries(
    ['header', 'actions', 'alerts', 'highlights', 'details', 'tabs', 'discussion'].map(k => [
      k,
      { anyOf: [PAGE_COMPONENT, { type: 'array', items: PAGE_COMPONENT }] },
    ]),
  ),
  additionalProperties: false,
};

/**
 * Pin for the shape-depth budget — #6374.
 *
 * The renderer has always opened exactly ONE `{ … }` level per cell, but it
 * spent that budget in the key loop, so only a DIRECT object child was held to
 * it. An array element, a `Record` value and a union variant each re-entered
 * the object branch with the budget out of scope, and cell width became keys ×
 * variants × shape width, multiplied per level. `SHAPE_DEPTH_LIMIT` moves the
 * same budget to the object branch itself, where all four descents pass.
 *
 * REVERSE VERIFICATION, predicted BEFORE running. Reverting = deleting the
 * `depth >= SHAPE_DEPTH_LIMIT` guard and putting the
 * `child?.type === 'object' && child.properties ? 'object' : …` ternary back.
 * The direction is NOT uniformly red, and that asymmetry is the point of the
 * block: this fix makes an existing rule uniform, so the cases pinning the
 * limb that already existed MUST stay green under the revert or they are not
 * pinning uniformity at all. Predicted:
 *   RED   — every case whose `object` is reached through an array, a `Record`
 *           value or a union variant (the three descents the budget adds), and
 *           the no-`ctx` case, which reaches its `object` through a variant.
 *   GREEN — 'a direct object child was ALREADY opaque' (that IS the ternary),
 *           both 'a wrapper does not spend the budget' cases (one level either
 *           way), and 'a keyless `Record` is not a shape' (the guard sits
 *           inside the declared-keys branch and cannot fire there).
 * Predicted split: 6 red, 4 green.
 * ACTUAL: recorded in the PR body against this prediction.
 */
describe('formatType — one shape level, whichever way down (#6374)', () => {
  it('renders the `Page.slots` cell without re-expanding `PageComponent` (the filed instance)', () => {
    const rendered = formatType(PAGE_SLOTS, ctx());
    expect(rendered).toBe(
      '{ header?: object | object[]; actions?: object | object[]; alerts?: object | object[]; ' +
        'highlights?: object | object[]; … }',
    );
    // 1538 → 122 characters. The vacuity guard for the whole block: with the
    // budget reverted this node renders the same `PageComponent` summary eight
    // times, so both of these are false by more than an order of magnitude.
    expect(rendered.length).toBe(122);
    expect(rendered).not.toContain('Enum<');
  });

  it('holds an ARRAY element to the budget — the `api/*.mdx` `error` shape', () => {
    // `ERROR_RESPONSE`'s old job, kept as the array case: the 261-member
    // vocabulary sat two shape levels down and reached the cell because
    // `{ … }[]` re-entered the object branch. The array is not what is elided —
    // the cell still says "an array of them".
    expect(formatType(ERROR_RESPONSE, ctx())).toBe('{ success: boolean; error?: object[] }');
  });

  it('holds a `Record` VALUE to the budget — the `GetTranslationsResponse` shape', () => {
    expect(
      formatType(
        {
          type: 'object',
          properties: {
            objects: {
              type: 'object',
              additionalProperties: { type: 'object', properties: { label: { type: 'string' } } },
            },
          },
        },
        ctx(),
      ),
    ).toBe('{ objects?: Record<string, object> }');
  });

  it('holds a union VARIANT to the budget — the `Object.userActions` shape', () => {
    expect(
      formatType(
        {
          type: 'object',
          properties: {
            edit: {
              anyOf: [
                { type: 'boolean' },
                { type: 'object', properties: { enabled: { type: 'boolean' } } },
              ],
            },
          },
        },
        ctx(),
      ),
    ).toBe('{ edit?: boolean | object }');
  });

  it('holds a direct object child to the budget — the limb that was ALREADY opaque', () => {
    // Unchanged by this commit and asserted here on purpose: it is the rule the
    // other three cases were brought into line with, so it has to be read as
    // one rule with them rather than as a fourth special case.
    expect(
      formatType(
        {
          type: 'object',
          properties: { inner: { type: 'object', properties: { deep: { type: 'string' } } } },
        },
        ctx(),
      ),
    ).toBe('{ inner?: object }');
  });

  it('spends the budget on SHAPES, so a wrapper at the top of a cell still opens one level', () => {
    // `{ … }[]` and `Record<string, { … }>` are one shape level, not two — the
    // budget counts `{ … }`, and a wrapper is not one. Getting this wrong would
    // collapse the whole `ConversationSession.messages` family to a bare
    // `object[]` and take the corpus with it.
    expect(
      formatType({ type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } }, ctx()),
    ).toBe('{ a?: string }[]');
    expect(
      formatType(
        { type: 'object', additionalProperties: { type: 'object', properties: { a: { type: 'string' } } } },
        ctx(),
      ),
    ).toBe('Record<string, { a?: string }>');
  });

  it('does not fire on a keyless `Record` below a summary — that is not a shape', () => {
    // `properties?: Record<string, any>` is on `PageComponent` itself and on
    // hundreds of other nodes. The guard sits inside the declared-keys branch,
    // so an open object with NO declared keys renders as it always did.
    expect(
      formatType(
        { type: 'object', properties: { properties: { type: 'object', additionalProperties: {} } } },
        ctx(),
      ),
    ).toBe('{ properties?: Record<string, any> }');
  });

  it('applies without a `ctx`, because depth is recursion state and not page state', () => {
    // The ternary this replaces needed no `ctx` either. A budget that lived in
    // `TypeContext` would silently switch itself off for every caller that
    // renders a type string without page context — the failure mode
    // `inShapeSummary` documents one field up, and not one to copy.
    expect(
      formatType({
        type: 'object',
        properties: {
          edit: { anyOf: [{ type: 'boolean' }, { type: 'object', properties: { a: { type: 'string' } } }] },
        },
      }),
    ).toBe('{ edit?: boolean | object }');
  });

  it('leaves a cell that never opened a second shape level byte-identical', () => {
    // The corpus check that the budget is not a rewrite: 173 of the 215 pages
    // do not move at all. `BulkActionDef.params` (#5340's instance) and
    // `App.navigation` (#6226's) are both one level deep and both unchanged.
    // 165 since #9182 dropped the count from the in-shape marker (was 174 — the
    // 9 characters of `+42 more`). The cell's SHAPE is what this case pins, and
    // it is unchanged: still one level, still the same seven members spelled.
    expect(formatType(BULK_ACTION_PARAMS, ctx()).length).toBe(165);
    expect(formatType(INDEX_SCHEMA, ctx())).toBe(
      "{ name?: string; fields: string[]; unique?: boolean | 'global' | 'organization' }[]",
    );
    expect(formatType(BULK_ACTION_OPTIONS, ctx())).toBe(
      '({ label: string; value: string | number | boolean } & Record<string, any>)[]',
    );
  });

  it('spells an identical variant once and counts the rest — the arity survives the collapse', () => {
    // RULED, and the pin turned over (#6569). #6374 shipped this cell printing
    // `object` six times and pinned it that way ON PURPOSE, with the question
    // filed for the maintainer rather than answered by the implementer: the
    // repetition read as a bug but it carried the ARITY, and dropping arity
    // would have re-decided #6226 from inside a depth-budget PR.
    //
    // The ruling keeps both halves. The spelling collapses (a second `object`
    // tells a reader nothing the first did not) and the count is restored in
    // #6226's own `… +N more` marker rather than in a new multiplicity
    // notation, so the cell still says "choose one of six shapes" and the table
    // still has exactly one way of saying "there is more". The budget above
    // decides what a variant SPELLS; this decides how many spellings are worth
    // printing; the marker reports the arity either way.
    const rendered = formatType(
      {
        type: 'object',
        properties: {
          slot: {
            anyOf: Array.from({ length: 6 }, (_, i) => ({
              type: 'object',
              properties: { id: { type: 'string' }, [`k${i}`]: { type: 'string' } },
            })),
          },
        },
      },
      ctx(),
    );
    expect(rendered).toBe('{ slot?: object | … +5 more }');
    // 1 spelled + 5 counted = the six the schema declares.
    expect(1 + 5).toBe(6);
  });
});

/**
 * A cell spells each DISTINCT variant rendering once and counts the rest —
 * #6569, ruled after #6374 shipped the repetition and pinned it as the open
 * question.
 *
 * The condition is #6374's: with `SHAPE_DEPTH_LIMIT` in force, an all-object
 * union below a summary prints `object` per variant, so 11 cells on 6 shipped
 * reference pages rendered `object | object | object | object` and
 * `kernel/manifest.mdx` spelled four of them before counting `… +5 more`
 * identical ones. The ruling threads between the options the issue laid out:
 * COLLAPSE the repeated spelling (it carries nothing the first copy did not),
 * but SELF-REPORT the arity (#6226: an omission must state its size), in the
 * marker vocabulary the table ALREADY has (#6226 again: a second omission style
 * in one table is worse than the width it would fix).
 *
 * REVERSE VERIFICATION — predicted before running, by deleting the dedupe and
 * restoring `if (rendered.length <= VARIANT_LIMIT) return full;` with the
 * `rendered.slice(0, VARIANT_LIMIT)` call under it. The direction is NOT
 * uniformly red, and the two greens are the point:
 *   RED   — the four cases whose subject IS the collapse (the `App.navigation`
 *           cell, the filed 4-object cell, the flipped #6226 scalar pin, the
 *           arity invariant), plus 'four repeats is the first width that pays'
 *           and the no-new-notation case. Plus, outside this block, exactly two
 *           more: the `Manifest.navigationContributions` cell in the #6226 block
 *           and the identical-variant pin in the #6374 block.
 *   GREEN — 'refuses the marker while the repetition is narrower than the
 *           count' (two and three repeats are under `VARIANT_LIMIT`, so the
 *           baseline prints them verbatim for its own reason and the guard
 *           prints them verbatim for this one — the rule's FLOOR does not move
 *           in either direction, which is why it is asserted separately from
 *           the width where it starts paying), and 'two spellings that differ'
 *           (the dedupe is a no-op on distinct variants, so `Page.slots` must
 *           be untouched by construction).
 *   GREEN — and the whole #6226 cap block, all seven cases: after its fixture
 *           was re-spelled to render DISTINCT variants, the dedupe is a no-op
 *           on every one of them. A red there would mean the cap block is still
 *           answering the dedupe's question instead of the cap's.
 * Predicted split: 8 red / 2 green in this file's dedupe-sensitive cases, with
 * the #6226 cap block green throughout.
 *
 * ACTUAL: **7 failed | 79 passed**, i.e. 7 red / 3 green — the seven reds are
 * exactly the seven named above, and the #6226 cap block held green throughout
 * as predicted (its one red is the composition case, which was predicted red).
 * ONE MISS, recorded because it says something about the assertion rather than
 * about the code: the ARITY INVARIANT case was predicted red and stayed GREEN.
 * It cannot go red — `shown + hidden = arity` is satisfied by the BASELINE
 * renderer too (the cap reports its own hidden count, and at arity 6 the guard
 * refuses so all six are shown and nothing is hidden). It is a property both
 * rules obey, so it pins that the ruling PRESERVED the invariant rather than
 * discriminating that the dedupe exists. Kept deliberately, and re-classified
 * here into the green set: it is the regression test for the one thing option
 * B of the issue would have broken, and a case that would go red if a future
 * change made the marker count spellings instead of variants.
 */
describe('formatType — identical variant spellings collapse into the count (#6569)', () => {
  /** A nav item: five keys, so the fifth is elided and every item renders alike. */
  const navItem = (i: number) => ({
    type: 'object',
    properties: { id: { type: 'string' }, label: { type: 'string' }, icon: { type: 'string' }, order: { type: 'number' }, [`k${i}`]: { type: 'string' } },
    required: ['id', 'label'],
  });
  const SEPARATOR = {
    type: 'object',
    properties: { type: { const: 'separator' }, id: { type: 'string' }, order: { type: 'number' } },
    required: ['type'],
  };
  /** Two keys, so it renders `object` below a summary and `{ … }` above one. */
  const objectVariant = (i: number) => ({
    type: 'object',
    properties: { id: { type: 'string' }, [`k${i}`]: { type: 'string' } },
  });
  const NAV_ITEM_CELL = '{ id: string; label: string; icon?: string; order?: number; … }';

  it('collapses a NON-adjacent repeat too — the real `App.navigation` variant order', () => {
    // The corpus shape, measured: nine variants, of which eight render to one
    // character-identical nav-item spelling and one is the separator — and the
    // separator sits SEVENTH, between the run and the eighth copy. This is why
    // equality is on the rendered string and not on adjacency: a `uniq`-style
    // adjacent rule collapses the run, then meets the separator, then prints
    // the nav-item shape A SECOND TIME — i.e. it leaves the repetition in the
    // one cell #6226 was filed on. It is the only corpus site where the two
    // rules differ (3 of 554 union renderings, this cell on its three pages).
    const rendered = formatType(
      {
        type: 'array',
        items: { anyOf: [...Array.from({ length: 7 }, (_, i) => navItem(i)), SEPARATOR, navItem(7)] },
      },
      ctx(),
    );
    expect(rendered).toBe(
      `(${NAV_ITEM_CELL} | { type: 'separator'; id?: string; order?: number } | … +7 more)[]`,
    );
    // The load-bearing half: the spelling appears ONCE, not once per run.
    expect(rendered.split(NAV_ITEM_CELL)).toHaveLength(2);
    // 2 spelled + 7 counted = the nine the schema declares. 582 → 132 chars.
    expect(2 + 7).toBe(9);
    expect(rendered.length).toBe(132);
  });

  it('collapses the four-object cells the issue was filed on', () => {
    // `ai/conversation.mdx`'s `ConversationSession.messages` — the `content`
    // key is an array whose element is a union of four object variants, all
    // four printing `object` because they sit below the summary's one shape
    // level. Seven more cells (`ui/view.mdx`, `data/object.mdx`,
    // `api/protocol.mdx`) carry the same union under `data?:`.
    expect(
      formatType(
        {
          type: 'object',
          properties: {
            role: { type: 'string' },
            content: { type: 'array', items: { anyOf: Array.from({ length: 4 }, (_, i) => objectVariant(i)) } },
          },
          required: ['role', 'content'],
        },
        ctx(),
      ),
    ).toBe('{ role: string; content: (object | … +3 more)[] }');
  });

  it('flips #6226’s five-identical-scalar pin — the count now pays for itself', () => {
    // A PIN THAT CHANGES IS A CONTRACT THAT CHANGES, so it is asserted here
    // rather than quietly re-spelled. #6226 pinned
    // `string | string | string | string | string` verbatim, and its stated
    // reason was arithmetic, not principle: capping five variants prints four
    // of them plus a 12-character marker footprint and comes out LONGER, so the
    // shared guard refused. The dedupe changes the candidate, not the guard —
    // ONE spelling plus `… +4 more` is 18 characters against 42, a 24-character
    // saving — so the same guard, unmodified, now accepts. The reason the old
    // pin gave for its verdict is exactly the reason the new one gives for the
    // opposite verdict; that is what makes this a re-measurement rather than a
    // weakening. The guard's refusal band is still occupied, one width down —
    // see the next case.
    expect(formatType({ anyOf: Array.from({ length: 5 }, () => ({ type: 'string' })) }, ctx())).toBe(
      'string | … +4 more',
    );
  });

  it('refuses the marker while the repetition is narrower than the count', () => {
    // NO EXEMPTION for the pay-for-your-marker guard, and no special case to
    // make the output prettier: a marker still has to earn its own footprint.
    // Two `object`s would GROW by 3 characters and three save 6 against a
    // 12-character footprint, so both keep every repeat. Deliberately green in
    // both directions — see the block header.
    expect(
      formatType({ type: 'object', properties: { slot: { anyOf: [objectVariant(0), objectVariant(1)] } } }, ctx()),
    ).toBe('{ slot?: object | object }');
    expect(
      formatType(
        { type: 'object', properties: { slot: { anyOf: Array.from({ length: 3 }, (_, i) => objectVariant(i)) } } },
        ctx(),
      ),
    ).toBe('{ slot?: object | object | object }');
  });

  it('starts paying at four repeats — the guard’s boundary, measured', () => {
    // Four is the first repeat count where the count is cheaper than the
    // spellings (33 → 18, a 15-character saving against a 12-character
    // footprint), and it happens to be exactly where the corpus cells sit. The
    // boundary is the guard's, not a threshold of this rule's own: nothing in
    // the dedupe knows about the number four.
    expect(
      formatType(
        { type: 'object', properties: { slot: { anyOf: Array.from({ length: 4 }, (_, i) => objectVariant(i)) } } },
        ctx(),
      ),
    ).toBe('{ slot?: object | … +3 more }');
  });

  it('never collapses two spellings that DIFFER — `Page.slots` is untouched', () => {
    // `PageComponent | PageComponent[]` renders `object | object[]`: two
    // spellings, however alike the schemas behind them. The rule judges what a
    // reader sees. Deliberately green in both directions — the dedupe must be a
    // no-op here or it is deleting information rather than repetition.
    expect(
      formatType(
        {
          type: 'object',
          properties: { header: { anyOf: [objectVariant(0), { type: 'array', items: objectVariant(0) }] } },
        },
        ctx(),
      ),
    ).toBe('{ header?: object | object[] }');
  });

  it('keeps “spellings shown + the count = the arity” true however a variant was withheld', () => {
    // The one sentence a reader needs. The cap withholds variants because there
    // are too many worth reading; the dedupe withholds them because the cell
    // already prints their spelling; both report into the SAME marker, so the
    // sum has to come out at the schema's arity in both cases and in the case
    // where they compose.
    for (const arity of [4, 5, 6, 9, 12]) {
      const rendered = formatType(
        {
          type: 'object',
          properties: { slot: { anyOf: Array.from({ length: arity }, (_, i) => objectVariant(i)) } },
        },
        ctx(),
      );
      const hidden = Number(/… \+(\d+) more/.exec(rendered)?.[1] ?? 0);
      const shown = rendered.slice('{ slot?: '.length, -' }'.length).split(' | ').filter(v => !v.startsWith('…')).length;
      expect(shown + hidden).toBe(arity);
    }
  });

  it('reports the count in the EXISTING marker — no multiplicity notation is invented', () => {
    // #6226's ruling turned on there being one way to say "there is more" in a
    // table. `object ×4` (or `object (4)`, or a superscript) would be the
    // fourth omission style on a page that already carries three uses of one.
    const rendered = formatType(
      { type: 'object', properties: { slot: { anyOf: Array.from({ length: 6 }, (_, i) => objectVariant(i)) } } },
      ctx(),
    );
    expect(rendered).toMatch(/… \+\d+ more/);
    expect(rendered).not.toMatch(/[×*]\s*\d/);
    expect(rendered).not.toMatch(/\(\s*\d+\s*\)/);
  });
});
