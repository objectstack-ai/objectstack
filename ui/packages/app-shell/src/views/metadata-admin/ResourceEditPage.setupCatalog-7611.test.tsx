// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7611 — the generic editor as the Setup catalog's position page:
 *
 *  - a caller without `manage_metadata` gets the read-only page and its reason
 *    (the metadata door refuses that caller's save — measured on objectstack
 *    `main`), with a holder as the control;
 *  - in the environment scope a position shows its holders under the
 *    definition; Studio (no scope) and another type do not.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const POSITION = { name: 'env_position', label: 'Environment Position' };

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({
    code: null,
    overlay: POSITION,
    overlayScope: null,
    effective: POSITION,
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
        { type: 'position', name: 'position', label: 'Position', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA },
        { type: 'dashboard', name: 'dashboard', label: 'Dashboard', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA },
      ],
    }),
  };
});
vi.mock('./PositionHoldersSection', () => ({
  PositionHoldersSection: ({ name }: { name: string }) => <div data-testid="position-holders-stub">{name}</div>,
}));

let canAuthor = true;
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => canAuthor,
}));

import { MetadataResourceEditPage } from './ResourceEditPage';

beforeEach(() => {
  canAuthor = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mount(type: string, search: string) {
  render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}/env_position${search}`]}>
      <MetadataResourceEditPage type={type} name="env_position" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
}

describe('the caller gate (#22621 → A)', () => {
  it('a caller without manage_metadata gets the read-only page and the reason', async () => {
    canAuthor = false;
    await mount('position', '?scope=environment');
    expect(await screen.findByTestId('capability-readonly-banner')).toHaveTextContent(/manage_metadata/);
  });

  it('a holder does not (control)', async () => {
    await mount('position', '?scope=environment');
    await screen.findByTestId('position-holders-stub');
    expect(screen.queryByTestId('capability-readonly-banner')).toBeNull();
  });
});

describe("a position's holders in the Setup catalog (objectui#7611)", () => {
  it('render under the definition in the environment scope', async () => {
    await mount('position', '?scope=environment');
    expect(await screen.findByTestId('position-holders-stub')).toHaveTextContent('env_position');
  });

  it('do not render in Studio (no scope)', async () => {
    await mount('position', '');
    await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
    // Let the load settle before asserting an absence.
    await screen.findByDisplayValue('Environment Position').catch(() => undefined);
    expect(screen.queryByTestId('position-holders-stub')).toBeNull();
  });

  it('do not render for another type in the scope', async () => {
    await mount('dashboard', '?scope=environment');
    await screen.findByDisplayValue('Environment Position').catch(() => undefined);
    expect(screen.queryByTestId('position-holders-stub')).toBeNull();
  });
});
