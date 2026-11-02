// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28584 — the permission matrix reads a set two packages hold at
 * the package that owns it, and shows the server's refusal where it knows none.
 *
 * Since objectstack#28337, the layered view naming no package refuses a name
 * whose active rows two packages hold: `409 RESOURCE_CONFLICT`, its message
 * naming the holders and the `?package=` remedy. The editor read it naming no
 * package and caught every failure to `null`, so on such a deployment it either
 * failed or read the refusal as "no set known".
 *
 * The REAL editor over a REAL `MetadataClient`, whose transport is an
 * in-memory server holding `sales_perms` in two packages and answering the
 * layered read as the framework does: the holder's stack with `?package=`, the
 * refusal without it.
 *
 * Pinned:
 *  - the package door reads its own package's stack, and shows its grants;
 *  - the routed page (no door) reads the owner its URL names, and shows that
 *    holder's grants;
 *  - with no owner known, the read names no package, and the server's refusal
 *    sentence is shown, ⛔ never a holder picked on the client.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG_A = 'app.alpha';
const PKG_B = 'app.beta';
const SET = 'sales_perms';
const REFUSAL_TEXT =
  `Name the package this layered read is for, then send it again: on the REST door add ?package= with the package id. ` +
  `permission '${SET}' is held by '${PKG_A}' and '${PKG_B}'.`;

/** Each holder's published set: alpha grants Read, beta grants Create. */
const HOLDERS: Record<string, Record<string, unknown>> = {
  [PKG_A]: { name: SET, label: 'Sales (alpha)', objects: { a_account: { allowRead: true, allowCreate: false } }, fields: {} },
  [PKG_B]: { name: SET, label: 'Sales (beta)', objects: { a_account: { allowRead: false, allowCreate: true } }, fields: {} },
};

const requests: Array<{ method: string; path: string; search: string; status: number }> = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const pkg = url.searchParams.get('package');
  let status = 200;
  let body: unknown = [];
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    if (seg[0] === '_drafts') {
      body = { drafts: [] };
    } else if (seg.length === 1 && seg[0] === 'object') {
      body = { items: [{ name: 'a_account' }] };
    } else if (seg.length === 1 && seg[0] === 'permission') {
      body = { items: pkg && HOLDERS[pkg] ? [HOLDERS[pkg]] : Object.values(HOLDERS) };
    } else if (seg.length === 3 && seg[0] === 'permission' && seg[1] === SET && seg[2] === 'layers') {
      const row = pkg ? HOLDERS[pkg] : undefined;
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row };
      else if (!pkg) [status, body] = [409, { success: false, error: { code: 'RESOURCE_CONFLICT', message: REFUSAL_TEXT } }];
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
      [status, body] = [404, { error: { code: 'NO_DRAFT', message: 'absent' } }];
    } else {
      [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    }
  }
  requests.push({ method, path: url.pathname, search: url.search, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: false, allowRuntimeCreate: true }],
  }),
}));
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

/** The layered reads the editor sent: each one's query string and status. */
const layersReads = () =>
  requests
    .filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/permission/${SET}/layers`)
    .map((r) => ({ search: r.search, status: r.status }));

const granted = (action: 'Read' | 'Create') => screen.getByRole('checkbox', { name: `a_account ${action}` });

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  requests.length = 0;
});
afterEach(cleanup);

describe('PermissionMatrixEditPage — a set two packages hold (objectstack#28584)', () => {
  it('the package door reads its own package\'s stack and shows that holder\'s grants', async () => {
    render(
      <MemoryRouter>
        <PermissionMatrixEditPage type="permission" name={SET} packageId={PKG_B} embedded />
      </MemoryRouter>,
    );
    await screen.findByText('a_account', undefined, { timeout: 8000 });
    await settle();

    expect(layersReads()).toEqual([{ search: `?package=${PKG_B}`, status: 200 }]);
    expect(granted('Read')).toHaveAttribute('aria-checked', 'false');
    expect(granted('Create')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText(REFUSAL_TEXT)).toBeNull();
  });

  it('the routed page reads the owner its URL names and shows that holder\'s grants', async () => {
    render(
      <MemoryRouter initialEntries={[`/metadata/permission/${SET}?package=${PKG_A}`]}>
        <PermissionMatrixEditPage type="permission" name={SET} />
      </MemoryRouter>,
    );
    await screen.findByText('a_account', undefined, { timeout: 8000 });
    await settle();

    expect(layersReads()).toEqual([{ search: `?package=${PKG_A}`, status: 200 }]);
    expect(granted('Read')).toHaveAttribute('aria-checked', 'true');
    expect(granted('Create')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(REFUSAL_TEXT)).toBeNull();
  });

  it('with no owner known, the read names no package and the server\'s refusal sentence is shown', async () => {
    render(
      <MemoryRouter initialEntries={[`/metadata/permission/${SET}?package=all`]}>
        <PermissionMatrixEditPage type="permission" name={SET} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(REFUSAL_TEXT, undefined, { timeout: 8000 })).toBeInTheDocument();
    await settle();

    // `?package=all` is the list's every-package scope: no package is named,
    // and the server, not the client, says which packages hold the set.
    expect(layersReads()).toEqual([{ search: '', status: 409 }]);
    expect(screen.queryByRole('checkbox', { name: 'a_account Read' })).toBeNull();
  });
});
