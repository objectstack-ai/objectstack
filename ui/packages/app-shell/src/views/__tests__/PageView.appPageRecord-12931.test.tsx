/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12931 — an `app` page that declares `PageSchema.record`
 * (objectstack#24265) reads that ONE row, and every component `visibleWhen` on
 * the page reads it as `record`.
 *
 * The count and the tier are FIELDS on the row: a `summary` roll-up
 * (`record.env_count >= 2`) and the object's own plan field
 * (`record.plan != 'free'`). No root is added.
 *
 * ## What renders for real
 *
 * `PageView`, the `app` page renderer and `element:text` from
 * `@object-ui/components`, `SchemaRenderer` and its `visibleWhen` evaluation.
 * The adapter is a fake whose `find` is counted, so "one row read per page
 * open" is a count, not a reading of the code. A probe block reports the
 * predicate scope it sees, for the controls that are about the scope itself.
 *
 * ## The pins
 *
 *  - (a) the tier: a block gated `record.plan != 'free'` is hidden on a `free`
 *    row and shown on a `team` row;
 *  - (b) the count: a tag gated `record.env_count >= 2` is shown only when the
 *    roll-up field is at least 2;
 *  - (c) the controls: a page with no binding (and a non-`app` page carrying
 *    one) keeps the ambient scope untouched and reads nothing; the loading
 *    state draws no block; the 0-row state binds `record` as `null`; a failed
 *    read draws the failed-read state and no block, and its Retry re-reads; a
 *    refused read reads as no row; the binding is read exactly once, with its
 *    filter's `{current_org_id}` token resolved.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PageSchema } from '@objectstack/spec/ui';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', role: 'user', image: null }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (k: string, o?: { defaultValue?: string; name?: string }) => o?.defaultValue ?? o?.name ?? k, language: 'en' }),
}));

/** The stored page document the next mount resolves. */
let storedPage: Record<string, unknown> = {};

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ pages: [storedPage], objects: [], getTypeStatus: () => 'ready' }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

// Module scope, never a `beforeAll` (AGENTS.md 测试纪律): the `app` page and
// `element:text` renderers.
import '@object-ui/components';
import { ComponentRegistry } from '@object-ui/core';
import {
  AdapterCtx,
  FilterScopeProvider,
  PredicateScopeProvider,
  SchemaRendererProvider,
  usePredicateScope,
} from '@object-ui/react';
import { PageView } from '../PageView';

/** Every predicate scope the probe block saw, latest last. */
const seenScopes: Record<string, unknown>[] = [];
function ScopeProbe() {
  seenScopes.push(usePredicateScope());
  return <span data-testid="scope-probe" />;
}
ComponentRegistry.register('test-12931-scope-probe', ScopeProbe as never);

/** The ambient scope the shell would publish: handed to the page untouched when it binds no row. */
const AMBIENT = { current_user: { id: 'u1' }, user: { id: 'u1' }, features: { multiOrgEnabled: true } };

const text = (id: string, content: string, visibleWhen?: string) => ({
  type: 'element:text',
  id,
  properties: { content },
  ...(visibleWhen ? { visibleWhen } : {}),
});

/** The org-row binding: the signed-in org, by its `{current_org_id}` token. */
const ORG_BINDING = {
  object: 'org',
  filter: [{ field: 'id', operator: 'equals', value: '{current_org_id}' }],
};

/** The environments page: paid-tier action, Free-tier lock line, and a tag that needs a second environment. */
function envPage(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'environments',
    label: 'Environments',
    type: 'app',
    record: ORG_BINDING,
    regions: [
      {
        name: 'main',
        components: [
          text('title', 'Environment list'),
          text('new_env', 'New environment', "record.plan != 'free'"),
          text('free_lock', 'Dev environments from Team', "record.plan == 'free'"),
          text('prod_tag', 'Production', 'record.env_count >= 2'),
        ],
      },
    ],
    ...extra,
  };
}

type Find = (object: string, params?: unknown) => Promise<unknown>;

function mount(page: Record<string, unknown>, find: Find) {
  storedPage = page;
  const ds = {
    find: vi.fn(find),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
  };
  render(
    <AdapterCtx.Provider value={ds as never}>
      <SchemaRendererProvider dataSource={ds as never}>
        <FilterScopeProvider currentUserId="u1" currentOrgId="o1">
          <PredicateScopeProvider scope={AMBIENT}>
            <MemoryRouter initialEntries={[`/apps/cloud/page/${page.name as string}`]}>
              <Routes>
                <Route path="/apps/:app/page/:pageName" element={<PageView />} />
              </Routes>
            </MemoryRouter>
          </PredicateScopeProvider>
        </FilterScopeProvider>
      </SchemaRendererProvider>
    </AdapterCtx.Provider>,
  );
  return ds;
}

/** Let every effect a step schedules fire. */
const settle = (ms = 50) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const orgReads = (ds: { find: { mock: { calls: unknown[][] } } }) =>
  ds.find.mock.calls.filter((c) => c[0] === 'org');

const shown = (content: string) => screen.queryByText(content) !== null;

afterEach(() => {
  cleanup();
  seenScopes.length = 0;
});

describe('objectui#12931 — an app page reads its bound row as `record`', () => {
  it('the fixture is a page the spec accepts, with the binding on an `app` page', () => {
    // Control: a fixture the spec refuses would pin a shape no author can write.
    const parsed = PageSchema.safeParse(envPage());
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // And the placement check is live: the same binding on a `home` page is refused.
    expect(PageSchema.safeParse(envPage({ type: 'home' })).success).toBe(false);
  });

  it('(a) the tier: a Free row hides the paid-tier block and shows the lock line', async () => {
    mount(envPage(), async () => ({ data: [{ id: 'o1', plan: 'free', env_count: 1 }] }));
    await settle();
    expect(shown('Environment list'), 'the ungated block renders: the page body is on screen').toBe(true);
    expect(shown('New environment')).toBe(false);
    expect(shown('Dev environments from Team')).toBe(true);
  });

  it('(a) the tier: a Team row shows the paid-tier block and hides the lock line', async () => {
    mount(envPage(), async () => ({ data: [{ id: 'o1', plan: 'team', env_count: 1 }] }));
    await settle();
    expect(shown('New environment')).toBe(true);
    expect(shown('Dev environments from Team')).toBe(false);
  });

  it('(b) the count: the tag shows only when the roll-up field is at least 2', async () => {
    mount(envPage(), async () => ({ data: [{ id: 'o1', plan: 'team', env_count: 1 }] }));
    await settle();
    expect(shown('Environment list')).toBe(true);
    expect(shown('Production'), 'one environment: no tag').toBe(false);
    cleanup();

    mount(envPage(), async () => ({ data: [{ id: 'o1', plan: 'team', env_count: 2 }] }));
    await settle();
    expect(shown('Production'), 'a second environment: the tag').toBe(true);
  });

  it('the PARSED document gives the same verdicts as the stored one', async () => {
    // `PageSchema` normalises the predicates it parses; the verdict is the same either way.
    const parsed = PageSchema.parse(envPage()) as unknown as Record<string, unknown>;
    mount(parsed, async () => ({ data: [{ id: 'o1', plan: 'free', env_count: 2 }] }));
    await settle();
    expect(shown('Environment list')).toBe(true);
    expect(shown('New environment')).toBe(false);
    expect(shown('Dev environments from Team')).toBe(true);
    expect(shown('Production')).toBe(true);
  });

  it('reads the row exactly once per page open: one row, the org token resolved', async () => {
    const ds = mount(envPage(), async () => ({ data: [{ id: 'o1', plan: 'team', env_count: 2 }] }));
    await settle(150);
    const reads = orgReads(ds);
    expect(reads).toHaveLength(1);
    const params = reads[0][1] as Record<string, unknown>;
    expect(params.$top).toBe(1);
    expect(JSON.stringify(params.$filter)).toContain('"o1"');
    expect(JSON.stringify(params.$filter)).not.toContain('current_org_id');
    // Nothing else is read for the binding.
    expect(ds.find).toHaveBeenCalledTimes(1);
  });
});

describe('objectui#12931 — the controls', () => {
  it('an app page with no binding keeps the ambient scope exactly, and reads nothing', async () => {
    const page = {
      name: 'plain',
      label: 'Plain',
      type: 'app',
      regions: [{ name: 'main', components: [{ type: 'test-12931-scope-probe', id: 'probe' }] }],
    };
    const ds = mount(page, async () => ({ data: [{ id: 'o1' }] }));
    await settle();
    expect(seenScopes.length, 'the probe never rendered; this measured nothing').toBeGreaterThan(0);
    const scope = seenScopes.at(-1)!;
    expect(scope, 'the ambient scope reaches the page as the same object').toBe(AMBIENT);
    expect('record' in scope).toBe(false);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('a non-app page carrying a binding reads nothing and binds no `record`', async () => {
    const page = {
      name: 'landing',
      label: 'Landing',
      type: 'home',
      record: ORG_BINDING,
      regions: [{ name: 'main', components: [{ type: 'test-12931-scope-probe', id: 'probe' }] }],
    };
    const ds = mount(page, async () => ({ data: [{ id: 'o1' }] }));
    await settle();
    expect(seenScopes.length).toBeGreaterThan(0);
    expect(seenScopes.at(-1)).toBe(AMBIENT);
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('the bound page publishes the ambient roots plus `record`, and nothing else', async () => {
    const row = { id: 'o1', plan: 'team', env_count: 2 };
    const page = {
      ...envPage(),
      regions: [{ name: 'main', components: [{ type: 'test-12931-scope-probe', id: 'probe' }] }],
    };
    mount(page, async () => ({ data: [row] }));
    await settle();
    expect(seenScopes.at(-1)).toEqual({ ...AMBIENT, record: row });
  });

  it('while the row loads, no block is drawn: pending, neither shown-then-hidden nor the reverse', async () => {
    let answer!: (value: unknown) => void;
    mount(envPage(), () => new Promise((resolve) => { answer = resolve; }));
    await settle();
    expect(screen.getByTestId('page-record-loading')).toBeInTheDocument();
    for (const content of ['Environment list', 'New environment', 'Dev environments from Team', 'Production']) {
      expect(shown(content), `${content} must not render before the row lands`).toBe(false);
    }
    await act(async () => {
      answer({ data: [{ id: 'o1', plan: 'free', env_count: 1 }] });
    });
    await settle();
    expect(screen.queryByTestId('page-record-loading')).toBeNull();
    expect(shown('Environment list')).toBe(true);
    expect(shown('New environment')).toBe(false);
    expect(shown('Dev environments from Team')).toBe(true);
  });

  it('0 rows: `record` is bound as null, and predicates read it as absent', async () => {
    const page = envPage();
    (page.regions as Array<{ components: unknown[] }>)[0].components.push(
      text('no_row', 'No organisation row', 'record == null'),
      text('has_row', 'Has organisation row', 'record != null'),
      { type: 'test-12931-scope-probe', id: 'probe' },
    );
    mount(page, async () => ({ data: [] }));
    await settle();
    expect(seenScopes.at(-1)).toEqual({ ...AMBIENT, record: null });
    expect(shown('Environment list')).toBe(true);
    expect(shown('No organisation row')).toBe(true);
    expect(shown('Has organisation row')).toBe(false);
  });

  it('a refused read (403) reads as no row, not as a failure', async () => {
    const page = { ...envPage(), regions: [{ name: 'main', components: [{ type: 'test-12931-scope-probe', id: 'probe' }] }] };
    mount(page, async () => {
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    });
    await settle();
    expect(screen.queryByTestId('page-record-load-failed')).toBeNull();
    expect(seenScopes.at(-1)).toEqual({ ...AMBIENT, record: null });
  });

  it('a failed read fails closed: the failed-read state and no block; Retry re-reads', async () => {
    let fail = true;
    const ds = mount(envPage(), async () => {
      if (fail) throw new Error('upstream exploded');
      return { data: [{ id: 'o1', plan: 'team', env_count: 2 }] };
    });
    await settle();
    expect(screen.getByTestId('page-record-load-failed')).toBeInTheDocument();
    for (const content of ['Environment list', 'New environment', 'Dev environments from Team', 'Production']) {
      expect(shown(content), `${content} must not render after a failed read`).toBe(false);
    }
    expect(orgReads(ds)).toHaveLength(1);

    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByTestId('page-record-load-failed-retry'));
    });
    await settle();
    expect(orgReads(ds), 'Retry is one more read of the same row').toHaveLength(2);
    expect(screen.queryByTestId('page-record-load-failed')).toBeNull();
    expect(shown('New environment')).toBe(true);
    expect(shown('Production')).toBe(true);
  });
});
