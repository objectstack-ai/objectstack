// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { flowNodeValueTemplateRefusals } from '../automation/flow-value-slot-template.js';
import { ObjectSchema } from '../data/object.zod.js';
import { MIGRATIONS_BY_MAJOR } from '../migrations/registry.js';
import { ComponentPropsMap } from '../ui/component.zod.js';
import { PageSchema } from '../ui/page.zod.js';
import { ViewDataSchema } from '../ui/view.zod.js';
import { applyConversions, applyConversionsToFlow } from './apply.js';
import { REFUSED_STORED_SHAPES } from './refused-shapes.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import { CONVERSION_TODO_CODE, type ConversionNotice, type ConversionTodoNotice } from './types.js';

/**
 * [#23269 · #23270 · #23271] The v18 upgrade's fate for stored rows of three
 * retired shapes, each with no lossless rewrite: REFUSED AND LISTED.
 *
 * The listing rides the conversion pass's TODO sink, so `os migrate meta
 * --stored` prints each site under its row. These pins hold the spec half:
 * - each refused shape is listed once per site, with its row's name, the node
 *   or view it sits on, and its fate;
 * - a conforming row, a converted row and a row on another arm are not listed;
 * - the listing agrees with the refusing door, in both directions;
 * - nothing is rewritten, with or without a sink.
 */

/** The retired view-level provider, spelled through a constant (the tree-scoped absence pin reads literals). */
const API = 'api' as const;

function todosOf(stack: Record<string, unknown>): { stack: Record<string, unknown>; todos: ConversionTodoNotice[] } {
  const todos: ConversionTodoNotice[] = [];
  const out = applyConversions(stack, { includeRetired: true, onTodo: (t) => todos.push(t) });
  return { stack: out, todos };
}

function storedTodos(
  type: string,
  row: Record<string, unknown>,
  knownDatasources?: ReadonlyMap<string, { readonly schemaMode?: unknown }>,
) {
  const todos: ConversionTodoNotice[] = [];
  const notices: ConversionNotice[] = [];
  const item = applyConversionsToStoredItem(type, row, {
    onTodo: (t) => todos.push(t),
    onNotice: (n) => notices.push(n),
    ...(knownDatasources ? { knownDatasources } : {}),
  }) as Record<string, any>;
  return { item, todos, notices };
}

describe('the refused-shape list — registered against the migration chain', () => {
  it('names each refused shape by a D3 entry of its step, never by a conversion id', () => {
    const conversionIds = new Set(ALL_CONVERSIONS.map((c) => c.id));
    const ids = REFUSED_STORED_SHAPES.map((r) => r.id);
    expect(new Set(ids).size, 'ids are unique').toBe(ids.length);
    for (const refused of REFUSED_STORED_SHAPES) {
      const step = MIGRATIONS_BY_MAJOR[refused.toMajor];
      expect(step?.semantic.map((s) => s.id), `${refused.id} is a D3 entry of step ${refused.toMajor}`)
        .toContain(refused.id);
      expect(conversionIds.has(refused.id), `${refused.id} is not a conversion id`).toBe(false);
    }
    expect(ids).toEqual([
      'cbp-master-relation-tiers-retired',
      'view-data-api-provider-retired',
      'flow-value-slot-template-dialect-refused',
      'object-external-binding-managed-datasource-refused',
    ]);
  });

  it('runs only with a TODO sink, and never rewrites either way', () => {
    const stack = {
      objects: [{ name: 'crm_line', label: 'Line', sharingModel: 'controlled_by_parent', fields: {} }],
    };
    expect(applyConversions(stack, { includeRetired: true })).toBe(stack);
    const { stack: out, todos } = todosOf(stack);
    expect(out).toBe(stack);
    expect(todos).toHaveLength(1);
    expect(todos[0]!.code).toBe(CONVERSION_TODO_CODE);
  });
});

// ── #23270 ────────────────────────────────────────────────────────────────

const cbpRow = (name: string, fields: Record<string, unknown>, sharingModel = 'controlled_by_parent') => ({
  name,
  label: name,
  sharingModel,
  fields: { title: { type: 'text', label: 'Title' }, ...fields },
});
const md = (reference: string, extra: Record<string, unknown> = {}) => ({
  type: 'master_detail',
  label: reference,
  reference,
  ...extra,
});

/** The parse's controlled_by_parent issue on one object, or undefined. */
function cbpIssue(row: unknown) {
  const r = ObjectSchema.safeParse(row);
  if (r.success) return undefined;
  return r.error.issues.find((i) => /declares sharingModel 'controlled_by_parent'/.test(i.message));
}

describe('#23270 — a stored controlled_by_parent object without exactly one required master is listed by object', () => {
  const SHAPES: ReadonlyArray<[string, Record<string, unknown>, string, RegExp]> = [
    [
      'two masters, both required',
      { quote: md('crm_quote', { required: true }), order: md('crm_order', { required: true }) },
      'objects[0].fields',
      /declares 2 `master_detail` fields \(`quote`, `order`\), and which of them is the master is the owner's choice/,
    ],
    [
      'two masters, neither required',
      { quote: md('crm_quote'), order: md('crm_order') },
      'objects[0].sharingModel',
      /declares 2 `master_detail` fields \(`quote`, `order`\), and which of them is the master is the owner's choice/,
    ],
    [
      'an explicit required: false',
      { quote: md('crm_quote', { required: false }) },
      'objects[0].sharingModel',
      /`quote`, declares `required: false`, which the builder refuses rather than forcing/,
    ],
    [
      'a required lookup only',
      { quote: { type: 'lookup', label: 'Quote', reference: 'crm_quote', required: true } },
      'objects[0].sharingModel',
      /`quote` is a required `lookup`, which no longer derive a master\. Turning a `lookup` into a `master_detail` changes what deleting the master does/,
    ],
    [
      'no master',
      { note: { type: 'text', label: 'Note' } },
      'objects[0].sharingModel',
      /declares no `master_detail` and no required `lookup`, so there is no master to derive/,
    ],
  ];

  it.each(SHAPES)('%s: one TODO naming the object, its shape and the owner\'s choice; the row is not rewritten', (_label, fields, path, fate) => {
    const row = cbpRow('crm_line', fields);
    const { item, todos, notices } = storedTodos('object', row);
    expect(notices.filter((n) => n.conversionId === 'cbp-master-detail-required-defaulted')).toEqual([]);
    expect(item).toEqual(row);
    expect(todos).toHaveLength(1);
    const todo = todos[0]!;
    expect(todo.conversionId).toBe('cbp-master-relation-tiers-retired');
    expect(todo.path).toBe(path);
    expect(todo.reason).toMatch(fate);
    expect(todo.reason).toContain("Object 'crm_line' declares sharingModel 'controlled_by_parent'");
    expect(todo.reason).toContain('every read of its rows is denied');
    expect(todo.reason).toMatch(/give it its own sharingModel \('private', 'public_read' or 'public_read_write'\), which changes who can read them/);
    // The listing and the parse refuse ONE set: the stored row still fails the parse, at the same key.
    expect(cbpIssue(item)?.path).toEqual([path.split('.').pop()]);
    // The relation is shown; the unrelated field is not.
    expect(JSON.parse(todo.from).fields.title).toBeUndefined();
  });

  it.each([
    ['readonly: true', md('crm_opportunity', { required: true, readonly: true })],
    ['system: true', md('crm_opportunity', { required: true, system: true })],
    // The Studio shape plus the flag: D2 gives `required: true`, and the flag is still listed.
    ['readonly: true, `required` omitted', md('crm_opportunity', { readonly: true })],
  ])('#25092 — a one master marked %s: one TODO under the same entry, and the TODO does not claim the runtime denies it', (_label, master) => {
    const row = cbpRow('crm_line', { opportunity: master });
    const { item, todos } = storedTodos('object', row);
    expect(item.fields.opportunity.readonly ?? item.fields.opportunity.system).toBe(true);
    expect(todos).toHaveLength(1);
    const todo = todos[0]!;
    expect(todo.conversionId).toBe('cbp-master-relation-tiers-retired');
    expect(todo.path).toBe('objects[0].fields');
    expect(todo.reason).toMatch(/Its one required `master_detail`, `opportunity`, is marked `readonly` or `system`\. Dropping the flag changes who may write the reference/);
    expect(todo.reason).toContain('the metadata save door refuses it with 422 INVALID_METADATA until it is corrected');
    expect(todo.reason).not.toContain('every read of its rows is denied');
    expect(todo.reason).toContain("Object 'crm_line' declares sharingModel 'controlled_by_parent' with its one required `master_detail`");
    // The listing and the parse refuse ONE set: the stored row still fails the parse, at the same key.
    expect(cbpIssue(item)?.path).toEqual(['fields']);
  });

  it('the Studio shape — one master_detail, `required` omitted — converts and is NOT listed', () => {
    const row = cbpRow('crm_line', { opportunity: md('crm_opportunity') });
    const { item, todos, notices } = storedTodos('object', row);
    expect(notices.map((n) => n.conversionId)).toContain('cbp-master-detail-required-defaulted');
    expect(item.fields.opportunity.required).toBe(true);
    expect(todos).toEqual([]);
    expect(cbpIssue(item)).toBeUndefined();
  });

  it.each([
    ['one required master', { opportunity: md('crm_opportunity', { required: true }) }],
    ['one required master beside a second master_detail without required', {
      opportunity: md('crm_opportunity', { required: true }),
      quote: md('crm_quote'),
    }],
    ['one required master beside a required lookup', {
      opportunity: md('crm_opportunity', { required: true }),
      campaign: { type: 'lookup', label: 'Campaign', reference: 'crm_campaign', required: true },
    }],
  ])('a conforming object (%s) is untouched and not listed — and the parse accepts it', (_label, fields) => {
    const row = cbpRow('crm_line', fields);
    const { item, todos } = storedTodos('object', row);
    expect(item).toBe(row);
    expect(todos).toEqual([]);
    expect(cbpIssue(row)).toBeUndefined();
  });

  it('another sharing model is not listed, whatever its relations', () => {
    const row = cbpRow('crm_line', { quote: md('crm_quote'), order: md('crm_order') }, 'private');
    expect(storedTodos('object', row).todos).toEqual([]);
  });
});

// ── #23271 ────────────────────────────────────────────────────────────────

const apiData = () => ({
  provider: API,
  read: { url: 'https://partner.example.com/cases', method: 'GET', headers: { Authorization: 'Bearer s3cr3t' } },
  write: { url: '/api/v1/cases', method: 'POST' },
});

describe('#23271 — a stored view bound to the retired view-level API source is listed by view', () => {
  const PRESCRIPTION = /`view\.data\.provider: 'api'` was removed in @objectstack\/spec 18/;

  it.each([
    ['a container\'s list', { object: 'crm_case', list: { type: 'grid', columns: ['name'], data: apiData() } }, 'views[0].list.data'],
    ['a container\'s form', { object: 'crm_case', form: { type: 'simple', data: apiData() } }, 'views[0].form.data'],
    ['a container\'s named list view', {
      object: 'crm_case',
      list: { type: 'grid', columns: ['name'] },
      listViews: { open: { type: 'grid', columns: ['name'], data: apiData() } },
    }, 'views[0].listViews.open.data'],
    ['a view item record', {
      name: 'open_cases', object: 'crm_case', viewKind: 'list',
      config: { type: 'grid', columns: ['name'], data: apiData() },
    }, 'views[0].config.data'],
    ['a flattened overlay', {
      name: 'open_cases', object: 'crm_case', viewKind: 'list', type: 'grid', columns: ['name'], data: apiData(),
    }, 'views[0].data'],
  ])('%s: one TODO at the data block, with its fate and the prescription; the row is not rewritten', (_label, row, path) => {
    const { item, todos } = storedTodos('view', row as Record<string, unknown>);
    expect(item).toEqual(row);
    expect(todos).toHaveLength(1);
    const todo = todos[0]!;
    expect(todo.conversionId).toBe('view-data-api-provider-retired');
    expect(todo.path).toBe(path);
    expect(todo.reason).toMatch(/No mechanical move: the replacement is a `dataSource` binding on a page component/);
    expect(todo.reason).toMatch(PRESCRIPTION);
  });

  it('an object\'s own list view is listed under the object row', () => {
    const row = {
      name: 'crm_case',
      label: 'Case',
      fields: { name: { type: 'text', label: 'Name' } },
      listViews: { open: { type: 'grid', columns: ['name'], data: apiData() } },
    };
    const { todos } = storedTodos('object', row);
    expect(todos.map((t) => [t.conversionId, t.path])).toEqual([
      ['view-data-api-provider-retired', 'objects[0].listViews.open.data'],
    ]);
    expect(todos[0]!.reason).toContain('The list view `open` of object `crm_case`');
  });

  it('never prints a credential: the URL and the method are shown, every other request key is withheld', () => {
    const { todos } = storedTodos('view', { object: 'crm_case', list: { type: 'grid', data: apiData() } });
    const todo = todos[0]!;
    expect(JSON.parse(todo.from)).toEqual({
      provider: 'api',
      read: { url: 'https://partner.example.com/cases', method: 'GET', headers: '[withheld]' },
      write: { url: '/api/v1/cases', method: 'POST' },
    });
    expect(`${todo.from} ${todo.reason} ${todo.message}`).not.toContain('s3cr3t');
  });

  it.each([
    ['object', { provider: 'object', object: 'crm_case' }],
    ['value', { provider: 'value', items: [{ name: 'a' }] }],
    ['schema', { provider: 'schema', schemaId: 'report' }],
  ])('a view on the `%s` provider is untouched and not listed', (_provider, data) => {
    const row = { object: 'crm_case', list: { type: 'grid', columns: ['name'], data } };
    const { item, todos } = storedTodos('view', row);
    expect(item).toBe(row);
    expect(todos).toEqual([]);
    expect(ViewDataSchema.safeParse(data).success).toBe(true);
  });

  it('agrees with the refusing door: the binding it lists is one ViewDataSchema refuses', () => {
    expect(ViewDataSchema.safeParse(apiData()).success).toBe(false);
  });
});

// ── #23269 ────────────────────────────────────────────────────────────────

const crudNode = (id: string, type: string, filter: unknown) => ({
  id, type, label: id, config: { objectName: 'crm_case', filter, ...(type === 'update_record' ? { fields: { status: 'closed' } } : {}) },
});
const flowOf = (name: string, nodes: unknown[]) => ({
  name,
  label: name,
  type: 'autolaunched',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, ...nodes, { id: 'end', type: 'end', label: 'End' }],
  edges: [],
});

describe('#23269 — a stored flow whose CRUD filter operand is a {…} token is listed by flow and node', () => {
  it.each([
    ['get_record', { id: '{record.id}' }, 'config.filter.id', '{record.id}'],
    ['update_record', { amount: { $gt: '{record.cap}' } }, 'config.filter.amount.$gt', '{record.cap}'],
    ['delete_record', { id: { $in: ['{a}', 'literal'] } }, 'config.filter.id.$in[0]', '{a}'],
  ])('%s: one TODO naming the flow, the node and the operand, with its CEL envelope; the flow is not rewritten', (type, filter, at, source) => {
    const flow = flowOf('fd_refused_filter', [crudNode('crud', type, filter)]);
    const todos: ConversionTodoNotice[] = [];
    const out = applyConversionsToFlow(flow, { includeRetired: true, onTodo: (t) => todos.push(t) });
    expect(out).toBe(flow);
    expect(todos).toHaveLength(1);
    const todo = todos[0]!;
    expect(todo.conversionId).toBe('flow-value-slot-template-dialect-refused');
    expect(todo.path).toBe(`flows[0].nodes[1].${at}`);
    expect(todo.from).toBe(JSON.stringify(source));
    expect(todo.reason).toContain(`Flow \`fd_refused_filter\`, node 'crud' (${type}), ${type} filter operand at ${at}.`);
    expect(todo.reason).toContain('registerFlow refuses the flow: it is not registered at boot and never runs');
    expect(todo.reason).toContain("{ dialect: 'cel', source: '");
  });

  it('reaches a node inside a structured region', () => {
    const flow = flowOf('fd_loop', [{
      id: 'each', type: 'loop', label: 'Each',
      config: {
        collection: { dialect: 'cel', source: 'items' },
        body: { nodes: [crudNode('inner', 'get_record', { id: '{item.id}' })], edges: [] },
      },
    }]);
    const todos: ConversionTodoNotice[] = [];
    applyConversionsToFlow(flow, { includeRetired: true, onTodo: (t) => todos.push(t) });
    expect(todos.map((t) => t.path)).toEqual(['flows[0].nodes[1].config.body.nodes[0].config.filter.id']);
    expect(todos[0]!.reason).toContain("node 'inner' (get_record)");
  });

  it.each([
    ['a CEL envelope', { id: { dialect: 'cel', source: 'record.id' } }],
    ['a query placeholder', { owner: '{current_user_id}', due: { $lt: '{today}' } }],
    ['a literal', { status: 'open' }],
  ])('a flow already on protocol (%s) is untouched and not listed', (_label, filter) => {
    const flow = flowOf('fd_canonical', [crudNode('crud', 'get_record', filter)]);
    const todos: ConversionTodoNotice[] = [];
    const out = applyConversionsToFlow(flow, { includeRetired: true, onTodo: (t) => todos.push(t) });
    expect(out).toBe(flow);
    expect(todos).toEqual([]);
  });

  it('agrees with the refusing door: each site is one the value-slot judge refuses, and no other', () => {
    const nodes = [
      crudNode('a', 'get_record', { id: '{record.id}', owner: '{current_user_id}' }),
      crudNode('b', 'delete_record', { id: { dialect: 'cel', source: 'record.id' } }),
    ];
    const { todos } = todosOf({ flows: [flowOf('fd_mixed', nodes)] });
    const judged = nodes.flatMap((n, i) =>
      flowNodeValueTemplateRefusals(n.type, n.config).map((r) => `flows[0].nodes[${i + 1}].config.${r.path}`));
    expect(todos.map((t) => t.path)).toEqual(judged);
    expect(judged).toEqual(['flows[0].nodes[1].config.filter.id']);
  });
});

// ── #23317 ────────────────────────────────────────────────────────────────

describe('#23317 — a stored page whose component binds the retired API source in its `data` prop is listed by page and component', () => {
  const PRESCRIPTION = /`view\.data\.provider: 'api'` was removed in @objectstack\/spec 18/;
  /** The components whose `data` prop is a view data source, as the D3 entry names them. */
  const VIEW_DATA_COMPONENTS = ['object-grid', 'object-map', 'object-gantt', 'object-tree', 'list-view'] as const;
  // A `list-view` names its object in `data` alone: its `objectName` is a retired
  // alias, which a stored node carries forward through its own conversion (#22444).
  const component = (type: string, data: unknown, id = 'block') =>
    ({ id, type, properties: type === 'list-view' ? { data } : { objectName: 'crm_case', data } });
  const pageRow = (components: unknown[], extra: Record<string, unknown> = {}) => ({
    name: 'partner_page',
    label: 'Partner',
    type: 'app',
    regions: [{ name: 'main', components }],
    ...extra,
  });

  it.each(VIEW_DATA_COMPONENTS)('%s: one TODO at the data prop, naming the page and the component, with its fate and the prescription; the row is not rewritten', (type) => {
    const row = pageRow([component(type, apiData())]);
    const { item, todos } = storedTodos('page', row);
    expect(item).toEqual(row);
    expect(todos.map((t) => [t.conversionId, t.path])).toEqual([
      ['view-data-api-provider-retired', 'pages[0].regions[0].components[0].properties.data'],
    ]);
    const todo = todos[0]!;
    expect(todo.reason).toContain(`The \`${type}\` component \`block\` of page \`partner_page\`, at pages[0].regions[0].components[0], binds the retired view-level API data source.`);
    expect(todo.reason).toMatch(/No mechanical move: the successor is a page component's `dataSource` binding/);
    expect(todo.reason).toMatch(/Left as stored, the page still loads and is served as stored, with no read diagnostic for the binding/);
    expect(todo.reason).toMatch(/its next save through the Studio, REST or MCP is refused with 422 by the component-props gate/);
    expect(todo.reason).not.toContain('metadata_spec_invalid');
    expect(todo.reason).toMatch(PRESCRIPTION);
  });

  it('reaches a component nested in another component and a component in a slot', () => {
    const row = pageRow(
      [{ id: 'tabs', type: 'page:tabs', properties: { items: [{ label: 'Cases', children: [component('object-grid', apiData(), 'inner')] }] } }],
      { slots: { details: component('object-tree', apiData(), 'slotted') } },
    );
    const { todos } = storedTodos('page', row);
    expect(todos.map((t) => t.path)).toEqual([
      'pages[0].regions[0].components[0].properties.items[0].children[0].properties.data',
      'pages[0].slots.details.properties.data',
    ]);
  });

  it('never prints a credential: the URL and the method are shown, every other request key is withheld', () => {
    const { todos } = storedTodos('page', pageRow([component('object-grid', apiData())]));
    const todo = todos[0]!;
    expect(JSON.parse(todo.from)).toEqual({
      provider: 'api',
      read: { url: 'https://partner.example.com/cases', method: 'GET', headers: '[withheld]' },
      write: { url: '/api/v1/cases', method: 'POST' },
    });
    expect(`${todo.from} ${todo.reason} ${todo.message}`).not.toContain('s3cr3t');
  });

  it.each([
    ['the `object` provider', component('object-grid', { provider: 'object', object: 'crm_case' })],
    ['the `value` provider', component('object-map', { provider: 'value', items: [{ name: 'a' }] })],
    ['a component whose `data` is a row array, not a view data source', component('object-kanban', apiData())],
    ['a type with no props row', component('custom:partner-widget', apiData())],
    ['the governed element binding on the component itself', {
      id: 'block', type: 'object-grid', properties: { objectName: 'crm_case' }, dataSource: { provider: API, read: { url: '/api/v1/cases' } },
    }],
  ])('not listed: %s', (_label, node) => {
    const row = pageRow([node]);
    const { item, todos } = storedTodos('page', row);
    expect(item).toEqual(row);
    expect(todos).toEqual([]);
  });

  it('agrees with the refusing door: the listed components are exactly the props rows whose `data` refuses the binding with the prescription', () => {
    const listed = Object.keys(ComponentPropsMap).filter((type) => storedTodos('page', pageRow([component(type, apiData())])).todos.length > 0);
    expect(listed).toEqual([...VIEW_DATA_COMPONENTS]);
    for (const type of Object.keys(ComponentPropsMap)) {
      const verdict = (ComponentPropsMap as Record<string, { safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }>)[type]!
        .safeParse({ objectName: 'crm_case', data: apiData() });
      const refusedWithPrescription = !verdict.success
        && verdict.error!.issues.some((i) => i.path[0] === 'data' && PRESCRIPTION.test(i.message));
      expect(refusedWithPrescription, type).toBe((VIEW_DATA_COMPONENTS as readonly string[]).includes(type));
    }
  });

  // The fate it states, from this package's side: the page parse ACCEPTS the
  // stored row — so the boot and read paths, which resolve that parse, raise no
  // diagnostic for it — and each listed component's own props row refuses the
  // binding at `data.provider` with the prescription, which is the verdict the
  // component-props gate raises at the CLI doors and the runtime save door
  // (that door's 422 is pinned in `@objectstack/metadata-protocol`'s
  // `protocol.runtime-authoring-gate.test.ts`).
  it('the fate it states holds: the page parse accepts the row, and each listed component\'s props row refuses it with the prescription', () => {
    const row = pageRow(VIEW_DATA_COMPONENTS.map((type, i) => component(type, apiData(), `b${i}`)));
    const { todos } = storedTodos('page', row);
    expect(todos).toHaveLength(VIEW_DATA_COMPONENTS.length);
    const parsed = PageSchema.safeParse(row);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    for (const type of VIEW_DATA_COMPONENTS) {
      const verdict = ComponentPropsMap[type].safeParse({ objectName: 'crm_case', data: apiData() });
      expect(verdict.success, type).toBe(false);
      const atProvider = verdict.success ? [] : verdict.error.issues.filter((i) => i.path.join('.') === 'data.provider');
      expect(atProvider.map((i) => i.message), type).toEqual([expect.stringMatching(PRESCRIPTION)]);
    }
  });

  it('the D3 entry and the detector name the components the detector lists', () => {
    const entry = MIGRATIONS_BY_MAJOR[18]?.semantic.find((s) => s.id === 'view-data-api-provider-retired');
    const detector = REFUSED_STORED_SHAPES.find((r) => r.id === 'view-data-api-provider-retired');
    for (const type of VIEW_DATA_COMPONENTS) {
      expect(entry?.surface, type).toContain(`\`${type}\``);
      expect(detector?.surface, type).toContain(type);
    }
  });
});

// ── #25168 ────────────────────────────────────────────────────────────────

const federatedRow = (extra: Record<string, unknown>) => ({
  name: 'wh_order',
  label: 'Order',
  sharingModel: 'private',
  fields: { title: { type: 'text', label: 'Title' } },
  external: { remoteName: 'orders' },
  ...extra,
});

const externalIssue = (row: unknown) => {
  const parsed = ObjectSchema.safeParse(row);
  return parsed.success ? undefined : parsed.error.issues.find((i) => i.path.join('.') === 'external');
};

describe('#25168 — a stored object whose `external` binding is on a managed datasource is listed by object', () => {
  it.each([
    ['`datasource` omitted', {}],
    ["`datasource: 'default'`", { datasource: 'default' }],
  ])('%s: one TODO naming the object, the rule and the owner\'s choice; the row is not rewritten', (_label, extra) => {
    const row = federatedRow(extra);
    const { item, todos } = storedTodos('object', row);
    expect(item).toEqual(row);
    expect(todos).toHaveLength(1);
    const todo = todos[0]!;
    expect(todo.conversionId).toBe('object-external-binding-managed-datasource-refused');
    expect(todo.path).toBe('objects[0].external');
    expect(todo.reason).toMatch(/^No lossless rewrite: dropping `external` turns the remote table into one ObjectStack creates/);
    expect(todo.reason).toContain("Object 'wh_order' declares `external`, but its `datasource` is 'default'");
    expect(JSON.parse(todo.from)).toEqual({ datasource: (extra as { datasource?: string }).datasource ?? null, external: { remoteName: 'orders' } });
    // The listing and the parse refuse ONE set: the stored row still fails the parse, at the same key.
    expect(externalIssue(item)).toBeDefined();
  });

  it('a stack that declares the named datasource managed is listed by the stack-level half', () => {
    const stack = {
      datasources: [{ name: 'warehouse', driver: 'sqlite', config: {} }],
      objects: [federatedRow({ datasource: 'warehouse' })],
    };
    const { todos } = todosOf(stack);
    const listed = todos.filter((t) => t.conversionId === 'object-external-binding-managed-datasource-refused');
    expect(listed).toHaveLength(1);
    expect(listed[0]!.reason).toContain("declares `external` on datasource 'warehouse', whose `schemaMode` is 'managed'");
  });

  it.each([
    ['a named datasource the row cannot see', federatedRow({ datasource: 'warehouse' })],
    ['an object with no `external`', { ...federatedRow({}), external: undefined }],
  ])('%s is not listed — and the parse accepts it', (_label, row) => {
    expect(storedTodos('object', row).todos).toEqual([]);
    expect(externalIssue(row)).toBeUndefined();
  });

  it('a datasource the stack declares external is not listed', () => {
    const stack = {
      datasources: [{ name: 'warehouse', driver: 'sqlite', config: {}, schemaMode: 'external', external: {} }],
      objects: [federatedRow({ datasource: 'warehouse' })],
    };
    expect(todosOf(stack).todos.filter((t) => t.conversionId === 'object-external-binding-managed-datasource-refused')).toEqual([]);
  });
});

describe('#25279 — a stored object bound `external` to a datasource the caller resolves is judged against it', () => {
  const listed = (todos: ConversionTodoNotice[]) =>
    todos.filter((t) => t.conversionId === 'object-external-binding-managed-datasource-refused');

  it.each([
    ["declared `schemaMode: 'managed'`", { name: 'warehouse', driver: 'sqlite', config: {}, schemaMode: 'managed' }],
    ['declaring no `schemaMode` (managed by the spec default)', { name: 'warehouse', driver: 'sqlite', config: {} }],
  ])('a stored row on a known datasource %s is listed, once, and not rewritten', (_label, datasource) => {
    const row = federatedRow({ datasource: 'warehouse' });
    const { item, todos, notices } = storedTodos('object', row, new Map([['warehouse', datasource]]));
    expect(item).toEqual(row);
    expect(notices).toEqual([]);
    expect(todos).toHaveLength(1);
    const todo = todos[0]!;
    expect(todo.conversionId).toBe('object-external-binding-managed-datasource-refused');
    expect(todo.path).toBe('objects[0].external');
    expect(todo.reason).toContain("Object 'wh_order' declares `external` on datasource 'warehouse', whose `schemaMode` is 'managed'");
    expect(JSON.parse(todo.from)).toEqual({ datasource: 'warehouse', external: { remoteName: 'orders' } });
  });

  it.each([
    ["a federated datasource (`schemaMode: 'external'`)", 'external'],
    ["a `schemaMode: 'validate-only'` datasource", 'validate-only'],
  ])('a stored row on %s is not listed', (_label, schemaMode) => {
    const known = new Map([['warehouse', { name: 'warehouse', schemaMode }]]);
    expect(listed(storedTodos('object', federatedRow({ datasource: 'warehouse' }), known).todos)).toEqual([]);
  });

  it('a known datasource the row does not name gives no verdict', () => {
    const known = new Map([['other', { name: 'other', schemaMode: 'managed' }]]);
    expect(listed(storedTodos('object', federatedRow({ datasource: 'warehouse' }), known).todos)).toEqual([]);
  });

  it('a datasource the stack declares is read before the caller\'s', () => {
    const stack = {
      datasources: [{ name: 'warehouse', driver: 'sqlite', config: {}, schemaMode: 'external', external: {} }],
      objects: [federatedRow({ datasource: 'warehouse' })],
    };
    const todos: ConversionTodoNotice[] = [];
    applyConversions(stack, {
      includeRetired: true,
      onTodo: (t) => todos.push(t),
      knownDatasources: new Map([['warehouse', { schemaMode: 'managed' }]]),
    });
    expect(listed(todos)).toEqual([]);
  });

  it('without an `onTodo` sink nothing reads the known datasources', () => {
    const known = new Map<string, { schemaMode?: unknown }>();
    const get = known.get.bind(known);
    let reads = 0;
    known.get = (name: string) => {
      reads++;
      return get(name);
    };
    applyConversionsToStoredItem('object', federatedRow({ datasource: 'warehouse' }), { knownDatasources: known });
    expect(reads).toBe(0);
  });
});
