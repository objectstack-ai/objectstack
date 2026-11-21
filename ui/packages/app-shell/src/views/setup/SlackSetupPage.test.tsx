// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's Slack page (#34730 step 3): gated by `setup.write` as its doors
 * are; install, set the token again and remove the install, with a confirm
 * that says linked people are told; list links as served and remove one with
 * a confirm; the token input never pre-fills; at the served cap the list says
 * it may be incomplete. The doors are faked with the envelopes
 * `slack-link-routes.ts` writes; `t` echoes the KEY.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
}));

// The served cap is the store's unpaged read (10,000); two keeps the cap test small.
vi.mock('../../console/notification-settings/slackDoors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SLACK_LINKS_SERVED_CAP: 2,
}));

import { SchemaRendererProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { builtInLocales } from '@object-ui/i18n/locales';
import { SlackSetupPage } from './SlackSetupPage';
import { SLACK_ACCOUNT_URL, SLACK_LINKS_URL } from '../../console/notification-settings/slackDoors';
import { getAppComponent } from '../../services/componentRegistry';
// The registry check loads every built-in page; pay the metadata admin's lint load at collection.
import '@objectstack/lint';
import '../../services/builtinComponents';

const ACME = { id: 'acc1', workspace: 'Acme', workspaceId: 'T1', status: 'active' };
const ADA = { id: 'l1', userId: 'u_ada', slackUserId: 'UADA', slackUserName: 'Ada', state: 'confirmed', confirmedAt: '2026-11-20T10:00:00.000Z' };
const BOB = { id: 'l2', userId: 'u_bob', slackUserId: null, slackUserName: null, state: 'proposed', confirmedAt: null };
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const refused = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), { status });

/** A fake of the five administrator doors over one stored state. */
function doors(initial: { account: unknown; links: unknown[] }, put?: (body: { token: string }) => Response) {
  const state = { ...initial };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === SLACK_ACCOUNT_URL && method === 'GET') return ok({ account: state.account });
    if (url === SLACK_ACCOUNT_URL && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { token: string };
      if (put) return put(body);
      state.account = ACME;
      return ok({ account: ACME });
    }
    if (url === SLACK_ACCOUNT_URL && method === 'DELETE') {
      state.account = null;
      state.links = [];
      return ok({ removed: true });
    }
    if (url === SLACK_LINKS_URL && method === 'GET') return ok({ links: state.links });
    if (url.startsWith(`${SLACK_LINKS_URL}/`) && method === 'DELETE') {
      const id = decodeURIComponent(url.slice(SLACK_LINKS_URL.length + 1));
      state.links = state.links.filter((l) => (l as { id: string }).id !== id);
      return ok({ removed: true });
    }
    return refused(404, 'NOT_FOUND', `${method} ${url}`);
  });
  return { fetch, state };
}

function served(systemPermissions: string[]): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'admin',
    tenantId: 'org1',
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: [],
    objects: {},
    fields: {},
    systemPermissions,
  } as MePermissionsAuthenticatedResponse;
}

function host(fetch: ReturnType<typeof vi.fn>, systemPermissions: string[] = ['setup.access', 'setup.write']) {
  return ({ children }: { children: ReactNode }) => (
    <MePermissionsProvider initialPermissions={served(systemPermissions)}>
      <SchemaRendererProvider dataSource={{} as never} apiFetch={fetch as never}>
        {children}
      </SchemaRendererProvider>
    </MePermissionsProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SlackSetupPage', () => {
  it('without setup.write: says what is needed and reads no door', async () => {
    const { fetch } = doors({ account: ACME, links: [ADA] });
    render(<SlackSetupPage />, { wrapper: host(fetch, ['setup.access']) });

    expect(await screen.findByTestId('slack-setup-not-allowed')).toHaveTextContent('«slackSetup.notAllowed»');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('install: the token goes to PUT { token }, the input is emptied, and the install is drawn', async () => {
    const { fetch } = doors({ account: null, links: [] });
    render(<SlackSetupPage />, { wrapper: host(fetch) });

    expect(await screen.findByTestId('slack-setup-not-installed')).toBeInTheDocument();
    const input = screen.getByTestId('slack-setup-token') as HTMLInputElement;
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'xoxb-1' } });
    fireEvent.click(screen.getByTestId('slack-setup-save'));

    expect(await screen.findByTestId('slack-setup-account')).toHaveTextContent('«slackSetup.workspace»');
    expect(fetch).toHaveBeenCalledWith(SLACK_ACCOUNT_URL, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ token: 'xoxb-1' }) }));
    expect(screen.getByTestId('slack-setup-token')).toHaveValue('');
    expect(screen.getByTestId('slack-setup-notice')).toHaveTextContent('«slackSetup.installed»');
  });

  it('update: an installed token is never pre-filled; a refused token shows the server’s sentence', async () => {
    const message = 'This token belongs to another Slack workspace than the one installed (Acme). Remove the install first, which removes every link to it. Nothing was saved.';
    const { fetch } = doors({ account: ACME, links: [] }, () => refused(409, 'RESOURCE_CONFLICT', message));
    render(<SlackSetupPage />, { wrapper: host(fetch) });

    await screen.findByTestId('slack-setup-account');
    expect(screen.getByTestId('slack-setup-token')).toHaveValue('');
    fireEvent.change(screen.getByTestId('slack-setup-token'), { target: { value: 'xoxb-other' } });
    fireEvent.click(screen.getByTestId('slack-setup-save'));

    expect(await screen.findByTestId('slack-setup-refused')).toHaveTextContent(message);
    expect(screen.getByTestId('slack-setup-token')).toHaveValue('');
  });

  it('remove the install: a confirm that says linked people are told, then DELETE', async () => {
    const { fetch, state } = doors({ account: ACME, links: [ADA] });
    render(<SlackSetupPage />, { wrapper: host(fetch) });

    fireEvent.click(await screen.findByTestId('slack-setup-uninstall'));
    expect(await screen.findByTestId('slack-setup-confirm')).toHaveTextContent('«slackSetup.uninstallBody»');
    expect(fetch).not.toHaveBeenCalledWith(SLACK_ACCOUNT_URL, expect.objectContaining({ method: 'DELETE' }));
    fireEvent.click(screen.getByTestId('slack-setup-confirm-remove'));

    expect(await screen.findByTestId('slack-setup-not-installed')).toBeInTheDocument();
    expect(state.account).toBeNull();
  });

  it('lists links as served — a proposal names no Slack user — and removes one after a confirm', async () => {
    const { fetch, state } = doors({ account: ACME, links: [ADA, BOB] });
    render(<SlackSetupPage />, { wrapper: host(fetch) });

    const ada = await screen.findByTestId('slack-setup-link-l1');
    expect(ada).toHaveTextContent('u_ada');
    expect(ada).toHaveTextContent('Ada · UADA');
    expect(screen.getByTestId('slack-setup-link-l2')).toHaveTextContent('«slackSetup.proposedLink»');

    fireEvent.click(screen.getByTestId('slack-setup-remove-l2'));
    expect(await screen.findByTestId('slack-setup-confirm')).toHaveTextContent('«slackSetup.removeBody»');
    fireEvent.click(screen.getByTestId('slack-setup-confirm-remove'));

    await waitFor(() => expect(screen.queryByTestId('slack-setup-link-l2')).toBeNull());
    expect(fetch).toHaveBeenCalledWith(`${SLACK_LINKS_URL}/l2`, expect.objectContaining({ method: 'DELETE' }));
    expect(state.links).toEqual([ADA]);
  });

  it('at the served cap the list says it may be incomplete, and never pages', async () => {
    const { fetch } = doors({ account: ACME, links: [ADA, BOB] });
    render(<SlackSetupPage />, { wrapper: host(fetch) });

    expect(await screen.findByTestId('slack-setup-links-capped')).toHaveTextContent('«slackSetup.linksCapped»');
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith(SLACK_LINKS_URL))).toHaveLength(1);
  });

  it('the served cap is the store’s unpaged read', async () => {
    const actual = await vi.importActual<{ SLACK_LINKS_SERVED_CAP: number }>('../../console/notification-settings/slackDoors');
    expect(actual.SLACK_LINKS_SERVED_CAP).toBe(10000);
  });

  it('below the cap no such text', async () => {
    const { fetch } = doors({ account: ACME, links: [ADA] });
    render(<SlackSetupPage />, { wrapper: host(fetch) });

    await screen.findByTestId('slack-setup-link-l1');
    expect(screen.queryByTestId('slack-setup-links-capped')).toBeNull();
  });
});

describe('Setup names the page', () => {
  it('messaging:slack resolves to this page', () => {
    expect(getAppComponent('messaging:slack')).toBeTruthy();
  });

  it('every built-in locale carries the same Slack keys and placeholders', () => {
    type Pack = Record<string, Record<string, string> | undefined>;
    const packs = builtInLocales as unknown as Record<string, Pack>;
    const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const section of ['slackLink', 'slackSetup']) {
      const en = packs.en[section]!;
      for (const [locale, pack] of Object.entries(packs)) {
        expect(Object.keys(pack[section] ?? {}).sort(), `${locale}.${section}`).toEqual(Object.keys(en).sort());
        for (const key of Object.keys(en)) {
          expect(placeholders(pack[section]![key]), `${locale}.${section}.${key}`).toEqual(placeholders(en[key]));
        }
      }
    }
  });
});
