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
