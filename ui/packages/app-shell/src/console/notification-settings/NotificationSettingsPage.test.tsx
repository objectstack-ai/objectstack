// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The account app's Notification Settings page (objectstack#34728): it draws
 * the door's matrix as the door answered it, a switch writes the person's own
 * row through the data door and the page reads the door again, a mandatory
 * topic cannot be switched, and a failed read says so instead of drawing a
 * guess.
 *
 * `t` echoes the KEY, so the assertions read which string the page asked for.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'alice' } }),
}));

import { AdapterCtx, SchemaRendererProvider } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { builtInLocales } from '@object-ui/i18n/locales';
import { NotificationSettingsPage } from './NotificationSettingsPage';
import { MY_PREFERENCES_URL } from './myPreferences';
import { getAppComponent } from '../../services/componentRegistry';
// The registry check below loads every built-in page, which reaches the
// metadata admin's dynamic `@objectstack/lint` import: pay that load at
// collection, never inside a test's clocked window.
import '@objectstack/lint';
import '../../services/builtinComponents';

type General = { digest: { value: string; source: string }; quietHours: { value: unknown; source: string } };

const BUILTIN_GENERAL: General = { digest: { value: 'none', source: 'builtin' }, quietHours: { value: null, source: 'builtin' } };

function answer(taskEnabled: boolean, taskRow?: string, general: General = BUILTIN_GENERAL) {
  return {
    data: {
      topics: [
        { topic: '*', wildcard: true, mandatory: false, channels: [{ channel: 'email', enabled: true, source: 'builtin' }, { channel: 'slack', enabled: true, source: 'builtin' }] },
        { topic: 'security.login', wildcard: false, mandatory: true, channels: [{ channel: 'email', enabled: true, source: 'mandatory' }, { channel: 'slack', enabled: true, source: 'mandatory' }] },
        {
          topic: 'task.assigned',
          wildcard: false,
          mandatory: false,
          channels: [
            { channel: 'email', enabled: taskEnabled, source: taskRow ? 'own' : 'default', ...(taskRow ? { ownRowId: taskRow } : {}) },
            { channel: 'slack', enabled: true, source: 'builtin' },
          ],
        },
      ],
      channels: [{ channel: 'email', configured: true }, { channel: 'slack', configured: false }],
      general: {
        enabled: { value: true, source: 'builtin' },
        ...general,
      },
    },
  };
}

function host(apiFetch: ReturnType<typeof vi.fn>, adapter: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }) {
  return ({ children }: { children: ReactNode }) => (
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRendererProvider dataSource={adapter as never} apiFetch={apiFetch as never}>
        {children}
      </SchemaRendererProvider>
    </AdapterCtx.Provider>
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('NotificationSettingsPage', () => {
  it('draws the matrix the door answered, sources and unconfigured channels included', async () => {
    const apiFetch = vi.fn(async () => json(answer(false)));
    const adapter = { create: vi.fn(), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    const cell = await screen.findByTestId('notification-settings-cell-task.assigned-email');
    expect(apiFetch).toHaveBeenCalledWith(MY_PREFERENCES_URL, expect.anything());
    expect(cell).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('notification-settings-topic-task.assigned')).toHaveTextContent('«notificationSettings.sourceDefault»');
    expect(screen.getByTestId('notification-settings-channel-slack')).toHaveTextContent('«notificationSettings.notConfigured»');
    expect(screen.getByTestId('notification-settings-channel-email')).not.toHaveTextContent('«notificationSettings.notConfigured»');
    expect(screen.getByTestId('notification-settings-topic-*')).toHaveTextContent('«notificationSettings.allTopics»');
    expect(screen.getByTestId('notification-settings-general-warning')).toBeInTheDocument();
  });

  it('a mandatory topic is always delivered and cannot be switched off', async () => {
    const apiFetch = vi.fn(async () => json(answer(false)));
    const adapter = { create: vi.fn(), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    const cell = await screen.findByTestId('notification-settings-cell-security.login-email');
    expect(cell).toBeDisabled();
    expect(screen.getByTestId('notification-settings-topic-security.login')).toHaveTextContent('«notificationSettings.alwaysDelivered»');
  });

  it('switching a cell creates the person’s own row, then draws the door’s new answer', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(json(answer(false))).mockResolvedValueOnce(json(answer(true, 'row-new')));
    const adapter = { create: vi.fn(async () => ({ id: 'row-new' })), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    fireEvent.click(await screen.findByTestId('notification-settings-cell-task.assigned-email'));
    await waitFor(() =>
      expect(screen.getByTestId('notification-settings-cell-task.assigned-email')).toHaveAttribute('aria-checked', 'true'),
    );
    expect(adapter.create).toHaveBeenCalledWith('sys_notification_preference', {
      user_id: 'alice',
      topic: 'task.assigned',
      channel: 'email',
      enabled: true,
    });
    expect(adapter.update).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('notification-settings-topic-task.assigned')).toHaveTextContent('«notificationSettings.sourceOwn»');
  });

  it('switching a cell the person already set updates their row', async () => {
    const apiFetch = vi.fn().mockResolvedValueOnce(json(answer(false, 'row-1'))).mockResolvedValueOnce(json(answer(true, 'row-1')));
    const adapter = { create: vi.fn(), update: vi.fn(async () => ({})) };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    fireEvent.click(await screen.findByTestId('notification-settings-cell-task.assigned-email'));
    await waitFor(() => expect(adapter.update).toHaveBeenCalledWith('sys_notification_preference', 'row-1', { enabled: true }));
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it('changing the digest writes the person’s own (*, *) row', async () => {
    const apiFetch = vi.fn().mockResolvedValue(json(answer(false)));
    const adapter = { create: vi.fn(async () => ({})), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    fireEvent.change(await screen.findByTestId('notification-settings-digest'), { target: { value: 'weekly' } });
    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith('sys_notification_preference', {
        user_id: 'alice',
        topic: '*',
        channel: '*',
        enabled: true,
        digest: 'weekly',
      }),
    );
  });

  it('an organization digest in force: "No digest" is not offered, and the digest shows where it comes from', async () => {
    const orgDaily: General = { ...BUILTIN_GENERAL, digest: { value: 'daily', source: 'default' } };
    const apiFetch = vi.fn().mockResolvedValue(json(answer(false, undefined, orgDaily)));
    const adapter = { create: vi.fn(async () => ({})), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    const select = (await screen.findByTestId('notification-settings-digest')) as HTMLSelectElement;
    expect(select.value).toBe('daily');
    expect([...select.options].map((o) => o.value)).toEqual(['daily', 'weekly']);
    expect(screen.getByTestId('notification-settings-digest-source')).toHaveTextContent('«notificationSettings.sourceDefault»');
    expect(screen.getByTestId('notification-settings-digest-no-off')).toHaveTextContent('«notificationSettings.digestNoOff»');
  });

  it('with no digest in force, "No digest" is the current value and the hint is not shown', async () => {
    const apiFetch = vi.fn().mockResolvedValue(json(answer(false)));
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, { create: vi.fn(), update: vi.fn() }) });

    const select = (await screen.findByTestId('notification-settings-digest')) as HTMLSelectElement;
    expect(select.value).toBe('none');
    expect(screen.getByTestId('notification-settings-digest-source')).toHaveTextContent('«notificationSettings.sourceBuiltin»');
    expect(screen.queryByTestId('notification-settings-digest-no-off')).toBeNull();
  });

  it('organization quiet hours in force: clearing the window cannot be saved, a complete window can', async () => {
    const orgQuiet: General = { ...BUILTIN_GENERAL, quietHours: { value: { start: '22:00', end: '07:00' }, source: 'default' } };
    const apiFetch = vi.fn().mockResolvedValue(json(answer(false, undefined, orgQuiet)));
    const adapter = { create: vi.fn(async () => ({})), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    const start = await screen.findByTestId('quiet-hours-start');
    const end = screen.getByTestId('quiet-hours-end');
    const save = screen.getByTestId('notification-settings-quiet-hours-save');
    expect(screen.getByTestId('notification-settings-quiet-hours-source')).toHaveTextContent('«notificationSettings.sourceDefault»');

    fireEvent.change(start, { target: { value: '' } });
    fireEvent.change(end, { target: { value: '' } });
    expect(await screen.findByTestId('notification-settings-quiet-hours-no-clear')).toHaveTextContent('«notificationSettings.quietHoursNoClear»');
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(adapter.create).not.toHaveBeenCalled();

    fireEvent.change(start, { target: { value: '23:00' } });
    fireEvent.change(end, { target: { value: '06:00' } });
    await waitFor(() => expect(save).not.toBeDisabled());
    expect(screen.queryByTestId('notification-settings-quiet-hours-no-clear')).toBeNull();
    fireEvent.click(save);
    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith('sys_notification_preference', {
        user_id: 'alice',
        topic: '*',
        channel: '*',
        enabled: true,
        quiet_hours: { start: '23:00', end: '06:00' },
      }),
    );
  });

  it('a refused write is shown, and the matrix keeps what is in force', async () => {
    const apiFetch = vi.fn().mockResolvedValue(json(answer(false)));
    const adapter = { create: vi.fn(async () => Promise.reject(new Error('Permission denied'))), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    fireEvent.click(await screen.findByTestId('notification-settings-cell-task.assigned-email'));
    expect(await screen.findByTestId('notification-settings-save-failed')).toHaveTextContent('«notificationSettings.saveFailed»');
    expect(screen.getByTestId('notification-settings-cell-task.assigned-email')).toHaveAttribute('aria-checked', 'false');
  });

  it('a failed read says so and draws no matrix', async () => {
    const apiFetch = vi.fn(async () => json({}, 500));
    const adapter = { create: vi.fn(), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: host(apiFetch, adapter) });

    expect(await screen.findByTestId('notification-settings-load-failed')).toHaveTextContent('«notificationSettings.loadFailed»');
    expect(screen.queryByTestId('notification-settings-matrix')).toBeNull();
  });

  it('every built-in locale carries the same keys and placeholders', () => {
    type Pack = { notificationSettings?: Record<string, string> };
    const en = (builtInLocales as Record<string, Pack>).en.notificationSettings!;
    const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const [locale, pack] of Object.entries(builtInLocales as Record<string, Pack>)) {
      expect(Object.keys(pack.notificationSettings ?? {}).sort(), locale).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(en)) {
        expect(placeholders(pack.notificationSettings![key]), `${locale}.notificationSettings.${key}`).toEqual(placeholders(en[key]));
      }
    }
  });
});

describe('the account app names the page', () => {
  it('account:notification_settings resolves to this page', async () => {
    const entry = getAppComponent('account:notification_settings');
    expect(entry).toMatchObject({ ref: 'account:notification_settings', source: '@object-ui/app-shell' });
    const apiFetch = vi.fn(async () => json(answer(false)));
    const Registered = entry!.component;
    render(<Registered />, { wrapper: host(apiFetch, { create: vi.fn(), update: vi.fn() }) });
    expect(await screen.findByTestId('notification-settings-matrix')).toBeInTheDocument();
  });
});

/**
 * Who may change the page: the caller's grant on `sys_notification_preference`,
 * read from the real `MePermissionsProvider` over each persona's `/me/permissions`
 * answer, shaped as the default sets serve it (plugin-security
 * `default-permission-sets.ts`): `external_default` names no row for the
 * object and carries no `'*'`, `member_default` grants create and edit on it,
 * and `organization_admin` reaches it through its `'*'` row.
 */
describe('the caller\'s grant on sys_notification_preference decides whether the page writes', () => {
  function served(objects: Record<string, Record<string, boolean>>, positions: string[]): MePermissionsAuthenticatedResponse {
    return {
      authenticated: true,
      userId: 'alice',
      tenantId: null,
      positions,
      hasAnyQueue: false,
      objectsUsingQueues: [],
      permissionSets: [],
      objects,
      fields: {},
    } as MePermissionsAuthenticatedResponse;
  }

  const EXTERNAL = served(
    {
      sys_user: { allowRead: true, allowCreate: false, allowEdit: true, allowDelete: false },
      sys_user_preference: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
      sys_notification_receipt: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
    },
    ['org_external'],
  );
  const MEMBER = served(
    { sys_notification_preference: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false } },
    ['org_member'],
  );
  const ORG_ADMIN = served(
    {
      '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
    },
    ['org_admin'],
  );

  function hostAs(
    permissions: MePermissionsAuthenticatedResponse,
    apiFetch: ReturnType<typeof vi.fn>,
    adapter: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> },
  ) {
    const Inner = host(apiFetch, adapter);
    return ({ children }: { children: ReactNode }) => (
      <MePermissionsProvider initialPermissions={permissions}>
        <Inner>{children}</Inner>
      </MePermissionsProvider>
    );
  }

  it('an external member sees every control disabled with the reason, and no write is sent', async () => {
    const orgQuiet: General = { ...BUILTIN_GENERAL, quietHours: { value: { start: '22:00', end: '07:00' }, source: 'default' } };
    const apiFetch = vi.fn(async () => json(answer(false, undefined, orgQuiet)));
    const adapter = { create: vi.fn(), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: hostAs(EXTERNAL, apiFetch, adapter) });

    const reason = await screen.findByTestId('notification-settings-read-only');
    expect(reason).toHaveTextContent('«notificationSettings.readOnly»');
    const reasonId = reason.querySelector('[id]')!.id;

    const cell = screen.getByTestId('notification-settings-cell-task.assigned-email');
    const digest = screen.getByTestId('notification-settings-digest');
    const save = screen.getByTestId('notification-settings-quiet-hours-save');
    for (const control of [cell, digest, save]) {
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute('aria-describedby', reasonId);
    }
    // The quiet hours read as text, not as inputs to edit.
    expect(screen.queryByTestId('quiet-hours-start')).toBeNull();
    // What is in force is still drawn.
    expect(screen.getByTestId('notification-settings-topic-task.assigned')).toHaveTextContent('«notificationSettings.sourceDefault»');

    fireEvent.click(cell);
    fireEvent.change(digest, { target: { value: 'weekly' } });
    fireEvent.click(save);
    expect(adapter.create).not.toHaveBeenCalled();
    expect(adapter.update).not.toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a member (member_default grants create and edit)', MEMBER],
    ['an organization administrator (the wildcard row)', ORG_ADMIN],
  ])('%s sees no change: no reason, and a switch writes', async (_persona, permissions) => {
    const apiFetch = vi.fn().mockResolvedValueOnce(json(answer(false))).mockResolvedValueOnce(json(answer(true, 'row-new')));
    const adapter = { create: vi.fn(async () => ({ id: 'row-new' })), update: vi.fn() };
    render(<NotificationSettingsPage />, { wrapper: hostAs(permissions, apiFetch, adapter) });

    const cell = await screen.findByTestId('notification-settings-cell-task.assigned-email');
    expect(screen.queryByTestId('notification-settings-read-only')).toBeNull();
    expect(cell).not.toBeDisabled();
    expect(cell).not.toHaveAttribute('aria-describedby');
    expect(screen.getByTestId('notification-settings-digest')).not.toBeDisabled();

    fireEvent.click(cell);
    await waitFor(() =>
      expect(adapter.create).toHaveBeenCalledWith('sys_notification_preference', {
        user_id: 'alice',
        topic: 'task.assigned',
        channel: 'email',
        enabled: true,
      }),
    );
  });
});
