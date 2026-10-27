// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An `api` action's `target` is interpolated before a REGISTERED `api` handler
 * receives it, through the same substitution a `url` target goes through.
 *
 * The console registers its own `api` handler, which replaces the built-in
 * `executeAPI` wholesale. Only `executeAPI` called `interpolateTarget`, so on a
 * record page `target: "/api/v1/data/gapdata_item/${ctx.recordId}"` reached the
 * wire as `…/$%7Bctx.recordId%7D` for PATCH and POST alike, while a `url`
 * action with the same token opened the resolved address.
 *
 * Pinned here: what the handler receives for PATCH and POST, that the encoding
 * is the url target's (one opaque segment per value), that the built-in
 * executor sends the same path, that a `url` action is unchanged, and that a
 * non-`api` handler still receives its target as authored.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ActionRunner, type ActionContext, type ActionDef, type ActionRunnerHandler } from '../ActionRunner';

const RECORD_PAGE: ActionContext = {
  record: { id: 'gd_001', name: 'Gap item' },
  objectName: 'gapdata_item',
};

const TARGET = '/api/v1/data/gapdata_item/${ctx.recordId}';
// A url target under `/api/` leaves through `window.location`, not the host's
// navigation handler, so the url control uses a route path with the same token.
const URL_TARGET = '/gapdata_item/${ctx.recordId}';

function recordingApiHandler() {
  const seen: ActionDef[] = [];
  const handler: ActionRunnerHandler = async (action) => {
    seen.push(action);
    return { success: true, silent: true };
  };
  return { seen, handler };
}

describe('api targets interpolate before a registered api handler (objectstack#26722)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['PATCH', 'POST'])('a %s api action hands the handler the resolved record path', async (method) => {
    const runner = new ActionRunner(RECORD_PAGE);
    const { seen, handler } = recordingApiHandler();
    runner.registerHandler('api', handler);

    const result = await runner.execute({ type: 'api', name: 'call_api', target: TARGET, method });

    expect(result.success).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].target).toBe('/api/v1/data/gapdata_item/gd_001');
    expect(seen[0].method).toBe(method);
  });

  it('an api target with no token reaches the handler as the same action object', async () => {
    const runner = new ActionRunner(RECORD_PAGE);
    const { seen, handler } = recordingApiHandler();
    runner.registerHandler('api', handler);
    const action: ActionDef = { type: 'api', name: 'plain', target: '/api/v1/data/gapdata_item', method: 'POST' };

    await runner.execute(action);

    expect(seen[0]).toBe(action);
  });

  it('encodes each value the way a url target does', async () => {
    const context: ActionContext = { record: { id: 'a/b c' }, objectName: 'gapdata_item' };
    const runner = new ActionRunner(context);
    const { seen, handler } = recordingApiHandler();
    runner.registerHandler('api', handler);
    const navigate = vi.fn();
    runner.setNavigationHandler(navigate);

    await runner.execute({ type: 'api', name: 'call_api', target: TARGET, method: 'PATCH' });
    await runner.execute({ type: 'url', name: 'open', target: URL_TARGET });

    expect(seen[0].target).toBe('/api/v1/data/gapdata_item/a%2Fb%20c');
    expect(navigate.mock.calls[0][0]).toBe('/gapdata_item/a%2Fb%20c');
  });

  it('the built-in executor sends the same resolved path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({}) });
    vi.stubGlobal('fetch', fetchMock);
    const runner = new ActionRunner(RECORD_PAGE);

    await runner.execute({ type: 'api', name: 'export_tab', target: TARGET, method: 'POST' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/data/gapdata_item/gd_001',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('a url action with the same token is unchanged', async () => {
    const runner = new ActionRunner(RECORD_PAGE);
    const navigate = vi.fn();
    runner.setNavigationHandler(navigate);

    const result = await runner.execute({ type: 'url', name: 'open', target: URL_TARGET });

    expect(result.success).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0][0]).toBe('/gapdata_item/gd_001');
  });

  it('a registered non-api handler still receives its target as authored', async () => {
    const runner = new ActionRunner(RECORD_PAGE);
    const seen: ActionDef[] = [];
    runner.registerHandler('flow', async (action) => {
      seen.push(action);
      return { success: true, silent: true };
    });

    await runner.execute({ type: 'flow', name: 'run_flow', target: 'flow_${ctx.recordId}' });

    expect(seen[0].target).toBe('flow_${ctx.recordId}');
  });
});
