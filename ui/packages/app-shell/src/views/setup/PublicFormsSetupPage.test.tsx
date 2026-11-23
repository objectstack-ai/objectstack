// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Public forms, rendered (objectstack#36444): the page's gates and what
 * a row says. Which forms are listed and where a switch is saved are
 * `publicForms.test.ts`'s; here the list read, the metadata client and the
 * package list are faked, and `t` echoes the KEY and its values.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

const fake = vi.hoisted(() => ({
  items: [] as unknown[],
  layered: (_name: string, _packageId?: string): { code?: unknown; effective?: unknown; draft?: unknown } => ({}),
  packages: new Map<string, { writable: boolean; manifest: { id: string; version?: string } }>(),
  save: undefined as unknown as (...args: unknown[]) => Promise<unknown>,
  toast: { success: (..._args: unknown[]) => undefined, error: (..._args: unknown[]) => undefined },
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `«${key}» ${JSON.stringify(values)}` : `«${key}»`),
    language: 'en',
  }),
}));
vi.mock('sonner', () => ({ toast: fake.toast }));
vi.mock('../../providers/AdapterProvider.js', () => {
  // One adapter for the whole run, as the provider holds one: the page re-reads when it changes.
  const adapter = { getClient: () => ({ meta: { getItems: async () => ({ items: fake.items }) } }) };
  return { useAdapter: () => adapter };
});
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ objects: [{ name: 'crm_lead', label: 'Lead' }] }),
}));
vi.mock('../metadata-admin/useMetadata.js', async (importOriginal) => {
  const client = {
    layered: async (_type: string, name: string, options?: { packageId?: string }) => fake.layered(name, options?.packageId),
    save: (...args: unknown[]) => fake.save(...args),
    publish: async () => ({}),
    reset: async () => ({}),
  };
  return { ...(await importOriginal<Record<string, unknown>>()), useMetadataClient: () => client };
});
vi.mock('../studio-design/packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: async () => fake.packages,
}));

import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';
import { PublicFormsSetupPage } from './PublicFormsSetupPage';

const sharing = (enabled?: boolean) => ({
  ...(enabled === undefined ? {} : { enabled }),
  allowAnonymous: true,
  publicLink: 'contact-us',
});
const form = (enabled: boolean | undefined, extra: Record<string, unknown> = {}) => ({
  name: 'web_to_lead',
  object: 'crm_lead',
  viewKind: 'form',
  label: 'Contact us',
  _packageId: 'crm',
  config: { title: 'Contact us', data: { object: 'crm_lead' }, sharing: sharing(enabled) },
  ...extra,
});

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

function host(systemPermissions: string[]) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <MePermissionsProvider initialPermissions={served(systemPermissions)}>{children}</MePermissionsProvider>
    </MemoryRouter>
  );
}

const ADMIN = ['manage_platform_settings', 'manage_metadata'];

beforeEach(() => {
  fake.items = [];
  fake.layered = () => ({});
  fake.packages = new Map();
  fake.save = async () => ({});
  fake.toast.success = vi.fn();
  fake.toast.error = vi.fn();
});
afterEach(cleanup);

describe('PublicFormsSetupPage', () => {
  it('without the Setup capability: says so and lists nothing', async () => {
    fake.items = [form(true)];
    render(<PublicFormsSetupPage />, { wrapper: host(['manage_metadata']) });
    expect(await screen.findByTestId('public-forms-not-allowed')).toHaveTextContent('«publicFormsSetup.notAllowed»');
    expect(screen.queryByTestId('public-forms-table')).toBeNull();
  });

  it('without the metadata capability the server asks for every switch: lists the forms, says why the switches are off-limits', async () => {
    fake.items = [form(true)];
    fake.packages.set('crm', { writable: true, manifest: { id: 'crm' } });
    render(<PublicFormsSetupPage />, { wrapper: host(['manage_platform_settings']) });
    expect(await screen.findByTestId('public-form-row-web_to_lead')).toHaveAttribute('data-on', 'true');
    expect(screen.getByTestId('public-forms-no-switch')).toHaveTextContent('«publicFormsSetup.noSwitchPermission»');
    expect(screen.getByTestId('public-form-switch-web_to_lead')).toBeDisabled();
  });

  for (const [how, enabled] of [['enabled: false', false], ['no enabled', undefined]] as const) {
    it(`(${how}) shows a form its installed app ships switched off as off, even when an override switches it on`, async () => {
      const base = form(enabled);
      const override = { ...form(true), _packageId: undefined, overrides: { package: 'crm', basedOn: '3.0.0' } };
      fake.items = [{ ...override, _packageId: 'crm' }];
      fake.layered = () => ({ code: base, effective: override });
      fake.packages.set('crm', { writable: false, manifest: { id: 'crm', version: '3.0.0' } });
      render(<PublicFormsSetupPage />, { wrapper: host(ADMIN) });
      const row = await screen.findByTestId('public-form-row-web_to_lead');
      await waitFor(() => expect(row).toHaveAttribute('data-on', 'false'));
      expect(row).toHaveAttribute('data-shipped-off', 'true');
      expect(screen.getByTestId('public-form-shipped-off-web_to_lead')).toHaveTextContent('«publicFormsSetup.shippedOff»');
      expect(screen.getByTestId('public-form-switch-web_to_lead')).toBeDisabled();
    });
  }

  it('a switch over a pending draft says so and does not read as done', async () => {
    fake.items = [form(true)];
    fake.layered = () => ({ code: form(true), effective: form(true) });
    fake.packages.set('crm', { writable: true, manifest: { id: 'crm' } });
    fake.save = async () => {
      throw Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    };
    render(<PublicFormsSetupPage />, { wrapper: host(ADMIN) });
    fireEvent.click(await screen.findByTestId('public-form-switch-web_to_lead'));
    await waitFor(() => expect(fake.toast.error).toHaveBeenCalledWith(expect.stringContaining('«publicFormsSetup.pendingDraft»')));
    expect(fake.toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId('public-form-row-web_to_lead')).toHaveAttribute('data-on', 'true');
  });

  it('a switch the server refuses is told in business words, never the server\'s own message', async () => {
    fake.items = [form(true)];
    fake.layered = () => ({ code: form(true), effective: form(true) });
    fake.packages.set('crm', { writable: true, manifest: { id: 'crm' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [status, sentence] of [
      [403, '«publicFormsSetup.refusalForbidden»'],
      [500, '«publicFormsSetup.refusalServer»'],
    ] as const) {
      (fake.toast.error as ReturnType<typeof vi.fn>).mockClear();
      fake.save = async () => {
        throw Object.assign(new Error('Capability manage_metadata required for PUT /meta/view/web_to_lead'), { status });
      };
      const { unmount } = render(<PublicFormsSetupPage />, { wrapper: host(ADMIN) });
      fireEvent.click(await screen.findByTestId('public-form-switch-web_to_lead'));
      await waitFor(() => expect(fake.toast.error).toHaveBeenCalledTimes(1));
      const [said] = (fake.toast.error as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(said).toContain('«publicFormsSetup.switchFailed»');
      expect(said).toContain(sentence);
      expect(said).not.toContain('Capability');
      unmount();
    }
    warn.mockRestore();
  });
});
