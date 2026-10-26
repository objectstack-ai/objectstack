// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10202 — the read-only picklist page.
 *
 * Ruling 6006062645 item (c): name, label, options with labels, extensions with
 * their owning package; no create, edit or delete. The inputs below are the
 * shapes the runtime serves, measured on objectstack `main`:
 *
 *   - `GET /meta/picklist/NAME` → the owning list: `name`, `label`,
 *     `description`, its own `options`, `_packageId` — and NOT the extensions;
 *   - `GET /meta/package` → one row per installed package whose `manifest`
 *     carries its `picklistExtensions` as authored (`{ extend, options }`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

type Row = Record<string, unknown>;

/** The served list, as `GET /meta/picklist/showcase_priority_tier` answered. */
const SERVED_LIST: Row = {
  name: 'showcase_priority_tier',
  label: 'Priority Tier',
  description: 'Shared tier list',
  options: [
    { label: 'Gold', value: 'gold', color: '#d4af37' },
    { label: 'Silver', value: 'silver' },
    { label: 'Bronze', value: 'bronze' },
  ],
  _packageId: 'com.example.showcase',
  _packageVersion: '0.1.0',
  _provenance: 'package',
};

/** Package rows, in the shape `GET /meta/package` serves (reduced to the keys read here). */
const PACKAGES: Row[] = [
  {
    enabled: true,
    status: 'installed',
    manifest: {
      id: 'com.example.showcase',
      name: 'ObjectStack Showcase',
      picklists: [{ name: 'showcase_priority_tier' }],
      picklistExtensions: [],
    },
  },
  {
    enabled: true,
    status: 'installed',
    manifest: {
      id: 'com.acme.addon',
      name: 'Acme Add-on',
      picklistExtensions: [
        { extend: 'showcase_priority_tier', options: [{ label: 'Platinum', value: 'platinum' }] },
        { extend: 'some_other_list', options: [{ label: 'Elsewhere', value: 'elsewhere' }] },
      ],
    },
  },
  { enabled: true, status: 'installed', manifest: { id: 'com.objectstack.setup', name: 'Setup' } },
];

const packages = vi.hoisted(() => ({ answer: null as null | (() => Promise<unknown[]>) }));

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  const client = { list: async (type: string) => (type === 'package' && packages.answer ? packages.answer() : []) };
  return { ...mod, useMetadataClient: () => client };
});

import { PicklistPreview } from './PicklistPreview';
import { extensionsOf } from './picklist-extensions';
import { registerBuiltinPreviews } from './index';
import { getMetadataPreview } from '../preview-registry';

beforeEach(() => {
  packages.answer = async () => PACKAGES.map((p) => JSON.parse(JSON.stringify(p)) as Row);
});
afterEach(cleanup);

function renderPreview(draft: Row = SERVED_LIST) {
  return render(<PicklistPreview type="picklist" name="showcase_priority_tier" draft={draft} locale="en-US" />);
}

describe('PicklistPreview — the read-only picklist page (objectui#10202)', () => {
  it('is the registered preview for the `picklist` kind', () => {
    registerBuiltinPreviews();
    expect(getMetadataPreview('picklist')).toBe(PicklistPreview);
  });

  it('shows the name, label, description, owning package and each option with its label', async () => {
    renderPreview();
    expect(screen.getByText('Priority Tier')).toBeInTheDocument();
    expect(screen.getByText('showcase_priority_tier')).toBeInTheDocument();
    expect(screen.getByText('Shared tier list')).toBeInTheDocument();
    expect(screen.getByText('com.example.showcase')).toBeInTheDocument();
    const options = screen.getByRole('region', { name: 'Options' });
    for (const [label, value] of [['Gold', 'gold'], ['Silver', 'silver'], ['Bronze', 'bronze']]) {
      const row = within(options).getByText(label).closest('tr')!;
      expect(row).toHaveTextContent(value);
    }
    await screen.findAllByTestId('picklist-extension');
  });

  it('shows each extension under the package that declares it, and only those that extend THIS list', async () => {
    renderPreview();
    const ext = await screen.findAllByTestId('picklist-extension');
    expect(ext).toHaveLength(1);
    expect(ext[0]).toHaveTextContent('Added by Acme Add-on (com.acme.addon)');
    expect(ext[0]).toHaveTextContent('Platinum');
    expect(ext[0]).toHaveTextContent('platinum');
    expect(screen.queryByText('Elsewhere')).toBeNull();
  });

  it('offers no create, edit or delete: no button, input or link anywhere on the page', async () => {
    const { container } = renderPreview();
    await screen.findAllByTestId('picklist-extension');
    expect(container.querySelectorAll('button, input, textarea, select, a, [role="button"]')).toHaveLength(0);
    expect(screen.getByText(/Read-only: a picklist is owned by the package that declares it/)).toBeInTheDocument();
  });

  it('says so when no package extends the list', async () => {
    packages.answer = async () => [PACKAGES[0], PACKAGES[2]];
    renderPreview();
    expect(await screen.findByText('No package extends this picklist.')).toBeInTheDocument();
  });

  it('a failed package read says the extensions are unknown — never that there are none', async () => {
    packages.answer = async () => {
      throw new Error('HTTP 503');
    };
    renderPreview();
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('the extensions of this picklist are unknown');
    expect(notice).toHaveTextContent('HTTP 503');
    expect(screen.queryByText('No package extends this picklist.')).toBeNull();
  });

  it('extensionsOf reads the wrapped `{ item }` row shape too, and ignores rows without a manifest id', () => {
    const rows = extensionsOf('showcase_priority_tier', [
      { item: PACKAGES[1] },
      { manifest: { picklistExtensions: [{ extend: 'showcase_priority_tier', options: [{ label: 'X', value: 'x' }] }] } },
      null,
      'junk',
    ]);
    expect(rows).toEqual([
      { packageId: 'com.acme.addon', packageName: 'Acme Add-on', options: [{ label: 'Platinum', value: 'platinum' }] },
    ]);
  });
});
