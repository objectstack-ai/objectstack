/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ActionRunner — resultDialog + target interpolation behaviour.
 *
 * Locks in the contract the metadata layer relies on:
 *   - `resultDialog` SUPPRESSES the success toast and awaits the registered
 *     ResultDialogHandler before resolving.
 *   - When no handler is registered, the action still succeeds (we don't
 *     want a missing UI dependency to roll back a server-side change).
 *   - `target` interpolation handles `${param.X}` and `${ctx.X}`, applies
 *     `encodeURIComponent`, and degrades missing keys to empty string.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  ActionRunner,
  type ActionDef,
  type ResultDialogHandler,
  type ToastHandler,
} from '../ActionRunner';

describe('ActionRunner - resultDialog', () => {
  let runner: ActionRunner;
  // Typed with the signature each setter declares, not `ReturnType<typeof
  // vi.fn>` — that resolves to the un-instantiated `Mock<Procedure |
  // Constructable>`, which no handler slot accepts and whose `mock.calls[0]` is
  // the EMPTY tuple, so every `calls[0][0]` assertion below was reading element
  // 0 of an empty tuple as far as the compiler was concerned (objectui#4040).
  let toast: Mock<ToastHandler>;
  let resultDialog: Mock<ResultDialogHandler>;

  beforeEach(() => {
    runner = new ActionRunner({});
    toast = vi.fn();
    resultDialog = vi.fn().mockResolvedValue(undefined);
    runner.setToastHandler(toast);
    runner.setResultDialogHandler(resultDialog);
  });

  it('invokes the result-dialog handler with the action data on success', async () => {
    runner.registerHandler('reveal', () => ({ success: true, data: { secret: 'abc' } }));
    const action: ActionDef = {
      type: 'reveal',
      successMessage: 'should-not-toast',
      resultDialog: {
        title: 'Save this',
        fields: [{ path: 'secret', format: 'secret' }],
      },
    };

    const result = await runner.execute(action);

    expect(result.success).toBe(true);
    expect(resultDialog).toHaveBeenCalledOnce();
    const [spec, data] = resultDialog.mock.calls[0];
    expect(spec.title).toBe('Save this');
    expect(data).toEqual({ secret: 'abc' });
    // The success toast is suppressed when resultDialog is set so the user
    // can't dismiss the reveal accidentally.
    expect(toast).not.toHaveBeenCalled();
  });

  it('still fires the success toast when resultDialog is absent', async () => {
    runner.registerHandler('plain', () => ({ success: true, data: { ok: true } }));
    await runner.execute({ type: 'plain', successMessage: 'done' });
    expect(toast).toHaveBeenCalledWith('done', expect.objectContaining({ type: 'success' }));
    expect(resultDialog).not.toHaveBeenCalled();
  });

  it('skips the result-dialog handler on failure', async () => {
    runner.registerHandler('fail', () => ({ success: false, error: 'nope' }));
    const result = await runner.execute({
      type: 'fail',
      resultDialog: { title: 'never' },
    });
    expect(result.success).toBe(false);
    expect(resultDialog).not.toHaveBeenCalled();
  });

  it('still succeeds when no resultDialog handler is registered', async () => {
    const noHandlerRunner = new ActionRunner({});
    noHandlerRunner.registerHandler('reveal', () => ({ success: true, data: { x: 1 } }));
    // Silence the expected console.warn for missing handler.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await noHandlerRunner.execute({
      type: 'reveal',
      resultDialog: { title: 'oops' },
    });
    expect(result.success).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('treats a rejected resultDialog handler as acknowledged', async () => {
    runner.registerHandler('reveal', () => ({ success: true, data: { x: 1 } }));
    resultDialog.mockRejectedValueOnce(new Error('user closed tab'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await runner.execute({
      type: 'reveal',
      resultDialog: { title: 't' },
    });
    expect(result.success).toBe(true);
    warn.mockRestore();
  });
});

describe('ActionRunner - target interpolation', () => {
  it('substitutes ${param.X} into url targets and URL-encodes the value', async () => {
    const navHandler = vi.fn();
    const runner = new ActionRunner({});
    runner.setNavigationHandler(navHandler);

    // NOTE: We deliberately use a non-`/api/` path here. `executeUrl` short-circuits
    // any URL matching `/api/`, `/_auth/`, or `/_account/` to `window.location.href`
    // so that better-auth's OAuth redirect dance is followed by the browser, not
    // the SPA router. Those paths intentionally bypass `navigationHandler`.
    await runner.execute({
      type: 'url',
      target: '/auth/sign-in/social?provider=${param.provider}&callbackURL=${ctx.origin}/done',
      params: { provider: 'google' },
    });

    expect(navHandler).toHaveBeenCalledOnce();
    const [url] = navHandler.mock.calls[0];
    // `${ctx.origin}` resolves to window.location.origin under happy-dom/node.
    // We don't assert its concrete value, but the provider must land URL-encoded
    // and the rest of the path must survive unchanged.
    expect(url).toContain('provider=google');
    expect(url).toContain('/auth/sign-in/social');
    expect(url).toContain('/done');
  });

  it('bypasses navigationHandler for /api/, /_auth/, /_account/ paths (OAuth redirect dance)', async () => {
    // Lock in the intentional short-circuit added for better-auth's social login
    // flow. Same-origin API calls need to be a full-page navigation so the
    // browser follows the server-issued 302; pushing them through the SPA
    // router lands on a 404 and silently falls back to the home page.
    const navHandler = vi.fn();
    const runner = new ActionRunner({});
    runner.setNavigationHandler(navHandler);

    // Save & stub window.location.href via a settable mock
    const originalLocation = window.location;
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, set href(v: string) { hrefSetter(v); } } as any,
    });

    try {
      const result = await runner.execute({
        type: 'url',
        target: '/api/v1/auth/sign-in/social?provider=${param.provider}',
        params: { provider: 'google' },
      });

      expect(result.success).toBe(true);
      expect(navHandler).not.toHaveBeenCalled();
      expect(hrefSetter).toHaveBeenCalledOnce();
      expect(hrefSetter.mock.calls[0][0]).toContain('/api/v1/auth/sign-in/social');
      expect(hrefSetter.mock.calls[0][0]).toContain('provider=google');
    } finally {
      Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
    }
  });

  it('URL-encodes values with reserved characters', async () => {
    const navHandler = vi.fn();
    const runner = new ActionRunner({});
    runner.setNavigationHandler(navHandler);

    await runner.execute({
      type: 'url',
      target: '/go?q=${param.q}',
      params: { q: 'a b+c/d' },
    });

    const [url] = navHandler.mock.calls[0];
    expect(url).toBe('/go?q=a%20b%2Bc%2Fd');
  });

  it('resolves missing tokens to empty string instead of throwing', async () => {
    const navHandler = vi.fn();
    const runner = new ActionRunner({});
    runner.setNavigationHandler(navHandler);

    await runner.execute({
      type: 'url',
      target: '/x?a=${param.missing}&b=${ctx.nope}',
      params: { other: 1 },
    });

    const [url] = navHandler.mock.calls[0];
    expect(url).toBe('/x?a=&b=');
  });

  it('exposes ctx.user.id from the action context', async () => {
    const navHandler = vi.fn();
    const runner = new ActionRunner({ user: { id: 'u_42' } });
    runner.setNavigationHandler(navHandler);

    await runner.execute({
      type: 'url',
      target: '/u/${ctx.user.id}',
    });

    expect(navHandler.mock.calls[0][0]).toBe('/u/u_42');
  });

  it('exposes ctx.selection.ids / ctx.selection.count from selectedRecords (#3139)', async () => {
    const navHandler = vi.fn();
    const runner = new ActionRunner({
      selectedRecords: [{ id: 'd1' }, { id: 'd2' }, { name: 'no-id' }],
    });
    runner.setNavigationHandler(navHandler);

    await runner.execute({
      type: 'url',
      target: '/qr/zip?ids=${ctx.selection.ids}&n=${ctx.selection.count}',
    });

    // String(array) comma-joins; the comma arrives percent-encoded in query
    // position (standard encodeURIComponent behaviour, servers decode it).
    // Rows without an id are dropped from ids but still counted — count
    // reflects the selection size, ids only the addressable rows.
    expect(navHandler.mock.calls[0][0]).toBe('/qr/zip?ids=d1%2Cd2&n=3');
  });

  it('resolves ctx.selection to empty ids and zero count when nothing is selected', async () => {
    const navHandler = vi.fn();
    const runner = new ActionRunner({});
    runner.setNavigationHandler(navHandler);

    await runner.execute({
      type: 'url',
      target: '/qr/zip?ids=${ctx.selection.ids}&n=${ctx.selection.count}',
    });

    expect(navHandler.mock.calls[0][0]).toBe('/qr/zip?ids=&n=0');
  });

  it('interpolates ${param._selectedIds} injected by an aggregate bulk dispatch', async () => {
    const navHandler = vi.fn();
    const runner = new ActionRunner({});
    runner.setNavigationHandler(navHandler);

    await runner.execute({
      type: 'url',
      target: '/qr/zip?ids=${param._selectedIds}',
      params: { _selectedIds: ['d1', 'd2'] },
    });

    expect(navHandler.mock.calls[0][0]).toBe('/qr/zip?ids=d1%2Cd2');
  });

  it('substitutes ${param.X} into api endpoints (fetch URL)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis as any, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '',
        blob: async () => new Blob(),
      } as any);

    const runner = new ActionRunner({});
    await runner.execute({
      type: 'api',
      target: '/api/echo/${param.id}',
      params: { id: 'abc-1' },
    });

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe('/api/echo/abc-1');
    fetchSpy.mockRestore();
  });
});
