// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for the frontmatter `title` / `navTitle` of generated reference pages
 * (#15403).
 *
 * `check:docs` compares the regenerated tree with the committed one, so it
 * holds the OUTPUT still but says nothing about the rule: a regression that
 * wrote every page back to its bare module name would regenerate, commit and
 * stay green. These cases pin the rule itself — the band, the separator, no
 * site name in a title, the ladder each page kind climbs, and that the sidebar
 * label is the page's old title unchanged.
 */

import { describe, expect, it } from 'vitest';

import { CATEGORY_TITLES } from './lib/category-title';
import {
  RENDERED_TITLE_MAX,
  ROOT_INDEX_NAV_TITLE,
  TITLE_MAX,
  TITLE_MIN,
  TITLE_SEPARATOR,
  categoryIndexTitle,
  categoryIndexTitleCandidates,
  firstTitleInBand,
  modulePageTitle,
  modulePageTitleCandidates,
  renderedTitle,
  rootIndexTitle,
  titleFrontmatter,
  titleInBand,
} from './lib/page-title';

/** Every invariant the rule states, for one emitted title. */
function expectRuleShaped(title: string) {
  expect(title.length).toBeGreaterThanOrEqual(TITLE_MIN);
  expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
  expect(renderedTitle(title).length).toBeGreaterThanOrEqual(50);
  expect(renderedTitle(title).length).toBeLessThanOrEqual(RENDERED_TITLE_MAX);
  expect(title.split(TITLE_SEPARATOR)).toHaveLength(2);
  expect(title).not.toMatch(/objectstack/i);
}

describe('the band', () => {
  it('is 36–46 characters, which the 14-character suffix renders as 50–60', () => {
    expect([TITLE_MIN, TITLE_MAX]).toEqual([36, 46]);
    expect(renderedTitle('x'.repeat(TITLE_MIN))).toHaveLength(50);
    expect(renderedTitle('x'.repeat(TITLE_MAX))).toHaveLength(RENDERED_TITLE_MAX);
  });

  it('refuses a title that names the site, whatever its length', () => {
    expect(titleInBand('Agent schema — ObjectStack property reference')).toBe(false);
    expect(titleInBand('Agent schema — objectstack property reference')).toBe(false);
    expect(titleInBand('Agent schema — AI Protocol property reference')).toBe(true);
  });
});

/**
 * Real `(module name, category title)` pairs from `content/docs/references/**`
 * at `862b6ce8`, the name being the page's title before this rule — two per
 * rung of the module ladder, including the tree's shortest name (`Mcp`, 3) and
 * its two longest pairs (`Expression Bindable Text Keys` in UI, name 29;
 * `Schemaless Node Config` in Automation, name + category 41).
 */
const MODULE_PAGES: Array<[name: string, categoryTitle: string, title: string]> = [
  ['Mcp', 'AI Protocol', 'Mcp schema — AI Protocol property reference'],
  ['Agent', 'AI Protocol', 'Agent schema — AI Protocol property reference'],
  ['Object', 'Data Protocol', 'Object schema — Data Protocol reference'],
  ['Flow', 'Automation Protocol', 'Flow schema — Automation Protocol reference'],
  ['Plugin Registry', 'Kernel Protocol', 'Plugin Registry — Kernel Protocol reference'],
  ['Package Api Assembled', 'API Protocol', 'Package Api Assembled — API Protocol reference'],
  ['Metadata Protection', 'Kernel Protocol', 'Metadata Protection — Kernel Protocol'],
  ['Expression Bindable Text Keys', 'UI Protocol', 'Expression Bindable Text Keys — UI Protocol'],
  ['Schemaless Node Config', 'Automation Protocol', 'Schemaless Node Config — Automation Protocol'],
];

describe('modulePageTitle', () => {
  it.each(MODULE_PAGES)('%s (%s) → %s', (name, categoryTitle, title) => {
    const out = modulePageTitle({ name, categoryTitle }, `references/x/${name}.mdx`);
    expect(out).toEqual({ title, navTitle: name });
    expectRuleShaped(out.title);
  });

  it('takes the LONGEST rung inside the band', () => {
    // `Agent` fits the first rung (45) and the second (36): the first wins.
    const candidates = modulePageTitleCandidates({ name: 'Agent', categoryTitle: 'AI Protocol' });
    expect(candidates.filter(titleInBand)).toHaveLength(2);
    expect(modulePageTitle({ name: 'Agent', categoryTitle: 'AI Protocol' }, 'p').title).toBe(candidates[0]);
  });

  it('keeps the rungs longest first, so the first fit is the longest fit', () => {
    const lengths = modulePageTitleCandidates({ name: 'N', categoryTitle: 'C' }).map(c => c.length);
    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
  });

  it('is total for every declared category and every name that can fit beside it', () => {
    // The ladder's rungs overlap end to end: every name + category length from
    // 7 to 43 lands in the band. Swept over the real category titles, with
    // every name length up to the limit that category leaves.
    for (const categoryTitle of Object.values(CATEGORY_TITLES)) {
      for (let n = 1; categoryTitle.length + n <= 43; n++) {
        expectRuleShaped(modulePageTitle({ name: 'N'.repeat(n), categoryTitle }, 'p').title);
      }
    }
  });

  it('keeps two same-named modules in different categories apart', () => {
    const kernel = modulePageTitle({ name: 'Plugin', categoryTitle: 'Kernel Protocol' }, 'p').title;
    const studio = modulePageTitle({ name: 'Plugin', categoryTitle: 'Studio Protocol' }, 'p').title;
    expect(kernel).not.toBe(studio);
  });

  it('refuses, naming the page, when no rung fits — never a truncated title', () => {
    const tooLong = { name: 'An Exceedingly Long Module Display Name', categoryTitle: 'Integration Protocol' };
    expect(modulePageTitleCandidates(tooLong).some(titleInBand)).toBe(false);
    expect(() => modulePageTitle(tooLong, 'content/docs/references/integration/long.mdx')).toThrow(
      /content\/docs\/references\/integration\/long\.mdx/,
    );
  });
});

describe('categoryIndexTitle', () => {
  it.each([
    ['AI Protocol', 'AI Protocol — complete schema reference'],
    ['Identity Protocol', 'Identity Protocol — complete schema reference'],
    ['Automation Protocol', 'Automation Protocol — schema reference'],
    ['Marketplace Protocol', 'Marketplace Protocol — schema reference'],
  ])('%s → %s', (categoryTitle, title) => {
    const out = categoryIndexTitle(categoryTitle, `references/x/index.mdx`);
    expect(out).toEqual({ title, navTitle: categoryTitle });
    expectRuleShaped(out.title);
  });

  it('is in the band for every declared category title', () => {
    for (const categoryTitle of Object.values(CATEGORY_TITLES)) {
      expectRuleShaped(categoryIndexTitle(categoryTitle, 'p').title);
    }
  });

  it('keeps the rungs longest first', () => {
    const lengths = categoryIndexTitleCandidates('C').map(c => c.length);
    expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
  });
});

describe('rootIndexTitle', () => {
  it('follows the rule and keeps "Protocol Reference" as the page-tree label', () => {
    const out = rootIndexTitle();
    expect(out.navTitle).toBe(ROOT_INDEX_NAV_TITLE);
    expect(ROOT_INDEX_NAV_TITLE).toBe('Protocol Reference');
    expectRuleShaped(out.title);
  });
});

describe('firstTitleInBand', () => {
  it('answers the first candidate inside the band', () => {
    expect(firstTitleInBand('p', ['short — one', 'A long enough title — with its qualifier', 'x'])).toBe(
      'A long enough title — with its qualifier',
    );
  });
});

describe('titleFrontmatter', () => {
  it('writes title then navTitle, one line each', () => {
    expect(titleFrontmatter({ title: 'Agent schema — AI Protocol property reference', navTitle: 'Agent' })).toBe(
      'title: Agent schema — AI Protocol property reference\nnavTitle: Agent\n',
    );
  });
});
