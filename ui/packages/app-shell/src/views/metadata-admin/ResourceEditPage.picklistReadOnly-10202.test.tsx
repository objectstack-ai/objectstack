// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10202 — the Studio picklist page is READ-ONLY, through the generic
 * resource route (ruling 6006062645 item (c)).
 *
 * The kind is package-owned: its `/meta/types` row declares
 * `allowRuntimeCreate: false` and `allowEnvironmentOverlay: false`, and the layered
 * read of a packaged list answers `lock: 'full'`, `editable: false`,
 * `deletable: false` (all measured on objectstack `main`). The generic list and
 * edit pages already honour that row, so this card adds no read-only mechanism
 * of its own: it registers the detail view (`PicklistPreview`) and pins that
 * the page built from the two offers no create, no edit and no delete — the
 * three things the server refuses for this kind.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

type Row = Record<string, unknown>;

/** The `/meta/types` row for `picklist`, as the runtime serves it. */
const PICKLIST_ENTRY = {
  type: 'picklist',
  label: 'Picklist',
  description: 'Shared option list that select fields reference by name',
  supportsOverlay: false,
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: false,
  supportsVersioning: false,
  domain: 'data',
  schema: { type: 'object', properties: { name: { type: 'string' }, label: { type: 'string' } } },
};

const LIST: Row = {
  name: 'showcase_priority_tier',
  label: 'Priority Tier',
  options: [
    { label: 'Gold', value: 'gold' },
    { label: 'Silver', value: 'silver' },
  ],
  _packageId: 'com.example.showcase',
  _provenance: 'package',
};

const PACKAGE_ROW = { manifest: { id: 'com.example.showcase', name: 'ObjectStack Showcase', scope: 'project' } };

const writes = vi.hoisted(() => [] as string[]);

const client = vi.hoisted(() => ({
  list: async (type: string) => (type === 'picklist' ? [LIST] : type === 'package' ? [PACKAGE_ROW] : []),
  listDrafts: async () => [],
  get: async () => LIST,
  references: async () => [],
  layered: async () => ({
    code: LIST,
    overlay: null,
    overlayScope: null,
    effective: LIST,
    lock: 'full',
    provenance: 'package',
    packageId: 'com.example.showcase',
    editable: false,
    deletable: false,
    resettable: true,
  }),
  getDraft: async () => null,
  save: async (type: string, name: string) => {
    writes.push(`save ${type}/${name}`);
    return {};
  },
  reset: async (type: string, name: string) => {
    writes.push(`reset ${type}/${name}`);
    return {};
  },
  publish: async (type: string, name: string) => {
    writes.push(`publish ${type}/${name}`);
    return {};
  },
}));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({ entries: [PICKLIST_ENTRY] }),
  };
});

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { MetadataResourceEditPage } from './ResourceEditPage';
import { MetadataResourceListPage } from './ResourceListPage';
import './register-builtins';
import '../../services/builtinComponents.js';
// The built-in designers, which the package entry registers from a chunk it
// loads with a dynamic `import()` (objectui#11939 step 2): called here, at
// module scope, so they are registered before the first render.
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

// Pre-declared so a regression to an enabled button or a link reads by name.
const WRITE_VERB = /^(new|create|save|edit|delete|reset|publish|add)\b/i;

afterEach(() => {
  cleanup();
  writes.length = 0;
});

describe('Studio picklist page — read-only through the generic route (objectui#10202)', () => {
  it('the list offers no create', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/setup/metadata/picklist?package=com.example.showcase']}>
        <Routes>
          <Route path="/apps/:appName/metadata/:type" element={<MetadataResourceListPage type="picklist" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('showcase_priority_tier', {}, { timeout: 8000 })).toBeInTheDocument();
    const offered = screen.queryAllByRole('button').filter((b) => WRITE_VERB.test((b.textContent ?? '').trim()));
    expect(offered.map((b) => b.textContent)).toEqual([]);
  });

  it('the detail page shows the list through its preview, and offers no edit or delete', async () => {
    render(
      <MemoryRouter initialEntries={['/metadata/picklist/showcase_priority_tier']}>
        <MetadataResourceEditPage type="picklist" name="showcase_priority_tier" />
      </MemoryRouter>,
    );
    const options = await screen.findByRole('region', { name: 'Options' }, { timeout: 8000 });
    expect(within(options).getByText('Gold')).toBeInTheDocument();
    expect(within(options).getByText('Silver')).toBeInTheDocument();

    // Every enabled control's name, and every write verb among them.
    const enabledWrites = screen
      .queryAllByRole('button')
      .filter((b) => !(b as HTMLButtonElement).disabled)
      .map((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim())
      .filter((n) => WRITE_VERB.test(n));
    expect(enabledWrites).toEqual([]);
    expect(writes).toEqual([]);
  });
});
