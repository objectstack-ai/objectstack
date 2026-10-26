// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11804 — the package sheet's "Pending changes" header is valid markup.
 *
 * Measured before the fix through the real `PackageDetailSheet`: the header was
 * a `<p>` holding the draft-count `Badge`, and the `Badge` primitive renders a
 * `<div>`. A `<div>` inside a `<p>` is invalid HTML, so React logged a nesting
 * error every time a package with pending drafts opened the sheet — the
 * console's metadata admin and Studio's *Package info & settings* both open
 * this same sheet. A package with no drafts renders no such header and logged
 * nothing, which is why the second case below stays green either way.
 *
 * The header is now a `div` with the same classes. Pinned from the DOM (no
 * `<p>` in the sheet holds a block child) and from the console (no nesting
 * error) — the DOM half does not depend on React's wording.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PackageDetailSheet, type InstalledPackageRow } from './PackagesPage';

const PKG: InstalledPackageRow = {
  manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', type: 'app' },
  enabled: true,
  status: 'installed',
  source: 'authored',
  writable: true,
};

/** The kind of React error this card is about: a DOM-nesting violation. */
const NESTING = /cannot be a descendant of|cannot contain a nested/;

let drafts: Array<{ type: string; name: string }>;
let errors: string[];

function respond(body: unknown) {
  const text = JSON.stringify(body);
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
}

beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(' '));
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) =>
      input.startsWith('/api/v1/meta/_drafts')
        ? respond({ success: true, data: { drafts } })
        : respond({ success: true, data: {} }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderSheet() {
  render(
    <MemoryRouter>
      <PackageDetailSheet pkg={PKG} open onOpenChange={() => {}} onChanged={() => {}} />
    </MemoryRouter>,
  );
  await screen.findAllByText('Acme CRM');
  // Let the drafts fetch land and the header render.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Every `<p>` in the document that holds a block-level element. */
function paragraphsHoldingBlocks(): HTMLParagraphElement[] {
  return Array.from(document.querySelectorAll('p')).filter((p) => p.querySelector('div, p, ul, ol, table'));
}

describe('PackageDetailSheet — the pending-changes header is valid markup (objectui#11804)', () => {
  it('a package with drafts renders the header and its count badge, with no block inside a <p>', async () => {
    drafts = [
      { type: 'object', name: 'acme_lead' },
      { type: 'view', name: 'acme_lead_list' },
    ];
    await renderSheet();

    const header = await screen.findByText('Pending changes');
    // The count badge still sits inside the header, beside its label.
    expect(header.textContent).toBe(`Pending changes${drafts.length}`);

    expect(errors.filter((e) => NESTING.test(e))).toEqual([]);
    expect(paragraphsHoldingBlocks()).toEqual([]);
    expect(header.tagName).not.toBe('P');
  });

  it('a package with no drafts renders no header and logs no nesting error', async () => {
    drafts = [];
    await renderSheet();

    expect(screen.queryByText('Pending changes')).toBeNull();
    expect(paragraphsHoldingBlocks()).toEqual([]);
    expect(errors.filter((e) => NESTING.test(e))).toEqual([]);
  });
});
