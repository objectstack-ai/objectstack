// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13278 — the package dialog's Dependencies row is an author-facing
 * `package name → version range` editor, not the spec form's JSON fallback.
 *
 * `ManifestSchema`'s `dependencies` is a string map, for which SchemaForm has
 * no renderer: the row used to be a raw JSON box under the developer hint
 * "widget object-fields — falling back to JSON until a custom renderer is
 * registered". The dialog now hosts `PackageDependenciesEditor` in its place.
 *
 * Pinned here, through the dialog the author uses:
 *   (a) the row renders package / version-range rows, no JSON box, no hint;
 *   (b) adding `@acme/core` → `^1.2.0` and saving in edit mode sends that map;
 *   (c) removing every row sends `{}`, which clears the row (objectui#13121);
 *   (d) a duplicate package name is flagged inline and nothing is sent;
 *   (e) CONTROL — create mode shows the same editor.
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
};

let calls: Array<{ url: string; init: RequestInit }>;

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { manifest: MANIFEST } }),
      } as Response;
    }),
  );
}

function openDialog(mode: 'create' | 'edit', manifest: ManifestRecord = MANIFEST) {
  const onSaved = vi.fn();
  render(<PackageFormDialog mode={mode} open onOpenChange={vi.fn()} manifest={manifest} onSaved={onSaved} />);
  return { onSaved };
}

/** The Dependencies editor, found by its group name. */
async function dependencies(): Promise<HTMLElement> {
  await screen.findByTestId('package-form-submit');
  return screen.getByRole('group', { name: 'Dependencies' });
}

/** Any control labelled Dependencies that is the JSON fallback's textarea. */
function jsonBoxes(): HTMLElement[] {
  return screen.queryAllByLabelText('Dependencies').filter((el) => el.tagName === 'TEXTAREA');
}

function addRow(group: HTMLElement, name: string, range: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add dependency' }));
  const names = within(group).getAllByLabelText('Package');
  const ranges = within(group).getAllByLabelText('Version range');
  fireEvent.change(names[names.length - 1], { target: { value: name } });
  fireEvent.change(ranges[ranges.length - 1], { target: { value: range } });
}

function sentPatch(): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  expect(calls[0].init.method).toBe('PATCH');
  return JSON.parse(calls[0].init.body as string);
}

beforeEach(() => {
  calls = [];
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PackageFormDialog — the Dependencies row is a key/value editor (objectui#13278)', () => {
  it('(a) renders package / version-range rows, not the JSON fallback, and no developer hint', async () => {
    openDialog('edit', { ...MANIFEST, dependencies: { 'com.acme.core': '^1.0.0' } });
    const group = await dependencies();
    expect((within(group).getByLabelText('Package') as HTMLInputElement).value).toBe('com.acme.core');
    expect((within(group).getByLabelText('Version range') as HTMLInputElement).value).toBe('^1.0.0');
    // Open the Advanced section too, so every row the spec form renders is on screen.
    fireEvent.click(screen.getByText('Advanced'));
    await screen.findByLabelText('Default datasource');
    expect(jsonBoxes()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('falling back to JSON');
  });

  it('(b) adding `@acme/core` → `^1.2.0` and saving in edit mode sends that map', async () => {
    const { onSaved } = openDialog('edit');
    addRow(await dependencies(), '@acme/core', '^1.2.0');
    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentPatch().dependencies).toEqual({ '@acme/core': '^1.2.0' });
  });

  it('(c) removing every row sends `{}`', async () => {
    const { onSaved } = openDialog('edit', {
      ...MANIFEST,
      dependencies: { 'com.acme.core': '^1.0.0', 'com.acme.billing': '~2.1.0' },
    });
    const group = await dependencies();
    for (const remove of within(group).getAllByRole('button', { name: 'Remove dependency' })) {
      fireEvent.click(remove);
    }
    expect(within(group).queryAllByLabelText('Package')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(sentPatch().dependencies).toEqual({});
  });

  it('(d) a duplicate package name is flagged inline and nothing is sent', async () => {
    openDialog('edit', { ...MANIFEST, dependencies: { 'com.acme.core': '^1.0.0' } });
    const group = await dependencies();
    addRow(group, 'com.acme.core', '^2.0.0');
    const alert = within(group).getByRole('alert');
    expect(alert.textContent).toBe('This package is already listed.');
    const submit = screen.getByTestId('package-form-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(calls).toHaveLength(0);
  });

  it('(e) CONTROL — create mode shows the same editor', async () => {
    openDialog('create');
    const group = await dependencies();
    expect(within(group).getByTestId('package-dependencies-empty').textContent).toBe('No dependencies.');
    addRow(group, '@acme/core', '^1.2.0');
    expect(within(group).getAllByLabelText('Package')).toHaveLength(1);
    expect(jsonBoxes()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('falling back to JSON');
  });
});
