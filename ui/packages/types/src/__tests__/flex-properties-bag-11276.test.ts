/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `flex` takes its props in the `properties` bag, and the flat spelling retires
 * from both authoring faces (objectui#11276, the `flex` batch, under the
 * maintainer's ruling A on objectui#11300).
 *
 * ## The defect this pins
 *
 * `@objectstack/spec`'s strict `PageComponentSchema` refuses a prop written on
 * a page component itself as mis-layered (ADR-0089 D3a), for every component
 * type, and accepts the same props in `properties`. objectui's `flex` arm was
 * the flat mirror of the TypeScript twin instead, so the two validators
 * disagreed in both directions:
 *
 *   - the objectstack showcase's layout boxes, `{ type: 'flex',
 *     responsiveStyles, properties: { children } }`, were refused by the strict
 *     face, which named `properties` as an unrecognized key;
 *   - the flat node `os validate` refuses parsed green on both faces.
 *
 * ## No spec row, so the bag is the mirror's own members
 *
 * `ComponentPropsMap` carries no `flex` row, so the spec's page component takes
 * ANY bag for this type, and no row is invented here. The bag's `direction`,
 * `justify`, `align`, `gap` and `wrap` are the flat `FlexSchema` mirror's own
 * members, BY REFERENCE. Its `children` is the mirror's single-node-or-list
 * slot with the LIST's entries left to the spec page walk's judgment, which
 * `AnyComponentSchema` already runs at every `properties.children` (objectui#11223):
 * the mirror's own member would judge every nested component a second time.
 *
 * ## What did NOT move
 *
 * The TypeScript `FlexSchema` (`../layout.ts`) and its zod mirror stay
 * published: they are the node as the `flex` renderer reads it AFTER
 * `SchemaRenderer` hoists `properties`, and as code composes it. The mirror is
 * no longer an arm of `AnyComponentSchema`; `FlexBlockSchema` is. `stack` and
 * every other node-level arm keep their flat props: the ruling is for `flex`
 * only. That a stored flat `flex` node still DRAWS is pinned where the renderer
 * lives, `packages/components/src/__tests__/flex-properties-bag-render-11276.test.tsx`.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` block below is TYPE-level: `tsc -p tsconfig.test.json`
 * (the third leg of this package's `type-check` script) reads it, and vitest —
 * which strips types — does not. The `describe` blocks are RUNTIME.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap, PageComponentSchema } from '@objectstack/spec/ui';

import {
  AnyComponentSchema,
  BaseSchema,
  FlexBlockSchema,
  FlexSchema,
  LayoutSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import type { FlexLayoutProps } from '../layout';

/* ── Type-level pins (compiled by `tsc -p tsconfig.test.json`) ─────────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The bag object (its `.passthrough()` index signature is read off the shape, not the input). */
type BagShape = ReturnType<(typeof FlexBlockSchema)['shape']['properties']['unwrap']>['shape'];

/** The bag's members are exactly the TypeScript `FlexLayoutProps` members. */
export type assertionBagKeysAreFlexLayoutProps = Expect<Equal<keyof BagShape, keyof FlexLayoutProps>>;
/** Each by-reference member accepts exactly what `FlexLayoutProps` declares. */
export type assertionBagValueTypes = [
  Expect<Equal<z.input<BagShape['direction']>, FlexLayoutProps['direction']>>,
  Expect<Equal<z.input<BagShape['justify']>, FlexLayoutProps['justify']>>,
  Expect<Equal<z.input<BagShape['align']>, FlexLayoutProps['align']>>,
  Expect<Equal<z.input<BagShape['gap']>, FlexLayoutProps['gap']>>,
  Expect<Equal<z.input<BagShape['wrap']>, FlexLayoutProps['wrap']>>,
];
/** A flex prop written flat on the authored node takes no value at all. */
export type assertionFlatKeysTakeNothing = [
  Expect<Equal<z.input<typeof FlexBlockSchema>['direction'], undefined>>,
  Expect<Equal<z.input<typeof FlexBlockSchema>['children'], undefined>>,
];

/* ── Runtime ──────────────────────────────────────────────────────────────── */

type Result = { success: boolean; error?: { issues: z.core.$ZodIssue[] } };
type Judge = (document: unknown) => Result;

const FACES: ReadonlyArray<readonly [string, Judge]> = [
  ['tolerant', (document) => safeValidateSchema(document)],
  ['strict', (document) => StrictAnyComponentSchema.safeParse(document)],
];

const issuesOf = (result: Result) =>
  result.success
    ? []
    : result.error!.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.'), message: issue.message }));

/** The bag's members, read off the arm on every run. */
const bagShape = (): Record<string, z.ZodType> =>
  ((FlexBlockSchema.shape.properties as z.ZodOptional).unwrap() as z.ZodObject).shape as Record<string, z.ZodType>;

/** The six members this batch moved into the bag, named so a reader sees them. */
const BAG_KEYS = ['align', 'children', 'direction', 'gap', 'justify', 'wrap'];

/**
 * Nodes in the shapes the objectstack showcase writes (`examples/app-showcase`,
 * `command-center.page.ts` and `styling-gallery.page.ts`, which build them with
 * helpers): the node-level `id` and `responsiveStyles`, every prop — the child
 * list included — in `properties`. The structure is the producer's; the
 * strings are not.
 */
const SHOWCASE_SHAPES: ReadonlyArray<readonly [string, unknown]> = [
  [
    'a leaf box with an empty child list (the rule / bar / spacer nodes)',
    { id: 'cc_rule', type: 'flex', responsiveStyles: { large: { width: 'min(640px, 60%)', height: '1px' } }, properties: { children: [] } },
  ],
  [
    'a panel heading: a box of boxes and text blocks',
    {
      id: 'cc_status_h',
      type: 'flex',
      responsiveStyles: { large: { display: 'flex', alignItems: 'center', gap: '9px' } },
      properties: {
        children: [
          { id: 'cc_status_bar', type: 'flex', responsiveStyles: { large: { width: '4px', height: '15px' } }, properties: { children: [] } },
          { id: 'cc_status_t', type: 'element:text', responsiveStyles: { large: { fontSize: '14px' } }, properties: { content: 'Task status' } },
        ],
      },
    },
  ],
  [
    'a band laid out as a grid, holding a chart panel',
    {
      id: 'cc_rowA',
      type: 'flex',
      responsiveStyles: {
        large: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '16px' },
        small: { gridTemplateColumns: '1fr' },
      },
      properties: {
        children: [
          {
            id: 'cc_health',
            type: 'flex',
            responsiveStyles: { large: { display: 'block', minWidth: '0' }, small: { padding: '12px' } },
            properties: {
              children: [
                {
                  id: 'cc_health_c',
                  type: 'object-chart',
                  responsiveStyles: { large: { width: '100%' } },
                  properties: { dataset: 'project_metrics', dimensions: ['health'], values: ['project_count'], chartType: 'donut' },
                },
              ],
            },
          },
        ],
      },
    },
  ],
];

/**
 * objectstack's UI skill (`skills/objectstack-ui/rules/pages.md`, the "styled
 * pricing card" under Styling) teaches this node; verbatim but for its comments.
 */
const TAUGHT_NODE = {
  id: 'plan_solo', type: 'flex',
  responsiveStyles: {
    large: {
      display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)',
      backgroundColor: 'var(--surface)', border: '1px solid hsl(var(--primary))',
      boxShadow: '0 0 0 3px hsl(var(--primary) / 0.25), var(--shadow-lg)',
    },
    small: { padding: 'var(--space-4)', gap: 'var(--space-3)' },
  },
  properties: {
    children: [
      { id: 'plan_solo_price', type: 'element:text',
        responsiveStyles: { large: { fontSize: '40px', fontWeight: '700', color: 'var(--text-strong)' }, small: { fontSize: '32px' } },
        properties: { content: '$29' } },
      { id: 'cta_solo', type: 'element:button',
        responsiveStyles: { large: { marginTop: 'auto', width: '100%' } },
        properties: { label: 'Upgrade', variant: 'primary', size: 'large' } },
    ],
  },
};

/** objectui's own authored spelling, every bag member in play. */
const OWN_NODE = {
  type: 'flex',
  id: 'toolbar',
  className: 'border-b pb-3',
  properties: {
    direction: 'row',
    justify: 'between',
    align: 'center',
    gap: 4,
    wrap: true,
    children: [{ type: 'text', content: 'Orders' }, { type: 'button', label: 'New order' }],
  },
};

describe('flex validates in the `properties` bag (objectui#11276)', () => {
  const nodes: ReadonlyArray<readonly [string, unknown]> = [
    ...SHOWCASE_SHAPES,
    ['objectstack\'s UI skill\'s taught node', TAUGHT_NODE],
    ['objectui\'s own spelling, every bag member in play', OWN_NODE],
  ];

  it.each(FACES.flatMap(([face, judge]) => nodes.map(([name, node]) => [face, name, judge, node] as const)))(
    '%s face: %s',
    (_face, _name, judge, node) => {
      expect(issuesOf(judge(node))).toEqual([]);
    },
  );

  it('the fixtures are spec-valid by the spec\'s own page component (lit control)', () => {
    for (const [, node] of nodes) expect(PageComponentSchema.safeParse(node).success).toBe(true);
  });

  it('the bag survives the parse unchanged on both faces', () => {
    for (const [, judge] of FACES) {
      const result = judge(OWN_NODE) as Result & { data?: { properties?: unknown } };
      expect(result.data?.properties).toEqual(OWN_NODE.properties);
    }
  });

  it('reaches the arm at a node-level child slot and inside another flex\'s bag', () => {
    const inSlot = { type: 'container', children: [{ type: 'flex', direction: 'col' }] };
    const inBag = { type: 'flex', properties: { children: [{ type: 'flex', direction: 'col' }] } };
    for (const [, judge] of FACES) {
      expect(judge(inSlot).success).toBe(false);
      expect(issuesOf(judge(inBag)).map((issue) => issue.path)).toEqual(['properties.children.0.direction']);
    }
  });
});

describe('the spec has no `flex` row, and none is invented (objectui#11276)', () => {
  it('`ComponentPropsMap` carries no `flex` row (lit control, read off the installed spec)', () => {
    expect(Object.keys(ComponentPropsMap)).not.toContain('flex');
    // …while it does carry rows, so the absence is a reading.
    expect(Object.keys(ComponentPropsMap)).toContain('object-grid');
  });

  it('so the spec\'s page component takes any bag on this type', () => {
    expect(PageComponentSchema.safeParse({ type: 'flex', properties: { anything: [1, 2] } }).success).toBe(true);
  });

  it('the bag\'s description names the mirror and says there is no row', () => {
    const description = FlexBlockSchema.shape.properties.description ?? '';
    expect(description).toContain('`FlexSchema`');
    expect(description).toContain('has no `ComponentPropsMap[\'flex\']` row');
  });
});

describe('the bag is the flat mirror\'s own members (objectui#11276)', () => {
  it('its key set is the mirror\'s own members: the shape less the node base and the envelope, `children` kept', () => {
    const nodeLevel = new Set([...Object.keys(BaseSchema.shape), 'responsiveStyles']);
    nodeLevel.delete('children');
    const expected = Object.keys(FlexSchema.shape).filter((key) => !nodeLevel.has(key)).sort();
    expect(Object.keys(bagShape()).sort()).toEqual(expected);
    expect(expected).toEqual(BAG_KEYS);
  });

  it('each member but `children` IS the mirror\'s schema object, not a copy', () => {
    for (const key of BAG_KEYS.filter((k) => k !== 'children')) {
      expect(bagShape()[key], key).toBe((FlexSchema.shape as Record<string, unknown>)[key]);
    }
  });

  it('the bag keeps the mirror\'s values: a value the mirror refuses is refused in the bag, at its own path', () => {
    for (const [, judge] of FACES) {
      expect(issuesOf(judge({ type: 'flex', properties: { direction: 'column' } })).map((i) => [i.code, i.path]))
        .toEqual([['invalid_value', 'properties.direction']]);
      // `invalid_value`, not `invalid_type`, since objectui#11474 closed `gap` to a literal set of
      // the renderer's steps: zod judges a literal union by value, so a string is an off-set value.
      expect(issuesOf(judge({ type: 'flex', properties: { gap: '4' } })).map((i) => [i.code, i.path]))
        .toEqual([['invalid_value', 'properties.gap']]);
    }
  });

  it('a key `flex` does not declare, in the bag, stays unjudged by the tolerant face and is refused by the strict face', () => {
    const node = { type: 'flex', properties: { padding: 4, children: [] } };
    expect(safeValidateSchema(node).success).toBe(true);
    const strict = StrictAnyComponentSchema.safeParse(node);
    expect(strict.success).toBe(false);
    expect(strict.error?.issues.map((issue) => [issue.code, issue.path.join('.'), (issue as { keys?: string[] }).keys]))
      .toEqual([['unrecognized_keys', 'properties', ['padding']]]);
  });
});

describe('a nested component in the bag\'s child list is judged once, at its real path (objectui#11276)', () => {
  it('a refused child reports its own issue and nothing else, as on a `page:` container', () => {
    const child = { type: 'flex', properties: { direction: 'column' } };
    for (const [, judge] of FACES) {
      const flex = issuesOf(judge({ type: 'flex', properties: { children: [child] } }));
      const card = issuesOf(judge({ type: 'page:card', properties: { children: [child] } }));
      expect(flex).toEqual([
        { code: 'invalid_value', path: 'properties.children.0.properties.direction', message: expect.any(String) },
      ]);
      // The page container is the control: the same child, the same single issue.
      expect(flex).toEqual(card);
    }
  });

  it('two levels down, still once', () => {
    const doc = { type: 'flex', properties: { children: [{ type: 'flex', properties: { children: [{ type: 'nope' }] } }] } };
    for (const [, judge] of FACES) {
      expect(issuesOf(judge(doc)).map((issue) => issue.path)).toEqual(['properties.children.0.properties.children.0.type']);
    }
  });

  it('the strict face closes a nested component too', () => {
    const doc = { type: 'flex', properties: { children: [{ type: 'text', content: 'a', bogus: 1 }] } };
    expect(safeValidateSchema(doc).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(doc).error?.issues.map((issue) => issue.path.join('.')))
      .toEqual(['properties.children.0']);
  });

  it('a single node, which the page walk does not descend, is judged by the node union', () => {
    for (const [, judge] of FACES) {
      expect(judge({ type: 'flex', properties: { children: { type: 'text', content: 'a' } } }).success).toBe(true);
      expect(judge({ type: 'flex', properties: { children: { type: 'nope' } } }).success).toBe(false);
    }
  });
});

describe('the flat spelling is refused by name, with the bag member as the remedy (objectui#11276)', () => {
  it('the spec\'s own page component refuses the flat node (lit control: the reason holds for this type)', () => {
    const result = PageComponentSchema.safeParse({ type: 'flex', direction: 'col', gap: 2, children: [] });
    expect(result.success).toBe(false);
    const keys = result.success ? [] : result.error.issues.flatMap((issue) => (issue as { keys?: string[] }).keys ?? []);
    expect(keys.sort()).toEqual(['children', 'direction', 'gap']);
  });

  it.each(FACES.flatMap(([face, judge]) => BAG_KEYS.map((key) => [face, key, judge] as const)))(
    '%s face: a flat `%s` is refused at its own path, naming `properties.KEY` and the bag',
    (_face, key, judge) => {
      const value = key === 'children' ? [] : key === 'gap' ? 2 : key === 'wrap' ? true : 'start';
      const issues = issuesOf(judge({ type: 'flex', [key]: value }));
      expect(issues.map((issue) => [issue.code, issue.path])).toEqual([['invalid_type', key]]);
      expect(issues[0]!.message).toContain(`Did you mean \`${key}\` → \`properties.${key}\`?`);
      expect(issues[0]!.message).toContain('A `flex` node takes its props in its `properties` bag');
      // The detail names no row: the spec has none for this type.
      expect(issues[0]!.message).toContain('has no `ComponentPropsMap[\'flex\']` row');
    },
  );

  it('the whole flat node the docs taught before this batch is refused key by key', () => {
    const flat = { type: 'flex', justify: 'end', gap: 2, children: [{ type: 'button', label: 'Add' }] };
    for (const [, judge] of FACES) {
      expect(issuesOf(judge(flat)).map((issue) => issue.path).sort()).toEqual(['children', 'gap', 'justify']);
    }
  });

  it('`body` is refused toward `properties.children`, not toward a node-level `children`', () => {
    for (const [, judge] of FACES) {
      const issues = issuesOf(judge({ type: 'flex', body: [] }));
      expect(issues.map((issue) => [issue.code, issue.path])).toEqual([['invalid_type', 'body']]);
      expect(issues[0]!.message).toContain('Did you mean `body` → `properties.children`?');
    }
  });

  it('`BaseSchema` keys and the node envelope stay on the node (control)', () => {
    const node = {
      type: 'flex',
      id: 'row',
      className: 'p-4',
      visible: true,
      responsiveStyles: { large: { padding: '8px' } },
      properties: { children: [] },
    };
    for (const [, judge] of FACES) expect(issuesOf(judge(node))).toEqual([]);
  });
});

describe('the arm moved; the post-hoist mirror stayed (objectui#11276)', () => {
  const armFor = (type: string): unknown => {
    const options = (LayoutSchema as unknown as { options: z.ZodObject[] }).options;
    return options.find((arm) => (arm.shape.type as z.ZodLiteral).value === type);
  };

  it('`flex` is armed by the bag arm, not by the flat mirror', () => {
    expect(armFor('flex')).toBe(FlexBlockSchema);
    expect(armFor('flex')).not.toBe(FlexSchema);
    // Non-vacuity: the node union is the one `safeValidateSchema` runs.
    expect(AnyComponentSchema.safeParse(OWN_NODE).success).toBe(true);
  });

  it('the flat mirror is still published and still judges the post-hoist node', () => {
    const hoisted = { type: 'flex', ...OWN_NODE.properties, id: OWN_NODE.id, className: OWN_NODE.className };
    expect(FlexSchema.safeParse(hoisted).success).toBe(true);
    expect(FlexSchema.safeParse({ type: 'flex', direction: 'column' }).success).toBe(false);
  });

  it('`stack` keeps its flat props on both faces: the ruling is for `flex` only (control)', () => {
    const stack = { type: 'stack', direction: 'col', gap: 4, children: [{ type: 'text', content: 'a' }] };
    for (const [, judge] of FACES) expect(issuesOf(judge(stack))).toEqual([]);
  });
});
