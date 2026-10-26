// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11855 — the package sheet's *Duplicate* form judges the new package
 * id by the spec's id rule, the one the duplicate route refuses by.
 *
 * The sheet's form is the Studio landing's inline form (objectui#11784) and
 * read the landing's regex on purpose, so it carried the same defect: it
 * refused `163.com.crm` and let `com.acme.my_app`, `com.-x` and `a..b` through
 * to the server's 400. It now judges by `ManifestSchema.shape.id`, through the
 * same rule and wording as the landing and the *New package* dialog.
 *
 * Each pin carries the verdict the server gives, written down as a literal and
 * checked against the installed declaration, and is read off the real
 * `PackageDetailSheet`: the button's state, the input's hint, and the wire.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ManifestSchema } from '@objectstack/spec/kernel';

import { PackageDetailSheet, type InstalledPackageRow } from './PackagesPage';
import { t, tFormat } from './i18n';

const PKG_ID = 'com.acme.crm';
const PKG: InstalledPackageRow = {
  manifest: { id: PKG_ID, name: 'Acme CRM', version: '1.0.0', type: 'app' },
  enabled: true,
  status: 'installed',
  source: 'authored',
  writable: true,
};

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

function respond(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url: input, method, body });
      if (input.startsWith('/api/v1/meta/_drafts')) return respond({ success: true, data: { drafts: [] } });
      if (input.endsWith('/duplicate')) {
        return respond({ success: true, data: { success: true, copiedCount: 3, failedCount: 0 } });
      }
      return respond({ success: true, data: {} });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openDuplicateForm() {
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <PackageDetailSheet pkg={PKG} open onOpenChange={vi.fn()} onChanged={onChanged} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: t('engine.packages.detail.duplicate', 'en-US') }));
  const form = await screen.findByTestId('pkg-detail-dup-form');
  const idInput = within(form).getByTestId('pkg-detail-dup-id-input') as HTMLInputElement;
  const go = within(form).getByRole('button', { name: t('engine.packages.detail.duplicateGo', 'en-US') });
  return { form, idInput, go, onChanged };
}

const writes = () => calls.filter((c) => c.method !== 'GET');
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The server's verdict on each id, as `ManifestSchema.shape.id` gives it. */
const PINS: ReadonlyArray<readonly [id: string, accepted: boolean]> = [
  ['163.com.crm', true], // a segment may open with a digit
  ['com.acme.my_app', false], // the spec admits no underscore
  ['com.-x', false], // nor a segment opening with a hyphen
  ['a..b', false], // nor an empty segment
  ['com.example.myapp', true], // control: a plain valid id
];

describe('the package sheet Duplicate form judges the id as the server does (objectui#11855)', () => {
  it('each pinned verdict is the installed declaration’s', () => {
    for (const [id, accepted] of PINS) expect(ManifestSchema.shape.id.safeParse(id).success).toBe(accepted);
  });

  it.each(PINS)('%s: armed exactly when the server accepts it (%s)', async (id, accepted) => {
    const { form, idInput, go, onChanged } = await openDuplicateForm();
    fireEvent.change(idInput, { target: { value: id } });
    expect(idInput.value).toBe(id);
    expect(go.hasAttribute('disabled')).toBe(!accepted);
    expect(within(form).queryByTestId('pkg-id-format-hint') === null).toBe(accepted);

    fireEvent.click(go);
    if (accepted) {
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0]).toMatchObject({
        method: 'POST',
        url: `/api/v1/packages/${PKG_ID}/duplicate`,
        body: { targetPackageId: id },
      });
      await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    } else {
      // Neither door sends it: the button, nor Enter in the id field.
      fireEvent.keyDown(idInput, { key: 'Enter' });
      await settle();
      expect(writes()).toEqual([]);
    }
  });

  it('control: the prefilled `<id>-copy` id is armed without an edit', async () => {
    const { form, idInput, go } = await openDuplicateForm();
    expect(idInput.value).toBe(`${PKG_ID}-copy`);
    expect(go).not.toBeDisabled();
    expect(within(form).queryByTestId('pkg-id-format-hint')).toBeNull();
  });

  it('an underscore stays in the field and the hint is the shared rule’s, as in the New package dialog', async () => {
    const { form, idInput } = await openDuplicateForm();
    fireEvent.change(idInput, { target: { value: 'com.acme.my_app' } });
    expect(idInput.value).toBe('com.acme.my_app');
    expect(within(form).queryByTestId('pkg-id-stripped')).toBeNull();
    expect(within(form).getByTestId('pkg-id-format-hint')).toHaveTextContent(
      tFormat('engine.packages.idRule.formatHint', 'en-US', { example: 'com.acme.crm' }),
    );
  });
});
