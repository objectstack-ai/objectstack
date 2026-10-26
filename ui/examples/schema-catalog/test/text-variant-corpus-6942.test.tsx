/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The corpus half of objectui#6942 (maintainer ruling B1, ENFORCE, 2026-09-02).
 *
 * `packages/components/src/__tests__/text-variant-align-6942.test.tsx` pins the
 * RENDERER — nine published values, nine distinct classes, `align` mapped, and
 * an off-enum value still refused. This file pins the CORPUS the finding was
 * measured on: five catalog entries written in the shadcn typography scale
 * (`small`, `p`, `muted`, `lead`, `large`), which `safeValidateSchema` refused
 * for a key that could not have changed a pixel either way.
 *
 * ## Why a sweep and not five assertions
 *
 * The five were the ones objectui#6942 counted, but the corpus is the thing
 * that has to stay honest: a sixth node in the same shadcn scale was sitting in
 * `components-feedback-loading/with-text.json` (`variant: "muted"`), outside the
 * category anyone was looking at. Five named assertions would have gone green
 * with it still there. So the population is EVERY `text` node in every catalog
 * entry, and the assertion is that each authored `variant` / `align` is a value
 * the published mirror blesses.
 *
 * The vocabulary is derived from `packages/types/src/zod/layout.zod.ts` at
 * runtime — the enum is the contract this card deliberately did not touch.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { TextSchema, safeValidateSchema } from '@object-ui/types/zod';
import { allExamples, allExampleIds, getExample } from '../src/index.js';

/** Peel `.optional()` / `.default()` wrappers until the enum's `options` show. */
function enumOptions(member: unknown): string[] {
  let cur = member as {
    options?: string[];
    unwrap?: () => unknown;
    def?: { innerType?: unknown; options?: string[] };
    _def?: { innerType?: unknown; options?: string[] };
  };
  for (let i = 0; i < 6 && cur; i += 1) {
    const options = cur.options ?? cur.def?.options ?? cur._def?.options;
    if (Array.isArray(options)) return [...options];
    const inner = cur.def?.innerType ?? cur._def?.innerType;
    if (inner) {
      cur = inner as typeof cur;
      continue;
    }
    if (typeof cur.unwrap === 'function') {
      cur = cur.unwrap() as typeof cur;
      continue;
    }
    break;
  }
  return [];
}

const shape = (TextSchema as unknown as { shape: Record<string, unknown> }).shape;
const PUBLISHED_VARIANTS = enumOptions(shape.variant);
const PUBLISHED_ALIGNS = enumOptions(shape.align);

type TextNode = { variant?: unknown; align?: unknown };

/** Every `type: 'text'` node anywhere in one entry, at any depth. */
function textNodes(node: unknown, found: TextNode[] = []): TextNode[] {
  if (Array.isArray(node)) {
    for (const child of node) textNodes(child, found);
    return found;
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record.type === 'text') found.push(record as TextNode);
    for (const value of Object.values(record)) textNodes(value, found);
  }
  return found;
}

/** `<id, node>` for every text node in the corpus that authored a variant. */
const authoredVariants = allExamples().flatMap((example) =>
  textNodes(example.schema)
    .filter((node) => node.variant !== undefined)
    .map((node) => [example.id, node.variant] as const),
);

const authoredAligns = allExamples().flatMap((example) =>
  textNodes(example.schema)
    .filter((node) => node.align !== undefined)
    .map((node) => [example.id, node.align] as const),
);

/** Render one entry and hand back the classes its own elements carry. */
function renderEntry(schema: unknown): string[] {
  const { container } = render(
    <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />,
  );
  return Array.from(container.querySelectorAll('*')).map((el) => el.className.toString());
}

describe('objectui#6942 — every text node in the corpus speaks the published vocabulary', () => {
  it('the sweep found nodes to judge', () => {
    // Anti-vacuity: a walker that stopped seeing text nodes would make every
    // assertion below pass against an empty list.
    expect(PUBLISHED_VARIANTS).toHaveLength(9);
    expect(authoredVariants.length).toBeGreaterThanOrEqual(8);
    expect(authoredAligns.length).toBeGreaterThanOrEqual(3);
  });

  it('no entry authors a variant outside the published enum', () => {
    const offEnum = authoredVariants.filter(([, variant]) => !PUBLISHED_VARIANTS.includes(String(variant)));
    // Named, not counted: a red run says which file to open.
    expect(offEnum).toEqual([]);
  });

  it('no entry authors an alignment outside the published enum', () => {
    const offEnum = authoredAligns.filter(([, align]) => !PUBLISHED_ALIGNS.includes(String(align)));
    expect(offEnum).toEqual([]);
  });

  it('the sixth node, outside the category the finding counted, is repaired too', () => {
    // `components-feedback-loading/with-text.json` carried `variant: "muted"` —
    // the same shadcn scale as the five, in a category nobody was looking at.
    const nodes = textNodes(getExample('components-feedback-loading/with-text').schema);
    expect(nodes.map((n) => n.variant)).toEqual(['caption']);
  });
});

describe('objectui#6942 — the five entries the enum refused', () => {
  it.each([
    ['components-basic-text/lead', 'components-basic-text/heading-4'],
    ['components-basic-text/large', 'components-basic-text/heading-5'],
    ['components-basic-text/small', 'components-basic-text/caption'],
  ])('%s was re-authored as %s', (retired, replacement) => {
    expect(allExampleIds()).not.toContain(retired);
    expect(allExampleIds()).toContain(replacement);
  });

  it('components-basic-text/muted was deleted, not re-spelled', () => {
    // `muted` names a COLOUR, not a typographic step; no published value
    // expresses it, and `components-basic-text/text-with-colors` already
    // demonstrates `text-muted-foreground` on a text node.
    expect(allExampleIds()).not.toContain('components-basic-text/muted');
  });

  it.each([
    ['components-basic-text/heading-4', 'h4'],
    ['components-basic-text/heading-5', 'h5'],
    ['components-basic-text/caption', 'caption'],
    ['components-basic-text/paragraph', 'body'],
  ])('%s now authors %s', (id, variant) => {
    expect(textNodes(getExample(id).schema).map((n) => n.variant)).toEqual([variant]);
  });

  it.each(allExamples().filter((e) => e.meta.category === 'components-basic-text').map((e) => [e.id, e.schema] as const))(
    '%s validates under safeValidateSchema',
    (_id, schema) => {
      const result = safeValidateSchema(schema);
      const issues = result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      expect(issues).toEqual([]);
    },
  );
});

describe('objectui#6942 — the catalog now demonstrates what it claims to demonstrate', () => {
  it('each variant-carrying entry renders a class no sibling entry renders', () => {
    // The point of the category: seven tiles, seven different typographic
    // renderings. Before this card all of them painted identical DOM.
    const variantEntries = allExamples().filter(
      (e) => e.meta.category === 'components-basic-text' && textNodes(e.schema).some((n) => n.variant !== undefined),
    );
    expect(variantEntries.length).toBe(7);
    const classes = variantEntries.map((e) => renderEntry(e.schema).join('|'));
    expect(classes.every((c) => c.trim().length > 0)).toBe(true);
    expect(new Set(classes).size).toBe(variantEntries.length);
  });

  it('text-alignment paints three different alignments', () => {
    const classes = renderEntry(getExample('components-basic-text/text-alignment').schema);
    for (const align of ['left', 'center', 'right']) {
      expect(classes.some((c) => c.split(/\s+/).includes(`text-${align}`))).toBe(true);
    }
  });
});
