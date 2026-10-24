// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * New package: the Package ID is derived from the display name and judged by
 * the spec's id rule before it is sent (objectui#11792).
 *
 * Measured on the card: Studio → *New package* took `Repairs Center` in the
 * Package ID field, `Create package` posted it, and the server answered 400 —
 * the create gate only asked for a non-empty id. The create mode now renders
 * the shared `PackageIdInput`, fills it from the display name as
 * `com.<org>.<name>` until the author edits it, and submits only an id the
 * installed `ManifestSchema.shape.id` accepts, which is the declaration
 * `POST /api/v1/packages` refuses by.
 *
 * Edit and view keep the spec form's locked id field; the last block pins that.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { PackageFormDialog } from './PackageFormDialog';
import { t } from './i18n';

let localeFixture: 'en-US' | 'zh-CN' = 'en-US';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

// The session's active organization — the `<org>` of `com.<org>.<name>`. The
// real hook answers its provider-less default (no organization) and only the
// organization is replaced, so every other member stays the shipped one.
let orgFixture: { id: string; name: string; slug: string } | null = null;
vi.mock('@object-ui/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/auth')>();
  return { ...mod, useAuth: () => ({ ...mod.useAuth(), activeOrganization: orgFixture }) };
});

let calls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  calls = [];
  localeFixture = 'en-US';
  orgFixture = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const body = init.body ? JSON.parse(init.body as string) : {};
      const manifest = body.manifest ?? body;
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ success: true, data: { manifest } }),
      } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const isSpecId = (v: string) => ManifestSchema.shape.id.safeParse(v).success;

function openCreate() {
  const onSaved = vi.fn();
  const view = render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={onSaved} />);
  // Labels are looked up through the same `t` the form uses, so the zh case
  // below finds its fields; `exact: false` skips the required marker.
  const byLabel = (key: string) =>
    screen.getByLabelText(t(key, localeFixture), { exact: false }) as HTMLInputElement;
  return {
    ...view,
    onSaved,
    id: () => byLabel('engine.packages.create.id'),
    name: () => byLabel('engine.packages.create.name'),
    ns: () => byLabel('engine.packages.create.namespace'),
    submit: () => screen.getByTestId('package-form-submit') as HTMLButtonElement,
  };
}

describe('New package — the id follows the display name (objectui#11792)', () => {
  it('derives com.<name> when the session holds no organization, and the namespace from it', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Repairs Center' } });
    expect(f.id().value).toBe('com.repairs-center');
    expect(isSpecId(f.id().value)).toBe(true);
    // The namespace keeps following the id, now that the id follows the name.
    expect(f.ns().value).toBe('repairs_center');
    expect(f.submit()).toBeEnabled();
  });

  it('puts the active organization slug in the middle: com.<org>.<name>', () => {
    orgFixture = { id: 'org_1', name: 'Acme Inc', slug: 'acme' };
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Repairs Center' } });
    expect(f.id().value).toBe('com.acme.repairs-center');
  });

  it('picks the organization up when it arrives after the name was typed', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Repairs Center' } });
    expect(f.id().value).toBe('com.repairs-center');
    orgFixture = { id: 'org_1', name: 'Acme Inc', slug: 'acme' };
    f.rerender(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={f.onSaved} />);
    expect(f.id().value).toBe('com.acme.repairs-center');
    expect(f.ns().value).toBe('repairs_center');
  });

  it('stops following the name once the author types an id', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Repairs' } });
    fireEvent.change(f.id(), { target: { value: 'com.example.tickets' } });
    fireEvent.change(f.name(), { target: { value: 'Repairs Center' } });
    expect(f.id().value).toBe('com.example.tickets');
    expect(f.ns().value).toBe('tickets');
  });

  it('leaves the id empty when the name yields no id segment, and does not submit', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: '报修中心' } });
    expect(f.id().value).toBe('');
    expect(f.submit()).toBeDisabled();
  });

  it('posts the derived id', async () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Repairs Center' } });
    fireEvent.click(f.submit());
    await waitFor(() => expect(f.onSaved).toHaveBeenCalledTimes(1));
    expect(JSON.parse(calls[0].init.body as string).manifest).toMatchObject({
      id: 'com.repairs-center',
      name: 'Repairs Center',
      namespace: 'repairs_center',
    });
  });
});

describe('New package — an id the spec refuses never leaves the dialog (objectui#11792)', () => {
  it('catches the card’s `Repairs Center`: stripped, hinted, and not posted', () => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Repairs Center' } });
    fireEvent.change(f.id(), { target: { value: 'Repairs Center' } });
    expect(f.id().value).toBe('repairscenter');
    expect(screen.getByTestId('pkg-id-stripped')).toHaveTextContent(t('engine.packages.idRule.strippedNotice', 'en-US'));
    expect(screen.getByTestId('pkg-id-format-hint')).toBeInTheDocument();
    expect(f.submit()).toBeDisabled();
    fireEvent.click(f.submit());
    expect(calls).toHaveLength(0);
  });

  // The verdict is the spec's in BOTH directions. Each probe is judged by the
  // installed schema here rather than by a literal, and the list holds the
  // shapes a hand-copied reverse-domain grammar gets wrong: a digit-led segment
  // the spec accepts, an underscore it refuses (objectui#11855 retired the
  // duplicate forms' own regex, which had both backwards). Asserted below, so
  // the probes cannot quietly stop exercising both arms.
  const probes = ['com.acme.crm', 'com.acme.my_app', '163.com.crm', 'com.-x', 'a..b', 'org.example.help-desk'];

  it('the probe list exercises both verdicts, on the shapes a copied grammar gets wrong', () => {
    expect(isSpecId('163.com.crm')).toBe(true);
    expect(isSpecId('com.acme.my_app')).toBe(false);
    expect(probes.filter(isSpecId).length).toBeGreaterThan(0);
    expect(probes.filter((p) => !isSpecId(p)).length).toBeGreaterThan(0);
  });

  it.each(probes)('submit for %s is enabled exactly when the spec accepts it', (probe) => {
    const f = openCreate();
    fireEvent.change(f.name(), { target: { value: 'Probe' } });
    fireEvent.change(f.id(), { target: { value: probe } });
    expect(f.id().value).toBe(probe);
    // The namespace is not under test: keep it valid so it cannot gate.
    fireEvent.change(f.ns(), { target: { value: 'probe' } });
    expect(f.submit().disabled).toBe(!isSpecId(probe));
    expect(screen.queryByTestId('pkg-id-format-hint') === null).toBe(isSpecId(probe));
  });

  it('says it in the console language', () => {
    localeFixture = 'zh-CN';
    const f = openCreate();
    fireEvent.change(f.id(), { target: { value: 'com.acme.my_app' } });
    expect(screen.getByTestId('pkg-id-format-hint')).toHaveTextContent(/下划线/);
  });
});

describe('Edit and view keep the spec form’s id field (objectui#11792)', () => {
  const manifest = { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app', namespace: 'crm' };

  it.each(['edit', 'view'] as const)('%s renders no PackageIdInput and a locked id field', (mode) => {
    render(<PackageFormDialog mode={mode} open onOpenChange={vi.fn()} manifest={manifest} />);
    expect(screen.queryByTestId('package-form-id')).toBeNull();
    expect(screen.queryByTestId('package-form-id-input')).toBeNull();
    const id = screen.getByLabelText(/package id/i) as HTMLInputElement;
    expect(id.value).toBe('com.acme.crm');
    expect(id).toHaveAttribute('readonly');
  });

  it('edit still PATCHes only name / description / version, under the stored id', async () => {
    const onSaved = vi.fn();
    render(<PackageFormDialog mode="edit" open onOpenChange={vi.fn()} manifest={manifest} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Acme CRM 2' } });
    fireEvent.click(screen.getByTestId('package-form-submit'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls[0].url).toBe('/api/v1/packages/com.acme.crm');
    expect(calls[0].init.method).toBe('PATCH');
    expect(Object.keys(JSON.parse(calls[0].init.body as string)).sort()).toEqual(['description', 'name', 'version']);
  });
});
