// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28232 — a create form whose Name the label cannot fill says so
 * next to Name.
 *
 * The permission set's create form fills `name` from `label` through
 * `slugify`, which keeps only `[a-z0-9]`. A label written all in Chinese leaves
 * Name empty and required:
 *
 *   (a) the Name row carries one line saying the label cannot be turned into a
 *       name, and the line goes away once a Name is typed (and comes back when
 *       it is cleared again);
 *   (b) CONTROL — a label with Latin letters fills Name and shows no line, and
 *       neither does a pristine form or one whose label was cleared.
 *
 * The REAL page with the live registration (`registerBuiltinAnchors`: Label →
 * Name derive, `createFields: ['label', 'name']`) and the real served form from
 * `METADATA_FORM_REGISTRY`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { z } from 'zod';
import { getMetadataCreateSeed, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { t } from './i18n';

const NOTE = t('engine.create.nameNotDerived', 'en-US');

const PERMISSION_JSON_SCHEMA = z.toJSONSchema(getMetadataTypeSchema('permission') as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

const CLIENT = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => null),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => null),
  save: vi.fn(async (_type: string, _name: string, payload: Record<string, unknown>) => payload),
  history: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [
      {
        type: 'permission',
        label: 'Permission Set',
        domain: 'security',
        allowEnvironmentOverlay: true,
        allowRuntimeCreate: true,
        schema: PERMISSION_JSON_SCHEMA,
        form: METADATA_FORM_REGISTRY.permission,
        createSeed: getMetadataCreateSeed('permission') as Record<string, unknown>,
      },
    ],
  }),
}));

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { registerBuiltinAnchors } from './anchors';

registerDefaultMetadataSchemas();
registerBuiltinAnchors();

beforeEach(() => {
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
});

async function openNewPermissionSet() {
  render(
    <MemoryRouter initialEntries={['/metadata/permission/new']}>
      <MetadataResourceEditPage type="permission" name="" createMode />
    </MemoryRouter>,
  );
  const nameBox = (await screen.findByRole('textbox', { name: /^Name/ }, { timeout: 8000 })) as HTMLInputElement;
  const labelBox = screen.getByRole('textbox', { name: /^Label/ }) as HTMLInputElement;
  return { nameBox, labelBox };
}

/** The row hosting `control` — the field's own block in the form grid. */
function rowOf(control: HTMLElement): HTMLElement {
  return control.closest('[style*="grid-column"]') as HTMLElement;
}

const noteIn = (row: HTMLElement) => within(row).queryByTestId('schema-form-field-note');

describe('a label that cannot fill Name says so next to Name (objectstack#28232)', () => {
  it('(a) an all-Chinese label: the Name row says so until a Name is typed', async () => {
    const { nameBox, labelBox } = await openNewPermissionSet();
    fireEvent.change(labelBox, { target: { value: '销售运营' } });
    await waitFor(() => expect(noteIn(rowOf(nameBox))).toHaveTextContent(NOTE));
    expect(nameBox.value).toBe('');
    expect(screen.getAllByTestId('schema-form-field-note')).toHaveLength(1);
    expect(noteIn(rowOf(labelBox))).toBeNull();

    fireEvent.change(nameBox, { target: { value: 'sales_ops' } });
    await waitFor(() => expect(screen.queryByTestId('schema-form-field-note')).toBeNull());

    fireEvent.change(nameBox, { target: { value: '' } });
    await waitFor(() => expect(noteIn(rowOf(nameBox))).toHaveTextContent(NOTE));
  });

  it('(b) CONTROL — a label with Latin letters fills Name and says nothing; so does a pristine or cleared form', async () => {
    const { nameBox, labelBox } = await openNewPermissionSet();
    expect(screen.queryByTestId('schema-form-field-note')).toBeNull();

    fireEvent.change(labelBox, { target: { value: 'Sales 运营' } });
    await waitFor(() => expect(nameBox.value).toBe('sales'));
    expect(screen.queryByTestId('schema-form-field-note')).toBeNull();

    fireEvent.change(labelBox, { target: { value: '' } });
    await waitFor(() => expect(nameBox.value).toBe(''));
    expect(screen.queryByTestId('schema-form-field-note')).toBeNull();
  });
});
