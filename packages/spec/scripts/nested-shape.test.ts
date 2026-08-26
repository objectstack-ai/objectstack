// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for NESTED SHAPE rendering — the `### Nested Shape: \`Schema.key…\`` table
 * that carries an item-level key's `.describe()` text to the reference page
 * (#11601).
 *
 * THE DEFECT THIS PINS. `renderType` spends `SHAPE_DEPTH_LIMIT` on the first
 * object it meets and prints a signature — `{ label: string; icon?: string;
 * visibleWhen?: string | object; value?: string; … }[]` — into a table cell
 * that has **no description column**. Every `.describe()` on a key of that
 * shape was therefore unreachable from the page. Not truncated, not marked:
 * absent. `page:tabs`'s item-level `visibleWhen` carries a ~600-character
 * contract note whose whole point is that its evaluation environment is NOT the
 * page-component `visibleWhen` of the same name, and
 * `content/docs/references/ui/component.mdx:459` rendered the row with an empty
 * Description cell.
 *
 * WHY A UNIT PIN AND NOT A GREP OVER THE EMITTED TREE. The defect's output is
 * ABSENT TEXT, and `check:docs` compares generated output with committed
 * output — so it is green forever on prose that neither side contains, and a
 * grep for what is missing has nothing to match. Measured on the tree at the
 * time of the fix: adding a `.describe()` to a nested item key produced a **zero
 * line** `gen:docs` diff. The same reason `schema-section.test.ts` and
 * `format-type.test.ts` exist, and the same shape as the #11482 / #11260 pins —
 * assert the extracted pure function, not the artifact.
 *
 * MEASURED (reverse verification): reverting `nestedShapeOf` to `() => null`
 * — i.e. restoring the old behaviour with every other line of the fix in place
 * — turns the seven rendering cases in the second block red and leaves the
 * `nestedShapeOf` structural block red too; the population census at the bottom
 * is what tells the two apart.
 *
 * THE MULTI-SHAPE REMAINDER (#12316). #11601 shipped with one row-shape left
 * refused: a property whose type is a union of TWO OR MORE object shapes, which
 * had no single "the shape of this property" for a heading to name. The last
 * two blocks below pin the variant selector that lifts it — `[type='sidebar']`
 * where the union has a discriminant, `[option 2]` where it does not — and, as
 * importantly, pin that a SINGLE-shape row still gets no selector, which is the
 * whole reason the 1469 headings #11601 published did not move. Re-measured on
 * `origin/main@7bd6447`: 28 of 8604 rendered property rows are multi-shape, all
 * 28 with describe text on at least one variant; publishing them adds 113
 * sub-tables across 15 pages, 1397 lines, and deletes nothing.
 */

import { describe, expect, it } from 'vitest';

import { formatType, nestedShapeOf, nestedShapesOf, type TypeContext } from './lib/format-type';
import { renderSchemaSection } from './lib/schema-section';

/**
 * The card's own specimen, reduced: `page:tabs` items as `gen:schema` emits
 * them. `visibleWhen` keeps its real describe text — this is the string the
 * acceptance is stated on.
 */
const VISIBLE_WHEN_DESCRIBE =
  'Visibility predicate (CEL) — the whole tab (header + panel) is omitted when FALSE. ' +
  'NOT the same environment as page-component visibleWhen.';

const PAGE_TABS_PROPS = {
  type: 'object',
  properties: {
    tabStyle: { type: 'string', enum: ['line', 'card', 'pill'], description: 'Tab-strip visual style' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Display label' },
          icon: { type: 'string', description: 'Lucide icon name' },
          visibleWhen: { type: 'string', description: VISIBLE_WHEN_DESCRIBE },
          value: { type: 'string', description: 'Stable `?tab=` URL token' },
          count: { type: 'integer', description: 'Badge count' },
          children: { type: 'array', items: {}, description: 'Child components' },
        },
        required: ['label', 'children'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
};

describe('nestedShapeOf — which shape a cell opens, and how it is addressed', () => {
  it('names an array element with the TypeScript index accessor', () => {
    const shape = nestedShapeOf(PAGE_TABS_PROPS.properties.items);

    expect(shape).not.toBeNull();
    expect(shape!.accessor).toBe('[number]');
    expect(shape!.keys).toEqual(['label', 'icon', 'visibleWhen', 'value', 'count', 'children']);
  });

  it('names a property whose own type IS the shape with an empty accessor', () => {
    const shape = nestedShapeOf({
      type: 'object',
      properties: { role: { type: 'string', description: 'WAI-ARIA role' } },
    });

    expect(shape!.accessor).toBe('');
    expect(shape!.keys).toEqual(['role']);
  });

  it('names a Record value with the string index accessor', () => {
    const shape = nestedShapeOf({
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { type: { type: 'string', description: 'Field type' } },
      },
    });

    expect(shape!.accessor).toBe('[string]');
    expect(shape!.keys).toEqual(['type']);
  });

  it('composes accessors left to right through a wrapper stack', () => {
    const shape = nestedShapeOf({
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: { a: { type: 'string', description: 'a' } },
        },
      },
    });

    expect(shape!.accessor).toBe('[number][string]');
  });

  it('reaches the ONE shape of a `string | { … }` union', () => {
    const shape = nestedShapeOf({
      anyOf: [
        { type: 'string' },
        { type: 'object', properties: { dialect: { type: 'string', description: 'Expression dialect' } } },
      ],
    });

    expect(shape!.accessor).toBe('');
    expect(shape!.keys).toEqual(['dialect']);
  });

  it('refuses a union of TWO object shapes — there is no single shape to name', () => {
    // Still `null`, and deliberately so after #12316: this function's whole
    // signature is "the ONE shape", and a two-shape union has no answer to give
    // it. What changed is that the RENDERER no longer asks this question — it
    // asks `nestedShapesOf`, pinned in the block below, which names both.
    const prop = {
      anyOf: [
        { type: 'object', properties: { id: { type: 'string', description: 'Item id' } } },
        { type: 'object', properties: { type: { type: 'string', const: 'separator' } } },
      ],
    };

    expect(nestedShapeOf(prop)).toBeNull();
    expect(nestedShapesOf(prop)).toHaveLength(2);
  });

  it('refuses a leaf — scalar, vocabulary, literal, array of scalars', () => {
    expect(nestedShapeOf({ type: 'string' })).toBeNull();
    expect(nestedShapeOf({ type: 'string', enum: ['a', 'b'] })).toBeNull();
    expect(nestedShapeOf({ type: 'string', const: 'grid' })).toBeNull();
    expect(nestedShapeOf({ type: 'array', items: { type: 'string' } })).toBeNull();
  });

  it('refuses a `retiredKey()` tombstone — nothing validates against it', () => {
    expect(nestedShapeOf({ not: {} })).toBeNull();
  });

  it('refuses a shape whose every declared key is a tombstone, and falls through to its Record tail', () => {
    // No LIVE key: `format-type.ts` renders this as `Record<…>`, not a shape,
    // so the accessor must record the descent rather than stop here.
    const shape = nestedShapeOf({
      type: 'object',
      properties: { removed: { not: {} } },
      additionalProperties: { type: 'object', properties: { live: { type: 'string', description: 'live' } } },
    });

    expect(shape!.accessor).toBe('[string]');
    expect(shape!.keys).toEqual(['live']);
  });

  it('expands an anonymous `$defs` ref, the way the type renderer does', () => {
    const ctx: TypeContext = {
      defs: {
        __schema7: { type: 'object', properties: { source: { type: 'string', description: 'CEL source' } } },
      },
      currentSchema: 'Anything',
    };

    const shape = nestedShapeOf({ type: 'array', items: { $ref: '#/$defs/__schema7' } }, ctx);

    expect(shape!.accessor).toBe('[number]');
    expect(shape!.keys).toEqual(['source']);
  });

  it('refuses a NAMED ref and a self ref — both are documented in their own section', () => {
    const ctx: TypeContext = { defs: {}, currentSchema: 'View' };

    expect(nestedShapeOf({ $ref: '#/$defs/Field' }, ctx)).toBeNull();
    expect(nestedShapeOf({ $ref: '#' }, ctx)).toBeNull();
  });

  it('refuses a cycle rather than recursing — schemas are self-referential', () => {
    const ctx: TypeContext = {
      defs: { __schema1: { type: 'array', items: { $ref: '#/$defs/__schema1' } } },
      currentSchema: 'Node',
    };

    expect(nestedShapeOf({ $ref: '#/$defs/__schema1' }, ctx)).toBeNull();
  });
});

describe('renderSchemaSection — the item-level describe reaches the page (#11601)', () => {
  const md = renderSchemaSection('PageTabsProps', PAGE_TABS_PROPS);

  it('THE ACCEPTANCE: the measured `visibleWhen` describe is on the page', () => {
    expect(md).toContain(VISIBLE_WHEN_DESCRIBE);
  });

  it('carries it under a heading naming the shape by its accessor path', () => {
    expect(md).toContain('### Nested Shape: `PageTabsProps.items[number]`');
  });

  it('leaves the collapsed signature cell exactly where it was', () => {
    // The summary is not replaced by the table — a reader scanning the property
    // list still sees the shape in one line, and the table completes it.
    expect(md).toContain('| **items** | `{ label: string; icon?: string; visibleWhen?: string; value?: string; … }[]` | ✅ |  |');
  });

  it('gives every nested key a row, elided keys included', () => {
    // The cell shows four keys and a `…`; the table shows all six. That gap is
    // `INLINE_KEY_LIMIT`, and the table is where it stops costing the reader.
    for (const key of ['label', 'icon', 'visibleWhen', 'value', 'count', 'children']) {
      expect(md).toContain(`| **${key}** |`);
    }
  });

  it('does not open a table for a shape whose keys carry no describe text', () => {
    // Nothing to relocate: the cell already states the keys and their types, so
    // a table would restate it in more space.
    const undescribed = renderSchemaSection('Bare', {
      type: 'object',
      properties: {
        point: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
      },
    });

    expect(undescribed).toContain('| **point** |');
    expect(undescribed).not.toContain('### Nested Shape:');
  });

  it('opens a table when the ONLY described key is a tombstone', () => {
    // `retiredKey()` puts the whole `[REMOVED]` migration prescription in
    // `description`, and `format-type.ts` drops tombstones from `{ … }`
    // precisely because a summary has no column to carry it. This table is the
    // row that shape never had.
    const retired = renderSchemaSection('WithTombstone', {
      type: 'object',
      properties: {
        legacy: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              live: { type: 'string' },
              gone: { not: {}, description: '[REMOVED] renamed to `live` in 17.0.0' },
            },
          },
        },
      },
    });

    expect(retired).toContain('### Nested Shape: `WithTombstone.legacy[number]`');
    expect(retired).toContain('[REMOVED] renamed to `live` in 17.0.0');
  });

  it('does not relocate a vocabulary out of a nested table', () => {
    // A nested table is a SECOND position for those keys, so it elides the way
    // a `{ … }` summary does — bare `…`, no `### Allowed Values` bullets.
    // Regenerating without this rule put 20,260 bullet lines into the tree.
    const wide = Array.from({ length: 60 }, (_, i) => `code_${i}`);
    const withVocabulary = renderSchemaSection('Envelope', {
      type: 'object',
      properties: {
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', enum: wide, description: 'Machine-readable error code' },
          },
        },
      },
    });

    expect(withVocabulary).toContain('### Nested Shape: `Envelope.error`');
    expect(withVocabulary).toContain('Machine-readable error code');
    expect(withVocabulary).not.toContain('### Allowed Values:');
    expect(withVocabulary).toContain('…');
  });

  it('stops at ONE level — a nested table opens no table of its own', () => {
    const deep = renderSchemaSection('Deep', {
      type: 'object',
      properties: {
        outer: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              inner: {
                type: 'object',
                description: 'one level down — this one reaches the page',
                properties: { leaf: { type: 'string', description: 'two levels down' } },
              },
            },
          },
        },
      },
    });

    // The one level that exists, and no second one. `leaf`'s describe stays
    // unreachable, exactly as `SHAPE_DEPTH_LIMIT` leaves it unreachable in a
    // cell — the budget is the renderer's, not the author's nesting depth.
    expect(deep.match(/^### Nested Shape: /gm) ?? []).toHaveLength(1);
    expect(deep).toContain('### Nested Shape: `Deep.outer[number]`');
    expect(deep).not.toContain('### Nested Shape: `Deep.outer[number].inner`');
    expect(deep).not.toContain('two levels down');
  });

  it('is purely ADDITIVE — every line the old renderer emitted is still emitted', () => {
    // The property table, its cells and the `## heading` are untouched; the
    // section only grows. Measured on the whole tree at the time of the fix:
    // regenerating moved 143 files, +14195 / -118 lines, and every one of the
    // 38177 pre-existing lines is still present (the 118 are re-ordering, not
    // removal).
    for (const line of [
      '## PageTabsProps',
      '### Properties',
      '| Property | Type | Required | Description |',
      "| **tabStyle** | `Enum<'line' \\| 'card' \\| 'pill'>` | optional | Tab-strip visual style |",
    ]) {
      expect(md).toContain(line);
    }
  });
});

describe('nestedShapeOf agrees with the cell it completes', () => {
  it('opens a shape exactly when the cell prints one', () => {
    // The contract between the two functions: a table under a cell must be the
    // shape THAT cell summarized. Where `formatType` prints `{ … }` at the top
    // level, `nestedShapeOf` must have a shape — and where it prints a leaf,
    // there must be none.
    const opensAShape = [
      PAGE_TABS_PROPS.properties.items,
      { type: 'object', properties: { a: { type: 'string' } } },
      { type: 'object', additionalProperties: { type: 'object', properties: { a: { type: 'string' } } } },
    ];
    for (const prop of opensAShape) {
      expect(formatType(prop)).toContain('{ ');
      expect(nestedShapeOf(prop)).not.toBeNull();
    }

    const opensNoShape = [{ type: 'string' }, { type: 'number' }, { not: {} }, { type: 'array', items: { type: 'string' } }];
    for (const prop of opensNoShape) {
      expect(formatType(prop)).not.toContain('{ ');
      expect(nestedShapeOf(prop)).toBeNull();
    }
  });
});

/**
 * `ui/App.navigation` reduced to three of its nine variants — an ARRAY of a
 * union discriminated on `type`, which is the census's most common multi-shape
 * shape (22 of the 28 rows have a discriminant, 12 of them behind `[number]`).
 */
const APP_NAVIGATION = {
  type: 'object',
  properties: {
    navigation: {
      type: 'array',
      description: 'Navigation items',
      items: {
        anyOf: [
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'object' },
              objectName: { type: 'string', description: 'Target object name' },
            },
            required: ['type', 'objectName'],
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'separator' },
              order: { type: 'number', description: 'Sort order within the same level' },
            },
          },
          {
            type: 'object',
            properties: {
              type: { type: 'string', const: 'url' },
              url: { type: 'string', description: 'External URL to open' },
            },
          },
        ],
      },
    },
  },
  required: ['navigation'],
};

/**
 * `automation/StateMachine.on` reduced: a RECORD whose value is
 * `string | Transition | Transition[]`. Two object shapes, no discriminant, and
 * the two are reached at DIFFERENT depths — the case that decides whether the
 * selector is appended to the finished path or spliced in where the union sits.
 */
const STATE_MACHINE_ON = {
  type: 'object',
  properties: {
    on: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { type: 'string' },
          { type: 'object', properties: { target: { type: 'string', description: 'Target State ID' } } },
          {
            type: 'array',
            items: { type: 'object', properties: { target: { type: 'string', description: 'Target State ID' } } },
          },
        ],
      },
    },
  },
};

describe('nestedShapesOf — naming every shape a multi-shape row opens (#12316)', () => {
  it('selects a discriminated variant by the literal the author writes', () => {
    const shapes = nestedShapesOf(APP_NAVIGATION.properties.navigation);

    // The selector joins the composition AFTER `[number]`, because that is
    // where the union sits: an element of the array, then one variant of it.
    expect(shapes.map(s => s.accessor)).toEqual([
      "[number][type='object']",
      "[number][type='separator']",
      "[number][type='url']",
    ]);
    expect(shapes[0].keys).toEqual(['type', 'objectName']);
  });

  it('spells the literal the way the Type cell two lines above spells it', () => {
    // One `formatLiteral`, so a reader copying `type: 'object'` off the heading
    // is copying the same spelling the cell printed — quotes on a string, none
    // on a number. A numeric discriminant is what makes this testable at all:
    // an unconditional `'…'` wrapper (the #5729 defect) would quote it.
    const shapes = nestedShapesOf({
      anyOf: [
        { type: 'object', properties: { v: { type: 'number', const: 1 }, a: { type: 'string', description: 'a' } } },
        { type: 'object', properties: { v: { type: 'number', const: 2 }, b: { type: 'string', description: 'b' } } },
      ],
    });

    expect(shapes.map(s => s.accessor)).toEqual(['[v=1]', '[v=2]']);
  });

  it('splices the selector in AT THE UNION, not onto the end of the path', () => {
    const shapes = nestedShapesOf(STATE_MACHINE_ON.properties.on);

    // `[string][option 3][number]` reads left to right as *the record value,
    // its third option, an element of it*. Appending would have produced
    // `[string][number][option 3]`, which claims the union is below the array.
    expect(shapes.map(s => s.accessor)).toEqual(['[string][option 2]', '[string][option 3][number]']);
  });

  it('counts POSITION IN THE UNION, scalar arms included', () => {
    // The numbers are 2 and 3, not 1 and 2: the `string` arm is `[option 1]`.
    // That is what makes a positional selector checkable — the reader counts
    // the same `string | { … } | { … }[]` cell the table sits under. Numbering
    // only the arms that open shapes would be a private ordering nothing on the
    // page states.
    const shapes = nestedShapesOf(STATE_MACHINE_ON.properties.on);

    expect(shapes.map(s => s.accessor.match(/\[option (\d+)\]/)![1])).toEqual(['2', '3']);
  });

  it('falls back to the positional selector when a `const` key repeats a value', () => {
    // `type` is a `const` on both, so "present everywhere with a const" alone
    // would answer `type` — and emit two IDENTICAL headings, i.e. two identical
    // anchors on one page. Distinctness is the half of the test that prevents
    // it, and the fallback is what it falls back TO.
    const shapes = nestedShapesOf({
      anyOf: [
        { type: 'object', properties: { type: { type: 'string', const: 'row' }, a: { type: 'string', description: 'a' } } },
        { type: 'object', properties: { type: { type: 'string', const: 'row' }, b: { type: 'string', description: 'b' } } },
      ],
    });

    expect(shapes.map(s => s.accessor)).toEqual(['[option 1]', '[option 2]']);
  });

  it('reads the discriminant off the VARIANT, so an array arm cannot claim one', () => {
    // The `const` lives on the element, not on the node the author selects, so
    // `Transition[]` has no discriminant to read and the whole union falls back.
    const shapes = nestedShapesOf({
      anyOf: [
        { type: 'object', properties: { type: { type: 'string', const: 'one' }, a: { type: 'string', description: 'a' } } },
        {
          type: 'array',
          items: { type: 'object', properties: { type: { type: 'string', const: 'many' }, b: { type: 'string', description: 'b' } } },
        },
      ],
    });

    expect(shapes.map(s => s.accessor)).toEqual(['[option 1]', '[option 2][number]']);
  });

  it('adds NO selector to a single-shape row — the #11601 headings do not move', () => {
    // The stamp is conditioned on the UNION's own yield, never on the row's, so
    // every one of the 1469 single-shape rows keeps its byte-identical heading.
    // This is the assertion that makes the regenerated tree purely additive.
    expect(nestedShapesOf({ anyOf: [{ type: 'string' }, { type: 'object', properties: { dialect: { type: 'string' } } }] })
      .map(s => s.accessor)).toEqual(['']);
    expect(nestedShapesOf(PAGE_TABS_PROPS.properties.items).map(s => s.accessor)).toEqual(['[number]']);
  });

  it('is the ONE walk `nestedShapeOf` reads its answer out of', () => {
    // Two readings of one call, so they cannot drift apart about what "one
    // shape level" means — the same construction `formatPropertyType` uses for
    // its cell and its relocation.
    const single = PAGE_TABS_PROPS.properties.items;
    expect(nestedShapeOf(single)).toEqual(nestedShapesOf(single)[0]);

    for (const none of [{ type: 'string' }, { not: {} }, { $ref: '#' }]) {
      expect(nestedShapesOf(none)).toEqual([]);
      expect(nestedShapeOf(none)).toBeNull();
    }
  });

  it('still refuses the shapes #11601 refused, whatever the arity', () => {
    // A union of NAMED refs opens no shape at all — both are published in their
    // own sections. The multi-shape lift is about anonymous inline shapes.
    const ctx: TypeContext = { defs: {}, currentSchema: 'View' };
    expect(nestedShapesOf({ anyOf: [{ $ref: '#/$defs/Field' }, { $ref: '#/$defs/Layout' }] }, ctx)).toEqual([]);
    // Tombstones too: a union arm that accepts nothing is not a variant.
    expect(nestedShapesOf({ anyOf: [{ not: {} }, { not: {} }] })).toEqual([]);
  });
});

describe('renderSchemaSection — a sub-table per variant reaches the page (#12316)', () => {
  const md = renderSchemaSection('App', APP_NAVIGATION);

  it("THE ACCEPTANCE: every variant's describe text is on the page", () => {
    for (const text of ['Target object name', 'Sort order within the same level', 'External URL to open']) {
      expect(md).toContain(text);
    }
  });

  it('gives each variant its own heading under the variant-indexed accessor', () => {
    expect(md).toContain("### Nested Shape: `App.navigation[number][type='object']`");
    expect(md).toContain("### Nested Shape: `App.navigation[number][type='separator']`");
    expect(md).toContain("### Nested Shape: `App.navigation[number][type='url']`");
  });

  it('emits ONE heading per variant and no bare unqualified one', () => {
    const headings = md.match(/^### Nested Shape: .*$/gm) ?? [];
    expect(headings).toHaveLength(3);
    expect(new Set(headings).size).toBe(3);
    // The heading a reader could mistake for "the shape of this property" —
    // the exact claim a multi-shape row cannot make — is never emitted.
    expect(md).not.toContain('### Nested Shape: `App.navigation[number]`\n');
  });

  it('leaves the collapsed signature cell exactly where it was', () => {
    // Additive, the same way #11601 was: the union summary still states the
    // arity the reader counts the `[option N]` selectors against.
    expect(md).toContain(
      "| **navigation** | `({ type: 'object'; objectName: string } \\| { type?: 'separator'; order?: number } \\| { type?: 'url'; url?: string })[]` | ✅ | Navigation items |",
    );
  });

  it('decides "is there text to publish" PER VARIANT, not per row', () => {
    // `ui/FormView.submitBehavior` in miniature: four shapes, one with prose.
    // The rule #11601 wrote — a table only where the cell cannot carry the text
    // — is the same rule, applied one level finer. Publishing all four would
    // restate the cell three times over.
    const mixed = renderSchemaSection('FormView', {
      type: 'object',
      properties: {
        submitBehavior: {
          anyOf: [
            { type: 'object', properties: { kind: { type: 'string', const: 'stay' }, toast: { type: 'boolean' } } },
            {
              type: 'object',
              properties: {
                kind: { type: 'string', const: 'navigate' },
                to: { type: 'string', description: 'Route to open after a successful submit' },
              },
            },
          ],
        },
      },
    });

    expect(mixed).toContain("### Nested Shape: `FormView.submitBehavior[kind='navigate']`");
    expect(mixed).not.toContain("[kind='stay']");
    expect(mixed.match(/^### Nested Shape: /gm) ?? []).toHaveLength(1);
  });

  it("carries the VARIANT's own describe under its heading", () => {
    // On a union this line is what says how this variant differs from its
    // siblings, so it earns the position more than it does on a lone shape.
    const described = renderSchemaSection('Job', {
      type: 'object',
      properties: {
        schedule: {
          anyOf: [
            {
              type: 'object',
              description: 'Run on a cron expression',
              properties: { type: { type: 'string', const: 'cron' }, expr: { type: 'string', description: 'Cron expression' } },
            },
            {
              type: 'object',
              description: 'Run once at a fixed instant',
              properties: { type: { type: 'string', const: 'once' }, at: { type: 'string', description: 'ISO-8601 instant' } },
            },
          ],
        },
      },
    });

    expect(described).toContain("### Nested Shape: `Job.schedule[type='cron']`\n\nRun on a cron expression\n");
    expect(described).toContain("### Nested Shape: `Job.schedule[type='once']`\n\nRun once at a fixed instant\n");
  });

  it('still stops at ONE level — a variant table opens no table of its own', () => {
    // `SHAPE_DEPTH_LIMIT` is untouched by #12316. What was lifted is the
    // refusal at level 1, not the budget: a shape nested inside a VARIANT is
    // exactly as unreachable as it was inside a lone shape.
    const deep = renderSchemaSection('Deep', {
      type: 'object',
      properties: {
        outer: {
          anyOf: [
            {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'a' },
                // The variant's OWN described key, so this variant qualifies
                // for a table on its own account — otherwise the case would
                // prove nothing about depth, only about `carriesDescription`.
                label: { type: 'string', description: 'one level down, on the discriminated variant' },
                inner: { type: 'object', properties: { leaf: { type: 'string', description: 'two levels down' } } },
              },
            },
            {
              type: 'object',
              properties: { type: { type: 'string', const: 'b' }, flag: { type: 'boolean', description: 'one level down' } },
            },
          ],
        },
      },
    });

    expect(deep.match(/^### Nested Shape: /gm) ?? []).toHaveLength(2);
    expect(deep).toContain('one level down, on the discriminated variant');
    expect(deep).toContain('one level down');
    // `inner` is a level BELOW a variant, and the budget was spent reaching the
    // variant. Its `leaf` describe is exactly as unreachable as #11601 left it.
    expect(deep).not.toContain('two levels down');
    expect(deep).not.toContain("[type='a'].inner");
  });

  it('does not relocate a vocabulary out of a variant table either', () => {
    // A variant table is a THIRD position for those keys; #6225's relocation
    // budget is still only spendable where the vocabulary's authoritative copy
    // lives. Same `expandNested = false` flag, one more caller.
    const wide = Array.from({ length: 60 }, (_, i) => `code_${i}`);
    const withVocabulary = renderSchemaSection('Envelope', {
      type: 'object',
      properties: {
        payload: {
          anyOf: [
            {
              type: 'object',
              properties: {
                kind: { type: 'string', const: 'error' },
                code: { type: 'string', enum: wide, description: 'Machine-readable error code' },
              },
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'ok' }, value: { type: 'string', description: 'Result value' } },
            },
          ],
        },
      },
    });

    expect(withVocabulary).toContain("### Nested Shape: `Envelope.payload[kind='error']`");
    expect(withVocabulary).toContain('Machine-readable error code');
    expect(withVocabulary).not.toContain('### Allowed Values:');
  });

  it('is purely ADDITIVE — a single-shape section renders byte for byte as #11601 left it', () => {
    // The regression this guards is the one that would have made the whole
    // change unreviewable: a selector leaking onto the 1469 single-shape rows.
    // Measured on the whole tree: regenerating moved 15 files, +1397 / **-0**
    // lines.
    expect(renderSchemaSection('PageTabsProps', PAGE_TABS_PROPS)).toContain(
      '### Nested Shape: `PageTabsProps.items[number]`',
    );
    expect(renderSchemaSection('PageTabsProps', PAGE_TABS_PROPS)).not.toContain('[option ');
  });
});
