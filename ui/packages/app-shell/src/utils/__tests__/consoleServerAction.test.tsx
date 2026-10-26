/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * `createConsoleServerActionHandler` (#2904) — the console wrapper around
 * core's `createServerActionHandler`. The dispatch protocol itself is pinned in
 * core (`serverActionHandler.test.ts`); these cover the DOM choreography the
 * wrapper owns: the popup pre-open dance, the zero-roundtrip `newTabUrl` fast
 * path, the `redirectUrl` convention, and tab cleanup on every failure path.
 * `useConsoleActionRuntime.test.tsx` covers the same wrapper mounted in the
 * real console runtime.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('sonner', () => {
  const fn: any = vi.fn();
  fn.error = vi.fn();
  fn.success = vi.fn();
  return { toast: fn };
});

import { toast } from 'sonner';
import { ActionRunner, type ActionDef } from '@object-ui/core';
import { builtInLocales } from '@object-ui/i18n/locales';
import { createConsoleServerActionHandler } from '../consoleServerAction';

/** A pre-openable tab stub with the surface the wrapper drives. */
function makeTab() {
  return {
    document: { write: vi.fn(), close: vi.fn() },
    close: vi.fn(),
    location: { href: '' },
  } as unknown as Window & { close: ReturnType<typeof vi.fn>; location: { href: string } };
}

function okFetch(body: unknown = { success: true, data: {} }) {
  return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

function makeHandler(overrides: Partial<Parameters<typeof createConsoleServerActionHandler>[0]> = {}) {
  const fetch = overrides.fetch ?? (okFetch() as any);
  const onRefresh = overrides.onRefresh ?? vi.fn();
  const handler = createConsoleServerActionHandler({
    fetch,
    baseUrl: () => 'https://api.test',
    resolveObject: () => 'env',
    onRefresh,
    ...overrides,
  });
  return { handler, fetch: fetch as ReturnType<typeof okFetch>, onRefresh: onRefresh as ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.restoreAllMocks();
  (toast as any).mockClear?.();
});

describe('newTabUrl fast path (zero roundtrip)', () => {
  it('drives the pre-opened tab straight to the endpoint — no POST at all', async () => {
    const tab = makeTab();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler, fetch, onRefresh } = makeHandler();

    const res = await handler({
      type: 'script', name: 'sso_as_owner', opensInNewTab: true,
      newTabUrl: '/api/v1/cloud/environments/{recordId}/sso-open',
      params: { recordId: 'env 1' },
    } as any);

    expect(res).toEqual({ success: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.location.href).toBe('https://api.test/api/v1/cloud/environments/env%201/sso-open');
    // Fast path refreshes only on an EXPLICIT refreshAfter: true.
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('refreshes when the action explicitly opts in (refreshAfter: true)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(makeTab() as any);
    const { handler, onRefresh } = makeHandler();

    await handler({
      type: 'script', name: 'sso_as_owner', opensInNewTab: true, refreshAfter: true,
      newTabUrl: '/sso-open/{recordId}', params: { recordId: 'e1' },
    } as any);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('a blocked record resolution errors BEFORE any tab opens (no flash)', async () => {
    const openSpy = vi.spyOn(window, 'open');
    const { handler, fetch } = makeHandler();

    const res = await handler(
      { type: 'script', name: 'sso_as_owner', opensInNewTab: true, newTabUrl: '/sso-open/{recordId}' } as any,
      { selectedRecords: [{ id: 'a' }, { id: 'b' }] } as any,
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/exactly one row/i);
    expect(openSpy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('errors without a tab when no record id is resolvable', async () => {
    const openSpy = vi.spyOn(window, 'open');
    const { handler } = makeHandler();

    const res = await handler({
      type: 'script', name: 'sso_as_owner', opensInNewTab: true, newTabUrl: '/sso-open/{recordId}',
    } as any);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no record id available/i);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('honors an injected resolveRecordId (record-page policy) on the fast path', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler } = makeHandler({
      resolveRecordId: (action: any) => ({ recordId: action.recordId ?? 'page_rec' }),
    });

    await handler({
      type: 'script', name: 'sso_as_owner', opensInNewTab: true, newTabUrl: '/sso-open/{recordId}',
    } as any);

    expect(tab.location.href).toBe('https://api.test/sso-open/page_rec');
  });
});

describe('redirectUrl convention', () => {
  it('drives the pre-opened tab to a handler-returned redirectUrl (legacy double-wrap read)', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler } = makeHandler({
      fetch: okFetch({
        success: true,
        data: { success: true, data: { redirectUrl: 'https://example.test/sso' } },
      }) as any,
    });

    const res = await handler({ type: 'script', name: 'open_env', opensInNewTab: true, params: { recordId: 'e1' } } as any);

    expect(res.success).toBe(true);
    expect(tab.location.href).toBe('https://example.test/sso');
    expect(tab.close).not.toHaveBeenCalled();
  });

  it('opens lazily without a pre-opened tab, with a toast fallback when the popup is blocked', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const { handler } = makeHandler({
      fetch: okFetch({
        success: true,
        data: { success: true, data: { redirectUrl: 'https://example.test/sso' } },
      }) as any,
    });

    await handler({ type: 'script', name: 'open_env' } as any); // no opensInNewTab

    expect(openSpy).toHaveBeenCalledWith('https://example.test/sso', '_blank');
    expect(toast).toHaveBeenCalledTimes(1); // popup blocked → one-click fallback
    // Default (no injected `t`) copy is the English fallback (objectui#3321).
    expect(toast).toHaveBeenCalledWith('Popup blocked', expect.objectContaining({
      description: 'Your browser blocked the new tab from opening.',
      action: expect.objectContaining({ label: 'Open in new tab' }),
    }));
  });

  it('closes the optimistically pre-opened tab when the handler returns no redirectUrl', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler } = makeHandler();

    const res = await handler({ type: 'script', name: 'noop', opensInNewTab: true, params: { recordId: 'e1' } } as any);

    expect(res.success).toBe(true);
    expect(tab.close).toHaveBeenCalledTimes(1);
  });
});

describe('user-facing copy (objectui#3321)', () => {
  it('the spinner tab defaults to English-only copy — no CJK in code (Commandment #-1)', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler } = makeHandler();

    await handler({
      type: 'script', name: 'sso_as_owner', opensInNewTab: true,
      newTabUrl: '/sso-open/{recordId}', params: { recordId: 'e1' },
    } as any);

    expect(tab.document.write).toHaveBeenCalledTimes(1);
    const html = (tab.document.write as any).mock.calls[0][0] as string;
    expect(html).toContain('<title>Opening…</title>');
    expect(html).toContain('Opening… this may take a moment.');
    // The commandment pin: the copy shipped from CODE carries no CJK. Chinese
    // lives in `@object-ui/i18n`'s zh locale pack and arrives via `t`.
    expect(html).not.toMatch(/[\u3000-\u30ff\u4e00-\u9fff]/);
  });

  it('an injected `t` localizes the spinner tab via console.serverAction.* keys', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler } = makeHandler({ t: (key: string) => `x:${key}` });

    await handler({
      type: 'script', name: 'sso_as_owner', opensInNewTab: true,
      newTabUrl: '/sso-open/{recordId}', params: { recordId: 'e1' },
    } as any);

    const html = (tab.document.write as any).mock.calls[0][0] as string;
    expect(html).toContain('<title>x:console.serverAction.openingTitle</title>');
    expect(html).toContain('x:console.serverAction.openingBody');
  });

  it('an injected `t` localizes the popup-blocked toast via console.serverAction.* keys', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { handler } = makeHandler({
      t: (key: string) => `x:${key}`,
      fetch: okFetch({
        success: true,
        data: { success: true, data: { redirectUrl: 'https://example.test/sso' } },
      }) as any,
    });

    await handler({ type: 'script', name: 'open_env' } as any);

    expect(toast).toHaveBeenCalledWith('x:console.serverAction.popupBlockedTitle', expect.objectContaining({
      description: 'x:console.serverAction.popupBlockedDescription',
      action: expect.objectContaining({ label: 'x:console.serverAction.popupBlockedAction' }),
    }));
  });

  it('locale strings are HTML-escaped before entering the spinner document', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler } = makeHandler({ t: (_key: string, englishDefault: string) => `<b>&${englishDefault}` });

    await handler({
      type: 'script', name: 'sso_as_owner', opensInNewTab: true,
      newTabUrl: '/sso-open/{recordId}', params: { recordId: 'e1' },
    } as any);

    const html = (tab.document.write as any).mock.calls[0][0] as string;
    expect(html).toContain('&lt;b&gt;&amp;Opening…');
    expect(html).not.toContain('<b>&Opening…');
  });
});

describe('failure paths close the pre-opened tab', () => {
  it('on a failed dispatch', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler } = makeHandler({
      fetch: vi.fn(async () => ({
        ok: false, status: 403, json: async () => ({ success: false, error: 'Denied' }),
      })) as any,
    });

    const res = await handler({ type: 'script', name: 'open_env', opensInNewTab: true, params: { recordId: 'e1' } } as any);

    expect(res).toMatchObject({ success: false, error: 'Denied' });
    expect(tab.close).toHaveBeenCalledTimes(1);
    // The runner's post-execution hook owns the error toast — none here.
    expect((toast as any).error).not.toHaveBeenCalled();
  });

  it('on a thrown transport error', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const { handler } = makeHandler({
      fetch: vi.fn(async () => { throw new Error('network down'); }) as any,
    });

    const res = await handler({ type: 'script', name: 'open_env', opensInNewTab: true, params: { recordId: 'e1' } } as any);

    expect(res).toEqual({ success: false, error: 'network down' });
    expect(tab.close).toHaveBeenCalledTimes(1);
  });
});

describe("handler-returned openIn: 'self' (objectui#5221)", () => {
  /** A handler response carrying `redirectUrl` (+ optional siblings). */
  function redirecting(extra: Record<string, unknown> = {}) {
    return okFetch({
      success: true,
      data: { success: true, data: { redirectUrl: '/app/crm/contacts/rec_42', ...extra } },
    }) as any;
  }

  it("hops the SPA router in place, and does NOT open a tab", async () => {
    const navigate = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(makeTab() as any);
    const { handler } = makeHandler({ fetch: redirecting({ openIn: 'self' }), navigate });

    await handler({ type: 'script', name: 'clone_and_jump' } as any);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/app/crm/contacts/rec_42');
    // Discriminating: the shipped behavior for this same response WITHOUT
    // `openIn` is `window.open`. If the branch were ignored, this would fire.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('keeps the shipped new-tab behavior when the handler omits openIn', async () => {
    // The positive control for the assertion above: same fetch body, same
    // harness, one key removed — proving `window.open` is reachable here and
    // the `not.toHaveBeenCalled()` above is a real measurement.
    const navigate = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(makeTab() as any);
    const { handler } = makeHandler({ fetch: redirecting(), navigate });

    await handler({ type: 'script', name: 'clone_and_jump' } as any);

    expect(openSpy).toHaveBeenCalledWith('/app/crm/contacts/rec_42', '_blank');
    expect(navigate).not.toHaveBeenCalled();
  });

  it("closes the optimistically pre-opened tab when the handler asks to stay put", async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const navigate = vi.fn();
    const { handler } = makeHandler({ fetch: redirecting({ openIn: 'self' }), navigate });

    await handler({
      type: 'script', name: 'clone_and_jump', opensInNewTab: true, params: { recordId: 'e1' },
    } as any);

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/app/crm/contacts/rec_42');
  });

  it("does not accept the type:'url' kebab spelling as a same-tab request", async () => {
    // `'new-tab'` is the TOP-LEVEL `openIn` key's spelling for `type:'url'`
    // actions; spec refuses the crossover in each direction. `'new-tab'` here
    // is simply not `'self'`, so the shipped new-tab path stands — the
    // renderer never becomes looser than the contract authors are validated
    // against.
    const navigate = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(makeTab() as any);
    const { handler } = makeHandler({ fetch: redirecting({ openIn: 'new-tab' }), navigate });

    await handler({ type: 'script', name: 'clone_and_jump' } as any);

    expect(navigate).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith('/app/crm/contacts/rec_42', '_blank');
  });

  it('falls back to a full-page navigation for an absolute destination', async () => {
    // No SPA route can express an off-origin URL. Same tab either way, so the
    // handler's stated intent is honoured, never inverted into a new tab.
    const navigate = vi.fn();
    const { handler } = makeHandler({
      fetch: okFetch({
        success: true,
        data: { success: true, data: { redirectUrl: 'https://example.test/landing', openIn: 'self' } },
      }) as any,
      navigate,
    });
    const hrefs: string[] = [];
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { get href() { return ''; }, set href(v: string) { hrefs.push(v); } },
    });

    await handler({ type: 'script', name: 'clone_and_jump' } as any);

    expect(navigate).not.toHaveBeenCalled();
    expect(hrefs).toEqual(['https://example.test/landing']);
  });
});

describe('a declared onSuccess block defers to the runner (objectui#5221)', () => {
  it('performs no navigation of its own, and tidies the pre-opened tab', async () => {
    const tab = makeTab();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as any);
    const navigate = vi.fn();
    const { handler } = makeHandler({
      fetch: okFetch({
        success: true,
        data: { success: true, data: { redirectUrl: '/app/crm/contacts/rec_42' } },
      }) as any,
      navigate,
    });

    const res = await handler({
      type: 'script', name: 'clone_and_jump', opensInNewTab: true, params: { recordId: 'e1' },
      // The DECLARED hop — `ActionRunner.navigateOnSuccess` performs this one.
      onSuccess: { navigate: '/app/crm/contacts/${result.id}', openIn: 'self' },
    } as any);

    expect(res.success).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    // The pre-open is the only `window.open` — no second navigation from here.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.close).toHaveBeenCalledTimes(1);
  });

  it('a legacy chained-callback onSuccess is NOT mistaken for a declared hop', async () => {
    // `{ type: 'notify' }` was the runner's older `ActionDef` callback channel
    // (retired by objectui#5934), not the spec block — an unparsed row can
    // still carry the shape. The redirectUrl convention must still run.
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(makeTab() as any);
    const navigate = vi.fn();
    const { handler } = makeHandler({
      fetch: okFetch({
        success: true,
        data: { success: true, data: { redirectUrl: '/app/crm/contacts/rec_42' } },
      }) as any,
      navigate,
    });

    await handler({
      type: 'script', name: 'clone_and_jump', onSuccess: { type: 'notify' },
    } as any);

    expect(openSpy).toHaveBeenCalledWith('/app/crm/contacts/rec_42', '_blank');
  });
});

describe('the early record-id refusal is forwarded to the runner (objectui#13384)', () => {
  const ADD_TO_CAMPAIGN = {
    type: 'script',
    name: 'add_to_campaign',
    objectName: 'crm_lead',
    locations: ['list_toolbar', 'list_item'],
    actionParams: [{ name: 'campaign', label: 'Campaign', type: 'text', required: true }],
  };
  const launch = () => JSON.parse(JSON.stringify(ADD_TO_CAMPAIGN));

  it("the wrapper answers core's refusal, with its pack key, and nothing for one row", () => {
    const { handler } = makeHandler();

    expect(handler.refuseBeforeInput?.(launch(), { selectedRecords: [] })).toEqual({
      error: 'This action runs on a single record — select a row first.',
      errorKey: 'actions.selectRowFirst',
    });
    expect(handler.refuseBeforeInput?.(launch(), { selectedRecords: [{ id: 'a' }, { id: 'b' }] })).toEqual({
      error: 'This action runs on a single record — select exactly one row.',
      errorKey: 'actions.selectExactlyOneRow',
    });
    expect(handler.refuseBeforeInput?.(launch(), { selectedRecords: [{ id: 'a' }] })).toBeUndefined();
  });

  it('an injected resolveRecordId (record-page policy) decides the early refusal too', () => {
    const { handler } = makeHandler({ resolveRecordId: () => ({ recordId: 'page_rec_1' }) });

    expect(handler.refuseBeforeInput?.(launch(), { selectedRecords: [] })).toBeUndefined();
  });

  it.each([
    ['0 rows', [] as Record<string, unknown>[], 'This action runs on a single record — select a row first.'],
    ['2 rows', [{ id: 'a' }, { id: 'b' }], 'This action runs on a single record — select exactly one row.'],
  ])('through a real runner, %s: refused before the param dialog, with no tab and no request', async (_label, rows, refusal) => {
    const openSpy = vi.spyOn(window, 'open');
    const { handler, fetch } = makeHandler();
    const runner = new ActionRunner({ selectedRecords: rows });
    const toastSpy = vi.fn();
    const dialog = vi.fn(async () => ({ campaign: 'cmp_webinar' }));
    runner.setToastHandler(toastSpy);
    runner.setParamCollectionHandler(dialog);
    runner.registerHandler('script', handler);

    const result = await runner.execute({ ...launch(), opensInNewTab: true });

    expect(result).toEqual({ success: false, error: refusal });
    expect(dialog).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(refusal, expect.objectContaining({ type: 'error' }));
  });

  it('through a real runner, 1 row: the param dialog opens and the request carries that row', async () => {
    const { handler, fetch } = makeHandler();
    const runner = new ActionRunner({ selectedRecords: [{ id: 'lead_1' }] });
    const dialog = vi.fn(async () => ({ campaign: 'cmp_webinar' }));
    runner.setToastHandler(vi.fn());
    runner.setParamCollectionHandler(dialog);
    runner.registerHandler('script', handler);

    const result = await runner.execute(launch());

    expect(result.success).toBe(true);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({
      recordId: 'lead_1',
      params: { campaign: 'cmp_webinar' },
    });
  });
});

describe('the newTabUrl fast path refuses in the session language (objectui#13397)', () => {
  // The zh-CN pack as the wrapper's `t`, read by dotted key; a key it lacks
  // answers the English default, as `useObjectTranslation().t` does.
  const zhT = (key: string, englishDefault: string) => {
    const hit = key.split('.').reduce<unknown>(
      (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      builtInLocales.zh,
    );
    return typeof hit === 'string' ? hit : englishDefault;
  };
  const SSO: ActionDef = { type: 'script', name: 'sso_as_owner', opensInNewTab: true, newTabUrl: '/sso-open/{recordId}' };

  it('no resolvable record id: the refusal reads zh-CN, with no tab', async () => {
    const openSpy = vi.spyOn(window, 'open');
    const { handler, fetch } = makeHandler({ t: zhT });

    const res = await handler({ ...SSO });

    expect(res).toEqual({ success: false, error: '此操作针对单条记录，但没有可用的记录 ID。' });
    expect(openSpy).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('control: with no `t` the same refusal stays English', async () => {
    const { handler } = makeHandler();

    expect(await handler({ ...SSO })).toEqual({
      success: false,
      error: 'This action runs on a single record — no record id available.',
    });
  });

  it("the resolver's own refusal reads zh-CN through its pack key, with no tab", async () => {
    const openSpy = vi.spyOn(window, 'open');
    const { handler } = makeHandler({ t: zhT });

    const res = await handler({ ...SSO }, { selectedRecords: [{ id: 'a' }, { id: 'b' }] });

    expect(res).toEqual({ success: false, error: '此操作针对单条记录，请只选择一行。' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('control: with one row the fast path still opens the tab', async () => {
    const tab = makeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab);
    const { handler } = makeHandler({ t: zhT });

    expect(await handler({ ...SSO }, { selectedRecords: [{ id: 'e1' }] })).toEqual({ success: true });
    expect(tab.location.href).toBe('https://api.test/sso-open/e1');
  });
});
