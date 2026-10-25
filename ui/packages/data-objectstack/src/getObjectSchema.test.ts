/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from './index';

/**
 * A fetch mock that answers discovery + records the `GET /meta/object/:name`
 * read so we can assert how it was issued.
 */
function makeFetch(objectBody: unknown) {
  const calls: Array<{ url: string; init?: any }> = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) } as any;
    }
    if (u.includes('/api/v1/meta/object/')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => objectBody } as any;
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) } as any;
  });
  return { fetchImpl, calls };
}

describe('ObjectStackAdapter.getObjectSchema', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('reads with cache: "no-cache" so a freshly published field is not masked by the server max-age', async () => {
    // The server marks single-object metadata `public, max-age=3600`; without
    // revalidation the browser HTTP cache would keep serving the pre-publish
    // schema and the create/edit form would miss fields published this session.
    const { fetchImpl, calls } = makeFetch({
      name: 'leave_request',
      fields: { employee_name: { type: 'text' }, department: { type: 'text' } },
    });
    const adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      token: 'tok_123',
      autoReconnect: false,
      fetch: fetchImpl as any,
    });

    const schema: any = await adapter.getObjectSchema('leave_request');

    // Returns the (unwrapped) object schema with its fields.
    expect(Object.keys(schema.fields)).toEqual(['employee_name', 'department']);

    const get = calls.find((c) => c.url.includes('/api/v1/meta/object/'))!;
    expect(get.url).toBe('http://localhost:3000/api/v1/meta/object/leave_request');
    expect(get.init.method).toBe('GET');
    // The crux of the fix: revalidate the HTTP cache instead of serving the
    // stale `max-age` body.
    expect(get.init.cache).toBe('no-cache');
    expect(get.init.headers.Authorization).toBe('Bearer tok_123');
  });

  it('unwraps the { item } envelope when the server wraps the object', async () => {
    const { fetchImpl } = makeFetch({ item: { name: 'account', fields: { x: { type: 'text' } } } });
    const adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: false,
      fetch: fetchImpl as any,
    });

    const schema: any = await adapter.getObjectSchema('account');

    expect(schema.name).toBe('account');
    expect(Object.keys(schema.fields)).toEqual(['x']);
  });

  it('folds a legacy `reference_to` onto `reference`, and stamps no `reference_to` (objectui#11070 round 4)', async () => {
    // The server names a relational field's target `reference`
    // (showcase_project.account → { type: 'lookup', reference: 'showcase_account' }),
    // the only spelling ObjectUI's readers read. getObjectSchema is the choke
    // point every schema read goes through, so a stored def that still spells
    // the legacy key comes back carrying `reference` — and a `reference` def
    // comes back exactly as served, with no second spelling stamped on it.
    const { fetchImpl } = makeFetch({
      name: 'showcase_project',
      fields: {
        name: { type: 'text' },
        account: { type: 'lookup', reference: 'showcase_account' },
        team_members: { type: 'user', reference: 'sys_user', multiple: true },
        legacy: { type: 'master_detail', reference_to: 'showcase_order' },
      },
    });
    const adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: false,
      fetch: fetchImpl as any,
    });

    const schema: any = await adapter.getObjectSchema('showcase_project');

    expect(schema.fields.account).toEqual({ type: 'lookup', reference: 'showcase_account' });
    expect(schema.fields.team_members).toEqual({ type: 'user', reference: 'sys_user', multiple: true });
    // The fold: every reader reads `reference`, so a legacy-only def must
    // reach them carrying it. The key it arrived with is left in place.
    expect(schema.fields.legacy.reference).toBe('showcase_order');
    expect(schema.fields.legacy.reference_to).toBe('showcase_order');
    // Non-relational fields stay untouched.
    expect('reference_to' in schema.fields.name).toBe(false);
    expect('reference' in schema.fields.name).toBe(false);
  });

  it('preserves `validations` (incl. state_machine transitions) — the seam the inline editor depends on', async () => {
    // Inert-metadata regression guard. The inline select editor filters its
    // options by the object's `state_machine` validation (objectui#2110). That
    // feature only works because `getObjectSchema` passes the served
    // `validations` through untouched — the server enforces the same rule. If a
    // future change here started stripping or reshaping top-level metadata, the
    // filter would silently no-op (valid-but-inert) with no error. Pin the
    // pass-through so the data path can't go dark unnoticed.
    const { fetchImpl } = makeFetch({
      name: 'showcase_task',
      fields: { status: { type: 'select', options: [{ value: 'done', label: 'Done' }] } },
      validations: [
        {
          type: 'state_machine',
          field: 'status',
          transitions: { in_review: ['done', 'in_progress'], done: ['in_progress'] },
        },
      ],
    });
    const adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      autoReconnect: false,
      fetch: fetchImpl as any,
    });

    const schema: any = await adapter.getObjectSchema('showcase_task');

    const sm = (schema.validations ?? []).find((v: any) => v?.type === 'state_machine');
    expect(sm).toBeTruthy();
    expect(sm.field).toBe('status');
    // The exact map the consumer filters on — `done` only transitions to
    // `in_progress` (so the editor must not offer `in_review`).
    expect(sm.transitions.done).toEqual(['in_progress']);
    expect(sm.transitions.in_review).toEqual(['done', 'in_progress']);
  });
});
