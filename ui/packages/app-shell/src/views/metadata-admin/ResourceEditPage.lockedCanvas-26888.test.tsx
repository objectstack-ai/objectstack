// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26888 — a locked item's designer canvas is read-only.
 *
 * The page learns the lock from the layered read (`editable: false`) and keeps
 * Save, the form and the inspectors read-only on it, but it handed the
 * registered preview an `onPatch` unconditionally. The object canvas derives
 * its read-only state from `onPatch` alone, so on a locked object it offered
 * Add field, Add field to this section, Move section and Remove section: the
 * edit landed in the draft, the inspector said "Unsaved", and no Save existed
 * to keep it. The fix passes no `onPatch` when the page cannot write the item,
 * the preview contract Studio already follows for a read-only package
 * (objectui#11136).
 *
 * The unlocked case is the control: the same object, writable, still gets
 * every control, so a red locked case is the defect and not a harness that
 * never mounted the canvas.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const OBJECT = {
  name: 'crm_account',
  label: 'Account',
  fields: {
    account_name: { type: 'text', label: 'Account Name', group: 'basics' },
    website: { type: 'url', label: 'Website', group: 'basics' },
    notes: { type: 'textarea', label: 'Notes', group: 'details' },
  },
  fieldGroups: [
    { key: 'basics', label: 'Basics' },
    { key: 'details', label: 'Details' },
  ],
};

const layered = vi.hoisted(() => ({ editable: true }));

const client = vi.hoisted(() => ({
  list: async () => [],
  listDrafts: async () => [],
  get: async () => null,
  getDraft: async () => null,
  references: async () => [],
  layered: async () => ({
    code: OBJECT,
    overlay: null,
    overlayScope: null,
    effective: OBJECT,
    lock: layered.editable ? 'none' : 'full',
    provenance: 'package',
    packageId: 'app.objectstack.hotcrm',
    editable: layered.editable,
    deletable: layered.editable,
  }),
}));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        {
          type: 'object',
          name: 'object',
          label: 'Object',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } } },
        },
      ],
    }),
  };
});

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { MetadataResourceEditPage } from './ResourceEditPage';
import './register-builtins';
// The built-in designers (the Object canvas among them), which the package
// entry registers from a chunk it loads with a dynamic `import()`: called at
// module scope so they are registered before the first render.
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

afterEach(() => {
  cleanup();
  layered.editable = true;
});

async function openObject(editable: boolean) {
  layered.editable = editable;
  render(
    <MemoryRouter initialEntries={['/metadata/object/crm_account']}>
      <MetadataResourceEditPage type="object" name="crm_account" />
    </MemoryRouter>,
  );
  // The canvas is up once its first section header shows.
  expect(await screen.findByText('Basics', {}, { timeout: 8000 })).toBeInTheDocument();
}

const CANVAS_WRITES = [
  'Add field to this section',
  'Move section up',
  'Move section down',
  'Remove section',
];

describe('Setup object designer — a locked item gets a read-only canvas (objectstack#26888)', () => {
  it('control: a writable object offers the canvas add / move / remove controls', async () => {
    await openObject(true);
    for (const name of CANVAS_WRITES) {
      expect(screen.queryAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('button', { name: 'Add field' })).toBeInTheDocument();
  });

  it('a locked object offers none of them, and nothing reads "Unsaved"', async () => {
    await openObject(false);
    expect(await screen.findByTestId('lock-banner-title')).toBeInTheDocument();
    for (const name of CANVAS_WRITES) {
      expect(screen.queryAllByRole('button', { name })).toEqual([]);
    }
    expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull();
    expect(screen.queryByText('Unsaved')).toBeNull();
  });
});
