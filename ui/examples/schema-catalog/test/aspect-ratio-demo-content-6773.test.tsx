/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6773 — every `components-layout-aspect-ratio` demo puts its own
 * authored content inside the ratio box.
 *
 * ## The reading this file was written against
 *
 * All five shipped demos authored `content`, and
 * `packages/components/src/renderers/layout/aspect-ratio.tsx` reads four keys —
 * `ratio`, `className`, `image` (with `alt`), and `children || body` — none of
 * them `content`. Measured on `origin/main` @ `c6732825d`, rendering each entry
 * through the real `SchemaRenderer` the way the docs gallery does:
 *
 *   entry                                     elements  text  img
 *   components-layout-aspect-ratio/16-9-…            3    ""    0
 *   components-layout-aspect-ratio/square            3    ""    0
 *   components-layout-aspect-ratio/4-3               3    ""    0
 *   components-layout-aspect-ratio/ultrawide         3    ""    0
 *   components-layout-aspect-ratio/video-…           3    ""    0
 *
 * Three elements is the harness wrapper plus the two Radix AspectRatio emits.
 * The authored `content` reached the DOM only as the leaked host attribute
 * `content="[object Object]"` — the objectui#5574 class, and `ui:aspect-ratio`
 * is already ledgered for it in
 * `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`.
 *
 * ## Why nothing already red covered it
 *
 * `catalog-gallery-render.test.tsx` DOES render all five, and passes: its
 * non-vacuity control is `drewSomething(elements > WRAPPER_ELEMENTS || text)`,
 * and an empty ratio box clears it on the wrapper Radix draws for the ratio
 * itself. Its stronger control — the entry's own authored strings on screen —
 * is scoped to `NEWLY_REGISTERED_CATEGORIES`, which this family is not in.
 * Nor could a parse have caught it: `BaseSchema` is `.passthrough()`, so
 * `content` is accepted by zod (and was by tsc, through `[key: string]: any`,
 * until objectui#8347) (the objectui#6157 class-3 shape). `check-doc-component-types.mjs`
 * rules the question out by name — "NOT in scope, deliberately: whether the
 * snippet's OTHER keys are read by the renderer the type resolves to".
 *
 * So the control that was missing is the one below, and it is asserted at
 * CATEGORY scope rather than over a list of five ids: a sixth demo authoring
 * the phantom key again fails here without anyone remembering to add it.
 *
 * Each assertion is paired with a counter-probe that proves it can still fail
 * — the objectui#6157 discipline. The counter-probe renders the exact pre-fix
 * shape, so what is pinned is not "the text is somewhere on screen" but "the
 * key that carries it is one the renderer reads".
 *
 * Module-scope import of `@object-ui/components`, not `beforeAll` (AGENTS.md
 * §测试纪律): registering the renderers is an unbounded module load and must
 * not be billed to a bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { allExamples } from '../src/index.js';

const CATEGORY = 'components-layout-aspect-ratio';

/**
 * The keys `aspect-ratio.tsx` reads off the schema, plus the `type`
 * discriminator. COPIED as literals rather than imported: they are the
 * contract this file is about, and a renderer that starts reading a new key
 * should turn this red for review rather than silently widen the set.
 */
const READ_KEYS = ['type', 'ratio', 'className', 'image', 'alt', 'children', 'body'];

/** Keys that carry visible content in the nodes this family authors. */
const TEXT_SLOTS = ['children', 'body', 'title', 'description'];

/** Render one entry the way `SchemaThumbnail` does. */
function draw(schema: unknown) {
  const { container, unmount } = render(
    <div className="w-full p-4">
      <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
    </div>,
  );
  return {
    text: container.textContent ?? '',
    images: Array.from(container.querySelectorAll('img')).map((el) => ({
      src: el.getAttribute('src') ?? '',
      alt: el.getAttribute('alt') ?? '',
    })),
    unmount,
  };
}

/** Every string this node authors in a content slot, at any depth. */
function authoredText(node: unknown, inSlot = false): string[] {
  if (typeof node === 'string') return inSlot ? [node] : [];
  if (Array.isArray(node)) return node.flatMap((child) => authoredText(child, inSlot));
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    authoredText(value, TEXT_SLOTS.includes(key)),
  );
}

const entries = allExamples().filter((e) => e.meta.category === CATEGORY);

describe(`${CATEGORY} demos render their authored content (objectui#6773)`, () => {
  it('the category is not empty — a vacuous sweep would pass every case below', () => {
    expect(entries.length).toBeGreaterThanOrEqual(5);
  });

  it.each(entries.map((e) => [e.id, e] as const))(
    '%s authors only keys the renderer reads',
    (_id, entry) => {
      const authored = Object.keys(entry.schema as Record<string, unknown>);
      expect(authored.filter((key) => !READ_KEYS.includes(key))).toEqual([]);
    },
  );

  it.each(entries.map((e) => [e.id, e] as const))(
    '%s puts its authored content inside the box',
    (_id, entry) => {
      const schema = entry.schema as Record<string, unknown>;
      const drawn = draw(schema);
      try {
        if (typeof schema.image === 'string') {
          // The `image` arm: the renderer's own <img>, not a nested node.
          expect(drawn.images).toEqual([
            { src: schema.image, alt: (schema.alt as string) ?? '' },
          ]);
        }
        const texts = authoredText(schema);
        expect(texts.length + drawn.images.length).toBeGreaterThan(0);
        for (const text of texts) expect(drawn.text).toContain(text);
      } finally {
        drawn.unmount();
      }
    },
  );

  it('counter-probe: the pre-#6773 `content` shape draws an EMPTY box', () => {
    // Verbatim the shape `square.json` and `16-9-aspect-ratio.json` carried
    // before this change. Both assertions above are satisfied by it only if
    // they have stopped measuring anything.
    const card = draw({
      type: 'aspect-ratio',
      ratio: 1,
      content: { type: 'card', content: 'Square (1:1)' },
    });
    try {
      expect(card.text.trim()).toBe('');
      expect(card.images).toEqual([]);
    } finally {
      card.unmount();
    }

    const photo = draw({
      type: 'aspect-ratio',
      ratio: 16 / 9,
      content: { type: 'image', src: 'https://example.test/photo.jpg', alt: 'Photo' },
    });
    try {
      expect(photo.images).toEqual([]);
      expect(photo.text.trim()).toBe('');
    } finally {
      photo.unmount();
    }
  });

  it('counter-probe: the judge sees content that IS authored under a read key', () => {
    const drawn = draw({
      type: 'aspect-ratio',
      ratio: 1,
      children: { type: 'card', children: 'Square (1:1)' },
    });
    try {
      expect(drawn.text).toContain('Square (1:1)');
      expect(authoredText({ children: { type: 'card', children: 'Square (1:1)' } })).toEqual([
        'Square (1:1)',
      ]);
    } finally {
      drawn.unmount();
    }
  });
});
