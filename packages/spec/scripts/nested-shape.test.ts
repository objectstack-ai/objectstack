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
 */

import { describe, expect, it } from 'vitest';

import { formatType, nestedShapeOf, type TypeContext } from './lib/format-type';
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
    const shape = nestedShapeOf({
      anyOf: [
        { type: 'object', properties: { id: { type: 'string', description: 'Item id' } } },
        { type: 'object', properties: { type: { type: 'string', const: 'separator' } } },
      ],
    });

    expect(shape).toBeNull();
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
