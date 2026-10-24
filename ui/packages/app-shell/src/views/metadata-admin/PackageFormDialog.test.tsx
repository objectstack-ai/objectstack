// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PackageFormDialog } from './PackageFormDialog';
import { t } from './i18n';

// Which console language the dialog renders in. Only `useMetadataLocale` is
// replaced — the rest of `./i18n` (the `t` resolver and both string tables) is
// the real module, so the capability cases below assert against the strings
// the product actually ships rather than a stand-in.
let localeFixture: 'en-US' | 'zh-CN' = 'en-US';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

// PackageFormDialog renders the manifest form from the spec (package-schema)
// via SchemaForm and talks to `/api/v1/packages`. apiJson uses the raw global
// fetch (fetch → res.text() → JSON.parse), so we stub fetch and mirror the
// runtime's { success, data } envelope.
let calls: Array<{ url: string; init: RequestInit }>;

function stubOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const body = init.body ? JSON.parse(init.body as string) : {};
      const manifest = body.manifest ?? body;
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ success: true, data: { manifest, status: 'installed' } }),
      } as Response;
    }),
  );
}

beforeEach(() => {
  calls = [];
  localeFixture = 'en-US';
  stubOk();
});
afterEach(() => vi.unstubAllGlobals());

describe('PackageFormDialog — create mode', () => {
  it('POSTs { manifest } from the spec form and reports the new id', async () => {
    const onSaved = vi.fn();
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={onSaved} />);

    // Fields come from the spec-derived FormView (package-schema); target them by label.
    fireEvent.change(await screen.findByLabelText(/package id/i), { target: { value: 'com.acme.new' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'New App' } });
    // version prefills to 0.1.0; type prefills to 'app'.

    fireEvent.click(screen.getByTestId('package-form-submit'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/v1/packages');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string).manifest).toMatchObject({
      id: 'com.acme.new',
      name: 'New App',
      version: '0.1.0',
      type: 'app',
    });
    expect(onSaved.mock.calls[0][0].id).toBe('com.acme.new');
  });

  it('maps a 409 duplicate id to a friendly "already exists" message and stays open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        text: async () => JSON.stringify({ success: false, error: { message: "Package 'com.acme.new' already exists" } }),
      })),
    );
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<PackageFormDialog mode="create" open onOpenChange={onOpenChange} onSaved={onSaved} />);

    fireEvent.change(await screen.findByLabelText(/package id/i), { target: { value: 'com.acme.new' } });
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Dup App' } });
    fireEvent.click(screen.getByTestId('package-form-submit'));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

/**
 * The capability refusal is localized (objectstack#8270).
 *
 * The server rejects package writes without the ADR-0066 `manage_metadata`
 * capability, and the catch used to pass every non-409 server `message` straight
 * to the banner. On the EE deployment that is the sentence below — English —
 * and it was measured verbatim in a **zh** console. The deployment withholds the
 * capability deliberately (maintainer ruling 2026-08-13), so this is a settled
 * posture that has to read as one in the user's language.
 */
const SERVER_REFUSAL = 'Managing packages requires the `manage_metadata` capability.';

function stubRefusal(status: number, message: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status,
      text: async () => JSON.stringify({ success: false, error: { message } }),
    })),
  );
}

/**
 * Fill and submit the create form. The field labels are themselves localized
 * (`getPackageForm(locale)` builds them through the same `t`), so they are
 * looked up rather than hardcoded — otherwise the zh case below fails on the
 * label instead of measuring the error banner it is actually about.
 */
async function submitCreate(locale: 'en-US' | 'zh-CN' = 'en-US') {
  // `exact: false` because the rendered label carries decoration around the
  // translated text (the required marker), as the original /package id/i
  // substring match in this file already relied on.
  fireEvent.change(
    await screen.findByLabelText(t('engine.packages.create.id', locale), { exact: false }),
    { target: { value: 'com.acme.new' } },
  );
  fireEvent.change(screen.getByLabelText(t('engine.packages.create.name', locale), { exact: false }), {
    target: { value: 'New App' },
  });
  fireEvent.click(screen.getByTestId('package-form-submit'));
}

describe('PackageFormDialog — capability refusal (objectstack#8270)', () => {
  it('replaces the server’s English refusal with the localized message', async () => {
    stubRefusal(403, SERVER_REFUSAL);
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await submitCreate();

    expect(await screen.findByText(t('engine.packages.noCapability', 'en-US'))).toBeInTheDocument();
    // The raw sentence is what the defect report captured; it must be gone.
    expect(screen.queryByText(/Managing packages requires/i)).toBeNull();
  });

  it('renders that message in Chinese in a zh console — the measured defect', async () => {
    localeFixture = 'zh-CN';
    stubRefusal(403, SERVER_REFUSAL);
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await submitCreate('zh-CN');

    const zh = t('engine.packages.noCapability', 'zh-CN');
    expect(await screen.findByText(zh)).toBeInTheDocument();
    // Guards the half that actually broke: a zh pack entry that were merely a
    // copy of the English one would satisfy the assertion above.
    expect(zh).not.toBe(t('engine.packages.noCapability', 'en-US'));
    expect(zh).toMatch(/\p{Script=Han}/u);
    expect(screen.queryByText(/Managing packages requires/i)).toBeNull();
  });

  it('catches the refusal by message when the transport reports no status', async () => {
    // Same probe shape as the 409 arm: status when there is one, message when
    // there is not (a proxy or a non-HTTP transport can drop it).
    stubRefusal(0, SERVER_REFUSAL);
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await submitCreate();

    expect(await screen.findByText(t('engine.packages.noCapability', 'en-US'))).toBeInTheDocument();
  });

  it('does not swallow unrelated failures — those still surface the server’s reason', async () => {
    // The arm must not become a catch-all for every non-409 error: a real
    // backend fault has to keep reaching the user, or this "fix" would hide it.
    stubRefusal(500, 'Database connection lost');
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await submitCreate();

    expect(await screen.findByText('Database connection lost')).toBeInTheDocument();
    expect(screen.queryByText(t('engine.packages.noCapability', 'en-US'))).toBeNull();
  });

  it('leaves the 409 arm in front of it — a duplicate id still says "already exists"', async () => {
    // Ordering guard: both arms are reachable for a failed create, and the
    // conflict message is the more specific answer.
    stubRefusal(409, "Package 'com.acme.new' already exists");
    render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await submitCreate();

    expect(await screen.findByText(t('engine.packages.create.exists', 'en-US'))).toBeInTheDocument();
    expect(screen.queryByText(t('engine.packages.noCapability', 'en-US'))).toBeNull();
  });
});
