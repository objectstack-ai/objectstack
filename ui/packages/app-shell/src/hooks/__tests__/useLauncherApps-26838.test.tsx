// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26838 — `useLauncherApps` narrows a launcher's `/meta/app` list
 * by the user's `GET /me/apps` answer, which drops an app a permission set
 * hides (`tabPermissions: hidden`).
 *
 * What these cases pin, on the real `LauncherAppsProvider` fed a `/me/apps`
 * double:
 *
 *   - an app the answer did not list is not offered; the rest keep the
 *     `/meta/app` entries themselves;
 *   - no provider, a `404` and a failed read all narrow nothing — the last
 *     says so once, the `404` (no security plugin) does not;
 *   - `pending` holds only while the FIRST read is out;
 *   - an app the answer was never asked about passes, and its arrival asks
 *     again; two consumers share one read.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  apps: [] as Array<Record<string, unknown>>,
  loading: false,
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: state.userId ? { id: state.userId } : null }),
}));
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: state.apps, loading: state.loading }),
}));

import { LauncherAppsProvider, useLauncherApps } from '../useLauncherApps';

const SETUP = { name: 'setup', label: 'Setup' };
const ACCOUNT = { name: 'account', label: 'Account', hidden: true };
const CRM = { name: 'crm', label: 'CRM' };
const SHOWCASE = { name: 'showcase_app', label: 'Showcase' };

const ENDPOINT = '/me-apps-double';

/** A `/me/apps` double answering `names`, or `status` with no body. */
function meApps(answer: string[] | number) {
  return vi.fn(async (_url: unknown) =>
    typeof answer === 'number'
      ? new Response('{}', { status: answer })
      : new Response(JSON.stringify({ apps: answer.map((name) => ({ name })) }), { status: 200 }),
  );
}

/** Prints what the hook answers: the offered names, and `pending`. */
function Probe({ id = 'probe' }: { id?: string }) {
  const { apps, pending } = useLauncherApps(state.apps);
  return (
    <div data-testid={id} data-pending={String(pending)}>
      {apps.map((app) => String(app.name)).join(',')}
    </div>
  );
}

function renderWith(fetcher: typeof fetch, children: React.ReactNode = <Probe />) {
  return render(
    <LauncherAppsProvider endpoint={ENDPOINT} fetcher={fetcher}>
      {children}
    </LauncherAppsProvider>,
  );
}

beforeEach(() => {
  state.userId = 'u1';
  state.apps = [SETUP, ACCOUNT, CRM, SHOWCASE];
  state.loading = false;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useLauncherApps narrows by /me/apps (objectstack#26838)', () => {
  it('drops an app the /me/apps answer does not list, keeping the /meta/app entries', async () => {
    const fetcher = meApps(['setup', 'account', 'crm']);
    const seen = vi.fn<(apps: unknown[]) => void>();
    function Entries() {
      const { apps } = useLauncherApps(state.apps);
      React.useEffect(() => seen(apps), [apps]);
      return null;
    }
    renderWith(fetcher as unknown as typeof fetch, <><Probe /><Entries /></>);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/^setup,crm$/));
    expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'false');
    // The entries are `/meta/app`'s own objects, not the answer's.
    const entries = seen.mock.lastCall?.[0];
    expect(entries).toEqual([SETUP, CRM]);
    expect(entries?.[0]).toBe(SETUP);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(ENDPOINT);
  });

  it('outside a provider narrows nothing and is not pending', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent(/^setup,crm,showcase_app$/);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'false');
  });

  it('a 404 (no security plugin) narrows nothing, silently, and is not asked again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = meApps(404);
    const { rerender } = renderWith(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'false'));
    expect(screen.getByTestId('probe')).toHaveTextContent(/^setup,crm,showcase_app$/);
    expect(warn).not.toHaveBeenCalled();

    state.apps = [...state.apps, { name: 'ops', label: 'Ops' }];
    rerender(
      <LauncherAppsProvider endpoint={ENDPOINT} fetcher={fetcher as unknown as typeof fetch}>
        <Probe />
      </LauncherAppsProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(/^setup,crm,showcase_app,ops$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('a failed read narrows nothing and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderWith(meApps(500) as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'false'));
    expect(screen.getByTestId('probe')).toHaveTextContent(/^setup,crm,showcase_app$/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('/me/apps');
  });

  it('is pending only while the first read is out', async () => {
    let answer!: (res: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)));
    renderWith(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'true'));
    await act(async () => {
      answer(new Response(JSON.stringify({ apps: [{ name: 'crm' }] }), { status: 200 }));
    });
    expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'false');
    expect(screen.getByTestId('probe')).toHaveTextContent(/^crm$/);
  });

  it('an app the answer was not asked about passes, and its arrival asks again', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apps: [{ name: 'crm' }] }), { status: 200 }))
      .mockReturnValueOnce(new Promise<Response>(() => {}));
    const { rerender } = renderWith(fetcher as unknown as typeof fetch);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/^crm$/));

    // Installed after the read: offered while the re-read is out, not pending.
    state.apps = [...state.apps, { name: 'ops', label: 'Ops' }];
    rerender(
      <LauncherAppsProvider endpoint={ENDPOINT} fetcher={fetcher as unknown as typeof fetch}>
        <Probe />
      </LauncherAppsProvider>,
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('probe')).toHaveTextContent(/^crm,ops$/);
    expect(screen.getByTestId('probe')).toHaveAttribute('data-pending', 'false');
  });

  it('two consumers share one read', async () => {
    const fetcher = meApps(['crm']);
    renderWith(fetcher as unknown as typeof fetch, <><Probe id="a" /><Probe id="b" /></>);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent(/^crm$/));
    expect(screen.getByTestId('b')).toHaveTextContent(/^crm$/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('asks nothing without a signed-in user', () => {
    state.userId = null;
    const fetcher = meApps(['crm']);
    renderWith(fetcher as unknown as typeof fetch);
    expect(screen.getByTestId('probe')).toHaveTextContent(/^setup,crm,showcase_app$/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
