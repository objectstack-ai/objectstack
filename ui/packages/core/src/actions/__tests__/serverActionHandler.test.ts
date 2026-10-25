/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `createServerActionHandler` (#2904) — the core server-action dispatcher
 * factory. These pin the whole protocol surface the factory owns: name-only
 * identity (ADR-0110 D1), the URL/body contract, the record-id resolution
 * dance, the re-entrancy guard, the `/actions` envelope rule, and the refresh
 * semantics. App-shell's console surfaces build on this exact behavior (see
 * `utils/consoleServerAction`), so a regression here is a regression on every
 * list, page and record surface at once.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createServerActionHandler,
  isRecordScopedAction,
  resolveServerActionRecordId,
  type ServerActionFetch,
} from '../serverActionHandler';
import type { ActionDef } from '../ActionRunner';

/** A fetch stub answering the modern single-wrap envelope. */
function okFetch(body: unknown = { success: true, data: { done: true } }) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as ServerActionFetch & ReturnType<typeof vi.fn>;
}

describe('createServerActionHandler — URL and body contract', () => {
  it('POSTs {recordId, params} to baseUrl + /api/v1/actions/{object}/{name}', async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({ fetch, baseUrl: 'https://api.example.com' });

    const res = await handler({
      type: 'script', name: 'archive', objectName: 'inv',
      params: { recordId: 'rec_1', reason: 'stale' },
    } as ActionDef);

    expect(res).toMatchObject({ success: true, reload: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as any).mock.calls[0];
    expect(url).toBe('https://api.example.com/api/v1/actions/inv/archive');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      recordId: 'rec_1',
      params: { recordId: 'rec_1', reason: 'stale' },
    });
  });

  it('URL-encodes the object and action segments', async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({ fetch });

    await handler({ type: 'script', name: 'do/it', objectName: 'a b' } as ActionDef);

    expect((fetch as any).mock.calls[0][0]).toBe('/api/v1/actions/a%20b/do%2Fit');
  });

  it('reads a baseUrl thunk per dispatch (late-bound host config)', async () => {
    const fetch = okFetch();
    let origin = 'https://one.example';
    const handler = createServerActionHandler({ fetch, baseUrl: () => origin });

    await handler({ type: 'script', name: 'a' } as ActionDef);
    origin = 'https://two.example';
    await handler({ type: 'script', name: 'b' } as ActionDef);

    expect((fetch as any).mock.calls[0][0]).toContain('https://one.example/');
    expect((fetch as any).mock.calls[1][0]).toContain('https://two.example/');
  });

  it('strips the client-side _rowRecord stash from the POSTed params', async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({ fetch });

    await handler({
      type: 'script', name: 'promote', objectName: 'lead',
      params: { _rowRecord: { id: 'row_9', name: 'Acme' }, tier: 'gold' },
    } as ActionDef);

    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.recordId).toBe('row_9'); // resolved FROM the stash…
    expect(body.params).toEqual({ tier: 'gold' }); // …but the stash itself never crosses the wire
  });
});

describe('createServerActionHandler — identity (ADR-0110 D1)', () => {
  it('dispatches by declarative name, never by target', async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({ fetch });

    await handler({ type: 'script', name: 'complete_task', target: 'completeTask', objectName: 'todo_task' } as ActionDef);

    const url = (fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/actions/todo_task/complete_task');
    expect(url).not.toContain('completeTask');
  });

  it('refuses an unnamed action instead of falling back to target', async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({ fetch });

    const res = await handler({ type: 'script', target: 'completeTask' } as ActionDef);

    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/no name/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('createServerActionHandler — object scope', () => {
  it("the action's own objectName wins over the injected resolver", async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({ fetch, resolveObject: () => 'page_object' });

    await handler({ type: 'script', name: 'a', objectName: 'child_object' } as ActionDef);

    expect((fetch as any).mock.calls[0][0]).toContain('/api/v1/actions/child_object/a');
  });

  it('falls back to the injected resolver, then to global', async () => {
    const fetch = okFetch();
    const withResolver = createServerActionHandler({ fetch, resolveObject: () => 'inv' });
    await withResolver({ type: 'script', name: 'a' } as ActionDef);
    expect((fetch as any).mock.calls[0][0]).toContain('/api/v1/actions/inv/a');

    const fetch2 = okFetch();
    const bare = createServerActionHandler({ fetch: fetch2 });
    await bare({ type: 'script', name: 'provision' } as ActionDef);
    expect((fetch2 as any).mock.calls[0][0]).toContain('/api/v1/actions/global/provision');
  });
});

describe('resolveServerActionRecordId — the standard dance', () => {
  it('explicit params.recordId wins', () => {
    expect(resolveServerActionRecordId(
      { name: 'a', params: { recordId: 'p_1', _rowRecord: { id: 'row_1' } } } as ActionDef,
      { selectedRecords: [{ id: 'sel_1' }] },
    )).toEqual({ recordId: 'p_1' });
  });

  it('falls back to _rowRecord[recordIdField] (default id, honoring an override)', () => {
    expect(resolveServerActionRecordId(
      { name: 'a', params: { _rowRecord: { id: 'row_1', code: 'INV-1' } } } as ActionDef,
      undefined,
    )).toEqual({ recordId: 'row_1' });
    expect(resolveServerActionRecordId(
      { name: 'a', recordIdField: 'code', params: { _rowRecord: { id: 'row_1', code: 'INV-1' } } } as ActionDef,
      undefined,
    )).toEqual({ recordId: 'INV-1' });
  });

  it('resolves a single toolbar selection from the runner context', () => {
    expect(resolveServerActionRecordId(
      { name: 'a', recordIdField: 'code' } as ActionDef,
      { selectedRecords: [{ id: 'sel_1', code: 'C-9' }] },
    )).toEqual({ recordId: 'C-9' });
  });

  it('blocks a multi-select for a single-record dispatch', () => {
    const out = resolveServerActionRecordId(
      { name: 'a' } as ActionDef,
      { selectedRecords: [{ id: 'x' }, { id: 'y' }] },
    );
    expect(out.error).toMatch(/exactly one row/i);
  });

  it('blocks a record-scoped action with zero selection (#2210) but lets object-level actions through', () => {
    const scoped = resolveServerActionRecordId(
      { name: 'a', locations: ['list_item', 'list_toolbar'] } as ActionDef,
      { selectedRecords: [] },
    );
    expect(scoped.error).toMatch(/select a row first/i);

    const objectLevel = resolveServerActionRecordId(
      { name: 'a', locations: ['list_toolbar'] } as ActionDef,
      { selectedRecords: [] },
    );
    expect(objectLevel).toEqual({ recordId: undefined });
  });

  it('an aggregate dispatch (_selectedIds, objectui#3139) bypasses the selection fallback and its guards', () => {
    const out = resolveServerActionRecordId(
      { name: 'a', locations: ['list_item', 'list_toolbar'], params: { _selectedIds: ['x', 'y'] } } as ActionDef,
      { selectedRecords: [{ id: 'x' }, { id: 'y' }] },
    );
    expect(out).toEqual({ recordId: undefined });
  });
});

describe('isRecordScopedAction', () => {
  it('true for any record location, false for object-level-only or undeclared', () => {
    expect(isRecordScopedAction({ locations: ['list_item'] } as ActionDef)).toBe(true);
    expect(isRecordScopedAction({ locations: ['record_header'] } as ActionDef)).toBe(true);
    expect(isRecordScopedAction({ locations: ['list_toolbar'] } as ActionDef)).toBe(false);
    expect(isRecordScopedAction({} as ActionDef)).toBe(false);
  });
});

describe('createServerActionHandler — resolution wiring', () => {
  it('a blocking resolution returns its error without POSTing', async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({ fetch });

    const res = await handler(
      { type: 'script', name: 'archive' } as ActionDef,
      { selectedRecords: [{ id: 'a' }, { id: 'b' }] },
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/single record/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a custom resolveRecordId replaces the standard dance wholesale (record-page policy)', async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({
      fetch,
      resolveRecordId: (action) => ({ recordId: (action as any).recordId ?? 'page_rec_1' }),
    });

    // Even with a grid-style selection in context, the injected policy wins.
    await handler(
      { type: 'script', name: 'approve', objectName: 'po' } as ActionDef,
      { selectedRecords: [{ id: 'x' }, { id: 'y' }] },
    );

    expect(JSON.parse((fetch as any).mock.calls[0][1].body).recordId).toBe('page_rec_1');
  });
});

describe('the row-count refusals carry their pack key, and are asked before input (objectui#13384)', () => {
  const SCOPED = { name: 'a', locations: ['list_item', 'list_toolbar'] } as ActionDef;

  it('each refusal names the locale-pack key its English text is the source of', () => {
    expect(resolveServerActionRecordId(SCOPED, { selectedRecords: [{ id: 'x' }, { id: 'y' }] })).toEqual({
      error: 'This action runs on a single record — select exactly one row.',
      errorKey: 'actions.selectExactlyOneRow',
    });
    expect(resolveServerActionRecordId(SCOPED, { selectedRecords: [] })).toEqual({
      error: 'This action runs on a single record — select a row first.',
      errorKey: 'actions.selectRowFirst',
    });
  });

  it('the built handler answers the same refusal before input, and nothing for one row', () => {
    const handler = createServerActionHandler({ fetch: okFetch() });

    expect(handler.refuseBeforeInput?.(SCOPED, { selectedRecords: [] })).toEqual({
      error: 'This action runs on a single record — select a row first.',
      errorKey: 'actions.selectRowFirst',
    });
    expect(handler.refuseBeforeInput?.(SCOPED, { selectedRecords: [{ id: 'x' }] })).toBeUndefined();
  });

  it('a custom resolveRecordId decides the early refusal too', () => {
    const handler = createServerActionHandler({
      fetch: okFetch(),
      resolveRecordId: () => ({ recordId: 'page_rec_1' }),
    });

    expect(handler.refuseBeforeInput?.(SCOPED, { selectedRecords: [] })).toBeUndefined();
  });
});

describe('createServerActionHandler — envelope rule (objectstack#3913)', () => {
  it('treats an INNER success:false under HTTP 200 as a failure (no refresh)', async () => {
    const fetch = okFetch({
      success: true,
      data: { success: false, error: "Action 'log_call' on object '*' not found" },
    });
    const onRefresh = vi.fn();
    const handler = createServerActionHandler({ fetch, onRefresh });

    const res = await handler({ type: 'script', name: 'log_call' } as ActionDef);

    expect(res).toEqual({ success: false, error: "Action 'log_call' on object '*' not found" });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('resolves a nested {error:{message}} dispatch failure to a STRING (React #31 guard)', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({
        success: false,
        error: { message: "Action 'log_call' on object 'global' not found", code: 404 },
      }),
    })) as unknown as ServerActionFetch;
    const handler = createServerActionHandler({ fetch });

    const res = await handler({ type: 'script', name: 'log_call' } as ActionDef);

    expect(res.success).toBe(false);
    expect(typeof res.error).toBe('string');
    expect(res.error).toBe("Action 'log_call' on object 'global' not found");
  });

  it('an unparseable body still fails with the HTTP status fallback', async () => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => { throw new Error('not json'); },
    })) as unknown as ServerActionFetch;
    const handler = createServerActionHandler({ fetch });

    const res = await handler({ type: 'script', name: 'x' } as ActionDef);

    expect(res.success).toBe(false);
    expect(res.error).toContain('HTTP 503');
  });

  it('success carries the ACTION ENVELOPE in data (the level ActionResult has always carried)', async () => {
    const fetch = okFetch({
      success: true,
      data: { success: true, data: { redirectUrl: 'https://example.test/sso' } },
    });
    const handler = createServerActionHandler({ fetch });

    const res = await handler({ type: 'script', name: 'open_env' } as ActionDef);

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ success: true, data: { redirectUrl: 'https://example.test/sso' } });
  });
});

describe('createServerActionHandler — refresh semantics', () => {
  it('calls onRefresh when refreshAfter is not false, skips it when false', async () => {
    const onRefresh = vi.fn();
    const handler = createServerActionHandler({ fetch: okFetch(), onRefresh });

    await handler({ type: 'script', name: 'a' } as ActionDef);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const res = await handler({ type: 'script', name: 'a', refreshAfter: false } as ActionDef);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ success: true, reload: false });
  });
});

describe('createServerActionHandler — re-entrancy guard', () => {
  it('blocks a second dispatch of the same action+record while the first is in flight, then releases', async () => {
    let release!: (v: { ok: boolean; status: number; json(): Promise<any> }) => void;
    const gate = new Promise<{ ok: boolean; status: number; json(): Promise<any> }>((r) => { release = r; });
    const fetch = vi.fn(() => gate) as unknown as ServerActionFetch;
    const handler = createServerActionHandler({ fetch });

    const action = { type: 'script', name: 'sso_open', params: { recordId: 'env_1' } } as ActionDef;
    const first = handler(action);
    const second = await handler(action); // while the first awaits the server

    expect(second).toEqual({ success: false, error: 'Action already in progress' });
    expect(fetch).toHaveBeenCalledTimes(1);

    release({ ok: true, status: 200, json: async () => ({ success: true, data: {} }) });
    await expect(first).resolves.toMatchObject({ success: true });

    // Guard released — the same action dispatches again.
    const third = await handler(action);
    expect(third).toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('different records of the same action are independent dispatches', async () => {
    const fetch = okFetch();
    const handler = createServerActionHandler({ fetch });

    await Promise.all([
      handler({ type: 'script', name: 'a', params: { recordId: 'r1' } } as ActionDef),
      handler({ type: 'script', name: 'a', params: { recordId: 'r2' } } as ActionDef),
    ]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('createServerActionHandler — transport failure', () => {
  it('a thrown fetch error becomes a failed result (and releases the guard)', async () => {
    const fetch = vi.fn(async () => { throw new Error('network down'); }) as unknown as ServerActionFetch;
    const handler = createServerActionHandler({ fetch });
    const action = { type: 'script', name: 'a' } as ActionDef;

    const res = await handler(action);
    expect(res).toEqual({ success: false, error: 'network down' });

    // finally released the in-flight key — the retry reaches the transport.
    await handler(action);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
