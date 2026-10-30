// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27865 — New Permission Set: one mistake is one message.
 *
 *   (a) a Name the client validator refuses holds the save: no `PUT` leaves,
 *       even on a click inside the live pass's debounce, and the inline error
 *       on Name is the only message (no summary banner, no server refusal);
 *   (b) a Name the client accepts but the server refuses, naming `name`, is
 *       said once: inline on Name, with no banner repeating it;
 *   (c) a Name derived from the Label, never touched, is held the same way,
 *       and the Save attempt shows its error inline (the create form's
 *       show-on-touch deferral ends there);
 *   (d) a good Name saves (control);
 *   (e) the hold's BOUND: a good Name beside a client-refused key that is not
 *       the identity (the server-gained-a-key skew shape the advisory ruling
 *       is about) still sends — only the Name holds a create.
 *
 * The REAL page over a REAL `MetadataClient` whose transport is an in-memory
 * server that records every `PUT` and answers the way the save door does: an
 * ungrammatical name is a 400 `INVALID_REQUEST` with no issues
 * (`refuseUngrammaticalMetaItemName`), and `taken_set` stands for a name the
 * client cannot judge, refused 422 with an issue at `name`.
 *
 * That the live Zod pass stays advisory everywhere else is pinned, unchanged,
 * in `ResourceEditPage.schemaAdvisory.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { z } from 'zod';
import { getMetadataCreateSeed, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { METADATA_ITEM_NAME_PATTERN } from '@objectstack/spec/shared';
import { MetadataClient } from '@object-ui/data-objectstack';

const TAKEN = 'taken_set';
const TAKEN_MESSAGE = 'A permission set with this name already exists.';

const server = {
  puts: [] as Array<{ name: string; body: Record<string, unknown> }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (seg.length === 1) return json(200, { items: [] });
  if (method === 'PUT') {
    const name = seg[1]!;
    server.puts.push({ name, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    if (!METADATA_ITEM_NAME_PATTERN.test(name)) {
      return json(400, {
        success: false,
        error: { code: 'INVALID_REQUEST', message: `${JSON.stringify(name)} is not a legal metadata item name.` },
      });
    }
    if (name === TAKEN) {
      return json(422, {
        success: false,
        error: { code: 'INVALID_METADATA', message: 'Invalid permission', details: { issues: [{ path: ['name'], message: TAKEN_MESSAGE }] } },
      });
    }
    return json(200, { success: true, version: 'hmac-sha256:v1', seq: 1, state: 'draft', message: `Saved ${seg[0]}/${name}` });
  }
  return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
}

const client = vi.hoisted(() => ({ current: null as unknown }));
/** Extra keys the served create seed carries — set by (e) only. */
const seedExtra = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        {
          type: 'permission',
          label: 'Permission Set',
          domain: 'security',
          allowEnvironmentOverlay: true,
          allowRuntimeCreate: true,
          schema: PERMISSION_JSON_SCHEMA,
          createSeed: { ...getMetadataCreateSeed('permission'), ...seedExtra.current },
        },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { registerBuiltinAnchors } from './anchors';

const PERMISSION_JSON_SCHEMA = z.toJSONSchema(getMetadataTypeSchema('permission') as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
// The live registration: Label → Name derive, `createLive`.
registerBuiltinAnchors();

beforeEach(() => {
  server.puts = [];
  seedExtra.current = {};
});
afterEach(() => {
  cleanup();
});

const saveButton = () => screen.getByTestId('resource-save');

async function openNewPermissionSet() {
  render(
    <MemoryRouter initialEntries={['/metadata/permission/new']}>
      <Routes>
        <Route path="/metadata/permission/new" element={<MetadataResourceEditPage type="permission" name="" createMode />} />
        <Route path="/metadata/permission/:name" element={<div data-testid="landed" />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByRole('textbox', { name: /^Name/ }, { timeout: 8000 });
}

/** The one message: exactly one inline issue, said nowhere else on the page. */
async function expectOnlyInlineIssue(): Promise<string> {
  const inline = await screen.findAllByTestId('schema-form-issue', {}, { timeout: 8000 });
  expect(inline).toHaveLength(1);
  const text = inline[0]!.textContent ?? '';
  expect(text).not.toBe('');
  expect(screen.getAllByText(text, { exact: false })).toHaveLength(1);
  expect(screen.queryByTestId('metadata-validation-banner')).toBeNull();
  return text;
}

describe('New Permission Set: one mistake, one message (objectstack#27865)', () => {
  it('(a) a Name the client refuses holds the save — no PUT, only the inline error', async () => {
    const nameBox = await openNewPermissionSet();
    fireEvent.change(nameBox, { target: { value: 'Bad Name' } });
    // Inside the live pass's 200 ms debounce: the hold must not depend on it.
    fireEvent.click(saveButton());
    await expectOnlyInlineIssue();
    await new Promise((r) => setTimeout(r, 300));
    expect(server.puts).toEqual([]);
    expect(screen.queryByText(/is not a legal metadata item name/)).toBeNull();
    expect(screen.queryByTestId('landed')).toBeNull();
    // A second click is held the same way.
    fireEvent.click(saveButton());
    await new Promise((r) => setTimeout(r, 300));
    expect(server.puts).toEqual([]);
    await expectOnlyInlineIssue();
  });

  it('(b) a Name the client accepts but the server refuses at `name` is said once, inline', async () => {
    const nameBox = await openNewPermissionSet();
    fireEvent.change(nameBox, { target: { value: TAKEN } });
    fireEvent.blur(nameBox);
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    const text = await expectOnlyInlineIssue();
    expect(text).toContain(TAKEN_MESSAGE);
    expect(screen.queryByTestId('landed')).toBeNull();
  });

  it('(c) a derived, untouched Name the client refuses is held and its error shown inline', async () => {
    await openNewPermissionSet();
    const labelBox = screen.getByRole('textbox', { name: /^Label/ });
    fireEvent.change(labelBox, { target: { value: 'A' } });
    // Single-letter slug: refused by the spec's two-character floor.
    await waitFor(() => expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('a'));
    expect(screen.queryAllByTestId('schema-form-issue')).toHaveLength(0);
    fireEvent.click(saveButton());
    await expectOnlyInlineIssue();
    await new Promise((r) => setTimeout(r, 300));
    expect(server.puts).toEqual([]);
  });

  it('(d) a good Name saves (control)', async () => {
    const nameBox = await openNewPermissionSet();
    fireEvent.change(nameBox, { target: { value: 'sales_ops' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    expect(server.puts[0]!.name).toBe('sales_ops');
    await screen.findByTestId('landed', {}, { timeout: 8000 });
  });

  it('(e) a good Name beside a client-refused non-identity key still sends — the hold is the Name only', async () => {
    // A key the bundled spec does not declare, served in the create seed: the
    // client's strict pass refuses it at the root, the (newer) server takes it.
    seedExtra.current = { zzServerOnlyKey: true };
    const nameBox = await openNewPermissionSet();
    fireEvent.change(nameBox, { target: { value: 'sales_ops' } });
    // The client does refuse the draft — surfaced, advisory — and not at Name.
    const banner = await screen.findByTestId('metadata-validation-banner', {}, { timeout: 8000 });
    expect(banner.textContent).toContain('(root)');
    expect(screen.queryAllByTestId('schema-form-issue')).toHaveLength(0);
    fireEvent.click(saveButton());
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    expect(server.puts[0]!.name).toBe('sales_ops');
    expect(server.puts[0]!.body.zzServerOnlyKey).toBe(true);
    await screen.findByTestId('landed', {}, { timeout: 8000 });
  });
});
