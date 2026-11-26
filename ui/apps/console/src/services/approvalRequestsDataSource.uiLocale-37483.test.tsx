/**
 * objectstack#37483 — the request page's approvals reads carry the console's
 * UI language, not the browser's.
 *
 * The approval history (`/approvals/requests/:id/actions`) holds a system note
 * the server renders in the request's locale, and the request
 * (`/approvals/requests/:id`) carries `process_label` / `step_label` the same
 * way. `AppContent` routes the console adapter's record-page reads through
 * `routeApprovalRecordReads(adapter)` with no `fetch` of its own, so they
 * read through the console's authenticated fetch, which stamps the active UI
 * language (`<html lang>`) as `Accept-Language`. The control is on the stamp
 * itself: an empty `<html lang>` adds no header, rather than a guessed one.
 * (In the console it is never empty: `index.html` ships `lang="en"` and the
 * i18n provider always writes the chosen language.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from '@object-ui/types';
import {
  APPROVAL_ACTION_OBJECT,
  APPROVAL_REQUEST_OBJECT,
  routeApprovalRecordReads,
} from './approvalRequestsDataSource';

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

/** As `AppContent` wires it: the console adapter, routed, with no `fetch` of its own. */
function source(): DataSource {
  const host = { find: vi.fn(), findOne: vi.fn() } as unknown as DataSource;
  return routeApprovalRecordReads(host);
}

beforeEach(() => {
  originalLang = document.documentElement.lang;
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = /\/actions/.test(url) ? { data: [] } : { data: { id: 'req_1', status: 'pending' } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  document.documentElement.lang = originalLang;
  vi.unstubAllGlobals();
});

describe('approvals request page reads carry the UI language (objectstack#37483)', () => {
  it('an English console sends Accept-Language: en on the approval history read', async () => {
    document.documentElement.lang = 'en';
    await source().find(APPROVAL_ACTION_OBJECT, { $filter: { request_id: 'req_1' } } as never);
    expect(acceptLanguageOf(/\/approvals\/requests\/req_1\/actions/)).toBe('en');
  });

  it('an English console sends Accept-Language: en on the request read (process and step labels)', async () => {
    document.documentElement.lang = 'en';
    await source().findOne(APPROVAL_REQUEST_OBJECT, 'req_1').catch(() => undefined);
    expect(acceptLanguageOf(/\/approvals\/requests\/req_1(\?|$)/)).toBe('en');
  });

  it('control: an empty <html lang> adds no header', async () => {
    document.documentElement.lang = '';
    await source().find(APPROVAL_ACTION_OBJECT, { $filter: { request_id: 'req_1' } } as never);
    expect(acceptLanguageOf(/\/approvals\/requests\/req_1\/actions/)).toBeNull();
  });
});
