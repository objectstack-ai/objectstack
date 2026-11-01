// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28561 — what the metadata-admin item pages do under Studio's
 * "All metadata" area (ADR-0146 D1, D7), each against the same page with no
 * area around it, which is Setup's rendering and must not move.
 *
 *  - On a read-only package the generic item page is read-only: no edit, save,
 *    reset or delete, and the package is the reason it names. A `translation`
 *    shipped by a code package is the case that matters: the type accepts an
 *    environment overlay, so Setup offers the overlay save, and the server
 *    would accept it. On a writable package the page offers what Setup offers.
 *  - The routed history page offers no rollback on a read-only package.
 *  - The permission-set editor is read-only on a read-only package, and in
 *    the environment scope it links Setup's assignment page instead of
 *    drawing the holders.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const TRANSLATION_BODY = { name: 'ui_en', locale: 'en', messages: { hello: 'Hello' } };

/** A translation a code package ships, with an environment overlay on it. */
const TRANSLATION_LAYERED = {
  code: { ...TRANSLATION_BODY, _packageId: 'com.vendor.hr', _provenance: 'package' },
  overlay: { ...TRANSLATION_BODY, messages: { hello: 'Hi' } },
  overlayScope: 'org',
  effective: { ...TRANSLATION_BODY, messages: { hello: 'Hi' } },
  provenance: 'package',
  packageId: 'com.vendor.hr',
  editable: true,
  deletable: true,
};

const PERMISSION_SET = { name: 'sales_rep', label: 'Sales Rep', objects: { crm_case: { allowRead: true } }, fields: {} };

const client = {
  list: vi.fn(async (type: string) =>
    type === 'object' ? [{ item: { name: 'crm_case' } }] : [],
  ),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async (type: string) => (type === 'object' ? { fields: [] } : null)),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  history: vi.fn(async () => ({ events: [{ seq: 2, op: 'update', version: 2 }, { seq: 1, op: 'create', version: 1 }] })),
  layered: vi.fn(async (type: string) =>
    type === 'permission'
      ? { effective: PERMISSION_SET, code: null, overlay: null, overlayScope: null }
      : TRANSLATION_LAYERED,
  ),
  save: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      { type: 'translation', label: 'Translation', domain: 'ui', allowEnvironmentOverlay: true, allowRuntimeCreate: true },
      { type: 'permission', label: 'Permission', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true },
    ],
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
  useCanReadAuthoringTrail: () => true,
}));
vi.mock('./AssignedUsersSection', () => ({
  AssignedUsersSection: () => <div data-testid="assigned-users-stub" />,
}));
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  CapabilityMultiSelectField: () => <div data-testid="cap-picker" />,
  parseCapabilityNames: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
}));

import { MetadataResourceEditPage } from './ResourceEditPage';
import { MetadataResourceHistoryPage } from '../item-tools/ResourceHistoryPage';
import { PermissionMatrixEditPage } from './PermissionMatrixEditor';
import { t } from './i18n';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const READ_ONLY_HOST: MetadataAreaHost = { packageId: 'com.vendor.hr', readOnly: true, basePath: '/studio/com.vendor.hr/metadata' };
const WRITABLE_HOST: MetadataAreaHost = { packageId: 'com.example.crm', readOnly: false, basePath: '/studio/com.example.crm/metadata' };

function underHost(host: MetadataAreaHost | null, url: string, node: React.ReactNode) {
  const tree = <MemoryRouter initialEntries={[url]}>{node}</MemoryRouter>;
  return render(host ? <MetadataAreaHostContext.Provider value={host}>{tree}</MetadataAreaHostContext.Provider> : tree);
}

async function openTranslation(host: MetadataAreaHost | null) {
  const pkg = host?.packageId ?? 'com.vendor.hr';
  const base = host?.basePath ?? '/apps/setup/metadata';
  underHost(host, `${base}/translation/ui_en?package=${pkg}`, <MetadataResourceEditPage type="translation" name="ui_en" />);
  await waitFor(() => expect(client.layered).toHaveBeenCalled());
}

const editButtons = () => screen.queryAllByRole('button', { name: /^Edit$/ });

describe('the generic item page under the area (objectstack#28561)', () => {
  it('Setup (no area): the code-shipped translation offers its overlay edit and reset — the control', async () => {
    await openTranslation(null);
    expect((await screen.findAllByRole('button', { name: /^Edit$/ })).length).toBeGreaterThan(0);
    expect(screen.getByTestId('reset-or-delete-button')).toBeInTheDocument();
    expect(screen.queryByTestId('package-readonly-banner')).toBeNull();
  });

  it('a writable package: the same doors as Setup', async () => {
    await openTranslation(WRITABLE_HOST);
    expect((await screen.findAllByRole('button', { name: /^Edit$/ })).length).toBeGreaterThan(0);
    expect(screen.getByTestId('reset-or-delete-button')).toBeInTheDocument();
    expect(screen.queryByTestId('package-readonly-banner')).toBeNull();
  });

  it('a read-only package: read-only, no overlay save, no reset or delete, and the package named as the reason', async () => {
    await openTranslation(READ_ONLY_HOST);
    const banner = await screen.findByTestId('package-readonly-banner');
    expect(banner).toHaveTextContent(t('engine.studio.pkg.readonlyHint', 'en-US'));
    expect(editButtons()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByTestId('reset-or-delete-button')).toBeNull();
    // The type-level banner would name the wrong reason (a registry flag).
    expect(screen.queryByTestId('readonly-banner')).toBeNull();
    // Layers, references, history and audit stay: the read tools are not writes.
    expect(screen.getByTestId('page-shell-header-meta')).toBeInTheDocument();
  });

  it('the header badge reads the package gate under a read-only package', async () => {
    await openTranslation(READ_ONLY_HOST);
    await screen.findByTestId('package-readonly-banner');
    const badge = screen.getByText('read-only');
    expect(badge).toHaveAttribute('title', t('engine.studio.pkg.readonlyHint', 'en-US'));
  });
});

describe('the routed history page under the area', () => {
  const rollbacks = () => screen.queryAllByTitle('Rollback to this version');

  it('Setup and a writable package offer rollback', async () => {
    underHost(null, '/apps/setup/metadata/translation/ui_en/history', <MetadataResourceHistoryPage type="translation" name="ui_en" />);
    await waitFor(() => expect(rollbacks().length).toBe(2));
    cleanup();
    underHost(WRITABLE_HOST, `${WRITABLE_HOST.basePath}/translation/ui_en/history`, <MetadataResourceHistoryPage type="translation" name="ui_en" />);
    await waitFor(() => expect(rollbacks().length).toBe(2));
  });

  it('a read-only package offers none, and still draws the timeline', async () => {
    underHost(READ_ONLY_HOST, `${READ_ONLY_HOST.basePath}/translation/ui_en/history`, <MetadataResourceHistoryPage type="translation" name="ui_en" />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(rollbacks()).toHaveLength(0);
  });
});

describe('the permission-set editor under the area', () => {
  async function openSet(host: MetadataAreaHost | null, search: string) {
    const base = host?.basePath ?? '/apps/setup/metadata';
    underHost(host, `${base}/permission/sales_rep${search}`, <PermissionMatrixEditPage type="permission" name="sales_rep" />);
    await screen.findByText('crm_case');
  }

  it('Setup\'s environment scope draws the holders — the control', async () => {
    await openSet(null, '?scope=environment');
    expect(screen.getByTestId('perm-assignments')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-assignments-link-permission')).toBeNull();
  });

  it('the cross-package leg links Setup\'s assignment page, opened on the set, and draws no holders', async () => {
    await openSet({ packageId: null, readOnly: false, basePath: '/studio/~all/metadata' }, '?scope=environment');
    expect(screen.queryByTestId('perm-assignments')).toBeNull();
    expect(screen.queryByTestId('assigned-users-stub')).toBeNull();
    const link = screen.getByTestId('setup-assignments-link-permission').querySelector('a');
    expect(link).toHaveAttribute('href', '/apps/setup/component/security/permission-set-assignment?set=sales_rep');
  });

  it('a read-only package: no Save', async () => {
    await openSet(WRITABLE_HOST, '');
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeInTheDocument();
    cleanup();
    await openSet(READ_ONLY_HOST, '');
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
  });
});
