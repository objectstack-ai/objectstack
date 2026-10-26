/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `ui:text` honours `TextSchema.variant` and `TextSchema.align` — objectui#6942,
 * maintainer ruling B1 (ENFORCE) of 2026-09-02.
 *
 * ## What this pins, and why each half is here
 *
 * Before this card the renderer read exactly two keys (`content`, `value`).
 * `variant: 'small'`, `variant: 'body'`, `variant: 'h1'` and the key absent all
 * produced byte-identical DOM, so the nine-value enum was declared, published,
 * validated against — and unread. The ruling took ENFORCE over the three
 * alternatives, and two of those alternatives are failure modes a test can
 * detect:
 *
 *  - **not A (retire)** — every published value must reach the DOM, so the pin
 *    is one rendered element PER value, each carrying a class no other value
 *    carries. A map that collapsed two values into one class would put the key
 *    back where it started for the collapsed pair.
 *  - **not C (widen without implementing)** — enforcement must not become
 *    permissiveness. The last describe block is that control: the five shadcn
 *    spellings the corpus used to carry are still REFUSED by
 *    `safeValidateSchema`, and the renderer styles none of them.
 *
 * ## The vocabulary is derived, never restated
 *
 * Both enums are read out of the published Zod mirror at runtime
 * (`packages/types/src/zod/layout.zod.ts` — untouched by this card, it is the
 * vocabulary). A restated list would go green against itself if the mirror ever
 * moved; derived, a value added there and not mapped here fails immediately.
 */
import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { TextSchema, safeValidateSchema } from '@object-ui/types/zod';
import { renderComponent } from './test-utils';
// Module scope, not a hook: the cold transform is billed to the import phase,
// which has no test/hook timeout (AGENTS.md §测试纪律, objectui#3010).
import '../renderers';

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

/** The shadcn spellings the five re-authored catalog entries used to carry. */
const SHADCN_SPELLINGS = ['small', 'p', 'muted', 'lead', 'large'] as const;

const CONTENT = 'Small text';

/** Render one authored node and hand back the element it produced, if any. */
function renderText(node: Record<string, unknown>) {
  const { container } = renderComponent({ type: 'text', content: CONTENT, ...node } as never);
  return {
    container,
    html: container.innerHTML,
    element: container.firstElementChild as HTMLElement | null,
    elementCount: container.children.length,
  };
}

describe('objectui#6942 — the published vocabulary is what the renderer reads', () => {
  it('the mirror still publishes nine variants and four alignments', () => {
    // Anti-vacuity. Every `it.each` below iterates these arrays; an empty
    // derivation would make the whole file pass while asserting nothing.
    expect(PUBLISHED_VARIANTS).toHaveLength(9);
    expect(PUBLISHED_VARIANTS).toEqual(
      expect.arrayContaining(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'caption', 'overline']),
    );
    expect(PUBLISHED_ALIGNS).toEqual(['left', 'center', 'right', 'justify']);
  });

  it.each(PUBLISHED_VARIANTS)('variant %s renders exactly one element carrying a class', (variant) => {
    const { element, elementCount } = renderText({ variant });
    expect(elementCount).toBe(1);
    expect(element?.className.trim()).not.toBe('');
    expect(element?.textContent).toBe(CONTENT);
  });

  it('no two published variants share a class — the collapse this pin exists to catch', () => {
    const classes = PUBLISHED_VARIANTS.map((variant) => renderText({ variant }).element?.className);
    expect(classes.filter(Boolean)).toHaveLength(PUBLISHED_VARIANTS.length);
    expect(new Set(classes).size).toBe(PUBLISHED_VARIANTS.length);
  });

  it.each(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])(
    '%s renders the heading element it names, not a span with heading sizing',
    (variant) => {
      expect(renderText({ variant }).element?.tagName.toLowerCase()).toBe(variant);
    },
  );

  it.each(['body', 'caption', 'overline'])('%s keeps the inline span this renderer has always wrapped with', (variant) => {
    expect(renderText({ variant }).element?.tagName.toLowerCase()).toBe('span');
  });
});

describe('objectui#6942 — align is read and mapped', () => {
  it.each(PUBLISHED_ALIGNS)('align %s reaches the DOM as its Tailwind class', (align) => {
    const { element, elementCount } = renderText({ align });
    expect(elementCount).toBe(1);
    const classes = element?.className.split(/\s+/) ?? [];
    expect(classes).toContain(`text-${align}`);
    // `text-center` on an inline box centres nothing, which would be this
    // card's own failure mode one layer down.
    expect(classes).toContain('block');
  });

  it('the four alignments are four distinct renderings', () => {
    const classes = PUBLISHED_ALIGNS.map((align) => renderText({ align }).element?.className);
    expect(new Set(classes).size).toBe(PUBLISHED_ALIGNS.length);
  });

  it('variant and align compose on one element', () => {
    const { element, elementCount } = renderText({ variant: 'h2', align: 'center' });
    expect(elementCount).toBe(1);
    expect(element?.tagName.toLowerCase()).toBe('h2');
    const classes = element?.className.split(/\s+/) ?? [];
    expect(classes).toContain('text-center');
    expect(classes).toContain('text-3xl');
  });

  it('an authored className still survives alongside the mapped classes', () => {
    const { element } = renderText({ variant: 'h3', className: 'my-custom-class' });
    expect(element?.className.split(/\s+/)).toContain('my-custom-class');
  });
});

describe('objectui#6942 — the #6318 triage test now discriminates', () => {
  it('changing the value changes the output — all four rows of the finding table', () => {
    // The finding measured these four as byte-identical: 2 elements, `Small
    // text`, for `small`, `body`, `h1` and the key absent. Three of them are
    // now three different renderings, and the fourth is still refused.
    const absent = renderText({}).html;
    const body = renderText({ variant: 'body' }).html;
    const h1 = renderText({ variant: 'h1' }).html;
    expect(new Set([absent, body, h1]).size).toBe(3);
    expect(safeValidateSchema({ type: 'text', content: CONTENT, variant: 'small' }).success).toBe(false);
  });

  it('every published value is a distinct rendering, not merely a distinct class', () => {
    const rendered = PUBLISHED_VARIANTS.map((variant) => renderText({ variant }).html);
    expect(new Set(rendered).size).toBe(PUBLISHED_VARIANTS.length);
  });

  it('an unauthored node keeps the shape it had before this card', () => {
    // ABSENCE IS NOT `body`: the Zod mirror's `.default('body')` materialises on
    // a PARSED document, not on the authored node the renderer is handed.
    // Reading absence as `body` would restyle every corpus text node that never
    // asked for a variant.
    const { elementCount, container } = renderText({});
    expect(elementCount).toBe(0);
    expect(container.textContent).toBe(CONTENT);
  });
});

describe('objectui#6942 — enforcement did not become permissiveness (the not-C control)', () => {
  it.each(SHADCN_SPELLINGS)('variant %s is still refused by safeValidateSchema', (variant) => {
    const result = safeValidateSchema({ type: 'text', content: CONTENT, variant });
    expect(result.success).toBe(false);
  });

  it.each(PUBLISHED_VARIANTS)('variant %s validates, so the refusals above are about the value', (variant) => {
    expect(safeValidateSchema({ type: 'text', content: CONTENT, variant }).success).toBe(true);
  });

  it.each(PUBLISHED_ALIGNS)('align %s validates', (align) => {
    expect(safeValidateSchema({ type: 'text', content: CONTENT, align }).success).toBe(true);
  });

  it('align outside the published four is refused too', () => {
    expect(safeValidateSchema({ type: 'text', content: CONTENT, align: 'centre' }).success).toBe(false);
  });

  it.each(SHADCN_SPELLINGS)('an off-enum %s is not quietly styled either', (variant) => {
    // Option C was "accept the spelling without implementing it". The renderer
    // must not do the inverse — style a spelling the validator refuses — or the
    // rejection and the rendering would disagree about the vocabulary.
    expect(renderText({ variant }).html).toBe(renderText({}).html);
  });
});

describe('objectui#6942 — the registration advertises the two keys it now reads', () => {
  const config = () => ComponentRegistry.getConfig('text', 'ui');
  const input = (name: string) => config()?.inputs?.find((i) => i.name === name);

  it('content is still declared', () => {
    expect(input('content')).toBeTruthy();
  });

  it.each(['variant', 'align'])('%s is declared, with the published vocabulary as its enum', (name) => {
    const declared = input(name);
    expect(declared).toBeTruthy();
    expect(declared?.type).toBe('enum');
    expect(declared?.enum).toEqual(name === 'variant' ? PUBLISHED_VARIANTS : PUBLISHED_ALIGNS);
  });
});
