// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — the metadata editor's CREATE is the first-write pin.
 *
 * A create has read nothing, so it has no version to send. The `/meta` door
 * of `@objectstack/*` 18 takes `If-None-Match: *` for that case — "save only
 * where no draft row of this name is" — and refuses it `409 METADATA_CONFLICT`
 * where one is, instead of writing the new skeleton over it. It also reads the
 * pin as a create, which picks the create remedy on a sealed name
 * (objectstack-ai/objectstack#22591). Before this, `doSave` sent a create with
 * no precondition at all, which the door reads as an edit.
 *
 * The REAL page over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the published 18.0.0-next.0 door was measured to: the
 * request headers it saw are recorded. The `doc` type's editor stands in for
 * every type (the create flow is the page's own), as in
 * `ResourceEditPage.layersUnsaved-11799.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { ComponentRegistry } from '@object-ui/core';
import { DocSchema } from '@objectstack/spec/system';
import { MetadataClient } from '@object-ui/data-objectstack';

const server = {
  drafts: new Map<string, { body: Record<string, unknown>; version: string }>(),
  puts: [] as Array<{ name: string; ifMatch: string | null; ifNoneMatch: string | null; status: number }>,
  seq: 0,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') {
    return json(200, { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1] })) });
  }
  if (seg.length === 1) return json(200, { items: [] });
  if (seg.length === 3) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  if (method === 'PUT') {
    const headers = new Headers(init?.headers);
    const ifMatch = headers.get('If-Match');
    const ifNoneMatch = headers.get('If-None-Match');
    const head = server.drafts.get(key)?.version ?? null;
    const refused =
      (ifMatch !== null && ifMatch !== head) || (ifNoneMatch !== null && head !== null);
    const status = ifMatch !== null && ifNoneMatch !== null ? 400 : refused ? 409 : 200;
    server.puts.push({ name: seg[1]!, ifMatch, ifNoneMatch, status });
    if (status === 400) return json(400, { error: { code: 'VALIDATION_ERROR', message: 'Send If-Match or If-None-Match, not both.' } });
    if (status === 409) {
      return json(409, {
        error: `${key} has been modified since you loaded it. Expected parent null but current is ${head}.`,
        code: 'METADATA_CONFLICT',
        currentVersion: head,
      });
    }
    server.seq += 1;
    const version = `hmac-sha256:v${server.seq}`;
    server.drafts.set(key, { body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, version });
    return json(200, { success: true, version, seq: server.seq, state: 'draft', message: `Saved ${key}` });
  }
  const row = url.searchParams.get('state') === 'draft' ? server.drafts.get(key) : undefined;
  if (!row) return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
  return json(200, { type: seg[0], name: seg[1], item: { ...row.body, _draft: true }, version: row.version });
}

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        { type: 'doc', label: 'Documentation', domain: 'system', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: DOC_JSON_SCHEMA },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { registerBuiltinPreviews } from './previews';

const DOC_JSON_SCHEMA = z.toJSONSchema(DocSchema as unknown as z.ZodType) as Record<string, unknown>;
client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
registerBuiltinPreviews();

const STUB_NS = 'create-first-write-pin-11773';
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
  server.drafts.clear();
  server.puts = [];
  server.seq = 0;
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const source = () => screen.findByRole('textbox', { name: 'Markdown source' }, { timeout: 8000 });
const saveButton = () => screen.getByRole('button', { name: /Save \(⌘S\)/ });

/** Open the create form, name the doc "New Guide", give it a body, and press Save. */
async function createNewGuide() {
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
  const label = await waitFor(() => {
    const el = document.getElementById('mdf-label') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el!;
  }, { timeout: 8000 });
  fireEvent.change(label, { target: { value: 'New Guide' } });
  await waitFor(() => expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe('new_guide'));
  fireEvent.change(await source(), { target: { value: '# New' } });
  fireEvent.click(saveButton());
}

describe('MetadataResourceEditPage — a create sends If-None-Match: * (objectui#11773)', () => {
  it('the create is sent with the first-write pin and no If-Match, and lands', async () => {
    await createNewGuide();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/new_guide'), { timeout: 8000 });
    expect(server.puts).toEqual([{ name: 'new_guide', ifMatch: null, ifNoneMatch: '*', status: 200 }]);
    expect(server.drafts.get('doc/new_guide')?.body).toMatchObject({ name: 'new_guide', content: '# New' });
  });

  it('a create over a name that already holds a draft is refused, and that draft is not written over', async () => {
    server.drafts.set('doc/new_guide', { body: { name: 'new_guide', content: '# Someone else\'s' }, version: 'hmac-sha256:theirs' });
    await createNewGuide();
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    expect(server.puts[0]).toEqual({ name: 'new_guide', ifMatch: null, ifNoneMatch: '*', status: 409 });
    expect(server.drafts.get('doc/new_guide')?.body).toEqual({ name: 'new_guide', content: '# Someone else\'s' });
    // The page stays on the create form: nothing was created.
    expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/new');
  });
});
