// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12808 — one `GET /cloud/environment-entitlements` per organisation,
 * however many readers are mounted.
 *
 * The Cloud pricing page mounted three `cloud:plan-status` nodes (one per plan
 * card) and the Welcome page mounted `cloud:onboarding-next` beside
 * `cloud:workspace-timezone-notice`. Each used to issue its own GET, and Chrome
 * serialises identical in-flight GETs, so the requests cost one round trip each,
 * in series. Every reader now shares one organisation-keyed resource.
 *
 * `cloud:plan-status` and `cloud:onboarding-next` have since retired
 * (objectui#12954), so the page below mounts the readers that remain: the real
 * `cloud:workspace-timezone-notice` widget twice, and twice a bare hook reader
 * that reads the summary the way the environment list does. The count is taken
 * at the one seam every reader's request goes through (`createAuthenticatedFetch`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, renderHook } from '@testing-library/react';
import React from 'react';

let orgId = 'org_1';
const entitlementGets: string[] = [];

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ activeOrganization: { id: orgId } }),
  createAuthenticatedFetch: () => async (url: string) => {
    if (url.includes('/cloud/environment-entitlements')) entitlementGets.push(url);
    const org = new URL(url, 'http://x.test').searchParams.get('organizationId');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          plan: org === 'org_2' ? 'pro' : 'free',
          hasProductionEnv: true,
          workspaceTimezoneSeed: org === 'org_2' ? 'Europe/Berlin' : 'Asia/Shanghai',
        },
      }),
    };
  },
}));

import { createAuthenticatedFetch } from '@object-ui/auth';
import { I18nProvider } from '@object-ui/i18n';
import { AdapterCtx } from '@object-ui/react';
import { CloudWorkspaceTimezoneNotice } from '../../console/home/CloudWorkspaceTimezoneNotice';
import { useEnvironmentEntitlements } from '../useEnvironmentEntitlements';

const adapter = { find: vi.fn().mockResolvedValue([]) };

/** A bare reader: the hook as the environment list reads it, printing the plan it is answered. */
function PlanReader() {
  const [authFetch] = React.useState(() => createAuthenticatedFetch());
  const entitlements = useEnvironmentEntitlements({ enabled: true, dataSource: adapter, authFetch, apiBase: '' });
  return <span data-plan-reader={entitlements?.source === 'summary' ? entitlements.plan : 'pending'} />;
}

function Page() {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <AdapterCtx.Provider value={adapter as never}>
        <CloudWorkspaceTimezoneNotice />
        <CloudWorkspaceTimezoneNotice />
        <PlanReader />
        <PlanReader />
      </AdapterCtx.Provider>
    </I18nProvider>
  );
}

const planReaders = (plan: string) => document.querySelectorAll(`[data-plan-reader="${plan}"]`);

/** Let any request a mount would still start get started and settled. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => {
  cleanup();
  entitlementGets.length = 0;
  orgId = 'org_1';
});

describe('one entitlements request per organisation (objectui#12808)', () => {
  it('four readers mounted together issue one GET, and every reader gets the answer', async () => {
    render(<Page />);

    expect(await screen.findAllByText(/Asia\/Shanghai/)).toHaveLength(2);
    await waitFor(() => expect(planReaders('free')).toHaveLength(2));
    await flush();

    expect(entitlementGets).toEqual(['/api/v1/cloud/environment-entitlements?organizationId=org_1']);
  });

  it('CONTROL: an organisation change issues exactly one more', async () => {
    const view = render(<Page />);
    await screen.findAllByText(/Asia\/Shanghai/);
    await flush();
    expect(entitlementGets).toHaveLength(1);

    orgId = 'org_2';
    view.rerender(<Page />);
    // Every reader moved to org_2's answer: both notices name its seed, both
    // bare readers its plan.
    expect(await screen.findAllByText(/Europe\/Berlin/)).toHaveLength(2);
    await waitFor(() => expect(planReaders('pro')).toHaveLength(2));
    await flush();

    expect(entitlementGets).toEqual([
      '/api/v1/cloud/environment-entitlements?organizationId=org_1',
      '/api/v1/cloud/environment-entitlements?organizationId=org_2',
    ]);
  });

  it('CONTROL: a refreshKey change re-resolves once, for every reader', async () => {
    const authFetch = (await import('@object-ui/auth')).createAuthenticatedFetch();
    const opts = { enabled: true, dataSource: adapter, authFetch, apiBase: '' };
    const other = renderHook(() => useEnvironmentEntitlements(opts));
    const list = renderHook(({ refreshKey }) => useEnvironmentEntitlements({ ...opts, refreshKey }), {
      initialProps: { refreshKey: 0 },
    });
    await waitFor(() => expect(list.result.current?.source).toBe('summary'));
    await flush();
    expect(entitlementGets).toHaveLength(1);
    const before = other.result.current;

    list.rerender({ refreshKey: 1 });
    await waitFor(() => expect(other.result.current).not.toBe(before));
    await flush();

    expect(entitlementGets).toHaveLength(2);
    expect(list.result.current).toBe(other.result.current);
  });

  it('CONTROL: the answer does not outlive its readers — a later mount asks again', async () => {
    const first = render(<Page />);
    await screen.findAllByText(/Asia\/Shanghai/);
    await flush();
    first.unmount();
    await flush();

    render(<Page />);
    await screen.findAllByText(/Asia\/Shanghai/);
    await flush();

    expect(entitlementGets).toHaveLength(2);
  });
});
