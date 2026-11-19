// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35499 — the page half of placing a refused save's issues on the
 * deepest row their path names (the form half is pinned in
 * `SchemaForm.nestedIssuePlacement-35499.test.tsx`):
 *
 *   4. the refusal line and the summary banner test an issue's path HEAD
 *      against the form's inline register, the key the form places it by —
 *      so a nested cause the form draws is one message (objectstack#27865),
 *      and a head no row renders keeps its banner line;
 *   5. the Save button's refusal reason skips the root slice's empty label,
 *      and a refusal held only at the root says the root entry's message.
 *
 * The real page over a mock client whose `save` rejects with a REAL parsed
 * `MetadataError` (the client's own `parseError` over a stub transport). The
 * live client pass is stubbed to "a validator exists, the draft is clean", so
 * every issue on screen is the server's.
 */

import '@testing-library/jest-dom/vitest';
// The source loads these lazily; pay that load at collection, not inside a
// case's clocked window.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

const VIEW = {
  name: 'task_list',
  label: 'Tasks',
  options: { dialect: 'cel', source: 'true' },
  columns: [{ field: 'title', width: 120 }],
};

const VIEW_FORM_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', title: 'Name' },
    label: { type: 'string', title: 'Label' },
    options: {
      type: 'object',
      title: 'Options',
      properties: { dialect: { type: 'string', title: 'Dialect' }, source: { type: 'string', title: 'Source' } },
    },
    columns: {
      type: 'array',
      title: 'Columns',
      items: { type: 'object', properties: { field: { type: 'string' }, width: { type: 'number' } } },
    },
  },
};

async function refusal(issues: Array<{ path: string; message: string }>): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: `[invalid_metadata] view/task_list failed spec validation: ${issues.length} issue(s)`,
          code: 'INVALID_METADATA',
          issues: issues.map((i) => ({ ...i, code: 'custom' })),
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch,
  });
  try {
    await client.save('view', 'task_list', {});
  } catch (e) {
    return e as MetadataError;
  }
  throw new Error('the stub transport accepted the save: there is no refusal to hand the page');
}

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: VIEW, code: VIEW, editable: true })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  saveDraft: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      entries: [
        { type: 'view', name: 'view', label: 'View', allowEnvironmentOverlay: true, schema: VIEW_FORM_SCHEMA },
      ],
    }),
  };
});

// A validator exists and finds nothing: the banner and the refusal line read
// the server's issues, and the live pass never replaces them.
vi.mock('./clientValidation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./clientValidation')>();
  return {
    ...mod,
    hasClientValidator: () => true,
    validateMetadataDraft: async () => ({ ok: true, issues: [] }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { getMetadataPreview } from './preview-registry';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

const saveButton = () => screen.getByTestId('resource-save');
/** A withheld Save's reason (its accessible description), else its title. */
const saveSays = () => {
  const btn = saveButton();
  const id = btn.getAttribute('aria-describedby');
  return (id ? document.getElementById(id)?.textContent : null) ?? btn.getAttribute('title') ?? '';
};
const lines = () => screen.queryAllByTestId('schema-form-issue').map((el) => el.textContent);

/** Open the form editor, make it dirty, and Save into `issues`' refusal. */
async function refuseSave(issues: Array<{ path: string; message: string }>) {
  mockClient.save.mockRejectedValue(await refusal(issues));
  render(
    <MemoryRouter initialEntries={['/metadata/view/task_list']}>
      <MetadataResourceEditPage type="view" name="task_list" />
    </MemoryRouter>,
  );
  // The header and the read-only body both offer Edit; either enters editing.
  fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }, { timeout: 8000 }))[0]!);
  fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Open tasks' } });
  // Past the live pass's 200 ms debounce, so it cannot land after the refusal.
  await new Promise((r) => setTimeout(r, 400));
  fireEvent.click(saveButton());
  await waitFor(() => expect(mockClient.save).toHaveBeenCalled(), { timeout: 6000 });
  await waitFor(() => expect(saveSays()).toContain('The server refused this draft'), { timeout: 6000 });
}

describe('harness', () => {
  it('renders the plain form (no designer registered for `view` here)', () => {
    expect(getMetadataPreview('view')).toBeUndefined();
  });
});

describe('step 4 — one message per mistake on a nested path (objectstack#27865)', () => {
  it('draws each nested cause once, under its row, and repeats it in neither the banner nor the refusal line', async () => {
    await refuseSave([
      { path: 'label.not_a_locale', message: 'Unrecognized locale key' },
      { path: 'options.dialect', message: 'Unknown dialect' },
      { path: 'columns.0.field', message: 'Unknown column field' },
    ]);
    await waitFor(() =>
      expect(lines()).toEqual([
        'Label → not_a_locale: Unrecognized locale key',
        'Unknown dialect',
        'Columns → #1 → field: Unknown column field',
      ]),
    );
    expect(within(screen.getByRole('group', { name: 'Options' })).getByTestId('schema-form-issue')).toHaveTextContent(
      'Unknown dialect',
    );
    for (const message of ['Unrecognized locale key', 'Unknown dialect', 'Unknown column field']) {
      expect(screen.getAllByText(message, { exact: false })).toHaveLength(1);
    }
    expect(screen.queryByTestId('metadata-validation-banner')).toBeNull();
    expect(screen.queryByTestId('resource-edit-error')).toBeNull();
  }, 20000);

  it('keeps a cause whose head no row renders in the banner, beside a nested cause drawn inline', async () => {
    await refuseSave([
      { path: 'label.not_a_locale', message: 'Unrecognized locale key' },
      { path: 'zz_unknown.deeper', message: 'Not a view key' },
    ]);
    const banner = await screen.findByTestId('metadata-validation-banner', {}, { timeout: 6000 });
    expect(banner).toHaveTextContent('Not a view key');
    expect(banner).not.toHaveTextContent('Unrecognized locale key');
    expect(lines()).toEqual(['Label → not_a_locale: Unrecognized locale key']);
  }, 20000);
});

describe('step 5 — the Save reason never starts with a comma', () => {
  it('a refusal held only at the root says the root entry’s message', async () => {
    await refuseSave([{ path: '', message: 'Unrecognized key: "zz"' }]);
    expect(saveSays()).toContain('fix Unrecognized key: "zz" before saving');
  }, 20000);

  it('a root entry beside a located one names only the located slice', async () => {
    await refuseSave([
      { path: '', message: 'Unrecognized key: "zz"' },
      { path: 'label.not_a_locale', message: 'Unrecognized locale key' },
    ]);
    expect(saveSays()).toContain('fix Label → not_a_locale before saving');
    expect(saveSays()).not.toMatch(/fix\s*,/);
  }, 20000);
});
