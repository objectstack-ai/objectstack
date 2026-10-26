/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6805 + objectui#6806 — two catalog families author their body under
 * `content`, a key neither renderer reads, and the repair key is NOT the same
 * for both.
 *
 * ## Why one file for two cards
 *
 * They share a defect shape and NOT a repair key, and that is the whole point:
 *
 *   node          renderer reads                             correct key
 *   scroll-area   renderChildren(schema.children)            children
 *   badge         schema.label || renderChildren(schema.body) label
 *
 * ⇒ a blind `content` -> `children` sweep repairs #6805 and SILENTLY LEAVES
 * #6806 BROKEN, behind a green "no `content` left in the catalog" assertion.
 * The counter-probe named `the WRONG generalisation` below is the assertion
 * that exists to make that mistake loud; it is measured, not asserted from
 * theory (a `badge` authoring `children` draws an empty pill — see #6829).
 *
 * The shared method is "author the key this renderer actually reads", never
 * "rename `content` to `children`". So every sweep here is PER RENDERER with
 * its own read set, in the shape objectui#6788 established for `card` nodes.
 *
 * ## The readings this file was written against
 *
 * Measured on `origin/main` `26896c689`, walking all 431 fixtures:
 *
 *   scroll-area   7 nodes, 1 category, ALL SEVEN authoring `content`
 *                 keys authored: type 7 · height 7 · className 7 ·
 *                                content 7 · width 2 · orientation 2
 *   badge        40 nodes, 12 categories, 2 authoring `content`
 *                 keys authored: type 40 · variant 36 · label 31 ·
 *                                className 8 · children 7 · content 2
 *
 * Rendered through the real `SchemaRenderer` the way the docs gallery renders
 * them, BEFORE the fixture edits in this PR:
 *
 *   components-complex-scroll-area/*        elements=5   leaked=1  text=(Radix
 *                                           scrollbar stylesheet only)
 *   components-basic-sidebar/sidebar-…      elements=22  leaked=2
 *                                           text="InboxDraftsSentTrashMain content area"
 *
 * AFTER:
 *
 *   …/tall-300px       elements=36  leaked=0  text=…"Line 1Line 2Line 3"…
 *   …/chat-messages    elements=81  leaked=0  text=…"AUser 1This is a sample message…"
 *   …/sidebar-with-badges elements=22 leaked=0 text="Inbox12Drafts3SentTrashMain content area"
 *
 * `leaked` counts elements carrying the authored array/string as the host
 * attribute `content` — the objectui#5574 class.
 *
 * ## ⭐ The exclusion list, encoded rather than only described
 *
 * `text` nodes authoring `content` are NOT members of this class and must not
 * be swept. `packages/components/src/renderers/basic/text.tsx` reads
 * `schema.content || schema.value`, so those 666 corpus nodes render
 * correctly today — `sidebar-with-badges`'s own sibling `text` nodes are the
 * proof, inside the very fixture #6806 repairs. One key, two renderers,
 * opposite outcomes. A sweep that "fixed" them would break working demos.
 *
 * Corpus-wide, `content` is authored by: text 666 · untyped 30 · sheet 3 ·
 * markdown 3 · card 1 (objectui#6788, in flight) · tooltip 1 · hover-card 1.
 * ⇒ ⛔ a blanket "no `content` anywhere" rule reds on working fixtures, which
 * is why nothing here is written that way. The measured statement this file
 * DOES make is narrower and checkable: inside the two families touched here,
 * every remaining `content` key sits on a `text` node.
 *
 * ⛔ Also not done: teaching either renderer to read `content`. The renderer
 * is the contract (AGENTS.md #0.1); a second dialect for one slot on a
 * published surface is the opposite of the repair. And for `badge`
 * specifically, ⛔ not `body` either even though the renderer reads it —
 * objectui#6771 is retiring `body` as a `children` dialect, so `label` is the
 * spelling the corpus converges on (31 badge nodes already use it).
 *
 * ## Why nothing already red covered either card
 *
 * `catalog-gallery-render.test.tsx` renders both families today and PASSES.
 * Its non-vacuity control is `elements > WRAPPER_ELEMENTS || text`, and it has
 * two DIFFERENT holes here:
 *
 *   - #6805: Radix's own injected scrollbar stylesheet is text, so a
 *     category-wide empty render clears the control on a string the component
 *     itself emitted.
 *   - #6806: the sidebar draws 22 elements and real text, so the control
 *     STRUCTURALLY cannot see two missing badges inside it.
 *
 * (A third hole was measured while sizing this file and filed as
 * objectui#6829: an empty `badge` host element is itself the third element, so
 * a demo drawing nothing but an empty pill clears the control too. Arm A of
 * that card re-authored those seven nodes to `label`; the per-renderer render
 * pin lives in `badge-demo-label-6829.test.tsx`.)
 *
 * ⚠️ The fix for all three is the per-renderer sweep below, ⛔ not a stricter
 * global non-vacuity threshold — that is out of scope here and would red on
 * working fixtures. Whether the sweep generalises to EVERY registered renderer
 * is objectui#6810, an open `needs-user-decision` card; this file deliberately
 * covers only the two renderers these two cards name.
 *
 * Nor could a parse have caught either: `BaseSchema` is `.passthrough()`, so
 * `content` is accepted by zod (and was by tsc, through `[key: string]: any`,
 * until objectui#8347). `check-doc-component-types.mjs` rules the question out by name.
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

type Json = Record<string, unknown>;

/**
 * Node-level keys the render pipeline handles for EVERY node whatever its
 * type, so a node authoring one is not the phantom-key defect. Copied from the
 * objectui#6788 sweep so the two files judge the same way. No node of either
 * type authors one today — headroom, not cover.
 */
const PIPELINE_KEYS = [
  'id', 'name', 'bind', 'data', 'events', 'style', 'props',
  'testId', 'visible', 'hidden', 'ariaLabel',
];

/**
 * One row per renderer this file sweeps: the keys that renderer ACTUALLY
 * reads off the schema, and the key its authors must use for the body.
 *
 * `readKeys` are COPIED as literals on purpose (the objectui#6773/#6788
 * discipline): they are the contract this file is about, so a renderer that
 * starts reading a new key should turn this red for review rather than
 * silently widen the set.
 *
 * ⚠️ The two rows differ, and that difference is the reason both cards are in
 * one PR. `contentKey` is per row; there is deliberately no shared constant.
 */
const RENDERERS = [
  {
    type: 'scroll-area',
    // packages/components/src/renderers/complex/scroll-area.tsx
    readKeys: ['type', 'orientation', 'height', 'width', 'className', 'children'],
    contentKey: 'children',
    issue: 'objectui#6805',
    minNodes: 7,
  },
  {
    type: 'badge',
    // packages/components/src/renderers/data-display/badge.tsx:32 —
    // `schema.label || renderChildren(schema.body)`. `body` is here because
    // the renderer reads it TODAY, not because it is the spelling to use:
    // objectui#6771 is retiring it.
    readKeys: ['type', 'label', 'variant', 'className', 'body'],
    contentKey: 'label',
    issue: 'objectui#6806',
    minNodes: 40,
  },
] as const;

/**
 * `badge` nodes authoring `children` — a key `badge.tsx` does NOT read, unlike
 * `card.tsx` which reads `children || body`. Measured while sizing this file as
 * SEVEN nodes (`components-basic-span/{default-badge, secondary-badge,
 * status-badges x3}` and `core-schema-renderer/nested-schema-example x2`) and
 * filed as objectui#6829. Its triage split the repair in two: arm A re-authors
 * the fixtures to `label` and has landed, so the ledger is now EMPTY; arm B
 * (widening the renderer's read set) is objectui#6810's, not this file's.
 *
 * Still asserted as an EXACT set, not a floor, and deliberately KEPT rather
 * than deleted: arm A restored the demos and did NOT close the class. Every
 * other container renderer accepts `children`, so the next author who writes
 * it on a badge draws an empty pill again — and that node must turn this red
 * by name rather than join a growing allowance. The RENDER half (the pill's
 * text equals its label, corpus-wide) is `badge-demo-label-6829.test.tsx`.
 */
const BADGE_CHILDREN_LEDGER_6829: string[] = [];

/**
 * Keys that carry visible text in the nodes these families author.
 *
 * ⭐ `content` is in this list BECAUSE OF THE EXCLUSION LIST: on a `text` node
 * it is the key the renderer reads, and `text` nodes are what carry the
 * strings inside both families. `label` is here for the same reason on
 * `badge`. That is the exclusion list restated as executable code rather than
 * prose.
 */
const TEXT_SLOTS = ['children', 'body', 'title', 'description', 'content', 'label'];

const SCROLL_AREA_CATEGORY = 'components-complex-scroll-area';
const BADGE_ENTRY_ID = 'components-basic-sidebar/sidebar-with-badges';

type Located = { where: string; node: Json };

/** Every node of one type in a subtree, at any depth, with a readable location. */
function collectType(node: unknown, type: string, where: string, into: Located[]): Located[] {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectType(child, type, `${where}[${i}]`, into));
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  const record = node as Json;
  if (record.type === type) into.push({ where, node: record });
  for (const [key, value] of Object.entries(record)) {
    collectType(value, type, `${where}.${key}`, into);
  }
  return into;
}

/** Render one entry the way `SchemaThumbnail` does. */
function draw(schema: unknown) {
  const { container, unmount } = render(
    <div className="w-full p-4">
      <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
    </div>,
  );
  return {
    text: container.textContent ?? '',
    /** Elements carrying the authored value as a host attribute (objectui#5574). */
    leaked: container.querySelectorAll('[content]').length,
    container,
    unmount,
  };
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

/** The keys on one node that the allowed set does not cover. */
function unreadKeys(node: Json, allowed: readonly string[]): string[] {
  return Object.keys(node).filter((key) => !allowed.includes(key));
}

const entries = allExamples();
const nodesOf = (type: string): Located[] =>
  entries.flatMap((entry) => collectType(entry.schema, type, entry.id, []));

// ---------------------------------------------------------------------------
// 1. The corpus sweep — per renderer, each against ITS OWN read set.
// ---------------------------------------------------------------------------

describe('catalog corpus: every node authors keys ITS renderer reads (objectui#6805 + objectui#6806)', () => {
  it('the walk is not vacuous — a broken collector would pass every case below', () => {
    // Floors, not equalities: catalog growth must not fail this file, only a
    // walk that stopped working.
    expect(entries.length).toBeGreaterThanOrEqual(431);
    for (const renderer of RENDERERS) {
      expect(nodesOf(renderer.type).length).toBeGreaterThanOrEqual(renderer.minNodes);
    }
  });

  it.each(RENDERERS.map((r) => [r.type, r] as const))(
    'no `%s` node authors `content` any more — the defect these cards close',
    (_type, renderer) => {
      const offenders = nodesOf(renderer.type)
        .filter(({ node }) => 'content' in node)
        .map(({ where }) => where);
      expect(offenders).toEqual([]);
    },
  );

  it('every `scroll-area` node authors only keys `scroll-area.tsx` READS', () => {
    const allowed = [...RENDERERS[0].readKeys, ...PIPELINE_KEYS];
    const offenders = nodesOf('scroll-area')
      .map(({ where, node }) => ({ where, keys: unreadKeys(node, allowed) }))
      .filter((hit) => hit.keys.length > 0);
    expect(offenders).toEqual([]);
  });

  it('every `badge` node authors only keys `badge.tsx` READS — the objectui#6829 ledger is exact and empty', () => {
    const allowed = [...RENDERERS[1].readKeys, ...PIPELINE_KEYS];
    const offenders = nodesOf('badge')
      .map(({ where, node }) => ({ where, keys: unreadKeys(node, allowed) }))
      .filter((hit) => hit.keys.length > 0);
    // Any offender is the `children` shape objectui#6829 owns, and the ledger
    // is EXACT — empty since arm A, so the FIRST node reds here by name rather
    // than being absorbed.
    expect(offenders.map((hit) => hit.keys)).toEqual(offenders.map(() => ['children']));
    expect(offenders.map((hit) => hit.where).sort()).toEqual(
      [...BADGE_CHILDREN_LEDGER_6829].sort(),
    );
  });

  it('the two renderers do NOT share a repair key — the constraint that folded these cards', () => {
    // Guards the generalisation this PR exists to prevent: if someone later
    // "unifies" the table on one key, this fails before the sweep does.
    expect(RENDERERS.map((r) => `${r.type}:${r.contentKey}`)).toEqual([
      'scroll-area:children',
      'badge:label',
    ]);
    expect(new Set(RENDERERS.map((r) => r.contentKey)).size).toBe(RENDERERS.length);
  });
});

// ---------------------------------------------------------------------------
// 2. objectui#6805 — one named render assertion per member (7 of 7).
// ---------------------------------------------------------------------------

const scrollAreaEntries = entries.filter((e) => e.meta.category === SCROLL_AREA_CATEGORY);

describe(`${SCROLL_AREA_CATEGORY} — each demo draws its own content (objectui#6805)`, () => {
  it('the category holds all seven members — a vacuous sweep would pass every case below', () => {
    expect(scrollAreaEntries.length).toBe(7);
  });

  it.each(scrollAreaEntries.map((e) => [e.id, e] as const))(
    '%s authors `children` (not `content`) and its own text reaches the DOM',
    (_id, entry) => {
      const schema = entry.schema as unknown as Json;
      // Named key assertion: this member's own repair key, on the root node
      // the card measured.
      expect(schema.type).toBe('scroll-area');
      expect(schema).toHaveProperty('children');
      expect(schema).not.toHaveProperty('content');

      const drawn = draw(schema);
      try {
        const texts = authoredText(schema);
        expect(texts.length).toBeGreaterThan(0);
        for (const text of texts) expect(drawn.text).toContain(text);
        // …and it is a text node, not the leaked host attribute.
        expect(drawn.leaked).toBe(0);
      } finally {
        drawn.unmount();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// 3. objectui#6806 — one named render assertion per member (2 of 2).
// ---------------------------------------------------------------------------

const badgeEntry = entries.find((e) => e.id === BADGE_ENTRY_ID);
const sidebarBadges = collectType(badgeEntry?.schema, 'badge', BADGE_ENTRY_ID, []);

describe(`${BADGE_ENTRY_ID} — each badge draws its own count (objectui#6806)`, () => {
  it('both members are present — a vacuous sweep would pass every case below', () => {
    expect(badgeEntry).toBeDefined();
    expect(sidebarBadges).toHaveLength(2);
  });

  it.each(sidebarBadges.map((b) => [String(b.node.label ?? b.where), b] as const))(
    'badge %s authors `label` (not `content`) and that count reaches the DOM',
    (_label, located) => {
      // Named key assertion: `label`, this member's own repair key — NOT
      // `children` (which draws an empty pill, objectui#6829) and NOT `body`
      // (objectui#6771 is retiring it).
      expect(located.node).toHaveProperty('label');
      expect(located.node).not.toHaveProperty('content');
      expect(located.node).not.toHaveProperty('children');
      expect(located.node).not.toHaveProperty('body');

      const drawn = draw(located.node);
      try {
        expect(drawn.text).toBe(String(located.node.label));
        expect(drawn.leaked).toBe(0);
      } finally {
        drawn.unmount();
      }
    },
  );

  it('the whole demo draws each count beside its own item — the card\'s acceptance criterion', () => {
    const drawn = draw(badgeEntry!.schema);
    try {
      // Adjacency, not mere presence: a count that rendered somewhere else
      // would satisfy `toContain` and still be the wrong sidebar.
      expect(drawn.text).toContain('Inbox12');
      expect(drawn.text).toContain('Drafts3');
      expect(drawn.leaked).toBe(0);
    } finally {
      drawn.unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The exclusion list — `text` nodes authoring `content` are NOT members.
// ---------------------------------------------------------------------------

describe('exclusion list: `text` nodes authoring `content` render correctly and must not be swept', () => {
  it('a `text` node authoring `content` draws its string — the live control', () => {
    const drawn = draw({ type: 'text', content: 'Inbox' });
    try {
      expect(drawn.text).toBe('Inbox');
    } finally {
      drawn.unmount();
    }
  });

  it('the corpus still authors `content` on hundreds of `text` nodes, deliberately', () => {
    // If this ever reads 0, someone ran the blanket sweep this file argues
    // against, and hundreds of working demos went with it.
    expect(nodesOf('text').filter(({ node }) => 'content' in node).length)
      .toBeGreaterThanOrEqual(600);
  });

  it('inside both touched families, every remaining `content` sits on a `text` node', () => {
    const touched = entries.filter(
      (e) => e.meta.category === SCROLL_AREA_CATEGORY || e.id === BADGE_ENTRY_ID,
    );
    const carriers: string[] = [];
    const walk = (node: unknown, where: string) => {
      if (Array.isArray(node)) return node.forEach((c, i) => walk(c, `${where}[${i}]`));
      if (!node || typeof node !== 'object') return;
      const record = node as Json;
      if ('content' in record) carriers.push(`${where}:${String(record.type)}`);
      for (const [k, v] of Object.entries(record)) walk(v, `${where}.${k}`);
    };
    for (const entry of touched) walk(entry.schema, entry.id);
    expect(carriers.length).toBeGreaterThan(0);
    expect(carriers.filter((c) => !c.endsWith(':text'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Counter-probes — every assertion above proven able to fail.
// ---------------------------------------------------------------------------

describe('counter-probes (objectui#6157 discipline)', () => {
  it('the pre-objectui#6805 `scroll-area` shape draws an EMPTY box and leaks `content`', () => {
    // Verbatim the shape `tall-300px.json` carried before this change.
    const drawn = draw({
      type: 'scroll-area',
      height: '300px',
      className: 'rounded-md border',
      content: [{ type: 'text', content: 'Line 1' }],
    });
    try {
      // Not `toBe('')`: the only text is Radix's own injected scrollbar
      // stylesheet, which is exactly what let this past the gallery control.
      expect(drawn.text).not.toContain('Line 1');
      expect(drawn.text).toContain('[data-radix-scroll-area-viewport]');
      expect(drawn.leaked).toBe(1);
    } finally {
      drawn.unmount();
    }
  });

  it('the pre-objectui#6806 `badge` shape draws an EMPTY pill and leaks `content`', () => {
    const drawn = draw({ type: 'badge', content: '12', className: 'ml-auto' });
    try {
      expect(drawn.text).toBe('');
      expect(drawn.leaked).toBe(1);
      expect(drawn.container.querySelector('[content]')?.getAttribute('content')).toBe('12');
    } finally {
      drawn.unmount();
    }
  });

  it('⭐ the WRONG generalisation: a `badge` repaired to the RETIRED key is STILL empty', () => {
    // THE assertion this PR exists for: a blind sweep onto one renderer's key
    // is correct for `scroll-area` and leaves both badges blank, while passing
    // a "no `content` left in the catalog" check as it does it.
    //
    // ⚠️ RE-POINTED at `body` by objectui#6771. The key this probe used was
    // `children`, which `badge` did not read; the retirement converged `badge`
    // onto `children`, so the blind sweep that is still wrong is the one onto
    // the retired spelling. ⛔ The PRINCIPLE is untouched and is the reason the
    // probe is re-pointed rather than deleted: author the key THIS renderer
    // reads, never the key some other renderer reads.
    const wrong = draw({ type: 'badge', body: '12', className: 'ml-auto' });
    try {
      expect(wrong.text).toBe('');
      // …and it does not even leak — `SchemaRenderer` still strips the retired
      // key out of the props bag — so the objectui#5574 attribute sweep that
      // catches the `content` spelling cannot catch this one (objectui#6829).
      expect(wrong.leaked).toBe(0);
    } finally {
      wrong.unmount();
    }

    // The key this PR actually used is the one that works.
    const right = draw({ type: 'badge', label: '12', className: 'ml-auto' });
    try {
      expect(right.text).toBe('12');
    } finally {
      right.unmount();
    }
  });

  it('the same generalisation IS correct for `scroll-area` — the halves really do differ', () => {
    const drawn = draw({
      type: 'scroll-area',
      height: '300px',
      children: [{ type: 'text', content: 'Line 1' }],
    });
    try {
      expect(drawn.text).toContain('Line 1');
      expect(drawn.leaked).toBe(0);
    } finally {
      drawn.unmount();
    }
  });

  it('the key judge bites: pre-fix nodes fail their own read set, fixed nodes clear it', () => {
    const scrollAllowed = [...RENDERERS[0].readKeys, ...PIPELINE_KEYS];
    const badgeAllowed = [...RENDERERS[1].readKeys, ...PIPELINE_KEYS];
    expect(unreadKeys({ type: 'scroll-area', height: '300px', content: [] }, scrollAllowed))
      .toEqual(['content']);
    expect(unreadKeys({ type: 'scroll-area', height: '300px', children: [] }, scrollAllowed))
      .toEqual([]);
    expect(unreadKeys({ type: 'badge', content: '12' }, badgeAllowed)).toEqual(['content']);
    expect(unreadKeys({ type: 'badge', label: '12' }, badgeAllowed)).toEqual([]);
    // And the judge is not simply strict about `children`: it is unread on
    // `badge` (objectui#6829) and read on `scroll-area`.
    expect(unreadKeys({ type: 'badge', children: '12' }, badgeAllowed)).toEqual(['children']);
  });

  it('the text collector is not blind — it sees strings under a read key', () => {
    expect(authoredText({ type: 'scroll-area', children: [{ type: 'text', content: 'Line 1' }] }))
      .toEqual(['Line 1']);
    // …and it does NOT invent strings from a node's own type/className.
    expect(authoredText({ type: 'scroll-area', className: 'rounded-md border' })).toEqual([]);
  });
});
