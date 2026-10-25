// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11781 — the Data pillar's field inspector belongs to the view that
 * opened it.
 *
 * Measured in a Studio browser pass: open a field's *Field properties* on the
 * Form tab, then switch Advanced → Validations / Hooks / Actions / API /
 * Settings, and the inspector stayed open on every one of them; Escape did not
 * close it either. The selection is the pillar's `fieldSel`, which the view
 * switch never cleared and no key handler read.
 *
 * Pinned here: every view switch closes it (and re-clicking the view you are
 * on does not), and Escape closes it unless something else already answered
 * that Escape or it was pressed outside the pillar.
 *
 * No field inspector is registered, so the rail renders its header and the
 * "no inspector" note: the rail's presence is the observable, whatever it holds.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'showcase_task', label: 'Task' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
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
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// The Advanced views live in a Radix DropdownMenu; this suite measures the
// pillar's selection, not radix's open/close machinery, so the menu renders as
// plain passthroughs (the convention of DataPillar.panelGate.test.tsx).
type PassthroughProps = { children?: React.ReactNode; onSelect?: () => void };
vi.mock('@object-ui/components', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/components')>();
  return {
    ...mod,
    DropdownMenu: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuTrigger: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuContent: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuItem: (p: PassthroughProps) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
    // objectui#11794 — the Advanced items are radio items (the menu checks the open panel).
    DropdownMenuRadioGroup: (p: PassthroughProps) => <div>{p.children}</div>,
    DropdownMenuRadioItem: (p: PassthroughProps) => (
      <button type="button" onClick={() => p.onSelect?.()}>{p.children}</button>
    ),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

afterEach(cleanup);

const L = (key: string) => t(key, 'en-US');
const INSPECTOR = L('engine.studio.data.fieldProps');

const rail = () => screen.queryByText(INSPECTOR);

/** Render the pillar, open Form, and select the object's one field. */
async function openInspectorOnForm(): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: L('engine.studio.data.tab.form') }));
  const card = (await screen.findByText('Title')).closest('[role="button"]') as HTMLElement;
  fireEvent.click(card);
  expect(await screen.findByText(INSPECTOR)).toBeInTheDocument();
  return card;
}

describe('DataPillar — the field inspector belongs to the view that opened it (objectui#11781)', () => {
  it.each([
    ['engine.studio.data.tab.rules'],
    ['engine.studio.data.tab.hooks'],
    ['engine.studio.data.tab.actions'],
    ['engine.studio.data.tab.api'],
    ['engine.studio.data.tab.settings'],
    ['engine.studio.data.tab.records'],
  ])('switching from Form to %s closes it', async (tabKey) => {
    await openInspectorOnForm();

    // objectui#12450 — the first match is the flat tab: the passthrough menu
    // draws a power panel's folded entry as a second button of the same name.
    fireEvent.click(screen.getAllByRole('button', { name: L(tabKey) })[0]);

    await waitFor(() => expect(rail()).toBeNull());
  });

  it('CONTROL — re-clicking the view it was opened on keeps it open', async () => {
    await openInspectorOnForm();

    fireEvent.click(screen.getByRole('button', { name: L('engine.studio.data.tab.form') }));

    expect(rail()).toBeInTheDocument();
  });

  it('Escape closes it', async () => {
    const card = await openInspectorOnForm();

    fireEvent.keyDown(card, { key: 'Escape' });

    await waitFor(() => expect(rail()).toBeNull());
  });

  it('CONTROL — an Escape another layer already answered leaves it open', async () => {
    const card = await openInspectorOnForm();

    // The shape of a Radix layer's own Escape: a capture listener on the
    // document that takes the keystroke before anything bubbles.
    const answer = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener('keydown', answer, { capture: true });
    try {
      fireEvent.keyDown(card, { key: 'Escape' });
    } finally {
      document.removeEventListener('keydown', answer, { capture: true });
    }

    expect(rail()).toBeInTheDocument();
  });

  it('CONTROL — an Escape pressed outside the pillar leaves it open', async () => {
    await openInspectorOnForm();

    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    try {
      fireEvent.keyDown(elsewhere, { key: 'Escape' });
    } finally {
      elsewhere.remove();
    }

    expect(rail()).toBeInTheDocument();
  });
});
