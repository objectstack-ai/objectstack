// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for the frontmatter `title` / `navTitle` of generated reference pages
 * (#15403), and for the one page fact the title reads besides names: whether
 * the page renders a `### Properties` table.
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
import { declaresProperties, renderSchemaSection, rendersPropertiesTable } from './lib/schema-section';
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
 * Real `(module name, category title, renders a Properties table)` triples from
 * `content/docs/references/**`, the name being the page's title before this
 * rule — two per rung of the module ladder, including the tree's shortest name
 * (`Mcp`, 3), its two longest pairs (`Expression Bindable Text Keys` in UI, name
 * 29; `Schemaless Node Config` in Automation, name + category 41), and
 * `data/feed`, the one page the first rung reached without a property table.
 */
const MODULE_PAGES: Array<[name: string, categoryTitle: string, documentsProperties: boolean, title: string]> = [
  ['Mcp', 'AI Protocol', true, 'Mcp schema — AI Protocol property reference'],
  ['Agent', 'AI Protocol', true, 'Agent schema — AI Protocol property reference'],
  ['Feed', 'Data Protocol', false, 'Feed schema — Data Protocol reference'],
  ['Object', 'Data Protocol', true, 'Object schema — Data Protocol reference'],
  ['Flow', 'Automation Protocol', true, 'Flow schema — Automation Protocol reference'],
  ['Plugin Registry', 'Kernel Protocol', true, 'Plugin Registry — Kernel Protocol reference'],
  ['Package Api Assembled', 'API Protocol', true, 'Package Api Assembled — API Protocol reference'],
  ['Metadata Protection', 'Kernel Protocol', false, 'Metadata Protection — Kernel Protocol'],
  ['Expression Bindable Text Keys', 'UI Protocol', false, 'Expression Bindable Text Keys — UI Protocol'],
  ['Schemaless Node Config', 'Automation Protocol', true, 'Schemaless Node Config — Automation Protocol'],
];

describe('modulePageTitle', () => {
  it.each(MODULE_PAGES)('%s (%s, properties: %s) → %s', (name, categoryTitle, documentsProperties, title) => {
    const out = modulePageTitle({ name, categoryTitle, documentsProperties }, `references/x/${name}.mdx`);
    expect(out).toEqual({ title, navTitle: name });
    expectRuleShaped(out.title);
  });

  it('takes the LONGEST rung inside the band', () => {
    // `Agent` fits the first rung (45) and the second (36): the first wins.
    const agent = { name: 'Agent', categoryTitle: 'AI Protocol', documentsProperties: true };
    const candidates = modulePageTitleCandidates(agent);
    expect(candidates.filter(titleInBand)).toHaveLength(2);
    expect(modulePageTitle(agent, 'p').title).toBe(candidates[0]);
  });

  it('offers `property reference` only to a page that renders a Properties table', () => {
    // The same name and category, the one fact flipped: `data/feed` renders two
    // enums (`### Allowed Values`) and no property, so it starts at the second rung.
    const feed = { name: 'Feed', categoryTitle: 'Data Protocol' };
    const withTable = modulePageTitleCandidates({ ...feed, documentsProperties: true });
    const withoutTable = modulePageTitleCandidates({ ...feed, documentsProperties: false });
    expect(withTable[0]).toBe('Feed schema — Data Protocol property reference');
    expect(withoutTable.some(c => c.includes('property'))).toBe(false);
    expect(withoutTable).toEqual(withTable.slice(1));
    expect(modulePageTitle({ ...feed, documentsProperties: false }, 'p').title).toBe('Feed schema — Data Protocol reference');
  });

  it('keeps the rungs longest first, so the first fit is the longest fit', () => {
    for (const documentsProperties of [true, false]) {
      const lengths = modulePageTitleCandidates({ name: 'N', categoryTitle: 'C', documentsProperties }).map(c => c.length);
      expect([...lengths].sort((a, b) => b - a)).toEqual(lengths);
    }
  });

  it('is total for every declared category and every name that can fit beside it', () => {
    // With a Properties table the rungs overlap end to end from name + category
    // 7 to 43; without one, from 16 to 43. Swept over the real category titles,
    // with every name length up to the limit that category leaves.
    for (const categoryTitle of Object.values(CATEGORY_TITLES)) {
      for (let n = 1; categoryTitle.length + n <= 43; n++) {
        expectRuleShaped(modulePageTitle({ name: 'N'.repeat(n), categoryTitle, documentsProperties: true }, 'p').title);
        if (categoryTitle.length + n >= 16) {
          expectRuleShaped(modulePageTitle({ name: 'N'.repeat(n), categoryTitle, documentsProperties: false }, 'p').title);
        }
      }
    }
  });

  it('refuses a property-less page too short for the second rung, naming it', () => {
    // name + category 15: the second rung is 35, one under the band.
    expect(() =>
      modulePageTitle({ name: 'Abcd', categoryTitle: 'AI Protocol', documentsProperties: false }, 'content/docs/references/ai/abcd.mdx'),
    ).toThrow(/content\/docs\/references\/ai\/abcd\.mdx/);
  });

  it('keeps two same-named modules in different categories apart', () => {
    const kernel = modulePageTitle({ name: 'Plugin', categoryTitle: 'Kernel Protocol', documentsProperties: true }, 'p').title;
    const studio = modulePageTitle({ name: 'Plugin', categoryTitle: 'Studio Protocol', documentsProperties: true }, 'p').title;
    expect(kernel).not.toBe(studio);
  });

  it('refuses, naming the page, when no rung fits — never a truncated title', () => {
    const tooLong = { name: 'An Exceedingly Long Module Display Name', categoryTitle: 'Integration Protocol', documentsProperties: true };
    expect(modulePageTitleCandidates(tooLong).some(titleInBand)).toBe(false);
    expect(() => modulePageTitle(tooLong, 'content/docs/references/integration/long.mdx')).toThrow(
      /content\/docs\/references\/integration\/long\.mdx/,
    );
  });
});

/**
 * The fact the first module rung reads — whether a schema renders a
 * `### Properties` table — held equal to what the renderer really emits, one
 * JSON Schema shape per branch of `renderSchemaSection`. If a branch changes
 * what it renders and the predicate does not follow, this goes red instead of
 * a title quietly claiming a table its page lacks.
 */
const SECTION_SHAPES: Array<[shape: string, name: string, schema: any, rendersTable: boolean]> = [
  ['object root with properties', 'Agent', { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, true],
  ['string enum (data/feed FeedFilterMode)', 'FeedFilterMode', { type: 'string', enum: ['all', 'comments_only', 'changes_only', 'tasks_only'] }, false],
  ['string enum (data/feed FeedItemType)', 'FeedItemType', { type: 'string', enum: ['comment', 'field_change', 'task'] }, false],
  [
    'union with an object arm',
    'Trigger',
    { anyOf: [{ type: 'object', properties: { type: { type: 'string', const: 'cron' }, expr: { type: 'string' } } }, { type: 'string' }] },
    true,
  ],
  ['oneOf with an object arm', 'Source', { oneOf: [{ type: 'object', properties: { url: { type: 'string' } } }, { type: 'number' }] }, true],
  ['union of an enum and a scalar', 'Mode', { anyOf: [{ type: 'string', enum: ['a', 'b'] }, { type: 'number' }] }, false],
  [
    'string enum that also carries a union (the enum branch wins)',
    'Kind',
    { type: 'string', enum: ['a'], anyOf: [{ type: 'object', properties: { x: { type: 'string' } } }] },
    false,
  ],
  ['bare scalar', 'ObjectName', { type: 'string', description: 'Machine name' }, false],
  ['record map (additionalProperties, no properties)', 'Labels', { type: 'object', additionalProperties: { type: 'string' } }, false],
  ['array of objects', 'Rows', { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } }, false],
  [
    'definitions entry under its own name',
    'Wrapped',
    { $ref: '#/definitions/Wrapped', definitions: { Wrapped: { type: 'object', properties: { a: { type: 'number' } } } } },
    true,
  ],
];

describe('rendersPropertiesTable', () => {
  it.each(SECTION_SHAPES)('%s → %s', (_shape, name, schema, rendersTable) => {
    expect(rendersPropertiesTable(name, schema)).toBe(rendersTable);
    // The renderer's own output agrees, whatever the expectation above says.
    expect(/^### Properties$/m.test(renderSchemaSection(name, schema))).toBe(rendersTable);
  });

  it('answers the data/feed page as having no property table', () => {
    const feed = SECTION_SHAPES.filter(([shape]) => shape.includes('data/feed'));
    expect(feed).toHaveLength(2);
    expect(feed.some(([, name, schema]) => rendersPropertiesTable(name, schema))).toBe(false);
  });

  it('declaresProperties is the object-with-properties test and nothing wider', () => {
    expect(declaresProperties({ type: 'object', properties: { a: { type: 'string' } } })).toBe(true);
    expect(declaresProperties({ type: 'object' })).toBe(false);
    expect(declaresProperties({ properties: { a: {} } })).toBe(false);
    expect(declaresProperties(undefined)).toBe(false);
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
