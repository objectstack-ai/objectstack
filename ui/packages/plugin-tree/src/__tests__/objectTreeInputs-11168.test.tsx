/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 3 — what `object-tree` PUBLISHES, and what its renderer
 * does with each member of each structured key.
 *
 * `@objectstack/spec` 17.5.0 gave `object-tree` a `ComponentPropsMap` row
 * (`objectName`, `data`, `staticData`, `filter`, `tree`, `navigation`), and the
 * repo-wide parity guard
 * (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`) now loads
 * this plugin, so it judges the registration in both directions. Under
 * objectui#11111 decision 3 = B every key is decided by its own measurement:
 * declare what the renderer honours. This file is that measurement, kept as a
 * pin. Every behavioural row mounts the block the way a page does — through
 * the REAL `SchemaRenderer` and this package's own registration — and asserts
 * on what a user sees, on the query the adapter is handed, or on what a click
 * opened. Every positive row carries its control.
 *
 * What moved on the registration (`object-tree`; it was both tags until
 * objectui#10859 batch 8 retired the `tree` / `view:tree` alias):
 *
 *   - `objectName` is no longer REQUIRED. The record source is one of `data`,
 *     `staticData` and `objectName`; a tree on inline rows never reads it, and
 *     the page validator raised `missing-required-prop` on a tree the spec row
 *     and the renderer both accept.
 *   - `data`, `staticData`, `filter` and `navigation` are declared. The page
 *     validator reported each as `unknown-prop` while the renderer honoured it.
 *
 * The member contract of each structured key is the read site, because the
 * spec cannot supply it: `staticData` is `z.array(z.unknown())`, and the
 * others fix member NAMES and nothing about how a member is used once read.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import {
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { safeValidateSchema } from '@object-ui/types/zod';
// Registers `object-tree` through this package's own entry, at
// module scope (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../index';

// One tag since objectui#10859 batch 8 retired the `tree` alias (the row
// below that the alias is gone is `registration.publicTier-10064.test.tsx`'s).
const TAGS = [
  { type: 'object-tree', namespace: 'plugin-tree' },
] as const;

/**
 * Three records in a two-level hierarchy. `owner` is drawn by no column the
 * rows below configure, only by the record overlay that lists the clicked
 * record's fields — so its text on screen means "the row's record opened".
 */
const ROWS = [
  { id: 'r1', name: 'Acme', parent_id: null, status: 'active', owner: 'Ada Lovelace' },
  { id: 'r2', name: 'Engineering', parent_id: 'r1', status: 'active', owner: 'Grace Hopper' },
  { id: 'r3', name: 'Legacy Ops', parent_id: 'r1', status: 'archived', owner: 'Alan Turing' },
];
const OPENED_RECORD_TEXT = 'Ada Lovelace';
const OBJECT = 'business_unit';
const TREE = { parentField: 'parent_id', labelField: 'name' };

function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, _query?: Record<string, unknown>) => ({
      data: [{ id: 'q1', name: 'Queried root', parent_id: null }],
      total: 1,
    })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: OBJECT,
      // `owner` is declared so the record overlay's typed panel draws it.
      fields: { name: { type: 'text' }, parent_id: { type: 'text' }, owner: { type: 'text', label: 'Owner' } },
    })),
  };
}

const mount = (
  schema: Record<string, unknown>,
  ds = makeDataSource(),
  hostProps: Record<string, unknown> = {},
) => {
  render(
    <SchemaRendererProvider dataSource={ds as never}>
      <SchemaRenderer schema={{ type: 'object-tree', ...schema } as never} {...hostProps} />
    </SchemaRendererProvider>,
  );
  return ds;
};

/** Each drawn row as `label@depth`, read once the tree has left its placeholder. */
async function drawn(): Promise<string[]> {
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
  return screen
    .queryAllByTestId('object-tree-row')
    .map((row) => `${row.querySelector('.truncate')?.textContent ?? ''}@${row.getAttribute('data-depth')}`);
}

/** The header cells, in order. */
const headers = () => [...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim());

/** The diagnostics the page validator raises, over the manifest the registry publishes. */
const diagnose = (node: Record<string, unknown>) =>
  validateTree(
    node as never,
    manifestFromConfigs(
      ComponentRegistry.getKnownTypes().map((type) => {
        const meta = ComponentRegistry.getMeta(type);
        return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
      }) as unknown as Parameters<typeof manifestFromConfigs>[0],
    ),
  ).diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.message]);

const inputsOf = (type: string, namespace: string) =>
  new Map(
    (((ComponentRegistry.getConfig(type, namespace) as { inputs?: Array<Record<string, unknown>> } | undefined)
      ?.inputs) ?? []).map((input) => [input.name as string, input]),
  );

const specRow = (ComponentPropsMap as unknown as Record<string, { safeParse: (v: unknown) => { success: boolean } }>)[
  'object-tree'
];

beforeEach(() => {
  // Best-effort metadata probes are not what these rows are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
  // A drag-resized width persisted in localStorage would mask every width row.
  try { window.localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── The registration ────────────────────────────────────────────────────────

describe('object-tree publishes the keys its renderer honours (objectui#11168)', () => {
  it.each(TAGS)('$type — declares the record source, `filter` and `navigation`, with the spec row\'s kinds', ({ type, namespace }) => {
    const inputs = inputsOf(type, namespace);
    expect([...inputs.keys()].sort()).toEqual(
      ['data', 'filter', 'navigation', 'objectName', 'staticData', 'tree'],
    );
    expect(inputs.get('objectName')?.required).toBeUndefined();
    expect(inputs.get('data')?.type).toBe('object');
    expect(inputs.get('staticData')?.type).toBe('array');
    expect(inputs.get('filter')?.type).toBe('array');
    expect(inputs.get('navigation')?.type).toBe('object');
    expect(inputs.get('tree')?.type).toBe('object');
  });

  it.each(TAGS)('$type — the page validator accepts a tree on inline rows alone, and on a `data` configuration alone', ({ type }) => {
    // Before this slice: `missing-required-prop` on `objectName` (an error)
    // and `unknown-prop` on `staticData`, for a tree that draws.
    expect(diagnose({ type, tree: TREE, staticData: ROWS })).toEqual([]);
    expect(diagnose({ type, tree: TREE, data: { provider: 'value', items: ROWS } })).toEqual([]);
    expect(
      diagnose({
        type,
        objectName: OBJECT,
        filter: [{ field: 'status', operator: 'equals', value: 'active' }],
        navigation: { mode: 'drawer' },
      }),
    ).toEqual([]);
  });

  it.each(TAGS)('$type — CONTROL: a bogus key is still reported', ({ type }) => {
    expect(diagnose({ type, objectName: OBJECT, bogusProp: 1 })).toEqual([
      ['unknown-prop', `<${type}> has no prop "bogusProp"`],
    ]);
  });

  it('the installed spec row accepts every shape the rows below author', () => {
    expect(specRow.safeParse({ tree: TREE, staticData: ROWS }).success).toBe(true);
    expect(specRow.safeParse({ data: { provider: 'value', items: ROWS } }).success).toBe(true);
    expect(
      specRow.safeParse({
        objectName: OBJECT,
        filter: [{ field: 'status', operator: 'equals', value: 'active' }],
        navigation: { mode: 'drawer', size: 'lg' },
      }).success,
    ).toBe(true);
    // CONTROL: the row is not accepting everything.
    expect(specRow.safeParse({ objectName: OBJECT, bogusProp: 1 }).success).toBe(false);
  });
});

// ── The authoring door ─────────────────────────────────────────────────────

/** The tolerant face's issues for one node (`safeValidateSchema`), as `{ code, path }`. */
const authoringIssues = (node: Record<string, unknown>) => {
  const result = safeValidateSchema({ type: 'object-tree', ...node });
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        ...((issue as { params?: { code?: string } }).params?.code
          ? { params: (issue as { params?: { code?: string } }).params!.code }
          : {}),
      }));
};

describe('the tolerant authoring face — `ObjectTreeSchema` (objectui#11168)', () => {
  it('accepts a tree on inline rows alone, on a `data` configuration alone, and with `tree` + `navigation`', () => {
    // Before this slice the first two were refused: `invalid_type` at
    // `objectName`, on trees that draw (the rows above).
    expect(authoringIssues({ tree: TREE, staticData: ROWS })).toEqual([]);
    expect(authoringIssues({ tree: TREE, data: { provider: 'value', items: ROWS } })).toEqual([]);
    expect(authoringIssues({ objectName: OBJECT, tree: TREE, navigation: { mode: 'drawer', size: 'lg' } })).toEqual([]);
  });

  it('refuses a tree with NO record source, once, at the root — the rule the required member used to carry', () => {
    expect(authoringIssues({ tree: TREE })).toEqual([
      { code: 'custom', path: '', params: 'RECORD_SOURCE_REQUIRED' },
    ]);
  });

  it('the node\'s `dataSource` binding is NOT a rung here — the registration is not gate-wrapped, so it lands nowhere', () => {
    expect(authoringIssues({ tree: TREE, dataSource: { object: OBJECT } })).toEqual([
      { code: 'custom', path: '', params: 'RECORD_SOURCE_REQUIRED' },
    ]);
  });

  it('refuses a value the spec\'s blocks refuse, by reference: a misspelled `tree` member and an unknown `mode`', () => {
    expect(authoringIssues({ objectName: OBJECT, tree: { parentFeild: 'parent_id' } }).map((i) => i.path)).toEqual(['tree']);
    expect(authoringIssues({ objectName: OBJECT, navigation: { mode: 'sideways' } }).map((i) => i.path)).toEqual(['navigation.mode']);
  });
});

// ── tree ────────────────────────────────────────────────────────────────────

describe('`object-tree.tree` — the members are field names the tree draws by (objectui#11168)', () => {
  it('`parentField` names the field whose value is the parent id: a child nests one level under it', async () => {
    mount({ tree: TREE, staticData: ROWS });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1']);
  });

  it('CONTROL: naming a field that holds no parent id leaves every record a root', async () => {
    mount({ tree: { ...TREE, parentField: 'status' }, staticData: ROWS });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@0', 'Legacy Ops@0']);
  });

  it('`labelField` names the field drawn in the first column, and an absent one reads `name`', async () => {
    mount({ tree: { ...TREE, labelField: 'owner' }, staticData: ROWS });
    expect(await drawn()).toEqual(['Ada Lovelace@0', 'Grace Hopper@1', 'Alan Turing@1']);
    cleanup();
    mount({ tree: { parentField: 'parent_id' }, staticData: ROWS });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1']);
  });

  it('`fields` adds one flat column per member, after the label column', async () => {
    mount({ tree: { ...TREE, fields: ['status'] }, staticData: ROWS });
    await drawn();
    expect(headers()).toEqual(['Name', 'Status']);
    expect(screen.getAllByText('archived')).toHaveLength(1);
    cleanup();
    // CONTROL: without it there is the label column alone.
    mount({ tree: TREE, staticData: ROWS });
    await drawn();
    expect(headers()).toEqual(['Name']);
    expect(screen.queryByText('archived')).toBeNull();
  });

  it('`defaultExpandedDepth: 0` opens roots only; absent, every level is open', async () => {
    mount({ tree: { ...TREE, defaultExpandedDepth: 0 }, staticData: ROWS });
    expect(await drawn()).toEqual(['Acme@0']);
    cleanup();
    mount({ tree: TREE, staticData: ROWS });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1']);
  });

  it('measured, not endorsed: a FLAT key of the same name on the node outranks the member', async () => {
    // `getTreeConfig` reads `schema.parentField ?? tree.parentField`, member by
    // member. The flat keys are the runtime handoff a host composes; the spec
    // row refuses them, and the registration does not publish them.
    mount({ tree: { ...TREE, parentField: 'status' }, parentField: 'parent_id', staticData: ROWS });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1']);
  });
});

// ── data / staticData ───────────────────────────────────────────────────────

describe('`object-tree.data` — the members are the `{ provider, … }` configurations (objectui#11168)', () => {
  it('`{ provider: "value", items }` draws those records and queries nothing', async () => {
    const ds = mount({ tree: TREE, data: { provider: 'value', items: ROWS } });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1']);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('`{ provider: "object", object }` queries THAT object, and draws what it returns', async () => {
    const ds = mount({ tree: TREE, data: { provider: 'object', object: OBJECT } });
    expect(await drawn()).toEqual(['Queried root@0']);
    expect(ds.find).toHaveBeenCalledWith(OBJECT, expect.anything());
  });

  it.each([
    ['schema', { provider: 'schema', schemaId: 'units' }],
  ])('`{ provider: "%s" }` draws nothing and queries nothing — the tree reads it not', async (_label, data) => {
    expect(specRow.safeParse({ data }).success, 'the spec row accepts the configuration').toBe(true);
    const ds = mount({ tree: TREE, data });
    expect(await drawn()).toEqual([]);
    expect(screen.getByText('No records')).toBeInTheDocument();
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('`{ provider: "api" }` is refused by the spec row, and a stored one still draws nothing and queries nothing', async () => {
    // @objectstack/spec 18.0.0-next.1 retires the view-level `api` provider
    // (objectstack#23160), so authoring it is refused (objectui#12370); a
    // document stored before still reaches the renderer, which reads it not.
    const data = { provider: 'api', read: { url: '/api/units' } };
    expect(specRow.safeParse({ data }).success, 'the spec row refuses the retired provider').toBe(false);
    const ds = mount({ tree: TREE, data });
    expect(await drawn()).toEqual([]);
    expect(screen.getByText('No records')).toBeInTheDocument();
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('it is read FIRST: a `data` configuration wins over `staticData` and over `objectName`', async () => {
    const ds = mount({
      tree: TREE,
      objectName: OBJECT,
      staticData: [{ id: 's1', name: 'Static root', parent_id: null }],
      data: { provider: 'value', items: ROWS },
    });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1']);
    expect(ds.find).not.toHaveBeenCalled();
  });
});

describe('`object-tree.staticData` — the members are RECORDS (objectui#11168)', () => {
  it('each record is placed under the record its parent-id value names, and one naming no record is a root', async () => {
    mount({
      tree: TREE,
      staticData: [...ROWS, { id: 'r4', name: 'Orphan', parent_id: 'missing' }],
    });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1', 'Orphan@0']);
  });

  it('it is read SECOND, above `objectName`: a tree carrying both draws these rows and never queries the object', async () => {
    const ds = mount({ tree: TREE, objectName: OBJECT, staticData: ROWS });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1']);
    expect(ds.find).not.toHaveBeenCalled();
    cleanup();
    // CONTROL: the same node without the inline rows queries the object, so
    // "never queries" above is not a harness that cannot query.
    const live = mount({ tree: TREE, objectName: OBJECT });
    expect(await drawn()).toEqual(['Queried root@0']);
    expect(live.find).toHaveBeenCalledWith(OBJECT, expect.anything());
  });
});

// ── filter ──────────────────────────────────────────────────────────────────

describe('`object-tree.filter` — the members are `{ field, operator, value }` rules (objectui#11168)', () => {
  const ACTIVE = [{ field: 'status', operator: 'equals', value: 'active' }];

  it('a rule narrows the inline records the tree draws', async () => {
    mount({ tree: TREE, staticData: ROWS, filter: ACTIVE });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1']);
  });

  it('`operator` is read: `not_equals` draws the complement', async () => {
    mount({ tree: TREE, staticData: ROWS, filter: [{ ...ACTIVE[0], operator: 'not_equals' }] });
    expect(await drawn()).toEqual(['Legacy Ops@0']);
  });

  it('a record whose parent the filter removed is drawn as a root, not dropped', async () => {
    // `Legacy Ops` above is the same reading: its parent `Acme` is filtered out.
    mount({ tree: TREE, staticData: ROWS, filter: [{ field: 'name', operator: 'equals', value: 'Engineering' }] });
    expect(await drawn()).toEqual(['Engineering@0']);
  });

  it('on the object query the rule reaches `$filter` with its members unchanged', async () => {
    const ds = mount({ tree: TREE, objectName: OBJECT, filter: ACTIVE });
    await drawn();
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(ds.find.mock.calls[0][1]?.$filter).toEqual(ACTIVE);
  });

  it('CONTROL: with no `filter` the query carries no `$filter` and the inline rows are all drawn', async () => {
    const ds = mount({ tree: TREE, objectName: OBJECT });
    await drawn();
    expect(ds.find.mock.calls[0][1]?.$filter).toBeUndefined();
    cleanup();
    mount({ tree: TREE, staticData: ROWS });
    expect(await drawn()).toEqual(['Acme@0', 'Engineering@1', 'Legacy Ops@1']);
  });
});

// ── navigation ──────────────────────────────────────────────────────────────

/** Mount one tree with an authored `navigation` (or none), click its root row, and hand back the `window.open` spy. */
async function clickRoot(navigation: Record<string, unknown> | undefined, hostProps: Record<string, unknown> = {}) {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  // `staticData` with `objectName` beside it: the inline rows are drawn and no
  // query is issued, while the object still names the record page a new tab
  // opens.
  mount({ tree: TREE, objectName: OBJECT, staticData: ROWS, ...(navigation ? { navigation } : {}) }, makeDataSource(), hostProps);
  await drawn();
  fireEvent.click(screen.getAllByTestId('object-tree-row')[0]);
  return { open };
}

/** Give a click every chance to have done something before asserting it did not. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const openedRecord = () => screen.queryByText(OPENED_RECORD_TEXT);

async function expectNothingOpened(open: ReturnType<typeof vi.fn>, why: string) {
  await settle();
  expect(dialog(), `${why}: an overlay opened`).toBeNull();
  expect(openedRecord(), `${why}: the record was drawn`).toBeNull();
  expect(open, `${why}: a tab was opened`).not.toHaveBeenCalled();
}

/** The resolved overlay width, read off the `--ov-w` custom property the shared shell publishes. */
function panelWidth(): string {
  const panel = dialog();
  expect(panel, 'overlay panel').not.toBeNull();
  return panel!.style.getPropertyValue('--ov-w').trim();
}

describe('`object-tree.navigation` — the members decide what a row click opens (objectui#11168)', () => {
  it('LIT CONTROL: `mode: "drawer"` opens the row\'s record in a drawer', async () => {
    const { open } = await clickRoot({ mode: 'drawer' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openedRecord()).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['modal', 'popover'] as const)('`mode: "%s"` opens the row\'s record in that overlay', async (mode) => {
    const { open } = await clickRoot({ mode });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openedRecord()).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('`mode: "split"` opens the record BESIDE the tree, which stays drawn', async () => {
    // Unlike the timeline, the tree hands the split shell its own view as the
    // main panel (objectui#9299 item 2).
    const { open } = await clickRoot({ mode: 'split' });
    await waitFor(() => expect(openedRecord()).not.toBeNull());
    expect(screen.getAllByTestId('object-tree-row').length).toBeGreaterThan(0);
    expect(open).not.toHaveBeenCalled();
  });

  it('`mode: "none"` opens nothing', async () => {
    const { open } = await clickRoot({ mode: 'none' });
    await expectNothingOpened(open, 'none');
  });

  it('`preventNavigation: true` OUTRANKS an overlay mode', async () => {
    const { open } = await clickRoot({ mode: 'drawer', preventNavigation: true });
    await expectNothingOpened(open, 'preventNavigation');
  });

  it('`mode: "new_window"` opens the record page of the node\'s object in a new tab, and no overlay', async () => {
    const { open } = await clickRoot({ mode: 'new_window' });
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith(`/${OBJECT}/record/r1`, '_blank');
    expect(dialog()).toBeNull();
  });

  it('`openNewTab: true` OUTRANKS `page` and an overlay mode', async () => {
    const page = await clickRoot({ mode: 'page', openNewTab: true });
    await waitFor(() => expect(page.open).toHaveBeenCalledWith(`/${OBJECT}/record/r1`, '_blank'));
    cleanup();
    const drawer = await clickRoot({ mode: 'drawer', openNewTab: true });
    await waitFor(() => expect(drawer.open).toHaveBeenCalledTimes(1));
    expect(dialog()).toBeNull();
  });

  it('…but NOT `none`: `none` is read first, like `preventNavigation`', async () => {
    const { open } = await clickRoot({ mode: 'none', openNewTab: true });
    await expectNothingOpened(open, 'none beside openNewTab');
  });

  it('`size` and `width` are one width decision: `width` wins, a bucket resolves, `auto` lands on the default', async () => {
    await clickRoot({ mode: 'drawer' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    const unsized = panelWidth();
    cleanup();
    await clickRoot({ mode: 'drawer', size: 'lg' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    const large = panelWidth();
    expect(large).not.toBe(unsized);
    cleanup();
    await clickRoot({ mode: 'drawer', size: 'sm', width: '720px' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toContain('720px');
    cleanup();
    await clickRoot({ mode: 'drawer', size: 'auto' });
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(panelWidth()).toBe(unsized);
  });

  it('a parent view\'s click handler OUTRANKS the whole key, overlay mode included', async () => {
    const onRowClick = vi.fn();
    const { open } = await clickRoot({ mode: 'drawer' }, { onRowClick });
    await waitFor(() => expect(onRowClick).toHaveBeenCalledTimes(1));
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'r1' });
    await expectNothingOpened(open, 'parent handler');
  });

  it('with the key ABSENT a click opens nothing — this renderer supplies no drawer default', async () => {
    const { open } = await clickRoot(undefined);
    await expectNothingOpened(open, 'absent key');
  });

  it('with NO host navigator, `mode: "page"` and a block without `mode` have no record page to open, and open nothing', async () => {
    const page = await clickRoot({ mode: 'page' });
    await expectNothingOpened(page.open, 'page');
    cleanup();
    // `size` alone, written to widen an overlay: the absent `mode` reads `page`.
    const modeless = await clickRoot({ size: 'lg' });
    await expectNothingOpened(modeless.open, 'mode-less block');
  });
});

/**
 * A host that publishes its record navigator the way the console does on its
 * custom pages, record pages and list views (`RelatedRecordActionsContext`):
 * `openRecord` is the spy a `page` click must reach. The same host the
 * board's and the calendar's `NavigationMembers-8652` pins mount.
 */
function recordNavigatorHost() {
  const openRecord = vi.fn();
  const value: RelatedRecordActionsValue = {
    resolve: () => ({}),
    recordHref: (objectName, recordId) => `/apps/demo/${objectName}/record/${recordId}`,
    openRecord,
  };
  return { value, openRecord };
}

/** `clickRoot`, with the tree mounted through the real `SchemaRenderer` UNDER that host. */
async function clickRootUnderHost(
  navigation: Record<string, unknown> | undefined,
  host: RelatedRecordActionsValue,
  { namesObject = true } = {},
) {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  render(
    <RelatedRecordActionsProvider value={host}>
      <SchemaRendererProvider dataSource={makeDataSource() as never}>
        <SchemaRenderer
          schema={{
            type: 'object-tree',
            tree: TREE,
            ...(namesObject ? { objectName: OBJECT } : {}),
            staticData: ROWS,
            ...(navigation ? { navigation } : {}),
          } as never}
        />
      </SchemaRendererProvider>
    </RelatedRecordActionsProvider>,
  );
  await drawn();
  fireEvent.click(screen.getAllByTestId('object-tree-row')[0]);
  return { open };
}

describe('`object-tree.navigation` `page` under the host\'s record navigator (objectui#11168, objectui#11293)', () => {
  it('LIT CONTROL: under the same host, `mode: "drawer"` opens the drawer and does not navigate', async () => {
    // First, because the rows below would be vacuous against a tree whose rows
    // are not clickable under this host.
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickRootUnderHost({ mode: 'drawer' }, value);
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(openRecord).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('`mode: "page"` opens the record page of the tree\'s object through the host, and no overlay', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickRootUnderHost({ mode: 'page' }, value);
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord).toHaveBeenCalledWith(OBJECT, 'r1');
    expect(dialog()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('a block WITHOUT `mode` resolves to `page`, and navigates the same way', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickRootUnderHost({ size: 'lg' }, value);
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord).toHaveBeenCalledWith(OBJECT, 'r1');
    expect(dialog()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['the key ABSENT', undefined],
    ['`mode: "none"`', { mode: 'none' }],
  ] as const)('%s still opens nothing under the host, and does not navigate', async (why, navigation) => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickRootUnderHost(navigation, value);
    await expectNothingOpened(open, String(why));
    expect(openRecord).not.toHaveBeenCalled();
  });

  it('a tree that names no object at all (inline rows, no `objectName`) has no record page to open, even under the host', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickRootUnderHost({ mode: 'page' }, value, { namesObject: false });
    await expectNothingOpened(open, 'page without objectName');
    expect(openRecord).not.toHaveBeenCalled();
  });
});

/**
 * Which object `page` opens is the object the ROWS came from: the tree hands
 * the hook `resolveRecordSourceObjectName(schema, data) ?? objectName`, which
 * reads `data.object` when `data` is the object provider and the node's
 * `objectName` otherwise. These rows mount the `object-tree.data` rows' own
 * object-provider shape under the same host.
 */
async function clickQueriedRootUnderHost(schema: Record<string, unknown>, host: RelatedRecordActionsValue) {
  const open = vi.fn();
  vi.stubGlobal('open', open);
  const ds = makeDataSource();
  render(
    <RelatedRecordActionsProvider value={host}>
      <SchemaRendererProvider dataSource={ds as never}>
        <SchemaRenderer schema={{ type: 'object-tree', tree: TREE, ...schema } as never} />
      </SchemaRendererProvider>
    </RelatedRecordActionsProvider>,
  );
  expect(await drawn()).toEqual(['Queried root@0']);
  fireEvent.click(screen.getAllByTestId('object-tree-row')[0]);
  return { open, ds };
}

describe('`object-tree.navigation` `page` opens the record page of the object the rows came from (objectui#11168)', () => {
  it('`data: { provider: "object", object }` with NO `objectName`: `page` opens THAT object\'s record page', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { open } = await clickQueriedRootUnderHost(
      { data: { provider: 'object', object: OBJECT }, navigation: { mode: 'page' } },
      value,
    );
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord).toHaveBeenCalledWith(OBJECT, 'q1');
    expect(dialog()).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('both written: `data.object` wins over `objectName` — the rows\' object opens, and is the one queried', async () => {
    const { value, openRecord } = recordNavigatorHost();
    const { ds } = await clickQueriedRootUnderHost(
      { objectName: 'org_chart', data: { provider: 'object', object: OBJECT }, navigation: { mode: 'page' } },
      value,
    );
    await waitFor(() => expect(openRecord).toHaveBeenCalledTimes(1));
    expect(openRecord).toHaveBeenCalledWith(OBJECT, 'q1');
    expect(ds.find).toHaveBeenCalledWith(OBJECT, expect.anything());
    expect(ds.find).not.toHaveBeenCalledWith('org_chart', expect.anything());
  });
});
