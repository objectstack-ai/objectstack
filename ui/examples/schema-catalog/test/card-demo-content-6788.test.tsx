/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6788 — a catalog `card` node carries its text in a key `ui:card`
 * actually reads, and the context-menu demo draws the prompt it promises.
 *
 * ## The reading this file was written against
 *
 * `components-overlay-context-menu/basic-context-menu.json` authored its
 * trigger as `{ "type": "card", "content": "Right-click here", "className":
 * "p-8 text-center border-dashed" }`.
 * `packages/components/src/renderers/layout/card.tsx` reads five slots —
 * `title`, `description`, `header`, `children || body`, `footer` — plus
 * `clickable`/`hoverable`, and `content` is none of them; nor is `content`
 * among the `ui:card` registration's declared `inputs` (`title`,
 * `description`, `className`). Both halves re-verified on this branch's base
 * `d06059f24` before the fix was chosen.
 *
 * Rendered through the real `SchemaRenderer` the way the docs gallery renders
 * it, the tile was 3 elements and its whole text content was the empty string;
 * the instruction reached the DOM only as the leaked host attribute
 * `content="Right-click here"` — the objectui#5574 class, for which `ui:card`
 * is already ledgered in
 * `packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`.
 *
 * ## Why `children` and not `body`
 *
 * `card.tsx` reads `children || body` and `BaseSchema` marks `body` "Legacy,
 * use children"; objectui#6771 is retiring `body` as a `children` dialect. So
 * the two spellings the renderer accepts are not equal choices — one is being
 * removed. `children` is also what objectui#6773 authored in the four
 * `aspect-ratio` card demos (commit `dfb889f8d`), so the corpus converges on
 * one spelling rather than acquiring a second.
 *
 * ⛔ What was NOT done: teaching `ui:card` to read `content`. That would widen
 * a published surface to a second dialect for one slot — the shape #6771 is
 * removing elsewhere. The renderer is the contract (AGENTS.md #0.1); the demo
 * was wrong.
 *
 * ## Why the corpus sweep, and why it is the wider half
 *
 * objectui#6773 fixed four sibling demos and this was the fifth, found BY HAND
 * while doing it. A pin scoped to this one entry would leave the next one to
 * the next pair of eyes. So the assertions below run over EVERY `card` node in
 * the catalog, at any depth, in any entry.
 *
 * Census on this branch's base, walking all 431 fixtures:
 *
 *     card nodes                        93
 *     entries containing one            53
 *     categories containing one         19
 *     keys authored on those nodes      type 93 · children 85 · className 60 ·
 *                                       header 12 · title 8 · footer 1 ·
 *                                       description 1 · content 1
 *
 * `content` was the single outlier and is the defect. Every other key authored
 * anywhere in the corpus is one `card.tsx` reads, so the sweep is green the
 * moment this entry is corrected and red before it.
 *
 * ## Why two key assertions rather than one
 *
 * They fail for different reasons and a fix for one is not a fix for the other
 * — the objectui#6157 class-3 shape, where a key is refused by neither zod nor
 * tsc:
 *
 *   1. DECLARED — read off the shipped `CardSchema`'s own zod shape, not a
 *      hand-copied list, so it follows the platform instead of yesterday's
 *      vocabulary. `.success` is NOT the probe here and could not be:
 *      `BaseSchema` is `.passthrough()`, so `content` parses green (and it
 *      type-checked through `[key: string]: any` until objectui#8347). The structural read is the only
 *      instrument that sees it.
 *   2. READ — the keys `card.tsx` reads, copied as literals on purpose: they
 *      are the contract this file is about, and a renderer that starts reading
 *      a new key should turn this red for review rather than silently widen
 *      the set. This is the strictly stronger half: `variant` is DECLARED on
 *      `CardSchema` and read by nothing, so a demo authoring it would pass (1)
 *      and still draw nothing.
 *
 * `PIPELINE_KEYS` is the one allowance, and it is not a loophole: those keys
 * are handled for every node by the render pipeline rather than by `card.tsx`,
 * so a card authoring one is not this defect. The census above shows the
 * corpus authors none of them today — it is headroom, not cover.
 *
 * ## What the render assertion adds, and why it is category-scoped
 *
 * The key assertions are static; they cannot see whether anything reached the
 * screen. The acceptance criterion for this card is that the tile's text is
 * non-empty when rendered through the real `SchemaRenderer`, so the
 * context-menu category is also drawn and read. It is NOT widened to all 53
 * card-bearing entries: some of those sit inside grid/list/dashboard nodes
 * that want a datasource, and `catalog-gallery-render.test.tsx` already owns
 * the corpus-wide render sweep with its own documented exclusions. Breadth
 * here comes from the key assertions; depth comes from this one.
 *
 * ## Why nothing already red covered it
 *
 * `catalog-gallery-render.test.tsx` renders this entry today and PASSES: its
 * non-vacuity control is `elements > WRAPPER_ELEMENTS || text`, and the
 * context-menu draws a bordered trigger box around the empty card, which
 * clears it. Its stronger control — the entry's own authored strings on screen
 * — is scoped to `NEWLY_REGISTERED_CATEGORIES`, which this family is not in.
 * `check-doc-component-types.mjs` rules the question out by name ("NOT in
 * scope, deliberately: whether the snippet's OTHER keys are read by the
 * renderer the type resolves to").
 *
 * Every assertion is paired with a counter-probe that renders or judges the
 * exact pre-fix shape — the objectui#6157 discipline. What is pinned is not
 * "the text is somewhere on screen" but "the key that carries it is one the
 * renderer reads".
 *
 * Module-scope import of `@object-ui/components`, not `beforeAll` (AGENTS.md
 * §测试纪律): registering the renderers is an unbounded module load and must
 * not be billed to a bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { CardSchema } from '@object-ui/types/zod';
import { allExamples } from '../src/index.js';

type Json = Record<string, unknown>;

/**
 * The keys `packages/components/src/renderers/layout/card.tsx` reads off the
 * schema, plus the `type` discriminator. COPIED as literals — see the header.
 */
const RENDERER_READ_KEYS = [
  'type',
  'className',
  'title',
  'description',
  'header',
  'children',
  'body',
  'footer',
  'clickable',
  'hoverable',
];

/**
 * Node-level keys the render pipeline handles for EVERY node, whatever its
 * type — so a card authoring one is not the phantom-key defect this file is
 * about. No card node in the corpus authors any of them today.
 */
const PIPELINE_KEYS = ['id', 'name', 'bind', 'data', 'events', 'style', 'props', 'testId', 'visible', 'hidden', 'ariaLabel'];

/** Keys that carry visible text in the nodes this catalog authors. */
const TEXT_SLOTS = ['children', 'body', 'title', 'description'];

const CONTEXT_MENU_CATEGORY = 'components-overlay-context-menu';

/** Every key the SHIPPED `CardSchema` declares — read off its zod shape. */
function declaredCardKeys(): string[] {
  const carrier = CardSchema as unknown as { shape?: Json; _def?: { shape?: Json } };
  const shape = carrier.shape ?? carrier._def?.shape;
  if (!shape) throw new Error('CardSchema exposes no readable shape');
  return Object.keys(shape);
}

type Located = { where: string; node: Json };

/** Every `card` node in one entry, at any depth, with a readable location. */
function collectCards(node: unknown, where: string, into: Located[]): Located[] {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectCards(child, `${where}[${i}]`, into));
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  const record = node as Json;
  if (record.type === 'card') into.push({ where, node: record });
  for (const [key, value] of Object.entries(record)) {
    collectCards(value, `${where}.${key}`, into);
  }
  return into;
}

const entries = allExamples();
const cards: Located[] = entries.flatMap((entry) =>
  collectCards(entry.schema, entry.id, []),
);

/** Render one entry the way `SchemaThumbnail` does. */
function draw(schema: unknown) {
  const { container, unmount } = render(
    <div className="w-full p-4">
      <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
    </div>,
  );
  return { text: container.textContent ?? '', container, unmount };
}

/** Every string this node authors in a content slot, at any depth. */
function authoredText(node: unknown, inSlot = false): string[] {
  if (typeof node === 'string') return inSlot ? [node] : [];
  if (Array.isArray(node)) return node.flatMap((child) => authoredText(child, inSlot));
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node as Json).flatMap(([key, value]) =>
    authoredText(value, TEXT_SLOTS.includes(key)),
  );
}

/** The offending keys on one card node, against an allowed set. */
function unreadKeys(node: Json, allowed: readonly string[]): string[] {
  return Object.keys(node).filter((key) => !allowed.includes(key));
}

describe('catalog corpus: every `card` node authors keys `ui:card` reads (objectui#6788)', () => {
  it('the walk is not vacuous — a broken collector would pass every case below', () => {
    // Measured on d06059f24; these are floors, not equalities, so growth of
    // the catalog does not fail the file — only a walk that stopped working.
    expect(entries.length).toBeGreaterThanOrEqual(431);
    expect(cards.length).toBeGreaterThanOrEqual(93);
    expect(new Set(cards.map((c) => c.where.split('/')[0])).size).toBeGreaterThanOrEqual(19);
  });

  it('every authored key is DECLARED by the shipped CardSchema', () => {
    const declared = declaredCardKeys();
    // The declared set is read, not assumed: if the shape ever comes back
    // empty this assertion would pass vacuously in the other direction.
    expect(declared).toContain('children');
    expect(declared).not.toContain('content');

    const offenders = cards
      .map(({ where, node }) => ({ where, keys: unreadKeys(node, declared) }))
      .filter((hit) => hit.keys.length > 0);
    expect(offenders).toEqual([]);
  });

  it('every authored key is one `card.tsx` READS', () => {
    const allowed = [...RENDERER_READ_KEYS, ...PIPELINE_KEYS];
    const offenders = cards
      .map(({ where, node }) => ({ where, keys: unreadKeys(node, allowed) }))
      .filter((hit) => hit.keys.length > 0);
    expect(offenders).toEqual([]);
  });

  it('counter-probe: the pre-#6788 node fails BOTH key assertions, so both bite', () => {
    const preFix: Json = {
      type: 'card',
      content: 'Right-click here',
      className: 'p-8 text-center border-dashed',
    };
    expect(unreadKeys(preFix, declaredCardKeys())).toEqual(['content']);
    expect(unreadKeys(preFix, [...RENDERER_READ_KEYS, ...PIPELINE_KEYS])).toEqual(['content']);

    // And the corrected node clears both — the judge is not simply strict.
    const fixed: Json = {
      type: 'card',
      children: 'Right-click here',
      className: 'p-8 text-center border-dashed',
    };
    expect(unreadKeys(fixed, declaredCardKeys())).toEqual([]);
    expect(unreadKeys(fixed, [...RENDERER_READ_KEYS, ...PIPELINE_KEYS])).toEqual([]);
  });

  it('counter-probe: the READ assertion is strictly stronger than the DECLARED one', () => {
    // `variant` is a declared `CardSchema` member that `card.tsx` never reads,
    // so a demo authoring it draws nothing different. Assertion (1) accepts
    // it; assertion (2) is what would catch it.
    const declaredButUnread: Json = { type: 'card', variant: 'outline', children: 'x' };
    expect(unreadKeys(declaredButUnread, declaredCardKeys())).toEqual([]);
    expect(unreadKeys(declaredButUnread, [...RENDERER_READ_KEYS, ...PIPELINE_KEYS])).toEqual([
      'variant',
    ]);
  });
});

const contextMenuEntries = entries.filter((e) => e.meta.category === CONTEXT_MENU_CATEGORY);

describe(`${CONTEXT_MENU_CATEGORY} demos draw their trigger text (objectui#6788)`, () => {
  it('the category is not empty — a vacuous sweep would pass every case below', () => {
    expect(contextMenuEntries.length).toBeGreaterThanOrEqual(1);
  });

  it.each(contextMenuEntries.map((e) => [e.id, e] as const))(
    '%s renders a trigger tile with non-empty text',
    (_id, entry) => {
      const schema = entry.schema as unknown as Json;
      const drawn = draw(schema);
      try {
        // The acceptance criterion for this card, stated as the card states
        // it: the tile's text content is non-empty when rendered through the
        // real `SchemaRenderer`.
        expect(drawn.text.trim()).not.toBe('');
        // And it is the author's own string, not incidental chrome.
        const texts = authoredText(schema.trigger);
        expect(texts.length).toBeGreaterThan(0);
        for (const text of texts) expect(drawn.text).toContain(text);
        // The string is a text node, not a leaked host attribute
        // (objectui#5574): no element carries it as `content`.
        expect(drawn.container.querySelector('[content]')).toBeNull();
      } finally {
        drawn.unmount();
      }
    },
  );

  it('counter-probe: the pre-#6788 shape draws an EMPTY tile', () => {
    // Verbatim the shape `basic-context-menu.json` carried before this change.
    // The assertions above are satisfied by it only if they have stopped
    // measuring anything.
    const drawn = draw({
      type: 'context-menu',
      trigger: { type: 'card', content: 'Right-click here', className: 'p-8 text-center border-dashed' },
      items: [{ label: 'Copy', icon: 'copy' }],
    });
    try {
      expect(drawn.text.trim()).toBe('');
      // ...and the string is in the DOM only as the leaked host attribute,
      // which is what made this invisible to a red-tile sweep.
      const leaked = drawn.container.querySelector('[content]');
      expect(leaked?.getAttribute('content')).toBe('Right-click here');
    } finally {
      drawn.unmount();
    }
  });

  it('counter-probe: the judge sees text authored under a key the renderer reads', () => {
    const drawn = draw({
      type: 'context-menu',
      trigger: { type: 'card', children: 'Right-click here', className: 'p-8 text-center border-dashed' },
      items: [{ label: 'Copy', icon: 'copy' }],
    });
    try {
      expect(drawn.text).toContain('Right-click here');
      expect(drawn.container.querySelector('[content]')).toBeNull();
    } finally {
      drawn.unmount();
    }
  });
});
