/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6939, the `filter-builder` group — the RENDER half. The
 * validator-side contract is pinned in
 * `packages/types/src/__tests__/filter-builder-mirror-6939.test.ts`.
 *
 * ## Why the render half is the discriminating half
 *
 * From objectui#6318's triage: a "correction" that renders identically proves
 * the SCHEMA was wrong, not the fixture. A repair on the schema side has to
 * clear the mirror image of that bar — the validator's verdict must change and
 * the renderer's output must NOT. `PRE_REPAIR` was measured on `origin/main` at
 * `3e01cb55f`, BOTH faces untouched, through THIS file's `measure()`.
 *
 * ⚠️ Measured directly through `SchemaRenderer`, never through a parse-then-
 * render path: at base four of these five entries FAIL `safeValidateSchema`, so
 * anything that validates first cannot run at base and the "before" column
 * would not exist.
 *
 * ⚠️ Element counts are harness-bound — the docs-gallery harness
 * (`catalog-gallery-render.test.tsx`: provider, `SidebarProvider`, a padded
 * wrapper) gives different absolutes for the same tile — so identity WITHIN one
 * harness is the claim that discriminates, and the numbers below are recorded
 * from this harness rather than carried over from the card.
 *
 * Three readings per tile, because a count alone cannot tell a swapped element
 * from an equal one: element count, a tag census, and the text (literally, plus
 * a SHA-256 of it).
 *
 * ## The second thing this file measures
 *
 * The mirror change is a set of key-name and vocabulary MOVES, so "identical
 * render" is necessary but not sufficient — each spelling the mirror now names
 * has to be a spelling the renderer actually distinguishes. `the vocabulary is
 * live` drives one condition row per member and reads the control it draws.
 * Every assertion in this file is legal in BOTH states of the change (the
 * renderer is untouched by it), so none of them can redden for the repair
 * rather than for the thing it controls for.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createHash } from 'node:crypto';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { getExample } from '../src/index.js';

const IDS = [
  'components-complex-filter-builder/empty-filter-builder',
  'components-complex-filter-builder/product-search',
  'components-complex-filter-builder/search-interface',
  'components-complex-filter-builder/user-filters',
  'components-complex-filter-builder/with-conditions',
] as const;

type Reading = {
  elements: number;
  tags: Record<string, number>;
  text: string;
  sha256: string;
};

/**
 * Measured on `origin/main` @ `3e01cb55f` through `measure()` below, both faces
 * untouched. Four of the five reported `: Invalid input` from
 * `safeValidateSchema` at that commit — `search-interface` roots at `stack` and
 * validated, while the `filter-builder` it wraps did not — and every one of the
 * five drew exactly this.
 *
 * ⚠️ ⭐ The empty operator triggers this table used to record are GONE, and
 * that is the later fix this note was written for: objectui#7561 routed the
 * operator `Select`'s identity comparison through `normalizeFilterOperator`,
 * so `eq` / `gt` / `lt` — the spec's alias table, which these entries author —
 * now resolve to the mounted `SelectItem` and the trigger names the operator.
 * Three of the five readings moved with it, in `text` and `sha256` only:
 *
 *   `…Clear allCategoryRemove condition…` → `…Clear allCategoryEqualsRemove condition…`
 *
 * `elements` and the tag census did NOT move for any entry — the label lands
 * in a span the trigger already mounted — which is why those two columns are
 * untouched below and are the reading that says this was a text change, not a
 * structural one.
 *
 * ⛔ The values below are therefore no longer all `3e01cb55f`: the three
 * entries with condition rows are re-measured post-#7561 through this same
 * `measure()`, and the two empty ones are unchanged from the original run.
 * objectui#6939's claim is unaffected — ITS repair still moved the validator
 * and not the renderer; what moved the renderer was a different card, and
 * keeping a stale "before" here would only make the next reader hunt a
 * regression that is a deliberate, ruled repair.
 */
const PRE_REPAIR: Record<(typeof IDS)[number], Reading> = {
  'components-complex-filter-builder/empty-filter-builder': {
    elements: 11,
    tags: { DIV: 5, LABEL: 1, SPAN: 1, BUTTON: 1, svg: 1, path: 2 },
    text: 'Build FilterWhereAdd filter',
    sha256: '4f7116e49e263e517c7d54451327413dc9f8b8513c07f52d9c2686f2b2a381aa',
  },
  'components-complex-filter-builder/product-search': {
    elements: 76,
    tags: { DIV: 20, LABEL: 1, SPAN: 10, BUTTON: 12, svg: 11, path: 19, INPUT: 3 },
    text: 'Product Search FiltersWhereANDClear allCategoryEqualsRemove conditionPriceLess thanRemove conditionStock QuantityGreater thanRemove conditionAdd filter',
    sha256: 'aa398c23811cc40717d632ff5feac486796e01bce738df72e3ea53e83e628d10',
  },
  'components-complex-filter-builder/search-interface': {
    elements: 65,
    tags: { DIV: 17, SPAN: 10, BUTTON: 12, svg: 9, path: 16, INPUT: 1 },
    text: 'Advanced SearchBuild complex queries with multiple conditionsWhereANDClear allPublishedEqualsTrueRemove conditionViewsGreater thanRemove conditionAdd filterApply FiltersClear',
    sha256: '17c0b9f574fe89cc80d8be92c53917be73c8a561461dbe7db5a3e0899d4c86ab',
  },
  'components-complex-filter-builder/user-filters': {
    elements: 11,
    tags: { DIV: 5, LABEL: 1, SPAN: 1, BUTTON: 1, svg: 1, path: 2 },
    text: 'Find UsersWhereAdd filter',
    sha256: 'bc346672868113c9a7ba6ff47057ccaa1b865707f5b99c24234e1a9e3e46e9bc',
  },
  'components-complex-filter-builder/with-conditions': {
    elements: 57,
    tags: { DIV: 15, LABEL: 1, SPAN: 7, BUTTON: 9, svg: 8, path: 15, INPUT: 2 },
    text: 'User FiltersWhereANDClear allAgeGreater thanRemove conditionDepartmentEqualsRemove conditionAdd filter',
    sha256: '685ae845f1ebc57c5054ec80da37582a3d387091f203b2c4166c4800cc110853',
  },
};

/** Render one entry the way the docs gallery does and measure what it drew. */
function measure(schema: unknown): Reading & {
  inputs: (string | null)[];
  triggers: (string | null)[];
  fieldTriggers: (string | null)[];
} {
  const { container, unmount } = render(
    <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />,
  );
  const nodes = Array.from(container.querySelectorAll('*'));
  const text = container.textContent ?? '';
  const out = {
    elements: nodes.length,
    tags: nodes.reduce<Record<string, number>>((h, el) => ((h[el.tagName] = (h[el.tagName] ?? 0) + 1), h), {}),
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    inputs: Array.from(container.querySelectorAll('input')).map((i) => i.getAttribute('type')),
    triggers: Array.from(container.querySelectorAll('[role="combobox"]')).map((e) => e.textContent),
    // The FIELD trigger of each condition row, separately from the operator
    // and value ones. A row's three cells are `div.col-span-4` inside the
    // row grid, field first, so `:first-child` selects exactly the field cell.
    // Needed since objectui#7561: the operator trigger now names the operator
    // even on a row whose field def was lost, so "all triggers blank" no
    // longer distinguishes "the field lookup failed" from "nothing rendered".
    fieldTriggers: Array.from(
      container.querySelectorAll('div.col-span-4:first-child [role="combobox"]'),
    ).map((e) => e.textContent),
  };
  unmount();
  return out;
}

function asAuthored(id: (typeof IDS)[number]): Record<string, unknown> {
  return getExample(id).schema as Record<string, unknown>;
}

/** The `filter-builder` node, wherever it sits in the entry. */
function builderNode(id: (typeof IDS)[number]): Record<string, unknown> {
  const doc = asAuthored(id);
  if (doc.type === 'filter-builder') return doc;
  const child = (doc.children as Record<string, unknown>[]).find((c) => c.type === 'filter-builder');
  if (!child) throw new Error(`${id} no longer carries a filter-builder`);
  return child;
}

/** Replace the builder node inside an entry, wrapper and all. */
function withBuilder(id: (typeof IDS)[number], next: Record<string, unknown>): Record<string, unknown> {
  const doc = asAuthored(id);
  if (doc.type === 'filter-builder') return next;
  return {
    ...doc,
    children: (doc.children as Record<string, unknown>[]).map((c) => (c.type === 'filter-builder' ? next : c)),
  };
}

/* The three "corrections" objectui#6318's triage asks about — one per ruled
 * divergence, each applied to the entry as authored. */
function fieldsSpelledName(id: (typeof IDS)[number]) {
  const b = builderNode(id) as { fields: Record<string, unknown>[] };
  return withBuilder(id, {
    ...b,
    fields: b.fields.map(({ value, ...rest }) => ({ ...rest, name: value })),
  });
}
function groupSpelledOperator(id: (typeof IDS)[number]) {
  const b = builderNode(id) as { value: { id?: string; logic: string; conditions: unknown[] } };
  return withBuilder(id, { ...b, value: { operator: b.value.logic, conditions: b.value.conditions } });
}
function typeSpelledString(id: (typeof IDS)[number]) {
  const b = builderNode(id) as { fields: { type?: string }[] };
  return withBuilder(id, {
    ...b,
    fields: b.fields.map((f) => ({ ...f, type: f.type === 'text' ? 'string' : f.type })),
  });
}
function groupWithoutId(id: (typeof IDS)[number]) {
  const b = builderNode(id) as { value: Record<string, unknown> };
  const { id: _dropped, ...rest } = b.value;
  return withBuilder(id, { ...b, value: rest });
}

/** Entries whose group actually carries condition rows — the discriminating ones. */
const WITH_ROWS = [
  'components-complex-filter-builder/product-search',
  'components-complex-filter-builder/search-interface',
  'components-complex-filter-builder/with-conditions',
] as const;

describe('objectui#6939 — the repair moved the validator, not the renderer', () => {
  it.each(IDS)('%s renders exactly what it rendered before', (id) => {
    const after = measure(asAuthored(id));
    const before = PRE_REPAIR[id];
    expect(after.elements).toBe(before.elements);
    expect(after.tags).toEqual(before.tags);
    expect(after.text).toBe(before.text);
    expect(after.sha256).toBe(before.sha256);
  });

  it.each(IDS)('%s anti-vacuity: the tile drew its AUTHORED builder, not an empty box', (id) => {
    // A tile that renders nothing — or the error boundary — satisfies
    // "identical" trivially. Every authored field label on screen proves the
    // `fields` reached the renderer through `value`, the spelling the mirror
    // refused; the "Add filter" control proves the builder itself mounted.
    const b = builderNode(id) as {
      fields: { value: string; label: string }[];
      value: { conditions: { field: string }[] };
    };
    const m = measure(asAuthored(id));
    expect(m.text).not.toContain('failed to render');
    expect(m.text).toContain('Add filter');
    expect(m.text).toContain('Where');
    expect(m.elements).toBeGreaterThan(10);
    // Where the entry authors rows, the label of the column each row points at
    // must be ON SCREEN — the lookup that produces it is the `f.value === …`
    // match, so this is the reading that says `fields` arrived through the
    // spelling the mirror used to refuse.
    for (const condition of b.value.conditions) {
      const field = b.fields.find((f) => f.value === condition.field);
      expect(field, `${id} points a row at an undeclared field`).toBeDefined();
      expect(m.text).toContain(field!.label);
    }
  });
});

describe('objectui#6939 — the fixtures were the side that was right', () => {
  it.each(WITH_ROWS)('%s: "correcting" the field key to `name` LOSES the field', (id) => {
    // The card's own discriminator, re-measured here rather than quoted:
    // `…Clear allCategoryRemove condition…` becomes
    // `…Clear allRemove condition…`. Contrast the tree-view group, where the
    // same probe moved nothing and the schema was therefore the wrong side.
    const authored = measure(asAuthored(id));
    const corrected = measure(fieldsSpelledName(id));
    expect(corrected.text).not.toBe(authored.text);
    expect(corrected.sha256).not.toBe(authored.sha256);
    // Every FIELD trigger goes blank — the lookup `fields.find(f => f.value === …)`
    // finds nothing — while the rows themselves survive, so the loss is the
    // field cell and not the whole tile (that is the NEXT probe's failure mode,
    // and the two must stay distinguishable).
    //
    // ⚠️ Read on `fieldTriggers`, not on every combobox on the tile. Until
    // objectui#7561 the two were interchangeable here ONLY because the operator
    // trigger was blank as well — and it was blank for an unrelated defect,
    // these entries authoring the spec's alias table (`eq` / `lt` / `gt`;
    // rewritten to the canonical members by objectui#6939's remainder). Now
    // that the operator cell renders its label, an all-triggers reading would
    // be answering about the operator repair rather than about the lost field,
    // which is the one thing this probe exists to discriminate.
    expect(authored.fieldTriggers.some((t) => t !== '')).toBe(true);
    expect(corrected.fieldTriggers.every((t) => t === '')).toBe(true);
    // Anti-vacuity for the line above: `every` over an EMPTY list is true, so
    // a selector that matched nothing would pass it silently.
    expect(corrected.fieldTriggers.length).toBe(authored.fieldTriggers.length);
    expect(corrected.fieldTriggers.length).toBeGreaterThan(0);
    const rows = (r: { text: string }) => r.text.split('Remove condition').length - 1;
    expect(rows(corrected)).toBe(rows(authored));
    expect(rows(authored)).toBeGreaterThan(0);
    // ⚠️ The element count is NOT asserted equal, and the reason is a finding:
    // losing the field def also loses its TYPE, so a column that drew a
    // non-text control degrades to a text box. `search-interface`'s `boolean`
    // column costs three elements that way (65 → 62); the two all-text/number
    // entries happen to break even. The damage is therefore at least the label
    // and sometimes more, never less.
    expect(corrected.elements).toBeLessThanOrEqual(authored.elements);
  });

  it.each(WITH_ROWS)('%s: "correcting" the group key to `operator` EMPTIES the board', (id) => {
    // `isValidGroup` rejects it, the component falls back to `EMPTY_GROUP`, and
    // every condition row disappears.
    const authored = measure(asAuthored(id));
    const corrected = measure(groupSpelledOperator(id));
    expect(corrected.elements).toBeLessThan(authored.elements);
    expect(corrected.text).not.toContain('Remove condition');
    expect(authored.text).toContain('Remove condition');
  });

  it.each(WITH_ROWS)('%s: `type: "string"` renders identically — it is a PHANTOM', (id) => {
    // The asymmetry that justifies dropping `string` rather than keeping it as
    // an alias: swapping `text` for it changes nothing, because both reach the
    // text control through the unrecognised-word fallthrough in
    // `valueFamilyForFieldType`. `text` is the spelling the component names.
    const authored = measure(asAuthored(id));
    const corrected = measure(typeSpelledString(id));
    expect(corrected.elements).toBe(authored.elements);
    expect(corrected.text).toBe(authored.text);
    expect(corrected.sha256).toBe(authored.sha256);
    expect(corrected.inputs).toEqual(authored.inputs);
  });

  it.each(WITH_ROWS)('%s: deleting the group `id` renders identically — it has NO read site', (id) => {
    // The measurement behind declaring `id` OPTIONAL rather than required.
    // `isValidGroup` gates on `conditions` and `logic` only.
    const authored = measure(asAuthored(id));
    const without = measure(groupWithoutId(id));
    expect(without.elements).toBe(authored.elements);
    expect(without.text).toBe(authored.text);
    expect(without.sha256).toBe(authored.sha256);
  });

  it.each(IDS)('%s stays on the spellings its renderer reads', (id) => {
    // ⛔ Do NOT "repair" a future red here by migrating the fixtures back to
    // `name` / `operator`. They are the side that renders.
    const b = builderNode(id) as { fields: Record<string, unknown>[]; value: Record<string, unknown> };
    for (const f of b.fields) {
      expect(typeof f.value).toBe('string');
      expect('name' in f).toBe(false);
    }
    expect(b.value.logic).toMatch(/^(and|or)$/);
    expect('operator' in b.value).toBe(false);
  });
});

describe('objectui#6939 — the vocabulary the mirror now names is live', () => {
  /**
   * One condition row on one column of the given type, so the value control the
   * column draws is observable. Legal in both states of this change — the
   * renderer never consults the mirror.
   */
  function oneRow(type: string) {
    return measure({
      type: 'filter-builder',
      name: 'f',
      fields: [{ value: 'a', label: 'A', type, options: [{ value: 'x', label: 'X' }] }],
      value: { id: 'r', logic: 'and', conditions: [{ id: '1', field: 'a', operator: 'equals', value: '' }] },
    });
  }

  /**
   * The `<input type>` each ruled member's family is edited with —
   * `FILTER_INPUT_TYPE_BY_FAMILY` in `custom/filter-builder.tsx`, observed from
   * the DOM rather than imported (it is module-private on purpose). `boolean`
   * and `select` draw no input at all: a Select, which is the third combobox on
   * the row beside the field and operator ones.
   */
  const DRAWN: Record<string, string | null> = {
    text: 'text',
    number: 'number',
    boolean: null,
    date: 'date',
    datetime: 'datetime-local',
    time: 'time',
    select: null,
  };

  it.each(Object.entries(DRAWN))('`%s` draws its own value control (%s)', (type, expected) => {
    const m = oneRow(type);
    if (expected === null) {
      expect(m.inputs).toEqual([]);
      expect(m.triggers).toHaveLength(3);
    } else {
      expect(m.inputs).toEqual([expected]);
      expect(m.triggers).toHaveLength(2);
    }
  });

  it('the seven members are MUTUALLY distinguishable, not just individually plausible', () => {
    // A per-member assertion would pass on a component that drew one control
    // for everything. This is the claim that cannot: seven members, six
    // distinct control signatures, and the only pair that shares one
    // (`boolean` / `select`) shares it for a stated reason — both are
    // option-driven Selects.
    const signature = (type: string) => {
      const m = oneRow(type);
      return `${m.inputs.join(',')}|${m.triggers.length}`;
    };
    const signatures = Object.keys(DRAWN).map(signature);
    expect(new Set(signatures).size).toBe(6);
    expect(signature('boolean')).toBe(signature('select'));
  });

  it('`string` is indistinguishable from a nonsense spelling — the phantom, again', () => {
    expect(oneRow('string').inputs).toEqual(oneRow('zzz-not-a-field-type').inputs);
    expect(oneRow('string').elements).toBe(oneRow('zzz-not-a-field-type').elements);
    // …and it is distinguishable from `number`, so the probe above is not
    // reporting "everything looks the same to this harness".
    expect(oneRow('string').inputs).not.toEqual(oneRow('number').inputs);
  });

  it.each(['status', 'currency', 'percent', 'rating', 'lookup', 'master_detail', 'user'])(
    '`%s` is live too, and the mirror refuses it — a pre-existing gap, reported not repaired',
    (type) => {
      // These draw a REAL control (a number input, or the option-driven Select),
      // so they are not phantoms like `string`; the mirror refused them before
      // this change and still does. Recorded here so the gap is a decision.
      expect(oneRow(type).inputs).not.toEqual(oneRow('zzz-not-a-field-type').inputs);
    },
  );
});
