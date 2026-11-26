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
 * `Accept-Language`. These pins hold each reader to that transport. The
 * controls are on the stamp itself: an empty `<html lang>` adds no header,
 * rather than a guessed one. (In the console it is never empty: `index.html`
 * ships `lang="en"` and the i18n provider always writes the chosen language.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { AdapterProvider } from '../../providers/AdapterProvider';
import {
  __resetRecordApprovalsStore,
  listApprovalActions,
  remindApprovalRequest,
} from '../useRecordApprovals';
import {
  __markFirstPainted,
  __resetSharedUserFeeds,
  fetchPendingApprovalPage,
  useSharedInboxFeed,
} from '../sharedUserFeeds';

/** One signed-in user: the inbox feed reads nothing without one. */
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));

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
  cleanup();
  __resetSharedUserFeeds();
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

  it('control: an empty <html lang> adds no header', async () => {
    document.documentElement.lang = '';
    await listApprovalActions('req-1');
    expect(acceptLanguageOf(/\/approvals\/requests\/req-1\/actions$/)).toBeNull();
  });
});

describe('notification inbox reads carry the UI language (objectstack#37483 comment 7186322473)', () => {
  // Mounted as the console mounts it: the real `AdapterProvider` builds its
  // own adapter, and `useSharedInboxFeed` reads `sys_inbox_message` /
  // `sys_notification_receipt` through it. So the pin follows the console's
  // wiring, not a hand-built adapter.
  function InboxReader() {
    useSharedInboxFeed();
    return null;
  }

  async function mountInbox() {
    __resetSharedUserFeeds();
    __markFirstPainted();
    render(
      <AdapterProvider>
        <InboxReader />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([input]) => /sys_inbox_message/.test(String(input instanceof Request ? input.url : input))),
      ).toBe(true),
    );
  }

  it('an English console sends Accept-Language: en on the sys_inbox_message read', async () => {
    document.documentElement.lang = 'en';
    await mountInbox();
    expect(acceptLanguageOf(/sys_inbox_message/)).toBe('en');
  });

  it('control: an empty <html lang> adds no header', async () => {
    document.documentElement.lang = '';
    await mountInbox();
    expect(acceptLanguageOf(/sys_inbox_message/)).toBeNull();
  });
});
