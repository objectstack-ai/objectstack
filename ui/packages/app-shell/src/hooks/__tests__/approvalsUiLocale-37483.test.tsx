/**
 * objectstack#37483 — the approvals and notification-inbox reads carry the
 * console's UI language, not the browser's.
 *
 * The server renders approval history notes (`approvalSubmitterExcluded*`),
 * `process_label` / `step_label` and the inbox's `keyed_text` titles in the
 * request's locale. A read that names no language falls back to the browser's
 * own `Accept-Language`, so an English console on a zh-CN browser read those
 * strings in Chinese. Every reader here goes through the console's
 * authenticated fetch (`createAuthenticatedFetch`), which stamps the active UI
 * language — `<html lang>`, kept in sync by the i18n provider — as
 * `Accept-Language`. These pins hold each reader to that transport, with a
 * control: no UI language chosen leaves the header unset, so the browser's
 * language still applies as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedFetch } from '@object-ui/auth';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import {
  __resetRecordApprovalsStore,
  listApprovalActions,
  remindApprovalRequest,
} from '../useRecordApprovals';
import { fetchPendingApprovalPage } from '../sharedUserFeeds';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

let fetchSpy: ReturnType<typeof vi.fn>;
let originalLang: string;

function acceptLanguageOf(match: RegExp): string | null {
  const call = fetchSpy.mock.calls.find(([input]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return match.test(url);
  });
  expect(call, `no request matched ${match}`).toBeDefined();
  const [input, init] = call!;
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return headers.get('Accept-Language');
}

beforeEach(() => {
  originalLang = document.documentElement.lang;
  __resetRecordApprovalsStore();
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (/\/approvals\/requests\?/.test(url)) return json({ data: [], total: 0 });
    if (/\/remind$/.test(url)) return json({ notified: 1 });
    if (/\/approvals\/requests\//.test(url)) return json({ data: [] });
    return json({ data: [], records: [], value: [], total: 0 });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  document.documentElement.lang = originalLang;
  vi.unstubAllGlobals();
});

describe('approvals reads carry the UI language (objectstack#37483)', () => {
  it('an English console sends Accept-Language: en on the approval history read', async () => {
    document.documentElement.lang = 'en';
    await listApprovalActions('req-1');
    expect(acceptLanguageOf(/\/approvals\/requests\/req-1\/actions$/)).toBe('en');
  });

  it('the remind write carries it too', async () => {
    document.documentElement.lang = 'en';
    await remindApprovalRequest('req-1');
    expect(acceptLanguageOf(/\/approvals\/requests\/req-1\/remind$/)).toBe('en');
  });

  it('the pending-approvals page (bell, home, full-page inbox) carries it', async () => {
    document.documentElement.lang = 'en';
    await fetchPendingApprovalPage(['user-1'], 10);
    expect(acceptLanguageOf(/\/approvals\/requests\?/)).toBe('en');
  });

  it('control: no UI language chosen leaves the header to the browser', async () => {
    document.documentElement.lang = '';
    await listApprovalActions('req-1');
    expect(acceptLanguageOf(/\/approvals\/requests\/req-1\/actions$/)).toBeNull();
  });
});

describe('notification inbox reads carry the UI language (objectstack#37483 comment 7186322473)', () => {
  // The inbox (`sys_inbox_message`, `sys_notification_receipt`) is read
  // through the console's adapter, built by `AdapterProvider` on this same
  // authenticated fetch.
  function consoleAdapter() {
    return new ObjectStackAdapter({ baseUrl: 'http://localhost', fetch: createAuthenticatedFetch() });
  }

  it('an English console sends Accept-Language: en on the sys_inbox_message read', async () => {
    document.documentElement.lang = 'en';
    await consoleAdapter()
      .find('sys_inbox_message', { $top: 20, $orderby: { created_at: 'desc' } } as never)
      .catch(() => undefined);
    expect(acceptLanguageOf(/sys_inbox_message/)).toBe('en');
  });

  it('control: no UI language chosen leaves the header to the browser', async () => {
    document.documentElement.lang = '';
    await consoleAdapter()
      .find('sys_inbox_message', { $top: 20 } as never)
      .catch(() => undefined);
    expect(acceptLanguageOf(/sys_inbox_message/)).toBeNull();
  });
});
