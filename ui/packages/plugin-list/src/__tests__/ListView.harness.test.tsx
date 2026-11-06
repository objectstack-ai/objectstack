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
 *    block left: registry entries, a swapped-in `localStorage`, the contents
 *    of both storages, and the `lang` / `dir` that `I18nProvider` sets on
 *    `<html>`. The next block starts where its file did.
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
import { SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { ActiveListRecordProvider } from '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

/**
 * Puts back, after the calling block's last test, what the block's hooks and
 * tests left behind, so the next block starts from the state its former file
 * started from. Measured before this existed: three blocks left stand-in
 * renderers registered or the real `object-grid` unregistered, one left its
 * `localStorage` stand-in installed, and a view preference one block saved was
 * still in storage for the four blocks after it.
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
