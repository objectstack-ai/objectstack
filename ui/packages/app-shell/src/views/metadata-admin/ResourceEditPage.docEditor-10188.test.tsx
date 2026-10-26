// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `doc` editor inside the ONE metadata edit flow (objectui#10188).
 *
 * `previews/DocPreview.test.tsx` pins the canvas on its own. This suite pins
 * that it is the `doc` type's editor in `MetadataResourceEditPage` — the page
 * every metadata type is created, edited and saved through — and not a second
 * path beside it:
 *
 *  1. create: the canvas is up during create (the body is written there), the
 *     form asks for the header keys, the title suggests the name, and Save
 *     sends ONE `PUT` through the standard door whose body parses clean on the
 *     spec's `DocSchema`;
 *  2. reload: the page, re-opened on what that save stored, shows the same
 *     Markdown and the same book section;
 *  3. refusal: when the server refuses the document, what it said reaches the
 *     author — the message of the real 17.5.0 envelope, not a blank.
 *
 * The served JSON Schema for `doc` is derived here from the spec's own
 * `DocSchema` (`z.toJSONSchema`), the conversion `GET /meta/types` performs, so
 * the form is the one an admin gets. The metadata client and the registry's
 * `markdown` renderer are stubbed (see `DocPreview.test.tsx` for why).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { ComponentRegistry } from '@object-ui/core';
import { DocSchema } from '@objectstack/spec/system';
import { MetadataClient, type MetadataError } from '@object-ui/data-objectstack';

type SaveOpts = { force?: boolean; mode?: string; packageId?: string };

const BOOK = {
  name: 'docprobe_manual',
  label: 'Probe Manual',
  groups: [
    { key: 'getting_started', label: 'Getting started', include: 'docprobe_gs_*' },
    { key: 'reference', label: 'Reference' },
  ],
};

const MARKDOWN = '# Getting started\n\n- one\n- two\n\n[the portal](https://example.com/docs)';

/** What the last accepted save stored — the "server" the reload reads back. */
let stored: Record<string, unknown> | null = null;

/** The error `MetadataClient` throws for a refused save, parsed from the wire body. */
async function parsedRefusal(status: number, wire: unknown): Promise<MetadataError> {
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async () =>
      new Response(JSON.stringify(wire), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });
  try {
    await client.save('doc', 'getting_started_guide', {});
  } catch (e) {
    return e as MetadataError;
  }
  throw new Error('the stub transport accepted the save: there is no refusal to hand the page');
}

const mockClient = {
  list: vi.fn(async (type: string): Promise<unknown[]> => (type === 'book' ? [BOOK] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, _name: string, _opts?: unknown) => ({
    effective: stored,
    code: null,
    editable: true,
    deletable: true,
  })),
  getDraft: vi.fn(async (_type: string, _name: string, _opts?: unknown) => (stored ? { item: stored } : null)),
  get: vi.fn(async () => null),
  save: vi.fn(async (_type: string, _name: string, item: unknown, _opts?: SaveOpts) => {
    stored = item as Record<string, unknown>;
    return {};
  }),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
  references: vi.fn(async () => []),
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        {
          type: 'doc',
          label: 'Documentation',
          domain: 'system',
          allowEnvironmentOverlay: false,
          allowRuntimeCreate: true,
          schema: DOC_JSON_SCHEMA,
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { registerBuiltinPreviews } from './previews';

/** The `doc` row's `schema`, converted from the spec the way the server does. */
const DOC_JSON_SCHEMA = z.toJSONSchema(DocSchema as unknown as z.ZodType) as Record<string, unknown>;

registerDefaultMetadataSchemas();
registerBuiltinPreviews();

const STUB_NS = 'doc-editor-page-test';
function StubMarkdown({ schema }: { schema: { content?: string } }) {
  return <div data-testid="markdown-render">{schema.content}</div>;
}
beforeAll(() => {
  ComponentRegistry.register('markdown', StubMarkdown as never, { namespace: STUB_NS });
});
afterAll(() => {
  ComponentRegistry.unregister('markdown', STUB_NS);
});

beforeEach(() => {
  stored = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderCreate() {
  render(
    <MemoryRouter initialEntries={['/metadata/doc/new']}>
      <Routes>
        <Route
          path="/metadata/doc/new"
          element={
            <>
              <MetadataResourceEditPage type="doc" name="" createMode />
              <Where />
            </>
          }
        />
        <Route path="/metadata/doc/:name" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderEdit(name: string) {
  render(
    <MemoryRouter initialEntries={[`/metadata/doc/${name}`]}>
      <Routes>
        <Route path="/metadata/doc/:name" element={<MetadataResourceEditPage type="doc" name={name} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const saveButton = () => screen.getByRole('button', { name: /Save \(⌘S\)|The server refused this draft/ });

/** Fill the create form and the canvas the way an admin does. */
async function authorGuide() {
  const source = await screen.findByRole('textbox', { name: 'Markdown source' });
  const label = document.getElementById('mdf-label') as HTMLInputElement | null;
  expect(label, 'the create form asks for the title (`label`)').not.toBeNull();
  fireEvent.change(label!, { target: { value: 'Getting Started Guide' } });
  await waitFor(() =>
    expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe('getting_started_guide'),
  );
  fireEvent.change(source, { target: { value: MARKDOWN } });
  // The book list has loaded once the placement readout shows; the section is
  // then picked through the shared `Select` (objectui#11865).
  await screen.findByTestId('doc-placement');
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Book section' }), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Reference' }));
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
}

describe('MetadataResourceEditPage — `doc` is authored through the one edit flow (objectui#10188)', () => {
  it('create: the canvas writes the body, and Save sends one spec-clean PUT through the standard door', async () => {
    renderCreate();
    await authorGuide();

    // The live preview tracks the unsaved draft.
    expect(within(screen.getByRole('region', { name: 'Live preview' })).getByTestId('markdown-render').textContent).toBe(
      MARKDOWN,
    );
    // The form does not also render the canvas-owned keys.
    expect(document.getElementById('mdf-content')).toBeNull();
    expect(document.getElementById('mdf-group')).toBeNull();

    fireEvent.click(saveButton());
    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));

    const [type, name, body, opts] = mockClient.save.mock.calls[0]!;
    expect([type, name]).toEqual(['doc', 'getting_started_guide']);
    expect(opts).toMatchObject({ mode: 'draft' });
    expect(body).toEqual({
      name: 'getting_started_guide',
      label: 'Getting Started Guide',
      content: MARKDOWN,
      group: 'reference',
    });
    const parsed = DocSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/getting_started_guide'));
  });

  it('reload: the page re-opened on what the save stored shows the same body and section', async () => {
    stored = {
      name: 'getting_started_guide',
      label: 'Getting Started Guide',
      content: MARKDOWN,
      group: 'reference',
    };
    renderEdit('getting_started_guide');

    const source = await screen.findByRole('textbox', { name: 'Markdown source' });
    expect(source).toHaveValue(MARKDOWN);
    expect(screen.getByTestId('markdown-render').textContent).toBe(MARKDOWN);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Book section' })).toHaveTextContent(/^Reference$/));
    expect(screen.getByTestId('doc-placement')).toHaveTextContent('Appears in: Probe Manual › Reference');
    expect(mockClient.layered).toHaveBeenCalledWith('doc', 'getting_started_guide', expect.anything());
  });

  it('refusal: the message the server returned reaches the author, not a blank', async () => {
    // The 17.5.0 server's answer to a doc carrying the retired `title` spelling,
    // measured against a live backend (status, code and body verbatim).
    const message =
      'Unrecognized key(s) on this doc: `title`. Did you mean `title` → `label`? Until this shape was closed, '
      + 'these were dropped silently — the doc still registered, just without whatever the key was meant to configure.';
    // The wire body goes through the REAL client's error parser, so the error
    // the page catches is the one production builds from that body — a
    // hand-assembled error carried `body.issues` and no parsed `issues`, a
    // shape no transport produces (objectui#11379).
    const refused = await parsedRefusal(422, {
      error: 'doc/getting_started_guide failed spec validation: 1 issue — <root> [unrecognized_keys]',
      code: 'INVALID_METADATA',
      issues: [{ path: '', message, code: 'unrecognized_keys' }],
    });
    mockClient.save.mockImplementationOnce(async () => {
      throw refused;
    });

    renderCreate();
    await authorGuide();
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockClient.save).toHaveBeenCalledTimes(1));
    // The banner leads with the first sentence; the server's whole message is
    // behind "More" (objectui#13332).
    expect(await screen.findByTestId('refusal-lead')).toHaveTextContent('Unrecognized key(s) on this doc: `title`.');
    fireEvent.click(screen.getByTestId('refusal-more'));
    expect((await screen.findAllByText(message)).length).toBeGreaterThan(0);
    // Still on the create page: a refused create does not navigate away.
    expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/new');
    expect(screen.getByRole('textbox', { name: 'Markdown source' })).toHaveValue(MARKDOWN);
  });
});
