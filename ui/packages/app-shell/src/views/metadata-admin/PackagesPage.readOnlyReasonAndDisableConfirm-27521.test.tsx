// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27521 row 21 — the package sheet says why its write actions are
 * missing, confirms Disable, and calls the package a package.
 *
 * Pinned through the real `PackageDetailSheet`:
 *   (a) a read-only package states its reason above the actions: a
 *       project-scoped code package that it is loaded from code, a scope-less
 *       read-only one that it is read-only here, a platform package that it is
 *       part of the platform; a writable package states none;
 *   (b) Disable opens a confirm and sends nothing until it is confirmed;
 *       Cancel sends nothing; Confirm sends the one `PATCH …/disable`;
 *   (c) CONTROL: Enable on a disabled package runs at once, with no dialog;
 *   (d) the delete action is named for the package.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PackageDetailSheet, type InstalledPackageRow } from './PackagesPage';
import { t } from './i18n';

const label = (key: string) => t(`engine.packages.detail.${key}`, 'en');

function row(
  writable: boolean,
  extra: { scope?: 'system' | 'cloud' | 'project'; enabled?: boolean } = {},
): InstalledPackageRow {
  return {
    manifest: {
      id: 'com.acme.crm',
      name: 'Acme CRM',
      version: '1.0.0',
      type: 'app',
      ...(extra.scope ? { scope: extra.scope } : {}),
    },
    enabled: extra.enabled ?? true,
    source: 'code',
    writable,
    // The disable door's verdict as the server serves it for a non-module
    // package (objectstack#28318): disableable exactly when writable.
    disableable: writable,
  };
}

function respond(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => JSON.parse(text),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (input: string) => {
    if (input.startsWith('/api/v1/meta/_drafts')) {
      return respond({ success: true, data: { drafts: [] } });
    }
    return respond({ success: true, data: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderSheet(pkg: InstalledPackageRow) {
  render(
    <MemoryRouter>
      <PackageDetailSheet pkg={pkg} open onOpenChange={() => {}} onChanged={() => {}} />
    </MemoryRouter>,
  );
  await screen.findByTestId('pkg-scope');
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** The lifecycle PATCHes the sheet sent: `enable` / `disable`. */
function lifecycleCalls(): string[] {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), method: (init as RequestInit | undefined)?.method }))
    .filter((c) => c.method === 'PATCH' && /\/(enable|disable)$/.test(c.url))
    .map((c) => c.url.split('/').pop() as string);
}

describe('PackageDetailSheet — the read-only reason (objectstack#27521 row 21)', () => {
  it.each([
    ['a project-scoped code package', row(false, { scope: 'project' }), 'codeReadOnly'],
    ['a scope-less read-only package', row(false), 'readOnly'],
    ['a platform package', row(false, { scope: 'system' }), 'kernelReadOnly'],
  ])('(a) %s states why it offers no write action', async (_name, pkg, key) => {
    await renderSheet(pkg);
    expect(screen.getByTestId('pkg-detail-readonly-reason')).toHaveTextContent(label(key));
  });

  it('(a) CONTROL: a writable package states no read-only reason', async () => {
    await renderSheet(row(true));
    expect(screen.queryByTestId('pkg-detail-readonly-reason')).toBeNull();
  });
});

describe('PackageDetailSheet — Disable is confirmed (objectstack#27521 row 21)', () => {
  it('(b) Disable opens a confirm and sends nothing; Cancel keeps it that way', async () => {
    await renderSheet(row(true));
    fireEvent.click(screen.getByRole('button', { name: label('disable') }));
    const dialog = await screen.findByTestId('pkg-detail-disable-dialog');
    expect(within(dialog).getByText(/Acme CRM/)).toBeTruthy();
    expect(lifecycleCalls()).toEqual([]);

    fireEvent.click(within(dialog).getByTestId('pkg-detail-disable-cancel'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByTestId('pkg-detail-disable-dialog')).toBeNull();
    expect(lifecycleCalls()).toEqual([]);
  });

  it('(b) Confirm sends the one disable', async () => {
    await renderSheet(row(true));
    fireEvent.click(screen.getByRole('button', { name: label('disable') }));
    fireEvent.click(within(await screen.findByTestId('pkg-detail-disable-dialog')).getByTestId('pkg-detail-disable-confirm'));
    await vi.waitFor(() => expect(lifecycleCalls()).toEqual(['disable']));
  });

  it('(c) CONTROL: Enable on a disabled package runs at once, with no dialog', async () => {
    await renderSheet(row(true, { enabled: false }));
    fireEvent.click(screen.getByRole('button', { name: label('enable') }));
    await vi.waitFor(() => expect(lifecycleCalls()).toEqual(['enable']));
    expect(screen.queryByTestId('pkg-detail-disable-dialog')).toBeNull();
  });

  it('(d) the delete action is named for the package', async () => {
    await renderSheet(row(true));
    expect(screen.getByRole('button', { name: label('deletePackage') })).toBeTruthy();
  });
});
