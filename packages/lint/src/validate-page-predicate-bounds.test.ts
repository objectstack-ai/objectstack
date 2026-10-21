// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24953 — a CEL slot inside a page component's `properties` over the
 * platform's parse bounds is reported, with `validateExpression`'s bounds
 * verdict, at every door that accepts a page. #25002 — the finding is an
 * ERROR: `os validate` / `os build` / `os lint` fail and the page door refuses
 * the write (the amended 「甲」, record 6303865025).
 *
 * The card's shape is a `page:tabs` item `visibleWhen` of ~390 AST nodes,
 * which parsed through `PageSchema` and drew no finding anywhere while the
 * console faulted on it at every evaluation and drew the tab for everyone.
 * The door's real save path (422, nothing stored) is pinned in
 * `@objectstack/metadata-protocol`'s `protocol.runtime-authoring-gate.test.ts`.
 */
import { validateExpression } from '@objectstack/formula';
import { PageSchema } from '@objectstack/spec/ui';
import { describe, expect, it } from 'vitest';

import { authoringRulesFor, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';
import { PAGE_PREDICATE_OVER_BUDGET, validatePagePredicateBounds } from './validate-page-predicate-bounds.js';
import { VISIBILITY_PREDICATE_OVER_BUDGET } from './validate-visibility-predicates.js';

/** `n` `||` terms — five AST nodes each, so 78 terms is the card's ~390-node class. */
const orChain = (n: number) => Array.from({ length: n }, (_, i) => `record.f${i} == ${i}`).join(' || ');
const OVER_AST_NODES = orChain(78);
/** 60-level parenthesis nest — `maxDepth`. */
const OVER_DEPTH = `${'('.repeat(60)}record.a${')'.repeat(60)} == 1`;
/** 200-element list literal — `maxListElements`. */
const OVER_LIST = `record.id in [${Array.from({ length: 200 }, (_, i) => `'u${i}'`).join(',')}]`;
const WITHIN = "record.stage == 'won' || page.tab != ''";

const tabsPage = (tabVisibleWhen: unknown, nodeVisibleWhen?: unknown) => ({
  name: 'deal_home',
  label: 'Deal',
  type: 'app',
  regions: [
    {
      name: 'main',
      components: [
        {
          type: 'page:tabs',
          ...(nodeVisibleWhen === undefined ? {} : { visibleWhen: nodeVisibleWhen }),
          properties: {
            items: [
              { label: 'Overview', value: 'overview', children: [] },
              { label: 'Finance', value: 'finance', visibleWhen: tabVisibleWhen, children: [] },
            ],
          },
        },
      ],
    },
  ],
});
const TAB_PATH = 'pages[0].regions[0].components[0].properties.items[1].visibleWhen';

const pageWith = (component: Record<string, unknown>) => ({
  name: 'deal_home',
  label: 'Deal',
  type: 'app',
  regions: [{ name: 'main', components: [component] }],
});

const ours = <T extends { rule: string }>(fs: readonly T[]): T[] => fs.filter((f) => f.rule === PAGE_PREDICATE_OVER_BUDGET);
const gatePage = (item: unknown) => runRuntimeAuthoringRules({ type: 'page', item, context: { objects: [] } });

describe('#24953 — the card\'s shape: a `page:tabs` item `visibleWhen` over `maxAstNodes`', () => {
  it('premise: the source is over the bound by `validateExpression`, and `PageSchema` still accepts the page', () => {
    const verdict = validateExpression('predicate', OVER_AST_NODES);
    expect(verdict.errors.map((e) => e.code)).toEqual(['cel-too-large']);
    expect(verdict.errors[0]!.params).toMatchObject({ limit: 'maxAstNodes', limitValue: 256 });
    // Parse acceptance is unchanged by this rule — the refusal is the lint finding's, not the schema's.
    expect(PageSchema.safeParse(tabsPage(OVER_AST_NODES)).success).toBe(true);
  });

  it('is an ERROR naming the field and the bound, at the slot, without echoing the source', () => {
    const findings = validatePagePredicateBounds({ pages: [tabsPage(OVER_AST_NODES)] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: PAGE_PREDICATE_OVER_BUDGET,
      where: 'page "deal_home" · page:tabs',
      path: TAB_PATH,
    });
    expect(findings[0]!.message).toContain('`visibleWhen`');
    expect(findings[0]!.message).toContain('`maxAstNodes` budget (platform limit 256)');
    expect(findings[0]!.message).not.toContain('record.f0');
    // The 18.x warning's forward-looking sentence is gone: the refusal is now.
    expect(findings[0]!.message).not.toContain('future major');
  });

  for (const command of ['validate', 'build', 'lint'] as const) {
    it(`\`os ${command}\` fails on it: an error, the only one the page draws`, () => {
      const stack = { pages: [tabsPage(OVER_AST_NODES)] };
      const findings = runAuthoringRules(command, { normalized: stack, parsed: stack });
      expect(ours(findings).map((f) => [f.severity, f.path])).toEqual([['error', TAB_PATH]]);
      expect(findings.filter((f) => f.severity === 'error').map((f) => f.rule)).toEqual([PAGE_PREDICATE_OVER_BUDGET]);
    });
  }

  it('the page publish door refuses it on the errors channel, the build\'s finding verbatim', () => {
    const result = gatePage(tabsPage(OVER_AST_NODES));
    expect(result.rulesRun).toContain('validatePagePredicateBounds');
    expect(ours(result.advisories)).toEqual([]);
    const atDoor = ours(result.errors);
    expect(atDoor.map((f) => f.rule)).toEqual([PAGE_PREDICATE_OVER_BUDGET]);
    const stack = { pages: [tabsPage(OVER_AST_NODES)] };
    const atBuild = ours(runAuthoringRules('build', { normalized: stack, parsed: stack }));
    expect(atDoor.map(({ message, hint, severity }) => ({ message, hint, severity })))
      .toEqual(atBuild.map(({ message, hint, severity }) => ({ message, hint, severity })));
  });

  it('CONTROL — a within-bounds tab predicate draws nothing at any door', () => {
    const stack = { pages: [tabsPage(WITHIN)] };
    expect(validatePagePredicateBounds(stack)).toEqual([]);
    expect(ours(runAuthoringRules('validate', { normalized: stack, parsed: stack }))).toEqual([]);
    const result = gatePage(tabsPage(WITHIN));
    expect(ours([...result.errors, ...result.advisories])).toEqual([]);
  });

  it('the `{ dialect, source }` envelope is the same slot', () => {
    const findings = validatePagePredicateBounds({ pages: [tabsPage({ dialect: 'cel', source: OVER_AST_NODES })] });
    expect(findings.map((f) => f.path)).toEqual([TAB_PATH]);
  });

  it.each([
    ['maxDepth', OVER_DEPTH],
    ['maxListElements', OVER_LIST],
  ])('names the bound the source overruns — %s', (limit, source) => {
    const findings = validatePagePredicateBounds({ pages: [tabsPage(source)] });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain(`\`${limit}\` budget`);
  });
});

describe('#24953 — the slots are read off the props schema, not a key list', () => {
  it.each([
    [
      'an `object-form` section `visibleWhen`',
      { type: 'object-form', properties: { objectName: 'deal', sections: [{ label: 'S', visibleWhen: OVER_AST_NODES, fields: ['name'] }] } },
      '.properties.sections[0].visibleWhen',
    ],
    [
      'an `object-form` inline field `requiredWhen`',
      { type: 'object-form', properties: { objectName: 'deal', customFields: [{ name: 'note', type: 'text', requiredWhen: OVER_AST_NODES }] } },
      '.properties.customFields[0].requiredWhen',
    ],
    [
      'a `record:alert` `visible`',
      { type: 'record:alert', properties: { title: 'Heads up', visible: OVER_AST_NODES } },
      '.properties.visible',
    ],
  ])('%s', (_label, component, rel) => {
    const findings = validatePagePredicateBounds({ pages: [pageWith(component)] });
    expect(findings.map((f) => f.path)).toEqual([`pages[0].regions[0].components[0]${rel}`]);
  });

  it('a `boolean` in a `boolean | expression` slot is not CEL and draws nothing', () => {
    const stack = { pages: [pageWith({ type: 'record:alert', properties: { title: 'Heads up', visible: false } })] };
    expect(validatePagePredicateBounds(stack)).toEqual([]);
  });

  it('a tab panel nested in another tab panel is reached through the shared page walk', () => {
    const inner = tabsPage(OVER_AST_NODES).regions[0]!.components[0]!;
    const outer = pageWith({
      type: 'page:tabs',
      properties: { items: [{ label: 'Outer', value: 'outer', children: [inner] }] },
    });
    expect(validatePagePredicateBounds({ pages: [outer] }).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.items[0].children[0].properties.items[1].visibleWhen',
    ]);
  });
});

describe('#24953 — no double report with the visibility family', () => {
  it('the component NODE `visibleWhen` stays the visibility family\'s error, and this rule says nothing of it', () => {
    const stack = { pages: [tabsPage(WITHIN, OVER_AST_NODES)] };
    const findings = runAuthoringRules('build', { normalized: stack, parsed: stack });
    expect(ours(findings)).toEqual([]);
    expect(findings.filter((f) => f.rule === VISIBILITY_PREDICATE_OVER_BUDGET).map((f) => [f.severity, f.path]))
      .toEqual([['error', 'pages[0].regions[0].components[0]']]);
  });

  it('a child component\'s node `visibleWhen` inside a tab panel is not judged here either', () => {
    const page = pageWith({
      type: 'page:tabs',
      properties: { items: [{ label: 'A', value: 'a', children: [{ type: 'element:text', visibleWhen: OVER_AST_NODES }] }] },
    });
    expect(validatePagePredicateBounds({ pages: [page] })).toEqual([]);
  });
});

describe('#24953 — wiring', () => {
  it('runs on all three commands as a gating rule, and at the page door only', () => {
    const entry = authoringRulesFor('validate').find((r) => r.name === 'validatePagePredicateBounds');
    expect(entry?.tier).toBe('gating');
    for (const command of ['build', 'lint'] as const) {
      expect(authoringRulesFor(command).map((r) => r.name)).toContain('validatePagePredicateBounds');
    }
    expect(runtimeAuthoringRulesFor('page').map((r) => r.name)).toContain('validatePagePredicateBounds');
    expect(runtimeAuthoringRulesFor('view').map((r) => r.name)).not.toContain('validatePagePredicateBounds');
  });
});
