// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { ObjectStackSchema } from '../stack.zod';
import { ComponentPropsMap } from './component.zod';
import { PageSchema, definePage } from './page.zod';
import { ViewDataSchema } from './view.zod';

// ─── #23357: the page parse refuses a component's retired `api` data binding ──
//
// The view-level `api` data source is retired (`view.zod.ts`, ADR-0049): a
// view's own `data` naming it is refused by `ViewDataSchema`'s parse. A page
// component whose `data` prop is that same schema (`object-grid`, `object-map`,
// `object-gantt`, `object-tree`) took the same arm, but the page parse leaves
// `properties` an open record and the component-props gate that judges the bag
// runs at the CLI doors only. So a page saved through the Studio, REST or MCP
// kept the binding. `checkPageComponentViewData` is the narrow judge triage
// ruled: this one retirement, at every door that parses a page.
//
// Assertion set (the `view-data-api-provider-retirement.test.ts` precedent): a
// schema refusal raises a `ZodError` whose issues carry `code` and `path` but no
// ADR-0112 `status`, so these pins assert the refusal, the issue `code`, the
// `path` naming WHICH component refused, and the prescription text — the
// retirement's own, byte for byte (the 422 envelope at the save door is pinned
// in `@objectstack/metadata-protocol`'s `protocol.save-union-issues.test.ts`).
//
// The provider is spelled through a constant: the spec's tree-scoped absence pin
// reads authored literals, and these bodies are refusals, not authorings.

const RETIRED_PROVIDER = 'api' as const;
const RETIRED_BINDING = {
  provider: RETIRED_PROVIDER,
  read: { url: 'https://partner.example.com/cases', method: 'GET', headers: { Authorization: 'Bearer s3cr3t' } },
} as const;

/** The four types whose `data` is a view data source, as the D3 entry names them. */
const VIEW_DATA_COMPONENTS = ['object-grid', 'object-map', 'object-gantt', 'object-tree'] as const;

/** The retirement's own prescription — read off `ViewDataSchema`, never retyped. */
const PRESCRIPTION = (() => {
  const verdict = ViewDataSchema.safeParse(RETIRED_BINDING);
  if (verdict.success) throw new Error('ViewDataSchema accepts the retired provider — the retirement is gone');
  return verdict.error.issues.find((issue) => issue.path.join('.') === 'provider')!.message;
})();

const block = (type: string, data: unknown, id = 'cases') => ({ id, type, properties: { objectName: 'crm_case', data } });
const pageOf = (components: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'partner_page',
  label: 'Partner',
  type: 'app',
  regions: [{ name: 'main', components }],
  ...extra,
});

function refusalsOf(result: z.ZodSafeParseResult<unknown>) {
  return result.success ? [] : result.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.'), message: issue.message }));
}

describe('PageSchema — a component `data` prop naming the retired `api` provider is refused', () => {
  it('the prescription read off ViewDataSchema is the retirement\'s (anti-vacuity)', () => {
    expect(PRESCRIPTION).toMatch(/^`view\.data\.provider: 'api'` was removed in @objectstack\/spec 18 \(ADR-0049/);
  });

  it.each(VIEW_DATA_COMPONENTS)('%s in a region: one `custom` issue at its `properties.data.provider`, carrying the prescription', (type) => {
    expect(refusalsOf(PageSchema.safeParse(pageOf([block(type, RETIRED_BINDING)])))).toEqual([
      { code: 'custom', path: 'regions.0.components.0.properties.data.provider', message: PRESCRIPTION },
    ]);
  });

  it('the bare `{ provider }` is refused the same way — the value, not the request block, is what left', () => {
    expect(refusalsOf(PageSchema.safeParse(pageOf([block('object-grid', { provider: RETIRED_PROVIDER })])))).toEqual([
      { code: 'custom', path: 'regions.0.components.0.properties.data.provider', message: PRESCRIPTION },
    ]);
  });

  it('reaches a component nested in another component, at any depth, and a component in a slot', () => {
    const tabs = {
      id: 'tabs',
      type: 'page:tabs',
      properties: { items: [{ label: 'Cases', children: [block('object-grid', RETIRED_BINDING, 'in_tab')] }] },
    };
    const flex = { id: 'row', type: 'flex', properties: { children: [{ id: 'card', type: 'page:card', properties: { children: [block('object-tree', RETIRED_BINDING, 'deep')] } }] } };
    const page = pageOf([tabs, flex], { kind: 'slotted', type: 'record', object: 'crm_case', slots: { details: block('object-map', RETIRED_BINDING, 'slotted'), header: [block('object-gantt', RETIRED_BINDING, 'head')] } });
    expect(refusalsOf(PageSchema.safeParse(page)).map((r) => [r.code, r.path])).toEqual([
      ['custom', 'regions.0.components.0.properties.items.0.children.0.properties.data.provider'],
      ['custom', 'regions.0.components.1.properties.children.0.properties.children.0.properties.data.provider'],
      // The parse emits the slot map in the schema's own key order, `header` first.
      ['custom', 'slots.header.0.properties.data.provider'],
      ['custom', 'slots.details.properties.data.provider'],
    ]);
  });

  it('every door that parses a page refuses it: `definePage`, the `page` metadata-type schema, and the stack', () => {
    const page = pageOf([block('object-grid', RETIRED_BINDING)]);
    expect(() => definePage(page as Parameters<typeof definePage>[0])).toThrow(/`view\.data\.provider: 'api'` was removed/);
    // The schema the metadata save door and the read / boot diagnostics resolve.
    const door = getMetadataTypeSchema('page')!;
    expect(refusalsOf(door.safeParse(page))).toEqual([
      { code: 'custom', path: 'regions.0.components.0.properties.data.provider', message: PRESCRIPTION },
    ]);
    expect(refusalsOf(ObjectStackSchema.safeParse({ pages: [page] }))).toEqual([
      { code: 'custom', path: 'pages.0.regions.0.components.0.properties.data.provider', message: PRESCRIPTION },
    ]);
  });

  it('a self-referencing component (a hand-built stack object) is judged once and the walk ends', () => {
    const loop: { id: string; type: string; properties: { children: unknown[] } } = { id: 'loop', type: 'flex', properties: { children: [] } };
    loop.properties.children.push(loop, block('object-grid', RETIRED_BINDING));
    expect(refusalsOf(PageSchema.safeParse(pageOf([loop]))).map((r) => r.path)).toEqual([
      'regions.0.components.0.properties.children.1.properties.data.provider',
    ]);
  });
});

describe('PageSchema — what the check leaves alone (controls)', () => {
  it.each([
    ['the `object` provider', block('object-grid', { provider: 'object', object: 'crm_case' })],
    ['the `value` provider', block('object-map', { provider: 'value', items: [{ name: 'a' }] })],
    ['the `schema` provider', block('object-tree', { provider: 'schema', schemaId: 'report' })],
    ['no `data` at all', { id: 'cases', type: 'object-gantt', properties: { objectName: 'crm_case' } }],
    ['another unknown provider — the props gate\'s to judge, not this retirement\'s', block('object-grid', { provider: 'rest' })],
    ['a row-array `data` type carrying the retired provider — its own contract', block('object-kanban', RETIRED_BINDING)],
    ['a type with no props row carrying the retired provider', block('custom:partner-widget', RETIRED_BINDING)],
    ['the governed element binding on the component itself', {
      id: 'cases', type: 'object-grid', properties: { objectName: 'crm_case' }, dataSource: { provider: RETIRED_PROVIDER, read: { url: '/api/v1/cases' } },
    }],
  ])('accepts: %s', (_label, node) => {
    const result = PageSchema.safeParse(pageOf([node]));
    expect(result.success, JSON.stringify(refusalsOf(result))).toBe(true);
  });
});

describe('the check covers exactly the props rows whose `data` is ViewDataSchema — derived, both directions', () => {
  const defOf = (schema: unknown): unknown => (schema as { _zod?: { def?: unknown } } | undefined)?._zod?.def;
  /** A row member through its `optional` / `default` / `nullable` wrappers. */
  const unwrapped = (schema: unknown): unknown => {
    let current = schema;
    for (;;) {
      const def = defOf(current) as { type?: string; innerType?: unknown } | undefined;
      if (!def || !['optional', 'default', 'nullable'].includes(def.type ?? '')) return current;
      current = def.innerType;
    }
  };
  const rowTakesViewData = (type: string): boolean => {
    const row = (ComponentPropsMap as Record<string, { shape?: Record<string, unknown> }>)[type]!;
    const member = row.shape?.data;
    return member !== undefined && defOf(unwrapped(member)) === defOf(ViewDataSchema);
  };

  it('the derivation from ComponentPropsMap is the four types (anti-vacuity: it is not empty, and the map is populated)', () => {
    const types = Object.keys(ComponentPropsMap);
    expect(types.length).toBeGreaterThan(40);
    expect(types.filter(rowTakesViewData)).toEqual([...VIEW_DATA_COMPONENTS]);
  });

  it('for every props row, the page parse refuses the retired binding exactly when the row\'s `data` is ViewDataSchema', () => {
    // Read at the binding's own position: a type the vocabulary retired by name
    // (`user:profile`, …) is refused at `type` for that, which is not this check.
    const AT = 'regions.0.components.0.properties.data.provider';
    for (const type of Object.keys(ComponentPropsMap)) {
      const issues = refusalsOf(PageSchema.safeParse(pageOf([block(type, RETIRED_BINDING)])));
      expect(issues.some((issue) => issue.path === AT), type).toBe(rowTakesViewData(type));
    }
  });
});
