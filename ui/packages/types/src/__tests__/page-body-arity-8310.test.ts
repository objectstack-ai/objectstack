/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `PageNodeSchema`'s flat content list admits ONE node or a list of them — on
 * both faces (objectui#8310, maintainer ruling 2026-09-07, director decision
 * batch #2).
 *
 * ⚠️ THE KEY MOVED, THE RULING DID NOT. objectui#8310 was decided about the
 * `body` spelling, which was this node's flat content list at the time.
 * objectui#6771 retired that spelling across the protocol; `FlatContent` now
 * reads `schema.children` and nothing else, so the arity ruling governs
 * `children` and every assertion below was moved onto it. The last block in
 * this file is the other half: `body` is refused by name on both faces, so a
 * page still written in the retired spelling is answered rather than silently
 * rendered empty. Read the two together — the arity survives, the spelling did
 * not.
 *
 * ## The defect this pins closed
 *
 * The base declares this channel `SchemaNode | SchemaNode[]`. `PageNodeSchema`
 * inherited it and NARROWED it to `SchemaNode[]`, while the only reader of the
 * channel — `FlatContent`, the flat fallback inside
 * `PageRenderer` (`packages/components/src/renderers/layout/page.tsx`) — went on
 * accepting a bare node, normalizing it into a one-element list behind a
 * `content as SchemaNode` cast. The cast was the marker: the branch was
 * unreachable through the renderer's own declared props, and existed only
 * because the declaration forbade a value the renderer draws.
 *
 * The refused shape is not hypothetical. It is what this project's own landing
 * page teaches: the root `README.md` "Basic Usage" example gives `body` a
 * single `grid` node. That snippet type-checked only because
 * `SchemaRendererProps.schema` is annotated `BaseSchema` — the WIDER parent —
 * so nothing on the authoring path ever asked this key about its arity. An
 * author who reached for the PRECISE type (the shape a contract-first host
 * wants, and the type `PageRenderer`'s own props already use) was refused.
 *
 * ## The three legs, and which one is evidence
 *
 * 1. **Type-level (`readmeFlagshipPage`) — the discriminating leg.** This
 *    object is a transcription of the README fence, annotated `PageNodeSchema`.
 *    `packages/types`' `type-check` script compiles this file
 *    (`tsc -p tsconfig.test.json`), so re-narrowing `body` to `SchemaNode[]`
 *    stops it compiling. Before the widening it did not compile — that failure
 *    IS the card.
 * 2. **Runtime (`safeParse` of the same value) — also discriminating.** The zod
 *    mirror carried the identical narrowing (`z.array(SchemaNodeSchema)`), so
 *    the single-node form was refused by the validator too. Both faces moved,
 *    and this leg is what catches a half-repair that fixes only the TS side.
 * 3. **The array form — a CONTROL, not evidence.** It was legal before and is
 *    legal after, on both faces. It is here so a later change that breaks the
 *    list arity while "fixing" the single one cannot pass; it proves nothing
 *    about this card on its own, and is labelled so it is never read that way.
 *
 * The README-scan leg keeps leg 1 honest. The ruling requires the flagship
 * example to STAY AS WRITTEN and be pinned legal against the declared type —
 * so "repairing" the README into the array form (which would hide the defect
 * inside a green) reddens this file instead of passing silently.
 *
 * ## ⚠️ The ceiling, measured — do not read this pin as more than it is
 *
 * `BaseSchema` carried `[key: string]: any` when this was written. Annotating an
 * authored page therefore caught a value of the WRONG TYPE and never a
 * MISSPELLED KEY: an undeclared key was absorbed by the index signature and drew
 * zero diagnostics, while a type-wrong value drew TS2322. This card repairs the
 * arity of one declared key; it did not turn `PageNodeSchema` into a closed
 * surface (objectui#8347 later removed the signature, which refuses a
 * misspelled key on a fresh literal), and nothing here should be quoted as if
 * this card did.
 *
 * ⚠️ A second, unrelated defect in the same fence was measured while writing
 * this file and filed as objectui#8912: the flagship grid SPELLED its child
 * list `items`, a key `grid` never reads, so that example drew an EMPTY grid.
 * That card has since repaired all three teaching surfaces to `children`, and
 * the transcription below follows the repaired flagship. This file still asks
 * only about `body`'s ARITY and rules on nothing else; the child key is pinned
 * by the render pin in
 * `packages/components/src/__tests__/page-body-single-node-8310.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PageNodeSchema as ZodPageNodeSchema } from '../zod/layout.zod.js';
// Imported through the package entrypoint, not `../layout`: the barrel is the
// surface `@object-ui/components` and every other consumer sees.
import type { PageNodeSchema, SchemaNode } from '../index';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const README = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');

/* -------------------------------------------------------------------------- */
/* Leg 1 — compile-time, compiled by `tsc -p packages/types/tsconfig.test.json` */
/* -------------------------------------------------------------------------- */

/**
 * The `grid` node the README's flagship example hands to `children` — child list
 * spelled `children`, the key `GridSchema` declares and `grid` reads
 * (objectui#8912).
 */
const flagshipGrid: SchemaNode = {
  type: 'grid',
  columns: 3,
  children: [
    { type: 'statistic', label: 'Total Users', value: '${stats.users}' },
    { type: 'statistic', label: 'Revenue', value: '${stats.revenue}' },
    { type: 'statistic', label: 'Orders', value: '${stats.orders}' },
  ],
};

/**
 * The root `README.md` "Basic Usage" example, as a `PageNodeSchema`.
 *
 * ⭐ THE pin of this card. Narrowing `children` back to `SchemaNode[]` makes this
 * declaration stop compiling; that is exactly the state the repository was in
 * before objectui#8310, and it is why the landing page's own example could not
 * be annotated with the type of the node it is.
 */
const readmeFlagshipPage: PageNodeSchema = {
  type: 'page',
  title: 'Dashboard',
  children: flagshipGrid,
};

/**
 * CONTROL — the list arity, which was legal before this card and after it.
 * ⛔ Not evidence for the widening: an assertion green in both worlds proves
 * nothing about the change. It guards against a repair that trades one arity
 * for the other.
 */
const listArityPage: PageNodeSchema = {
  type: 'page',
  title: 'Dashboard',
  children: [flagshipGrid],
};

/* -------------------------------------------------------------------------- */
/* Leg 2 + 3 — the zod mirror, at runtime                                      */
/* -------------------------------------------------------------------------- */

describe('PageNodeSchema flat-content arity — the declaration matches its reader (objectui#8310)', () => {
  it('parses the README flagship example, whose `children` is ONE node', () => {
    const result = ZodPageNodeSchema.safeParse(readmeFlagshipPage);
    expect(result.success).toBe(true);
  });

  it('CONTROL — parses the list arity too (green before this card and after)', () => {
    const result = ZodPageNodeSchema.safeParse(listArityPage);
    expect(result.success).toBe(true);
  });

  it('keeps the single node intact through the parse rather than wrapping it', () => {
    const parsed = ZodPageNodeSchema.parse(readmeFlagshipPage) as { children?: unknown };
    expect(Array.isArray(parsed.children)).toBe(false);
    expect((parsed.children as { type?: string } | undefined)?.type).toBe('grid');
  });
});

/* -------------------------------------------------------------------------- */
/* Leg 4 — the refusal control: the widened union still has a floor            */
/* -------------------------------------------------------------------------- */

/**
 * REFUSAL CONTROL — what the widened `children` must still turn away.
 *
 * Legs 1-3 all assert ACCEPTANCE. A `children` arm that had degraded into
 * accept-anything (`z.any()`, or a union whose floor fell out) passes every one
 * of them green, so on their own they measure the widening's DIRECTION and
 * never its BOUND. This block is the missing half. It pins the refusal
 * ENVELOPE — an `invalid_union` issue at path `['children']` — rather than the
 * bare falsity of `success`, so a page refused for some unrelated reason cannot
 * stand in for a `children` that was judged and rejected.
 *
 * ## ⚠️ Measured, and it is not what the obvious guess says
 *
 * `children: 42` and `children: 'x'` are **LEGAL**, on both faces, and an assertion
 * that they are refused pins a contract this repo does not have:
 *
 * - `../base.ts`: `type SchemaNode = BaseSchema | string | number | boolean | null | undefined`
 * - `../zod/base.zod.ts`: `nodeUnionOptions = [BaseSchemaCore, z.string(),
 *   z.number(), z.boolean(), z.null(), z.undefined()]`
 *
 * A primitive IS a `SchemaNode` here — the text-node convention — so
 * `SchemaNode | SchemaNode[]` admits `42` by construction, exactly as
 * `BaseSchema.children`, `CardSchema.children` and `AspectRatioSchema.children`
 * already did before this card. ⛔ Do not "harden" this block by asserting a primitive
 * is refused: that assertion is RED today, and if it ever went green it would
 * mean the node union had lost arms it is declared to have.
 *
 * ## Why these three values, and not a bogus `type`
 *
 * `SchemaNodeSchema`'s recursion slot 0 holds `BaseSchemaCore` until
 * `../zod/index.zod.js` has been evaluated and `AnyComponentSchema` from the
 * moment it has (`defineNodeComponentUnion`, `../zod/base.zod.ts`). Measured
 * both ways: `{ type: 'definitely-not-a-node' }` is ACCEPTED in the first world
 * and REFUSED in the second, so it is a function of module evaluation order in
 * the importing file and ⛔ must not be used as a refusal fixture. An object
 * carrying **no `type` at all** is refused in BOTH worlds — `BaseSchemaCore`
 * requires `type`, and a discriminated union cannot dispatch without it — so
 * that is the value this control is built on, in either arity.
 */
const REFUSED_CONTENT: ReadonlyArray<[label: string, children: unknown]> = [
  ['an object that is not a node — it carries no `type`', {}],
  ['an object with node-ish keys but still no `type`', { columns: 3 }],
  ['the LIST arity carrying that same non-node object', [{}]],
];

describe('PageNodeSchema flat content still refuses a non-node — the widening kept its floor (objectui#8310)', () => {
  for (const [label, children] of REFUSED_CONTENT) {
    it(`refuses ${label}`, () => {
      const result = ZodPageNodeSchema.safeParse({ type: 'page', title: 'Dashboard', children });

      expect(result.success).toBe(false);
      if (result.success) return;

      const contentIssues = result.error.issues.filter((issue) => issue.path[0] === 'children');
      expect(contentIssues.length).toBeGreaterThan(0);
      expect(contentIssues.map((issue) => issue.code)).toContain('invalid_union');
    });
  }

  it('BOUNDARY — a primitive stays legal, because `SchemaNode` declares it', () => {
    // ⛔ Not a defect and ⛔ not a candidate for "hardening" — see the docblock.
    expect(ZodPageNodeSchema.safeParse({ type: 'page', children: 42 }).success).toBe(true);
    expect(ZodPageNodeSchema.safeParse({ type: 'page', children: 'Hello' }).success).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* The other half of the move — the retired spelling is ANSWERED, not ignored  */
/* -------------------------------------------------------------------------- */

/**
 * objectui#6771 retired `body`. The arity above moved onto `children`; this
 * block pins what happened to the key it moved off.
 *
 * ⛔ The assertion is NOT "the old pin is gone". A deleted member would be
 * ACCEPTED, silently: `BaseSchemaCore` ends `.passthrough()` (and the TS face
 * carried `[key: string]: any` until objectui#8347), so dropping the declaration would leave a page
 * written in the retired spelling parsing green and rendering nothing — the
 * exact silence the retirement exists to end. What is pinned is the REFUSAL,
 * at the key's own path, carrying the remedy.
 */
describe('`body` is refused by name on the page node (objectui#6771)', () => {
  it('refuses the single-node form the README used to author under `body`', () => {
    const result = ZodPageNodeSchema.safeParse({
      type: 'page',
      title: 'Dashboard',
      body: flagshipGrid,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const bodyIssues = result.error.issues.filter((issue) => issue.path[0] === 'body');
    expect(bodyIssues.length).toBeGreaterThan(0);
    expect(bodyIssues[0]!.message).toContain('`children`');
  });

  it('refuses the LIST arity under the retired spelling too — this is about the key', () => {
    const result = ZodPageNodeSchema.safeParse({ type: 'page', body: [flagshipGrid] });
    expect(result.success).toBe(false);
  });

  it('CONTROL — the identical document under `children` parses green', () => {
    // Without this leg, a mirror that refused every page would satisfy the two
    // assertions above.
    expect(ZodPageNodeSchema.safeParse({
      type: 'page',
      title: 'Dashboard',
      children: flagshipGrid,
    }).success).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* README leg — the transcription above is not allowed to become fiction        */
/* -------------------------------------------------------------------------- */

/**
 * The `const schema: DeclaredNode = {` object literal inside the README's
 * "Basic Usage" fence, returned as source text. Scanned with brace-depth
 * tracking rather than a regex so a nested `children[]` cannot end the span
 * early. The annotation is part of the anchor since objectui#11466, which
 * typed the example as the node the `schema` prop takes.
 */
function basicUsageSchemaLiteral(): string {
  const heading = README.indexOf('#### Basic Usage');
  expect(heading).toBeGreaterThan(-1);
  const start = README.indexOf('const schema: DeclaredNode = {', heading);
  expect(start).toBeGreaterThan(-1);

  let depth = 0;
  for (let i = README.indexOf('{', start); i < README.length; i += 1) {
    const ch = README[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return README.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces in the README "Basic Usage" schema literal');
}

/** The first non-whitespace character of the literal's `children:` value. */
function contentValueOpener(literal: string): string {
  const at = literal.indexOf('children:');
  expect(at).toBeGreaterThan(-1);
  return literal.slice(at + 'children:'.length).trimStart()[0];
}

describe('the root README keeps authoring the single-node form (objectui#8310)', () => {
  it('gives `children` ONE node, not a list — the shape this card made legal', () => {
    expect(contentValueOpener(basicUsageSchemaLiteral())).toBe('{');
  });

  it('still authors the page/grid/statistic shape transcribed above', () => {
    const literal = basicUsageSchemaLiteral();
    expect(literal).toContain('type: "page"');
    expect(literal).toContain('title: "Dashboard"');
    expect(literal).toContain('type: "grid"');
    expect(literal).toContain('columns: 3');
    expect(literal.match(/type: "statistic"/g) ?? []).toHaveLength(3);
  });
});
