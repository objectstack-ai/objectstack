/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#29550 — an object route reads that object's views, not every
 * view of every object.
 *
 * ObjectView's saved-views overlay calls `listViews(object)` and its override
 * merge calls `listViewOverrides(object)` on every object route. Both used to
 * read the whole `GET /api/v1/meta/view` list and keep one object's rows. They
 * now read `GET /api/v1/meta/view?object=OBJECT` (ADR-0017 section 3.5) while
 * nothing has stored the whole list, and the stored list, narrowed and ordered
 * by the same rule, once something has.
 *
 * Over the REAL adapter and the real `@objectstack/client`: only `fetch` is a
 * double, and it records every request. It serves the whole list and the
 * one-object read the way the server does (`objectViewRoute.test-support.ts`
 * restates the server's rule).
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';
import { serveObjectViews } from './objectViewRoute.test-support';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * crm_lead's views as the registry lists them, deliberately NOT in the
 * contract's order (order, then name), plus another object's view, a
 * form-family view and a personalization overlay.
 */
const ROWS = [
  { name: 'crm_lead.zz_mine', object: 'crm_lead', viewKind: 'list', label: 'Mine', config: { type: 'grid', data: { object: 'crm_lead' } } },
  { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list', label: 'All Leads', isDefault: true, config: { type: 'grid', data: { object: 'crm_lead' } } },
  { name: 'crm_account.all', object: 'crm_account', viewKind: 'list', label: 'All Accounts', config: { type: 'grid', data: { object: 'crm_account' } } },
  { name: 'crm_lead.board', object: 'crm_lead', viewKind: 'list', label: 'Board', order: -1, config: { type: 'kanban', data: { object: 'crm_lead' } } },
  { name: 'crm_lead.default', object: 'crm_lead', viewKind: 'form', label: 'Lead', config: { type: 'simple' } },
  { name: 'crm_lead.overlay', object: 'crm_lead', viewKind: 'list', type: 'grid', rowHeight: 40, _isOverride: true },
];

/** The tabs listViews answers for crm_lead: list family, no overlay, contract order. */
const CRM_LEAD_TABS = ['crm_lead.board', 'crm_lead.all', 'crm_lead.zz_mine'];

function makeServer(opts: { rows?: any[]; draftRows?: any[]; objectReadAnswer?: Response } = {}) {
  const rows = opts.rows ?? ROWS;
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url: url.pathname + url.search, headers: { ...(init?.headers as Record<string, string>) } });
    if (url.pathname === '/api/v1/meta/view') {
      if (url.searchParams.get('preview') === 'draft') return json({ type: 'view', items: opts.draftRows ?? rows });
      const object = url.searchParams.get('object');
      if (object !== null) return opts.objectReadAnswer ?? json({ type: 'view', items: serveObjectViews(rows, object) });
      return json({ type: 'view', items: rows });
    }
    return json({ success: true, data: { capabilities: {}, routes: {} } });
  });
  return { fetchImpl, requests };
}

function makeAdapter(fetchImpl: any, extra: Record<string, unknown> = {}) {
  const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl, ...extra });
  ds.connected = true;
  ds.connectionState = 'connected';
  return ds;
}

/** What ObjectView does on an object route: both readers, together. */
async function openObjectRoute(ds: any, object: string) {
  const [tabs, overrides] = await Promise.all([ds.listViews(object), ds.listViewOverrides(object)]);
  return { tabs, overrides };
}

const viewReads = <R extends { url: string }>(requests: R[]): R[] => requests.filter((r) => r.url.startsWith('/api/v1/meta/view'));
const unscoped = (requests: { url: string }[]) =>
  viewReads(requests).filter((r) => !new URL(r.url, 'http://x').searchParams.has('object'));

describe('objectstack#29550 — an object route reads one object\'s views', () => {
  it('asks only GET /meta/view?object=OBJECT, once for both readers, and no unscoped /meta/view', async () => {
    const { fetchImpl, requests } = makeServer();
    const ds = makeAdapter(fetchImpl);

    const { tabs, overrides } = await openObjectRoute(ds, 'crm_lead');

    expect(viewReads(requests).map((r) => r.url)).toEqual(['/api/v1/meta/view?object=crm_lead']);
    expect(unscoped(requests)).toEqual([]);
    expect(tabs.map((v: any) => v.name)).toEqual(CRM_LEAD_TABS);
    // The override map keeps every bound row, the overlay and the form view
    // included, keyed by name.
    expect(Object.keys(overrides).sort()).toEqual(
      ['crm_lead.all', 'crm_lead.board', 'crm_lead.default', 'crm_lead.overlay', 'crm_lead.zz_mine'],
    );
  });

  it('CONTROL: with the whole list already loaded, nothing more is asked, and the answers are the same', async () => {
    const scoped = makeServer();
    const expected = await openObjectRoute(makeAdapter(scoped.fetchImpl), 'crm_lead');

    const { fetchImpl, requests } = makeServer();
    const ds = makeAdapter(fetchImpl);
    // The MetadataProvider's whole-list read, which stores the list.
    await ds.getClient().meta.getItems('view');
    const before = requests.length;

    const answered = await openObjectRoute(ds, 'crm_lead');

    expect(requests.length).toBe(before);
    expect(viewReads(requests).map((r) => r.url)).toEqual(['/api/v1/meta/view']);
    // Same rows, same order, whichever read answered: the tabs do not
    // reorder with what else has loaded.
    expect(answered.tabs).toEqual(expected.tabs);
    expect(answered.overrides).toEqual(expected.overrides);
  });

  it('with the whole list on the wire, both readers join it: no one-object read beside it, the same answers', async () => {
    const scoped = makeServer();
    const expected = await openObjectRoute(makeAdapter(scoped.fetchImpl), 'crm_lead');

    const { fetchImpl, requests } = makeServer();
    const ds = makeAdapter(fetchImpl);
    // The app object scope's whole-list read (objectstack#29551), not landed
    // yet when the object route opens.
    const listing = ds.getClient().meta.getItems('view');

    const answered = await openObjectRoute(ds, 'crm_lead');
    await listing;

    expect(viewReads(requests).map((r) => r.url)).toEqual(['/api/v1/meta/view']);
    expect(answered.tabs).toEqual(expected.tabs);
    expect(answered.overrides).toEqual(expected.overrides);
  });

  it.each([
    ['a view write (invalidateViewKeys)', (ds: any) => ds.invalidateViewKeys('crm_lead', 'crm_lead.all')],
    ['a write of the view list through the console client (invalidateCache)', (ds: any) => ds.invalidateCache('list:view')],
    ['an organization, session or locale switch (clearCache)', (ds: any) => ds.clearCache()],
  ])('%s detaches the one-object read in flight: a read after it asks again', async (_name, drop) => {
    const gate: { open?: () => void } = {};
    const opened = new Promise<void>((resolve) => { gate.open = resolve; });
    const { fetchImpl, requests } = makeServer();
    const held = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const answer = await fetchImpl(input, init);
      if (new URL(String(input)).searchParams.has('object') && viewReads(requests).length === 1) await opened;
      return answer;
    });
    const ds = makeAdapter(held);

    const before = ds.listViews('crm_lead');
    await vi.waitFor(() => expect(viewReads(requests)).toHaveLength(1));
    drop(ds);
    const after = ds.listViews('crm_lead');
    gate.open!();
    await Promise.all([before, after]);

    expect(viewReads(requests).map((r) => r.url)).toEqual([
      '/api/v1/meta/view?object=crm_lead',
      '/api/v1/meta/view?object=crm_lead',
    ]);
  });

  it.each([
    ['a view write (invalidateViewKeys)', (ds: any) => ds.invalidateViewKeys('crm_lead', 'crm_lead.all')],
    ['an organization, session or locale switch (clearCache)', (ds: any) => ds.clearCache()],
  ])('the one-object answer is stored for the next read, and %s drops it', async (_name, drop) => {
    const { fetchImpl, requests } = makeServer();
    const ds = makeAdapter(fetchImpl);

    await ds.listViews('crm_lead');
    await ds.listViewOverrides('crm_lead');
    expect(viewReads(requests)).toHaveLength(1);

    drop(ds);
    await ds.listViews('crm_lead');
    expect(viewReads(requests).map((r) => r.url)).toEqual([
      '/api/v1/meta/view?object=crm_lead',
      '/api/v1/meta/view?object=crm_lead',
    ]);
  });

  it('CONTROL: with nothing dropped, a read in flight is joined', async () => {
    const { fetchImpl, requests } = makeServer();
    const ds = makeAdapter(fetchImpl);
    await Promise.all([ds.listViews('crm_lead'), ds.listViews('crm_lead')]);
    expect(viewReads(requests)).toHaveLength(1);
  });

  it('a second object route asks its own object only', async () => {
    const { fetchImpl, requests } = makeServer();
    const ds = makeAdapter(fetchImpl);

    await openObjectRoute(ds, 'crm_lead');
    const { tabs } = await openObjectRoute(ds, 'crm_account');

    expect(viewReads(requests).map((r) => r.url)).toEqual([
      '/api/v1/meta/view?object=crm_lead',
      '/api/v1/meta/view?object=crm_account',
    ]);
    expect(tabs.map((v: any) => v.name)).toEqual(['crm_account.all']);
  });

  it('a server that does not read ?object= still yields one object\'s rows', async () => {
    // An older server answers the whole list on the one-object URL.
    const { fetchImpl } = makeServer({ objectReadAnswer: json({ type: 'view', items: ROWS }) });
    const { tabs } = await openObjectRoute(makeAdapter(fetchImpl), 'crm_lead');
    expect(tabs.map((v: any) => v.name)).toEqual(CRM_LEAD_TABS);
  });

  it('sends the adapter\'s auth and the client\'s locale, as the client\'s own reads do', async () => {
    const { fetchImpl, requests } = makeServer();
    const ds = makeAdapter(fetchImpl, { token: 'tok', locale: 'zh-CN' });

    await ds.listViews('crm_lead');

    const [read] = viewReads(requests);
    expect(read.headers.Authorization).toBe('Bearer tok');
    expect(read.headers['Accept-Language']).toBe('zh-CN');
  });

  it('a refused read keeps each reader\'s failure contract', async () => {
    const refused = () => json({ error: { code: 'PERMISSION_DENIED', message: 'no' } }, 403);
    const { fetchImpl } = makeServer({ objectReadAnswer: refused() });
    const ds = makeAdapter(fetchImpl);
    const warnings: any[] = [];
    ds.onMetadataReadWarning((ev: any) => warnings.push(ev));

    // listViews degrades to [] and says why; listViewOverrides rejects.
    expect(await ds.listViews('crm_lead')).toEqual([]);
    expect(warnings).toEqual([expect.objectContaining({
      operation: 'listViews', objectName: 'crm_lead', reason: 'refused', code: 'PERMISSION_DENIED', status: 403,
    })]);
    const again = makeServer({ objectReadAnswer: refused() });
    await expect(makeAdapter(again.fetchImpl).listViewOverrides('crm_lead')).rejects.toMatchObject({ status: 403 });
  });

  it('the draft-preview read is unchanged: one ?preview=draft list, no ?object=, the same rule on its rows', async () => {
    const legacy = { name: 'crm_lead.legacy', object: 'crm_lead', type: 'grid' };
    const draftRows = [...ROWS, { ...ROWS[0], name: 'crm_lead.draft_only', _draft: true }, legacy];
    const { fetchImpl, requests } = makeServer({ draftRows });
    const ds = makeAdapter(fetchImpl);

    const tabs = await ds.listViews('crm_lead', { previewDrafts: true });

    expect(viewReads(requests).map((r) => r.url)).toEqual(['/api/v1/meta/view?preview=draft']);
    expect(tabs.map((v: any) => v.name)).toEqual(['crm_lead.board', 'crm_lead.all', 'crm_lead.draft_only', 'crm_lead.zz_mine']);
    expect(tabs.find((v: any) => v.name === 'crm_lead.draft_only')?._draft).toBe(true);
  });
});
