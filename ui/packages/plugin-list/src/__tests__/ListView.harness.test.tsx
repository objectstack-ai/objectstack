/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ListView's shared harness: per-issue pins that render the real `ListView`
 * with no `vi.mock` at all, folded into one file (objectstack#29469, the
 * rollout of objectstack#25911's pilot).
 *
 * Each block below was its own file, named in its `describe`. Under the `dom`
 * project's `isolate: true`, each of those files paid the whole module graph's
 * import again, and the import was nearly all of a file's time. Here the graph
 * loads once. Every block keeps its fixtures, hooks and assertions as they
 * were, and its issue number in its `describe`.
 *
 * Isolation between blocks:
 *  - React Testing Library's `cleanup()` runs after every test (the `dom`
 *    setup registers it).
 *  - Every fixture, data source and call log is declared inside its block, and
 *    the hooks that were module-level in a former file are its block's own.
 *  - No block mocks a module. A block that needs a stand-in renderer registers
 *    it in `ComponentRegistry` in its own hooks, and those blocks sit after the
 *    ones that register nothing.
 *  - Every block's first line is `restoreAfterBlock()` (below). A former file
 *    got a fresh window and a fresh registry; a block shares both with the
 *    blocks after it, so after its last test the helper puts back what the
 *    block left: registry entries, a swapped-in `localStorage` or
 *    `window.print`, the contents of both storages, and the `lang` / `dir`
 *    that `I18nProvider` sets on `<html>`. The next block starts where its
 *    file did.
 *  - react-i18next's global instance, which a mounted `I18nProvider`
 *    installs, is put back after every test by `vitest.setup.i18n-global.ts`,
 *    so a block that mounts no provider still renders with none.
 *  - `I18nProvider` is imported once, from `@object-ui/i18n`; `@object-ui/react`
 *    re-exports that same binding, which is where some former files took it.
 *
 * A new `ListView` pin that needs no `vi.mock` joins this file as its own
 * top-level `describe` that opens with `restoreAfterBlock()`; one that
 * registers a stand-in renderer goes after the blocks that register nothing.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, waitFor, cleanup, screen, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { SchemaRendererProvider, FilterScopeProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { ActiveListRecordProvider } from '@object-ui/components';
import {
  ComponentRegistry,
  attachObjectSortability,
  declaredNameField,
  getRecordDisplayName,
  recordDisplayValueAt,
} from '@object-ui/core';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import type { ListViewSchema } from '@object-ui/types';
import { ListView, LIST_DEFAULT_TRANSLATIONS } from '../ListView';
import { filterNamesCurrentUser } from '../ListEmptyState';

/**
 * Puts back, after the calling block's last test, what the block's hooks and
 * tests left behind, so the next block starts from the state its former file
 * started from. Measured before this existed: three blocks left stand-in
 * renderers registered or the real `object-grid` unregistered, one left its
 * `localStorage` stand-in installed, and a view preference one block saved was
 * still in storage for the four blocks after it. `printButtonSemantics` swaps
 * in a `window.print` spy, and the helper puts that back too.
 *
 * Declared first in the block, so its `beforeAll` runs before the block's own
 * and its `afterAll` after them (Vitest runs after-hooks in reverse order).
 */
function restoreAfterBlock() {
  let registered = new Map<string, ReturnType<typeof ComponentRegistry.getConfig>>();
  let storage: PropertyDescriptor | undefined;
  let print: PropertyDescriptor | undefined;
  beforeAll(() => {
    registered = new Map(ComponentRegistry.getAllTypes().map((type) => [type, ComponentRegistry.getConfig(type)]));
    storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    print = Object.getOwnPropertyDescriptor(window, 'print');
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
    // A block that swaps in a `window.print` spy leaves it installed otherwise.
    if (print) Object.defineProperty(window, 'print', print);
    else delete (window as { print?: unknown }).print;
    window.localStorage.clear();
    window.sessionStorage.clear();
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
  });
}

// ── ListView.concurrencyTokenProjection-12292 ───────────────────────────────────

/**
 * objectui#12292 — the SECOND projection build site, for the rows' concurrency
 * token.
 *
 * The grid's inline-edit save sends each row's `updated_at` as `If-Match`. In
 * the console the rows do not come from the grid's own query: `ListView`
 * fetches them and hands them down, and its `$select` was built from the
 * columns. A list that shows no `updated_at` column therefore handed the grid
 * rows with no token, and every save from it went out unguarded, exactly as
 * the card reproduced on the showcase task grid. `plugin-grid`'s
 * `inlineEditConcurrency-12292.test.tsx` pins the grid's own build site; this
 * pins this one.
 */
describe('ListView.concurrencyTokenProjection-12292', () => {
  restoreAfterBlock();

  const OBJECT = 'task_12292';

  const objectDef = {
    name: OBJECT,
    label: 'Task',
    fields: {
      id: { name: 'id', type: 'text' },
      title: { name: 'title', type: 'text', label: 'Title' },
      estimate_hours: { name: 'estimate_hours', type: 'number', label: 'Estimate' },
    },
  };

  const makeDataSource = () =>
    ({
      find: vi.fn(async () => ({ data: [], total: 0 })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => objectDef),
    }) as any;

  /** Mount a list view; `lastSelect` reads the `$select` of its latest query. */
  async function mount(schemaExtra: Record<string, unknown>) {
    const dataSource = makeDataSource();
    const schema: any = {
      type: 'list-view',
      objectName: OBJECT,
      viewType: 'grid',
      columns: ['title', 'estimate_hours'],
      ...schemaExtra,
    };
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView schema={schema} dataSource={dataSource} />
      </SchemaRendererProvider>,
    );
    const lastSelect = () => (dataSource.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
    // The projection reads the object's definition, so wait for a query that
    // was built with it: its `$select` names a declared column.
    await waitFor(() => expect(lastSelect()).toContain('estimate_hours'));
    return { dataSource, lastSelect };
  }

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  describe('ListView — an inline-editable grid\'s rows carry their concurrency token (objectui#12292)', () => {
    it('asks for `updated_at` when the grid opens in inline-edit mode, though no column shows it', async () => {
      const { lastSelect } = await mount({ inlineEdit: true });
      await waitFor(() => expect(lastSelect()).toContain('updated_at'));
      expect(lastSelect()).toEqual(expect.arrayContaining(['id', 'title', 'estimate_hours']));
    });

    it('does not ask for it while the grid is not in inline-edit mode', async () => {
      const { dataSource, lastSelect } = await mount({});
      await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
      expect(dataSource.find.mock.calls.length).toBeGreaterThan(0);
      for (const call of dataSource.find.mock.calls) {
        expect(call[1]?.$select ?? []).not.toContain('updated_at');
      }
      expect(lastSelect()).toEqual(expect.arrayContaining(['id', 'title', 'estimate_hours']));
    });
  });
});

// ── ListView.contractEnvelope-6917 ───────────────────────────────────────────

/**
 * ListView reads its match total as `QueryResult` DECLARES it — and does NOT
 * read `count` (objectui#6917 arm B, following objectui#6840).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one count member:
 * `total`. Before this pin the fetch effect read
 *
 *     (results as any).total ?? (results as any).count
 *
 * — the same arm objectui#6840 deleted from `RelatedCountStore`, in a module
 * that card was not fenced to touch. It decides a rendered number (the record
 * count bar) and, through `serverTotal`, whether the grid pages server-side at
 * all.
 *
 * MEASURED on this tree for objectui#6917 — its OWN producer census. #6840's
 * zero is seam-local and must not be carried here: the same sweep read 0
 * producers for `value` at `ObjectView`'s seam and 5 at `extractRecords`'
 * seam (objectui#6839) in one and the same pass.
 *
 *   CELL      every `find()` producer body in the repo, bracket-scanned
 *             through chained calls .........................  592 producers
 *   CONTROL   `data`  emitted as an envelope member .........  312 producers
 *   CONTROL   `total` emitted as an envelope member .........  150 producers
 *   SUBJECT   `count` emitted as an envelope member ........     0 producers
 *
 * The controls sit on the JOIN — same cell, same pass, same extraction — so
 * the zero is a reading. Superset sweep too: of the 418 files holding a
 * `find()` producer, 25 contain the token `count:` anywhere and not one is an
 * envelope member (the DataSource's own sibling `count()` method, row fields,
 * i18n interpolation parameters, aggregate function names, React state, DOM
 * assertions, comments, and objectui#6840's own refusal pin).
 *
 * Both adapters' `normalizeQueryResult` fold `count` into `total` below the
 * fold; ListView calls `dataSource.find()` strictly above it, so the arm was
 * unreachable — exactly where a non-conforming producer keeps working
 * unrejected (AGENTS.md #0.1).
 *
 * ⛔ The fix is the deletion, NOT widening `QueryResult` to bless `count`.
 *
 * ⚠️ NOT fixed here, and deliberately: this same fetch effect ALSO unwraps rows
 * with `data → records → value`. That ladder is the `records`/`value` tolerance
 * set owned by objectui#6839's `extractRecords` family, not this card's
 * `count`/`value` residue, and objectui#6917 does not enumerate it. Reported
 * for #6839 rather than half-repaired here.
 */
describe('ListView.contractEnvelope-6917', () => {
  restoreAfterBlock();

  const OBJECT = 'showcase_contact';
  const PAGE_SIZE = 10;
  /** Three rows — fewer than the page size, so the row count and any server
   *  total are free to disagree and the disagreement is the whole measurement. */
  const ROWS = [
    { id: 'c-0', name: 'Ada' },
    { id: 'c-1', name: 'Grace' },
    { id: 'c-2', name: 'Alan' },
  ];

  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn() as any;
    }
  });
  afterEach(cleanup);

  function makeDataSource(answer: unknown) {
    return {
      find: vi.fn(async () => answer),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: async (name: string) => ({
        name,
        fields: { id: { type: 'text' }, name: { type: 'text' } },
      }),
    } as any;
  }

  const listSchema = (): ListViewSchema => ({
    type: 'list-view',
    objectName: OBJECT,
    fields: ['name'],
    // A page size is what turns on ListView's server-paging branch — the branch
    // that reads a server total at all.
    pagination: { pageSize: PAGE_SIZE },
  } as unknown as ListViewSchema);

  /**
   * Render against a `find()` answering `answer` and return the record-count
   * bar's text. Scoped by test id rather than queried globally: the digits of a
   * total can collide with row text, and `queryByText` throws on multiple
   * matches exactly as it does on none.
   */
  async function recordCountText(answer: unknown): Promise<string> {
    const ds = makeDataSource(answer);
    const { getByTestId } = render(
      // Without an English provider the `{{count}}` interpolation never runs and
      // the raw template reaches the DOM, which would make the count unassertable.
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={ds}>
          <ListView schema={listSchema()} dataSource={ds} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );
    let bar!: HTMLElement;
    await waitFor(() => {
      bar = getByTestId('record-count-bar');
      expect(within(bar).getByText(/record/)).toBeInTheDocument();
    });
    return within(bar).getByText(/record/).textContent ?? '';
  }

  describe('ListView find() envelope — objectui#6917', () => {
    it('still reads the server-side `total` — the contract\'s count member', async () => {
      expect(await recordCountText({ data: ROWS, total: 42 })).toBe('42 records');
    });

    it('does NOT read `count` — falls back to the honest page-local row count', async () => {
      // Before the fix this bar read "7 records" off an undeclared key. It now
      // reports what it can actually see rather than legitimising a second
      // de-facto contract.
      expect(await recordCountText({ data: ROWS, count: 7 })).toBe('3 records');
    });

    it('does NOT let `count` stand in when `total` is absent, even alongside rows', async () => {
      // The caricature guard: a reader that returned any number it could find in
      // the envelope would answer "7 records" here.
      expect(await recordCountText({ data: ROWS, count: 99 })).toBe('3 records');
    });

    it('`total` still outranks `count` — unchanged, and the control for the two above', async () => {
      // Green before AND after the fix: the arm that was always correct. Its
      // presence is what makes the refusals above a reading of THIS deletion
      // rather than of a ListView that stopped counting.
      expect(await recordCountText({ data: ROWS, total: 42, count: 7 })).toBe('42 records');
    });
  });
});

// ── ListView.emptyStateAccess-25898 ──────────────────────────────────────────

/**
 * objectstack#25898 — the list empty state tells "no records you can see" and
 * "nothing of yours yet" apart from "no records".
 *
 * Measured on the console: a sales rep who may read none of 38 cases opened
 * the case list and was told "Nothing here yet / Create your first record to
 * get started." beside no New button; and every "my …" view (`owner` equals
 * the current user) told an owner of nothing "No records match this view's
 * filter."
 *
 * Three cases, chosen by what the list knows:
 * - no filter, and the caller holds the create grant: today's first-run copy
 *   and the add-record action;
 * - no filter, and the caller is KNOWN not to hold it (the `listNew` row of the
 *   affordance-to-grant map, once permissions have loaded): "No records you can
 *   see", and no add-record action even when the view enables one;
 * - the view's declared filter names the signed-in user: "Nothing of yours
 *   yet", with the action only under the create grant.
 *
 * SUITE DIRECTION, predicted before running: the read-only and "my view" cases
 * are RED against the base commit (first-run copy / view-filter copy, and the
 * action drawn for a read-only caller); the create-grant, no-provider and
 * plain-filter cases are green in both worlds and pin that the fix leaves them
 * alone.
 */
describe('ListView.emptyStateAccess-25898', () => {
  restoreAfterBlock();

  afterEach(cleanup);

  const OBJECT = 'crm_case';
  const USER = 'u-rep';

  function emptyDataSource() {
    return {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }

  const READ_ONLY = { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false };
  const FULL = { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true };

  const envelope = (bits: Record<string, boolean>): MePermissionsAuthenticatedResponse => ({
    authenticated: true,
    userId: USER,
    tenantId: null,
    hasAnyQueue: false,
    positions: ['member'],
    permissionSets: ['member'],
    objects: { [OBJECT]: bits },
    fields: {},
  });

  /** A `list-view` node as an author writes it (FilterNode-array filters). */
  const authored = (node: Record<string, unknown>): ListViewSchema =>
    ({ type: 'list-view', objectName: OBJECT, fields: ['name'], addRecord: { enabled: true }, ...node }) as unknown as ListViewSchema;

  async function emptyState(
    schema: ListViewSchema,
    { bits, currentUserId }: { bits?: Record<string, boolean>; currentUserId?: string } = {},
  ): Promise<HTMLElement> {
    const ds = emptyDataSource();
    let tree: React.ReactNode = (
      <SchemaRendererProvider dataSource={ds as any}>
        <ListView schema={schema} dataSource={ds as any} onAddRecord={() => {}} />
      </SchemaRendererProvider>
    );
    if (currentUserId) tree = <FilterScopeProvider currentUserId={currentUserId}>{tree}</FilterScopeProvider>;
    if (bits) tree = <MePermissionsProvider initialPermissions={envelope(bits)}>{tree}</MePermissionsProvider>;
    const { container } = render(<>{tree}</>);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    });
    return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
  }

  const addAction = (panel: HTMLElement) => panel.querySelector('[data-testid="empty-state-add-record"]');

  describe('ListView empty state — no access vs no records (objectstack#25898)', () => {
    it('a caller without the create grant is told there is nothing they can see, and offered no Create', async () => {
      const panel = await emptyState(authored({}), { bits: READ_ONLY });
      expect(panel.textContent).toMatch(/No records you can see/);
      expect(panel.textContent).toMatch(/ask your administrator/);
      expect(panel.textContent).not.toMatch(/Nothing here yet/);
      expect(panel.textContent).not.toMatch(/Create your first record/);
      expect(addAction(panel)).toBeNull();
    });

    it('a caller with the create grant still gets the first-run copy and the action', async () => {
      const panel = await emptyState(authored({}), { bits: FULL });
      expect(panel.textContent).toMatch(/Nothing here yet/);
      expect(panel.textContent).toMatch(/Create your first record/);
      expect(addAction(panel)).not.toBeNull();
    });

    it('with no permission provider the copy is unchanged (fail-open)', async () => {
      const panel = await emptyState(authored({}));
      expect(panel.textContent).toMatch(/Nothing here yet/);
      expect(addAction(panel)).not.toBeNull();
    });

    it('a "my" view — its filter resolved to the caller\'s id — says the caller has none yet', async () => {
      const panel = await emptyState(
        authored({ filter: [['owner', '=', USER]] }),
        { bits: FULL, currentUserId: USER },
      );
      expect(panel.textContent).toMatch(/Nothing of yours yet/);
      expect(panel.textContent).not.toMatch(/No records match this view/);
      expect(addAction(panel)).not.toBeNull();
    });

    it('a "my" view for a caller without the create grant offers no Create', async () => {
      const panel = await emptyState(
        authored({ filter: [['owner', '=', USER]] }),
        { bits: READ_ONLY, currentUserId: USER },
      );
      expect(panel.textContent).toMatch(/Nothing of yours yet/);
      expect(addAction(panel)).toBeNull();
    });

    it('a filter that does not name the caller keeps the view-filter copy', async () => {
      const panel = await emptyState(
        authored({ filter: [['status', '=', 'open']] }),
        { bits: FULL, currentUserId: USER },
      );
      expect(panel.textContent).toMatch(/No matching records/);
      expect(panel.textContent).toMatch(/No records match this view/);
    });
  });

  describe('filterNamesCurrentUser (objectstack#25898)', () => {
    it('finds the caller in every filter shape a list receives', () => {
      expect(filterNamesCurrentUser([['owner', '=', USER]], USER)).toBe(true);
      expect(filterNamesCurrentUser([{ field: 'owner', operator: 'equals', value: USER }], USER)).toBe(true);
      expect(filterNamesCurrentUser({ owner: { $eq: USER } }, USER)).toBe(true);
      expect(filterNamesCurrentUser(['and', ['status', '=', 'open'], ['owner', '=', USER]], USER)).toBe(true);
    });

    it('reads the unresolved placeholder in both spellings', () => {
      expect(filterNamesCurrentUser([['owner', '=', '{current_user_id}']], undefined)).toBe(true);
      expect(filterNamesCurrentUser({ owner: '${current_user_id}' }, null)).toBe(true);
    });

    it('answers false for a filter about someone or something else, and with no id to compare', () => {
      expect(filterNamesCurrentUser([['owner', '=', 'u-other']], USER)).toBe(false);
      expect(filterNamesCurrentUser([['status', '=', 'open']], USER)).toBe(false);
      expect(filterNamesCurrentUser([['owner', '=', '']], '')).toBe(false);
      expect(filterNamesCurrentUser(undefined, USER)).toBe(false);
      expect(filterNamesCurrentUser([['note', '=', 'user-{current_user_id}']], USER)).toBe(false);
    });
  });
});

// ── ListView.emptyStateFilteredCopy ──────────────────────────────────────────

/**
 * objectui#4155 — a list emptied BY ITS OWN FILTER must not render the
 * first-run copy.
 *
 * The empty state already distinguished "filtered to empty" from "truly
 * empty", but it only counted SESSION filters: the search box, the user-filter
 * chips, and the filter panel's own conditions. The view's declared `filter`
 * was not counted, so a view returning nothing precisely because it is
 * filtered — `status not_in [archived, deleted]`, or a stale stored condition
 * — told the user "Nothing here yet / Create your first record" over an object
 * full of records.
 *
 * That is the misleading half of this issue: it reads as data loss or a
 * permission problem and sends triage away from the view layer. The copy is
 * the diagnosis the user gets, so the two cases must not share one string.
 *
 * SUITE DIRECTION, predicted before running: `a view filtered to empty says so`
 * is RED against `origin/main` (which renders the first-run copy) and green
 * after; the other two are green in both worlds — they pin that the fix does
 * not swallow the genuine first-run case or the author's own override.
 *
 * objectui#11687 — the second half: a view filter is not the USER's filter.
 * The "your current filters or search" message is said only when the user
 * applied one (search, user-filter chips, filter panel); a view emptied by its
 * own declared filter alone gets its own message (`list.viewFilterNoMatchesMessage`).
 * Measured on the console: Webhooks' Active view, zero rows, nothing applied.
 */
describe('ListView.emptyStateFilteredCopy', () => {
  restoreAfterBlock();

  /** A data source that answers every query with zero rows. */
  function emptyDataSource() {
    return {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
  }

  async function emptyState(
    schema: ListViewSchema,
    session: Pick<React.ComponentProps<typeof ListView>, 'initialFilters' | 'initialSearchTerm'> = {},
  ): Promise<HTMLElement> {
    const ds = emptyDataSource();
    const { container } = render(
      <SchemaRendererProvider dataSource={ds as any}>
        <ListView schema={schema} dataSource={ds as any} {...session} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    });
    return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
  }

  const BASE: ListViewSchema = {
    type: 'list-view',
    objectName: 'work_order',
    fields: ['name'],
  };

  /**
   * A `list-view` node as an AUTHOR writes it, before `normalizeListViewSchema`
   * folds the legacy vocabulary onto the spec's (#2890).
   *
   * `ListViewSchema` describes the CANONICAL surface, so it types `filter` as the
   * spec's `ViewFilterRule[]` (`{ field, operator, value }` objects). What
   * objectui actually stores and passes to `$filter` is an ObjectQL FilterNode
   * array — `[['status', 'not_in', ['archived']]]`, the form used below and the
   * form the issue's repro carries. That divergence is stated outright in the
   * normalizer's own contract note ("the spec types `filter` as `ViewFilterRule[]`
   * … so objectui's field is typed from the spec but used as something else …
   * That mismatch is real and out of scope here"), and it is the reason these
   * fixtures cannot be re-spelled into the declared shape: re-spelling them would
   * stop testing the filter form the renderer actually receives.
   *
   * So the assertion is deliberately made about pre-normalization input, and the
   * cast says exactly that rather than widening `ListViewSchema` to admit both —
   * widening is what would re-fork the vocabulary #2890 unified. The legacy input
   * vocabulary has no declared type of its own today; filed as #4337.
   */
  const authored = (node: Record<string, unknown>): ListViewSchema =>
    node as unknown as ListViewSchema;

  describe('ListView empty state — a filtered view says it is filtered (#4155)', () => {
    it('a view filtered to empty says "no matching records", not "nothing here yet"', async () => {
      const panel = await emptyState(
        authored({
          ...BASE,
          // The source-declared filter from the issue's repro.
          filter: [['status', 'not_in', ['archived', 'deleted']]],
        }),
      );

      expect(panel.textContent).toMatch(/No matching records/i);
      expect(panel.textContent).not.toMatch(/Nothing here yet/i);
      expect(panel.textContent).not.toMatch(/Create your first record/i);
    });

    // objectui#11687 — the Webhooks "Active" view: its own filter, zero rows,
    // and no filter or search from the user.
    it('a view filtered to empty names the VIEW\'s filter, not "your current filters or search"', async () => {
      const panel = await emptyState(
        authored({ ...BASE, filter: [{ field: 'active', operator: 'equals', value: true }] }),
      );

      expect(panel.textContent).toContain('No records match this view’s filter.');
      expect(panel.textContent).not.toMatch(/your current filters or search/i);
      expect(panel.textContent).not.toMatch(/Create your first record/i);
    });

    it('a search the user typed still gets the "your current filters or search" copy', async () => {
      const panel = await emptyState(BASE, { initialSearchTerm: 'zzz' });

      expect(panel.textContent).toMatch(/No matching records/i);
      expect(panel.textContent).toMatch(/your current filters or search/i);
    });

    it('a filter the user applied over a filtered view is the user\'s, and says so', async () => {
      const panel = await emptyState(
        authored({ ...BASE, filter: [['status', 'not_in', ['archived']]] }),
        {
          initialFilters: {
            id: 'root',
            logic: 'and',
            conditions: [{ id: 'c1', field: 'name', operator: 'contains', value: 'zzz' }],
          } as never,
        },
      );

      expect(panel.textContent).toMatch(/your current filters or search/i);
      expect(panel.textContent).not.toContain('No records match this view’s filter.');
    });

    it('a genuinely unfiltered empty list still invites the user to create', async () => {
      const panel = await emptyState(BASE);

      expect(panel.textContent).toMatch(/Nothing here yet/i);
      expect(panel.textContent).not.toMatch(/No matching records/i);
    });

    it('an empty filter array is not "filtered" — it imposes nothing', async () => {
      const panel = await emptyState({ ...BASE, filter: [] } as ListViewSchema);

      expect(panel.textContent).toMatch(/Nothing here yet/i);
    });

    it("the author's own emptyState copy still wins over both", async () => {
      const panel = await emptyState(
        authored({
          ...BASE,
          filter: [['status', 'not_in', ['archived']]],
          emptyState: { title: 'No open work orders', message: 'Dispatch one to get started.' },
        }),
      );

      expect(panel.textContent).toMatch(/No open work orders/);
      expect(panel.textContent).not.toMatch(/No matching records/i);
    });
  });
});

// ── ListView.emptyVsErrorRole-7132 ──────────────────────────────────────────────

/**
 * objectui#7132 — a list that is EMPTY and a list that FAILED TO LOAD must not
 * be the same node shape.
 *
 * Measured on `origin/main` by rendering both branches: each one is a
 * `data-slot="data-empty-state"` div with **no `role` at all**. A 403 telling
 * the user "You don't have access" and a young object telling them "Nothing
 * here yet" were structurally indistinguishable — the precise failure the
 * #7063 / #7064 rulings put first, and the reason `ListView` was the
 * "unmeasured" row on #7132's own table.
 *
 * Two things are pinned here because they are separable and either can regress
 * alone: the empty branch takes the platform default (#7132), and the error
 * branch declares `alert` at its own call site so no default can mislabel a
 * failure as a status.
 *
 * ⚠️ Since objectui#7143 the error branch is a `DataErrorState`, not a borrowed
 * `DataEmptyState` — the migration this suite's original prose said had not
 * happened yet. That does NOT retire either arm: `role="alert"` is still typed
 * at the call site rather than inherited, which is what keeps this suite a pin
 * on the CALL SITE and not on whichever primitive it currently draws with.
 * Component identity is pinned separately, in `ListView.errorStateComponent-7143`.
 *
 * SUITE DIRECTION, predicted before running (against #7132's base): the EMPTY
 * arm is red against `origin/main`; the ERROR arm is green in both worlds, and
 * is here as the negative control that keeps a suite collapsed to "no tests"
 * from reading as the fix.
 */
describe('ListView.emptyVsErrorRole-7132', () => {
  restoreAfterBlock();

  const schema: ListViewSchema = {
    type: 'list-view',
    objectName: 'work_order',
    fields: ['name'],
  };

  function renderWith(find: () => Promise<unknown>) {
    const ds = {
      find: vi.fn().mockImplementation(find),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    return render(
      <SchemaRendererProvider dataSource={ds as any}>
        <ListView schema={schema} dataSource={ds as any} />
      </SchemaRendererProvider>,
    );
  }

  async function panel(container: HTMLElement, testId: string): Promise<HTMLElement> {
    await waitFor(() => {
      expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    });
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  }

  describe('ListView — an empty list is not a failed list (#7132)', () => {
    it('EMPTY: the empty state is announced as role="status"', async () => {
      const { container } = renderWith(() => Promise.resolve([]));
      const box = await panel(container, 'empty-state');
      expect(box.getAttribute('role')).toBe('status');
      // Guard against the arm passing over a collapsed render: the empty copy
      // must actually be present in the box being measured.
      expect(box.textContent).toMatch(/nothing here yet/i);
    });

    it('ERROR: the load-failure panel is announced as role="alert"', async () => {
      const { container } = renderWith(() =>
        Promise.reject(Object.assign(new Error('Forbidden'), { httpStatus: 403 })),
      );
      const box = await panel(container, 'list-error-state');
      expect(box.getAttribute('role')).toBe('alert');
      expect(box.getAttribute('data-error-kind')).toBe('forbidden');
    });

    it('the two branches carry DIFFERENT roles, by exact value', async () => {
      const { container: emptyC } = renderWith(() => Promise.resolve([]));
      const emptyRole = (await panel(emptyC, 'empty-state')).getAttribute('role');
      const { container: errC } = renderWith(() =>
        Promise.reject(Object.assign(new Error('Forbidden'), { httpStatus: 403 })),
      );
      const errorRole = (await panel(errC, 'list-error-state')).getAttribute('role');
      // Asserted by exact value, not by inequality: on `origin/main` the roles
      // were `null` and `null`, but a partial fix leaving the empty branch at
      // `null` would still satisfy `null !== 'alert'` and pass a mere-difference
      // assertion. Both values must be named for this arm to be able to fail.
      expect(emptyRole).toBe('status');
      expect(errorRole).toBe('alert');
    });
  });
});

// ── ListView.errorStateComponent-7143 ───────────────────────────────────────────

/**
 * objectui#7143 — the load-failure panel is rendered by `DataErrorState`.
 *
 * `ListView` drew its load FAILURE with `DataEmptyState`, the component named
 * for the *empty* case, passing it a destructive icon, error copy and a retry
 * control — while `DataErrorState`, in the same file with the same layout and
 * `role="alert"` already declared, had no consumer anywhere in the repo. The
 * maintainer ruling of 2026-09-01 approved the migration and excluded the
 * alternative (a comment recording that one component does the other's job).
 *
 * WHAT IS PINNED HERE, and why each half can regress alone:
 *
 *  1. COMPONENT IDENTITY — the panel's `data-slot` is `data-error-state`. This
 *     is the whole of the rendered delta and the only arm red on `origin/main`.
 *  2. EVERYTHING ELSE IS UNCHANGED — `role="alert"`, `data-testid`,
 *     `data-error-kind`, the per-kind glyph, the stripped icon wrapper, the copy
 *     and the retry button all survive the swap. These arms are green in both
 *     worlds on purpose: a migration that "passes" by dropping the panel's
 *     affordances is the failure mode a bare identity assertion cannot see.
 *  3. THE CONTROL — the genuine empty branch is STILL `DataEmptyState` with
 *     `role="status"`. Without it, a change that swapped both panels (or the
 *     wrong one) reads as a pass.
 *
 * SUITE DIRECTION, MEASURED by reverting both source files to the base commit
 * and re-running: RED against `origin/main` are the two arms that read the
 * panel's `data-slot` (it is `data-empty-state` there) and the glyph arm, which
 * selects the icon wrapper by a `data-slot` that only exists after this change.
 * GREEN in both worlds are the role/test-id arm, the retry arm, and the
 * empty-branch control — the affordances a migration must carry over, which a
 * bare identity assertion cannot see going missing.
 */
describe('ListView.errorStateComponent-7143', () => {
  restoreAfterBlock();

  const schema: ListViewSchema = {
    type: 'list-view',
    objectName: 'account',
    fields: ['name'],
  };

  function renderWith(find: () => Promise<unknown>) {
    const ds = {
      find: vi.fn().mockImplementation(find),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    return render(
      <SchemaRendererProvider dataSource={ds as any}>
        <ListView schema={schema} dataSource={ds as any} />
      </SchemaRendererProvider>,
    );
  }

  const failing = (error: unknown) => renderWith(() => Promise.reject(error));
  const forbidden = () => Object.assign(new Error('Forbidden'), { httpStatus: 403 });

  async function panel(container: HTMLElement, testId: string): Promise<HTMLElement> {
    await waitFor(() => {
      expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
    });
    return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  }

  describe('ListView — the load failure is a DataErrorState (#7143)', () => {
    it('IDENTITY: the panel is data-slot="data-error-state"', async () => {
      const { container } = failing(forbidden());
      const box = await panel(container, 'list-error-state');
      expect(box.getAttribute('data-slot')).toBe('data-error-state');
      // Named in both directions: the component it used to borrow must be gone
      // from this node, not merely joined by a second slot value.
      expect(box.getAttribute('data-slot')).not.toBe('data-empty-state');
    });

    it('UNCHANGED: role, test id and error kind survive the swap', async () => {
      const { container } = failing(forbidden());
      const box = await panel(container, 'list-error-state');
      expect(box.getAttribute('role')).toBe('alert');
      expect(box.getAttribute('data-error-kind')).toBe('forbidden');
      expect(box.textContent).toMatch(/permission|access/i);
    });

    it('UNCHANGED: the per-kind glyph still reaches the panel, in a stripped wrapper', async () => {
      // The reason `DataErrorState` needed props at all: this panel draws an
      // outage differently from a denial, and it removes the primitive's box.
      const { container } = failing(new TypeError('Failed to fetch'));
      const box = await panel(container, 'list-error-state');
      const icon = box.querySelector('[data-slot="data-error-state-icon"]');
      expect(icon).not.toBeNull();
      expect(icon!.querySelector('svg')).not.toBeNull();
      // `iconWrapperClassName` REPLACES rather than merges, so the destructive
      // square the primitive draws by default must not have survived.
      expect(icon!.className).toBe('mb-3');
    });

    it('UNCHANGED: the retry button is still rendered inside the panel', async () => {
      const { container } = failing(Object.assign(new Error('Internal error'), { httpStatus: 500 }));
      const box = await panel(container, 'list-error-state');
      const retry = box.querySelector('[data-testid="list-error-retry"]');
      expect(retry).not.toBeNull();
      expect(retry!.textContent).toMatch(/retry/i);
    });

    it('UNCHANGED: an enable-block denial still offers no retry', async () => {
      const err = Object.assign(new Error('Object API is disabled'), {
        httpStatus: 404,
        code: 'OBJECT_API_DISABLED',
      });
      const { container } = failing(err);
      const box = await panel(container, 'list-error-state');
      expect(box.querySelector('[data-testid="list-error-retry"]')).toBeNull();
      // The panel itself is still there — "no retry" must not be reached by
      // rendering nothing at all.
      expect(box.getAttribute('data-slot')).toBe('data-error-state');
    });

    it('CONTROL: the genuine empty branch is still a DataEmptyState with role="status"', async () => {
      const { container } = renderWith(() => Promise.resolve([]));
      const box = await panel(container, 'empty-state');
      expect(box.getAttribute('data-slot')).toBe('data-empty-state');
      expect(box.getAttribute('role')).toBe('status');
    });
  });
});

// ── ListView.forbiddenNoRetry ───────────────────────────────────────────────────

/**
 * A permission refusal (403) on a list read offers no Retry: the grant is one
 * only an administrator can give, so a retry re-reaches the same refusal. A
 * transient failure (5xx, network) keeps the Retry.
 */
describe('ListView.forbiddenNoRetry', () => {
  restoreAfterBlock();

  const schema: ListViewSchema = {
    type: 'list-view',
    objectName: 'invoice',
    fields: ['name'],
  };

  function renderFailing(error: unknown) {
    const ds = {
      find: vi.fn().mockRejectedValue(error),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };
    return render(
      <SchemaRendererProvider dataSource={ds as any}>
        <ListView schema={schema} dataSource={ds as any} />
      </SchemaRendererProvider>,
    );
  }

  async function errorState(container: HTMLElement): Promise<HTMLElement> {
    await waitFor(() => {
      expect(container.querySelector('[data-testid="list-error-state"]')).not.toBeNull();
    });
    return container.querySelector('[data-testid="list-error-state"]') as HTMLElement;
  }

  describe('ListView — a permission refusal offers no Retry', () => {
    it('a 403 draws the no-access panel without Retry', async () => {
      const err = Object.assign(new Error('Forbidden'), { httpStatus: 403, code: 'PERMISSION_DENIED' });
      const { container } = renderFailing(err);
      const panel = await errorState(container);
      expect(panel.getAttribute('data-error-kind')).toBe('forbidden');
      expect(panel.querySelector('[data-testid="list-error-retry"]')).toBeNull();
      // "No Retry" is not reached by drawing nothing: the panel still says why.
      expect(panel.textContent).toMatch(/permission/i);
    });

    it('CONTROL: a 500 still draws Retry', async () => {
      const err = Object.assign(new Error('Internal error'), { httpStatus: 500 });
      const { container } = renderFailing(err);
      const panel = await errorState(container);
      expect(panel.getAttribute('data-error-kind')).toBe('network');
      expect(panel.querySelector('[data-testid="list-error-retry"]')).not.toBeNull();
    });

    it('CONTROL: a network failure still draws Retry', async () => {
      const { container } = renderFailing(new TypeError('Failed to fetch'));
      const panel = await errorState(container);
      expect(panel.querySelector('[data-testid="list-error-retry"]')).not.toBeNull();
    });
  });
});

// ── ListView.galleryBlockCanonical-6152 ─────────────────────────────────────────

/**
 * objectui#6152 round 12 — the gallery capability gate asked the `options` bag
 * for the LEGACY cover spelling only.
 *
 * `availableViews` resolved gallery from three rungs: `schema.gallery`'s two
 * spellings, and `schema.options.gallery.imageField`. There was no canonical
 * rung for the bag, so a bag binding its cover under the spec's `coverField`
 * rendered a gallery (`ObjectGallery` reads the nested `coverField` first) that
 * the switcher never offered. The same shape as objectui#8193 for kanban.
 *
 * It became reachable in the same round: app-shell's `galleryViewOptions` now
 * writes `coverField` alone (the legacy `imageField` is refused by name in the
 * bag `@object-ui/types` judges). Measured before the rung existed, on
 * objectui#6152 (report 6070437445): a `{ coverField }` bag was not offered, the
 * `{ imageField, coverField }` bag was, and a top-level `gallery.coverField` was.
 *
 * ⛔ NO ALIAS READ WAS REMOVED by round 12. Stored metadata written before the
 * view write door judged the bag may still carry `imageField`, and the readers'
 * retirement was its own round: objectui#6152 round 14 removed the alias rungs,
 * and the legacy-bag CONTROL below was re-judged into a refusal arm then.
 *
 * objectstack#25923 retired the bag: a stored `options.gallery` is folded onto
 * the view's `gallery` block by the server before the row is served, and the
 * gate reads the block alone. So the arms below are the same bindings written
 * where they live now, the top-level `gallery` block (renamed from
 * `ListView.galleryOptionsBagCanonical-6152`), plus one arm pinning that a bag
 * no longer resolves the capability.
 *
 * Both directions are pinned: the canonical arms answer YES, and the arms at
 * the bottom answer NO for a block with no cover binding, so the rung cannot
 * degrade into "offer the gallery whenever it is whitelisted".
 */
describe('ListView.galleryBlockCanonical-6152', () => {
  restoreAfterBlock();

  /** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
  const WIDE_TOOLBAR = { compactToolbar: false } as const;

  const makeDataSource = () => ({
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'deal', fields: {} }),
  });

  // `viewType: 'grid'` on purpose: the gate's "always allow switching back to the
  // schema's own viewType" rung would otherwise resolve gallery for a reason that
  // has nothing to do with the binding under test.
  const BASE = {
    type: 'list-view',
    objectName: 'deal',
    viewType: 'grid',
    columns: ['name'],
  } as const;

  const renderSwitcher = (view: Record<string, unknown>) => {
    const dataSource = makeDataSource() as any;
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        {/* `as never`: some arms carry the legacy `imageField`, which the typed
            block refuses by name, or the retired `options` bag; this file pins
            how the gate answers for them. */}
        <ListView schema={{ ...WIDE_TOOLBAR, ...BASE, ...view } as never} dataSource={dataSource} showViewSwitcher />
      </SchemaRendererProvider>,
    );
    const trigger = screen.queryByTestId('view-switcher-dropdown');
    if (trigger) fireEvent.click(trigger);
  };

  /** Mirrors the helper in `ListView.kanbanBlockCanonical-8193.test.tsx`. */
  const queryViewOption = (name: string) =>
    screen.queryByRole('tab', { name }) ?? screen.queryByRole('button', { name });

  /** Is `gallery` offered for a view whitelisting exactly `['grid', 'gallery']`? */
  const galleryOffered = (view: Record<string, unknown>) => {
    renderSwitcher({ appearance: { allowedVisualizations: ['grid', 'gallery'] }, ...view });
    return Boolean(queryViewOption('Gallery'));
  };

  describe('the capability gate resolves gallery from the CANONICAL key of the `gallery` block (objectui#6152 round 12, objectstack#25923)', () => {
    // THE DISCRIMINATING ARM of round 12, written where the binding lives now.
    it('offers Gallery for `gallery.coverField`', () => {
      expect(galleryOffered({ gallery: { coverField: 'logo' } })).toBe(true);
    });

    it('offers Gallery for the block app-shell\'s ObjectView now writes', () => {
      // ⛔ One `galleryOffered` per test: it renders into the shared screen.
      expect(galleryOffered({ gallery: { coverField: 'logo', titleField: 'name' } })).toBe(true);
    });

    it('does NOT offer Gallery for the retired LEGACY `gallery.imageField` (objectui#6152 round 14)', () => {
      // Round 12's CONTROL here proved its change ADDED a rung. Round 14 retired
      // the alias rung itself: a stored `imageField` binds no cover, so the gate
      // must not offer a gallery for it.
      expect(galleryOffered({ gallery: { imageField: 'logo' } })).toBe(false);
    });

    it('RETIRED (objectstack#25923): does NOT offer Gallery for a cover bound in the legacy `options.gallery` bag', () => {
      // The bag was this file's subject. It is folded onto `gallery` before a
      // stored row is served, so one that still reaches the gate binds nothing.
      expect(galleryOffered({ options: { gallery: { coverField: 'logo' } } })).toBe(false);
    });

    // THE OTHER HALF.
    it('does NOT offer Gallery with no gallery block anywhere', () => {
      expect(galleryOffered({})).toBe(false);
    });

    it('does NOT offer Gallery for a gallery block carrying no cover binding', () => {
      expect(galleryOffered({ gallery: { titleField: 'name' } })).toBe(false);
    });

    it('does NOT offer Gallery for an empty gallery block', () => {
      expect(galleryOffered({ gallery: {} })).toBe(false);
    });
  });
});

// ── ListView.mutationRefresh ────────────────────────────────────────────────────

/**
 * Regression: ListView must refetch on `dataSource.onMutation` events EVEN when
 * an external `refreshTrigger` is provided.
 *
 * Real-world symptom (framework app-showcase): inline-edit a grid cell, click
 * "全部保存" (Save All) — the write persisted but the list did not auto-refresh.
 * ObjectView drives the grid with `refreshTrigger`, which is bumped by
 * form-success / delete handlers but NOT by inline-edit saves (ObjectGrid
 * writes those straight through `dataSource.update`). The only signal for that
 * path is `onMutation`; ListView used to skip subscribing whenever a
 * refreshTrigger was present, so inline edits never repainted.
 */
describe('ListView.mutationRefresh', () => {
  restoreAfterBlock();

  beforeAll(() => {
    Object.defineProperty(window, 'localStorage', {
      value: (() => {
        let store: Record<string, string> = {};
        return {
          getItem: (k: string) => store[k] ?? null,
          setItem: (k: string, v: string) => { store[k] = v; },
          clear: () => { store = {}; },
          removeItem: (k: string) => { delete store[k]; },
        };
      })(),
      configurable: true,
    });
  });

  function makeDataSource() {
    let listeners: Array<(e: any) => void> = [];
    const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
    return {
      find,
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      onMutation: (cb: (e: any) => void) => {
        listeners.push(cb);
        return () => { listeners = listeners.filter((l) => l !== cb); };
      },
      // test helper to fire an event
      __emit: (e: any) => listeners.forEach((l) => l(e)),
    } as any;
  }

  describe('ListView — refetch on onMutation with an external refreshTrigger', () => {
    it('refetches when the bound object is mutated even though refreshTrigger is set', async () => {
      const ds = makeDataSource();
      const schema: ListViewSchema = {
        type: 'list-view',
        objectName: 'showcase_project',
        // ObjectView always passes this for grid-driven views; it used to disable
        // the onMutation subscription.
        refreshTrigger: 0,
        fields: ['name'],
      } as any;

      render(
        <SchemaRendererProvider dataSource={ds}>
          <ListView schema={schema} dataSource={ds} />
        </SchemaRendererProvider>,
      );

      // Initial fetch(es) settle.
      await waitFor(() => expect(ds.find).toHaveBeenCalled());
      const callsBefore = ds.find.mock.calls.length;

      // Simulate an inline-edit save landing on the SAME object.
      ds.__emit({ type: 'update', resource: 'showcase_project', id: 'r1' });

      await waitFor(() => {
        expect(ds.find.mock.calls.length).toBeGreaterThan(callsBefore);
      });
    });

    it('ignores mutations on a different object', async () => {
      const ds = makeDataSource();
      const schema: ListViewSchema = {
        type: 'list-view',
        objectName: 'showcase_project',
        refreshTrigger: 0,
        fields: ['name'],
      } as any;

      render(
        <SchemaRendererProvider dataSource={ds}>
          <ListView schema={schema} dataSource={ds} />
        </SchemaRendererProvider>,
      );

      await waitFor(() => expect(ds.find).toHaveBeenCalled());
      const callsBefore = ds.find.mock.calls.length;

      ds.__emit({ type: 'update', resource: 'some_other_object', id: 'x' });

      // Give any (unwanted) refetch a chance to fire, then assert none did.
      await new Promise((r) => setTimeout(r, 50));
      expect(ds.find.mock.calls.length).toBe(callsBefore);
    });
  });
});

// ── ListView.onRowsChange-26679 ─────────────────────────────────────────────────

/**
 * objectstack#26679 — `ListView` reports the rows it shows (`onRowsChange`),
 * in the order it shows them, so the console's record drawer can step through
 * them with ↑ ↓ at its root.
 *
 * Answered where `onTotalChange` is: a paged grid that draws the rows it
 * fetched. A kind with no single row order (here a calendar) answers with no
 * rows, so a host never steps through a stale set.
 */
describe('ListView.onRowsChange-26679', () => {
  restoreAfterBlock();

  const OBJECT = 'crm_lead';
  const objectDef = {
    name: OBJECT,
    label: 'Lead',
    fields: {
      id: { name: 'id', type: 'text' },
      name: { name: 'name', type: 'text', label: 'Name' },
      status: {
        name: 'status', type: 'select', label: 'Status',
        options: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }],
      },
      created_at: { name: 'created_at', type: 'datetime', label: 'Created' },
    },
  };
  const ROWS = [
    { id: 'l_3', name: 'Mira Costa', status: 'new' },
    { id: 'l_1', name: 'Kai Watanabe', status: 'won' },
    { id: 'l_2', name: 'Lena Fischer', status: 'new' },
  ];

  const makeDataSource = () =>
    ({
      find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async (name: string) => (name === OBJECT ? objectDef : null)),
    }) as any;

  function mount(schemaExtra: Record<string, unknown>) {
    const dataSource = makeDataSource();
    const onRowsChange = vi.fn();
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView
          schema={{ type: 'list-view', objectName: OBJECT, columns: ['name', 'status'], ...schemaExtra } as any}
          dataSource={dataSource}
          onRowsChange={onRowsChange}
        />
      </SchemaRendererProvider>,
    );
    return { dataSource, onRowsChange };
  }

  const lastIds = (fn: ReturnType<typeof vi.fn>) =>
    (fn.mock.calls.at(-1)?.[0] as Array<{ id: string }> | undefined)?.map((r) => r.id);

  afterEach(() => cleanup());

  describe('ListView onRowsChange (objectstack#26679)', () => {
    it('a paged grid reports the rows it shows, in their shown order', async () => {
      const { dataSource, onRowsChange } = mount({ viewType: 'grid' });
      await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
      await waitFor(() => expect(lastIds(onRowsChange)).toEqual(['l_3', 'l_1', 'l_2']));
    });

    // A board reports its rows lane by lane since objectstack#28461
    // (`ListView.rowGroups-28461.test.tsx`); a calendar still has no row order.
    it('control: a calendar has no single row order and reports no rows', async () => {
      const { dataSource, onRowsChange } = mount({
        viewType: 'calendar',
        options: { calendar: { startDateField: 'created_at' } },
      });
      await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
      await waitFor(() => expect(onRowsChange).toHaveBeenCalled());
      expect(onRowsChange.mock.calls.every(([rows, groups]) => rows.length === 0 && groups === undefined)).toBe(true);
    });
  });
});

// ── ListView.printButtonSemantics ────────────────────────────────────────────

/**
 * objectui#4462 — the list toolbar's Print button says what it does.
 *
 * ## The defect
 *
 * The button was a bare `window.print()` with a bare "Print" label and no
 * tooltip. Acceptance testers at the reporting project read it as the
 * product's "export to PDF" entry point; in headless browsers and several
 * embedded WebViews `window.print()` is a silent no-op, so the same button
 * also reads as simply broken. The real print/PDF primitive was closed
 * NOT_PLANNED as objectstack#1301, so the fix is honesty, not a feature:
 * the control keeps working and now states that it opens the BROWSER's print
 * dialog and is not a PDF export.
 *
 * ## ⚠ What this file cannot assert
 *
 * Nothing here observes the printed PAGE. `@media print` does not apply under
 * happy-dom (no layout engine, no media emulation), so the shared print
 * stylesheet that makes the resulting page usable is pinned STRUCTURALLY, in
 * `packages/app-shell/src/__tests__/print-stylesheet-4462.test.ts`, and that
 * file states the same limitation at greater length. This file pins only what
 * a DOM assertion can actually see: the button carries the sentence, through
 * the i18n channel, on the accessible name and the tooltip.
 *
 * ## Path under test, and the one it does not cover
 *
 * Provider-less — no `I18nProvider` — which is `createSafeTranslation`'s
 * fallback path and therefore reads `LIST_DEFAULT_TRANSLATIONS`. The
 * provider-mounted path reads `en.common.printDialogHint`, and the two are
 * held byte-identical by
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx` (#4401), so
 * asserting the map row here pins both without mounting `createI18n` — whose
 * registration as react-i18next's module-global default survives `cleanup()`
 * and would leak into the sibling cases (the reason
 * `ListView.overlayTitleI18n` and `…NoProviderFallback` are two files).
 *
 * ## Direction, predicted before running (#4118)
 *
 * All four cases fail on `origin/main`: the button has no `title` and no
 * `aria-label` there, and `LIST_DEFAULT_TRANSLATIONS` has no
 * `common.printDialogHint` row — so the accessible name is just "Print" and
 * the raw key would render if the row were dropped.
 */
describe('ListView.printButtonSemantics', () => {
  restoreAfterBlock();

  const HINT_KEY = 'common.printDialogHint';

  beforeAll(() => {
    Object.defineProperty(window, 'localStorage', {
      value: (() => {
        let store: Record<string, string> = {};
        return {
          getItem: (k: string) => store[k] ?? null,
          setItem: (k: string, v: string) => { store[k] = v; },
          clear: () => { store = {}; },
          removeItem: (k: string) => { delete store[k]; },
        };
      })(),
      configurable: true,
    });
  });

  function makeDataSource() {
    return {
      find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as any;
  }

  function renderList(schema: Partial<ListViewSchema>, ds: any) {
    return render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView
          schema={{ type: 'list-view', objectName: 'proj', fields: ['name'], ...schema } as any}
          dataSource={ds}
        />
      </SchemaRendererProvider>,
    );
  }

  describe('ListView — Print button semantics (objectui#4462)', () => {
    it('carries the print-dialog sentence as its tooltip', async () => {
      const ds = makeDataSource();
      renderList({ allowPrinting: true } as any, ds);
      await waitFor(() => expect(ds.find).toHaveBeenCalled());

      const btn = screen.getByTestId('print-button');
      const hint = LIST_DEFAULT_TRANSLATIONS[HINT_KEY];

      expect(btn).toHaveAttribute('title', hint);
      // Not the raw key: a missing defaults-map row degrades to the key string,
      // which would satisfy a bare "has a title" assertion.
      expect(btn.getAttribute('title')).not.toBe(HINT_KEY);
    });

    it('names the disambiguation on its accessible name, not just the tooltip', async () => {
      // `title` alone is not exposed to every assistive technology, and it never
      // reaches touch users. The accessible name is the one channel that always
      // carries it.
      const ds = makeDataSource();
      renderList({ allowPrinting: true } as any, ds);
      await waitFor(() => expect(ds.find).toHaveBeenCalled());

      const btn = screen.getByTestId('print-button');
      const accessibleName = btn.getAttribute('aria-label') ?? '';

      expect(accessibleName).toContain(LIST_DEFAULT_TRANSLATIONS['list.print']);
      expect(accessibleName).toContain(LIST_DEFAULT_TRANSLATIONS[HINT_KEY]);
    });

    it('says "browser" and "not a PDF export" — the two facts the issue is about', () => {
      // Pins MEANING, not just presence: a tooltip reading "Print this view"
      // would pass both cases above and leave the misreading exactly where it
      // was. Case-insensitive substring, so wording may still be edited.
      const hint = LIST_DEFAULT_TRANSLATIONS[HINT_KEY];
      expect(hint).toBeTypeOf('string');
      expect(hint.toLowerCase()).toContain('browser');
      expect(hint.toLowerCase()).toContain('print dialog');
      expect(hint.toLowerCase()).toContain('not a pdf export');
    });

    it('still opens the browser dialog — no removal, no headless gating', async () => {
      // The ruling on #4462 forbids both alternatives the issue offered as
      // fallbacks. Clicking must still reach `window.print()`.
      const printSpy = vi.fn();
      Object.defineProperty(window, 'print', { value: printSpy, configurable: true });

      const ds = makeDataSource();
      renderList({ allowPrinting: true } as any, ds);
      await waitFor(() => expect(ds.find).toHaveBeenCalled());

      fireEvent.click(screen.getByTestId('print-button'));
      expect(printSpy).toHaveBeenCalledTimes(1);
    });

    it('marks the tool cluster for the shared print sheet to hide', async () => {
      // The rule lives in `@object-ui/app-shell/styles.css`; this is the marker
      // it selects on. The left half of the toolbar (view tabs, active filter
      // chips) is deliberately NOT marked — it says which slice of the data is
      // on the page.
      const ds = makeDataSource();
      const { container } = renderList({ allowPrinting: true } as any, ds);
      await waitFor(() => expect(ds.find).toHaveBeenCalled());

      const cluster = container.querySelector('[data-print-hide]');
      expect(cluster).not.toBeNull();
      expect(cluster).toContainElement(screen.getByTestId('print-button'));
    });
  });
});

// ── ListView.refreshIndicatorLocale-10580 ───────────────────────────────────────

/**
 * objectui#10580 — the bar `ListView` draws over its rows while it re-reads
 * them is named in the active locale.
 *
 * `RefreshIndicator` used to default its accessible name to the English
 * literal "Refreshing", and this view passed none, so a screen reader
 * announced English in every locale. The view now names the bar with
 * `list.refreshing`, the key its pull-to-refresh text already reads, and the
 * component has no default left to fall to.
 *
 * The re-read is the toolbar's own refresh button (`ListView.refreshButton.test.tsx`).
 * The second `find` is held open by hand, so the bar is read while the query
 * really is in flight.
 */
describe('ListView.refreshIndicatorLocale-10580', () => {
  restoreAfterBlock();

  /** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
  const WIDE_TOOLBAR = { compactToolbar: false } as const;

  beforeEach(() => {
    // The provider persists the last language; keep one case from leaking into the next.
    window.localStorage.clear();
  });

  // Module constants: `I18nProvider` rebuilds its i18next instance whenever the
  // `config` object changes identity, so an inline literal would re-boot it on
  // every render.
  const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false };
  const EN = { defaultLanguage: 'en', detectBrowserLanguage: false };

  /** The first `find` answers at once; every later one stays in flight. */
  function makeDataSource() {
    let calls = 0;
    const find = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ data: [{ _id: 'p1', name: 'Alpha' }], total: 1 });
      return new Promise<never>(() => {});
    });
    return {
      find,
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as any;
  }

  const indicator = () => screen.queryByTestId('refresh-indicator');
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

  async function readBarNameDuringReRead(config: typeof ZH) {
    const ds = makeDataSource();
    render(
      <I18nProvider config={config}>
        <SchemaRendererProvider dataSource={ds}>
          <ListView
            schema={{ ...WIDE_TOOLBAR, type: 'list-view', objectName: 'proj', fields: ['name'] } as any}
            dataSource={ds}
          />
        </SchemaRendererProvider>
      </I18nProvider>,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await settle();
    expect(indicator(), 'no bar while nothing is in flight').toBeNull();

    fireEvent.click(screen.getByTestId('refresh-button'));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(indicator()).not.toBeNull());
  }

  describe('ListView names its refresh bar in the active locale (objectui#10580)', () => {
    it('zh: the bar is named by the zh pack, not by an English literal', async () => {
      await readBarNameDuringReRead(ZH);
      await waitFor(() => expect(screen.getByRole('progressbar', { name: '刷新中…' })).toBeInTheDocument());
      expect(indicator()!.getAttribute('aria-label')).not.toMatch(/Refreshing/);
    });

    it('en control: the bar is named by the en pack value', async () => {
      await readBarNameDuringReRead(EN);
      await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Refreshing…' })).toBeInTheDocument());
    });
  });
});

// ── ListView.refusedSortNotSent-30024 ────────────────────────────────────────

/**
 * objectstack#30024 — a stored view `sort` the platform's sortability
 * projection refuses never reaches the server.
 *
 * `currentSort` is seeded from the view's `sort`, and the data fetch used to
 * map it into `$orderby` unfiltered. The projection's verdict was applied to
 * the header display and to the persist path (#6455) only, so a list whose
 * stored sort named a refused field asked the server for that sort, and the
 * Data API answers it `400 INVALID_SORT`: the list failed its first fetch
 * instead of loading.
 *
 * Two refused fields: a `formula`, which the platform's own resolver
 * (`resolveObjectSortability`, the one the REST layer serves from) refuses as
 * `virtual-type`, and a `text` field marked `sortable: false`, refused as
 * `author-declared` since objectstack#30021. The projection is built by that
 * resolver, not hand-written.
 *
 * Every negative cell sits beside a control: a sortable field's sort is sent
 * unchanged, and a deployment that serves no projection sends what it sent
 * before.
 */
describe('ListView.refusedSortNotSent-30024', () => {
  restoreAfterBlock();

  const objectDef = {
    name: 'crm_opportunity',
    label: 'Opportunity',
    fields: {
      name: { type: 'text', label: 'Name' },
      amount: { type: 'currency', label: 'Amount' },
      expected_revenue: { type: 'formula', label: 'Expected Revenue', expression: 'amount * 2' },
      // A stored `text` field its author marked unsortable: refused by the
      // projection as `author-declared` since objectstack#30021.
      internal_code: { type: 'text', label: 'Internal Code', sortable: false },
    },
  };

  /**
   * The data source answers as the Data API does: a `$orderby` naming a field
   * the projection refuses is a `400 INVALID_SORT`, so a list that sends one
   * shows its load error. Any other request answers one row.
   */
  const REFUSED = new Set(['expected_revenue', 'internal_code']);

  function makeDataSource(opts: { servesSignal?: boolean } = {}) {
    return {
      find: vi.fn(async (_object: string, params: any) => {
        const orderby = Array.isArray(params?.$orderby) ? params.$orderby : [];
        if (orderby.some((item: any) => REFUSED.has(item?.field))) {
          throw Object.assign(new Error('Field is not sortable'), {
            status: 400,
            code: 'INVALID_SORT',
          });
        }
        return { data: [{ id: 'r1', name: 'Acme deal', amount: 100, expected_revenue: 200 }], total: 1 };
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async () => {
        const schema = JSON.parse(JSON.stringify(objectDef));
        if (opts.servesSignal !== false) {
          attachObjectSortability(schema, resolveObjectSortability(objectDef));
        }
        return schema;
      }),
    };
  }

  async function renderList(
    sort: Array<{ field: string; order: 'asc' | 'desc' }>,
    dsOpts: { servesSignal?: boolean } = {},
  ) {
    const dataSource = makeDataSource(dsOpts);
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'crm_opportunity',
      viewType: 'grid',
      columns: ['name', 'amount', 'expected_revenue', 'internal_code'] as any,
      sort,
    } as any;
    render(
      <SchemaRendererProvider dataSource={dataSource as any}>
        <ListView schema={schema} dataSource={dataSource as any} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    // Let every request the mount made settle before reading the screen.
    await Promise.allSettled(dataSource.find.mock.results.map((r: any) => r.value));
    return dataSource;
  }

  /** Whether the list drew its load-error panel (what a `400` answer shows). */
  const showsLoadError = () => screen.queryByTestId('list-error-state') !== null;

  async function expectLoaded() {
    // Give a rejected request the chance to paint its error panel.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(showsLoadError()).toBe(false);
  }

  /** The `$orderby` of every request the list sent, each as `field order` pairs. */
  function sentOrderBys(ds: ReturnType<typeof makeDataSource>) {
    return ds.find.mock.calls.map((call: any[]) => {
      const orderby = call[1]?.$orderby;
      return Array.isArray(orderby)
        ? orderby.map((item: any) => `${item.field} ${item.order}`)
        : orderby;
    });
  }

  describe('ListView — a refused stored sort never reaches the server (objectstack#30024)', () => {
    it('sanity: the served projection refuses the formula and offers the stored fields', () => {
      const served = resolveObjectSortability(objectDef) as { fields: Record<string, any> };
      expect(served.fields.expected_revenue?.sortable).toBe(false);
      expect(served.fields.amount).toEqual({ sortable: true });
      expect(served.fields.name).toEqual({ sortable: true });
      expect(served.fields.internal_code).toEqual({ sortable: false, reason: 'author-declared' });
    });

    it('sends no sort entry for a stored sort naming a sortable: false field, and the list loads', async () => {
      const ds = await renderList([
        { field: 'internal_code', order: 'asc' },
        { field: 'amount', order: 'desc' },
      ]);
      const sent = sentOrderBys(ds);
      expect(sent.length).toBeGreaterThan(0);
      for (const orderby of sent) {
        expect(orderby).toEqual(['amount desc']);
      }
      await expectLoaded();
    });

    it('sends no sort entry for a stored sort naming only a refused field, and the list loads', async () => {
      const ds = await renderList([{ field: 'expected_revenue', order: 'desc' }]);
      const sent = sentOrderBys(ds);
      expect(sent.length).toBeGreaterThan(0);
      for (const orderby of sent) {
        expect(orderby).toBeUndefined();
      }
      await expectLoaded();
    });

    it('CONTROL: a sortable field\'s stored sort is sent unchanged', async () => {
      const ds = await renderList([{ field: 'amount', order: 'desc' }]);
      const sent = sentOrderBys(ds);
      expect(sent.length).toBeGreaterThan(0);
      for (const orderby of sent) {
        expect(orderby).toEqual(['amount desc']);
      }
      await expectLoaded();
    });

    it('a mixed sort sends only the allowed entries, in their original order', async () => {
      const ds = await renderList([
        { field: 'name', order: 'asc' },
        { field: 'expected_revenue', order: 'desc' },
        { field: 'amount', order: 'desc' },
      ]);
      const sent = sentOrderBys(ds);
      expect(sent.length).toBeGreaterThan(0);
      for (const orderby of sent) {
        expect(orderby).toEqual(['name asc', 'amount desc']);
      }
      await expectLoaded();
    });

    /**
     * The harness's own control: with no projection there is no verdict to
     * filter by, so the refused entry is sent as before, and the server double
     * answers it `400` — the load-error panel is what the fixed cells above are
     * proven NOT to show.
     */
    it('CONTROL: with no projection served the stored sort is sent as before, and the 400 shows', async () => {
      const ds = await renderList(
        [
          { field: 'expected_revenue', order: 'desc' },
          { field: 'amount', order: 'asc' },
        ],
        { servesSignal: false },
      );
      const sent = sentOrderBys(ds);
      expect(sent.length).toBeGreaterThan(0);
      for (const orderby of sent) {
        expect(orderby).toEqual(['expected_revenue desc', 'amount asc']);
      }
      await waitFor(() => expect(showsLoadError()).toBe(true));
    });
  });
});

// ── ListView.switcherChrome-7547 ─────────────────────────────────────────────

/**
 * objectui#7547 — switcher chrome around a single entry.
 *
 * `showViewSwitcher` reaches this component already decided, and both faces
 * that decide it compute the same wrong number: `app-shell/ObjectView` and
 * `app-shell/InterfaceListPage` count the LENGTH of
 * `appearance.allowedVisualizations`. That is the whitelist BEFORE this
 * component intersects it with the ADR-0047 capability gate — so a view
 * whitelisting `['grid', 'timeline']` with no timeline block whitelisted two,
 * resolved one, and drew the border / dropdown / separator cluster around a
 * Grid entry that could not switch to anything.
 *
 * Neither face can compute it: the gate that answers "does this type resolve?"
 * lives here, in `availableViews`. So the predicate is applied at the one site
 * holding both halves (`viewSwitcherOffered`), which is also why one change
 * covers BOTH doors.
 *
 * ⚠️ THE DISCRIMINATING PAIR IS THE POINT. A fix that simply stopped drawing
 * the switcher would pass every "no chrome" case below, so each of them is
 * matched by a control that whitelists the SAME two types and DECLARES the
 * second one's binding — chrome must still be drawn there. The two arms differ
 * in exactly one thing: whether the whitelisted second type resolves.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `{showViewSwitcher && (` at the render site and the "no chrome" arms
 * go RED (the cluster reappears around one entry) while every control stays
 * GREEN in either world — a resolvable second type was always offered.
 */
describe('ListView.switcherChrome-7547', () => {
  restoreAfterBlock();

  /** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
  const WIDE_TOOLBAR = { compactToolbar: false } as const;

  const makeDataSource = () =>
    ({
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
    }) as any;

  const BASE = {
    type: 'list-view',
    objectName: 'task',
    viewType: 'grid',
    columns: ['name'],
  } as const;

  /**
   * Is switcher chrome on the page, in EITHER of its two forms?
   *
   * `ViewSwitcherDropdown` renders a segmented control for 2–4 visualizations and
   * a collapsed "List (chevron)" dropdown otherwise — which is why the one-entry
   * case this card is about drew the DROPDOWN form: a menu affordance whose menu
   * holds a single item. Asking for both forms is what keeps these cases about
   * "was a switcher offered", not about which shape it took.
   */
  const anySwitcher = () =>
    screen.queryByTestId('view-switcher-segmented') ?? screen.queryByTestId('view-switcher-dropdown');

  /**
   * Mount a view with the switcher ENABLED by the host — the state both app-shell
   * faces stamp — and report whether the switcher chrome was drawn.
   */
  const chromeDrawn = (view: Record<string, unknown>) => {
    const dataSource = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView schema={{ ...WIDE_TOOLBAR, ...BASE, ...view } as never} dataSource={dataSource} showViewSwitcher />
      </SchemaRendererProvider>,
    );
    return Boolean(anySwitcher());
  };

  describe('the switcher is drawn for the RESOLVED list, not the whitelist (objectui#7547)', () => {
    it('draws NO chrome for `[grid, timeline]` with no timeline block', () => {
      // THE DEFECT, verbatim from the card. Two whitelisted, one resolvable.
      expect(
        chromeDrawn({ appearance: { allowedVisualizations: ['grid', 'timeline'] } }),
      ).toBe(false);
    });

    it('CONTROL: the SAME whitelist WITH a declared timeline axis keeps its chrome', () => {
      // The discriminating half. Nothing about this pair differs except whether
      // the second whitelisted type resolves, so a fix that just stopped drawing
      // the cluster cannot pass both.
      expect(
        chromeDrawn({
          appearance: { allowedVisualizations: ['grid', 'timeline'] },
          timeline: { startDateField: 'due_date' },
        }),
      ).toBe(true);
    });

    it('draws NO chrome for `[grid, kanban]` with no groupBy', () => {
      expect(
        chromeDrawn({ appearance: { allowedVisualizations: ['grid', 'kanban'] } }),
      ).toBe(false);
    });

    it('CONTROL: the same whitelist WITH a declared kanban lane keeps its chrome', () => {
      expect(
        chromeDrawn({
          appearance: { allowedVisualizations: ['grid', 'kanban'] },
          kanban: { groupByField: 'stage' },
        }),
      ).toBe(true);
    });

    it('draws NO chrome when every whitelisted extra type is unbound', () => {
      // Three whitelisted, still one resolvable — the length test read three.
      expect(
        chromeDrawn({ appearance: { allowedVisualizations: ['grid', 'kanban', 'calendar'] } }),
      ).toBe(false);
    });

    it('CONTROL: chrome for two resolvable types is untouched by this card', () => {
      expect(
        chromeDrawn({
          appearance: { allowedVisualizations: ['grid', 'kanban', 'calendar'] },
          kanban: { groupByField: 'stage' },
          calendar: { startDateField: 'due_date' },
        }),
      ).toBe(true);
    });

    it('CONTROL: the host can still switch the cluster OFF entirely', () => {
      // `viewSwitcherOffered` narrows the author's intent; it never widens it.
      const dataSource = makeDataSource();
      render(
        <SchemaRendererProvider dataSource={dataSource}>
          <ListView
            schema={
              {
                ...WIDE_TOOLBAR,
                ...BASE,
                appearance: { allowedVisualizations: ['grid', 'kanban'] },
                kanban: { groupByField: 'stage' },
              } as never
            }
            dataSource={dataSource}
          />
        </SchemaRendererProvider>,
      );
      expect(anySwitcher()).toBeNull();
    });

    it('draws NO chrome for a whitelist of one, as before', () => {
      expect(chromeDrawn({ appearance: { allowedVisualizations: ['grid'] } })).toBe(false);
    });
  });
});

// ── ListView.displayMenuClose-12621 ─────────────────────────────────────────────

/**
 * objectui#12621 — the list toolbar's Display menu closes once a layout is
 * chosen, and on Escape, returning focus to the Display trigger. The panel's
 * toggles keep it open: the control below flips Row numbers and density and
 * finds the panel still drawn.
 */
describe('ListView.displayMenuClose-12621', () => {
  restoreAfterBlock();

  const RECORDS = [{ id: '1', name: 'Acme', stage: 'won', closes: '2026-10-16', cover: 'x.png' }];

  function makeDataSource() {
    return {
      find: vi.fn().mockResolvedValue({ data: RECORDS, total: 1 }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'opportunity', fields: {} }),
    };
  }

  /** Two visualizations: the switcher draws as a segmented control. */
  const TWO: ListViewSchema = {
    type: 'list-view',
    objectName: 'opportunity',
    viewType: 'grid',
    fields: ['name', 'stage'],
    kanban: { groupByField: 'stage' },
    appearance: { allowedVisualizations: ['grid', 'kanban'] },
  } as ListViewSchema;

  /** Five visualizations: the switcher draws as a nested dropdown. */
  const FIVE: ListViewSchema = {
    ...TWO,
    gallery: { coverField: 'cover' },
    calendar: { startDateField: 'closes' },
    timeline: { startDateField: 'closes' },
    appearance: { allowedVisualizations: ['grid', 'kanban', 'gallery', 'calendar', 'timeline'] },
  } as ListViewSchema;

  const STUBBED = ['object-grid', 'object-kanban', 'object-gallery', 'object-calendar', 'object-timeline'];
  let previous: Array<[string, ReturnType<typeof ComponentRegistry.get>]> = [];

  beforeEach(() => {
    previous = STUBBED.map((type) => [type, ComponentRegistry.get(type)]);
    for (const type of STUBBED) {
      ComponentRegistry.register(type, () => <div data-testid={`${type}-stub`} />);
    }
  });

  afterEach(() => {
    cleanup();
    for (const [type, impl] of previous) if (impl) ComponentRegistry.register(type, impl as any);
  });

  function mount(schema: ListViewSchema) {
    const dataSource = makeDataSource();
    render(
      <SchemaRendererProvider dataSource={dataSource as never}>
        <ListView schema={schema} dataSource={dataSource as never} showViewSwitcher onInlineEditChange={vi.fn()} />
      </SchemaRendererProvider>,
    );
  }

  async function openDisplay(): Promise<{ trigger: HTMLElement; content: HTMLElement }> {
    await screen.findByTestId('object-grid-stub');
    const trigger = screen.getByTestId('toolbar-display-trigger');
    fireEvent.click(trigger);
    const content = await screen.findByTestId('view-settings-content');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    return { trigger, content };
  }

  async function expectClosedWithFocusOn(trigger: HTMLElement) {
    await waitFor(() => expect(screen.queryByTestId('view-settings-content')).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  }

  describe('the Display menu closes when its work is done (objectui#12621)', () => {
    it('choosing Kanban in the segmented Layout row closes the menu and focuses the trigger', async () => {
      mount(TWO);
      const { trigger, content } = await openDisplay();
      const row = within(content).getByTestId('display-layout-row');
      fireEvent.click(within(row).getByRole('tab', { name: 'Kanban' }));
      await screen.findByTestId('object-kanban-stub');
      await expectClosedWithFocusOn(trigger);
    });

    it('choosing Kanban in the nested Layout dropdown closes the menu and focuses the trigger', async () => {
      mount(FIVE);
      const { trigger, content } = await openDisplay();
      const row = within(content).getByTestId('display-layout-row');
      fireEvent.click(within(row).getByTestId('view-switcher-dropdown'));
      fireEvent.click(await screen.findByRole('button', { name: 'Kanban' }));
      await screen.findByTestId('object-kanban-stub');
      await expectClosedWithFocusOn(trigger);
    });

    it('Escape closes the menu and focuses the trigger', async () => {
      mount(TWO);
      const { trigger, content } = await openDisplay();
      fireEvent.keyDown(within(content).getByTestId('display-row-numbers-toggle'), { key: 'Escape' });
      await expectClosedWithFocusOn(trigger);
    });

    it('control: toggling Row numbers and cycling density keep the menu open', async () => {
      mount(TWO);
      const { trigger, content } = await openDisplay();
      const toggle = within(content).getByTestId('display-row-numbers-toggle');
      fireEvent.click(toggle);
      await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
      fireEvent.click(within(content).getByTestId('view-settings-density-cycle'));
      await waitFor(() => expect(screen.getByTestId('toolbar-display-count')).toHaveTextContent('2'));
      expect(screen.getByTestId('view-settings-content')).toBe(content);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });
  });
});

// ── ListView.inPageScroll-12463 ─────────────────────────────────────────────────

/**
 * objectui#12463 — the list's half of the bounded height chain.
 *
 * On desktop the grid's rows scroll inside the table's own box while the
 * toolbar above and the record-count footer below stay put. `ListView`'s part
 * is: a full-height flex column root, the toolbar and the footer as
 * non-scrolling siblings OUTSIDE the view body, and a view body that is the
 * column's `flex-1 min-h-0` item handing the visualization `h-full`. The
 * table's own scroll box is `data-table`'s and is pinned beside it
 * (`data-table-scroll-shadow-12463.test.tsx`); jsdom does no layout, so the
 * scrolling itself was read in a real browser and is reported on the PR.
 *
 * The grid is a stub: what is pinned here is where ListView puts it.
 */
describe('ListView.inPageScroll-12463', () => {
  restoreAfterBlock();

  const RECORDS = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), name: `Lead ${i + 1}`, stage: 'new' }));

  function makeDataSource() {
    return {
      find: vi.fn().mockResolvedValue({ data: RECORDS, total: RECORDS.length }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'lead', fields: {} }),
    };
  }

  const SCHEMA = {
    type: 'list-view',
    objectName: 'lead',
    viewType: 'grid',
    fields: ['name', 'stage'],
    kanban: { groupByField: 'stage' },
  } as ListViewSchema;

  const stubbed = ['object-grid', 'object-kanban'] as const;
  const previous: Record<string, ReturnType<typeof ComponentRegistry.get>> = {};

  beforeEach(() => {
    for (const type of stubbed) {
      previous[type] = ComponentRegistry.get(type);
      ComponentRegistry.register(type, (props: { schema?: { className?: string } }) => (
        <div data-testid={`${type}-stub`} className={props.schema?.className} />
      ));
    }
  });

  afterEach(() => {
    cleanup();
    for (const type of stubbed) {
      if (previous[type]) ComponentRegistry.register(type, previous[type] as never);
    }
  });

  function mount(schema: Partial<ListViewSchema> = {}) {
    render(
      <div className="h-[600px]">
        <SchemaRendererProvider dataSource={makeDataSource() as never}>
          <ListView schema={{ ...SCHEMA, ...schema } as ListViewSchema} dataSource={makeDataSource() as never} />
        </SchemaRendererProvider>
      </div>,
    );
  }

  function viewBodyOf(el: HTMLElement): HTMLElement {
    const body = el.closest('.min-h-0') as HTMLElement | null;
    if (!body) throw new Error('no bounded view body above the visualization');
    return body;
  }

  describe('ListView bounds the visualization between a fixed toolbar and footer (objectui#12463)', () => {
    it('grid: the body is the flex-1 min-h-0 item; toolbar above and the 50-record footer below stay outside it', async () => {
      mount();
      const grid = await screen.findByTestId('object-grid-stub');
      expect(grid).toHaveClass('h-full', 'w-full');

      const body = viewBodyOf(grid);
      expect(body).toHaveClass('flex-1', 'min-h-0', 'overflow-hidden');
      const root = body.parentElement as HTMLElement;
      expect(root).toHaveClass('flex', 'flex-col', 'h-full', 'overflow-hidden');

      const footer = await screen.findByTestId('record-count-bar');
      expect(footer).toHaveTextContent('50');
      expect(footer).toHaveClass('shrink-0');
      expect(footer.parentElement).toBe(root);
      expect(body.contains(footer)).toBe(false);
      expect(body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      const toolbar = document.querySelector('[data-print-hide]') as HTMLElement;
      expect(toolbar).not.toBeNull();
      expect(body.contains(toolbar)).toBe(false);
      expect(body.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });

    it('a non-grid visualization (kanban) sits in the same body, unchanged, with no table scroll box', async () => {
      mount({ viewType: 'kanban' } as Partial<ListViewSchema>);
      const board = await screen.findByTestId('object-kanban-stub');
      expect(board).toHaveClass('h-full', 'w-full');
      expect(viewBodyOf(board)).toHaveClass('flex-1', 'min-h-0', 'overflow-hidden');
      expect(document.querySelector('[data-testid="data-table-scroll-box"]')).toBeNull();
    });
  });
});

// ── ListView.nameFieldSelect-13116 ───────────────────────────────────────────

/**
 * objectui#13116 — an ungrouped list asks for the object's declared
 * `nameField`.
 *
 * The bulk confirm step (`plugin-grid` `BulkActionDialog`, objectui#13107)
 * names each affected record from the rows the grid holds: the declared
 * `nameField` value when the row carries it, else the resolver's
 * `Record #ID` floor. An ungrouped list's rows come from `ListView`'s own
 * fetch, and its `$select` harvest had no arm for `nameField`, so a list whose
 * columns omit it fetched rows without it and the step listed `Record #ID`.
 *
 * A grouped grid that owns its fetch projects through `ObjectGrid`'s
 * `getSelectFields`, pinned with the real dialog in plugin-grid's
 * `bulkConfirmNameField-13107.test.tsx`. plugin-list does not depend on
 * plugin-grid, so a stub grid stands in here and the confirm step's name is
 * asked of the rule that step applies, against the rows the grid is handed:
 * the declared value via `recordDisplayValueAt(row, declaredNameField(def))`,
 * then `getRecordDisplayName`.
 *
 * What is pinned:
 *   - a formula `nameField` that is not a column is in `$select`, is not drawn
 *     as a column, and the rows handed to the grid name each record;
 *   - control: an object with no `nameField` sends the same `$select` as
 *     before;
 *   - control: a `nameField` that is a column is sent once.
 */
describe('ListView.nameFieldSelect-13116', () => {
  restoreAfterBlock();

  const CONTACT = 'crm_contact';
  const NOTE = 'crm_note';

  const contactDef = {
    name: CONTACT,
    label: 'Contact',
    nameField: 'full_name',
    fields: {
      id: { name: 'id', type: 'text' },
      first_name: { name: 'first_name', type: 'text', label: 'First Name' },
      last_name: { name: 'last_name', type: 'text', label: 'Last Name' },
      title: { name: 'title', type: 'text', label: 'Title' },
      full_name: { name: 'full_name', type: 'formula', label: 'Full Name', expression: "first_name + ' ' + last_name" },
    },
  };

  // The same shape with no declared pointer: the control.
  const noteDef = {
    name: NOTE,
    label: 'Note',
    fields: {
      id: { name: 'id', type: 'text' },
      subject: { name: 'subject', type: 'text', label: 'Subject' },
      body: { name: 'body', type: 'text', label: 'Body' },
      full_name: { name: 'full_name', type: 'text', label: 'Full Name' },
    },
  };

  const CONTACT_ROWS = [
    { id: 'c1', first_name: 'John', last_name: 'Smith', title: 'VP of Engineering', full_name: 'John Smith' },
    { id: 'c2', first_name: 'Marcus', last_name: 'Reed', title: 'Director of Commercial Systems', full_name: 'Marcus Reed' },
  ];
  const NOTE_ROWS = [{ id: 'n1', subject: 'Kickoff', body: 'Agenda', full_name: 'unused' }];

  let lastGridProps: any = null;
  let prevObjectGrid: any;
  beforeAll(() => {
    prevObjectGrid = ComponentRegistry.get('object-grid');
    ComponentRegistry.register('object-grid', (props: any) => {
      lastGridProps = props;
      return <div data-testid="grid-stub" />;
    });
  });
  afterAll(() => {
    if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
    else ComponentRegistry.unregister('object-grid');
  });

  /** Honours `$select` the way a server does: a row carries the selected keys only. */
  const makeDataSource = (def: Record<string, unknown>, rows: Array<Record<string, unknown>>) =>
    ({
      find: vi.fn(async (_object: string, params: Record<string, any>) => {
        const select = params?.$select as string[] | undefined;
        const data = rows.map((row) =>
          select ? Object.fromEntries(select.filter((k) => k in row).map((k) => [k, row[k]])) : { ...row },
        );
        return { data, total: data.length };
      }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async (name: string) => (name === def.name ? def : null)),
    }) as any;

  async function mount(def: Record<string, unknown>, rows: Array<Record<string, unknown>>, columns: string[]) {
    const dataSource = makeDataSource(def, rows);
    render(
      <SchemaRendererProvider dataSource={dataSource}>
        <ListView
          schema={{ type: 'list-view', objectName: def.name as string, viewType: 'grid', columns } as any}
          dataSource={dataSource}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    const raw = (dataSource.find.mock.calls.at(-1)?.[1]?.$select as string[] | undefined) ?? [];
    return { raw, select: [...raw].sort() };
  }

  /** The rows the grid was handed, once it has been handed some. */
  async function gridRows(): Promise<Array<Record<string, unknown>>> {
    await waitFor(() => expect(Array.isArray(lastGridProps?.data) && lastGridProps.data.length > 0).toBe(true));
    return lastGridProps.data;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    lastGridProps = null;
  });
  afterEach(() => {
    cleanup();
    lastGridProps = null;
  });

  describe('ListView — an ungrouped list asks for the declared nameField (objectui#13116)', () => {
    it('asks for a formula nameField no column shows, does not draw it, and the rows name each record', async () => {
      const { select } = await mount(contactDef, CONTACT_ROWS, ['first_name', 'last_name', 'title']);
      expect(select).toEqual(['first_name', 'full_name', 'id', 'last_name', 'title']);

      // Fetched, never drawn: the grid's columns are the authored three.
      const drawn = (lastGridProps?.columns ?? lastGridProps?.fields ?? []) as unknown[];
      expect(JSON.stringify(drawn)).not.toContain('full_name');

      // The confirm step's rule: the declared value when the row carries it.
      const rows = await gridRows();
      expect(rows.map((row) => recordDisplayValueAt(row, declaredNameField(contactDef)))).toEqual(['John Smith', 'Marcus Reed']);
      expect(rows.map((row) => getRecordDisplayName(contactDef, row))).toEqual(['John Smith', 'Marcus Reed']);
    });

    it('control: an object with no nameField sends the same $select as before', async () => {
      const { select } = await mount(noteDef, NOTE_ROWS, ['subject', 'body']);
      expect(select).toEqual(['body', 'id', 'subject']);
    });

    it('control: a nameField that is a column is sent once', async () => {
      const { raw } = await mount(contactDef, CONTACT_ROWS, ['full_name', 'title']);
      expect(raw.filter((f) => f === 'full_name')).toHaveLength(1);
      expect([...raw].sort()).toEqual(['full_name', 'id', 'title']);
    });
  });
});

// ── ListView.recordDrawerCount-27545 ────────────────────────────────────────────

/**
 * objectstack#27545 — a list under an open record counts its records once,
 * and objectstack#28915 — that count is the list's own.
 *
 * The split pane narrowed the list beside it and printed the count under it
 * (its `record-count-footer`, objectui#10636), so `ListView`'s bar held its
 * count back while a pane narrowed the list. The split pane retired: a record
 * opens in the drawer over the list, which keeps its full width, so the bar
 * prints the count whether or not a record is open (the drawer publishes the
 * open row, `ActiveListRecordProvider`), beside the grid's column summaries.
 */
describe('ListView.recordDrawerCount-27545', () => {
  restoreAfterBlock();

  const OBJECT = 'account';
  const FIELDS = {
    name: { type: 'text', label: 'Name' },
    employees: { type: 'number', label: 'Number of Employees' },
  };
  const ROWS = Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, name: `Acme ${i}`, employees: 10 }));
  const SUMMARIES = [{ key: 'employees', header: 'Number of Employees', label: 'Avg: 10' }];

  function GridProbe(props: { onColumnSummaryChange?: (s: typeof SUMMARIES | null) => void }) {
    const { onColumnSummaryChange } = props;
    const [summaries, setSummaries] = React.useState<typeof SUMMARIES | null>(null);
    React.useEffect(() => {
      onColumnSummaryChange?.(summaries);
    }, [onColumnSummaryChange, summaries]);
    return <button type="button" data-testid="grid-probe" onClick={() => setSummaries(SUMMARIES)} />;
  }

  beforeAll(() => {
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn() as never;
    }
  });
  beforeEach(() => {
    ComponentRegistry.register('object-grid', GridProbe as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.('object-grid');
    cleanup();
  });

  function renderList(openRecordId: string | null) {
    const ds = {
      find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false })),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn(async (name: string) => ({ name, label: 'Account', fields: FIELDS })),
    };
    const schema = {
      type: 'list-view',
      objectName: OBJECT,
      viewType: 'grid',
      columns: ['name', 'employees'],
    } as unknown as ListViewSchema;
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={ds as never}>
          <ActiveListRecordProvider recordId={openRecordId}>
            <ListView schema={schema} dataSource={ds as never} />
          </ActiveListRecordProvider>
        </SchemaRendererProvider>
      </I18nProvider>,
    );
    return ds;
  }

  describe('ListView under the record drawer counts its records once (objectstack#27545, objectstack#28915)', () => {
    it('CONTROL — no record open: the bar prints the count', async () => {
      renderList(null);
      const bar = await screen.findByTestId('record-count-bar');
      await waitFor(() => expect(within(bar).getByText('4 records')).toBeInTheDocument());
    });

    it('a record open in the drawer: the bar still prints the count', async () => {
      renderList('a1');
      const bar = await screen.findByTestId('record-count-bar');
      await waitFor(() => expect(within(bar).getByText('4 records')).toBeInTheDocument());
    });

    it('a record open in the drawer: the column summaries are drawn beside the count', async () => {
      renderList('a1');
      (await screen.findByTestId('grid-probe')).click();
      const bar = await screen.findByTestId('record-count-bar');
      await waitFor(() => expect(within(bar).getByTestId('record-count-summaries')).toHaveTextContent('Number of Employees: Avg: 10'));
      expect(within(bar).getByText('4 records')).toBeInTheDocument();
    });
  });
});

// ── ListView.resetSortToDefaultNoProviderFallback ────────────────────────────

/**
 * `ListView`'s reset-to-declared-sort control resolves to ENGLISH when no
 * `I18nProvider` is mounted — objectui#4396.
 *
 * `list.resetSortToDefault` is one of the six keys PR #4372's census measured
 * as reading **outside** its hook's defaults table with **no inline
 * `defaultValue`** at the call site. #4372 taught `createSafeTranslation`'s
 * fallback to honour an inline default, which fixed the other 20 outside-table
 * keys; these six carry neither, so until this card they fell through to
 * `fallbackT`'s last resort — the raw key. The control in the sort popover was
 * labelled `list.resetSortToDefault`.
 *
 * The call site is bare on purpose and stays bare
 * (`t('list.resetSortToDefault')`, `ListView.tsx`); the fix is the row in
 * `LIST_DEFAULT_TRANSLATIONS`, byte-identical to `en.list.resetSortToDefault`.
 * That table is the same one objectui#4294 pinned byte-for-byte one row above,
 * for the same reason: on a provider-less host it is this copy that renders.
 *
 * Direction: this file was RED before the change (the button's accessible name
 * was the raw key) and is GREEN after.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`, so one `<I18nProvider>` mount
 * anywhere in a file silently resolves every later "no provider" render in that
 * same file against it — a green-looking file that asserts nothing about the
 * fallback. Vitest's `dom` project runs with `isolate: true`, so a file that
 * never mounts a provider gets a genuinely clean global. Keep it that way:
 * **do not import or mount `I18nProvider` here.**
 *
 * Folded into the shared harness (objectstack#29469), where other blocks do
 * mount an `I18nProvider`: that no longer reaches this block.
 * `vitest.setup.i18n-global.ts` (objectui#4514) puts react-i18next's global
 * back to the pointer the file inherited after every test, so each test here
 * still renders with no global instance at all, exactly as this file did.
 */
describe('ListView.resetSortToDefaultNoProviderFallback', () => {
  restoreAfterBlock();

  const objectDef = {
    name: 'projects',
    label: 'Projects',
    fields: {
      name: { type: 'text', label: 'Name' },
      plan_start_date: { type: 'date', label: 'Plan Start Date' },
      status: { type: 'select', label: 'Status' },
    },
  };

  // Rows matter: with an empty result set ListView renders `DataEmptyState`
  // instead of the grid, and the toolbar the sort popover hangs off never mounts.
  const ROWS = [
    { id: 'p-1', name: 'Alpha', plan_start_date: '2026-01-01', status: 'open' },
    { id: 'p-2', name: 'Beta', plan_start_date: '2026-02-01', status: 'done' },
  ];

  /**
   * The control renders only when the view DECLARES a sort — with nothing
   * declared there is no default to return to, so the fixture must declare one.
   */
  const DECLARED_SORT = [
    { field: 'plan_start_date', order: 'asc' },
    { field: 'name', order: 'asc' },
  ];

  let prevObjectGrid: ReturnType<typeof ComponentRegistry.get>;

  beforeAll(() => {
    // plugin-grid is not a dependency of plugin-list (that would be a cycle), so
    // the grid is stubbed — the same device the neighbouring sort tests use.
    prevObjectGrid = ComponentRegistry.get('object-grid');
    ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
  });

  afterAll(() => {
    if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
    else ComponentRegistry.unregister('object-grid');
  });

  afterEach(() => cleanup());

  async function openSortPanel() {
    const dataSource = {
      find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue(objectDef),
    };
    render(
      <SchemaRendererProvider dataSource={dataSource as never}>
        <ListView
          schema={
            {
              type: 'list-view',
              objectName: 'projects',
              viewType: 'grid',
              columns: ['name', 'plan_start_date', 'status'],
              sort: DECLARED_SORT,
            } as unknown as ListViewSchema
          }
          dataSource={dataSource as never}
        />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /^sort/i }));
    await screen.findByText('Sort Records');
  }

  describe('ListView reset-sort control — English fallback with no provider (objectui#4396)', () => {
    it('names the reset control in English, never the raw key', async () => {
      await openSortPanel();

      const reset = screen.getByTestId('sort-reset-default');
      expect(reset.textContent).toBe('Reset to view default');
      expect(reset.textContent).not.toBe('list.resetSortToDefault');
    });

    it('leaves no `list.` raw key anywhere in the sort popover', async () => {
      // Non-vacuity: `Sort Records` (already in the table) proves the popover is
      // genuinely mounted, so the absence below is a fact about the keys rather
      // than about an empty DOM.
      await openSortPanel();

      expect(screen.getByText('Sort Records')).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/list\.[a-zA-Z]/);
    });
  });
});

// ── ListView.rowAdornment-13330 ─────────────────────────────────────────────────

/**
 * objectui#13330 — `rowAdornment`, the host prop the console's Users list sets
 * on a managed environment, reaches the grid as the grid's own `rowAdornment`
 * (a React prop a host passes, never a view key), and only the grid: a board
 * draws no title cell to put it beside. The control mounts the same schema
 * without the prop and the grid is handed none.
 */
describe('ListView.rowAdornment-13330', () => {
  restoreAfterBlock();

  const GRID = { type: 'list-view', objectName: 'sys_user', viewType: 'grid', fields: ['name'] } as ListViewSchema;
  const BOARD = {
    type: 'list-view',
    objectName: 'sys_user',
    viewType: 'kanban',
    fields: ['name'],
    kanban: { groupBy: 'status' },
  } as unknown as ListViewSchema;

  let gridProps: Record<string, unknown> | undefined;
  let boardProps: Record<string, unknown> | undefined;
  let previousGrid: ReturnType<typeof ComponentRegistry.get>;
  let previousBoard: ReturnType<typeof ComponentRegistry.get>;

  function mount(schema: ListViewSchema, props: Record<string, unknown> = {}) {
    const dataSource = {
      find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Ada', status: 'active' }], total: 1 }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({
        name: 'sys_user',
        fields: { name: { type: 'text' }, status: { type: 'select', options: [{ value: 'active', label: 'Active' }] } },
      }),
    };
    render(
      <SchemaRendererProvider dataSource={dataSource as never}>
        <ListView schema={schema} dataSource={dataSource as never} {...props} />
      </SchemaRendererProvider>,
    );
  }

  beforeEach(() => {
    gridProps = undefined;
    boardProps = undefined;
    previousGrid = ComponentRegistry.get('object-grid');
    previousBoard = ComponentRegistry.get('object-kanban');
    ComponentRegistry.register('object-grid', (props: any) => {
      gridProps = props;
      return <div data-testid="grid-stub" />;
    });
    ComponentRegistry.register('object-kanban', (props: any) => {
      boardProps = props;
      return <div data-testid="board-stub" />;
    });
  });

  afterEach(() => {
    cleanup();
    if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
    if (previousBoard) ComponentRegistry.register('object-kanban', previousBoard as any);
  });

  describe('ListView rowAdornment reaches the grid (objectui#13330)', () => {
    it('the grid is handed the host’s function as its own rowAdornment', async () => {
      const rowAdornment = vi.fn(() => null);
      mount(GRID, { rowAdornment });
      await screen.findByTestId('grid-stub');
      expect(gridProps?.rowAdornment).toBe(rowAdornment);
    });

    it('a board is not handed it', async () => {
      mount(BOARD, { rowAdornment: vi.fn(() => null) });
      await screen.findByTestId('board-stub');
      expect(boardProps).toBeDefined();
      expect(boardProps && 'rowAdornment' in boardProps).toBe(false);
    });

    it('CONTROL — without the prop the grid is handed none', async () => {
      mount(GRID);
      await screen.findByTestId('grid-stub');
      expect(gridProps).toBeDefined();
      expect(gridProps && 'rowAdornment' in gridProps).toBe(false);
    });
  });
});

// ── ListView.setupChrome-12606 ──────────────────────────────────────────────────

/**
 * objectui#12606 — the host prop the console's Setup app sets on its record
 * lists: `defaultRowNumbers` (the grid opens without the `#` numbers). A React
 * prop a host passes, never a view key. The Display control still draws (the
 * maintainer's ruling C on the card withdrew the Display hide rule). The
 * control mounts the same schema without the prop and reads today's shape.
 */
describe('ListView.setupChrome-12606', () => {
  restoreAfterBlock();

  const SCHEMA = {
    type: 'list-view',
    objectName: 'sys_user',
    viewType: 'grid',
    fields: ['name'],
  } as ListViewSchema;

  let gridProps: Record<string, unknown> | undefined;
  let previousGrid: ReturnType<typeof ComponentRegistry.get>;

  function mount(props: Record<string, unknown> = {}) {
    const dataSource = {
      find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Ada' }], total: 1 }),
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'sys_user', fields: {} }),
    };
    render(
      <SchemaRendererProvider dataSource={dataSource as never}>
        <ListView schema={SCHEMA} dataSource={dataSource as never} {...props} />
      </SchemaRendererProvider>,
    );
  }

  beforeEach(() => {
    gridProps = undefined;
    previousGrid = ComponentRegistry.get('object-grid');
    ComponentRegistry.register('object-grid', (props: any) => {
      gridProps = props;
      return <div data-testid="grid-stub" />;
    });
  });

  afterEach(() => {
    cleanup();
    if (previousGrid) ComponentRegistry.register('object-grid', previousGrid as any);
  });

  describe('the list’s Setup chrome is one host prop (objectui#12606)', () => {
    it('`defaultRowNumbers={false}` opens the grid without row numbers; Display still draws, and row numbers off is not a changed setting', async () => {
      mount({ defaultRowNumbers: false });
      await screen.findByTestId('grid-stub');
      expect(gridProps?.showRowNumbers).toBe(false);
      expect(screen.getByTestId('toolbar-display-trigger')).toBeTruthy();
      expect(screen.queryByTestId('toolbar-display-count')).toBeNull();
    });

    it('CONTROL — without the prop the grid numbers its rows and the bar draws Display', async () => {
      mount();
      await screen.findByTestId('grid-stub');
      expect(gridProps?.showRowNumbers).toBe(true);
      expect(screen.getByTestId('toolbar-display-trigger')).toBeTruthy();
    });
  });
});
