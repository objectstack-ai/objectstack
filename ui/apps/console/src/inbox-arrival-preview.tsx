/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Inbox-arrival preview — the REAL-BROWSER fixture for objectui#7011.
 *
 * Dev-server only, exactly like the sibling `*-preview.html` pages: the console's
 * production build takes `index.html` as its single rollup input, so nothing
 * here ships.
 *
 * ## Why this exists when the feature already has unit pins
 *
 * The two APIs this feature turns on are the two happy-dom does not have:
 * `Notification` is absent outright, and `document.visibilityState` is a
 * prototype getter a test can only fake. Unit pins therefore measure a
 * SIMULATION of both, and the failure mode of a simulation is the worst one
 * available here — a suite that reports "no desktop notification was raised"
 * for a run in which raising one was never possible. This page puts the real
 * modules in a real Chromium, with a real permission grant, so the claim is
 * measured rather than modelled.
 *
 * It is the "test instance kept as a fixture" the card asks for. The driver
 * that steers it lives beside it at `scripts/inbox-arrival-browser-check.mjs`.
 *
 * ## What it mounts
 *
 * The real `useInboxArrivalNotifier`, the real `presentNotificationToast` (via
 * the real `ConsoleToaster`), and the real `NotificationPreferencesMenu`. The
 * only thing faked is the FEED: rows are pushed in from the page's own controls
 * (or from `window.__inboxArrivalFixture`), because the transport is out of
 * this card's scope and a real poll would need a backend.
 */

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { I18nProvider } from '@object-ui/i18n';
import { ConsoleToaster, ThemeProvider } from '@object-ui/app-shell';
// ⚠️ Workspace SOURCE paths below, NOT `@object-ui/<pkg>/<subpath>` specifiers.
//
// Neither `@object-ui/app-shell` nor `@object-ui/auth` publishes a subpath —
// `.` is their whole `exports` map — and none of the six bindings is on either
// barrel: three are app-shell internals, two are their types, and
// `__resetInboxArrivals` is a TEST SEAM that must not become public API just so
// a fixture can mount. Written as subpath specifiers they LOOKED fine, because
// a Vite string alias matches by PREFIX: `@object-ui/app-shell/hooks/x` went
// through the `@object-ui/app-shell` -> `packages/app-shell/src` alias in
// `vite.config.ts`, so the dev server and the browser check were both green,
// while `tsc` resolved the same specifier through the package's `exports` map,
// found no subpath, and failed the console build with six TS2307s — taking the
// `Bundle Analysis` job down before it measured a single chunk.
//
// These paths are exactly what that alias already resolved to, so the modules
// loaded at runtime are unchanged and both packages publish exactly what they
// published before. Dev-server-only fixture: the production build takes
// `index.html` as its single input, so none of this ships.
//
// The auth CONTEXT itself, not the provider: the provider signs in against a
// real server, and this fixture only needs a stable user id to scope the
// session.
import { AuthCtx, type AuthContextValue } from '../../../packages/auth/src/AuthContext';
import { useInboxArrivalNotifier } from '../../../packages/app-shell/src/hooks/useInboxArrivalNotifier';
import { __resetInboxArrivals } from '../../../packages/app-shell/src/hooks/inboxArrivals';
import { NotificationPreferencesMenu } from '../../../packages/app-shell/src/layout/NotificationPreferencesMenu';
import type { InboxNotification } from '../../../packages/app-shell/src/layout/inboxGrouping';
import type { SharedFeedStatus } from '../../../packages/app-shell/src/hooks/sharedUserFeeds';
import './index.css';

const FIXTURE_USER = 'u_fixture_alice';

const auth = {
  user: { id: FIXTURE_USER, name: 'Ada Lovelace', email: 'ada@example.com' },
  session: null,
  isAuthenticated: true,
  isAuthEnabled: true,
  isLoading: false,
  error: null,
  isPreviewMode: false,
  previewMode: null,
} as unknown as AuthContextValue;

/** A `sys_inbox_message` row as `mergeInboxRows` produces it. */
function row(id: string, over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id,
    notification_id: `ntf_${id}`,
    receipt_id: null,
    type: 'collab.assignment',
    title: `Assigned to you: ${id}`,
    body: 'Ship the arrival notifier',
    action_url: `/showcase_task/${id}`,
    is_read: false,
    created_at: new Date().toISOString(),
    ...over,
  };
}

declare global {
  interface Window {
    __inboxArrivalFixture?: {
      reset(): void;
      setStatus(status: SharedFeedStatus): void;
      setRows(rows: InboxNotification[]): void;
      row: typeof row;
      log: string[];
      storedPreferences(): string | null;
    };
  }
}

function LocationLog({ onNavigate }: { onNavigate: (path: string) => void }) {
  const location = useLocation();
  // Latest-ref: the caller passes an inline arrow, and depending on its
  // identity would re-log the SAME location on every unrelated re-render.
  // Written from an effect, not during render — a ref updated mid-render is
  // exactly what `react-hooks/refs` flags, and the same latest-ref shape the
  // notifier itself uses.
  const sink = useRef(onNavigate);
  useEffect(() => {
    sink.current = onNavigate;
  });
  useEffect(() => {
    sink.current(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);
  return null;
}

function Fixture() {
  const [rows, setRows] = useState<InboxNotification[]>([]);
  const [status, setStatus] = useState<SharedFeedStatus>('loading');
  const [log, setLog] = useState<string[]>([]);

  const markRead = useMemo(
    () => (id: string) => setLog((entries) => [...entries, `markRead:${id}`]),
    [],
  );

  useInboxArrivalNotifier({ notifications: rows, status, markRead });

  useEffect(() => {
    window.__inboxArrivalFixture = {
      reset: () => {
        __resetInboxArrivals();
        // Toasts outlive a scenario otherwise (4s auto-dismiss), and the next
        // scenario would count the previous one's.
        toast.dismiss();
        setRows([]);
        setStatus('loading');
        setLog([]);
      },
      setStatus,
      setRows,
      row,
      log,
      storedPreferences: () => window.localStorage.getItem(
        `objectui.notificationPreferences:u:${FIXTURE_USER}`,
      ),
    };
  }, [log]);

  return (
    <>
      <LocationLog onNavigate={(path) => setLog((entries) => [...entries, `navigate:${path}`])} />
      <div className="min-h-screen bg-background p-6 text-foreground">
        <h1 className="text-lg font-semibold">Inbox arrival fixture (objectui#7011)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drives the real arrival notifier with a scripted feed. The transport is
          deliberately absent — this page is about what the presentation layer does
          with rows, not about how they got here.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="fx-first-read"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => { setRows([row('h3'), row('h2'), row('h1')]); setStatus('ready'); }}
          >
            First read: 3 historical unread
          </button>
          <button
            type="button"
            data-testid="fx-one-arrival"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => setRows((current) => [row(`m${current.length + 1}`), ...current])}
          >
            One new message
          </button>
          <button
            type="button"
            data-testid="fx-three-arrivals"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => setRows((current) => [
              row('a3', { type: 'approval.requested', title: 'Approval needed: PO-88' }),
              row('a2', { type: 'collab.mention', title: 'Ada mentioned you' }),
              row('a1'),
              ...current,
            ])}
          >
            Three new messages in one cycle
          </button>
          <button
            type="button"
            data-testid="fx-reset"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => window.__inboxArrivalFixture?.reset()}
          >
            Reset session
          </button>
        </div>

        <div className="mt-6 max-w-sm rounded-lg border p-2">
          <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Preferences (as they appear in the account menu)
          </p>
          <NotificationPreferencesMenu />
        </div>

        <dl className="mt-6 text-sm">
          <dt className="font-medium">Feed status</dt>
          <dd data-testid="fx-status" className="text-muted-foreground">{status}</dd>
          <dt className="mt-2 font-medium">Rows</dt>
          <dd data-testid="fx-rows" className="text-muted-foreground">{rows.map((r) => r.id).join(', ') || '(none)'}</dd>
          <dt className="mt-2 font-medium">Activity log</dt>
          <dd data-testid="fx-log" className="whitespace-pre-wrap text-muted-foreground">{log.join('\n') || '(empty)'}</dd>
        </dl>
      </div>
      <ConsoleToaster />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <AuthCtx.Provider value={auth}>
          {/*
            * The Router wraps the fixture rather than living inside it: the
            * notifier calls `useNavigate`, so it has to be BELOW a router, and
            * a component that renders its own <MemoryRouter> is still above it.
            * The real console has the same shape — AppHeader mounts inside the
            * app's router — and this fixture caught the difference.
            */}
          <MemoryRouter initialEntries={['/home']}>
            <Fixture />
          </MemoryRouter>
        </AuthCtx.Provider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>,
);
