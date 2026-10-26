// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Packages page's two package doors show a walled catalog-package refusal
 * WITH the door's reason (objectui#7611, item 2 of its release record).
 *
 * The console's marketplace half of the same measurement, and the refusal it
 * reads, are described in
 * `console/marketplace/__tests__/walledCatalogPackageRefusal-7611.test.tsx`.
 * This page reaches the two package doors objectstack W2 (objectstack#22935,
 * merge `4806b18aea`) walls, through its own reader (`apiJson`, which reads the
 * envelope by `readEnvelopeFailureText` and appends the code):
 *
 * - **Delete app** sends `DELETE /api/v1/packages/:id`. Under `group` /
 *   `isolated`, below the operator rung, `@objectstack/runtime`'s
 *   `refuseWalledCatalogPackageDelete` refuses a package with stored catalog
 *   rows, through the dispatcher's own error builder:
 *   `403 { success: false, error: { code: 'PERMISSION_DENIED', message, httpStatus: 403 } }`,
 *   `message` = `Deleting package "ID" is refused: the package carries security
 *   catalog items. ` + `walledCatalogWriteVerdict`'s sentence.
 * - **Import** sends `POST /api/v1/marketplace/install-local` with the file's
 *   manifest inline: the install-local door, whose refusal is
 *   `refuseWalledCatalogPackage`'s `403 FORBIDDEN` `Installing "ID" is refused…`.
 *
 * The fixtures rebuild those texts from the producers at `4806b18aea`. The
 * cases assert the page shows the sentence as sent, naming the posture, and not
 * the page's own status fallback (`Request failed (403)`) nor the status text
 * (`Forbidden`, which every stubbed `Response` carries).
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PackageDetailSheet, PackagesPage, type InstalledPackageRow } from './PackagesPage';

type Posture = 'group' | 'isolated';

const PKG_ID = 'com.acme.crm';
const PKG_NAME = 'Acme CRM';
const PKG: InstalledPackageRow = {
  manifest: { id: PKG_ID, name: PKG_NAME, version: '1.0.0', type: 'app' },
  enabled: true,
  status: 'installed',
  // Every served row carries its `source` (objectstack#24010) and the
  // server's writability verdict (objectstack#14375); the Packages list
  // refuses a row without either, each by its own name (objectui#12790).
  source: 'authored',
  writable: true,
};

/** `walledCatalogWriteVerdict`'s refusal sentence (`@objectstack/metadata-core` at `4806b18aea`), for a position. */
const verdictSentence = (posture: Posture) =>
  'Creating, changing or deleting a position requires the platform operator: this '
  + `deployment runs the '${posture}' tenancy posture, where the security catalog is shared `
  + 'by every organization (ADR-0131 D3). Holding the `manage_metadata` capability inside an '
  + "organization does not admit it. An organization's administrators assign the catalog's positions "
  + 'and permission sets to their own members instead.';

/** `refuseWalledCatalogPackageDelete`'s message (`@objectstack/runtime` at `4806b18aea`). */
const deleteRefusal = (posture: Posture) =>
  `Deleting package "${PKG_ID}" is refused: the package carries security catalog items. ${verdictSentence(posture)}`;

/** `refuseWalledCatalogPackage`'s message (`@objectstack/cloud-connection` at `4806b18aea`). */
const installRefusal = (posture: Posture) =>
  `Installing "${PKG_ID}" is refused: the package carries security catalog items. ${verdictSentence(posture)}`;

const json = (status: number, body: unknown, statusText = 'OK') =>
  new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

let writes: Array<{ method: string; url: string }> = [];

/** Every GET answers an empty success; every write answers `refusal`. */
function serve(refusal: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = (init.method ?? 'GET').toUpperCase();
      if (method !== 'GET') {
        writes.push({ method, url: String(input) });
        return refusal();
      }
      if (String(input) === '/api/v1/packages') return json(200, { success: true, data: { packages: [PKG] } });
      if (String(input).startsWith('/api/v1/meta/_drafts')) return json(200, { success: true, data: { drafts: [] } });
      return json(200, { success: true, data: {} });
    }),
  );
}

/** The element showing the refusal: the door's sentence whole, the posture it names, and no bare form. */
async function expectReasonShown(text: string, posture: Posture) {
  const shown = await screen.findByText(text);
  expect(shown.textContent).toContain(`'${posture}' tenancy posture`);
  const page = document.body.textContent ?? '';
  expect(page).not.toContain('Request failed (403)');
  expect(page).not.toContain('Forbidden');
}

beforeEach(() => {
  writes = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each<Posture>(['group', 'isolated'])(
  'Packages page — a walled catalog-package refusal shows its reason, under `%s` (objectui#7611)',
  (posture) => {
    it('Delete app: the `DELETE /api/v1/packages/:id` refusal is shown with its code', async () => {
      serve(() =>
        json(403, { success: false, error: { code: 'PERMISSION_DENIED', message: deleteRefusal(posture), httpStatus: 403 } }, 'Forbidden'),
      );
      render(
        <MemoryRouter>
          <PackageDetailSheet pkg={PKG} open onOpenChange={() => {}} onChanged={() => {}} />
        </MemoryRouter>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Delete app' }));
      const dialog = await screen.findByTestId('pkg-detail-delete-dialog');
      fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-mode-all'));
      fireEvent.change(within(dialog).getByTestId('pkg-detail-delete-name-input'), { target: { value: PKG_NAME } });
      fireEvent.click(within(dialog).getByTestId('pkg-detail-delete-confirm'));

      await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', url: `/api/v1/packages/${PKG_ID}` }]));
      // The sheet leads with the first sentence; the whole refusal and its
      // code are behind "More" (objectui#13332).
      fireEvent.click(await screen.findByTestId('refusal-more'));
      await expectReasonShown(`${deleteRefusal(posture)} (PERMISSION_DENIED)`, posture);
    });

    it('Import: the install-local refusal of the file\'s manifest is shown with its code', async () => {
      serve(() =>
        json(
          403,
          {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: installRefusal(posture),
              details: { manifestId: PKG_ID, catalogItems: [{ type: 'position', name: 'acme_sales_lead' }] },
            },
          },
          'Forbidden',
        ),
      );
      const { container } = render(
        <MemoryRouter>
          <PackagesPage />
        </MemoryRouter>,
      );
      await screen.findByText(PKG_NAME);
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File([JSON.stringify({ id: PKG_ID, name: PKG_NAME, version: '1.0.0', type: 'app' })], 'crm.json', {
        type: 'application/json',
      });
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => expect(writes).toEqual([{ method: 'POST', url: '/api/v1/marketplace/install-local' }]));
      await expectReasonShown(`${installRefusal(posture)} (FORBIDDEN)`, posture);
    });
  },
);
