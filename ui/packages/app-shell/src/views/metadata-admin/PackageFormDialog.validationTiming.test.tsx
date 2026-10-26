// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `新建软件包` opened with its two required fields ALREADY failing, before a
 * single keystroke — objectui#5416 defect 1, measured on a 17.1.0 dogfood
 * walkthrough. The create draft is `{ version, type }`, so
 * `ManifestSchema.safeParse` reported `name` and `id` missing on the very
 * first render, and the dialog then jumped a line height per field as each
 * error cleared (enough, the card notes, to make a click land on the wrong
 * control while filling the form top to bottom).
 *
 * `SchemaForm` now defers the error LINE to first touch on a create form. The
 * cases below pin that the deferral is DISPLAY-ONLY — the submit button stays
 * gated on the same validation, and an edit form (whose issues describe stored
 * values, not something half-typed) still reports from mount.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PackageFormDialog } from './PackageFormDialog';

let localeFixture: 'en-US' | 'zh-CN' = 'zh-CN';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

beforeEach(() => {
  localeFixture = 'zh-CN';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }) as Response),
  );
});
afterEach(() => vi.unstubAllGlobals());

/**
 * Every rendered validation line, by testid rather than by Tailwind class —
 * the required-field asterisk is `text-destructive` too, and it is NOT what
 * this card is about (the star is a correct, static obligation marker; the red
 * sentence claiming the author typed something wrong is the defect).
 */
const issueLines = () =>
  screen.queryAllByTestId('schema-form-issue').map((n) => n.textContent ?? '');

describe('PackageFormDialog — validation timing (objectui#5416 defect 1)', () => {
  it('renders no validation error before the author has touched anything', async () => {
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
    await screen.findByTestId('package-form');

    // Before the fix this was two lines — `name` and `id` both missing from
    // the `{ version, type }` create default, both reported by
    // `ManifestSchema.safeParse` on the very first render.
    expect(issueLines()).toEqual([]);
  });

  it('still gates the submit button on the same validation (the rule did not move)', async () => {
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
    await screen.findByTestId('package-form');

    // The whole point: hiding the red line must not hide the requirement.
    expect(screen.getByTestId('package-form-submit')).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/软件包 ID/), { target: { value: 'com.acme.crm' } });
    fireEvent.change(screen.getByLabelText(/显示名称/), { target: { value: 'Acme CRM' } });

    await waitFor(() => expect(screen.getByTestId('package-form-submit')).toBeEnabled());
  });

  it('reports the field once it has been blurred', async () => {
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
    await screen.findByTestId('package-form');

    fireEvent.blur(screen.getByLabelText(/显示名称/));

    // Exactly one line — the field the author actually left, not the whole form.
    await waitFor(() => expect(issueLines()).toHaveLength(1));
  });

  it('reports the field once the author has edited it (typed an invalid value)', async () => {
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
    await screen.findByTestId('package-form');

    // Typing then clearing leaves the field invalid AND touched.
    const name = screen.getByLabelText(/显示名称/);
    fireEvent.change(name, { target: { value: 'x' } });
    fireEvent.change(name, { target: { value: '' } });

    await waitFor(() => expect(issueLines()).toHaveLength(1));
  });

  it('an EDIT form still reports stored-value issues from mount', async () => {
    // `name` missing from a manifest that already exists is a real diagnostic
    // about persisted metadata, not noise about something half-typed — the
    // deferral must not reach it.
    render(
      <PackageFormDialog
        mode="edit"
        open
        onOpenChange={vi.fn()}
        manifest={{ id: 'com.acme.crm', version: '1.0.0', type: 'app' }}
      />,
    );
    await screen.findByTestId('package-form');

    await waitFor(() => expect(issueLines().length).toBeGreaterThan(0));
  });
});
