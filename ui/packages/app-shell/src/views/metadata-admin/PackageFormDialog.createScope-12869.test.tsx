// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The new-package form offers no `scope` (objectui#12869).
 *
 * The form is derived from `ManifestSchema`, whose `scope` offers `cloud`,
 * `system` and `project`. The install door, `POST /api/v1/packages`, defaults
 * `scope` to `project` and refuses the other two with a 400
 * (objectstack#24160). So create mode draws no `scope` row and its POST body
 * carries none, while edit and view keep the row, read-only, because an
 * existing package's scope can be `cloud` or `system`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PackageFormDialog } from './PackageFormDialog';
import { getPackageForm } from './package-schema';
import { t } from './i18n';

// The one stand-in: a create form that still carries the `scope` row, so a
// draft can hold a picked scope and the POST body is measured on its own.
let createFormHasScopeRow = false;
vi.mock('./package-schema', async (importOriginal) => {
  const real = await importOriginal<typeof import('./package-schema')>();
  return {
    ...real,
    getPackageForm: (locale: string, opts?: { create?: boolean }) =>
      real.getPackageForm(locale, createFormHasScopeRow ? {} : opts),
  };
});

const LOCALE = 'en-US';
const SCOPE = t('engine.packages.form.scope', LOCALE);
const ADVANCED = t('engine.packages.form.advanced', LOCALE);

let posts: Array<Record<string, unknown>>;

beforeEach(() => {
  createFormHasScopeRow = false;
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit = {}) => {
      const body = init.body ? JSON.parse(init.body as string) : {};
      posts.push(body.manifest ?? body);
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ success: true, data: { manifest: body.manifest } }),
      } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function fieldNames(locale: string, opts?: { create?: boolean }): string[] {
  return (getPackageForm(locale, opts).sections ?? []).flatMap((s) =>
    (s.fields ?? []).map((f) => (typeof f === 'string' ? f : f.field)),
  );
}

async function openAdvanced() {
  fireEvent.click(await screen.findByText(ADVANCED));
  // The section really opened: its first row is drawn.
  await screen.findByText(t('engine.packages.form.defaultDatasource', LOCALE));
}

describe('the curated package form view (objectui#12869)', () => {
  it('drops only the scope row in create mode', () => {
    const existing = fieldNames(LOCALE);
    const create = fieldNames(LOCALE, { create: true });
    expect(existing).toContain('scope');
    expect(create).not.toContain('scope');
    expect(create).toEqual(existing.filter((f) => f !== 'scope'));
  });
});

describe('PackageFormDialog create mode offers no scope (objectui#12869)', () => {
  it('renders no scope control in the Advanced section', async () => {
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
    await openAdvanced();
    expect(screen.queryByText(SCOPE)).toBeNull();
    expect(screen.queryByRole('combobox', { name: SCOPE })).toBeNull();
  });

  it('POSTs no scope, even when the draft held one', async () => {
    createFormHasScopeRow = true;
    const onSaved = vi.fn();
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(await screen.findByLabelText(t('engine.packages.create.name', LOCALE), { exact: false }), {
      target: { value: 'Scope Probe' },
    });
    await openAdvanced();

    const trigger = screen.getByRole('combobox', { name: SCOPE });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const options = within(await screen.findByRole('listbox')).getAllByRole('option');
    const cloud = options.find((o) => /cloud/i.test(o.textContent ?? ''));
    expect(cloud, options.map((o) => o.textContent).join(' | ')).toBeDefined();
    fireEvent.click(cloud!);
    await waitFor(() => expect(trigger).toHaveTextContent(/cloud/i));

    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ name: 'Scope Probe', type: 'app' });
    expect(posts[0]).not.toHaveProperty('scope');
  });
});

describe('PackageFormDialog edit and view keep scope, read-only (objectui#12869)', () => {
  for (const scope of ['cloud', 'project'] as const) {
    for (const mode of ['edit', 'view'] as const) {
      it(`${mode} shows a ${scope} package's scope, locked`, async () => {
        const manifest = { id: `com.acme.${scope}`, name: 'Acme', version: '1.0.0', type: 'app', scope };
        render(<PackageFormDialog mode={mode} open onOpenChange={vi.fn()} manifest={manifest} />);
        await openAdvanced();
        const trigger = screen.getByRole('combobox', { name: SCOPE });
        expect(trigger).toBeDisabled();
        expect(trigger).toHaveTextContent(new RegExp(scope, 'i'));
      });
    }
  }
});
