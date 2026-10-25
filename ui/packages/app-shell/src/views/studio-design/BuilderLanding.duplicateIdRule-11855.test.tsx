// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11855 — the Studio landing's *Duplicate* form judges the new
 * package id by the spec's id rule, the one the duplicate route refuses by.
 *
 * Before: the form armed its button with a regex of its own, which refused
 * `163.com.crm` (a digit-led segment the spec accepts) and let
 * `com.acme.my_app`, `com.-x` and `a..b` through to the server's 400. It now
 * judges by `ManifestSchema.shape.id`, through the same rule and wording as
 * the *New package* dialog (objectui#11792).
 *
 * Each pin carries the verdict the server gives, written down as a literal and
 * checked against the installed declaration, and is read off the real
 * `BuilderLanding`: the button's state, the input's hint, and the wire.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { t, tFormat } from '../metadata-admin/i18n';

const SOURCE_ID = 'com.acme.crm';

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [{ id: SOURCE_ID, name: 'Acme CRM', writable: true, namespace: 'crm' }]),
  };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));

import { BuilderLanding } from './BuilderLanding';

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const text = JSON.stringify({ success: true, data: { success: true, copiedCount: 3, failedCount: 0 } });
      return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

async function openDuplicateForm() {
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <LocationProbe />
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
        <Route path="/studio/:packageId/:tab" element={<div data-testid="pillar-builder" />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTitle(t('engine.studio.landing.dupTitle', 'en-US')));
  // One form is open and the create dialog is stubbed out, so this input's
  // hint and notice are the only ones on the page.
  const idInput = (await screen.findByTestId('pkg-dup-id-input')) as HTMLInputElement;
  const go = screen.getByRole('button', { name: t('engine.studio.landing.dupGo', 'en-US') });
  return { idInput, go };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const writes = () => calls.filter((c) => c.method !== 'GET');

/** The server's verdict on each id, as `ManifestSchema.shape.id` gives it. */
const PINS: ReadonlyArray<readonly [id: string, accepted: boolean]> = [
  ['163.com.crm', true], // a segment may open with a digit
  ['com.acme.my_app', false], // the spec admits no underscore
  ['com.-x', false], // nor a segment opening with a hyphen
  ['a..b', false], // nor an empty segment
  ['com.example.myapp', true], // control: a plain valid id
];

describe('the landing Duplicate form judges the id as the server does (objectui#11855)', () => {
  it('each pinned verdict is the installed declaration’s', () => {
    for (const [id, accepted] of PINS) expect(ManifestSchema.shape.id.safeParse(id).success).toBe(accepted);
  });

  it.each(PINS)('%s: armed exactly when the server accepts it (%s)', async (id, accepted) => {
    const { idInput, go } = await openDuplicateForm();
    fireEvent.change(idInput, { target: { value: id } });
    expect(idInput.value).toBe(id);
    expect(go.hasAttribute('disabled')).toBe(!accepted);
    expect(screen.queryByTestId('pkg-id-format-hint') === null).toBe(accepted);

    if (accepted) {
      fireEvent.click(go);
      await waitFor(() => expect(writes()).toHaveLength(1));
      expect(writes()[0]).toMatchObject({
        method: 'POST',
        url: `/api/v1/packages/${SOURCE_ID}/duplicate`,
        body: { targetPackageId: id },
      });
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${id}/data`));
    } else {
      // Neither door sends it: the button, nor Enter in the id field.
      fireEvent.click(go);
      fireEvent.keyDown(idInput, { key: 'Enter' });
      await settle();
      expect(writes()).toEqual([]);
    }
  });

  it('control: the prefilled `<source>-copy` id is armed without an edit', async () => {
    const { idInput, go } = await openDuplicateForm();
    expect(idInput.value).toBe(`${SOURCE_ID}-copy`);
    expect(go).not.toBeDisabled();
    expect(screen.queryByTestId('pkg-id-format-hint')).toBeNull();
  });

  it('an underscore stays in the field and the hint is the shared rule’s, as in the New package dialog', async () => {
    const { idInput } = await openDuplicateForm();
    fireEvent.change(idInput, { target: { value: 'com.acme.my_app' } });
    expect(idInput.value).toBe('com.acme.my_app');
    expect(screen.queryByTestId('pkg-id-stripped')).toBeNull();
    expect(screen.getByTestId('pkg-id-format-hint')).toHaveTextContent(
      tFormat('engine.packages.idRule.formatHint', 'en-US', { example: 'com.acme.crm' }),
    );
  });

  it('a stripped keystroke shows the shared rule’s notice', async () => {
    const { idInput } = await openDuplicateForm();
    fireEvent.change(idInput, { target: { value: 'com.acme.crm copy!' } });
    expect(idInput.value).toBe('com.acme.crmcopy');
    expect(screen.getByTestId('pkg-id-stripped')).toHaveTextContent(
      t('engine.packages.idRule.strippedNotice', 'en-US'),
    );
  });
});
