/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11223 — a component nested in a `page:` container's props bag is
 * judged, on both faces, at the positions `@objectstack/spec`'s page walk
 * descends.
 *
 * ## The defect
 *
 * The containers take their child lists in the bag (`properties.children`;
 * `properties.items[].children` on `page:tabs` / `page:accordion`), and the
 * spec rows the arms read by reference type every one of those slots
 * `z.array(z.unknown())`. So `safeValidateSchema` and `StrictAnyComponentSchema`
 * (what `objectui validate` runs) passed a malformed nested block, and a
 * nested `type` no arm declares, while the same child in a node-level child
 * slot was refused. Every row in (a) below parsed green on both faces before
 * this card; the last row of (b) is the node-level slot that already judged.
 *
 * ## What each block pins
 *
 *   (a) the refusals: every container, a malformed child and an unknown nested
 *       `type`, both faces, each issue at the child's real path;
 *   (b) the controls: valid nested pages parse on both faces, and the nesting
 *       is judged at every depth and through a node-level child slot;
 *   (c) the strict face judges a nested component STRICTLY — the check is
 *       re-pointed at the strict twin, not copied pointing at the tolerant one;
 *   (d) parity: the positions are read off the installed spec's walk, here,
 *       without naming one; objectui's walk reaches every one of them, and
 *       each is a position a row of (a) judges on both faces;
 *   (e) retired: it held `page:card`'s `footer`, the one slot the walks
 *       disagreed on, until `@objectstack/spec` 17.6.0's walk descended it
 *       (objectui#11438); the footer is a row of (a) since;
 *   (f) a JavaScript value that nests a component inside itself still gets a
 *       verdict.
 *
 * An ablation of the check on `AnyComponentSchema` turns the refusal rows of
 * (a), (b), (c) and (f) red and nothing else — the run is recorded on the pull
 * request for objectui#11223, not re-derived here.
 */

import { describe, expect, it } from 'vitest';
import { walkAddressedPageComponents } from '@objectstack/spec/system';

import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import { nestedComponentsOf } from '../zod/nested-component-walk.js';

type Issue = { code: string; path: PropertyKey[]; keys?: string[]; note?: string };
type Result = { success: boolean; error?: { issues: unknown[] } };

const FACES: ReadonlyArray<readonly [string, (document: unknown) => Result]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

const issuesOf = (result: Result): Issue[] => (result.success ? [] : (result.error!.issues as Issue[]));
const at = (path: readonly PropertyKey[]) => path.join('.');
const startsWith = (path: readonly PropertyKey[], prefix: readonly PropertyKey[]) =>
  prefix.every((segment, i) => path[i] === segment);

/** Valid on its own: `element:text` with the one member its row requires. */
const text = (content: string) => ({ type: 'element:text', properties: { content } });
/** A wrong-typed member and an undeclared one — the card's measured child. */
const MALFORMED = { type: 'element:text', properties: { content: 7, bogus: 1 } };
/** A `type` no arm declares. */
const UNKNOWN = { type: 'element:no-such-block' };

/**
 * Every container, with the child placed SECOND in its list so the index in the
 * reported path is measured rather than defaulted: the position it takes a
 * child list at (spelled as (d) derives positions from the spec's walk), a
 * document with `child` there, and the path the child lands at.
 */
const CONTAINERS: ReadonlyArray<readonly [type: string, position: string, place: (child: unknown) => unknown, path: readonly PropertyKey[]]> = [
  ...['page:card', 'page:section', 'page:footer', 'page:sidebar'].map((type) => [
    type,
    'properties.children[]',
    (child: unknown) => ({ type, properties: { children: [text('first'), child] } }),
    ['properties', 'children', 1],
  ] as const),
  ...['page:tabs', 'page:accordion'].map((type) => [
    type,
    'properties.items[].children[]',
    (child: unknown) => ({
      type,
      properties: { items: [{ label: 'One', children: [text('one')] }, { label: 'Two', children: [text('first'), child] }] },
    }),
    ['properties', 'items', 1, 'children', 1],
  ] as const),
  // The card's footer, a row since the spec's walk descends it (17.6.0,
  // objectui#11438); until then (e) held it as the one slot the walks disagreed on.
  [
    'page:card',
    'properties.footer[]',
    (child: unknown) => ({ type: 'page:card', properties: { footer: [text('first'), child] } }),
    ['properties', 'footer', 1],
  ] as const,
];

const ROWS = CONTAINERS.flatMap(([type, , place, path]) =>
  FACES.map(([face, judge]) => [`${type} (${face})`, place, path, judge] as const));

/* ── (a) the refusals ───────────────────────────────────────────────────── */

describe('objectui#11223 (a) — a bag child is judged by the node union, at its real path', () => {
  it('the population is the seven child positions on both faces — a row dropped from the table fails here', () => {
    expect(CONTAINERS.map(([type, position]) => `${type} ${position}`)).toEqual([
      'page:card properties.children[]', 'page:section properties.children[]', 'page:footer properties.children[]',
      'page:sidebar properties.children[]', 'page:tabs properties.items[].children[]',
      'page:accordion properties.items[].children[]', 'page:card properties.footer[]',
    ]);
    expect(ROWS).toHaveLength(14);
  });

  it.each(ROWS)('%s refuses a malformed child, each issue under the child', (label, place, path, judge) => {
    const issues = issuesOf(judge(place(MALFORMED)));
    expect(issues.length, `${label} parsed a malformed bag child green`).toBeGreaterThan(0);
    expect(issues.every((issue) => startsWith(issue.path, path)), `an issue escaped the child: ${issues.map((i) => at(i.path))}`).toBe(true);
    // The wrong-typed member, at the member's own path.
    expect(issues.some((issue) => at(issue.path) === at([...path, 'properties', 'content']))).toBe(true);
    // The undeclared member, refused by name on the row's own object.
    const unknownKey = issues.find((issue) => issue.code === 'unrecognized_keys');
    expect(at(unknownKey!.path)).toBe(at([...path, 'properties']));
    expect(unknownKey!.keys).toEqual(['bogus']);
  });

  it.each(ROWS)('%s refuses a nested `type` no arm declares, at that `type`', (_label, place, path, judge) => {
    const issues = issuesOf(judge(place(UNKNOWN)));
    expect(issues.map((issue) => [issue.code, at(issue.path)])).toEqual([['invalid_union', at([...path, 'type'])]]);
    // The discriminator's own verdict, which `objectui validate` turns into
    // "No arm accepts type …" with the nearest candidates.
    expect(issues[0].note).toBe('No matching discriminator');
  });
});

/* ── (b) the controls ───────────────────────────────────────────────────── */

describe('objectui#11223 (b) — valid nesting parses, and nesting is judged at every depth', () => {
  const VALID_PAGE = {
    type: 'page:section',
    properties: {
      children: [
        text('intro'),
        { type: 'page:card', properties: { title: 'Card', children: [text('in the card')] } },
        { type: 'page:tabs', properties: { items: [{ label: 'Tab', children: [text('in the tab')] }] } },
        { type: 'page:accordion', properties: { items: [{ label: 'Panel', children: [text('in the panel')] }] } },
      ],
    },
  };

  it.each(FACES)('a valid nested page parses on the %s face', (_face, judge) => {
    const result = judge(VALID_PAGE);
    expect(issuesOf(result)).toEqual([]);
    expect(result.success).toBe(true);
  });

  it.each(FACES)('two bag levels down, on the %s face, the issue is at the full path', (_face, judge) => {
    const document = {
      type: 'page:section',
      properties: { children: [{ type: 'page:card', properties: { children: [UNKNOWN] } }] },
    };
    expect(issuesOf(judge(document)).map((issue) => at(issue.path)))
      .toEqual(['properties.children.0.properties.children.0.type']);
  });

  it.each(FACES)('a bag child under a node-level child slot is judged too, on the %s face', (_face, judge) => {
    const document = { type: 'grid', children: [{ type: 'page:section', properties: { children: [UNKNOWN] } }] };
    const result = judge(document);
    expect(result.success).toBe(false);
    // Wherever the enclosing slot's union reports it, the nested verdict is
    // the unknown `type` two levels down — not a refusal of the section.
    expect(JSON.stringify(result.error!.issues)).toContain('No matching discriminator');
  });

  it.each(FACES)('the same unknown child in a node-level slot was already refused on the %s face', (_face, judge) => {
    expect(judge({ type: 'grid', children: [UNKNOWN] }).success).toBe(false);
  });
});

/* ── (c) the strict face judges strictly ────────────────────────────────── */

describe('objectui#11223 (c) — the strict face judges a bag child against its OWN twin', () => {
  const WITH_NODE_KEY = {
    type: 'page:section',
    properties: { children: [{ ...text('x'), notAKey: true }] },
  };

  it('the tolerant face passes an undeclared node-level key one bag down, as it does at the root', () => {
    expect(safeValidateSchema(WITH_NODE_KEY).success).toBe(true);
    expect(safeValidateSchema({ ...text('x'), notAKey: true }).success).toBe(true);
  });

  it('the strict face refuses it by name, at the child', () => {
    const issues = issuesOf(StrictAnyComponentSchema.safeParse(WITH_NODE_KEY));
    expect(issues.map((issue) => [issue.code, at(issue.path), issue.keys])).toEqual([
      ['unrecognized_keys', 'properties.children.0', ['notAKey']],
    ]);
  });
});

/* ── (d) parity with the spec's walk ────────────────────────────────────── */

/**
 * Every position the installed spec's `walkAddressedPageComponents` descends,
 * read off the walk itself: a probe whose props bag — and every panel in it —
 * answers ANY key with a list holding a marked component. Whatever the walk
 * reads and descends, it visits a marker from, and the marker says where it was
 * put. Nothing here names a key the walk might read.
 */
function specWalkPositions(): string[] {
  const origin = new Map<object, string>();
  const made = new Map<string, unknown[]>();
  const listFor = (position: string, build: () => unknown[]) =>
    made.get(position) ?? (made.set(position, build()), made.get(position)!);
  const marked = (position: string) => {
    const component = { type: 'probe:leaf' };
    origin.set(component, position);
    return component;
  };
  const anyKey = (answer: (key: string) => unknown) =>
    new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? answer(key) : undefined) });
  const panel = (outer: string) =>
    anyKey((key) => listFor(`${outer}[].${key}`, () => [marked(`${outer}[].${key}[]`)]));
  const bag = anyKey((key) => listFor(`properties.${key}`, () => [marked(`properties.${key}[]`), panel(`properties.${key}`)]));

  const positions = new Set<string>();
  walkAddressedPageComponents(
    { regions: [{ components: [{ type: 'probe:root', properties: bag as Record<string, unknown> }] }] },
    (component) => {
      const position = origin.get(component);
      if (position !== undefined) positions.add(position);
      return component;
    },
  );
  return [...positions].sort();
}

/** A document carrying `child` at `position`, and the concrete path it sits at. */
function placeAt(position: string, child: unknown): { document: unknown; path: PropertyKey[] } {
  const segments = position.split('.').map((segment) =>
    segment.endsWith('[]') ? { key: segment.slice(0, -2), list: true } : { key: segment, list: false });
  let value: unknown = child;
  for (const { key, list } of [...segments].reverse()) value = { [key]: list ? [value] : value };
  const path = segments.flatMap(({ key, list }) => (list ? [key, 0] : [key]));
  // The walk descends by SHAPE, not by component type, so any carrier serves.
  return { document: { type: 'probe:carrier', ...(value as object) }, path };
}

const POSITIONS = specWalkPositions();

describe('objectui#11223 (d) — objectui walks every position the spec\'s walk descends', () => {
  it('the probe is live: it reads the composition key every container shares', () => {
    // A lit control, not a copy of the list: a probe that read nothing would
    // make every row below vacuous.
    expect(POSITIONS).toContain('properties.children[]');
  });

  it('every position the walk descends is one a row of (a) judges on both faces', () => {
    const judged = new Set(CONTAINERS.map(([, position]) => position));
    for (const position of POSITIONS) {
      expect(
        judged.has(position),
        `the spec's walk now descends ${position}; objectui's walk already reaches it (the rows below say so), `
          + 'so add the container that takes a child list there to (a), and settle (e) if it is the card footer',
      ).toBe(true);
    }
  });

  it.each(POSITIONS)('%s — `nestedComponentsOf` reaches a component placed there', (position) => {
    const { document, path } = placeAt(position, UNKNOWN);
    expect(nestedComponentsOf(document).map(({ component, path: found }) => [component, at(found)]))
      .toEqual([[UNKNOWN, at(path)]]);
  });

  it('`nestedComponentsOf` reports exactly the walk\'s direct visits, in order, each at its real path', () => {
    const inChildren = text('a');
    const inPanel = text('b');
    const deeper = text('c');
    const node = {
      type: 'page:section',
      properties: {
        children: ['not a component', null, inChildren, { type: 'page:card', properties: { children: [deeper] } }],
        items: [{ label: 'no list' }, { label: 'P', children: [inPanel] }],
      },
    };
    const direct: unknown[] = [];
    walkAddressedPageComponents({ regions: [{ components: [node] }] }, (component, { depth }) => {
      if (depth === 1) direct.push(component);
      return component;
    });

    const found = nestedComponentsOf(node);
    expect(found.map(({ component }) => component)).toEqual(direct);
    expect(found.map(({ component }) => component)).not.toContain(deeper);
    expect(found.map(({ path }) => at(path))).toEqual([
      'properties.children.2', 'properties.children.3', 'properties.items.1.children.0',
    ]);
  });
});

/* ── (f) a self-nesting value ───────────────────────────────────────────── */

describe('objectui#11223 (f) — a value that nests a component inside itself gets a verdict', () => {
  it.each(FACES)('the %s face returns instead of overflowing the stack', (_face, judge) => {
    const node: { type: string; properties: { children: unknown[] } } = { type: 'page:section', properties: { children: [] } };
    node.properties.children.push(node, UNKNOWN);
    const issues = issuesOf(judge(node));
    expect(issues.map((issue) => at(issue.path))).toContain('properties.children.1.type');
  });
});
