/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4408 — the masking, pinned end to end.
 *
 * The two halves of this defect live in two packages and neither can see the
 * other: `@object-ui/data-objectstack` turned the server's 404 into a resolved
 * empty result, and `@object-ui/plugin-list` rendered a resolved empty result
 * as its ordinary empty state. Each package's own suite can only pin its own
 * half — plugin-list is deliberately backend-agnostic (AGENTS.md #1) and does
 * not depend on any adapter. `app-shell` is where both already meet, the same
 * reason the defaults-map mirror gate lives here, so the composition is
 * asserted here: a real `ObjectStackAdapter` over a stubbed transport, feeding
 * the real `ListView`.
 *
 * The scenario is the reported one. `sys_jwks` declares
 * `enable.apiEnabled: false`, so `GET /data/sys_jwks` answers **404** with
 * `code: 'OBJECT_API_DISABLED'`, and the Setup page carried the `managedBy`
 * empty-state override ("No identity records"). Every persona saw an ordinary,
 * unpopulated list. Nobody clicked through, which is also how the upstream
 * defect objectstack#7544 survived review for its entire life.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ListView } from '@object-ui/plugin-list';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

/** The Setup page's schema: the `managedBy` empty-state override, as shipped. */
const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'sys_jwks',
  fields: ['name'],
  emptyState: {
    icon: 'ShieldAlert',
    title: 'No identity records',
    message:
      'These records are created by the authentication provider — through sign-in, provisioning, and security flows — not added by hand here.',
  },
} as ListViewSchema;

/**
 * An adapter whose transport answers the data route with `status` + `body`.
 * Discovery is answered 200 so `connect()` resolves normally.
 */
function makeAdapter(status: number, body: unknown) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const href = String(url);
    if (href.includes('/data/')) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  const ds: any = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch: fetchImpl });
  ds.__fetch = fetchImpl;
  return ds;
}

function renderList(ds: any) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} />
    </SchemaRendererProvider>,
  );
}

describe('object list · an OBJECT_API_DISABLED 404 is not an empty list (#4408)', () => {
  it('renders the honest cannot-work state, NOT the generic empty state', async () => {
    const ds = makeAdapter(404, {
      code: 'OBJECT_API_DISABLED',
      message: 'Object API is disabled for sys_jwks',
    });
    const { container } = renderList(ds);

    const panel = await waitFor(() => {
      const el = container.querySelector('[data-testid="list-error-state"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(panel.getAttribute('data-error-kind')).toBe('api-disabled');

    // The masking, gone: the empty state must not be what this page shows, and
    // the override copy that used to stand in for the failure must be absent.
    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(container.textContent).not.toContain('No identity records');

    // And the panel says the true thing.
    expect(panel.textContent).toMatch(/API/);
    expect(panel.textContent).not.toMatch(/connection/i);
  });

  it('renders the same honest state for the 405 sibling', async () => {
    const ds = makeAdapter(405, {
      error: { code: 'OBJECT_API_METHOD_NOT_ALLOWED', message: 'Method not allowed' },
    });
    const { container } = renderList(ds);

    const panel = await waitFor(() => {
      const el = container.querySelector('[data-testid="list-error-state"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(panel.getAttribute('data-error-kind')).toBe('api-disabled');
    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
  });

  /**
   * The binding control, in the card's own words: a genuinely empty object must
   * STILL render the ordinary empty state. Empty is the overwhelmingly common
   * case and the one the empty state exists for — a fix that turned "no records
   * yet" into an error surface would be worse than the bug it repairs.
   */
  it('CONTROL: a 2xx with zero rows still renders the ordinary empty state', async () => {
    const ds = makeAdapter(200, { success: true, data: { records: [], total: 0 } });
    const { container } = renderList(ds);

    await waitFor(() => {
      expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    });

    // The override copy is intact, and no error surface appeared.
    expect(container.textContent).toContain('No identity records');
    expect(container.querySelector('[data-testid="list-error-state"]')).toBeNull();
  });

  /**
   * The other control: a 404 that is NOT an enable-block denial. A backend
   * without this optional collection still degrades to empty — the probes
   * (AppHeader's `sys_presence` / `sys_activity`, …) read empty data as
   * "feature unavailable", and turning those into error panels would be a
   * second, louder regression.
   */
  it('CONTROL: a bare 404 (collection absent) still renders the empty state', async () => {
    const ds = makeAdapter(404, { message: 'Not found' });
    const { container } = renderList(ds);

    await waitFor(() => {
      expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-testid="list-error-state"]')).toBeNull();
  });
});

/**
 * objectstack#29782 — the same masking one code over, on the list's plain
 * read path. An object that failed to register answers 404
 * `OBJECT_NOT_FOUND`. The adapter's plain `find()` (no `$expand`, no
 * `$search`) degraded that to zero rows and memoised it, so the list said
 * "no data yet" about an object that does not exist, and #29704's panel
 * (the server's sentence and code) was reachable only on the raw path. The
 * empty answer now belongs to platform collections alone
 * (`isPlatformProvidedObjectName`); `sys_jwks` above is one, which is why the
 * bare-404 control there still reads empty.
 */
describe('object list · a 404 OBJECT_NOT_FOUND on the plain read path is not an empty list (objectstack#29782)', () => {
  const missingSchema: ListViewSchema = {
    type: 'list-view',
    objectName: 'crm_invoice',
    fields: ['name'],
  } as ListViewSchema;

  it("shows the server's sentence and code, not the empty state", async () => {
    const ds = makeAdapter(404, {
      success: false,
      error: { code: 'OBJECT_NOT_FOUND', message: "Object 'crm_invoice' is not registered" },
    });
    const { container } = render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={missingSchema} dataSource={ds} />
      </SchemaRendererProvider>,
    );

    const panel = await waitFor(() => {
      const el = container.querySelector('[data-testid="list-error-state"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(panel.textContent).toContain("Object 'crm_invoice' is not registered");
    expect(panel.querySelector('[data-testid="list-error-code"]')?.textContent).toBe('OBJECT_NOT_FOUND');
    expect(panel.textContent).not.toMatch(/connection/i);
    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();

    // Every data read the list made took the plain path: the masking lived
    // there, so a read that went raw would make this pass for the wrong reason.
    const dataCalls = (ds.__fetch.mock.calls as unknown[][])
      .map(([url]) => String(url))
      .filter((u) => u.includes('/data/'));
    expect(dataCalls.length).toBeGreaterThan(0);
    expect(dataCalls.every((u) => !/populate=|[$]?search=/.test(decodeURIComponent(u)))).toBe(true);
  });
});
