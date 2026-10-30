// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * New package: the first step asks only for a name (objectstack#27833).
 *
 * Measured on the card: Home → New → New Package opened on a reverse-domain
 * id, an object namespace, a SemVer version and a package type, all up front,
 * under developer help. The id, namespace and version were already filled in
 * from the name (objectui#11792, objectui#12512); what was missing was a first
 * step a non-developer can answer. The technical rows now sit behind one
 * collapsed Advanced disclosure, and a line under the name says what was
 * filled in.
 *
 * "Closed" is read the way a browser hides it: the disclosure's content
 * carries `hidden`, so its rows leave the accessibility tree (`getByRole`
 * cannot reach them) while staying mounted.
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

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(
    async () => ({ ok: true, status: 201, text: async () => '{"success":true,"data":{}}' }) as Response,
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const label = (key: string) => t(key, 'en-US');

function openCreate() {
  render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} />);
  const byLabel = (key: string) => screen.getByLabelText(label(key), { exact: false }) as HTMLInputElement;
  return {
    name: () => byLabel('engine.packages.create.name'),
    id: () => byLabel('engine.packages.create.id'),
    ns: () => byLabel('engine.packages.create.namespace'),
    toggle: () => screen.getByTestId('package-form-advanced-toggle'),
    content: () => screen.getByTestId('package-form-id').parentElement as HTMLElement,
    submit: () => screen.getByTestId('package-form-submit'),
  };
}

describe('the first step asks only for a name (objectstack#27833)', () => {
  it('opens with the name and the description in reach, the technical rows folded away', () => {
    const f = openCreate();
    const basics = screen.getByTestId('package-form-basics');
    expect(within(basics).getAllByRole('textbox')).toEqual([
      f.name(),
      screen.getByLabelText(label('engine.packages.detail.description'), { exact: false }),
    ]);

    expect(f.toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(f.content()).toHaveAttribute('hidden');
    // Mounted, but out of the accessibility tree while closed.
    expect(screen.queryByRole('textbox', { name: new RegExp(label('engine.packages.create.id')) })).toBeNull();
    expect(screen.queryByRole('textbox', { name: new RegExp(label('engine.packages.create.version')) })).toBeNull();
  });

  it('a name alone creates the package, with the id and namespace it derived', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    await user.type(f.name(), 'Field Service');

    expect(screen.getByTestId('package-form-derived-summary')).toHaveTextContent(
      tFormat('engine.packages.create.derivedSummary', 'en-US', {
        id: 'com.field-service',
        namespace: 'field_service',
      }),
    );
    expect(f.toggle()).toHaveAttribute('aria-expanded', 'false');

    await user.click(f.submit());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/packages');
    expect(JSON.parse(String(init.body)).manifest).toMatchObject({
      id: 'com.field-service',
      namespace: 'field_service',
      name: 'Field Service',
      version: '0.1.0',
      type: 'app',
    });
  });

  it('Advanced shows the derived id and namespace, and both are editable there', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    await user.type(f.name(), 'Field Service');
    await user.click(f.toggle());

    expect(f.content()).not.toHaveAttribute('hidden');
    const id = screen.getByRole('textbox', { name: new RegExp(label('engine.packages.create.id')) });
    const ns = screen.getByRole('textbox', { name: new RegExp(label('engine.packages.create.namespace')) });
    expect(id).toHaveValue('com.field-service');
    expect(ns).toHaveValue('field_service');

    await user.clear(ns);
    await user.type(ns, 'fs');
    expect(ns).toHaveValue('fs');
    expect(screen.getByTestId('package-form-derived-summary')).toHaveTextContent(
      tFormat('engine.packages.create.derivedSummary', 'en-US', { id: 'com.field-service', namespace: 'fs' }),
    );
  });

  it('an edited id never moves when the name changes again', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    await user.type(f.name(), 'Field Service');
    await user.click(f.toggle());
    await user.clear(f.id());
    await user.type(f.id(), 'com.acme.repairs');

    await user.clear(f.name());
    await user.type(f.name(), 'Repairs Center');
    expect(f.id()).toHaveValue('com.acme.repairs');
    expect(f.ns()).toHaveValue('repairs');
  });

  it('a hand-typed id the spec refuses is refused in words, Create waits, and Advanced cannot fold it away', async () => {
    const user = userEvent.setup();
    const f = openCreate();
    await user.type(f.name(), 'Field Service');
    await user.click(f.toggle());
    await user.clear(f.id());
    await user.type(f.id(), 'acme');

    expect(screen.getByTestId('pkg-id-format-hint')).toHaveTextContent(
      tFormat('engine.packages.idRule.formatHint', 'en-US', { example: 'com.acme.crm' }),
    );
    expect(f.submit()).toBeDisabled();
    expect(screen.queryByTestId('package-form-derived-summary')).toBeNull();

    await user.click(f.toggle());
    expect(f.content()).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('pkg-id-format-hint')).toBeVisible();
  });

  it('a name that derives no id opens Advanced by itself, at the line that says why', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: '工单中心' } });

    expect(f.submit()).toBeDisabled();
    expect(f.toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(f.content()).not.toHaveAttribute('hidden');
    expect(screen.getByTestId('package-form-id-missing')).toHaveTextContent(
      tFormat('engine.packages.idRule.notDerived', 'en-US', { example: 'com.acme.crm' }),
    );
  });
});

describe('editing an existing package keeps its fields (objectstack#27833)', () => {
  it('has no Advanced disclosure of its own and shows the locked id with the other rows', () => {
    const manifest = { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app', namespace: 'crm' };
    render(<PackageFormDialog mode="edit" open onOpenChange={vi.fn()} manifest={manifest} />);

    expect(screen.queryByTestId('package-form-advanced')).toBeNull();
    expect(screen.queryByTestId('package-form-derived-summary')).toBeNull();
    const id = screen.getByLabelText(label('engine.packages.create.id'), { exact: false }) as HTMLInputElement;
    expect(id).toHaveValue('com.acme.crm');
    expect(id).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: new RegExp(label('engine.packages.create.version')) })).toHaveValue(
      '1.0.0',
    );
  });
});
