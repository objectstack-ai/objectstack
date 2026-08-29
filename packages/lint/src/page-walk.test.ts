// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { walkPageComponents, isSourceAuthoredPage } from './page-walk.js';

const paths = (page: Record<string, unknown>) =>
  walkPageComponents(page, 'pages[0]').map((w) => w.path);

describe('walkPageComponents — where components actually live', () => {
  it('walks regions[].components[]', () => {
    expect(
      paths({
        regions: [
          { name: 'main', components: [{ type: 'a' }, { type: 'b' }] },
          { name: 'side', components: [{ type: 'c' }] },
        ],
      }),
    ).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[1]',
      'pages[0].regions[1].components[0]',
    ]);
  });

  it('walks slots, normalizing a single component to a list', () => {
    expect(
      paths({
        kind: 'slotted',
        slots: {
          highlights: { type: 'a' },
          tabs: [{ type: 'b' }, { type: 'c' }],
        },
      }),
    ).toEqual([
      'pages[0].slots.highlights',
      'pages[0].slots.tabs[0]',
      'pages[0].slots.tabs[1]',
    ]);
  });

  it('finds nothing in a top-level `components` array — PageSchema has none', () => {
    // Guards the bug this module exists to prevent: a walker reading
    // `page.components` visits nothing on a real stack while looking correct.
    expect(paths({ components: [{ type: 'a' }] })).toEqual([]);
  });

  it('recurses through properties.children — the layout-container shape', () => {
    expect(
      paths({
        regions: [
          {
            name: 'main',
            components: [
              {
                type: 'flex',
                properties: {
                  children: [
                    { type: 'flex', properties: { children: [{ type: 'leaf' }] } },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[0].properties.children[0]',
      'pages[0].regions[0].components[0].properties.children[0].properties.children[0]',
    ]);
  });

  it('recurses through properties.items[].children, body and footer', () => {
    expect(
      paths({
        regions: [
          {
            name: 'main',
            components: [
              { type: 'page:tabs', properties: { items: [{ children: [{ type: 'x' }] }] } },
              { type: 'page:card', properties: { body: [{ type: 'y' }], footer: [{ type: 'z' }] } },
            ],
          },
        ],
      }),
    ).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[0].properties.items[0].children[0]',
      'pages[0].regions[0].components[1]',
      'pages[0].regions[0].components[1].properties.body[0]',
      'pages[0].regions[0].components[1].properties.footer[0]',
    ]);
  });
});

describe('walkPageComponents — object binding precedence', () => {
  const bindings = (page: Record<string, unknown>) =>
    walkPageComponents(page, 'pages[0]').map((w) => w.objectName);

  it('inherits the page object, and lets dataSource then properties override', () => {
    expect(
      bindings({
        object: 'page_obj',
        regions: [
          {
            name: 'main',
            components: [
              { type: 'a' },
              { type: 'b', dataSource: { object: 'ds_obj' } },
              { type: 'c', properties: { object: 'prop_obj' } },
              // dataSource wins over properties.
              { type: 'd', dataSource: { object: 'ds_obj' }, properties: { object: 'prop_obj' } },
            ],
          },
        ],
      }),
    ).toEqual(['page_obj', 'ds_obj', 'prop_obj', 'ds_obj']);
  });

  it('propagates an overridden binding down to nested children', () => {
    const walked = walkPageComponents(
      {
        object: 'page_obj',
        regions: [
          {
            name: 'main',
            components: [
              {
                type: 'flex',
                dataSource: { object: 'ds_obj' },
                properties: { children: [{ type: 'leaf' }] },
              },
            ],
          },
        ],
      },
      'pages[0]',
    );
    expect(walked.map((w) => w.objectName)).toEqual(['ds_obj', 'ds_obj']);
  });
});

describe('walkPageComponents — cycle guard', () => {
  // `properties.children` is `z.array(z.unknown())`, so a component that
  // contains itself is LEGAL input. Before the guard each of these died with
  // `RangeError: Maximum call stack size exceeded`, taking down every rule
  // built on this walk in the same process.

  it('terminates on an INDIRECT cycle (A -> B -> A), yielding each node once', () => {
    // The load-bearing case: a guard that only compares a node against its
    // immediate parent still recurses forever here, so this is the fixture a
    // direct-only half-fix fails.
    const a: Record<string, unknown> = { type: 'a', properties: {} };
    const b: Record<string, unknown> = { type: 'b', properties: {} };
    (a.properties as Record<string, unknown>).children = [b];
    (b.properties as Record<string, unknown>).children = [a];

    expect(paths({ regions: [{ name: 'main', components: [a] }] })).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[0].properties.children[0]',
    ]);
  });

  it('terminates on a DIRECT self-reference', () => {
    const self: Record<string, unknown> = { type: 'a', properties: {} };
    (self.properties as Record<string, unknown>).children = [self];

    expect(paths({ regions: [{ name: 'main', components: [self] }] })).toEqual([
      'pages[0].regions[0].components[0]',
    ]);
  });

  it('terminates on a cycle through a longer chain (A -> B -> C -> A)', () => {
    const a: Record<string, unknown> = { type: 'a', properties: {} };
    const b: Record<string, unknown> = { type: 'b', properties: {} };
    const c: Record<string, unknown> = { type: 'c', properties: {} };
    (a.properties as Record<string, unknown>).children = [b];
    (b.properties as Record<string, unknown>).children = [c];
    (c.properties as Record<string, unknown>).children = [a];

    expect(paths({ regions: [{ name: 'main', components: [a] }] })).toHaveLength(3);
  });

  it('guards every descended slot, not just `properties.children`', () => {
    // items[].children (`page:tabs`), body and footer (`page:card`) all recurse
    // through the same `visit`, so each needs the guard to hold.
    const viaItems: Record<string, unknown> = { type: 'tabs', properties: {} };
    (viaItems.properties as Record<string, unknown>).items = [{ children: [viaItems] }];

    const viaBody: Record<string, unknown> = { type: 'card', properties: {} };
    (viaBody.properties as Record<string, unknown>).body = [viaBody];

    const viaFooter: Record<string, unknown> = { type: 'card', properties: {} };
    (viaFooter.properties as Record<string, unknown>).footer = [viaFooter];

    for (const node of [viaItems, viaBody, viaFooter]) {
      expect(paths({ regions: [{ name: 'main', components: [node] }] })).toHaveLength(1);
    }
  });

  it('is an ANCESTOR guard, not a visited set — a re-used sibling is yielded twice', () => {
    // The same component object placed twice under one parent is two
    // legitimate placements at two distinct config paths, and every rule built
    // on this walk must see both. A visited-set guard would yield the first
    // and silently drop the second, trading the crash for missing coverage.
    const leaf: Record<string, unknown> = { type: 'leaf' };
    const parent = { type: 'flex', properties: { children: [leaf, leaf] } };

    expect(paths({ regions: [{ name: 'main', components: [parent] }] })).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[0].properties.children[0]',
      'pages[0].regions[0].components[0].properties.children[1]',
    ]);
  });

  it('re-uses the same node on a SEPARATE branch — it is not an ancestor there', () => {
    // A shared sub-tree reached down two different branches is legal re-use.
    // The ancestor set must be popped on the way out, or the second branch
    // would be silently truncated.
    const shared: Record<string, unknown> = { type: 'shared' };
    const left = { type: 'flex', properties: { children: [shared] } };
    const right = { type: 'flex', properties: { children: [shared] } };

    expect(paths({ regions: [{ name: 'main', components: [left, right] }] })).toEqual([
      'pages[0].regions[0].components[0]',
      'pages[0].regions[0].components[0].properties.children[0]',
      'pages[0].regions[0].components[1]',
      'pages[0].regions[0].components[1].properties.children[0]',
    ]);
  });

  it('does NOT truncate a legal deep tree — this is a cycle guard, not a depth cap', () => {
    // A cap would bound a legal-but-deep document by dropping components from
    // the walk, and every rule would go quiet about them. Nesting well past
    // the sibling resolver's cap of 32 stays fully walked.
    let node: Record<string, unknown> = { type: 'leaf' };
    for (let i = 0; i < 64; i++) node = { type: 'flex', properties: { children: [node] } };

    expect(paths({ regions: [{ name: 'main', components: [node] }] })).toHaveLength(65);
  });
});

describe('isSourceAuthoredPage', () => {
  it('treats html/react/jsx as source-authored and skips their regions', () => {
    for (const kind of ['html', 'react', 'jsx']) {
      expect(isSourceAuthoredPage({ kind })).toBe(true);
      expect(
        paths({ kind, regions: [{ name: 'main', components: [{ type: 'a' }] }] }),
      ).toEqual([]);
    }
  });

  it('treats full/slotted (and an absent kind) as authored metadata', () => {
    expect(isSourceAuthoredPage({ kind: 'full' })).toBe(false);
    expect(isSourceAuthoredPage({ kind: 'slotted' })).toBe(false);
    expect(isSourceAuthoredPage({})).toBe(false);
  });
});
