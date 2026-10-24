// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `新建对象` must ask for the record-sharing baseline — objectui#5418.
 *
 * Measured walk on the card: the create dialog collected exactly two fields
 * (对象名称 / 标识), `buildObjectSkeleton` emitted `{ name, label, fields }`,
 * and the object was refused at 发布 → 全部发布 by `security-owd-unset`. The
 * gate is right — an OWD must be an authored decision — so the fix is to ask,
 * at the one moment the author is thinking about the object.
 *
 * This suite drives the REAL `DataPillar` and asserts on the body it hands to
 * `client.save`, because "the dialog renders a select" is not the claim; the
 * claim is that the SAVED DRAFT carries an authored baseline.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: null, code: null })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
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

import { DataPillar } from './StudioDesignSurface';
import { t } from '../metadata-admin/i18n';

/**
 * A model's label in the create dialog: the Settings tab's own string, read by
 * its key. The picker is the shared `Select` since objectui#11865, so what it
 * holds is read off its trigger and its list, by label.
 */
const modelLabel = (key: string) => t(`engine.studio.settings.${key}`, 'en');

/** Open the record-sharing picker and return the labels it lists, in order. */
async function listedModels(trigger: HTMLElement): Promise<string[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox'))
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

function renderPillar() {
  return render(
    <MemoryRouter initialEntries={['/studio/com.test.crmext/data']}>
      <DataPillar packageId="com.test.crmext" />
    </MemoryRouter>,
  );
}

/** Open the create dialog from the empty-state affordance. */
async function openCreateDialog() {
  renderPillar();
  const opener = await screen.findByTestId('empty-state-new-object');
  fireEvent.click(opener);
  return await screen.findByTestId('create-object-owd');
}

/**
 * Type a display name and submit. Selected structurally rather than by copy:
 * this suite is about the saved body, and pinning it to a placeholder string
 * would make it fail the next time that copy is reworded — in either of the
 * two locales the Studio catalog carries.
 */
function fillAndSubmit(label: string) {
  const dialog = screen.getByRole('dialog');
  const inputs = dialog.querySelectorAll('input');
  // CreateItemDialog renders the display-name field first; the identifier
  // auto-slugs from it, which is the path a real author walks.
  fireEvent.change(inputs[0], { target: { value: label } });
  // By accessible name, NOT by position: DialogContent renders Radix's own
  // sr-only close button AFTER the footer, so "the last button" is Close and a
  // positional pick silently dismisses the dialog instead of submitting it.
  // Matched loosely so the suite survives either of the Studio catalog's two locales.
  fireEvent.click(within(dialog).getByRole('button', { name: /save as draft|存为草稿/i }));
}

/** The body `client.save` was called with for the object draft. */
function savedBody(): Record<string, unknown> {
  expect(mockClient.save).toHaveBeenCalled();
  const call = mockClient.save.mock.calls.at(-1) as unknown as [string, string, Record<string, unknown>];
  return call[2];
}

describe('新建对象 asks for the OWD (objectui#5418)', () => {
  it('offers the baseline, defaulted to the platform’s own recommended value', async () => {
    const trigger = await openCreateDialog();
    expect(trigger.textContent).toBe(modelLabel('sharingPrivate'));
  });

  it('offers exactly the three models a brand-new object can author', async () => {
    // `controlled_by_parent` derives access from a master relation, and a
    // just-created object has none — offering it would swap the
    // `security-owd-unset` publish wall for the
    // `security-controlled-by-parent-no-relation` one. The Settings tab keeps
    // all four, where the object may since have gained a master-detail field.
    const labels = await listedModels(await openCreateDialog());
    expect(labels).toEqual([
      modelLabel('sharingPrivate'),
      modelLabel('sharingPublicRead'),
      modelLabel('sharingPublicReadWrite'),
    ]);
    expect(labels).not.toContain(modelLabel('sharingControlledByParent'));
  });

  it('saves the accepted default as an EXPLICIT baseline on the draft', async () => {
    await openCreateDialog();
    fillAndSubmit('Visit');
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled());
    // The whole point: the key is PRESENT. An absent one is what the publish
    // door refuses, and "the runtime would have defaulted to private anyway"
    // is precisely the accident ADR-0090 D1 forbids as a baseline.
    expect(savedBody()).toHaveProperty('sharingModel', 'private');
  });

  it('saves a changed choice instead of the default', async () => {
    const trigger = await openCreateDialog();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: modelLabel('sharingPublicRead') }));
    fillAndSubmit('Visit');
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled());
    expect(savedBody()).toHaveProperty('sharingModel', 'public_read');
  });

  it('saves it as a DRAFT — creation still does not publish anything', async () => {
    await openCreateDialog();
    fillAndSubmit('Visit');
    await waitFor(() => expect(mockClient.save).toHaveBeenCalled());
    const call = mockClient.save.mock.calls.at(-1) as unknown as [string, string, unknown, { mode?: string }];
    expect(call[3]?.mode).toBe('draft');
  });
});
