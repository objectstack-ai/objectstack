// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Empty-package behavior of the Data pillar (dogfood #2555):
 *
 * Visiting an empty writable package used to FORCE the "new object" creator
 * dialog open on every mount — an unrequested modal, duplicating the guidance
 * the empty-state panel already gives. Now the dialog stays closed and the
 * empty state carries its own create CTA instead.
 *
 * The rail beside it says the same thing in one sentence, and that sentence
 * points at the rail's own "+" (objectui#13127).
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── mocks ──────────────────────────────────────────────────────────────────
// DataPillar's data deps: the metadata client (list/listDrafts) and the
// package list (namespace lookup). Everything else renders for real.
const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => []),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...mod,
    useAdapter: () => ({}),
  };
});

import { DataPillar } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

afterEach(cleanup);

function renderPillar(props: Partial<React.ComponentProps<typeof DataPillar>> = {}) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.empty/data']}>
      <DataPillar packageId="com.acme.empty" {...props} />
    </MemoryRouter>,
  );
}

describe('DataPillar — empty package', () => {
  it('does NOT auto-open the new-object dialog and shows the empty-state CTA instead', async () => {
    renderPillar();

    // Wait for the object load to settle into the empty state.
    const cta = await screen.findByTestId('empty-state-new-object');
    expect(cta).toBeInTheDocument();

    // The creator dialog must NOT be open (no dialog content in the tree).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the creator dialog when the empty-state CTA is clicked', async () => {
    renderPillar();

    const cta = await screen.findByTestId('empty-state-new-object');
    fireEvent.click(cta);

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  // objectui#13127 — the rail's empty sentence used to send the author
  // "below", where the rail draws nothing; its only create control is the
  // "+" in the heading row above the list. The sentence names that control,
  // as the Automations and Access rails' empty sentences do (objectui#12514).
  it('the rail’s empty sentence names the “+” it points at, and the rail draws that “+” above it', async () => {
    renderPillar();
    await screen.findByTestId('empty-state-new-object');

    const rail = screen.getByTestId('studio-rail-data');
    const sentence = within(rail).getByText(t('engine.studio.data.noObjects', 'en'));
    const add = within(rail).getByTestId('studio-rail-add');

    expect(t('engine.studio.data.noObjects', 'en')).toContain('“+”');
    expect(t('engine.studio.data.noObjects', 'zh-CN')).toContain('「+」');
    expect(add.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the CTA on a read-only package', async () => {
    renderPillar({ readOnly: true });

    // Empty state still renders…
    await waitFor(() => expect(mockClient.list).toHaveBeenCalled());
    // …but with no create affordance and no dialog.
    await waitFor(() =>
      expect(screen.queryByTestId('empty-state-new-object')).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
