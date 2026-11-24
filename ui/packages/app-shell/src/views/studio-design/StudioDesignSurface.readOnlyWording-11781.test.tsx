// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11781 — a read-only package says it is read-only, in the Data
 * pillar's Form view (and in the Access banner, pinned now on the permission
 * set's page, objectstack#36905).
 *
 * Measured on the showcase (a source-loaded, read-only package) in a Studio
 * browser pass: the Form view still read "Draft layout" and "Drag to reorder /
 * move across groups · click a field to edit its properties", and Access showed
 * the amber "This package's objects · saved as draft" — all edit wording on a
 * package where nothing is dragged, edited or saved.
 *
 * Each read-only case has its writable control in the same file. The wording
 * is pinned by KEY, resolved through the pillar's own table, so a copy edit
 * does not redden this file and a missing row does (`t` echoes a missing key).
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches a dynamic `import('@objectstack/lint')`; its first load is paid
// here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

// The Access pillar's siblings that play no part in its banner.
vi.mock('../../components/SuggestedBindingsPanel', () => ({
  SuggestedBindingsPanel: () => null,
}));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({
  AccessExplainPanel: () => null,
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { t, tFormat } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

afterEach(cleanup);

/**
 * The en-US row for `key`, which must exist: `t` echoes a missing key. Used for
 * what MUST render; what must not render reads plain `t`, so a writable control
 * does not depend on the read-only rows existing.
 */
function row(key: string, vars?: Record<string, string>): string {
  const text = vars ? tFormat(key, 'en-US', vars) : t(key, 'en-US');
  expect(t(key, 'en-US'), `no en-US row for ${key}`).not.toBe(key);
  return text;
}
const absent = (key: string) => t(key, 'en-US');

/** Render the Data pillar and open Form; its Layout sub-view is the default. */
async function openForm(readOnly: boolean): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" readOnly={readOnly} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: row('engine.studio.data.tab.form') }));
  return (await screen.findByText('Title')).closest('[role="button"]') as HTMLElement;
}

describe('Data pillar Form view — a read-only package reads as read-only (objectui#11781)', () => {
  // objectui#12451 — the layout caption is the Layout item's title, and the
  // writable hint is the Form toolbar's. objectui#12453 — on a read-only
  // package the layout's sentence is the header link's title, and what a
  // click still does is the field card's.
  it('read-only: the header link carries the layout sentence, and the field card says read-only', async () => {
    const card = await openForm(true);

    const link = screen.getByTestId('studio-readonly-link');
    expect(link).toHaveAttribute('title', row('engine.studio.data.form.layoutBadgeReadOnly'));
    expect(screen.getByRole('button', { name: row('engine.studio.data.form.layout') })).not.toHaveAttribute('title');
    expect(screen.queryByTitle(absent('engine.studio.data.form.layoutBadgeClean'), { exact: true })).toBeNull();
    expect(screen.queryByTitle(absent('engine.studio.data.form.layoutBadge'))).toBeNull();

    expect(screen.queryByText(absent('engine.studio.designer.toolbarHint'))).toBeNull();

    expect(card).toHaveAttribute('aria-label', row('engine.studio.designer.fieldAriaReadOnly', { label: 'Title' }));
    expect(card).toHaveAttribute('title', row('engine.studio.designer.fieldTitleReadOnly'));
    expect(card).not.toHaveClass('cursor-grab');

    // A click still opens the field's aside; it says nothing about drafts.
    fireEvent.click(card);
    expect(await screen.findByTestId('data-field-inspector')).toBeInTheDocument();
    expect(screen.queryByText(absent('engine.studio.inspector.draftFooter'))).toBeNull();
  });

  it('CONTROL — writable: the draft caption, the drag hint and a draggable card', async () => {
    const card = await openForm(false);

    expect(screen.getByTitle(row('engine.studio.data.form.layoutBadgeClean'), { exact: true })).toBeInTheDocument();
    expect(screen.queryByTitle(absent('engine.studio.data.form.layoutBadgeReadOnly'))).toBeNull();
    expect(screen.queryByTestId('studio-readonly-link')).toBeNull();

    expect(screen.getByText(row('engine.studio.designer.toolbarHint'))).toBeInTheDocument();

    expect(card).toHaveAttribute('aria-label', row('engine.studio.designer.fieldAria', { label: 'Title' }));
    expect(card).not.toHaveAttribute('title');
    expect(card).toHaveClass('cursor-grab');

    fireEvent.click(card);
    const aside = await screen.findByTestId('data-field-inspector');
    expect(aside).toHaveTextContent(row('engine.studio.inspector.draftFooter'));
  });
});

// objectstack#36905 — the Access pillar's banner pins moved with the banner to the permission
// set's full-screen page (`StudioPermissionSetPage.fullScreen-36905.test.tsx`).
