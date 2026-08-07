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
        "'email' | 'url' | 'phone' | 'password' | 'secret' | … +42 more>; … } & " +
        'Record<string, any>)[]',
    );
    // 7 shown + 42 hidden = the 49 the schema declares. The count is exact, so
    // the cell says what it is instead of implying it is the whole vocabulary.
    expect(7 + 42).toBe(FIELD_TYPES.length);
    // The cell that motivated the issue, before and after.
    expect(rendered.length).toBe(174);
  });

  it('elides through array-of-object nesting — the `api/*.mdx` `error` shape', () => {
    // A direct object child is forced opaque, but an ARRAY of objects recurses,
    // which is how a 261-member enum reached a cell two levels down.
    const rendered = formatType(ERROR_RESPONSE, ctx());
    expect(rendered).toBe(
      "{ success: boolean; error?: { code: Enum<'VALIDATION_ERROR' | 'INVALID_FIELD' | " +
        "'MISSING_REQUIRED_FIELD' | … +258 more>; message: string }[] }",
    );
    expect(3 + 258).toBe(ERROR_CODES.length);
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
        "'v444444444' | … +15 more> }",
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
        '10000 | 11000 | … +28 more> }',
    );
    expect(rendered).not.toContain("'");
  });

  it('leaves the key elision `…` and the openness marker doing their own jobs', () => {
    // Three different elisions can meet in one cell and must stay legible:
    // `… +N more` (enum members), `…` (further live keys), `& Record` (undeclared
    // keys). #5606's tombstone filter still runs BEFORE the key limit.
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
        '… +42 more>; b?: string; c?: string; d?: string; … } & Record<string, any>',
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
    expect(rendered).toContain('… +15 more');
    expect(rendered).toContain('Record<string, Enum<');
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
    expect(sized(7).map(m => `'${m}'`).join(' | ').length).toBe(102);
    expect(inShape(sized(7))).toBe(
      "{ k?: Enum<'v000000000' | 'v111111111' | 'v222222222' | 'v333333333' | " +
        "'v444444444' | … +2 more> }",
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
