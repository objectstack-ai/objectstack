/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectView's shared harness: the per-issue pins that render the real
 * `ObjectView` over stand-in child renderers, folded into one file
 * (objectstack#29469, the rollout of objectstack#25911's pilot).
 *
 * Each block below was its own file, named in its `describe`, with the same
 * three mocks: `@object-ui/react` with `SchemaRenderer` replaced, a fresh
 * `SchemaRendererContext` and the data-change bus (`subscribeDataChanges`,
 * `notifyDataChanged`) turned into no-ops; `@object-ui/plugin-grid` with
 * `ObjectGrid` replaced; and `@object-ui/plugin-form` with `ObjectForm`
 * replaced. Only the three stand-ins differed, in what they record and draw.
 * Under the `dom` project's `isolate: true`, each of those files paid the
 * whole module graph's import again, and the import was nearly all of a file's
 * time. Here the graph loads once, and each block installs its own three
 * stand-ins in a `beforeEach`, through the `standIns` slots the mocks read.
 * Every block keeps its fixtures, hooks and assertions as they were, and its
 * issue number in its `describe`.
 *
 * Isolation between blocks:
 *  - React Testing Library's `cleanup()` runs after every test (the `dom`
 *    setup registers it).
 *  - Every fixture, data source, call log and record array a stand-in pushes
 *    to is declared inside its block, so no block reads another's.
 *  - A mock whose slot the running block left empty throws, naming the slot,
 *    rather than drawing an earlier block's stand-in.
 *  - Every block's first line is `restoreAfterBlock()` (below). A former file
 *    got a fresh window and a fresh registry; a block shares both with the
 *    blocks after it, so after its last test the helper puts back what the
 *    block left: registry entries, a swapped-in `localStorage`, the contents
 *    of both storages, the `lang` / `dir` that `I18nProvider` sets on
 *    `<html>`, and the three slots.
 *  - react-i18next's global instance, which a mounted `I18nProvider`
 *    installs, is put back after every test by `vitest.setup.i18n-global.ts`,
 *    so a block that mounts no provider still renders with none.
 *
 * A new `ObjectView` pin that renders over these three mocks joins this file
 * as its own top-level `describe` that opens with `restoreAfterBlock()` and
 * installs its three stand-ins the same way.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, waitFor, act, cleanup, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ListViewSchema as SpecListViewSchema } from '@objectstack/spec/ui';
import { ComponentRegistry, normalizeListViewSchema, convertSortToQueryParams } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import type { DataSource, DataSourceMutationEvent, ObjectViewSchema } from '@object-ui/types';
import { safeValidateSchema } from '@object-ui/types/zod';
import { ObjectView } from '../ObjectView';

/**
 * The stand-ins the running block installed; the three mocks below render them.
 * Typed `(props: never)` so a block's stand-in keeps its own props annotation.
 */
const standIns = vi.hoisted(() => {
  const slots = {
    schemaRenderer: null as null | ((props: never) => unknown),
    objectGrid: null as null | ((props: never) => unknown),
    objectForm: null as null | ((props: never) => unknown),
  };
  return slots;
});

const fromSlot = vi.hoisted(() => (slot: 'schemaRenderer' | 'objectGrid' | 'objectForm', props: unknown) => {
  const standIn = standIns[slot];
  if (!standIn) {
    throw new Error(`ObjectView.harness: the running block installed no \`${slot}\` stand-in in its beforeEach.`);
  }
  return standIn(props as never);
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const ReactMod = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: (props: Record<string, unknown>) => fromSlot('schemaRenderer', props),
    SchemaRendererContext: ReactMod.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: (props: Record<string, unknown>) => fromSlot('objectGrid', props),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: (props: Record<string, unknown>) => fromSlot('objectForm', props),
}));

/**
 * Puts back, after the calling block's last test, what the block's hooks and
 * tests left behind, so the next block starts from the state its former file
 * started from: registry entries, a swapped-in `localStorage`, both storages'
 * contents, `<html lang>` / `dir`, and the three stand-in slots. Measured
 * before this existed: the `ObjectView.formLabelsI18nLabel-10993` block left
 * `lang="zh"` and `dir="ltr"` on `<html>` for every block after it, and every
 * block after the first started with the previous block's stand-ins
 * installed. No block here registers a renderer or swaps `localStorage`; the
 * helper puts those back too, as `ListView.harness.test.tsx`'s does, for the
 * next block that does.
 *
 * Declared first in the block, so its `beforeAll` runs before the block's own
 * and its `afterAll` after them (Vitest runs after-hooks in reverse order).
 */
function restoreAfterBlock() {
  let registered = new Map<string, ReturnType<typeof ComponentRegistry.getConfig>>();
  let storage: PropertyDescriptor | undefined;
  beforeAll(() => {
    registered = new Map(ComponentRegistry.getAllTypes().map((type) => [type, ComponentRegistry.getConfig(type)]));
    storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
  });
  afterAll(() => {
    for (const type of ComponentRegistry.getAllTypes()) {
      if (!registered.has(type)) ComponentRegistry.unregister(type);
    }
    // Re-register each changed entry's own config; a bare key that falls back to
    // a namespaced one comes back with it.
    const restored = new Set<unknown>();
    for (const [type, config] of registered) {
      if (!config || ComponentRegistry.getConfig(type) === config || restored.has(config)) continue;
      restored.add(config);
      const { type: fullType, component, ...meta } = config;
      ComponentRegistry.register(meta.namespace ? fullType.slice(meta.namespace.length + 1) : fullType, component, meta);
    }
    if (storage) Object.defineProperty(window, 'localStorage', storage);
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
    standIns.schemaRenderer = null;
    standIns.objectGrid = null;
    standIns.objectForm = null;
  });
}

// ── ObjectView.calendarInitialDate-28102 ───────────────────────────────────

/**
 * objectstack#28102 — `ObjectView`'s `generateViewSchema` hands a view's
 * `calendar.initialDate` on inside the node's `calendar` block, the one place
 * `ObjectCalendar` reads the date it opens on from. The branch forwards the
 * block's keys by name, so a key it does not name never reaches the renderer.
 */
describe('ObjectView.calendarInitialDate-28102', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    };
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  /** Every schema the view hands to SchemaRenderer, in order. */
  const rendered: any[] = [];

  async function renderCalendarView(view: Record<string, unknown>) {
    rendered.length = 0;
    const ds: any = {
      find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'renewal', fields: {} }),
    };
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'renewal' } as ObjectViewSchema}
        views={[{ id: 'c', label: 'Calendar', type: 'calendar' as any, ...view }]}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    return rendered[rendered.length - 1];
  }

  describe('ObjectView.generateViewSchema — calendar.initialDate reaches the node (objectstack#28102)', () => {
    it.each(['next_record', 'first_record', '{next_month_start}'])('forwards `initialDate: %s` inside the calendar block', async (initialDate) => {
      const schema = await renderCalendarView({ calendar: { startDateField: 'renewal_date', initialDate } });
      expect(schema.type).toBe('object-calendar');
      expect(schema.calendar).toEqual({ startDateField: 'renewal_date', initialDate });
      expect(schema).not.toHaveProperty('initialDate');
    });

    it('CONTROL: a block without the key carries none', async () => {
      const schema = await renderCalendarView({ calendar: { startDateField: 'renewal_date' } });
      expect(schema.calendar).toEqual({ startDateField: 'renewal_date' });
    });
  });
});

// ── ObjectView.tableSortKey-10664 ──────────────────────────────────────────

/**
 * objectui#10664 (the census row for `object-view`) — the non-grid fetch
 * re-reads when `table.sort` changes, and only then.
 *
 * The effect lowers `currentNamedViewConfig?.sort || activeViewQueryInputs?.sort
 * || schema.table?.sort` onto `$orderby`. The first two sources are in its
 * dependency list; the third was not. A mounted calendar / kanban view whose
 * `table.sort` changed (and whose named view and active view declare none) kept
 * the old order until something else re-ran the read. It is now keyed by
 * CONTENT, so an equal sort in a fresh array is not a change (AGENTS.md #10).
 *
 * The CONTROL (an equal sort in a fresh array) is green before and after; it
 * goes red for a fix that keys on the array's identity.
 */
describe('ObjectView.tableSortKey-10664', () => {
  restoreAfterBlock();

  // The same seams `ObjectView.sortSink.test.tsx` stubs: the child renderers are
  // not what these cases read, only the query this component issues itself.
  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>;
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  afterEach(cleanup);

  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

  const BY_NAME_ASC = [{ field: 'name', order: 'asc' }];
  const BY_NAME_DESC = [{ field: 'name', order: 'desc' }];

  const mockDataSource = () => ({
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
  });

  const schemaFor = (sort: unknown) =>
    ({ type: 'object-view', objectName: 'task', defaultViewType: 'calendar', table: { sort } }) as unknown as ObjectViewSchema;

  function mount() {
    const ds = mockDataSource();
    const view = render(<ObjectView schema={schemaFor(BY_NAME_ASC)} dataSource={ds as any} />);
    const rerender = (sort: unknown) => view.rerender(<ObjectView schema={schemaFor(sort)} dataSource={ds as any} />);
    return { ds, rerender };
  }

  const orderbys = (ds: ReturnType<typeof mockDataSource>) => ds.find.mock.calls.map((c: any[]) => c[1]?.$orderby);

  describe('object-view keys its non-grid read on the table sort it sends (objectui#10664)', () => {
    it('SUBJECT: a changed `table.sort` re-reads, with the new `$orderby`', async () => {
      const { ds, rerender } = mount();
      await waitFor(() => expect(ds.find).toHaveBeenCalled());
      await settle();
      expect(orderbys(ds)).toEqual([{ name: 'asc' }]);

      await act(async () => { rerender(BY_NAME_DESC); });
      await settle();

      expect(orderbys(ds), 'the changed sort never reached a read').toEqual([{ name: 'asc' }, { name: 'desc' }]);
    });

    it('CONTROL: an equal `table.sort` in a fresh array does not re-read', async () => {
      const { ds, rerender } = mount();
      await waitFor(() => expect(ds.find).toHaveBeenCalled());
      await settle();
      const atRest = ds.find.mock.calls.length;

      await act(async () => { rerender([{ field: 'name', order: 'asc' }]); });
      await settle();

      expect(ds.find.mock.calls.length, 'an equal sort re-read the view').toBe(atRest);
    });
  });
});

// ── ObjectView.kanbanDeclaredLanes-28211 ───────────────────────────────────

/**
 * objectstack#28211 — `generateViewSchema`'s kanban branch hands the block's
 * `lanes` to the board as the `object-kanban` node's `columns`, in the
 * author's order and titled by the lane field's option labels, through
 * `kanbanDeclaredLanes` (`@object-ui/core`), the mapping `ListView`'s twin
 * makes. A block without `lanes` emits no `columns`, so the board keeps one
 * lane per option.
 */
describe('ObjectView.kanbanDeclaredLanes-28211', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    };
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  /** Every schema the view hands to SchemaRenderer, in order. */
  const rendered: any[] = [];

  const FIELDS = {
    status: {
      name: 'status',
      type: 'select',
      label: 'Status',
      options: [
        { value: 'not_started', label: 'Not Started' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled', kind: 'lost' },
      ],
    },
  };

  const dataSource = (): any => ({
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: FIELDS }),
  });

  /** The last `object-kanban` node, once `accept` holds for it. */
  async function kanbanNode(kanban: Record<string, unknown>, accept: (node: any) => boolean): Promise<any> {
    cleanup();
    rendered.length = 0;
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task' } as unknown as ObjectViewSchema}
        views={[{ id: 'k', label: 'Board', type: 'kanban' as any, kanban }] as any}
        dataSource={dataSource()}
      />,
    );
    await waitFor(() => {
      const node = rendered[rendered.length - 1];
      expect(node?.type).toBe('object-kanban');
      expect(accept(node)).toBe(true);
    });
    return rendered[rendered.length - 1];
  }

  beforeEach(() => {
    rendered.length = 0;
  });

  describe('objectstack#28211 — the generated board draws the declared lanes', () => {
    it('emits `kanban.lanes` as the node\'s `columns`, in order, titled by option label', async () => {
      const node = await kanbanNode(
        { groupByField: 'status', lanes: ['in_progress', 'not_started', 'cancelled'] },
        (n) => n.columns?.[0]?.title === 'In Progress',
      );
      expect(node.groupBy).toBe('status');
      expect(node.columns).toEqual([
        { id: 'in_progress', title: 'In Progress' },
        { id: 'not_started', title: 'Not Started' },
        { id: 'cancelled', title: 'Cancelled', collapsed: true },
      ]);
    });

    it('CONTROL: a block without `lanes` emits no `columns`', async () => {
      const node = await kanbanNode({ groupByField: 'status' }, () => true);
      expect(Object.prototype.hasOwnProperty.call(node, 'columns')).toBe(false);
    });
  });
});

// ── ObjectView.namedViewEditInlineFold-5144 ────────────────────────────────

/**
 * objectui#5144 — on a host's `renderListView`, the named view's `inlineEdit`
 * outranks the host's, for whether inline editing is offered too.
 *
 * `normalizeListViewSchema` folds a view's `inlineEdit` into
 * `userActions.editInline`, and `ListView` withholds inline editing where that
 * reads `false` (an absent key reads on, objectui#12086). The relay that builds
 * the `list-view` node merges `userActions` across three layers: the node, the
 * host's `views` entry, and the named view, most specific last. It folded the first two and spread the
 * named view's raw. So once the fold existed, a host-layer `inlineEdit` became
 * a folded `editInline` that outranked the named view's own `inlineEdit`, the
 * inverse of the named-first `inlineEdit` rung on the same node. The seat's
 * decision on the card folds the named layer like the other two.
 *
 * Each case reads what `ListView` reads: the node handed to `renderListView`,
 * through the fold.
 */
describe('ObjectView.namedViewEditInlineFold-5144', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = () => null;
    standIns.objectGrid = () => null;
    standIns.objectForm = () => null;
  });

  const dataSource = (): any => ({
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
  });

  type Layer = Record<string, unknown>;

  /**
   * The `editInline` and `inlineEdit` `ListView` reads off the node a host
   * receives, for a named view and a host `views` entry.
   */
  function read(named: Layer, host: Layer | null): { editInline: unknown; inlineEdit: unknown } {
    const seen: Record<string, unknown>[] = [];
    render(
      <ObjectView
        schema={{
          type: 'object-view',
          objectName: 'task',
          listViews: { v1: { label: 'Open work', type: 'grid', columns: ['subject'], ...named } },
        } as unknown as ObjectViewSchema}
        views={host ? [{ id: 'h', label: 'Host', type: 'grid' as const, ...host }] : undefined}
        dataSource={dataSource()}
        renderListView={({ schema }: { schema: Record<string, unknown> }) => {
          seen.push(schema);
          return <div data-testid="delegated" />;
        }}
      />,
    );
    expect(seen.length).toBeGreaterThan(0);
    // The named view was selected: its label is on the node.
    expect(seen[0].label).toBe('Open work');
    const node = normalizeListViewSchema(seen[0]) as { userActions?: Layer; inlineEdit?: unknown };
    return { editInline: node.userActions?.editInline, inlineEdit: node.inlineEdit };
  }

  beforeEach(() => {
    cleanup();
  });

  describe('objectui#5144 — the named view`s inlineEdit outranks the host`s on renderListView', () => {
    it('named `inlineEdit: true` over host `inlineEdit: false` reads offered', () => {
      expect(read({ inlineEdit: true }, { inlineEdit: false })).toEqual({ editInline: true, inlineEdit: true });
    });

    it('named `inlineEdit: false` over host `inlineEdit: true` reads off', () => {
      expect(read({ inlineEdit: false }, { inlineEdit: true })).toEqual({ editInline: false, inlineEdit: false });
    });

    it('control: a named view that says nothing leaves the host`s `inlineEdit` in force', () => {
      // Proves the host layer reaches this node at all, so the two cases above
      // read a precedence and not a host layer the relay never saw.
      expect(read({}, { inlineEdit: true })).toEqual({ editInline: true, inlineEdit: true });
    });

    it('control: inside the named view, an explicit `userActions.editInline` still wins over its `inlineEdit`', () => {
      expect(read({ inlineEdit: true, userActions: { editInline: false } }, null)).toEqual({ editInline: false, inlineEdit: true });
    });
  });
});

// ── ObjectView.formLabelsI18nLabel-10993 ───────────────────────────────────

/**
 * `ObjectView`'s form heading resolves the `form` slot's `title` and
 * `description` as `I18nLabel` (objectui#10993).
 *
 * `ObjectViewSchema.form` is `ObjectFormSchema`'s slot keys, so when
 * objectui#10993 widened `ObjectFormSchema.title` / `.description` (and the zod
 * mirror's) to the spec's `I18nLabel`, the `object-view` node's `form.title` /
 * `form.description` widened with them. `ObjectView` draws its own drawer and
 * modal header around the form and read both raw: `getFormTitle()` returned
 * `schema.form.title` as the header's text, and `form.description` went into
 * the header as a React child, so a per-locale map was an object child there.
 * Both now resolve with `pickLocalized` against the UI language
 * (`useObjectTranslation().language`), the language `ObjectForm` resolves the
 * same form's buttons against.
 *
 * The harness is `ObjectView.formTitleI18n.test.tsx`'s: `ObjectForm` and the
 * grid are stubbed, and a row click opens the form in view mode. Every map lists
 * `en` FIRST, so an `en` or first-entry fallback fails the row. The plain-string
 * row is the control, and the authored-title override that file pins
 * ("uses the authored schema.form.title verbatim") is untouched.
 */
describe('ObjectView.formLabelsI18nLabel-10993', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: { schema?: { type?: string } }) => (
      <div data-testid="schema-renderer" data-schema-type={schema?.type}>
        {schema?.type}
      </div>
    );
    standIns.objectGrid = ({
      schema,
      onRowClick,
    }: {
      schema?: { objectName?: string };
      onRowClick?: (row: Record<string, unknown>) => void;
    }) => (
      <div data-testid="object-grid" data-object={schema?.objectName}>
        <button data-testid="grid-row" onClick={() => onRowClick?.({ id: '1', name: 'Test' })}>
          Row 1
        </button>
      </div>
    );
    standIns.objectForm = ({ schema }: { schema?: { mode?: string } }) => (
      <div data-testid="object-form" data-mode={schema?.mode}>
        Form ({schema?.mode})
      </div>
    );
  });

  function makeDataSource(): DataSource {
    return {
      find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Test' }], total: 1 }),
      findOne: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'contacts',
        label: '联系人',
        fields: { name: { label: 'Name', type: 'text' } },
      }),
    } as unknown as DataSource;
  }

  /** `en` first on purpose — see the file header. */
  const TITLE_MAP = { en: 'Contact card', 'zh-CN': '联系人卡片' };
  const DESCRIPTION_MAP = { en: 'Who to call', 'zh-CN': '联系谁' };

  /**
   * The drawer through `navigation.mode: 'drawer'`; the modal through
   * `layout: 'modal'` — `navigation.mode: 'modal'` was retired by
   * objectstack#26677, and the validator row below refuses it.
   */
  const node = (mode: 'drawer' | 'modal', form: Record<string, unknown>) => ({
    type: 'object-view',
    objectName: 'contacts',
    ...(mode === 'modal' ? { layout: 'modal' } : { navigation: { mode } }),
    form,
  });

  function renderView(mode: 'drawer' | 'modal', form: Record<string, unknown>) {
    return render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <ObjectView schema={node(mode, form) as unknown as ObjectViewSchema} dataSource={makeDataSource()} />
      </I18nProvider>,
    );
  }

  const openView = () => fireEvent.click(screen.getByTestId('grid-row'));

  afterEach(() => cleanup());

  describe('ObjectView — the form slot\'s `title` / `description` are I18nLabel (objectui#10993)', () => {
    it('the locale-map documents these rows mount are ones the validator accepts', () => {
      for (const mode of ['drawer', 'modal'] as const) {
        const parsed = safeValidateSchema(node(mode, { title: TITLE_MAP, description: DESCRIPTION_MAP }));
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      }
      // …and the retired spelling of the modal is not one (objectstack#26677).
      const retired = safeValidateSchema({ type: 'object-view', objectName: 'contacts', navigation: { mode: 'modal' }, form: { title: 'x' } });
      expect(retired.success).toBe(false);
    });

    it.each(['drawer', 'modal'] as const)(
      '%s: a locale-map `form.title` and `form.description` head the form in the UI language',
      async (mode) => {
        renderView(mode, { title: TITLE_MAP, description: DESCRIPTION_MAP });
        openView();

        await waitFor(() => expect(screen.getByText('联系人卡片')).toBeInTheDocument());
        expect(screen.getByText('联系谁')).toBeInTheDocument();
        expect(document.body.innerHTML).not.toContain('[object Object]');
      },
    );

    it('CONTROL: plain strings head the form exactly as authored', async () => {
      renderView('drawer', { title: 'Card', description: 'Call list' });
      openView();

      await waitFor(() => expect(screen.getByText('Card')).toBeInTheDocument());
      expect(screen.getByText('Call list')).toBeInTheDocument();
    });
  });
});

// ── ObjectView.refreshSignal ───────────────────────────────────────────────

/**
 * ObjectView's refresh signal has exactly the entry points that are reachable
 * (objectui#4568).
 *
 * ## Why this file exists
 *
 * `ObjectView` kept a `handleRefresh` callback that bumped `refreshKey` and was
 * referenced by nothing — not passed to the toolbar, not exposed on a handle,
 * not wired to any control. It read as "ObjectView has a refresh entry point"
 * to anyone scanning for one, which cost objectui#4549 a detour to rule out.
 * Triage ruled deletion rather than wiring it to a new toolbar button: the
 * button is a feature with no recorded pull, and the affordance already exists
 * downstream (see below). objectui#4568 removed the callback.
 *
 * A dead-code deletion is only safe once the surviving paths are pinned, so
 * this file asserts the ones that remain rather than asserting the absence of
 * the one that went. `refreshKey` itself stays — it is read by the non-grid
 * fetch effect, by the remount key of the views that cannot refetch in place
 * (objectui#10035), and is forwarded to a host list view as `refreshKey` /
 * `refreshTrigger`.
 *
 * ## Where the real refresh button lives
 *
 * Not here. `packages/plugin-list/src/ListView.tsx` renders a toolbar Refresh
 * button gated on `toolbarFlags.showRefresh` (derived from
 * `userActions.refresh`) driving ListView's OWN refresh counter. ObjectView
 * reaches it by delegating through `renderListView` — and deliberately does not
 * auto-subscribe in that mode, which is the third test below. That delegation
 * is why the deleted callback had no toolbar to attach to in the first place.
 */
describe('ObjectView.refreshSignal', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => (
      <div data-testid="schema-renderer">{schema?.type}</div>
    );
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  /**
   * A DataSource whose `onMutation` hands the registered callback back to the
   * test, so a mutation can be emitted the way a real adapter would.
   */
  function makeDataSource() {
    const subscribers: ((event: DataSourceMutationEvent) => void)[] = [];
    const unsubscribe = vi.fn();
    const onMutation = vi.fn((cb: (event: DataSourceMutationEvent) => void) => {
      subscribers.push(cb);
      return unsubscribe;
    });
    const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const ds: any = {
      find,
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
      onMutation,
    };
    return {
      ds,
      find,
      onMutation,
      unsubscribe,
      emit: async (event: DataSourceMutationEvent) => {
        await act(async () => {
          subscribers.forEach(cb => cb(event));
        });
      },
    };
  }

  /** A non-grid view type, because the grid branch fetches its own data. */
  const KANBAN_SCHEMA = {
    type: 'object-view',
    objectName: 'task',
    defaultViewType: 'kanban',
  } as unknown as ObjectViewSchema;

  describe('ObjectView refresh signal (objectui#4568)', () => {
    it('re-fetches when the DataSource reports a mutation on the same object', async () => {
      const { ds, find, emit } = makeDataSource();
      render(<ObjectView schema={KANBAN_SCHEMA} dataSource={ds} />);

      await waitFor(() => expect(find).toHaveBeenCalledTimes(1));

      await emit({ type: 'create', resource: 'task', id: '1' });

      await waitFor(
        () => expect(find).toHaveBeenCalledTimes(2),
        { timeout: 2000 },
      );
    });

    it('ignores a mutation reported for a different object', async () => {
      const { ds, find, emit } = makeDataSource();
      render(<ObjectView schema={KANBAN_SCHEMA} dataSource={ds} />);

      await waitFor(() => expect(find).toHaveBeenCalledTimes(1));

      await emit({ type: 'create', resource: 'not_task', id: '1' });

      // Nothing should re-run the fetch. Give the effect a turn to misbehave
      // before asserting it did not.
      await act(async () => { await Promise.resolve(); });
      expect(
        find,
        'A mutation on an unrelated object re-queried this view. The auto-subscribe\n'
          + 'is gated on `event.resource === schema.objectName`; losing that gate turns\n'
          + 'every mutation anywhere into a refetch storm.',
      ).toHaveBeenCalledTimes(1);
    });

    it('does not auto-subscribe when a host list view is supplied', async () => {
      const { ds, onMutation } = makeDataSource();
      render(
        <ObjectView
          schema={KANBAN_SCHEMA}
          dataSource={ds}
          renderListView={({ refreshKey }) => (
            <div data-testid="host-list" data-refresh-key={refreshKey} />
          )}
        />,
      );

      await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());

      expect(
        onMutation,
        'ObjectView auto-subscribed to mutations while a host list view was supplied.\n'
          + 'The host (e.g. plugin-list ListView) owns its own fetching AND its own\n'
          + 'toolbar Refresh button; subscribing here double-fetches. This delegation is\n'
          + 'also why ObjectView never had a refresh control of its own for the\n'
          + 'objectui#4568 callback to attach to.',
      ).not.toHaveBeenCalled();
    });
  });
});

// ── ObjectView.timelineBinding-7070 ────────────────────────────────────────

/**
 * objectui#7070 step ③ — `generateViewSchema`'s TIMELINE branch stops flooring
 * the date axis at `'created_at'`.
 *
 * Maintainer ruling 2026-09-01 (总监批 #28, objectui#7070): house posture
 * 日期轴永不虚构 — a date axis is never fabricated. The ruling sequenced three
 * steps and forbade reordering them, because the floors and the refusal are
 * only meaningful together:
 *
 *   ① `ObjectTimeline` gains a refusal screen for an absent date axis;
 *   ② the renderer's own `|| 'date'` floor is retired;
 *   ③ — THIS — the two plugin faces stop supplying `'created_at'`.
 *
 * ①② landed as `20cb8db9b` (PR #7467). With them in and this floor still
 * standing, nothing in the product refuses: this branch answers "the axis is
 * bound" for every view, so the screen ① installed is unreachable from here.
 * `ObjectTimeline` reads this FLAT prop (`schema.startDateField`) at the tail of
 * its own resolver chain, which is exactly why a floor here is load-bearing.
 *
 * The sibling of `ObjectView.ganttBinding-7070` and `ObjectView.calendarBinding
 * -7029` next door — the same one-rung fabrication, the same face, the third
 * and last of its date axes to be retired.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `|| 'created_at'` on the single line this step deletes and the two
 * "invents NO binding" cases go RED (the recorded schema carries the fabricated
 * name) while every CONTROL below stays GREEN in both worlds. That asymmetry is
 * the whole claim: this branch stopped INVENTING, it did not stop FORWARDING.
 */
describe('ObjectView.timelineBinding-7070', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    };
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  /** Every schema the view hands to SchemaRenderer, in order. */
  const rendered: any[] = [];

  async function renderTimelineView(view: Record<string, unknown>) {
    rendered.length = 0;
    const ds: any = {
      find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'crm_campaign', fields: {} }),
    };
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'crm_campaign' } as ObjectViewSchema}
        views={[{ id: 't', label: 'Timeline', type: 'timeline' as any, ...view }]}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    return rendered[rendered.length - 1];
  }

  describe('ObjectView.generateViewSchema — timeline restates only a DECLARED axis (objectui#7070 step ③)', () => {
    it('RENDER PROOF: this harness reaches the timeline branch at all', async () => {
      // First, and deliberately: every "is undefined" below reads a key off the
      // recorded schema, and an absent key is indistinguishable from a branch that
      // never ran. This row is what makes the rest measurements — it fails loudly
      // if the mount, the mock or the `views` shape stops producing an
      // `object-timeline` schema, instead of letting the file pass vacuously.
      const schema = await renderTimelineView({ timeline: { startDateField: 'start_date' } });
      expect(schema.type).toBe('object-timeline');
      expect(schema.startDateField).toBe('start_date');
    });

    it('invents NO date axis for a timeline view that declares no config', async () => {
      // THE DEFECT. `startDateField` used to read `'created_at'` here — a name
      // this view never wrote, and one most objects DO carry, so downstream it is
      // indistinguishable from a real binding and it never resolves to nothing.
      // Absence is the only route to `ObjectTimeline`'s refusal screen.
      const schema = await renderTimelineView({});
      expect(schema.type).toBe('object-timeline');
      expect(schema.startDateField).toBeUndefined();
    });

    it('invents no date axis for an EMPTY timeline block', async () => {
      // ⚠️ `timeline` sits at the VIEW's top level, not under `options`:
      // `viewOptions` is `currentNamedViewConfig?.options || activeView`, and a raw
      // `views` entry takes the `activeView` leg. The sibling gantt file records
      // measuring that the hard way — written as `{ options: { timeline } }` this
      // case AND the controls below all read `undefined`, and the controls are
      // what exposes it.
      const schema = await renderTimelineView({ timeline: {} });
      expect(schema.startDateField).toBeUndefined();
    });

    it('a timeline block with no date key does not become a binding', async () => {
      // The bag app-shell's object page emits for a view that declared nothing:
      // `timelineViewOptions` floors the TITLE at `'name'` and emits no axis. "The
      // config object exists" must not be read as "the axis is bound".
      const schema = await renderTimelineView({ timeline: { titleField: 'name' } });
      expect(schema.startDateField).toBeUndefined();
      expect(schema.titleField).toBe('name');
    });

    it('CONTROL: forwards the spec-canonical `timeline.startDateField`', async () => {
      const schema = await renderTimelineView({
        timeline: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'subject' },
      });
      expect(schema.startDateField).toBe('start_date');
      expect(schema.endDateField).toBe('end_date');
      expect(schema.titleField).toBe('subject');
    });

    it('the retired LEGACY `timeline.dateField` alias binds no axis, under either flat name (objectui#6152 round 14)', async () => {
      // This arm pinned that the alias still resolved: the flat prop was the one
      // place it was translated into the spec key, and the raw block spread also
      // put it on the node's FLAT `dateField`, which `ObjectTimeline` reads as a
      // declared prop. objectui#6152 round 14 retired both, so a stored alias
      // reaches neither, and the renderer's refusal answers instead.
      const schema = await renderTimelineView({ timeline: { dateField: 'start_date' } });
      expect(schema.startDateField).toBeUndefined();
      expect(schema).not.toHaveProperty('dateField');
    });

    it('CONTROL: the spec key still WINS over the legacy alias', async () => {
      const schema = await renderTimelineView({
        timeline: { startDateField: 'start_date', dateField: 'end_date' },
      });
      expect(schema.startDateField).toBe('start_date');
    });

    it('CONTROL: `titleField` is NOT a date axis and keeps its floor', async () => {
      // ⛔ Scope, made visible. The ruling retires FABRICATED DATE AXES; `'name'`
      // is the display-name rung every sibling branch on this face carries
      // (gallery, kanban, gantt) and `timelineViewOptions` carries at app-shell.
      // If a later card retires it, this is where that card declares it did.
      const schema = await renderTimelineView({});
      expect(schema.titleField).toBe('name');
    });
  });
});

// ── ObjectView.readersRetired-6152 ─────────────────────────────────────────

/**
 * objectui#6152 round 14 — `generateViewSchema` (the authored `object-view`
 * element's own views) reads each per-kind block by its DECLARED keys only.
 *
 * The second route to the per-kind renderers, beside `ListView`, which
 * `plugin-list`'s `ListView.readersRetired-6152.test.tsx` pins. This branch
 * spread the whole kanban, calendar, gallery, timeline, gantt and tree blocks
 * onto the node after its own keys, and read the pre-#2231 aliases. Every
 * list-view door refuses those keys, so the round retired the reads here too:
 *
 *   1. A block key named like a NODE key no longer overrides the node's own
 *      `objectName` (the K8 hazard of round 13), on every branch that spread.
 *   2. The DECLARED keys keep their route, each beside the undeclared key the
 *      spread used to carry with it. The gantt and timeline arms are driven off
 *      the spec's own block shapes.
 *   3. The gallery cover goes out from `coverField` only. Since objectui#12053
 *      it rides the node's nested `gallery` block (the shape `ListView` hands
 *      `ObjectGallery`), not the flat `imageField` this round left in place;
 *      `ObjectView.galleryBlockNested-12053.test.tsx` pins the rest of the block.
 */
describe('ObjectView.readersRetired-6152', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    };
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  const HIJACK = 'HIJACK_FROM_THE_BLOCK';
  const rendered: any[] = [];

  const dataSource = (): any => ({
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: { name: { name: 'name', type: 'text' } } }),
  });

  /** Mount an `object-view` whose host `views` entry is one view of `type`, and return the node it generated. */
  async function generatedNode(type: string, view: Record<string, unknown>): Promise<any> {
    cleanup();
    rendered.length = 0;
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task' } as unknown as ObjectViewSchema}
        views={[{ id: 'v', label: 'View', type, ...view }] as any}
        dataSource={dataSource()}
      />,
    );
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    const node = rendered[rendered.length - 1];
    expect(node.type).toBe(`object-${type}`);
    return node;
  }

  beforeEach(() => {
    rendered.length = 0;
  });

  describe('1 · a block key named like a node key no longer overrides the node (objectui#6152 round 14)', () => {
    const ARMS: Array<[string, Record<string, unknown>]> = [
      ['kanban', { kanban: { groupByField: 'stage', objectName: HIJACK } }],
      ['calendar', { calendar: { startDateField: 'due', objectName: HIJACK } }],
      ['gallery', { gallery: { coverField: 'photo', objectName: HIJACK } }],
      ['timeline', { timeline: { startDateField: 'due', objectName: HIJACK } }],
      ['gantt', { gantt: { startDateField: 'due', endDateField: 'due', objectName: HIJACK } }],
      ['tree', { tree: { parentField: 'parent', objectName: HIJACK } }],
    ];
    for (const [type, view] of ARMS) {
      it(`${type}: the node keeps its own \`objectName\``, async () => {
        const node = await generatedNode(type, view);
        expect(node.objectName).toBe('task');
        expect(JSON.stringify(node)).not.toContain(HIJACK);
      });
    }
  });

  describe('2 · the declared keys keep their route; the undeclared ones do not (objectui#6152 round 14)', () => {
    it('kanban: `summarizeField` reaches the board, `swimlaneField` does not', async () => {
      const node = await generatedNode('kanban', { kanban: { groupByField: 'stage', summarizeField: 'amount', swimlaneField: 'lane' } });
      expect(node.summarizeField).toBe('amount');
      expect(node).not.toHaveProperty('swimlaneField');
    });

    it('calendar: the five declared keys reach the calendar, `defaultView` does not', async () => {
      const node = await generatedNode('calendar', {
        calendar: { startDateField: 'a', endDateField: 'b', titleField: 'c', colorField: 'd', allDayField: 'e', defaultView: 'week' },
      });
      // objectstack#25923 — the five ride the node's own `calendar` block, never flat.
      const { calendar } = node;
      expect([calendar.startDateField, calendar.endDateField, calendar.titleField, calendar.colorField, calendar.allDayField]).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(node).not.toHaveProperty('startDateField');
      expect(node).not.toHaveProperty('defaultView');
      expect(calendar).not.toHaveProperty('defaultView');
    });

    it('gantt: EVERY key the spec declares on the block reaches the gantt, an undeclared one does not', async () => {
      const declared = Object.keys(SpecListViewSchema.shape.gantt.unwrap().shape);
      expect(declared.length).toBeGreaterThan(20);
      const block = Object.fromEntries(declared.map((k) => [k, `V_${k}`]));
      const node = await generatedNode('gantt', { gantt: { ...block, zzzUndeclared: 1 } });
      // objectstack#25923 — they reach it as the node's own `gantt` block, never flat.
      for (const k of declared) expect(node.gantt?.[k], k).toBe(`V_${k}`);
      for (const k of declared) expect(node, `flat ${k}`).not.toHaveProperty(k);
      expect(node).not.toHaveProperty('zzzUndeclared');
      expect(node.gantt).not.toHaveProperty('zzzUndeclared');
    });

    it('timeline: EVERY key the spec declares on the block reaches the timeline flat; the `dateField` alias does not', async () => {
      const declared = Object.keys(SpecListViewSchema.shape.timeline.unwrap().shape);
      expect(declared).toContain('startDateField');
      const block = Object.fromEntries(declared.map((k) => [k, `V_${k}`]));
      const node = await generatedNode('timeline', { timeline: { ...block, dateField: 'ALIAS' } });
      for (const k of declared) expect(node[k], k).toBe(`V_${k}`);
      // The alias used to land on the node's FLAT `dateField`, a prop
      // `ObjectTimeline` reads as its own declared binding.
      expect(node).not.toHaveProperty('dateField');
    });

    it('tree: the four declared keys reach the tree, `titleField` labels nothing', async () => {
      const node = await generatedNode('tree', { tree: { parentField: 'p', titleField: 'owner', defaultExpandedDepth: 2 } });
      expect(node.parentField).toBe('p');
      expect(node.labelField).toBe('name');
      expect(node.defaultExpandedDepth).toBe(2);
      expect(node).not.toHaveProperty('titleField');
    });
  });

  describe('3 · the gallery cover goes out from `coverField` only (objectui#6152 round 14)', () => {
    it('`coverField` becomes the nested `gallery.coverField` the gallery reads (objectui#12053)', async () => {
      const node = await generatedNode('gallery', { gallery: { coverField: 'photo' } });
      expect(node.gallery.coverField).toBe('photo');
    });

    it('the retired `imageField` alias binds no cover', async () => {
      const node = await generatedNode('gallery', { gallery: { imageField: 'photo' } });
      expect(node.gallery).not.toHaveProperty('coverField');
      expect(node.gallery).not.toHaveProperty('imageField');
      expect(node).not.toHaveProperty('imageField');
    });
  });
});

// ── ObjectView.filterSources ───────────────────────────────────────────────

/**
 * The filter a non-grid view actually queries with.
 *
 * `ObjectView` fetches its own data for calendar / kanban / gallery / timeline
 * (grid delegates to `ObjectGrid`). It built the filter by hand and lost it in
 * two ways, both silent:
 *
 *   1. `baseFilter.length > 0` — `undefined > 0` for an object. So a
 *      `table.defaultFilters`, declared `Record<string, any>`, was dropped and
 *      the view returned EVERY record. `ObjectGrid` assigns the same value
 *      straight to `params.$filter`, so one view definition filtered correctly
 *      as a grid and returned everything as a calendar.
 *   2. `['and', ...baseFilter, ...userFilter]` — spreading a `ViewFilterRule[]`
 *      puts bare rule objects where the AST expects nodes. Covered at the merge
 *      level in core's `filter-source-merge.test.ts`, which pins what the server
 *      does with the old shape.
 *   3. Even UNSPREAD, a `ViewFilterRule[]` was never AST: it reached `$filter`
 *      as rule objects and the server answered `400 INVALID_FILTER`
 *      (objectui#3431). This file is one of the two producers that feed the
 *      shared `toFilterNode` sink — the other is `plugin-list`'s
 *      `buildEffectiveFilter` — which is why the lowering lives there and not
 *      in either caller.
 *
 * ⚠️ objectui#12030: the cells below used `table.defaultFilters` as the vehicle
 * for each source shape. `@objectstack/spec` 18 retired that key (a tombstone
 * refusing it by name) and `ObjectView` no longer reads it, so the same shapes
 * now ride the canonical `table.filter`, and one cell pins the retired key as
 * inert.
 */
describe('ObjectView.filterSources', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>;
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  function renderCalendar(schema: Partial<ObjectViewSchema>) {
    const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
    const ds: any = {
      find,
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
    };
    render(
      <ObjectView
        schema={{
          type: 'object-view',
          objectName: 'task',
          // Anything but `grid` — grid delegates its fetch to ObjectGrid, and
          // `defaultViewType` is the key `currentViewType` actually reads.
          defaultViewType: 'calendar',
          ...schema,
        } as ObjectViewSchema}
        dataSource={ds}
      />,
    );
    return find;
  }

  /** The `$filter` the view actually queried with. */
  async function queriedFilter(find: ReturnType<typeof vi.fn>) {
    await waitFor(() => expect(find).toHaveBeenCalled());
    return find.mock.calls[0][1]?.$filter;
  }

  describe('ObjectView carries every filter source into the query', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps an OBJECT table.filter instead of dropping it', async () => {
      const find = renderCalendar({ table: { filter: { status: 'active' } } as any });
      // Was `undefined` — the view queried unfiltered and showed every record.
      expect(await queriedFilter(find)).toEqual(['status', '=', 'active']);
    });

    it('LOWERS a ViewFilterRule[] table.filter into AST nodes', async () => {
      // objectui#3431. This case used to assert `toEqual(rules)` — that the rule
      // objects reached `$filter` VERBATIM — and it was green because that is
      // what happened, not because it was right: the server refuses an array of
      // rule objects with `400 INVALID_FILTER`, so this view queried nothing at
      // all. `toFilterNode` now lowers the rules; `eq` canonicalises to `equals`
      // through the spec's own `normalizeFilterOperator`, the same exit the
      // write side uses.
      const rules = [{ field: 'stage', operator: 'eq', value: 'won' }];
      const find = renderCalendar({ table: { filter: rules } as any });
      expect(await queriedFilter(find)).toEqual([['stage', 'equals', 'won']]);
    });

    it('keeps an AST-shaped source', async () => {
      const find = renderCalendar({ table: { filter: [['stage', '=', 'won']] } as any });
      expect(await queriedFilter(find)).toEqual([['stage', '=', 'won']]);
    });

    it('a retired table.defaultFilters is not read: the view queries unfiltered (objectui#12030)', async () => {
      const find = renderCalendar({ table: { defaultFilters: { status: 'active' } } as any });
      expect(await queriedFilter(find)).toBeUndefined();
    });

    it('sends no filter when the view declares none', async () => {
      expect(await queriedFilter(renderCalendar({}))).toBeUndefined();
    });

    it('sends no filter for an empty source rather than an empty array', async () => {
      expect(await queriedFilter(renderCalendar({ table: { filter: {} } as any }))).toBeUndefined();
      expect(await queriedFilter(renderCalendar({ table: { filter: [] } as any }))).toBeUndefined();
    });
  });

  /**
   * `mergedFilters` / `mergedSort` — what ObjectView hands the renderer it
   * delegates to (the `renderListView` slot, used by the Studio design surface).
   *
   * Both used to open with a branch keyed on ObjectView's own filter/sort state,
   * and the filter one REPLACED the view's filter with the user's rather than
   * combining them. Nothing ever wrote that state, so neither branch could run —
   * they were deleted rather than corrected, because the delegated renderer owns
   * the filter UI and does its own combining. These pin what survives.
   */
  describe('ObjectView hands the view filter to the delegated renderer', () => {
    beforeEach(() => vi.clearAllMocks());

    function renderDelegated(schema: Partial<ObjectViewSchema>) {
      const seen: any[] = [];
      const ds: any = {
        find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
        getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
      };
      render(
        <ObjectView
          schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
          dataSource={ds}
          renderListView={({ schema: s }: any) => { seen.push(s); return <div data-testid="delegated" />; }}
        />,
      );
      return seen;
    }

    it('forwards an object table.filter unchanged', () => {
      const seen = renderDelegated({ table: { filter: { status: 'active' } } as any });
      expect(seen[0]?.filter).toEqual({ status: 'active' });
    });

    it('forwards a ViewFilterRule[] unchanged', () => {
      const rules = [{ field: 'stage', operator: 'eq', value: 'won' }];
      const seen = renderDelegated({ table: { filter: rules } as any });
      expect(seen[0]?.filter).toEqual(rules);
    });

    it('forwards no filter for a retired table.defaultFilters (objectui#12030)', () => {
      const seen = renderDelegated({ table: { defaultFilters: { status: 'active' } } as any });
      expect(seen[0]?.filter).toBeUndefined();
    });

    // ⚠️ CONTROL, green in BOTH states — named so it is not read as evidence
    // for objectui#6235. `table.sort` is the slot that legitimately carries an
    // array (`ObjectGridSchema.sort: SortConfig[]`), and it must reach
    // the delegated node UNWRAPPED. What this guards is the wrong shape the fix
    // could have taken: wrapping the chain's RESULT instead of its final branch,
    // which would re-wrap this into `[[{ field, order }]]` — verbatim
    // objectui#5270's failure, where `parseSchemaSort` and
    // `ListView.parseSortConfig` both skip a nested-array entry and return `[]`,
    // so the user sees no sort at all. Only the LAST branch may change shape;
    // this cell is how we know it was the only one.
    it('forwards a canonical table.sort array UNWRAPPED', () => {
      const seen = renderDelegated({ table: { sort: [{ field: 'name', order: 'asc' }] } as any });
      expect(seen[0]?.sort).toEqual([{ field: 'name', order: 'asc' }]);
      expect(convertSortToQueryParams(seen[0]?.sort)).toEqual({ name: 'asc' });
    });

    // ── objectui#5861 — `table.defaultSort` is RETIRED, so nothing is wrapped ──
    //
    // These three cells used to pin objectui#6235's wrap: the legacy single
    // `{ field, order }` in `table.defaultSort` was lowered into the
    // `SortConfig[]` the delegated `list-view` slot declares (and an ARRAY in it
    // was re-wrapped to `[[…]]` and refused downstream). The key is now an
    // ADR-0049 tombstone — `@objectstack/spec` refuses it by name on
    // `object-grid` — and `mergedSort` no longer has a `defaultSort` branch, so
    // each cell is FLIPPED to assert the key reaches the slot in no shape.
    // ⛔ Not deleted: they are the receipt that the alias was retired rather
    // than quietly dropped from one path while another still honours it.
    it('forwards no sort for an ARRAY in a retired defaultSort — not even the refused `[[…]]` shape', () => {
      const seen = renderDelegated({ table: { defaultSort: [{ field: 'name', order: 'asc' }] } as any });
      expect(seen[0]?.sort).toBeUndefined();
      expect(convertSortToQueryParams(seen[0]?.sort)).toBeUndefined();
    });

    it('does not WRAP a bare-object table.defaultSort any more — the slot gets no sort', () => {
      // Flipped from `WRAPS a bare-object table.defaultSort into the SortConfig[]
      // the slot declares`, which asserted `[{ field: 'created', order: 'asc' }]`.
      const seen = renderDelegated({ table: { defaultSort: { field: 'created', order: 'asc' } } as any });
      expect(seen[0]?.sort).toBeUndefined();
    });

    it('hands the delegated slot a sort its READERS can parse only from the canonical key', () => {
      // The symptom, not the shape: the forwarded value is run through the
      // repo's one sort sink, which the delegated node's `sort` reaches on every
      // non-grid view type. A retired `defaultSort` gives it nothing to order
      // by; the canonical `sort` (CONTROL, same path) still orders.
      const retired = renderDelegated({ table: { defaultSort: { field: 'created', order: 'asc' } } as any });
      expect(convertSortToQueryParams(retired[0]?.sort)).toBeUndefined();
      const canonical = renderDelegated({ table: { sort: [{ field: 'created', order: 'asc' }] } as any });
      expect(convertSortToQueryParams(canonical[0]?.sort)).toEqual({ created: 'asc' });
    });

    it('keeps the canonical table.sort when a retired defaultSort is written beside it', () => {
      // CONTROL — green in both states (before objectui#5861 the canonical key
      // outranked the wrapped legacy default; now the legacy key is not read).
      const seen = renderDelegated({
        table: { sort: [{ field: 'name', order: 'desc' }], defaultSort: { field: 'created', order: 'asc' } } as any,
      });
      expect(seen[0]?.sort).toEqual([{ field: 'name', order: 'desc' }]);
    });

    it('forwards nothing when the view declares neither', () => {
      // CONTROL — green in both states. Guards a truthy placeholder (e.g. an
      // unconditional one-entry array) reaching the slot when nothing was
      // authored, which the sink and both parsers would read as a sort that
      // does not exist.
      const seen = renderDelegated({});
      expect(seen[0]?.filter).toBeUndefined();
      expect(seen[0]?.sort).toBeUndefined();
      expect(convertSortToQueryParams(seen[0]?.sort)).toBeUndefined();
    });
  });
});

// ── ObjectView.tableColumnsForwarding ──────────────────────────────────────

/**
 * objectui#5269 — `table.columns` reaches the NON-grid paths too.
 *
 * `ObjectViewSchema.table` is `Partial< Omit< ObjectGridSchema, 'type' |
 * 'objectName' > >`, where `columns` is the canonical spelling and `fields`
 * carries "@deprecated Use columns instead". `ObjectView` does not spread
 * `table`; it forwards a hand-written whitelist, and that whitelist had ONE
 * read of `table.columns` in the whole file — the grid one. Both other field-
 * list read points took the deprecated key alone:
 *
 *   generateViewSchema `baseProps`        `table.fields` only
 *   delegated `renderListView` schema     `table.fields` only
 *
 * So `table: { columns: [...] }` — the shape the type recommends — produced an
 * empty field list off the grid path, from a schema that compiled and read
 * correctly. Same silent-success shape as objectui#5102; different mechanism:
 * not a whitelist that knows only legacy spellings, but one that disagreed
 * with itself between two rendering paths.
 *
 * ## What this file pins, and on which surface
 *
 * Both changed sites are pinned where a CONSUMER can be observed, not merely
 * where the value is emitted:
 *
 *   `baseProps` -> `object-kanban`   consumed as `cardFields`
 *                                    (`ObjectKanban` reads `schema.cardFields`)
 *   `baseProps` -> `object-tree`     consumed as `fields`
 *                                    (`ObjectTree.getTreeConfig` reads `schema.fields`)
 *   delegated   -> `list-view`       consumed as `columns` (`ListView`'s column set)
 *
 * ## The surfaces that get NO test here, deliberately
 *
 * `baseProps` also feeds `object-gallery`, `object-calendar`, `object-timeline`,
 * `object-gantt` and `object-map`. Measured on this tree, none of those five
 * renderers reads a field list off its schema at all — every `.fields` in them
 * is `objectDef.fields` (object METADATA) or gallery's `schema.grouping.fields`.
 * So the value this fix forwards is inert on those five, before the fix and
 * after it. Asserting `fields` on their generated schema would pin the emit
 * and prove nothing about the surface, so it is stated here instead of tested.
 * (The card objectui#5269 names kanban / gallery / calendar as the affected
 * surfaces; the measurable set is kanban / tree / delegated.)
 *
 * ## One asymmetry between the two changed sites
 *
 * `table.columns` is `string[] | ListColumn[]`. The delegated `list-view`
 * slot declares that same union and `ListView` reads both, so it takes the
 * value RAW — flattening there would throw away the width/label the author
 * wrote. The non-grid `baseProps` slot is a names slot (both segments ahead of
 * `table` declare `string[]`; `ObjectKanban` indexes records by each entry), so
 * the `ListColumn[]` half is resolved to names with `columnIdentity` — the
 * same fold `ObjectGrid` applies to this very value. Both halves are pinned.
 *
 * ## Precedence
 *
 * Unchanged, and pinned below: the two segments ahead of `table`
 * (`listViews` entry, then `activeView`) still outrank it. Within the `table`
 * segment the canonical key wins and the deprecated one keeps working — the
 * same rule objectui#5102 applied to its four pairs.
 */
describe('ObjectView.tableColumnsForwarding', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    };
    standIns.objectGrid = ({ schema }: any) => {
      gridSchemas.push(schema);
      return <div data-testid="object-grid" />;
    };
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  /** Every schema the view hands to SchemaRenderer, in order. */
  const rendered: any[] = [];

  /** The grid the view delegates to, replaced by a probe that records its schema. */
  const gridSchemas: any[] = [];

  const mockDataSource = () => ({
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
  });

  /**
   * Render a non-grid view and return the schema `generateViewSchema` produced.
   * `views` drives the view types `defaultViewType` cannot spell (`tree`).
   */
  async function generatedSchema(
    schema: Partial<ObjectViewSchema>,
    views?: any[],
  ): Promise<any> {
    rendered.length = 0;
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
        views={views}
        dataSource={mockDataSource() as any}
      />,
    );
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    return rendered[rendered.length - 1];
  }

  /** Render through the delegated `renderListView` slot and return its schema. */
  function delegatedSchema(schema: Partial<ObjectViewSchema>): any {
    const seen: any[] = [];
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
        dataSource={mockDataSource() as any}
        renderListView={({ schema: s }: any) => { seen.push(s); return <div data-testid="delegated" />; }}
      />,
    );
    return seen[0];
  }

  /** Render on the grid path and return the schema ObjectGrid was handed. */
  function forwardedGridSchema(schema: Partial<ObjectViewSchema>): any {
    gridSchemas.length = 0;
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
        dataSource={mockDataSource() as any}
      />,
    );
    return gridSchemas[0];
  }

  const KANBAN = { defaultViewType: 'kanban' as const };
  const TREE_VIEWS = [{ id: 'tree-1', label: 'Tree', type: 'tree' as const }];

  beforeEach(() => {
    vi.clearAllMocks();
    rendered.length = 0;
    gridSchemas.length = 0;
  });

  describe('kanban: a canonical table.columns reaches the cards (objectui#5269)', () => {
    it('forwards table.columns as the kanban card fields', async () => {
      // Before the fix this arrived as `cardFields: []` — the card fields the
      // author declared were dropped at the forwarding hop, not at the renderer.
      const s = await generatedSchema({ ...KANBAN, table: { columns: ['stage', 'owner'] } as any });
      expect(s.type).toBe('object-kanban');
      expect(s.cardFields).toEqual(['stage', 'owner']);
      expect(s.fields).toEqual(['stage', 'owner']);
    });

    it('still forwards the deprecated table.fields', async () => {
      // The alias must keep working — every view authored against today's docs
      // writes it. (Green before AND after the fix: this pins the half that must
      // NOT change, not the defect.)
      const s = await generatedSchema({ ...KANBAN, table: { fields: ['stage'] } as any });
      expect(s.cardFields).toEqual(['stage']);
    });

    it('prefers the canonical table.columns over the deprecated table.fields', async () => {
      const s = await generatedSchema({
        ...KANBAN,
        table: { columns: ['stage'], fields: ['owner'] } as any,
      });
      expect(s.cardFields).toEqual(['stage']);
    });

    it('resolves the ListColumn[] form of table.columns to field NAMES', async () => {
      // `ObjectGridSchema.columns` is `string[] | ListColumn[]`, but this slot is
      // a names slot: `resolveKanbanCardFields` casts to `string[]` and the card
      // loop indexes the record by each entry. Forwarding the objects raw would
      // produce a non-empty card field list naming nothing — and a non-empty list
      // suppresses ObjectKanban's `highlightFields` fallback, so the cards would
      // come out emptier than before this card. Resolved at the boundary with
      // `columnIdentity`, the same fold ObjectGrid applies to this very value.
      const s = await generatedSchema({
        ...KANBAN,
        table: { columns: [{ field: 'stage', label: 'Stage', width: 120 }] } as any,
      });
      expect(s.cardFields).toEqual(['stage']);
    });

    it('falls through to table.fields when no column entry names a field', async () => {
      // The empty-array trap: `[] || x` is `[]`, so a `columns` whose entries all
      // fail to resolve must yield `undefined`, not an empty list that stops the
      // chain on a falsy-looking truthy value.
      const s = await generatedSchema({
        ...KANBAN,
        table: { columns: [{ label: 'no identity here' }], fields: ['owner'] } as any,
      });
      expect(s.cardFields).toEqual(['owner']);
    });

    it('keeps a named view outranking the table segment', async () => {
      // Precedence is unchanged by this card and must stay that way: the two
      // segments ahead of `table` still win. (Green on both legs — a guard on
      // the fix, not evidence of it.)
      const s = await generatedSchema({
        ...KANBAN,
        listViews: { mine: { label: 'Mine', columns: ['assignee'] } },
        defaultListView: 'mine',
        table: { columns: ['stage'] } as any,
      } as any);
      expect(s.cardFields).toEqual(['assignee']);
    });
  });

  describe('tree: a canonical table.columns reaches the flat columns (objectui#5269)', () => {
    it('forwards table.columns as the tree view fields', async () => {
      const s = await generatedSchema({ table: { columns: ['stage', 'owner'] } as any }, TREE_VIEWS);
      expect(s.type).toBe('object-tree');
      expect(s.fields).toEqual(['stage', 'owner']);
    });

    it('still forwards the deprecated table.fields', async () => {
      const s = await generatedSchema({ table: { fields: ['stage'] } as any }, TREE_VIEWS);
      expect(s.fields).toEqual(['stage']);
    });
  });

  describe('delegated renderListView: canonical first, alias still working (objectui#5269)', () => {
    it('hands over a canonical table.columns as the list-view columns', () => {
      expect(delegatedSchema({ table: { columns: ['stage', 'owner'] } as any }).columns)
        .toEqual(['stage', 'owner']);
    });

    it('hands over the ListColumn[] form of table.columns unchanged', () => {
      // `ObjectGridSchema.columns` (and `list-view`'s own `columns`) are both
      // `string[] | ListColumn[]`, so the object form is a declared shape on
      // this slot and must not be flattened on the way through.
      const cols = [{ field: 'stage', label: 'Stage', width: 200 }];
      expect(delegatedSchema({ table: { columns: cols } as any }).columns).toEqual(cols);
    });

    it('still hands over the deprecated table.fields', () => {
      expect(delegatedSchema({ table: { fields: ['stage'] } as any }).columns).toEqual(['stage']);
    });

    it('prefers the canonical table.columns over the deprecated table.fields', () => {
      expect(delegatedSchema({ table: { columns: ['stage'], fields: ['owner'] } as any }).columns)
        .toEqual(['stage']);
    });

    it('keeps a named view outranking the table segment', () => {
      const s = delegatedSchema({
        listViews: { mine: { label: 'Mine', columns: ['assignee'] } },
        defaultListView: 'mine',
        table: { columns: ['stage'] } as any,
      } as any);
      expect(s.columns).toEqual(['assignee']);
    });
  });

  describe('grid path: unchanged by this card — the control', () => {
    it('keeps emitting table.columns and table.fields in their own slots', () => {
      // The grid path forwards BOTH slots and lets `ObjectGrid` arbitrate
      // (objectui#5102's shape). This card does not touch it; the assertion is
      // here so a future "make all three sites identical" tidy-up cannot
      // collapse the two slots without a red test.
      //
      // The `undefined` half is counter-probed by the populated half in the same
      // render: `fields: undefined` alone would also be what a probe that saw no
      // grid schema at all would report.
      const canonicalOnly = forwardedGridSchema({ table: { columns: ['stage'] } as any });
      expect(canonicalOnly.columns).toEqual(['stage']);
      expect(canonicalOnly.fields).toBeUndefined();

      const legacyOnly = forwardedGridSchema({ table: { fields: ['owner'] } as any });
      expect(legacyOnly.fields).toEqual(['owner']);
      expect(legacyOnly.columns).toBeUndefined();
    });
  });
});

// ── ObjectView.strayGroupByLane-9242 ───────────────────────────────────────

/**
 * objectui#9242 — a stray `groupBy` in `viewOptions.kanban` OVERRODE the lane
 * `generateViewSchema` had just resolved. THE SECOND ROUTE.
 *
 * `generateViewSchema`'s kanban branch destructured
 * `columns`/`groupByField`/`groupField`/`titleField`/`conditionalFormatting`
 * out of `viewOptions.kanban` and spread the REST *after* its own `groupBy`. So
 * an authored `kanban.groupBy` survived into `restKanban` and won over the
 * canonical `groupByField` the branch had already resolved — the board grouped
 * by the stray key, and nothing said so.
 *
 * ## WHY THIS IS A SECOND ROUTE, NOT A DUPLICATE OF objectui#8365
 *
 * `generateViewSchema` runs precisely when no host supplied `renderListView` —
 * the authored `object-view` element — so it never passes through `ListView`,
 * and PR objectui#9236's destructure fix does not reach it. This is the same
 * distinction the `calendar` branch a few lines below records for objectui#7029.
 *
 * ## THE RULING — already made; this card only applies it to the second route
 *
 * Maintainer ruling of 2026-09-12 (decision batch #117 item 5, verbatim
 * 「8365 同意」) — option B: the CANONICAL spelling wins and the stray key is
 * refused BY NAME. Option A (strip the key and re-group in silence) was NOT
 * taken. ⛔ This is not an open question; see objectui#8365 / PR objectui#9236.
 *
 * ## THE DISTINGUISHING FIXTURE, and why one lane name would not do
 *
 * The two spellings carry two DIFFERENT lane names. With a single name the
 * override arm cannot fail BY CONSTRUCTION — which is exactly how the twin
 * defect stayed invisible for so long on the first route: the one producer that
 * fed it wrote both spellings with the same value.
 *
 *     kanban = { groupBy: 'LANE_FROM_STRAY_GROUPBY',
 *                groupByField: 'LANE_FROM_CANONICAL' }
 *
 * ## ⭐ THE ARM THAT IS **MEASURED HERE**, NOT COPIED FROM THE TWIN
 *
 * `ListView` floors its lane on `detectStatusField(objectDef)`. THIS branch
 * floors it on the LITERAL `'status'` (`groupByField || groupField || 'status'`),
 * so the "stray key alone" control answers differently on the two routes and
 * copying the twin's assertion would have pinned the wrong thing.
 *
 * Measured on this tree before this file was written (base `96919a459`, every
 * lit control firing), `node.groupBy` per fixture:
 *
 *   | kanban config                          | BEFORE fix | AFTER fix  |
 *   | -------------------------------------- | ---------- | ---------- |
 *   | `{ groupBy: S, groupByField: C }`      | **S** ⛔   | C          |
 *   | `{ groupBy: S }`                       | **S** ⛔   | `'status'` |
 *   | `{ groupBy: S }`, object has NO status | **S** ⛔   | `'status'` |
 *   | `{}`                                   | `'status'` | `'status'` |
 *   | `{ groupByField: C }`                  | C          | C          |
 *   | `{ groupField: C }`                    | C          | C          |
 *
 * The third row is the one that tells a LITERAL floor apart from a detector: an
 * object declaring no `status` field still floors at `'status'` here, where the
 * twin would have produced `undefined`. Pinned below for exactly that reason.
 *
 * ## WHAT THIS CARD DELIBERATELY DOES NOT TOUCH — four faces
 *
 *  1. THE CONTRACT HALF — AND WHAT IT ACTUALLY REACHES. `KanbanConfig`'s
 *     `aliasKeyRefusal` for `groupBy` (`@object-ui/types`, `zod/objectql.zod.ts`)
 *     landed with PR objectui#9236, and is pinned in
 *     `packages/plugin-list/src/__tests__/ListView.strayGroupByRefused-8365.test.tsx`
 *     (runtime face) and
 *     `packages/types/src/__tests__/kanban-stray-group-by-refusal-8365.test.ts`
 *     (type face). ⛔ That arm alone does NOT cover both routes, and this note
 *     used to say it did (objectui#9655). This route's door is a second install
 *     site of the same string, added by objectui#10321: `ObjectViewSchema`'s
 *     named-view check refuses `listViews.KEY.kanban.groupBy` in both nestings,
 *     pinned in
 *     `packages/types/src/__tests__/named-view-kanban-stray-group-by-10321.test.ts`.
 *
 *     ⭐ READ THE REACH, ⛔ DO NOT TRUST A COUNT WRITTEN DOWN HERE — a count in
 *     prose is derived once and re-derived never, and the one that stood here
 *     was wrong. Every place the arm reaches an authored document is a
 *     reference to the `KanbanStrayGroupByRefusal` symbol, so the instrument is
 *     an enumeration of that symbol:
 *
 *         git grep -n KanbanStrayGroupByRefusal packages/types/src
 *
 *     The declaration line is that run's own positive control — a run that does
 *     not print it found nothing at all, rather than finding no install sites.
 *     Read which object each hit hangs off; the arm's own "WHERE THIS ARM IS
 *     INSTALLED" note in that file states the routes and nestings it was
 *     written for. The first two pins above build `list-view` fixtures and the
 *     third `object-view` ones, which is the same reading taken from the other
 *     side.
 *
 *     ⚠️ THE MODEL ERROR, NOT JUST THE SENTENCE. The claim that made the wrong
 *     one feel safe to write was the tail of this item: that what remains on
 *     this route is "a document that never went through a validator". ⛔ FALSE.
 *     `safeValidateSchema` DOES judge an `object-view` document — it ACCEPTED
 *     this one until objectui#10321, and refuses it now. The instrument is next
 *     door in this directory:
 *     `ObjectView.calendarAliasRefused-8355.test.tsx`'s "REFUSED at the read
 *     door" half drives a named view under `listViews` through
 *     `safeValidateSchema` and gets a refusal — same door, same document shape,
 *     a different key family. ⇒ write ACCEPTED, ⛔ never "not validated":
 *     "not refused" is the weaker and true claim, and the substitution of the
 *     stronger one got written down three times in this one neighbourhood —
 *     here; in `KanbanStrayGroupByRefusal`'s own PUBLISHED message, which an
 *     author still reads today (objectui#9653, ⛔ not this card's file); and in
 *     objectui#8355's calendar stem, where a contract review caught the clause
 *     before it landed (objectui#9648).
 *
 *     ⛔ Still not re-pinned here: this file pins the BEHAVIOUR half, which
 *     holds for any document that reaches the branch carrying the key, whether
 *     or not it passed a validator. The door is pinned where it is declared (the
 *     `types` file above). Which value type `listViews` itself should enforce is
 *     objectui#7928's question, and neither this card nor objectui#10321
 *     answers it.
 *  2. THE LIVE LEGACY ALIAS `kanban.groupField`, a legacy spelling of the spec's
 *     `groupByField`. Still read, still resolves the lane — CONTROL below.
 *  3. `groupBy` ON THE GENERATED NODE. That is the canonical lane key
 *     `ObjectKanban` actually reads (thirteen `schema.groupBy` reads in
 *     `ObjectKanban.tsx`); the stray key is a VIEW-CONFIG spelling. Do not
 *     confuse the two — the whole fix is to stop the second from reaching the
 *     first.
 *  4. `ListView` — objectui#8365's face, closed.
 *
 * ## REVERSE VERIFICATION (the ablation leg), direction predicted before running
 *
 * Run in its STRONGEST form: this file was written and run BEFORE
 * `ObjectView.tsx` was touched, so the "unmodified" arm is the REAL BASE TREE
 * rather than an injected mutation — no on-disk mutation to prove, no restore
 * leg to get wrong. Predicted and then observed on `96919a459`: the three
 * override arms go RED naming `LANE_FROM_STRAY_GROUPBY`, while every CONTROL
 * arm (canonical, legacy alias, floor, passthrough, sibling keys) stays GREEN.
 * The asymmetry is what shows the controls are not carrying the override arms.
 */
describe('ObjectView.strayGroupByLane-9242', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    };
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  /** The two lane names the fixture holds apart. */
  const STRAY = 'LANE_FROM_STRAY_GROUPBY';
  const CANONICAL = 'LANE_FROM_CANONICAL';
  /** The literal this branch floors the lane at — NOT a detector. */
  const FLOOR = 'status';

  /** Every schema the view hands to SchemaRenderer, in order. */
  const rendered: any[] = [];

  /** An object that DOES declare a `status` field. */
  const WITH_STATUS = { status: { name: 'status', type: 'text', label: 'Status' } };
  /** An object that declares NO `status` field — tells a literal floor from a detector. */
  const WITHOUT_STATUS = { name: { name: 'name', type: 'text', label: 'Name' } };

  const dataSource = (fields: Record<string, unknown> = WITH_STATUS): any => ({
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields }),
  });

  /**
   * Renders a kanban view through the REGISTERED renderer's path — i.e. with no
   * `renderListView` — and returns the `object-kanban` node the branch emits.
   *
   * ⚠️ `cleanup()` is load-bearing, not hygiene. Without it the previously
   * mounted `ObjectView`s stay mounted and keep pushing into `rendered`, so
   * `rendered[rendered.length - 1]` returns a STALE node and every reading comes
   * back shifted by one fixture. That failure was hit while measuring this card:
   * it renders as a plausible table in which the lit controls quietly answer the
   * previous row's question. ⛔ Do not drop it.
   */
  async function generatedKanbanNode(
    kanban: Record<string, unknown>,
    fields?: Record<string, unknown>,
  ): Promise<any> {
    cleanup();
    rendered.length = 0;
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task' } as unknown as ObjectViewSchema}
        views={[{ id: 'k', label: 'Board', type: 'kanban' as any, kanban }] as any}
        dataSource={dataSource(fields)}
      />,
    );
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    const node = rendered[rendered.length - 1];
    expect(node.type).toBe('object-kanban');
    return node;
  }

  beforeEach(() => {
    rendered.length = 0;
  });

  describe('objectui#9242 — the CANONICAL lane wins on the node `generateViewSchema` emits', () => {
    it('the distinguishing fixture resolves the lane from `groupByField`, not the stray `groupBy`', async () => {
      const node = await generatedKanbanNode({ groupBy: STRAY, groupByField: CANONICAL });
      // Before the fix this read `LANE_FROM_STRAY_GROUPBY`: the `...restKanban`
      // spread landed after the branch's own `groupBy`.
      expect(node.groupBy).toBe(CANONICAL);
      expect(node.groupBy).not.toBe(STRAY);
    });

    it('the stray VALUE does not reach the generated node under any key at all', async () => {
      const node = await generatedKanbanNode({ groupBy: STRAY, groupByField: CANONICAL });
      // The assertion above is about the lane key's VALUE. This one is about the
      // stray value: it must appear nowhere on the node, including under some
      // other key the spread might have carried it through.
      expect(Object.values(node)).not.toContain(STRAY);
      expect(Object.prototype.hasOwnProperty.call(node, 'groupByField')).toBe(false);
    });

    it('LANE CONTROL (measured here, ⛔ not copied from `ListView`): `groupBy` alone floors at the literal', async () => {
      // ⭐ THE ARM THE CARD SINGLED OUT. `ListView` answers this with
      // `detectStatusField(objectDef)`; this branch answers with the LITERAL
      // `'status'`. Option B, not a silent re-grouping: the stray key stops
      // steering the board, and what replaces it is this branch's own floor.
      const node = await generatedKanbanNode({ groupBy: STRAY });
      expect(node.groupBy).toBe(FLOOR);
      expect(node.groupBy).not.toBe(STRAY);
    });

    it('LANE CONTROL: the floor is a LITERAL — it holds when the object declares no `status` field', async () => {
      // This is the row that tells a literal floor apart from a detector, and so
      // the row that would redden first if anyone ever "aligned" this branch with
      // the twin by swapping in `detectStatusField`. That would be a behaviour
      // change on stored views and belongs on its own card, not in a tidy-up.
      const node = await generatedKanbanNode({ groupBy: STRAY }, WITHOUT_STATUS);
      expect(node.groupBy).toBe(FLOOR);
      expect(node.groupBy).not.toBe(STRAY);
      expect(node.groupBy).toBeDefined();
    });
  });

  describe('objectui#9242 — the controls, each able to fire on its own', () => {
    it('CONTROL: the declared `kanban.groupByField` still resolves the lane by itself', async () => {
      const node = await generatedKanbanNode({ groupByField: CANONICAL });
      expect(node.groupBy).toBe(CANONICAL);
    });

    it('the retired legacy alias `kanban.groupField` names no lane: the floor answers (objectui#6152 round 14)', async () => {
      // This card left the VIEW-LEVEL alias live (only the third spelling was
      // stripped), and this arm pinned that it still resolved the lane.
      // objectui#6152 round 14 retired the alias read on its own ruling, so a
      // stored `groupField` now gets the same lane as a block with no key.
      const node = await generatedKanbanNode({ groupField: CANONICAL });
      expect(node.groupBy).toBe(FLOOR);
      expect(node.groupBy).not.toBe(CANONICAL);
    });

    it('CONTROL: with neither declared key the lane is the floor, exactly as before this card', async () => {
      const node = await generatedKanbanNode({});
      expect(node.groupBy).toBe(FLOOR);
    });

    it('DECLARED-KEYS CONTROL: a declared sibling key reaches the node; an undeclared one does not (objectui#6152 round 14)', async () => {
      // This card stripped exactly ONE more key and kept `restKanban` as the
      // passthrough, and this arm pinned that an undeclared key still rode
      // through. objectui#6152 round 14 retired the passthrough on purpose: the
      // branch forwards the spec kanban block's keys by name, so the declared
      // `summarizeField` still arrives and an undeclared key does not.
      const node = await generatedKanbanNode({ groupByField: CANONICAL, summarizeField: 'amount', zzzBogusKey: 'rides-through' });
      expect(node.summarizeField).toBe('amount');
      expect(node).not.toHaveProperty('zzzBogusKey');
      expect(node.groupBy).toBe(CANONICAL);
    });

    it('CONTROL: the rest of the kanban branch still resolves — titleField and cardFields', async () => {
      // Without this arm every assertion above would pass just as happily against
      // a kanban branch that had stopped emitting anything at all.
      const node = await generatedKanbanNode({
        groupByField: CANONICAL,
        columns: ['name', 'amount'],
        titleField: 'name',
      });
      expect(node.titleField).toBe('name');
      expect(node.cardFields).toEqual(['name', 'amount']);
      // `columns` on the node would be read as LANES by `object-kanban`, so the
      // branch maps it to `cardFields` and strips it. Unchanged by this card.
      expect(node.columns).toBeUndefined();
    });
  });
});

// ── ObjectView.canonicalTableKeys ──────────────────────────────────────────

/**
 * objectui#5102 — the canonical `table` keys take effect.
 *
 * `ObjectViewSchema.table` is documented as "inherits from ObjectGridSchema",
 * but `ObjectView` does not spread it: it forwards a hand-written whitelist of
 * keys. That whitelist carried only the DEPRECATED half of four pairs, and
 * dropped every canonical successor:
 *
 *   forwarded (legacy)   | canonical successor on ObjectGridSchema | forwarded?
 *   ---------------------|-----------------------------------------|-----------
 *   pageSize             | pagination: PaginationConfig            | NO
 *   selectable           | selection:  SelectionConfig             | NO
 *   defaultFilters       | filter                                  | NO
 *   defaultSort          | sort                                    | NO
 *
 * ⚠️ objectui#5861 RETIRED the fourth pair's legacy half. `defaultSort` is an
 * ADR-0049 tombstone — `@objectstack/spec` 17.3.0 refuses it by name on
 * `object-grid` — and every reader dropped it together: ObjectView no longer
 * forwards it on the grid path, no longer lowers it on the non-grid fetch or
 * into the delegated `renderListView` sort, and ObjectGrid no longer reads it.
 * The cells below that pinned it as a WORKING alias were flipped, not deleted:
 * each now asserts the key is inert on its path, beside a canonical `sort`
 * control on the same path. The other three pairs are untouched.
 *
 * ⚠️ objectui#12030 RETIRED the third pair's legacy half the same way.
 * `@objectstack/spec` 18 tombstones `object-grid.defaultFilters`
 * (objectstack#11509), refusing it by name, and `ObjectView` stopped reading
 * `table.defaultFilters` on all three paths (the grid hand-off, the non-grid
 * fetch, the delegated `renderListView` schema), as `ObjectGrid` stopped
 * reading its own. The cells that pinned it as a working alias were flipped
 * the objectui#5861 way: each asserts the key is inert on its path, beside a
 * canonical `filter` control on the same path.
 *
 * So an author writing the shape the type recommends — `table: { pagination:
 * { pageSize: 25 } }` — got a view that compiled, read correctly, and did
 * NOTHING. There was no failure signal anywhere: the key is declared on
 * `ObjectGridSchema`, `ObjectGrid` reads it, and only this forwarding hop lost
 * it. That silent-success shape is the defect, not the missing feature.
 *
 * Maintainer ruling of 2026-08-18 (verbatim 「同意」): extend the whitelist so
 * the canonical keys take effect, keeping the legacy spellings as WORKING
 * aliases. Both halves are pinned here — a fix that quietly retired the legacy
 * spelling would break every view authored against today's docs.
 *
 * PRECEDENCE, when an author writes both: the canonical key wins. Where
 * `ObjectView` itself resolves the pair (the non-grid fetch, and the delegated
 * `renderListView` schema) that choice is encoded in this file's `||` chains
 * and pinned below. On the grid path `ObjectView` forwards BOTH slots of the
 * pagination and selection pairs and `ObjectGrid` arbitrates canonical-first
 * (`schema.pagination?.pageSize ?? schema.pageSize`; `if (schema.selection
 * ?.type) … else if (schema.selectable !== undefined)`). Synthesising a
 * `pagination` object out of a legacy `pageSize` would flip `ObjectGrid`'s
 * `paginationEnabled` (`schema.pagination !== undefined ? true : …`) for every
 * view that only ever wrote the legacy key.
 *
 * objectui#11880 item 5: the FILTER pair is the exception on the grid path.
 * `ObjectView` resolves it itself and hands the winner in `filter` alone,
 * never writing `defaultFilters`: `ObjectGrid`'s export and page reset read
 * `filter` only, so a value in the legacy slot narrowed the rows but not the
 * download. The precedence is unchanged (the canonical key wins unless it
 * lowers to nothing), and `ObjectView.gridFilterHandoff-11880.test.tsx` reads
 * it through the real grid.
 */
describe('ObjectView.canonicalTableKeys', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>;
    standIns.objectGrid = ({ schema }: any) => {
      gridSchemas.push(schema);
      return <div data-testid="object-grid" />;
    };
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  /**
   * The grid the view delegates to, replaced by a probe that records the schema
   * it was handed. What reaches this object IS the forwarding whitelist.
   */
  const gridSchemas: any[] = [];

  const mockDataSource = () => ({
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
  });

  /** Render on the grid path and return the schema ObjectGrid was handed. */
  function forwardedGridSchema(schema: Partial<ObjectViewSchema>): any {
    gridSchemas.length = 0;
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
        dataSource={mockDataSource() as any}
      />,
    );
    return gridSchemas[0];
  }

  /** Render on a NON-grid path (ObjectView fetches for itself) and return `find`. */
  function nonGridFind(schema: Partial<ObjectViewSchema>) {
    const ds = mockDataSource();
    render(
      <ObjectView
        schema={{
          type: 'object-view',
          objectName: 'task',
          // Anything but `grid` — the grid path delegates its fetch to ObjectGrid.
          defaultViewType: 'calendar',
          ...schema,
        } as ObjectViewSchema}
        dataSource={ds as any}
      />,
    );
    return ds.find;
  }

  async function queryParams(find: ReturnType<typeof vi.fn>) {
    await waitFor(() => expect(find).toHaveBeenCalled());
    return find.mock.calls[0][1];
  }

  /** Render through the delegated `renderListView` slot and return its schema. */
  function delegatedSchema(schema: Partial<ObjectViewSchema>): any {
    const seen: any[] = [];
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'task', ...schema } as ObjectViewSchema}
        dataSource={mockDataSource() as any}
        renderListView={({ schema: s }: any) => { seen.push(s); return <div data-testid="delegated" />; }}
      />,
    );
    return seen[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    gridSchemas.length = 0;
  });

  describe('grid path: the canonical table keys reach ObjectGrid', () => {
    // Each of these four was `undefined` on the forwarded schema before
    // objectui#5102 — the value the author wrote never left ObjectView.
    it('forwards table.pagination', () => {
      const grid = forwardedGridSchema({ table: { pagination: { pageSize: 25 } } as any });
      expect(grid.pagination).toEqual({ pageSize: 25 });
    });

    it('forwards table.pagination.pageSizeOptions along with it', () => {
      const grid = forwardedGridSchema({
        table: { pagination: { pageSize: 25, pageSizeOptions: [25, 50] } } as any,
      });
      expect(grid.pagination).toEqual({ pageSize: 25, pageSizeOptions: [25, 50] });
    });

    it('forwards table.selection', () => {
      const grid = forwardedGridSchema({ table: { selection: { type: 'multiple' } } as any });
      expect(grid.selection).toEqual({ type: 'multiple' });
    });

    it('forwards table.filter', () => {
      const grid = forwardedGridSchema({ table: { filter: [['stage', '=', 'won']] } as any });
      expect(grid.filter).toEqual([['stage', '=', 'won']]);
    });

    it('forwards table.sort', () => {
      const grid = forwardedGridSchema({ table: { sort: [{ field: 'name', order: 'desc' }] } as any });
      expect(grid.sort).toEqual([{ field: 'name', order: 'desc' }]);
    });

    it('forwards table.sort VERBATIM — even the retired string form (objectui#8221)', () => {
      // `ObjectGridSchema.sort` is `SortConfig[]` since decision batch #77; the
      // string arm is retired. This delegation is nonetheless VALUE-AGNOSTIC and
      // stays that way on purpose: a stored metadata row still reaches it
      // carrying the old spelling, and the place that judges the value is the
      // shared sink downstream (`ObjectView.sortSink.test.tsx` pins the refusal
      // and its diagnostic). Coercing or dropping it here would put a second
      // opinion about the sort dialect in the delegation path — the fourth
      // dialect this whole chain exists to avoid.
      const grid = forwardedGridSchema({ table: { sort: 'name desc' } as any });
      expect(grid.sort).toBe('name desc');
    });
  });

  describe('grid path: the legacy spellings still work', () => {
    it('still forwards table.pageSize', () => {
      expect(forwardedGridSchema({ table: { pageSize: 25 } as any }).pageSize).toBe(25);
    });

    it('still forwards table.selectable', () => {
      expect(forwardedGridSchema({ table: { selectable: true } as any }).selectable).toBe(true);
    });

    it('no longer reads a retired table.defaultFilters — and does not rescue it into `filter` (objectui#12030)', () => {
      // Flipped from `still honours table.defaultFilters, handed over in
      // `filter`. Neither slot carries it.
      const grid = forwardedGridSchema({ table: { defaultFilters: { status: 'active' } } as any });
      expect(grid.filter).toBeUndefined();
      expect(grid.defaultFilters).toBeUndefined();
      // CONTROL, same path: the canonical spelling still arrives.
      expect(forwardedGridSchema({ table: { filter: [['status', '=', 'active']] } as any }).filter)
        .toEqual([['status', '=', 'active']]);
    });

    it('no longer forwards a retired table.defaultSort — and does not rescue it into `sort` (objectui#5861)', () => {
      // Flipped from `still forwards table.defaultSort`. Neither slot carries it:
      // re-emitting the value into the canonical `sort` would be the tolerant
      // alias the retirement exists to end, just moved one hop.
      const grid = forwardedGridSchema({ table: { defaultSort: { field: 'name', order: 'asc' } } as any });
      expect(grid.defaultSort).toBeUndefined();
      expect(grid.sort).toBeUndefined();
      // CONTROL, same path: the canonical spelling still arrives.
      expect(forwardedGridSchema({ table: { sort: [{ field: 'name', order: 'asc' }] } as any }).sort)
        .toEqual([{ field: 'name', order: 'asc' }]);
    });

    it('leaves a canonical slot empty when only the legacy key is written', () => {
      // The alias must not be re-emitted into the canonical slot: `ObjectGrid`
      // keys `paginationEnabled` off `schema.pagination !== undefined`, so a
      // synthesised `pagination` would turn pagination on for legacy authors.
      const grid = forwardedGridSchema({
        table: { pageSize: 25, selectable: true, defaultFilters: { a: 1 }, defaultSort: { field: 'n', order: 'asc' } } as any,
      });
      expect(grid.pagination).toBeUndefined();
      expect(grid.selection).toBeUndefined();
      expect(grid.sort).toBeUndefined();
      // objectui#12030 — the retired filter alias is not read, so nothing
      // reaches the one filter slot the node carries either.
      expect(grid.filter).toBeUndefined();
      expect(grid.defaultFilters).toBeUndefined();
    });
  });

  describe('grid path: both spellings written', () => {
    // ObjectView forwards both slots of the pagination and selection pairs and
    // ObjectGrid arbitrates canonical-first (see the file header). The filter
    // pair is resolved here instead (objectui#11880 item 5): the canonical value
    // arrives in `filter` and no `defaultFilters` is written.
    it('puts each canonical value in its slot; the paging aliases ride theirs, the filter alias is not written', () => {
      const grid = forwardedGridSchema({
        table: {
          pagination: { pageSize: 25 },
          pageSize: 10,
          selection: { type: 'multiple' },
          selectable: false,
          filter: [['stage', '=', 'won']],
          defaultFilters: { stage: 'lost' },
          sort: [{ field: 'name', order: 'desc' }],
          defaultSort: { field: 'created', order: 'asc' },
        } as any,
      });
      expect(grid.pagination).toEqual({ pageSize: 25 });
      expect(grid.pageSize).toBe(10);
      expect(grid.selection).toEqual({ type: 'multiple' });
      expect(grid.selectable).toBe(false);
      expect(grid.filter).toEqual([['stage', '=', 'won']]);
      expect(grid.defaultFilters).toBeUndefined();
      expect(grid.sort).toEqual([{ field: 'name', order: 'desc' }]);
      // objectui#5861 — the sort pair has no legacy slot any more: the retired
      // `defaultSort` is dropped, not forwarded beside the canonical value.
      expect(grid.defaultSort).toBeUndefined();
    });
  });

  describe('grid path: a named view still outranks the table segment', () => {
    // The FILTER segments ahead of `table` (`listViews` entry, then `activeView`)
    // ride `filter` since objectui#11880 item 5, the one filter slot the node
    // carries, so the view's filter must be the value in it: a `table.filter`
    // there would outrank the view the user is looking at.
    //
    // The SORT half moved in objectui#5270 — see the sort assertion below for
    // why, and `ObjectView.namedViewSortArity.test.tsx` for the two consumers
    // that made the old slot unreadable. What is pinned here either way is the
    // PRECEDENCE, which the move preserves: the view still outranks `table`.
    const namedView = {
      listViews: {
        won: {
          label: 'Won',
          filter: [['stage', '=', 'won']],
          sort: [{ field: 'name', order: 'desc' }],
        },
      },
      defaultListView: 'won',
    };

    it('keeps the named view filter in force over a table.filter', () => {
      const grid = forwardedGridSchema({
        ...namedView,
        table: { filter: [['stage', '=', 'lost']] } as any,
      } as any);
      expect(grid.filter).toEqual([['stage', '=', 'won']]);
      expect(grid.defaultFilters).toBeUndefined();
    });

    it('keeps the named view sort in force over a table.sort', () => {
      // objectui#5102 pinned this as `sort: undefined` +
      // `defaultSort: [{ field: 'name', order: 'desc' }]` and said in so many
      // words that the pin should be UPDATED, not deleted, by whoever fixed the
      // arity. Updated here: the array now rides the canonical slot — the only
      // one of the two whose declared type (`SortConfig[]`) can hold more than
      // one key — and the legacy slot carries the `table` segment alone. Precedence is what this block asserts and it is unchanged:
      // ObjectGrid resolves `schemaSort ?? defaultSort`, so the named view wins
      // over `table.sort` because it is what reaches the canonical slot.
      const grid = forwardedGridSchema({
        ...namedView,
        table: { sort: [{ field: 'created', order: 'asc' }] } as any,
      } as any);
      expect(grid.sort).toEqual([{ field: 'name', order: 'desc' }]);
      expect(grid.defaultSort).toBeUndefined();
    });

    it('keeps the named view sort in force, and a retired table.defaultSort beside it is not forwarded (objectui#5861)', () => {
      // This used to assert the `table` segment rode the legacy slot beside the
      // view's canonical one. The legacy slot is gone: the view sort still wins,
      // and the retired key reaches ObjectGrid in neither slot.
      const grid = forwardedGridSchema({
        ...namedView,
        table: { defaultSort: { field: 'created', order: 'asc' } } as any,
      } as any);
      expect(grid.sort).toEqual([{ field: 'name', order: 'desc' }]);
      expect(grid.defaultSort).toBeUndefined();
    });
  });

  describe('non-grid path: ObjectView resolves the pair itself, canonical first', () => {
    // Calendar / kanban / gallery / timeline fetch through ObjectView, so the
    // precedence chosen for this card is directly observable on the wire here.
    //
    // ⚠️ objectui#4869 REWROTE the three `$orderby` expectations below, and the
    // maintainer ruling of 2026-08-22 authorises exactly that. They used to pin
    // the AUTHORED value reaching `$orderby` VERBATIM — which for the legacy
    // `table.defaultSort` spelling was a live `400 INVALID_SORT`: a single
    // `{ field, order }` object is read by the adapter as an `$orderby` MAP, so
    // `Object.entries` folded it to the wire string `field,order`, two columns
    // that do not exist, and the view came back EMPTY. This read site now lowers
    // the whole chain through the shared sink (`convertSortToQueryParams`), so
    // the assertions moved to the LOWERED value — the same value, in the one
    // normalized shape every other object-bound block already sends.
    //
    // What objectui#5102 put here is NOT weakened by that: each expectation is
    // still an exact `toEqual` on a fully specified map. What changed is the
    // shape they arrive in, which is the defect objectui#4869 fixed. See
    // `ObjectView.sortSink.test.tsx` for the read-site evidence.
    //
    // ⚠️ objectui#5861 then RETIRED the legacy half of the sort pair: the two
    // cells below that pinned `table.defaultSort` as working now pin it inert —
    // no `$orderby` from it alone, and no effect beside a canonical `table.sort`.
    it('queries with a canonical table.filter', async () => {
      const params = await queryParams(nonGridFind({ table: { filter: [['stage', '=', 'won']] } as any }));
      expect(params.$filter).toEqual([['stage', '=', 'won']]);
    });

    it('lowers a ViewFilterRule[] table.filter through the shared sink', async () => {
      // Same treatment the retired `table.defaultFilters` got — the canonical key
      // reaches `$filter` as AST, not as bare rule objects (objectui#3431).
      const params = await queryParams(
        nonGridFind({ table: { filter: [{ field: 'stage', operator: 'eq', value: 'won' }] } as any }),
      );
      expect(params.$filter).toEqual([['stage', 'equals', 'won']]);
    });

    it('queries with table.filter alone when a retired table.defaultFilters is written beside it', async () => {
      const params = await queryParams(
        nonGridFind({
          table: { filter: [['stage', '=', 'won']], defaultFilters: { stage: 'lost' } } as any,
        }),
      );
      expect(params.$filter).toEqual([['stage', '=', 'won']]);
    });

    it('a retired table.defaultFilters alone filters NOTHING (objectui#12030)', async () => {
      // Flipped from `still queries with table.defaultFilters alone`, which
      // asserted `['status', '=', 'active']`. The canonical control is `queries
      // with a canonical table.filter` above, on this same path.
      const params = await queryParams(nonGridFind({ table: { defaultFilters: { status: 'active' } } as any }));
      expect(params.$filter).toBeUndefined();
    });

    it('orders by a canonical table.sort', async () => {
      const params = await queryParams(nonGridFind({ table: { sort: [{ field: 'name', order: 'desc' }] } as any }));
      expect(params.$orderby).toEqual({ name: 'desc' });
    });

    it('orders by table.sort alone when a retired table.defaultSort is written beside it', async () => {
      const params = await queryParams(
        nonGridFind({
          table: { sort: [{ field: 'name', order: 'desc' }], defaultSort: { field: 'created', order: 'asc' } } as any,
        }),
      );
      expect(params.$orderby).toEqual({ name: 'desc' });
    });

    it('a retired table.defaultSort alone orders NOTHING (objectui#5861)', async () => {
      // Flipped from `still orders by table.defaultSort alone`, which asserted
      // `{ created: 'asc' }`. The key is an ADR-0049 tombstone the protocol
      // refuses by name, so this read site no longer lowers it: the query goes
      // out unsorted. The canonical control is `orders by a canonical
      // table.sort` above, on this same path.
      const params = await queryParams(nonGridFind({ table: { defaultSort: { field: 'created', order: 'asc' } } as any }));
      expect(params.$orderby).toBeUndefined();
    });
  });

  describe('delegated renderListView: canonical first, filter and sort aliases retired', () => {
    it('hands over a canonical table.filter', () => {
      expect(delegatedSchema({ table: { filter: [['stage', '=', 'won']] } as any }).filter)
        .toEqual([['stage', '=', 'won']]);
    });

    it('hands over table.filter alone when a retired table.defaultFilters is written beside it', () => {
      const s = delegatedSchema({
        table: { filter: [['stage', '=', 'won']], defaultFilters: { stage: 'lost' } } as any,
      });
      expect(s.filter).toEqual([['stage', '=', 'won']]);
    });

    it('a retired table.defaultFilters alone hands over no filter (objectui#12030)', () => {
      // Flipped from `still hands over table.defaultFilters alone`. The canonical
      // control is `hands over a canonical table.filter` above.
      expect(delegatedSchema({ table: { defaultFilters: { status: 'active' } } as any }).filter)
        .toBeUndefined();
    });

    it('hands over a canonical table.sort, and a retired table.defaultSort beside it changes nothing', () => {
      const SORT = [{ field: 'name', order: 'desc' }];
      expect(delegatedSchema({ table: { sort: SORT } as any }).sort).toEqual(SORT);
      const s = delegatedSchema({
        table: { sort: SORT, defaultSort: { field: 'created', order: 'asc' } } as any,
      });
      expect(s.sort).toEqual(SORT);
    });

    it('hands over NO sort for a retired table.defaultSort alone (objectui#5861)', () => {
      // Flipped from `still hands over table.defaultSort alone — WRAPPED`, which
      // asserted `[{ field: 'created', order: 'asc' }]` (objectui#6235's wrap of
      // the legacy single entry into the `SortConfig[]` the slot declares). The
      // key is retired, so there is nothing to wrap: the delegated node gets no
      // `sort`, exactly as if none had been authored. Canonical control: the
      // cell above, on this same path.
      expect(delegatedSchema({ table: { defaultSort: { field: 'created', order: 'asc' } } as any }).sort)
        .toBeUndefined();
    });
  });
});

// ── ObjectView.createGrant-12082 ───────────────────────────────────────────

/**
 * objectui#12082 — the `object-view` toolbar's create button reads the
 * `listNew` row of the affordance-to-grant map.
 *
 * Before, the button read the node's own `showCreate` and `operations.create`
 * toggles and no grant at all, so a caller without the create grant was
 * offered a New that opened a form the server then refused to save. The
 * console's own list pages already read `listNew` (`ObjectView` /
 * `ObjectDataPage` in `@object-ui/app-shell`); this is the same affordance on
 * the SDUI `object-view` node, so it reads the same row.
 *
 * Measured through the REAL `MePermissionsProvider`, over the four grant
 * shapes the map's enumeration pin uses. The authoring toggles still narrow:
 * `showCreate: false` hides the button under the full grant.
 */
describe('ObjectView.createGrant-12082', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>;
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  afterEach(cleanup);

  const OBJECT = 'contacts';

  const dataSource = (): DataSource => ({
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue({ name: OBJECT, label: 'Contacts', fields: { name: { type: 'text' } } }),
  } as unknown as DataSource);

  const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; create: boolean }> = [
    { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, create: true },
    { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, create: false },
    { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, create: false },
    { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, create: true },
  ];

  const envelope = (bits: Record<string, boolean>): MePermissionsAuthenticatedResponse => ({
    authenticated: true,
    userId: 'u-pin',
    tenantId: null,
    hasAnyQueue: false,
    positions: ['member'],
    permissionSets: ['member'],
    objects: { [OBJECT]: bits },
    fields: {},
  });

  const schema = (extra: Partial<ObjectViewSchema> = {}): ObjectViewSchema => ({ type: 'object-view', objectName: OBJECT, ...extra });

  describe('object-view create button reads the listNew row (objectui#12082)', () => {
    it.each(SHAPES)('$shape grant: New shows exactly when the create grant allows it', async ({ bits, create }) => {
      render(
        <MePermissionsProvider initialPermissions={envelope(bits)}>
          <ObjectView schema={schema()} dataSource={dataSource()} />
        </MePermissionsProvider>,
      );
      // Wait for the schema read to settle so the policy layer has its answer.
      await screen.findByTestId('object-grid');
      expect(screen.queryByRole('button', { name: 'New' }) !== null).toBe(create);
    });

    it('fail-open: with no permission provider mounted, New shows as before', async () => {
      render(<ObjectView schema={schema()} dataSource={dataSource()} />);
      await screen.findByTestId('object-grid');
      expect(screen.getByRole('button', { name: 'New' })).toBeDefined();
    });

    it('the authoring toggle still narrows: showCreate false hides New under the full grant', async () => {
      render(
        <MePermissionsProvider initialPermissions={envelope(SHAPES[3].bits)}>
          <ObjectView schema={schema({ showCreate: false })} dataSource={dataSource()} />
        </MePermissionsProvider>,
      );
      await screen.findByTestId('object-grid');
      expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    });

    it('the effective operation set still narrows: an apiOperations set without create hides New under the full grant', async () => {
      render(
        <MePermissionsProvider
          initialPermissions={{ ...envelope(SHAPES[3].bits), objects: { [OBJECT]: { ...SHAPES[3].bits, apiOperations: ['read', 'update'] } } }}
        >
          <ObjectView schema={schema()} dataSource={dataSource()} />
        </MePermissionsProvider>,
      );
      await screen.findByTestId('object-grid');
      expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    });
  });
});

// ── ObjectView.calendarBinding-7029 ────────────────────────────────────────

/**
 * objectui#7029 — the SECOND route to `ObjectCalendar` invents nothing either.
 *
 * Ruled on objectstack#13748 (director batch #19, option A): ⛔ either way no
 * invented field names. The card measured the console route
 * (`app-shell/ObjectView` → `plugin-list/ListView` → `ObjectCalendar`); this
 * file covers the other one. `generateViewSchema` runs precisely when no host
 * supplied `renderListView` — the authored `object-view` element, which is what
 * `examples/schema-catalog`'s object-view fixtures drive — so it bypasses
 * `ListView` entirely and carried its OWN copy of the fabrication:
 * `startDateField: 'start_date'`, `endDateField: 'end_date'`,
 * `titleField: 'name'` for a view that declared none.
 *
 * Fixing only the console route would have left this one rendering the same
 * plausible, fully wrong screen the card exists to remove, and would have made
 * the fix's own claim ("no invented field names") false in the repo it was
 * merged into.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore the three `||` floors in this branch and the "invents NO binding"
 * case goes RED (it reads the fabricated names) while the declared-config
 * CONTROL stays GREEN in either world.
 */
describe('ObjectView.calendarBinding-7029', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    };
    standIns.objectGrid = () => <div data-testid="object-grid" />;
    standIns.objectForm = () => <div data-testid="object-form" />;
  });

  /** Every schema the view hands to SchemaRenderer, in order. */
  const rendered: any[] = [];

  async function renderCalendarView(view: Record<string, unknown>) {
    rendered.length = 0;
    const ds: any = {
      find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'crm_leave_request', fields: {} }),
    };
    render(
      <ObjectView
        schema={{ type: 'object-view', objectName: 'crm_leave_request' } as ObjectViewSchema}
        views={[{ id: 'c', label: 'Calendar', type: 'calendar' as any, ...view }]}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
    return rendered[rendered.length - 1];
  }

  /**
   * The emitted binding. objectstack#25923: it goes out as the node's own
   * `calendar` block, never flat (the spec refuses the five flat on
   * `object-calendar`). The guard reds if a flat spelling comes back.
   */
  const blockOf = (node: any): Record<string, any> => {
    for (const key of ['startDateField', 'endDateField', 'titleField', 'colorField', 'allDayField']) {
      expect(node, `flat ${key} on the node`).not.toHaveProperty(key);
    }
    return node.calendar ?? {};
  };

  describe('ObjectView.generateViewSchema — calendar restates only a DECLARED binding (objectui#7029)', () => {
    it('invents NO binding for a calendar view that declares no config', async () => {
      const schema = await renderCalendarView({});
      expect(schema.type).toBe('object-calendar');
      // All three used to be fabricated here. Absent bindings are the only route
      // to `ObjectCalendar`'s refusal screen.
      expect(blockOf(schema).startDateField).toBeUndefined();
      expect(blockOf(schema).endDateField).toBeUndefined();
      expect(blockOf(schema).titleField).toBeUndefined();
    });

    it('CONTROL: forwards a declared calendar block unchanged', async () => {
      // A correctly configured calendar renders exactly as it did before this
      // card — without this case a fix that emitted nothing at all would look
      // identical to the fix that was ruled.
      const schema = await renderCalendarView({
        calendar: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'subject' },
      });
      expect(schema.type).toBe('object-calendar');
      expect(blockOf(schema).startDateField).toBe('start_date');
      expect(blockOf(schema).endDateField).toBe('end_date');
      expect(blockOf(schema).titleField).toBe('subject');
    });

    it('CONTROL: a partially declared block keeps its declared half and only that', async () => {
      const schema = await renderCalendarView({ calendar: { startDateField: 'start_date' } });
      expect(blockOf(schema).startDateField).toBe('start_date');
      expect(blockOf(schema).endDateField).toBeUndefined();
      expect(blockOf(schema).titleField).toBeUndefined();
    });
  });
});

// ── ObjectView.formTitleNoProviderFallback ─────────────────────────────────

/**
 * `ObjectView`'s create / edit / view form title still resolves to ENGLISH, and
 * to the SAME BYTES as before, when no `I18nProvider` is mounted —
 * objectui#3462.
 *
 * This is not a nice-to-have. Routing a literal through `t()` without a working
 * default is exactly how a provider-less consumer breaks, and it breaks in a
 * suite that is not this one: `object-view` renders wherever its type is
 * registered, so any host that renders schema without mounting a provider (this
 * package's own tests, the preview gallery, an embedding app) reads whatever the
 * defaults map says. The English defaults live in `VIEW_DEFAULT_TRANSLATIONS`
 * (`ObjectView.tsx`) — that map is what `createSafeTranslation` falls back to
 * when its `detail.recordDetailWithLabel` probe comes back unresolved, and it is
 * what interpolates `{{object}}`.
 *
 * The byte-identity matters beyond aesthetics: the heading is `View Contacts`
 * before the change and `View Contacts` after, so e2e specs and host tests that
 * address this chrome by its English name keep addressing it.
 *
 * Direction: this file was GREEN before the change and is GREEN after. It pins
 * the FALLBACK, not the fix — the fix is asserted in
 * `ObjectView.formTitleI18n.test.tsx`. A missing map entry would turn it red by
 * rendering the raw key `form.viewTitle`, which is precisely the regression it
 * exists to catch.
 *
 * ── Why it can share this file with a block that mounts a provider ────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`. So once a test mounts
 * `<I18nProvider config={{ defaultLanguage: 'zh' }}>`, a later "no provider"
 * render resolves against the Chinese instance unless something puts the global
 * back, and this pin was first written as a file of its own for that reason.
 * `vitest.setup.i18n-global.ts` (objectui#4514) now restores the global after
 * every test, which is what lets this block run after
 * `ObjectView.formLabelsI18nLabel-10993` above, a block that mounts a zh
 * provider. Still: **do not import or mount `I18nProvider` in this block.**
 */
describe('ObjectView.formTitleNoProviderFallback', () => {
  restoreAfterBlock();

  beforeEach(() => {
    standIns.schemaRenderer = ({ schema }: any) => (
      <div data-testid="schema-renderer" data-schema-type={schema?.type}>
        {schema?.type}
      </div>
    );
    standIns.objectGrid = ({ schema, onRowClick, onEdit }: any) => (
      <div data-testid="object-grid" data-object={schema?.objectName}>
        <button data-testid="grid-row" onClick={() => onRowClick?.({ id: '1', name: 'Test' })}>
          Row 1
        </button>
        <button data-testid="grid-edit" onClick={() => onEdit?.({ id: '1', name: 'Test' })}>
          Edit row 1
        </button>
      </div>
    );
    standIns.objectForm = ({ schema }: any) => (
      <div data-testid="object-form" data-mode={schema?.mode}>
        Form ({schema?.mode})
      </div>
    );
  });

  function dataSourceLabelled(label?: string): DataSource {
    return {
      find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Test' }], total: 1 }),
      findOne: vi.fn().mockResolvedValue({ id: '1', name: 'Test' }),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'contacts',
        ...(label ? { label } : {}),
        fields: { name: { label: 'Name', type: 'text' } },
      }),
    } as unknown as DataSource;
  }

  function renderView(label?: string) {
    return render(
      <ObjectView
        schema={{
          type: 'object-view',
          objectName: 'contacts',
          navigation: { mode: 'drawer' },
        } as never}
        dataSource={dataSourceLabelled(label)}
      />,
    );
  }

  const openView = () => fireEvent.click(screen.getByTestId('grid-row'));
  const openEdit = () => fireEvent.click(screen.getByTestId('grid-edit'));
  const openCreate = () => fireEvent.click(screen.getByRole('button', { name: 'New' }));

  afterEach(() => cleanup());

  describe('ObjectView form title — English fallback with no provider (objectui#3462)', () => {
    it('heads a view-mode drawer "View {label}", never the raw key', async () => {
      renderView('Contacts');
      openView();

      await waitFor(() => expect(screen.getByText('View Contacts')).toBeInTheDocument());
      expect(screen.queryByText('form.viewTitle')).toBeNull();
    });

    it('heads an edit-mode drawer "Edit {label}", never the raw key', async () => {
      renderView('Contacts');
      openEdit();

      await waitFor(() => expect(screen.getByText('Edit Contacts')).toBeInTheDocument());
      expect(screen.queryByText('form.editTitle')).toBeNull();
    });

    it('heads a create-mode drawer "Create {label}", never the raw key', async () => {
      renderView('Contacts');
      openCreate();

      await waitFor(() => expect(screen.getByText('Create Contacts')).toBeInTheDocument());
      expect(screen.queryByText('form.createTitle')).toBeNull();
    });

    it('falls back to the objectName when the object declares no label', async () => {
      renderView();
      openView();

      await waitFor(() => expect(screen.getByText('View contacts')).toBeInTheDocument());
    });
  });
});
