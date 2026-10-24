// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * New package: the display name comes first and the fields filled in from it
 * are replaced on edit, not appended to (objectui#12512).
 *
 * Measured on the card: typing `Studio Test` filled the id and the namespace,
 * Version came prefilled `0.1.0`, and clicking into the namespace and typing
 * `st` produced `studio_testst` (Version: `0.1.00.1.0`) — the caret landed at
 * the end of a value the author never typed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackageFormDialog } from './PackageFormDialog';
import { t, tFormat } from './i18n';

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 201, text: async () => '{"success":true,"data":{}}' }) as Response),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openCreate() {
  render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
  const byLabel = (key: string) =>
    screen.getByLabelText(t(key, 'en-US'), { exact: false }) as HTMLInputElement;
  return {
    name: () => byLabel('engine.packages.create.name'),
    id: () => byLabel('engine.packages.create.id'),
    ns: () => byLabel('engine.packages.create.namespace'),
    version: () => byLabel('engine.packages.create.version'),
    submit: () => screen.getByTestId('package-form-submit'),
    mark: (field: 'id' | 'namespace' | 'version') => screen.queryByTestId(`package-form-${field}-derived`),
  };
}

describe('New package form: display name first (objectui#12512)', () => {
  it('opens on the display name, with the id, namespace and version after it in the same card', () => {
    const f = openCreate();
    const card = screen.getByTestId('package-form-basics');
    const inputs = within(card).getAllByRole('textbox');
    const order = [f.name(), f.id(), f.ns(), f.version()].map((el) => inputs.indexOf(el));
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('typing a display name fills the id, namespace and version, each marked until edited', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    expect(f.id().value).toBe('com.studio-test');
    expect(f.ns().value).toBe('studio_test');
    expect(f.version().value).toBe('0.1.0');
    expect(f.mark('id')).toBeInTheDocument();
    expect(f.mark('namespace')).toBeInTheDocument();
    expect(f.mark('version')).toBeInTheDocument();
  });
});

describe('a derived field is replaced on edit, not appended to (objectui#12512)', () => {
  it('focusing a derived field selects its whole value', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    for (const el of [f.id(), f.ns(), f.version()]) {
      el.focus();
      expect([el.selectionStart, el.selectionEnd]).toEqual([0, el.value.length]);
    }
  });

  it('clicking into the namespace and typing replaces it, and clears that mark only', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    await user.click(f.ns());
    await user.keyboard('st');
    expect(f.ns().value).toBe('st');
    expect(f.mark('namespace')).toBeNull();
    expect(f.mark('id')).toBeInTheDocument();
    expect(f.mark('version')).toBeInTheDocument();
  });

  it('clicking into the version and typing replaces it, and clears that mark only', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    await user.click(f.version());
    await user.keyboard('1.0.0');
    expect(f.version().value).toBe('1.0.0');
    expect(f.mark('version')).toBeNull();
    expect(f.mark('id')).toBeInTheDocument();
    expect(f.mark('namespace')).toBeInTheDocument();
  });

  it('clicking into the id and typing replaces it; the namespace keeps following the id', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    await user.click(f.id());
    await user.keyboard('com.acme.crm');
    expect(f.id().value).toBe('com.acme.crm');
    expect(f.ns().value).toBe('crm');
    expect(f.mark('id')).toBeNull();
    expect(f.mark('namespace')).toBeInTheDocument();
  });

  it('an edited field keeps the caret: focusing it again selects nothing', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    await user.click(f.ns());
    await user.keyboard('st');
    f.ns().blur();
    f.ns().focus();
    expect(f.ns().selectionStart).toBe(f.ns().selectionEnd);
  });
});

describe('Create stays disabled until the id, name, namespace and version validate (objectui#12512)', () => {
  it('is enabled once a display name has filled the other three', () => {
    const f = openCreate();
    expect(f.submit()).toBeDisabled();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    expect(f.submit()).toBeEnabled();
  });

  it('an emptied namespace disables Create and says why under the field', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    fireEvent.change(f.ns(), { target: { value: '' } });
    expect(f.submit()).toBeDisabled();
    expect(screen.getByTestId('package-form-namespace-missing')).toHaveTextContent(
      t('engine.packages.nsRule.required', 'en-US'),
    );
  });

  it('a name that derives no id disables Create and the id says why', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: '工单中心' } });
    expect(f.id().value).toBe('');
    expect(f.submit()).toBeDisabled();
    expect(screen.getByTestId('package-form-id-missing')).toBeInTheDocument();
  });

  // objectui#13389 — the line names the cause, and the "filled in from the
  // display name" mark does not sit over an empty box.
  it('a name with no Latin letters says the id could not be made from it, with no filled-in mark', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: '体验评审' } });
    expect(screen.getByTestId('package-form-id-missing')).toHaveTextContent(
      tFormat('engine.packages.idRule.notDerived', 'en-US', { example: 'com.acme.crm' }),
    );
    expect(f.mark('id')).toBeNull();
    // Typing an id clears the cause and the namespace follows it.
    fireEvent.change(f.id(), { target: { value: 'com.acme.review-lab' } });
    expect(screen.queryByTestId('package-form-id-missing')).toBeNull();
    expect(f.ns().value).toBe('review_lab');
    expect(f.submit()).toBeEnabled();
  });

  it('CONTROL — an id the author cleared keeps the format line, not the no-letters one', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    fireEvent.change(f.id(), { target: { value: '' } });
    expect(screen.getByTestId('package-form-id-missing')).toHaveTextContent(
      tFormat('engine.packages.idRule.formatHint', 'en-US', { example: 'com.acme.crm' }),
    );
  });

  it('an invalid version disables Create and the version says why', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Studio Test' } });
    await user.click(f.version());
    await user.keyboard('1.0');
    await user.tab();
    expect(f.submit()).toBeDisabled();
    expect(within(screen.getByTestId('package-form-version')).getAllByTestId('schema-form-issue').length).toBeGreaterThan(0);
  });

  it('nothing says a field is missing before the author has typed', () => {
    openCreate();
    expect(screen.queryByTestId('package-form-id-missing')).toBeNull();
    expect(screen.queryByTestId('package-form-namespace-missing')).toBeNull();
  });
});
