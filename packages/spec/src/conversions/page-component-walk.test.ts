// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The conversion pass reaches every page component, wherever it is authored
 * (#6775, after #6776).
 *
 * `mapPageComponents` used to walk `pages[].regions[].components[]` and stop.
 * #6776 added the named `slots`; this file covers the rest of the asymmetry —
 * the sub-trees a component nests inside its own free-form `properties`
 * (`children`, `items[].children`, `body`, `footer`), which `walkPageComponents`
 * in `packages/lint` has always descended into and the conversion layer did not.
 *
 * The assertion made over and over here is the *parity* one, the same one
 * `region-walk.test.ts` makes for flow nodes: whatever the table does to a
 * component at region level, it must do to the identical component in a slot or
 * one (or three) containers in. Position must not decide meaning — the schema
 * cannot see the difference (`properties` is an open bag that nothing validates
 * by `type` on the load path), so a walk that stops early normalizes half a
 * corpus and leaves the other half looking converted.
 */

import { describe, expect, it } from 'vitest';

import { applyConversions, collectConversionNotices } from './apply.js';

/** A page-header authored with the retired `description` spelling. */
const staleHeader = (title: string) => ({
  type: 'page:header',
  properties: { title, description: 'Second line' },
});
/** The converted form of {@link staleHeader}. */
const canonicalHeader = (title: string) => ({
  type: 'page:header',
  properties: { title, subtitle: 'Second line' },
});

/** A page whose single region holds `components`. */
const regionPage = (...components: unknown[]) => ({
  pages: [{ name: 'p', regions: [{ name: 'main', components }] }],
});

const componentAt = (stack: Record<string, unknown>, ...steps: (string | number)[]) =>
  steps.reduce<any>((node, step) => node[step], (stack.pages as any[])[0]);

describe('#6775 — a conversion reaches a component nested in another component', () => {
  /**
   * The four container shapes, spelled exactly as `packages/lint`'s
   * `walkPageComponents` spells them. A fifth added there has to be added here
   * too, or the two walkers drift apart again — which is the whole defect.
   */
  const containers: { label: string; properties: (child: unknown) => Record<string, unknown>; path: string }[] = [
    {
      label: 'properties.children[] — the generic layout nesting',
      properties: (child) => ({ children: [child] }),
      path: 'properties.children[0]',
    },
    {
      label: 'properties.items[].children[] — page:tabs / page:accordion panels',
      properties: (child) => ({ tabStyle: 'line', items: [{ label: 'Tab', children: [child] }] }),
      path: 'properties.items[0].children[0]',
    },
    {
      label: 'properties.body[] — a page:card body',
      properties: (child) => ({ body: [child] }),
      path: 'properties.body[0]',
    },
    {
      label: 'properties.footer[] — a page:card footer',
      properties: (child) => ({ footer: [child] }),
      path: 'properties.footer[0]',
    },
  ];

  for (const { label, properties, path } of containers) {
    it(`converts a header under ${label}, exactly as at region level`, () => {
      // `page:section` rather than `page:card`, so the container itself is not a
      // conversion target and the only notice is the nested header's.
      const container = { type: 'page:section', properties: properties(staleHeader('Nested')) };
      const { stack, notices } = collectConversionNotices(regionPage(staleHeader('Top'), container), {
        includeRetired: true,
      });

      expect(componentAt(stack, 'regions', 0, 'components', 0)).toEqual(canonicalHeader('Top'));
      const nested = path
        .replace(/\]/g, '')
        .split(/[.[]/)
        .reduce<any>((node, step) => node[/^\d+$/.test(step) ? Number(step) : step],
          componentAt(stack, 'regions', 0, 'components', 1));
      expect(nested).toEqual(canonicalHeader('Nested'));

      expect(notices.map((n) => n.path)).toEqual([
        'pages[0].regions[0].components[0].properties.subtitle',
        `pages[0].regions[0].components[1].${path}.properties.subtitle`,
      ]);
    });
  }

  it('recurses — a header three containers down converts too', () => {
    const deep = {
      type: 'page:section',
      properties: {
        children: [
          {
            type: 'page:tabs',
            properties: {
              tabStyle: 'line',
              items: [{ label: 'T', children: [{ type: 'page:section', properties: { children: [staleHeader('Deep')] } }] }],
            },
          },
        ],
      },
    };
    const { notices } = collectConversionNotices(regionPage(deep), { includeRetired: true });
    expect(notices.map((n) => n.path)).toEqual([
      'pages[0].regions[0].components[0].properties.children[0]'
      + '.properties.items[0].children[0].properties.children[0].properties.subtitle',
    ]);
  });

  it('reaches a component nested inside a named SLOT, not only inside a region', () => {
    // The two widenings compose: the slotted record page is the shape objectui's
    // guide prescribes, and a card inside it is ordinary composition.
    const { stack, notices } = collectConversionNotices(
      {
        pages: [{
          name: 'account_detail',
          kind: 'slotted',
          regions: [],
          slots: { details: { type: 'page:section', properties: { children: [staleHeader('In a slot')] } } },
        }],
      },
      { includeRetired: true },
    );
    expect(componentAt(stack, 'slots', 'details', 'properties', 'children', 0))
      .toEqual(canonicalHeader('In a slot'));
    expect(notices.map((n) => n.path)).toEqual([
      'pages[0].slots.details.properties.children[0].properties.subtitle',
    ]);
  });

  it('visits a moved sub-tree ONCE — the descent reads the mapped component', () => {
    // `page-card-body-to-children` renames `properties.body` → `children` on the
    // outer card. Because the descent happens after the mapper, the inner card
    // is walked under the canonical key and emits one notice, not one per
    // spelling — and its own path is spelled with `children`, not `body`.
    const { stack, notices } = collectConversionNotices(
      regionPage({
        type: 'page:card',
        properties: { title: 'Outer', body: [{ type: 'page:card', properties: { title: 'Inner', body: [] } }] },
      }),
      { includeRetired: true },
    );
    expect(notices.map((n) => n.path)).toEqual([
      'pages[0].regions[0].components[0].properties.children',
      'pages[0].regions[0].components[0].properties.children[0].properties.children',
    ]);
    expect(componentAt(stack, 'regions', 0, 'components', 0)).toEqual({
      type: 'page:card',
      properties: { title: 'Outer', children: [{ type: 'page:card', properties: { title: 'Inner', children: [] } }] },
    });
  });
});

describe('#6775 — the page-component walk stays copy-on-write and shape-gated', () => {
  it('returns the identical reference when nothing nested converts', () => {
    const clean = regionPage({
      type: 'page:section',
      properties: { children: [canonicalHeader('Already canonical')] },
    });
    expect(applyConversions(clean, { includeRetired: true })).toBe(clean);
  });

  it('shares untouched branches — only the changed path is copied', () => {
    const untouched = { type: 'page:section', properties: { children: [canonicalHeader('Fine')] } };
    const stack = regionPage(
      { type: 'page:section', properties: { children: [staleHeader('Stale')] } },
      untouched,
    );
    const out = applyConversions(stack, { includeRetired: true }) as any;
    expect(out).not.toBe(stack);
    expect(out.pages[0].regions[0].components[1]).toBe(untouched);
  });

  it('leaves a container key that is not a component list alone', () => {
    // `body` is an ordinary key elsewhere on this surface — a `record:alert`
    // carries prose there, and a `page:tabs` item is a tab record, not a
    // component. The walk is gated on the SHAPE (an array, of dicts), so
    // neither is descended and neither is mistaken for a slot.
    const stack = regionPage(
      { type: 'record:alert', properties: { body: 'Confirm the work.' } },
      { type: 'page:tabs', properties: { tabStyle: 'line', items: [{ label: 'Holders' }] } },
      { type: 'page:section', properties: { children: ['not-a-component', 42, null] } },
    );
    expect(applyConversions(stack, { includeRetired: true })).toBe(stack);
  });

  it('terminates on a self-referential component instead of recursing forever', () => {
    // A stack handed to `defineStack` is hand-built objects, not parsed JSON,
    // so a cycle is reachable on the load path — the ceiling `mapFlowNodes` has
    // for regions, here for containers.
    const cyclic: Record<string, unknown> = { type: 'page:section', properties: {} };
    (cyclic.properties as Record<string, unknown>).children = [cyclic];
    expect(() => applyConversions(regionPage(cyclic), { includeRetired: true })).not.toThrow();
  });

  it('converts at the depth ceiling but not past it', () => {
    const nest = (depth: number) => {
      let node: Record<string, unknown> = staleHeader('Bottom');
      for (let i = 0; i < depth; i++) node = { type: 'page:section', properties: { children: [node] } };
      return node;
    };
    // 32 containers above the header — the last hop the ceiling allows.
    expect(collectConversionNotices(regionPage(nest(32)), { includeRetired: true }).notices).toHaveLength(1);
    // One deeper: not reached, and no throw — the ceiling is a stop, not a crash.
    expect(collectConversionNotices(regionPage(nest(33)), { includeRetired: true }).notices).toHaveLength(0);
  });
});
