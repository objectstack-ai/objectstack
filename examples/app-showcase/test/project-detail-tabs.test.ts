// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { PageTabsProps } from '@objectstack/spec/ui';

import * as pages from '../src/ui/pages/index.js';
import { ProjectDetailPage } from '../src/ui/pages/index.js';

/**
 * Dogfood gate for the project-detail page's tab strip (objectstack#5776).
 *
 * `page:tabs` items carry a **stable `?tab=` URL token**, and its one spelling
 * is `value`: that is the key `PageTabsProps.items[]` declares (#5775) and the
 * only one objectui's tabs renderer reads — `containers.tsx` takes a non-empty
 * string `it.value` and otherwise derives the token from the item's index.
 * This page authored `key` instead — a spelling neither side knows — so both
 * tabs silently fell back to the index-derived `tab-<i>`: the page renders,
 * and a deep link comes back to whichever tab happens to sit at that index.
 * #5068's `component-props-unknown-key` gate reported it as exactly that, twice.
 *
 * The assertions pin both halves, so neither can regress in silence:
 *  - the tokens are authored under the declared key and survive the schema's
 *    own parse (an undeclared key would be stripped, not carried);
 *  - `key` — and the other near-miss spellings — appear on no tab item in the
 *    whole showcase corpus, so a later page cannot re-introduce the shape;
 *  - the tokens are semantic and distinct, which is the property the
 *    index-derived fallback does not have.
 */

type TabItem = Record<string, unknown> & { label?: unknown; value?: unknown };
type AnyComponent = {
  type?: unknown;
  properties?: Record<string, unknown>;
  [k: string]: unknown;
};

/** Every component on a page — regions and slots alike, nested tabs included. */
function allComponents(page: Record<string, unknown>): AnyComponent[] {
  const out: AnyComponent[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const component = node as AnyComponent;
    out.push(component);
    const props = component.properties;
    if (!props) return;
    for (const item of Array.isArray(props.items) ? props.items : []) {
      const children = (item as TabItem)?.children;
      for (const child of Array.isArray(children) ? children : []) visit(child);
    }
    for (const child of Array.isArray(props.children) ? props.children : []) visit(child);
  };

  for (const region of (page.regions as { components?: unknown[] }[] | undefined) ?? []) {
    for (const c of region.components ?? []) visit(c);
  }
  for (const slot of Object.values((page.slots as Record<string, unknown>) ?? {})) {
    for (const c of Array.isArray(slot) ? slot : [slot]) visit(c);
  }
  return out;
}

const tabsComponents = (page: Record<string, unknown>): AnyComponent[] =>
  allComponents(page).filter((c) => c.type === 'page:tabs');

const tabItems = (component: AnyComponent): TabItem[] =>
  (Array.isArray(component.properties?.items) ? component.properties!.items : []) as TabItem[];

/** Every page the showcase exports (the corpus the #5068 gate runs on). */
const allPages = (Object.values(pages) as unknown[]).filter(
  (p) =>
    !!p && typeof p === 'object' && !Array.isArray(p) && typeof (p as { name?: unknown }).name === 'string',
) as Record<string, unknown>[];

describe('Project detail — tab tokens are authored under the declared `value` (#5776)', () => {
  it('gives both tabs a stable `?tab=` token under `value`', () => {
    const [tabs, ...rest] = tabsComponents(ProjectDetailPage as unknown as Record<string, unknown>);
    expect(tabs, 'the project-detail page must carry a page:tabs component').toBeTruthy();
    expect(rest, 'exactly one tab strip on this page').toHaveLength(0);

    const items = tabItems(tabs);
    expect(items).toHaveLength(2);
    expect(items.map((it) => it.value)).toEqual(['details', 'tasks']);
    for (const item of items) {
      expect(item, `tab "${String(item.label)}" must not carry the undeclared \`key\``).not.toHaveProperty('key');
    }
  });

  it('survives `PageTabsProps` parse with the tokens intact — a declared key is CARRIED', () => {
    // The point of the rename: an undeclared key is dropped by the parse (strip
    // mode) while looking authored in the source. Parsing here proves the token
    // reaches a consumer, which is the whole difference between `key` and
    // `value`.
    const tabs = tabsComponents(ProjectDetailPage as unknown as Record<string, unknown>)[0]!;
    const parsed = PageTabsProps.parse(tabs.properties);
    expect(parsed.items.map((it) => it.value)).toEqual(['details', 'tasks']);
  });

  it('leaves no near-miss token spelling on any tab item in the showcase corpus', () => {
    // The regression this pins is a new page (or a rewrite of this one) reaching
    // for `key` / `id` / `name` again — every one of them renders fine and
    // sets no token.
    for (const page of allPages) {
      for (const tabs of tabsComponents(page)) {
        for (const item of tabItems(tabs)) {
          for (const spelling of ['key', 'id', 'name', 'tabKey', 'slug'] as const) {
            expect(
              item,
              `page "${String(page.name)}" tab "${String(item.label)}" must carry its token as \`value\`, not \`${spelling}\``,
            ).not.toHaveProperty(spelling);
          }
        }
      }
    }
  });

  it('uses semantic, distinct tokens — the property the index fallback lacks', () => {
    const values = tabItems(
      tabsComponents(ProjectDetailPage as unknown as Record<string, unknown>)[0]!,
    ).map((it) => it.value as string);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(/^[a-z][a-z0-9_:-]*$/);
      // `tab-<i>` is exactly the derived fallback; authoring it back would make
      // the token as fragile as having none.
      expect(value).not.toMatch(/^tab-\d+$/);
    }
  });
});
