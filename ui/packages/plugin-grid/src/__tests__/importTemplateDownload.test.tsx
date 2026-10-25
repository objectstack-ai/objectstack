/**
 * 「下载模板」 requests the SERVER's import template (objectui#9600).
 *
 * The wizard used to build a CSV of every field it was handed (system and
 * read-only columns included), so the template taught users to fill columns
 * the server strips on import. The template is now the server's own
 * (`GET /data/:object/export?template=true`, reached through the data source's
 * `downloadImportTemplate`), and the wizard builds none.
 *
 * Pinned here, against the real wizard and the real `PermissionProvider`:
 *  - who is offered the button: a data source that can fetch the template AND
 *    a user who can create records of the object (the server answers 403 to
 *    anyone else);
 *  - what a click does: one request for this object, saved as `.xlsx`;
 *  - what a refusal shows: 403 and 405 each get their own message, and no
 *    file is produced (there is no client-side fallback).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';

import { ImportWizard, IMPORT_DEFAULT_TRANSLATIONS } from '../ImportWizard';

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email' },
];

const ROLES: RoleDefinition[] = [
  { name: 'editor', label: 'Editor' },
  { name: 'reader', label: 'Reader' },
];
const PERMISSIONS: ObjectPermissionConfig[] = [
  {
    object: 'contact',
    roles: {
      editor: { actions: ['read', 'create'] },
      reader: { actions: ['read'] },
    },
  },
];

function renderWizard(dataSource: unknown, role?: 'editor' | 'reader') {
  const wizard = (
    <ImportWizard
      objectName="contact"
      objectLabel="Contact"
      fields={FIELDS}
      dataSource={dataSource}
      open
      onOpenChange={() => {}}
    />
  );
  return render(
    role ? (
      <PermissionProvider roles={ROLES} permissions={PERMISSIONS} userRoles={[role]}>
        {wizard}
      </PermissionProvider>
    ) : wizard,
  );
}

/** A refusal shaped like the adapter's: an Error carrying `status` + `code`. */
function refusal(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

let createObjectURL: ReturnType<typeof vi.fn>;
let downloads: string[];
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:template');
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.restoreAllMocks();
});

describe('ImportWizard 「下载模板」 — the server template (objectui#9600)', () => {
  it('requests the template for this object and saves it as .xlsx', async () => {
    const blob = new Blob(['xlsx-bytes']);
    const downloadImportTemplate = vi.fn(async () => blob);
    renderWizard({ downloadImportTemplate }, 'editor');

    fireEvent.click(screen.getByTestId('import-download-template'));

    await waitFor(() => expect(downloads).toEqual(['Contact-import-template.xlsx']));
    expect(downloadImportTemplate).toHaveBeenCalledTimes(1);
    expect(downloadImportTemplate).toHaveBeenCalledWith('contact');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('keeps the data source as `this` when it calls the method', async () => {
    const source = {
      seen: [] as string[],
      async downloadImportTemplate(this: { seen: string[] }, resource: string) {
        this.seen.push(resource);
        return new Blob(['x']);
      },
    };
    renderWizard(source, 'editor');

    fireEvent.click(screen.getByTestId('import-download-template'));

    await waitFor(() => expect(source.seen).toEqual(['contact']));
  });

  it('is not offered when the data source cannot fetch a template, even with fields to map', () => {
    // The old CSV button showed whenever `fields` was non-empty. There is no
    // client-built template any more, so without the method there is nothing.
    renderWizard({}, 'editor');
    expect(screen.queryByTestId('import-download-template')).toBeNull();
    expect(screen.getByText(IMPORT_DEFAULT_TRANSLATIONS['grid.import.browseFiles'])).toBeInTheDocument();
  });

  it('is not offered to a user who cannot create records of the object', () => {
    const downloadImportTemplate = vi.fn(async () => new Blob(['x']));
    renderWizard({ downloadImportTemplate }, 'reader');
    expect(screen.queryByTestId('import-download-template')).toBeNull();
    expect(downloadImportTemplate).not.toHaveBeenCalled();
  });

  it('is offered with no PermissionProvider mounted: the server decides', () => {
    renderWizard({ downloadImportTemplate: vi.fn(async () => new Blob(['x'])) });
    expect(screen.getByTestId('import-download-template')).toBeInTheDocument();
  });

  it.each([
    ['403 PERMISSION_DENIED', refusal(403, 'PERMISSION_DENIED', "Creating records on object 'contact' is not permitted for this user"), 'grid.import.templateNotPermitted'],
    ['405 OBJECT_API_METHOD_NOT_ALLOWED', refusal(405, 'OBJECT_API_METHOD_NOT_ALLOWED', "API operation 'import' is not allowed on object 'contact'"), 'grid.import.notAllowed'],
    ['a network failure', new TypeError('Failed to fetch'), 'grid.import.templateDownloadFailed'],
  ])('shows its message on %s and saves no file', async (_label, error, key) => {
    renderWizard({ downloadImportTemplate: vi.fn(async () => { throw error; }) }, 'editor');

    fireEvent.click(screen.getByTestId('import-download-template'));

    expect(await screen.findByText(IMPORT_DEFAULT_TRANSLATIONS[key])).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
    // The button is usable again for a retry.
    expect(screen.getByTestId('import-download-template')).toBeEnabled();
  });
});
