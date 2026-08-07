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

import { formatType, type TypeContext } from './lib/format-type';

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
