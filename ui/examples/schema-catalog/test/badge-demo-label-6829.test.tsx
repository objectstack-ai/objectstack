/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6829 (arm A) — every catalog `badge` node draws its authored text,
 * measured as the pill's RENDERED text and compared to the `label` it authors.
 *
 * ## The reading this file was written against
 *
 * `packages/components/src/renderers/data-display/badge.tsx` renders
 * `schema.label || renderChildren(schema.body)`: it reads `label` and `body`
 * and never `children`. Seven catalog nodes authored `children` anyway —
 * `components-basic-span/{default-badge, secondary-badge, status-badges x3}`
 * and `core-schema-renderer/nested-schema-example x2` — and were carried as
 * the exact `BADGE_CHILDREN_LEDGER_6829` in
 * `catalog-authored-key-6805-6806.test.tsx` until the card was ruled. That
 * file owns the KEY half (the read set, per renderer); this one owns the
 * RENDER half.
 *
 * Re-derived on this branch's base `ce45a0306`, walking all 431 fixtures:
 *
 *     badge nodes                 40   in 12 categories
 *     keys authored on them       type 40 · variant 36 · label 33 ·
 *                                 className 8 · children 7
 *
 * (The card's census read `label 31 · content 2`; the two `content` nodes had
 * already moved to `label` with objectui#6805/#6806.) Rendered through the
 * real `SchemaRenderer` the way the docs gallery renders them, BEFORE the
 * fixture edits:
 *
 *     entry                                        elements   text
 *     components-basic-span/default-badge                 2   ""
 *     components-basic-span/secondary-badge               2   ""
 *     components-basic-span/status-badges                 5   ""
 *     core-schema-renderer/nested-schema-example         13   "Parent ComponentSibling Component
 *                                                             All rendered from a single schema tree"
 *
 * AFTER — the seven nodes re-authored to `label`, the spelling the other 33
 * badge nodes already use:
 *
 *     components-basic-span/default-badge                 2   "Badge Style"
 *     components-basic-span/secondary-badge               2   "Secondary"
 *     components-basic-span/status-badges                 5   "● Active● Pending● Inactive"
 *     core-schema-renderer/nested-schema-example         13   "Parent ComponentNestedComponents
 *                                                             Sibling ComponentAll rendered
 *                                                             from a single schema tree"
 *
 * (`elements` counts this file's one wrapper `div`; the gallery harness adds
 * two, which is where its `WRAPPER_ELEMENTS = 2` comes from.)
 *
 * ## Why a PER-RENDERER pin, not a stricter global threshold
 *
 * `catalog-gallery-render.test.tsx` rendered all four entries before the fix
 * and PASSED. Its non-vacuity control is `elements > WRAPPER_ELEMENTS || text`,
 * and the empty pill's OWN host element is the element past the wrappers, so
 * a demo drawing nothing but an empty pill clears the control on the pill.
 * That is the third independent hole in that one control (objectui#6805:
 * Radix's injected stylesheet counts as text; objectui#6806: a large correct
 * render hides a small omission), which is the argument that the instrument
 * belongs per renderer. So nothing here is a threshold: the assertion is that
 * the pill's rendered text EQUALS the label the fixture authors, for every
 * `badge` node in the corpus, at any depth, in any entry.
 *
 * ## The discriminating question this file was written against
 *
 * "Would an implementation strictly worse than the bug pass this pin?" A pin
 * asserting "the demo renders at least one element" passes on an empty pill —
 * that is the hole above. A pin asserting "non-empty text" passes on a
 * renderer that emits one constant string for every node. The corpus
 * assertion below compares the FULL vector of rendered texts to the full
 * vector of authored labels and pins that the two are equally diverse: the
 * constant-string caricature fails it on every node, and the empty pill fails
 * it on every node it used to hide behind.
 *
 * ## The non-regression axis — derived from the plausible WRONG fix
 *
 * The plausible wrong fix is a blind sweep renaming `children` to `label`
 * across the corpus. It satisfies "the badges now draw" and breaks every
 * container that legitimately authors `children` — 652 non-badge nodes on this
 * base (`flex` 248 · `stack` 153 · `card` 86 · `box` 76 · `grid` 22 · …).
 * Measured: that sweep applied to `nested-schema-example` renders the EMPTY
 * string (2 elements — the wrapper and a bare `stack`). The last block pins
 * that the corpus still authors `children` on hundreds of containers, that the
 * touched entries' own containers still draw their children, and that the
 * blind-sweep shape is the empty demo it is.
 *
 * ## ⛔ What arm A did NOT do — and what closed it afterwards
 *
 * Arm A restored four demos and did not close the class: `children` was
 * declared on `BaseSchema`, accepted by every other container renderer,
 * refused by neither zod nor tsc (`BaseSchema` was `.passthrough()` with an
 * index signature then), and consumed by the pipeline before it could leak to the
 * DOM — so the next author who wrote `children` on a badge drew an empty pill
 * again. Arm B (teaching `badge.tsx` to read `children`) widened a published
 * renderer's read set, which AGENTS.md #0.1 governs, and was left to
 * objectui#6810's decision.
 *
 * ⭐ **objectui#6771's retirement of the `body` dialect closed it from the other
 * side, and this file's counter-probes moved with it.** The maintainer ruled
 * one spelling for the child list; `badge` converged on `children`, so the key
 * that draws an empty pill is now `body`. ⛔ Read this as the class being
 * closed by a CONTRACT decision, not as arm B being taken — nothing widened,
 * one spelling was retired and the other is what every renderer reads.
 * ⚠️ objectui#6810 asked whether `badge` should read `children`; that question
 * is answered by a different ruling than the one it was waiting for, which is
 * reported on objectui#6771 rather than decided here.
 *
 * Module-scope import of `@object-ui/components`, not `beforeAll` (AGENTS.md
 * §测试纪律): registering the renderers is an unbounded module load and must
 * not be billed to a bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { allExamples, getExample } from '../src/index.js';

type Json = Record<string, unknown>;

/**
 * The four entries the card measured, and the EXACT text each draws after
 * arm A. Exact, not `toContain`: the nested demo drew its prose and silently
 * dropped both badges before the fix, so presence of prose proves nothing —
 * only the whole string, badges beside their card title, does.
 */
const MEMBER_ENTRIES: Record<string, string> = {
  'components-basic-span/default-badge': 'Badge Style',
  'components-basic-span/secondary-badge': 'Secondary',
  'components-basic-span/status-badges': '● Active● Pending● Inactive',
  'core-schema-renderer/nested-schema-example':
    'Parent ComponentNestedComponentsSibling ComponentAll rendered from a single schema tree',
};

/**
 * The seven node locations arm A re-authored — the former exact ledger. A
 * `flex` takes its child list in its `properties` bag since objectui#11276, so
 * a badge under one sits at `….properties.children[i]`.
 */
const REAUTHORED_NODES = [
  'components-basic-span/default-badge',
  'components-basic-span/secondary-badge',
  'components-basic-span/status-badges.properties.children[0]',
  'components-basic-span/status-badges.properties.children[1]',
  'components-basic-span/status-badges.properties.children[2]',
  'core-schema-renderer/nested-schema-example.children[0].children[0].properties.children[0]',
  'core-schema-renderer/nested-schema-example.children[0].children[0].properties.children[1]',
];

/**
 * The container nodes inside the touched entries that legitimately author
 * `children` and must go on doing so — the nodes a blind sweep would break. A
 * `flex` authors its child list in its `properties` bag (objectui#11276), so
 * for the two `flex` containers the location is that bag, `….properties`.
 */
const TOUCHED_CONTAINERS = [
  'components-basic-span/status-badges.properties',
  'core-schema-renderer/nested-schema-example',
  'core-schema-renderer/nested-schema-example.children[0]',
  'core-schema-renderer/nested-schema-example.children[0].children[0].properties',
  'core-schema-renderer/nested-schema-example.children[1]',
];

/** Measured on this base; a floor so catalog growth never reds this file. */
const CONTAINER_CHILDREN_FLOOR = 600;

type Located = { where: string; node: Json };

/** Every node matching `pick` in a subtree, at any depth, with a readable location. */
function collect(
  node: unknown,
  where: string,
  pick: (record: Json) => boolean,
  into: Located[] = [],
): Located[] {
  if (Array.isArray(node)) {
    node.forEach((child, i) => collect(child, `${where}[${i}]`, pick, into));
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  const record = node as Json;
  if (pick(record)) into.push({ where, node: record });
  for (const [key, value] of Object.entries(record)) {
    collect(value, `${where}.${key}`, pick, into);
  }
  return into;
}

const isBadge = (record: Json) => record.type === 'badge';
const isContainerAuthoringChildren = (record: Json) =>
  'children' in record && record.type !== 'badge';

/** Render one schema the way `SchemaThumbnail` does. */
function draw(schema: unknown) {
  const { container, unmount } = render(
    <div className="w-full p-4">
      <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
    </div>,
  );
  return {
    text: container.textContent ?? '',
    elements: container.querySelectorAll('*').length,
    /** Elements carrying the authored value as a host attribute (objectui#5574). */
    leaked: container.querySelectorAll('[content]').length,
    unmount,
  };
}

/** The text one schema draws, with the tree unmounted again. */
function drawnText(schema: unknown): string {
  const drawn = draw(schema);
  try {
    return drawn.text;
  } finally {
    drawn.unmount();
  }
}

/** The blind sweep, as a function: rename one key to another at every depth. */
function renameDeep(node: unknown, from: string, to: string): unknown {
  if (Array.isArray(node)) return node.map((child) => renameDeep(child, from, to));
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Json).map(([key, value]) => [
      key === from ? to : key,
      renameDeep(value, from, to),
    ]),
  );
}

const entries = allExamples();
const badges = entries.flatMap((entry) => collect(entry.schema, entry.id, isBadge));
const containers = entries.flatMap((entry) =>
  collect(entry.schema, entry.id, isContainerAuthoringChildren),
);

// ---------------------------------------------------------------------------
// 1. The corpus sweep — every `badge` node, rendered, against its own label.
// ---------------------------------------------------------------------------

describe('catalog corpus: every `badge` node draws its authored `label` (objectui#6829 arm A)', () => {
  it('the walk is not vacuous — a broken collector would pass every case below', () => {
    // Floors, not equalities: catalog growth must not fail this file, only a
    // walk that stopped working.
    expect(entries.length).toBeGreaterThanOrEqual(431);
    expect(badges.length).toBeGreaterThanOrEqual(40);
    expect(new Set(badges.map((b) => b.where.split('/')[0])).size).toBeGreaterThanOrEqual(12);
    // …and it sees the seven nodes this card is about, by location.
    expect(badges.map((b) => b.where)).toEqual(expect.arrayContaining(REAUTHORED_NODES));
  });

  it('every `badge` node authors a non-empty string `label` and never `children`', () => {
    const offenders = badges
      .filter(
        ({ node }) =>
          typeof node.label !== 'string' || node.label.trim() === '' || 'children' in node,
      )
      .map(({ where }) => where);
    expect(offenders).toEqual([]);
  });

  it.each(badges.map((b) => [b.where, b] as const))(
    '%s draws exactly its label',
    (_where, located) => {
      // The acceptance criterion, per node: not "something rendered", not
      // "some text rendered" — THIS text, and nothing else in the pill.
      expect(drawnText(located.node)).toBe(String(located.node.label));
    },
  );

  it('⭐ the rendered texts are as diverse as the authored labels — a constant-string renderer cannot pass', () => {
    const authored = badges.map((b) => String(b.node.label));
    const rendered = badges.map((b) => drawnText(b.node));
    // Same vector, same order — one diff names every node that drifted.
    expect(rendered).toEqual(authored);
    // And the vector is not degenerate: the caricature that answers one
    // string for every input has a single distinct value; the corpus does not.
    expect(new Set(authored).size).toBeGreaterThan(1);
    expect(new Set(rendered).size).toBe(new Set(authored).size);
  });
});

// ---------------------------------------------------------------------------
// 2. The four entries the card measured — one exact render each.
// ---------------------------------------------------------------------------

describe('the four entries objectui#6829 measured draw their badges', () => {
  it('every member still names a real entry — a vacuous table would pass every case below', () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const id of Object.keys(MEMBER_ENTRIES)) expect(ids.has(id), id).toBe(true);
    expect(Object.keys(MEMBER_ENTRIES)).toHaveLength(4);
  });

  it.each(Object.entries(MEMBER_ENTRIES))(
    '%s draws exactly the text arm A restores',
    (id, expected) => {
      expect(drawnText(getExample(id).schema)).toBe(expected);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Counter-probes — every assertion above proven able to fail.
// ---------------------------------------------------------------------------

describe('counter-probes (objectui#6157 discipline)', () => {
  it('the RETIRED spelling draws an EMPTY pill — and does not even leak', () => {
    // ⚠️ RE-POINTED at `body` by objectui#6771. This was verbatim the shape
    // `default-badge.json` carried before arm A, spelled `children` — the key
    // `badge` now reads, so it draws and can no longer prove the assertions
    // above able to fail. The retired spelling is what is inert now, and the
    // counter-probe's job is unchanged.
    const drawn = draw({
      type: 'badge',
      variant: 'default',
      body: [{ type: 'text', content: 'Badge Style' }],
    });
    try {
      expect(drawn.text).toBe('');
      // `body` is still stripped by `SchemaRenderer` before the props bag is
      // spread, so it never reaches the DOM either: the objectui#5574 attribute
      // sweep that finds the `content` spelling structurally cannot find it.
      expect(drawn.leaked).toBe(0);
    } finally {
      drawn.unmount();
    }
  });

  it('the RETIRED spelling draws an EMPTY pill as a bare string too', () => {
    // The string arity of the same shape, re-pointed for the same reason.
    expect(drawnText({ type: 'badge', body: 'Nested' })).toBe('');
    // LIVE CONTROL — without it, an empty draw is indistinguishable from a
    // renderer that stopped drawing anything at all.
    expect(drawnText({ type: 'badge', children: 'Nested' })).toBe('Nested');
  });

  it('⭐ the gallery control cannot see this: a `status-badges` demo in the retired spelling is five elements of empty DOM', () => {
    // `status-badges.json` before arm A, with the pills' key re-pointed at the
    // retired spelling (the wrapper `flex` keeps `children`, which it reads —
    // that asymmetry is the point: the container draws, the pills do not).
    // Five elements — this file's wrapper, the `flex`, three empty pills — with
    // no text at all: `elements > 2 || text` reads it as "drew something", on
    // the pills.
    const drawn = draw({
      type: 'flex',
      gap: 2,
      children: [
        { type: 'badge', variant: 'default', body: [{ type: 'text', content: '● Active' }] },
        { type: 'badge', variant: 'secondary', body: [{ type: 'text', content: '● Pending' }] },
        { type: 'badge', variant: 'destructive', body: [{ type: 'text', content: '● Inactive' }] },
      ],
    });
    try {
      expect(drawn.text).toBe('');
      expect(drawn.elements).toBe(5);
      expect(drawn.elements).toBeGreaterThan(2);
    } finally {
      drawn.unmount();
    }
  });

  it('the key that works: `label` draws the string — the live control', () => {
    expect(drawnText({ type: 'badge', label: '12' })).toBe('12');
  });
});

// ---------------------------------------------------------------------------
// 4. The non-regression axis — containers that legitimately author `children`.
// ---------------------------------------------------------------------------

describe('non-regression: containers that legitimately author `children` still draw them (the blind-sweep axis)', () => {
  it('the corpus still authors `children` on hundreds of non-badge nodes, deliberately', () => {
    // If this ever reads 0, someone ran the blind sweep this file argues
    // against, and hundreds of working demos went with it.
    expect(containers.length).toBeGreaterThanOrEqual(CONTAINER_CHILDREN_FLOOR);
    // …and the touched entries' own containers are among them, by location.
    expect(containers.map((c) => c.where)).toEqual(expect.arrayContaining(TOUCHED_CONTAINERS));
  });

  it('a `card` and a `flex` authoring `children` draw them — the live controls', () => {
    expect(drawnText({ type: 'card', children: 'kept' })).toContain('kept');
    expect(drawnText({ type: 'flex', children: [{ type: 'text', content: 'kept' }] })).toBe('kept');
  });

  it('⭐ the blind sweep EMPTIES the demos: `children` renamed to `label` at every depth draws nothing', () => {
    for (const id of ['core-schema-renderer/nested-schema-example', 'components-basic-span/status-badges']) {
      const swept = renameDeep(getExample(id).schema, 'children', 'label');
      // The probe really swept: no container authors `children` any more, and
      // every badge still authors `label` — so the badge sweep above would be
      // GREEN on this shape. This is the assertion that catches it.
      expect(collect(swept, id, isContainerAuthoringChildren)).toEqual([]);
      expect(collect(swept, id, isBadge).every(({ node }) => 'label' in node)).toBe(true);
      expect(drawnText(swept)).toBe('');
    }
  });
});
