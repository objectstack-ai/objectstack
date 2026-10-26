// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12303 row 3 — on a read-only package, the Data pillar's "Field
 * properties" rail says why its controls are disabled, on hover, on focus and
 * to assistive tech.
 *
 * Measured on the card: the rail's API name / Label / Type / Required /
 * Unique / Description / Default value inputs and the Remove button were all
 * disabled with no `title`, no `aria-describedby` and no note beside them — a
 * disabled input takes neither hover nor focus, so Tab skipped the rail and
 * nothing in it said why. The rail body now carries the record page's Archive
 * pattern (`DeclaredActionsBar`, objectui#11811) with the package's read-only
 * reason, `engine.studio.pkg.readonlyHint`: a tab stop described by an
 * `sr-only` copy of the reason, and the trigger of a tooltip that shows it.
 *
 * The rail holds the REAL registered `ObjectFieldInspector`, so the disabled
 * controls asserted on are the shipped ones. The writable control is in the
 * same file.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const objectDef = {
  name: 'showcase_task',
  label: 'Task',
  fields: [{ name: 'priority', label: 'Priority', type: 'text' }],
};

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => (type === 'object' ? [{ name: 'showcase_task', label: 'Task' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: objectDef, code: objectDef })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { ObjectFieldInspector } from '../metadata-admin/inspectors/ObjectFieldInspector';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataInspector('object', ObjectFieldInspector);

afterEach(cleanup);

const L = (key: string) => t(key, 'en-US');
const REASON = L('engine.studio.pkg.readonlyHint');

/** The element an `aria-describedby` names, or `null`. */
const describedBy = (el: HTMLElement) => {
  const id = el.getAttribute('aria-describedby');
  return id ? document.getElementById(id) : null;
};

/** Render the pillar, open Form, select the Priority field, and return the open rail. */
async function openRail(readOnly: boolean): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={['/studio/com.example.showcase/data']}>
      <DataPillar packageId="com.example.showcase" readOnly={readOnly} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: L('engine.studio.data.tab.form') }));
  const card = (await screen.findByText('Priority')).closest('[role="button"]') as HTMLElement;
  fireEvent.click(card);
  const rail = await waitFor(() => {
    const el = screen.getByRole('complementary');
    expect(el).toHaveTextContent(L('engine.studio.data.fieldProps'));
    return el;
  });
  // The shipped inspector is mounted: its API-name control carries the field's name.
  expect(await within(rail).findByDisplayValue('priority', undefined, { timeout: 8000 })).toBeInTheDocument();
  return rail;
}

describe('Data pillar Field properties on a read-only package — the reason reaches the author (objectui#12303)', () => {
  it('the rail body is described by the read-only reason, and holds the disabled controls', async () => {
    const rail = await openRail(true);
    const body = rail.querySelector('[data-disabled-reason]') as HTMLElement;
    expect(body).not.toBeNull();
    expect(describedBy(body)).toHaveTextContent(REASON);
    // Named by the rail's title, so the tab stop is not an anonymous group.
    expect(body).toHaveAccessibleName(L('engine.studio.data.fieldProps'));

    const apiName = within(body).getByDisplayValue('priority');
    expect(apiName).toBeDisabled();
    const remove = within(body).getByRole('button', { name: /^Remove/ });
    expect(remove).toBeDisabled();
  });

  it('hovering the disabled controls opens a tooltip with the reason', async () => {
    const user = userEvent.setup();
    const rail = await openRail(true);
    const body = rail.querySelector('[data-disabled-reason]') as HTMLElement;
    await user.hover(body);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });

  it('a keyboard user reaches the reason: Tab from the rail’s close button lands on the described body, which opens the tooltip', async () => {
    const user = userEvent.setup();
    const rail = await openRail(true);
    const body = rail.querySelector('[data-disabled-reason]') as HTMLElement;
    // The rail header's own close button (the inspector inside has one too).
    within(rail.querySelector('header') as HTMLElement).getByRole('button', { name: L('engine.studio.close') }).focus();
    await user.tab();
    expect(body).toHaveFocus();
    expect(describedBy(body)).toHaveTextContent(REASON);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
  });

  it('CONTROL — a writable package: the controls are live and the rail gives no read-only reason', async () => {
    const rail = await openRail(false);
    expect(rail.querySelector('[data-disabled-reason]')).toBeNull();
    expect(within(rail).getByDisplayValue('priority')).toBeEnabled();
    expect(screen.queryByText(REASON)).toBeNull();
  });
});
