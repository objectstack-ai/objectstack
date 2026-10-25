// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13121 — the package EDIT dialog edits `dependencies`.
 *
 * `PATCH /api/v1/packages/:id` accepts the manifest's `dependencies` row
 * (objectstack#24670): judged by `ManifestSchema`'s row, a malformed row
 * refused `400 VALIDATION_ERROR`, the row replacing the stored one whole, `{}`
 * clearing it, and a read-only package refused `422 WRITABLE_PACKAGE_REQUIRED`
 * (objectstack#24705). The dialog used to mark the row `immutable` and PATCH
 * only name / description / version, so a save refusal's "declare a dependency
 * in the `dependencies` of P's manifest" remedy had no door in Studio.
 *
 * Pinned here, through the dialog the author uses:
 *   (a) a changed row rides the PATCH beside the three keys, flat;
 *   (b) an untouched row is not sent (nor one only re-ordered);
 *   (c) an emptied editor sends `{}`, which clears the row;
 *   (d) the door's 400 and 422 render in the dialog, which stays open;
 *   (e) CONTROL — every other `immutable` row stays read-only in edit mode.
 *
 * The row renders through the dialog's key/value editor for the
 * `dependencies` string map (objectui#13278), found by its group name.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { PackageFormDialog, type ManifestRecord } from './PackageFormDialog';

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

const MANIFEST: ManifestRecord = {
  id: 'com.acme.crm',
  name: 'Acme CRM',
  version: '1.0.0',
  description: 'old',
  type: 'app',
  namespace: 'crm',
  defaultDatasource: 'default',
  scope: 'project',
  dependencies: { 'com.acme.core': '^1.0.0', 'com.acme.billing': '~2.1.0' },
};

let calls: Array<{ url: string; init: RequestInit }>;

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      } as Response;
    }),
  );
}

const OK = { success: true, data: { manifest: MANIFEST } };

function openEdit(manifest: ManifestRecord = MANIFEST) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(<PackageFormDialog mode="edit" open onOpenChange={onOpenChange} manifest={manifest} onSaved={onSaved} />);
  return { onSaved, onOpenChange };
}

/** The dependencies editor (objectui#13278), found by its group name. */
async function dependenciesEditor(): Promise<HTMLElement> {
  await screen.findByTestId('package-form-submit');
  return screen.getByRole('group', { name: 'Dependencies' });
}

/** The editor's package-name inputs, in row order. */
function nameInputs(editor: HTMLElement): HTMLInputElement[] {
  return within(editor).queryAllByLabelText('Package') as HTMLInputElement[];
}

/** Set the range of the row whose package is `name`. */
function setRange(editor: HTMLElement, name: string, range: string) {
  const i = nameInputs(editor).findIndex((el) => el.value === name);
  expect(i, name).toBeGreaterThanOrEqual(0);
  fireEvent.change(within(editor).getAllByLabelText('Version range')[i], { target: { value: range } });
}

/** Remove the row whose package is `name`. */
function removeRow(editor: HTMLElement, name: string) {
  const i = nameInputs(editor).findIndex((el) => el.value === name);
  expect(i, name).toBeGreaterThanOrEqual(0);
  fireEvent.click(within(editor).getAllByRole('button', { name: 'Remove dependency' })[i]);
}

/** Append a row. */
function addRow(editor: HTMLElement, name: string, range: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add dependency' }));
  const names = nameInputs(editor);
  fireEvent.change(names[names.length - 1], { target: { value: name } });
  const ranges = within(editor).getAllByLabelText('Version range');
  fireEvent.change(ranges[ranges.length - 1], { target: { value: range } });
}

function sentBody(): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('/api/v1/packages/com.acme.crm');
  expect(calls[0].init.method).toBe('PATCH');
  return JSON.parse(calls[0].init.body as string);
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PackageFormDialog edit — `dependencies` is editable and sent on change (objectui#13121)', () => {
  it('(a) a changed row rides the PATCH beside name / description / version, flat', async () => {
    stubFetch(200, OK);
    const { onSaved } = openEdit();
    const editor = await dependenciesEditor();
    expect(nameInputs(editor)[0].readOnly).toBe(false);
    removeRow(editor, 'com.acme.billing');
    setRange(editor, 'com.acme.core', '^2.0.0');
    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({
      name: 'Acme CRM',
      description: 'old',
      version: '1.0.0',
      dependencies: { 'com.acme.core': '^2.0.0' },
    });
  });

  it('(b) an untouched row is not sent', async () => {
    stubFetch(200, OK);
    const { onSaved } = openEdit();
    await dependenciesEditor();
    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ name: 'Acme CRM', description: 'old', version: '1.0.0' });
  });

  it('(b) the same entries in another order are no edit, so the row is not sent', async () => {
    stubFetch(200, OK);
    const { onSaved } = openEdit();
    const editor = await dependenciesEditor();
    // Remove the first row and add it back last: same entries, other order.
    removeRow(editor, 'com.acme.core');
    addRow(editor, 'com.acme.core', '^1.0.0');
    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentBody()).not.toHaveProperty('dependencies');
  });

  it('(b) a package that declares no row, left untouched, sends none', async () => {
    stubFetch(200, OK);
    const { dependencies: _none, ...withoutRow } = MANIFEST;
    const { onSaved } = openEdit(withoutRow);
    await dependenciesEditor();
    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentBody()).not.toHaveProperty('dependencies');
  });

  it('(c) emptying the editor sends `{}`, which clears the row', async () => {
    stubFetch(200, OK);
    const { onSaved } = openEdit();
    const editor = await dependenciesEditor();
    removeRow(editor, 'com.acme.core');
    removeRow(editor, 'com.acme.billing');
    expect(nameInputs(editor)).toHaveLength(0);
    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentBody()).toEqual({ name: 'Acme CRM', description: 'old', version: '1.0.0', dependencies: {} });
  });
});

describe('PackageFormDialog edit — the door refusals render in the dialog (objectui#13121)', () => {
  const VALIDATION = {
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message:
        'Invalid package dependencies — dependencies.com.acme.core: Invalid input: expected string, received number.',
    },
  };
  const READ_ONLY = {
    success: false,
    error: {
      code: 'WRITABLE_PACKAGE_REQUIRED',
      message: "[writable_package_required] Cannot edit package 'com.acme.crm': it is read-only.",
    },
  };

  it.each([
    ['400 VALIDATION_ERROR', 400, VALIDATION, 'VALIDATION_ERROR'],
    ['422 WRITABLE_PACKAGE_REQUIRED', 422, READ_ONLY, 'WRITABLE_PACKAGE_REQUIRED'],
  ])('(d) %s renders in the banner and the dialog stays open', async (_name, status, body, code) => {
    stubFetch(status, body);
    const { onSaved, onOpenChange } = openEdit();
    const editor = await dependenciesEditor();
    setRange(editor, 'com.acme.core', '^2.0.0');
    fireEvent.click(screen.getByTestId('package-form-submit'));
    const banner = await screen.findByTestId('package-form-error');
    expect(banner.textContent).toBe(`${body.error.message} (${code})`);
    expect(sentBody()).toHaveProperty('dependencies');
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('PackageFormDialog edit — CONTROL: the other immutable rows stay locked (objectui#13121)', () => {
  it('(e) id / namespace / defaultDatasource are read-only and type / scope are disabled', async () => {
    stubFetch(200, OK);
    openEdit();
    const editor = await dependenciesEditor();
    // The immutable rows sit in the collapsed Advanced section.
    fireEvent.click(screen.getByText('Advanced'));
    await screen.findByLabelText('Default datasource');
    // The spec form gives each row the control id `mdf-FIELD`.
    for (const id of ['mdf-id', 'mdf-namespace', 'mdf-defaultDatasource']) {
      expect((document.getElementById(id) as HTMLInputElement).readOnly, id).toBe(true);
    }
    for (const id of ['mdf-type', 'mdf-scope']) {
      expect((document.getElementById(id) as HTMLButtonElement).disabled, id).toBe(true);
    }
    // The positive half of the same reading: name, version and the row this
    // card unlocked are editable.
    for (const id of ['mdf-name', 'mdf-version']) {
      expect((document.getElementById(id) as HTMLInputElement).readOnly, id).toBe(false);
    }
    for (const input of nameInputs(editor)) expect(input.readOnly).toBe(false);
  });
});
