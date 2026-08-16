// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for the reference-docs SECTION renderer — what a `## SchemaName` block
 * contains, and the guarantee that it exists at all (#7658).
 *
 * THE DEFECT THIS PINS. `generateMarkdown` chose which node of a published
 * document it was documenting by enumerating shapes — `properties`, `enum`,
 * `anyOf`, `oneOf` — and answered "none of those" with `return ''`. A JSON
 * Schema root is routinely none of those: a bare scalar is what
 * `z.string().describe(…)` compiles to, a record map is `z.record(…)`, and an
 * array is `z.array(…)`. Each lost its ENTIRE section — heading, and the
 * `.describe()` prose an author wrote to be read — while the page's
 * `## TypeScript Usage` line, which is driven by the export surface rather than
 * by this function, went on naming the export. 45 published schemas were in
 * that state when the issue was measured, 33 of them carrying a description.
 *
 * WHY THIS FILE EXISTS AT ALL, rather than a grep over emitted `.mdx`. The
 * defect's output was the EMPTY STRING. Nothing in `content/docs/references/`
 * showed it: `check:docs` compares generated output to committed output, so a
 * section that never existed stays green forever, and a `grep` for what is
 * missing has nothing to match. The renderer had to leave the side-effecting
 * top-level script before it could be asserted on — the same move, for the same
 * reason, that #4912 made for `format-type.ts`.
 *
 * MEASURED (reverse verification): restoring the old behaviour — deleting the
 * unconditional root fallback at the end of `selectRootDef` and returning `''`
 * when nothing matched — turns 7 of these 13 cases red (the six `#7658` render
 * cases, each losing its whole section so that even `## Name` is gone, plus the
 * `selectRootDef` fallback pin) and leaves the other 6 green. That asymmetry is
 * the point: the four shapes the old code enumerated were always rendered
 * correctly, which is exactly why this survived unnoticed.
 */

import { describe, expect, it } from 'vitest';

import {
  INLINE_DEFAULT_WIDTH_LIMIT,
  renderRequiredCell,
  renderSchemaSection,
  selectRootDef,
} from './lib/schema-section';

/** The `#7658` specimen: `z.string().describe(…)` with no vocabulary. */
const OPAQUE_STRING = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'string',
  description: 'Opaque plan/tier identifier. This schema accepts any string.',
};

describe('renderSchemaSection — root shapes the old enumeration missed (#7658)', () => {
  it('renders a bare opaque string with its description and type', () => {
    const md = renderSchemaSection('TenantPlan', OPAQUE_STRING);

    expect(md).toContain('## TenantPlan');
    // The whole point of the card: the `.describe()` text reaches the page.
    expect(md).toContain('Opaque plan/tier identifier. This schema accepts any string.');
    expect(md).toContain('**Type:** `string`');
  });

  it('renders a bare non-string scalar', () => {
    const md = renderSchemaSection('TraceFlags', {
      type: 'integer',
      minimum: 0,
      maximum: 255,
      description: 'Trace flags bitmap',
    });

    expect(md).toContain('## TraceFlags');
    expect(md).toContain('Trace flags bitmap');
    expect(md).toContain('**Type:** `integer`');
  });

  it('renders a record map (no `properties`, so the object branch never claimed it)', () => {
    const md = renderSchemaSection('InlineLocaleMap', {
      type: 'object',
      propertyNames: { type: 'string' },
      additionalProperties: { type: 'string' },
      description: 'Inline locale map: BCP-47 tag → translated string',
    });

    expect(md).toContain('## InlineLocaleMap');
    expect(md).toContain('Inline locale map: BCP-47 tag → translated string');
    expect(md).toContain('**Type:** `Record<string, string>`');
  });

  it('renders an array root', () => {
    const md = renderSchemaSection('OidcProvidersConfig', {
      type: 'array',
      items: { type: 'object', properties: { providerId: { type: 'string' } }, required: ['providerId'] },
      description: 'List of OIDC/OAuth2 providers for enterprise SSO.',
    });

    expect(md).toContain('## OidcProvidersConfig');
    expect(md).toContain('**Type:** `{ providerId: string }[]`');
  });

  it('renders an `allOf` intersection, collapsing repeated member spellings', () => {
    const md = renderSchemaSection('FilterCondition', {
      allOf: [
        { type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} },
        { type: 'object', propertyNames: { type: 'string' }, additionalProperties: {} },
        { type: 'object', properties: { $not: { $ref: '#' } } },
      ],
    });

    // `A & A` is `A`, so the duplicate member is dropped — unlike a union, where
    // the arity is a fact about what the author chooses between (#6569).
    expect(md).toContain('**Type:** `Record<string, any> & { $not?: [FilterCondition](#filtercondition) }`');
  });

  it('never returns the empty string — a section always has its heading', () => {
    // The tail case: a document this renderer can say nothing else about still
    // gets its anchor, because the page has already imported the name above.
    const md = renderSchemaSection('Unknowable', {});

    expect(md).toContain('## Unknowable');
    // ...and no `**Type:** \`any\``, which would read as "nothing validates it"
    // (the #5606 misreading) rather than "this renderer cannot type it".
    expect(md).not.toContain('**Type:**');
  });
});

describe('renderSchemaSection — shapes unchanged by #7658', () => {
  it('renders an object as a property table', () => {
    const md = renderSchemaSection('Widget', {
      type: 'object',
      properties: { id: { type: 'string', description: 'The id' } },
      required: ['id'],
      description: 'A widget',
    });

    expect(md).toContain('## Widget');
    expect(md).toContain('### Properties');
    expect(md).toContain('| **id** | `string` | ✅ | The id |');
    // The type-specific branch claimed it; no root type line is added on top.
    expect(md).not.toContain('**Type:**');
  });

  it('renders a string vocabulary as Allowed Values bullets', () => {
    const md = renderSchemaSection('Status', { type: 'string', enum: ['draft', 'live'] });

    expect(md).toContain('### Allowed Values');
    expect(md).toContain("* `draft`");
    expect(md).not.toContain('**Type:**');
  });

  it('renders a union as Union Options', () => {
    const md = renderSchemaSection('Either', {
      anyOf: [{ type: 'string' }, { type: 'number' }],
    });

    expect(md).toContain('### Union Options');
    expect(md).toContain('Type: `string`');
  });
});

/**
 * THE DEFECT THIS PINS (#8703). `build-schemas.ts` emits the OUTPUT (post-parse)
 * shape for ~1458 of the 1582 published documents, and in an output shape a
 * `.default()`-bearing member is listed in `required` — the parse always
 * produces it. Mirroring that array into a column headed "Required" told the
 * author "you must write this" about a key they may omit, which is the one
 * question the column is read as answering. 2526 property occurrences across
 * 529 documents were in that state when the card was measured.
 *
 * The second half is the inconsistency: the same member rendered `optional` on
 * the 124 input-shape pages, so a refactor that flipped a def between the two
 * emission modes rewrote its whole Required column with no semantic change (the
 * #8586 flip that #8703 was filed on). Reading `default` rather than `required`
 * makes both modes render the same cell.
 *
 * MEASURED (reverse verification), both legs, because the two halves of the fix
 * fail differently and a single number would hide one of them:
 *
 *   - Neutralising the HELPER (`renderRequiredCell` always answering
 *     `required ? '✅' : 'optional'`) turns **6 of the 20 cases in this file
 *     red**, 14 green.
 *   - Restoring only the old CALL SITE in `renderProperties`, helper intact,
 *     turns exactly **1 red** — the rendered-table case at the end of this
 *     block. That case is therefore the only thing standing between a correct
 *     helper and a table that never calls it, which is why it asserts whole
 *     emitted rows rather than the helper's return value.
 *
 * Everything else in this file stays green under both, which is the asymmetry
 * that matters: nothing about a property WITHOUT a default changes.
 */
describe('renderRequiredCell — a `.default()` member is author-omittable (#8703)', () => {
  it('renders a required-in-output-shape member with a default as optional, naming the value', () => {
    // The exact shape `z.boolean().default(true)` compiles to in the output
    // (post-parse) emission: present in `required`, carrying `default`.
    expect(renderRequiredCell({ type: 'boolean', default: true }, true)).toBe(
      'optional (default: `true`)',
    );
  });

  it('renders the SAME cell for the input-shape emission of the same member', () => {
    // Input shape drops it from `required` but keeps `default`. The two
    // emission modes must not disagree about what the author has to write.
    expect(renderRequiredCell({ type: 'boolean', default: true }, false)).toBe(
      'optional (default: `true`)',
    );
  });

  it('leaves a property with no default alone in both directions', () => {
    expect(renderRequiredCell({ type: 'string' }, true)).toBe('✅');
    expect(renderRequiredCell({ type: 'string' }, false)).toBe('optional');
  });

  it('spells a `null` default rather than mistaking it for "no default"', () => {
    // `'default' in prop` is the test, not truthiness: `null`, `false`, `0` and
    // `""` are all real defaults an author gets by omitting the key.
    expect(renderRequiredCell({ default: null }, true)).toBe('optional (default: `null`)');
    expect(renderRequiredCell({ type: 'integer', default: 0 }, true)).toBe('optional (default: `0`)');
    expect(renderRequiredCell({ type: 'string', default: '' }, true)).toBe('optional (default: `""`)');
  });

  it('spells a wide but flat default — the side of the gap the budget is set from', () => {
    // 56 characters, and one of the real emitted values the 64-character budget
    // exists to keep: an author can retype it, so withholding it would cost
    // more than the columns it spends. Everything the budget DOES withhold is
    // 88 characters or wider and structural (see INLINE_DEFAULT_WIDTH_LIMIT).
    const licenses = ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC'];
    expect(JSON.stringify(licenses).length).toBeGreaterThan(48);
    expect(JSON.stringify(licenses).length).toBeLessThanOrEqual(INLINE_DEFAULT_WIDTH_LIMIT);

    expect(renderRequiredCell({ type: 'array', default: licenses }, true)).toBe(
      'optional (default: `["MIT","Apache-2.0","BSD-3-Clause","BSD-2-Clause","ISC"]`)',
    );
  });

  it('withholds a default too wide for the cell, still stating that one exists', () => {
    const wide = { tabs: Array.from({ length: 12 }, (_, i) => ({ key: `tab${i}`, order: i * 10 })) };
    expect(JSON.stringify(wide).length).toBeGreaterThan(INLINE_DEFAULT_WIDTH_LIMIT);

    // The cell still answers the author's question — the key may be omitted —
    // and the JSON Schema stays the authority on the value, exactly as it is
    // for the constraints this renderer has never printed.
    expect(renderRequiredCell({ type: 'object', default: wide }, true)).toBe('optional (has default)');
  });

  it('escapes a pipe and withholds a backtick rather than breaking the table', () => {
    // A raw `|` splits the GFM cell even inside a code span; GFM resolves the
    // `\|` escape before inline parsing, so the escaped form survives there.
    expect(renderRequiredCell({ type: 'string', default: 'a|b' }, true)).toBe(
      'optional (default: `"a\\|b"`)',
    );
    // A backtick would close the span early and spill raw JSON into the row.
    expect(renderRequiredCell({ type: 'string', default: 'a`b' }, true)).toBe('optional (has default)');
  });

  it('reaches the rendered table, not just the helper', () => {
    const md = renderSchemaSection('MetadataPluginConfig', {
      type: 'object',
      description: 'Metadata plugin configuration',
      properties: {
        storage: { type: 'object', description: 'Storage config' },
        enableEvents: { type: 'boolean', default: true, description: 'Emit metadata change events' },
        cacheMaxItems: { type: 'integer', default: 1000, description: 'Max items in memory cache' },
      },
      // The output-shape `required` array: the two defaulted members are in it.
      required: ['storage', 'enableEvents', 'cacheMaxItems'],
    });

    expect(md).toContain('| **storage** | `object` | ✅ | Storage config |');
    expect(md).toContain(
      '| **enableEvents** | `boolean` | optional (default: `true`) | Emit metadata change events |',
    );
    expect(md).toContain(
      '| **cacheMaxItems** | `integer` | optional (default: `1000`) | Max items in memory cache |',
    );
  });
});

describe('selectRootDef — precedence', () => {
  it('prefers the definition named after the schema', () => {
    const named = { type: 'string', description: 'from $defs' };
    const picked = selectRootDef('Thing', {
      type: 'string',
      description: 'from root',
      $defs: { Thing: named, Other: { type: 'number' } },
    });

    expect(picked).toBe(named);
  });

  it('prefers a recognizable ROOT shape over the first definition', () => {
    const doc = {
      type: 'object',
      properties: { a: { type: 'string' } },
      $defs: { Other: { type: 'number' } },
    };

    expect(selectRootDef('Thing', doc)).toBe(doc);
  });

  /**
   * The regression this file most needs to hold, and the reason the #7658 fix
   * is APPENDED to `selectRootDef` rather than folded into the root-shape test.
   * A document whose root carries no recognizable shape but whose `$defs` holds
   * one must keep choosing the definition: widening the root test instead would
   * have let a bare `{ description }` root outrank the definition that has the
   * actual content, silently rewriting sections that render correctly today.
   */
  it('falls back to the first definition before the root', () => {
    const other = { type: 'object', properties: { a: { type: 'string' } } };
    const picked = selectRootDef('Thing', { description: 'wrapper', $defs: { Other: other } });

    expect(picked).toBe(other);
  });

  it('falls back to the document itself when nothing else matches (#7658)', () => {
    const doc = { type: 'string', description: 'opaque' };

    expect(selectRootDef('Thing', doc)).toBe(doc);
  });
});
