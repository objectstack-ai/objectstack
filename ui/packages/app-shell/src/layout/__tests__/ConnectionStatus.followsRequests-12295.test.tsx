/**
 * objectui#12295 — the header connection chip shows a mid-session outage.
 *
 * The chip is fed exactly the way `AppContent` feeds `AppHeader`: the
 * adapter's `getConnectionState()` once, then every `onConnectionStateChange`
 * event. The adapter is the REAL `ObjectStackAdapter` over a fake fetch, so
 * these pins hold the whole chain — a request outcome moves the adapter's
 * state, and the chip shows it:
 *
 * - a refused data request after a successful connect shows the reconnecting
 *   state, and the chip stays up for as long as the state is not `connected`;
 * - the next answered request returns to connected, and the chip hides at once
 *   (objectui#12891 routed a successful connect silent: no "Connected" flash);
 * - a 500 answer leaves the state at connected, so the chip stays hidden.
 *
 * The chip is identified by the i18n key of the state it renders (the stub
 * below returns keys), so no English copy is pinned here.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import {
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
  type ConnectionState,
} from '@object-ui/data-objectstack';
import { ConnectionStatus } from '../ConnectionStatus';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ language: 'en', t: (key: string) => key }),
}));

const CONNECTED = 'topbar.connection.connected';
const RECONNECTING = 'topbar.connection.reconnecting';
const ERROR = 'topbar.connection.error';

type Mode = 'answer' | 'refuse' | 'server-error';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeServer() {
  const server: { mode: Mode } = { mode: 'answer' };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/v1/discovery')) {
      return json({ success: true, data: { name: 'fake', routes: {} } });
    }
    if (server.mode === 'refuse') throw new TypeError('Failed to fetch');
    if (server.mode === 'server-error') {
      return json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'no' } }, 500);
    }
    return json({ success: true, data: { records: [], total: 0 } });
  });
  return { server, fetch };
}

/** The `AppContent` subscription, feeding the chip the header renders. */
function HeaderChip({ adapter }: { adapter: ObjectStackAdapter }) {
  const [state, setState] = useState<ConnectionState>(adapter.getConnectionState());
  useEffect(
    () => adapter.onConnectionStateChange((event) => setState(event.state)),
    [adapter],
  );
  return <ConnectionStatus state={state} />;
}

async function settle(work: Promise<unknown>) {
  await act(async () => {
    await work.catch(() => undefined);
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

async function mountConnected(options: { maxReconnectAttempts?: number } = {}) {
  const { server, fetch } = fakeServer();
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://fake-12295.test',
    fetch,
    ...options,
  });
  render(<HeaderChip adapter={adapter} />);
  await settle(adapter.connect());
  // objectui#12891 routed a successful connect silent: this pinned a 2 s
  // "Connected" flash before; now the chip is absent at once and stays absent.
  expect(adapter.getConnectionState()).toBe('connected');
  expect(screen.queryByTitle(CONNECTED)).not.toBeInTheDocument();
  advance(2000);
  expect(screen.queryByTitle(CONNECTED)).not.toBeInTheDocument();
  return { adapter, server };
}

describe('ConnectionStatus follows the adapter through a mid-session outage (objectui#12295)', () => {
  beforeEach(() => {
    clearSharedDiscoveryCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a refused data request after a successful connect shows the reconnecting chip, and it stays up', async () => {
    const { adapter, server } = await mountConnected();

    server.mode = 'refuse';
    await settle(adapter.find('task'));

    expect(screen.getByTitle(RECONNECTING)).toBeInTheDocument();
    // No auto-hide while not connected.
    advance(60_000);
    expect(screen.getByTitle(RECONNECTING)).toBeInTheDocument();
  });

  it('the next success returns to connected and the chip is gone at once', async () => {
    const { adapter, server } = await mountConnected();

    server.mode = 'refuse';
    await settle(adapter.find('task'));
    expect(screen.getByTitle(RECONNECTING)).toBeInTheDocument();

    server.mode = 'answer';
    await settle(adapter.find('task'));
    // objectui#12891: recovery is silent too, no "Connected" flash.
    expect(screen.queryByTitle(CONNECTED)).not.toBeInTheDocument();
    expect(screen.queryByTitle(RECONNECTING)).not.toBeInTheDocument();
    advance(2000);
    expect(screen.queryByTitle(CONNECTED)).not.toBeInTheDocument();
  });

  it('a 500 answer leaves the state at connected: the chip stays hidden', async () => {
    const { adapter, server } = await mountConnected();

    server.mode = 'server-error';
    await settle(adapter.find('task'));

    expect(adapter.getConnectionState()).toBe('connected');
    expect(screen.queryByTitle(CONNECTED)).not.toBeInTheDocument();
    expect(screen.queryByTitle(RECONNECTING)).not.toBeInTheDocument();
    expect(screen.queryByTitle(ERROR)).not.toBeInTheDocument();
  });

  it('past the retry window the error chip shows, and it stays up', async () => {
    const { adapter, server } = await mountConnected({ maxReconnectAttempts: 1 });

    server.mode = 'refuse';
    await settle(adapter.find('task_a'));
    expect(screen.getByTitle(RECONNECTING)).toBeInTheDocument();
    await settle(adapter.find('task_b'));

    expect(screen.getByTitle(ERROR)).toBeInTheDocument();
    advance(60_000);
    expect(screen.getByTitle(ERROR)).toBeInTheDocument();
  });
});
