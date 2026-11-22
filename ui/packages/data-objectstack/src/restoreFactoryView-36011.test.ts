/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

/**
 * objectstack#36011 — `restoreFactoryView` removes the override a read-only
 * package's customization pair holds of one of its views (ADR-0146 D2,
 * "Restore package original" = delete the overriding item from `.custom`).
 *
 * The override is the one `updateView` writes: served under the shipping
 * package (`_packageId`) with the declaration (`overrides`) naming it. The
 * pair is the ensure door's answer for that package, the home `updateView`
 * wrote into, and the pair's draft of the view, then its row, are deleted
 * there (`DELETE /meta/view/NAME?package=PAIR`). The shipping package's own
 * view is never deleted. A view that is no override sends nothing; a refused
 * delete says the server's reason; a pair that held no row of the view is a
 * restore that did not happen.
 */

const OBJECT = 'showcase_task';
const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const VIEW = `${OBJECT}.default`;

/** The shipped view as `GET /meta/view/NAME` serves it, the package stamped on the item. */
const SHIPPED = {
  name: VIEW,
  object: OBJECT,
  viewKind: 'list',
  label: 'All Tasks',
  config: { type: 'grid', data: { provider: 'object', object: OBJECT } },
  _packageId: BASE,
};
/** The same view once a pin wrote it into the pair: served under the base, declaring the override. */
const CUSTOMIZED = { ...SHIPPED, isPinned: true, overrides: { package: BASE, basedOn: '0.1.0' } };

const REMOVED = { success: true, reset: true, message: `Removed view/${VIEW}.` };
const NO_DRAFT = { success: true, reset: false, message: `No pending draft for view/${VIEW}.` };
const NOTHING = { success: true, reset: false, message: `No view '${VIEW}' found — nothing to delete.` };
const REFUSED = { error: 'Permission denied: manage_metadata is required to delete metadata.', code: 'PERMISSION_DENIED' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeDS(opts: { served: unknown; draft?: () => Response; published?: () => Response }) {
  const deletes: URL[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.includes('/meta/view/') && (init?.method ?? 'GET') === 'DELETE') {
      deletes.push(url);
      return url.searchParams.get('state') === 'draft'
        ? (opts.draft ?? (() => json(NO_DRAFT)))()
        : (opts.published ?? (() => json(REMOVED)))();
    }
    return json({ success: true, data: { capabilities: {}, routes: {} } });
  });
  const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
  ds.connected = true;
  ds.connectionState = 'connected';
  const ensureCustomization = vi.fn(async (id: string) => ({
    basePackageId: id, packageId: PAIR, namespace: 'showcase_custom', dependencyRange: '^0', created: false, writable: true,
  }));
  const getItem = vi.fn(async () => ({ item: opts.served }));
  ds.client = { meta: { getItem }, packages: { ensureCustomization } };
  const invalidated: string[] = [];
  const invalidate = ds.invalidateViewKeys.bind(ds);
  ds.invalidateViewKeys = (objectName: string, viewName: string) => {
    invalidated.push(`${objectName}/${viewName}`);
    return invalidate(objectName, viewName);
  };
  return { ds, deletes, ensureCustomization, getItem, invalidated };
}

describe('restoreFactoryView — the pair\'s override of a package view is removed (objectstack#36011)', () => {
  it('deletes the view\'s draft, then its row, at the pair the ensure door names, and nothing at the package', async () => {
    const h = makeDS({ served: CUSTOMIZED });

    const result = await h.ds.restoreFactoryView(OBJECT, VIEW);

    expect(h.getItem).toHaveBeenCalledWith('view', VIEW);
    expect(h.ensureCustomization).toHaveBeenCalledWith(BASE);
    expect(h.deletes.map((u) => [u.pathname, u.searchParams.get('package'), u.searchParams.get('state')])).toEqual([
      [`/api/v1/meta/view/${VIEW}`, PAIR, 'draft'],
      [`/api/v1/meta/view/${VIEW}`, PAIR, null],
    ]);
    expect(result).toEqual({ deleted: true, draft: { removed: false, reset: false, message: NO_DRAFT.message }, published: { removed: true, reset: true, message: REMOVED.message } });
    expect(h.invalidated).toEqual([`${OBJECT}/${VIEW}`]);
  });

  it('a view no customization overrides sends no delete and says there is nothing to restore', async () => {
    const h = makeDS({ served: SHIPPED });

    const err = (await h.ds.restoreFactoryView(OBJECT, VIEW).catch((e: unknown) => e)) as Error;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/not a customization of a package's view/);
    expect(h.ensureCustomization).not.toHaveBeenCalled();
    expect(h.deletes).toHaveLength(0);
  });

  it('a declaration naming another package is no override of this one: nothing is sent', async () => {
    const h = makeDS({ served: { ...CUSTOMIZED, overrides: { package: 'com.example.other', basedOn: '1.0.0' } } });

    await expect(h.ds.restoreFactoryView(OBJECT, VIEW)).rejects.toThrow(/not a customization/);
    expect(h.deletes).toHaveLength(0);
  });

  it('a refused delete is thrown with the server\'s reason on the next line, and the status on its cause', async () => {
    const h = makeDS({ served: CUSTOMIZED, draft: () => json(REFUSED, 403) });

    const err = (await h.ds.restoreFactoryView(OBJECT, VIEW).catch((e: unknown) => e)) as Error & { cause?: { status?: number; code?: string } };

    expect(err.message.split('\n')[0]).toMatch(/was NOT restored/);
    expect(err.message).toContain(REFUSED.error);
    expect(err.cause?.status).toBe(403);
    expect(err.cause?.code).toBe('PERMISSION_DENIED');
    // The draft delete was refused: the row's delete was never sent.
    expect(h.deletes).toHaveLength(1);
    expect(h.invalidated).toEqual([`${OBJECT}/${VIEW}`]);
  });

  it('a pair that holds no row of the view is a restore that did not happen', async () => {
    const h = makeDS({ served: CUSTOMIZED, published: () => json(NOTHING) });

    await expect(h.ds.restoreFactoryView(OBJECT, VIEW)).rejects.toThrow(/holds no customization of it/);
    expect(h.deletes).toHaveLength(2);
  });
});

describe('listViews — a record\'s override declaration reaches the row (objectstack#36011)', () => {
  function listing(items: unknown[]) {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/meta/view')) return json({ success: true, data: { type: 'view', items } });
      return json({ success: true, data: { capabilities: {}, routes: {} } });
    });
    const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
    ds.connected = true;
    ds.connectionState = 'connected';
    return ds;
  }

  it('the flattened row of a canonical record carries `overrides`; a record without one carries none', async () => {
    const other = { ...SHIPPED, name: `${OBJECT}.mine`, label: 'Mine' };
    const ds = listing([CUSTOMIZED, other]);

    const rows = await ds.listViews(OBJECT);

    const byName = Object.fromEntries(rows.map((r: any) => [r.name, r]));
    expect(byName[VIEW].overrides).toEqual(CUSTOMIZED.overrides);
    expect(byName[VIEW]._packageId).toBe(BASE);
    expect('overrides' in byName[other.name]).toBe(false);
  });
});
