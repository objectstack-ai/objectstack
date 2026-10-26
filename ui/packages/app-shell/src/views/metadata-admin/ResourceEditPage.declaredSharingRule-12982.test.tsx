// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12982 — a declared sharing rule opened from Setup's list (the
 * environment scope) is read-only, whatever the served type entry offers.
 *
 * `/meta/types` serves `sharing_rule` with `allowRuntimeCreate: true` (recorded
 * on a showcase boot of objectstack `main`), so without this gate a rule with
 * no package would open editable there, and its Save would write a registry
 * item — a second way to author a rule beside the `sys_sharing_rule` record
 * Setup's organization rules page writes (`sharing-rule-catalog.ts`). The item
 * here carries no package on purpose: it is the case the type tier alone
 * would leave writable, and the Studio control (no scope) shows it is.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const RULE = {
  name: 'env_rule',
  label: 'Environment Rule',
  type: 'criteria',
  object: 'showcase_contact',
  accessLevel: 'read',
  sharedWith: { type: 'position', value: 'manager' },
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({
    code: null,
    overlay: RULE,
    overlayScope: null,
    effective: RULE,
    provenance: 'org',
  })),
};

const SCHEMA = { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } } };

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        { type: 'sharing_rule', name: 'sharing_rule', label: 'sharing_rule', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA },
      ],
    }),
  };
});

vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

import { MetadataResourceEditPage } from './ResourceEditPage';
import { t } from './i18n';

/** The page's "Edit" affordance: offered only for an item this caller may write. */
const editButton = () => screen.queryAllByRole('button', { name: t('engine.edit.edit', 'en-US') });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mount(search: string) {
  render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/sharing_rule/env_rule${search}`]}>
      <MetadataResourceEditPage type="sharing_rule" name="env_rule" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
}

describe('a declared sharing rule in the Setup list is read-only (objectui#12982)', () => {
  it('in the environment scope: the declared banner, and no Edit affordance', async () => {
    await mount('?scope=environment');
    expect(await screen.findByTestId('declared-readonly-banner')).toBeInTheDocument();
    await screen.findByDisplayValue('Environment Rule');
    expect(editButton()).toHaveLength(0);
  });

  it('control: in Studio (no scope) the same item stays writable and carries no banner', async () => {
    await mount('');
    await screen.findByDisplayValue('Environment Rule');
    expect(screen.queryByTestId('declared-readonly-banner')).toBeNull();
    expect(editButton().length).toBeGreaterThan(0);
  });
});
