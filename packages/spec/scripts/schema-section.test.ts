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

import { renderSchemaSection, selectRootDef } from './lib/schema-section';

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
