// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30120 (ruling A3) — the deployment notice an administrator sees
 * on a production deployment that keeps its data and secrets on its own disk.
 *
 * Driven through the real component over a stubbed `fetch`: what is drawn for
 * each finding, the copy button's text, the hide (a POST, then remembered in
 * this browser by fingerprint), the one small line System Overview keeps after
 * a hide, and the refusals that draw nothing (a member, a server answering
 * 403, outside production). Who may read the state is the server's ruling;
 * its pins live in `@objectstack/service-settings`
 * (`deployment-notice.routes.test.ts`).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const admin = { isAdmin: true, isResolved: true };
let adminStatus = admin;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'usr_admin' } }),
  useWorkspaceAdminStatus: () => adminStatus,
}));

import { DeploymentNotice } from '../DeploymentNotice';
import { HIDDEN_KEY_PREFIX, deploymentVariablesText, parseDeploymentNotice } from '../deploymentNotice';

const NOTICE = {
  production: true,
  findings: [
    { id: 'database_local_file', severity: 'high', variable: 'OS_DATABASE_URL', file: '/srv/app/.objectstack/data/app.db' },
    { id: 'auth_secret_generated', severity: 'high', variable: 'OS_AUTH_SECRET', file: '/home/node/.objectstack/auth-secret' },
    { id: 'data_key_file', severity: 'high', variable: 'OS_SECRET_KEY', file: '/srv/app/.objectstack/secret-key' },
    { id: 'file_storage_local', severity: 'low' },
    { id: 'email_not_configured', severity: 'low' },
  ],
  fingerprint: 'database_local_file+auth_secret_generated+data_key_file+file_storage_local+email_not_configured',
};

const envelope = (data: unknown) => ({ success: true, data });
const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

const t = (key: string, opts?: Record<string, unknown>) => {
  const text = String(opts?.defaultValue ?? key);
  return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(opts?.[name] ?? ''));
};

describe('DeploymentNotice (objectstack#30120)', () => {
  beforeEach(() => {
    adminStatus = admin;
    localStorage.clear();
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/settings/deployment/notice/hide') && init?.method === 'POST') {
        return json(200, envelope({ hidden: true, fingerprint: NOTICE.fingerprint }));
      }
      return json(200, envelope(NOTICE));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('draws every finding for an administrator, the three that are lost with the disk first', async () => {
    render(<DeploymentNotice placement="home" />);
    await settle();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/settings\/deployment\/notice$/),
      expect.objectContaining({ credentials: 'include' }),
    );
    const notice = screen.getByTestId('deployment-notice');
    expect(notice).toHaveAttribute('data-fingerprint', NOTICE.fingerprint);
    const ids = [...notice.querySelectorAll('[data-finding]')].map((li) => li.getAttribute('data-finding'));
    expect(ids).toEqual(NOTICE.findings.map((f) => f.id));
    expect(notice).toHaveTextContent('/srv/app/.objectstack/data/app.db');
    expect(notice).toHaveTextContent('OS_DATABASE_URL');
    expect(notice).toHaveTextContent('OS_AUTH_SECRET');
    expect(notice).toHaveTextContent('OS_SECRET_KEY');
    expect(screen.getByTestId('deployment-notice-copy')).toBeInTheDocument();
  });

  it('the copy button hands over every variable, saying which current value to carry over', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DeploymentNotice placement="home" />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('deployment-notice-copy'));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toMatch(/^OS_DATABASE_URL=$/m);
    expect(text).toMatch(/^OS_AUTH_SECRET=$/m);
    expect(text).toMatch(/^OS_SECRET_KEY=$/m);
    expect(text).toContain('the contents of /home/node/.objectstack/auth-secret');
    expect(text).toContain('the contents of /srv/app/.objectstack/secret-key');
    expect(text).toContain('Today the data is in /srv/app/.objectstack/data/app.db');
  });

  it('hide posts the fingerprint, and the home page then draws nothing', async () => {
    render(<DeploymentNotice placement="home" />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('deployment-notice-hide'));
    });
    await settle();
    const hideCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/hide'))!;
    expect(hideCall[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String((hideCall[1] as RequestInit).body))).toEqual({ fingerprint: NOTICE.fingerprint });
    expect(localStorage.getItem(`${HIDDEN_KEY_PREFIX}usr_admin`)).toBe(NOTICE.fingerprint);
    expect(screen.queryByTestId('deployment-notice')).toBeNull();
    expect(screen.queryByTestId('deployment-notice-hidden')).toBeNull();
  });

  it('after a hide, System Overview keeps one small line, and can show the notice again', async () => {
    localStorage.setItem(`${HIDDEN_KEY_PREFIX}usr_admin`, NOTICE.fingerprint);
    render(<DeploymentNotice placement="system-overview" />);
    await settle();
    expect(screen.queryByTestId('deployment-notice')).toBeNull();
    expect(screen.getByTestId('deployment-notice-hidden')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('deployment-notice-show'));
    });
    expect(screen.getByTestId('deployment-notice')).toBeInTheDocument();
    expect(localStorage.getItem(`${HIDDEN_KEY_PREFIX}usr_admin`)).toBeNull();
  });

  it('a finding that appears after the hide brings the notice back: the hide names its fingerprint', async () => {
    localStorage.setItem(`${HIDDEN_KEY_PREFIX}usr_admin`, 'database_local_file');
    render(<DeploymentNotice placement="home" />);
    await settle();
    expect(screen.getByTestId('deployment-notice')).toBeInTheDocument();
  });

  it('a deployment that keeps no audit log refuses the hide, and the notice stays', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      String(url).endsWith('/hide') && init?.method === 'POST'
        ? json(409, { success: false, error: { code: 'RESOURCE_CONFLICT', message: 'no audit log', details: { reason: 'no_audit_log' } } })
        : json(200, envelope(NOTICE)),
    );
    render(<DeploymentNotice placement="home" />);
    await settle();
    await act(async () => {
      fireEvent.click(screen.getByTestId('deployment-notice-hide'));
    });
    await settle();
    expect(screen.getByTestId('deployment-notice')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('keeps no audit log');
    expect(localStorage.getItem(`${HIDDEN_KEY_PREFIX}usr_admin`)).toBeNull();
  });

  it('a member is never sent the request, and draws nothing', async () => {
    adminStatus = { isAdmin: false, isResolved: true };
    render(<DeploymentNotice placement="home" />);
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('deployment-notice')).toBeNull();
  });

  it('an administrator the server refuses (403) draws nothing', async () => {
    fetchMock.mockResolvedValue(json(403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'no' } }));
    render(<DeploymentNotice placement="home" />);
    await settle();
    expect(screen.queryByTestId('deployment-notice')).toBeNull();
  });

  it('outside production mode, or with nothing to say, it draws nothing', async () => {
    fetchMock.mockResolvedValue(json(200, envelope({ production: false, findings: [], fingerprint: '' })));
    render(<DeploymentNotice placement="system-overview" />);
    await settle();
    expect(screen.queryByTestId('deployment-notice')).toBeNull();
    expect(screen.queryByTestId('deployment-notice-hidden')).toBeNull();
  });
});

describe('deploymentNotice helpers', () => {
  it('drops a finding this Console has no words for, and refuses a body that is not the declared shape', () => {
    expect(
      parseDeploymentNotice(envelope({ ...NOTICE, findings: [...NOTICE.findings, { id: 'something_new', severity: 'high' }] }))
        ?.findings.map((f) => f.id),
    ).toEqual(NOTICE.findings.map((f) => f.id));
    expect(parseDeploymentNotice({ success: false, error: {} })).toBeNull();
    expect(parseDeploymentNotice(envelope({ production: true }))).toBeNull();
  });

  it('a sign-in secret kept by no file asks for a new value rather than a file to carry over', () => {
    const text = deploymentVariablesText([{ id: 'auth_secret_generated', severity: 'high', variable: 'OS_AUTH_SECRET' }], t);
    expect(text).toContain('openssl rand -hex 32');
    expect(text).not.toContain('the contents of');
    expect(text).toMatch(/^OS_AUTH_SECRET=$/m);
  });

  it('lower-severity findings put nothing on the clipboard', () => {
    expect(
      deploymentVariablesText(
        [
          { id: 'file_storage_local', severity: 'low' },
          { id: 'email_not_configured', severity: 'low' },
        ],
        t,
      ),
    ).toBe('');
  });
});
