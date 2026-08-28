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

/**
 * THE DEFECT THIS PINS (#12590). `### Nested Shape:` and `### Allowed Values:`
 * headings qualify themselves by `Schema.key` so that one page carrying many
 * schemas cannot emit the same heading — the same anchor — twice. Inside the
 * `### Union Options` branch that qualifier stops qualifying anything: the
 * branch calls `renderProperties` once per variant, and BOTH halves of
 * `Schema.key` are shared by every sibling variant of one schema. Two
 * `ViewItem` variants each declaring a shape-opening `config` therefore emitted
 * `### Nested Shape: \`ViewItem.config\`` twice.
 *
 * Measured on `origin/main@b489d3c7`, over the emitted tree: **12 excess
 * `### Nested Shape:` occurrences, 10 distinct headings, 4 pages** — every one
 * under a schema rendering `### Union Options`. `check:doc-anchors` is green
 * through all of it by design: it checks that links RESOLVE, never that anchors
 * are unique, so a duplicate anchor silently sends every link to the first of
 * the two.
 *
 * WHAT THE FIX MAY NOT DO, and what these cases hold it to:
 *
 *   - Not invent a notation. The qualifier reuses `variantSelector` from
 *     `format-type.ts` — the very function that stamps `[type='sidebar']` /
 *     `[option 2]` into a property accessor (#12316) — so a page has one
 *     variant grammar, not two.
 *   - Not trust a discriminant that does not discriminate. A key pinned to the
 *     SAME literal on two variants names neither of them, and qualifying with
 *     it would re-create the duplicate anchors through the fix itself. The
 *     positional fallback is therefore pinned as hard as the discriminant.
 *   - Not touch a heading outside a union variant. A schema rendered whole, and
 *     a union with a single heading-emitting arm, keep the exact headings they
 *     had.
 *
 * `### Properties` and `#### Option N` repeat within a union section and are
 * deliberately NOT in scope here: they are the section grammar's own headings,
 * repeated on every page in the tree, not the per-key qualifier this card is
 * about. The uniqueness assertions below are scoped to the two qualified
 * headings for that reason.
 */

/** A `ViewItem`-shaped variant: a discriminant literal plus a shape-opening `config`. */
const variantWithConfig = (viewKind: string) => ({
  type: 'object',
  properties: {
    viewKind: { const: viewKind },
    config: {
      type: 'object',
      properties: { label: { type: 'string', description: `Label shown on the ${viewKind} view.` } },
    },
  },
  required: ['viewKind', 'config'],
});

/** The same shape with no `const` anywhere — nothing for a discriminant to read. */
const anonymousVariantWithConfig = (label: string) => ({
  type: 'object',
  properties: {
    config: {
      type: 'object',
      properties: { label: { type: 'string', description: label } },
    },
  },
});

/** Wide enough to leave the cell (`TOP_LEVEL_ENUM_WIDTH_LIMIT` is 160). */
const WIDE_VOCABULARY = Array.from({ length: 12 }, (_, i) => `vocabulary_member_${i + 1}`);

const variantWithVocabulary = (viewKind: string) => ({
  type: 'object',
  properties: {
    viewKind: { const: viewKind },
    mode: { type: 'string', enum: WIDE_VOCABULARY },
  },
  required: ['viewKind', 'mode'],
});

/** The qualified headings only — the population this card measures. */
const qualifiedHeadings = (md: string) =>
  md.split('\n').filter(l => l.startsWith('### Nested Shape: ') || l.startsWith('### Allowed Values: '));

describe('renderSchemaSection — union variants qualify their own headings (#12590)', () => {
  it('gives sibling variants sharing a shape-opening key DISTINCT nested-shape headings', () => {
    const md = renderSchemaSection('ViewItem', {
      anyOf: [variantWithConfig('list'), variantWithConfig('record')],
    });

    expect(md).toContain("### Nested Shape: `ViewItem[viewKind='list'].config`");
    expect(md).toContain("### Nested Shape: `ViewItem[viewKind='record'].config`");
    // The shared spelling — one anchor for two different shapes — is gone.
    expect(md).not.toContain('### Nested Shape: `ViewItem.config`');
  });

  it('emits no duplicate qualified heading anywhere in the section', () => {
    const md = renderSchemaSection('ViewItem', {
      anyOf: [variantWithConfig('list'), variantWithConfig('record'), variantWithConfig('form')],
    });

    const headings = qualifiedHeadings(md);
    expect(headings).toHaveLength(3);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it('spells the qualifier in the accessor voice the page already prints', () => {
    const md = renderSchemaSection('ViewItem', {
      anyOf: [variantWithConfig('list'), variantWithConfig('record')],
    });

    // `[key='literal']`, the #12316 discriminant spelling — the same literal
    // formatting the Type cell two lines above uses, so a reader copying
    // `viewKind: 'list'` off the heading copies the schema's own answer.
    expect(md).toMatch(/### Nested Shape: `ViewItem\[viewKind='list'\]\.config`/);
    // No second notation: no `#N`, no `(1)`, no bare `[1]`.
    expect(md).not.toMatch(/### Nested Shape: `ViewItem[#(]/);
  });

  it('falls back to the positional spelling when the union has no discriminant', () => {
    const md = renderSchemaSection('Thing', {
      anyOf: [anonymousVariantWithConfig('first'), anonymousVariantWithConfig('second')],
    });

    expect(md).toContain('### Nested Shape: `Thing[option 1].config`');
    expect(md).toContain('### Nested Shape: `Thing[option 2].config`');
  });

  /**
   * The trap #12316 named, and the one way this fix could recreate the very
   * defect it removes: `viewKind` is a `const` on both variants and pins the
   * SAME literal, so it identifies neither. Answering it would emit
   * `Thing[viewKind='list'].config` twice.
   */
  it('refuses a discriminant two variants pin to the same literal', () => {
    const md = renderSchemaSection('Thing', {
      anyOf: [variantWithConfig('list'), variantWithConfig('list')],
    });

    expect(md).not.toContain("[viewKind='list']");
    expect(md).toContain('### Nested Shape: `Thing[option 1].config`');
    expect(md).toContain('### Nested Shape: `Thing[option 2].config`');
    const headings = qualifiedHeadings(md);
    expect(new Set(headings).size).toBe(headings.length);
  });

  /**
   * The positional number counts DECLARED position, including arms that emit no
   * headings — so it can be checked against the `#### Option N` heading the
   * reader already has three lines up. Renumbering to skip them would print a
   * number matching nothing on the page.
   */
  it('numbers positions by the union as declared, not by the emitting arms', () => {
    const md = renderSchemaSection('Thing', {
      anyOf: [
        { type: 'string' },
        anonymousVariantWithConfig('first'),
        anonymousVariantWithConfig('second'),
      ],
    });

    expect(md).toContain('#### Option 2');
    expect(md).toContain('### Nested Shape: `Thing[option 2].config`');
    expect(md).toContain('### Nested Shape: `Thing[option 3].config`');
    expect(md).not.toContain('### Nested Shape: `Thing[option 1].config`');
  });

  it('keeps the variant qualifier at the union position when the accessor goes deeper', () => {
    const md = renderSchemaSection('Thing', {
      anyOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'listy' },
            items: {
              type: 'array',
              items: { type: 'object', properties: { uid: { type: 'string', description: 'Element id.' } } },
            },
          },
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'flat' },
            items: {
              type: 'array',
              items: { type: 'object', properties: { uid: { type: 'string', description: 'Element id.' } } },
            },
          },
        },
      ],
    });

    // Reads left to right: the `listy` variant, its `items`, an element of it.
    expect(md).toContain("### Nested Shape: `Thing[kind='listy'].items[number]`");
    expect(md).toContain("### Nested Shape: `Thing[kind='flat'].items[number]`");
  });
});

describe('renderSchemaSection — headings outside a union variant are unchanged (#12590)', () => {
  it('leaves a plain object schema’s nested-shape heading exactly as it was', () => {
    const md = renderSchemaSection('Widget', {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: { label: { type: 'string', description: 'The label.' } },
        },
      },
    });

    expect(qualifiedHeadings(md)).toEqual(['### Nested Shape: `Widget.config`']);
  });

  /**
   * A union whose single object arm is the only heading-emitting context has
   * nothing to tell apart, so it spends no selector — the same rule the walk
   * applies to `string | { … }` in `nestedShapesOf` (`total < 2`), which is what
   * keeps every heading outside the measured duplicate population byte-identical.
   */
  it('spends no selector on a union with a single heading-emitting arm', () => {
    const md = renderSchemaSection('Thing', {
      anyOf: [{ type: 'string' }, variantWithConfig('list')],
    });

    expect(qualifiedHeadings(md)).toEqual(['### Nested Shape: `Thing.config`']);
  });
});

describe('renderSchemaSection — the same treatment for relocated vocabularies (#12590)', () => {
  /**
   * Zero corpus today: no page carries two `### Allowed Values:` headings that
   * collide. It is the SAME exposure — one qualifier, shared by every sibling
   * variant — so closing only the half with a measured population would leave
   * the next wide vocabulary declared on two variants to reopen it.
   */
  it('gives sibling variants sharing a wide vocabulary DISTINCT allowed-values headings', () => {
    const md = renderSchemaSection('ViewItem', {
      anyOf: [variantWithVocabulary('list'), variantWithVocabulary('record')],
    });

    expect(md).toContain("### Allowed Values: `ViewItem[viewKind='list'].mode`");
    expect(md).toContain("### Allowed Values: `ViewItem[viewKind='record'].mode`");
    expect(md).not.toContain('### Allowed Values: `ViewItem.mode`');

    const headings = qualifiedHeadings(md);
    expect(headings).toHaveLength(2);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it('leaves a plain object schema’s allowed-values heading exactly as it was', () => {
    const md = renderSchemaSection('Widget', {
      type: 'object',
      properties: { mode: { type: 'string', enum: WIDE_VOCABULARY } },
    });

    expect(qualifiedHeadings(md)).toEqual(['### Allowed Values: `Widget.mode`']);
  });
});
