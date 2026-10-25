// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13157 — the package sheet offers no write action on a package its
 * own Scope badge draws read-only.
 *
 * Measured on HotCRM: the sheet badged the package "Read-only · code" and
 * still offered Edit, Publish, Revert, Disable, Duplicate and Delete app, each
 * of which the server refuses on a read-only package. The sheet used to gate
 * its actions on `manifest.scope` being system / cloud, a second rule beside
 * the badge's; a project-scoped or scope-less code package, or a marketplace
 * install, passed it.
 *
 * Pinned here through the real `PackageDetailSheet`:
 *   (a) a read-only package (`writable: false`, whatever its scope) offers
 *       none of Edit, Publish, Revert, Disable, Duplicate, Adopt loose items or
 *       Delete app; the reads (View info, Export) stay;
 *   (b) CONTROL: a writable package offers every one of them, as before;
 *   (c) Duplicate is one of the refused writes: the server answers a read-only
 *       source `422 DUPLICATE_SOURCE_NOT_A_BASE` (its source must be a
 *       writable base), so it is not offered there either.
 * A row with no boolean verdict is never treated as writable, as the badge
 * draws it. Enable is not refused on a read-only package, so a disabled one
 * still offers it.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PackageDetailSheet, type InstalledPackageRow } from './PackagesPage';
import { t } from './i18n';

const label = (key: string) => t(`engine.packages.detail.${key}`, 'en');

/** Every write action the sheet offers on a writable package. */
const WRITES = ['edit', 'publish', 'revert', 'disable', 'duplicate', 'adoptOrphans', 'deleteApp'];
/** The read actions, offered on every package. */
const READS = ['viewInfo', 'export'];

function row(
  writable: unknown,
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
    writable: writable as boolean,
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.startsWith('/api/v1/meta/_drafts')) {
        return respond({ success: true, data: { drafts: [] } });
      }
      return respond({ success: true, data: {} });
    }),
  );
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

/** Which of the given actions the sheet offers, by their button names. */
function offered(keys: string[]): string[] {
  return keys.filter((k) => screen.queryByRole('button', { name: label(k) }) !== null);
}

describe('PackageDetailSheet offers write actions only on a writable package (objectui#13157)', () => {
  it('(a) a read-only project-scoped code package (badged "Read-only · code") offers no write action', async () => {
    await renderSheet(row(false, { scope: 'project' }));
    expect(screen.getByTestId('pkg-scope')).toHaveTextContent(t('engine.packages.scope.project', 'en'));
    expect(offered(WRITES)).toEqual([]);
    expect(offered(READS)).toEqual(READS);
  });

  it('(a) a read-only scope-less package (a marketplace install or a bare code package) offers no write action', async () => {
    await renderSheet(row(false));
    expect(screen.getByTestId('pkg-scope')).toHaveTextContent(t('engine.packages.scope.readOnly', 'en'));
    expect(offered(WRITES)).toEqual([]);
    expect(offered(READS)).toEqual(READS);
  });

  it('(a) a system package offers no write action', async () => {
    await renderSheet(row(false, { scope: 'system' }));
    expect(offered(WRITES)).toEqual([]);
  });

  it('(b) CONTROL: a writable package offers every write action, as before', async () => {
    await renderSheet(row(true));
    expect(screen.getByTestId('pkg-scope')).toHaveTextContent(t('engine.packages.scope.writable', 'en'));
    expect(offered(WRITES)).toEqual(WRITES);
    expect(offered(READS)).toEqual(READS);
  });

  it('(b) CONTROL: a writable project-scoped base offers every write action', async () => {
    await renderSheet(row(true, { scope: 'project' }));
    expect(offered(WRITES)).toEqual(WRITES);
  });

  it('(c) Duplicate is not offered on a read-only package: the server refuses a read-only source', async () => {
    await renderSheet(row(false, { scope: 'project' }));
    expect(screen.queryByRole('button', { name: label('duplicate') })).toBeNull();
    expect(screen.queryByTestId('pkg-detail-dup-form')).toBeNull();
  });

  it('a row with no boolean verdict is never treated as writable', async () => {
    render(
      <MemoryRouter>
        <PackageDetailSheet pkg={row(undefined)} open onOpenChange={() => {}} onChanged={() => {}} />
      </MemoryRouter>,
    );
    await screen.findByTestId('pkg-scope-unknown');
    expect(offered(WRITES)).toEqual([]);
  });

  it('a disabled read-only package still offers Enable, which the server does not refuse', async () => {
    await renderSheet(row(false, { scope: 'project', enabled: false }));
    expect(screen.getByRole('button', { name: label('enable') })).toBeInTheDocument();
    expect(offered(WRITES)).toEqual([]);
  });
});
