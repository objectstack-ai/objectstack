// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11253 — the metadata-admin object editor never sends a new
 * `select` / `radio` without its options.
 *
 * This editor's order differs from the Studio data page's: the canvas palette
 * adds a choice field directly, and `object-fields-io.ts#newField` seeds it
 * with `options: []`. The contract's own completeness rule reads an empty list
 * as no option source at all, and the maintainer's ruling A on
 * objectstack#20827 refuses exactly that at the `FieldSchema` door, so an
 * empty list is the same defect as a missing one.
 *
 * The page is the real `MetadataResourceEditPage` with its registered object
 * canvas and field inspector. The client is a real `MetadataClient`, whose
 * `save` is the door that runs the object write guard; only its transport and
 * the mount's reads are doubles. So the claim is read off the WIRE: no PUT
 * carries a choice field without options, the held autosave says why and names
 * the field, and one option lets the next autosave go (the control).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const TASK = {
  name: 'acme_task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Title' } },
};

/** The server's `/meta/types` row for `object`, reduced to what the page reads. */
const OBJECT_ENTRY = {
  type: 'object',
  name: 'object',
  label: 'Object',
  // What makes the item writable, and so what turns the designer on.
  allowEnvironmentOverlay: true,
  schema: { type: 'object', properties: { label: { type: 'string', title: 'Label' } } },
};

/** Every PUT the transport received, parsed. */
const puts: Array<{ url: string; body: Record<string, unknown> }> = [];

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    puts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});

/** The draft the server now holds: the last PUT, or the published document. */
const current = (): Record<string, unknown> => (puts.length > 0 ? puts[puts.length - 1].body : TASK);

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => current()),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: current(), code: TASK, editable: true })),
  getDraft: vi.fn(async () => (puts.length > 0 ? { item: current() } : null)),
});

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({ entries: [OBJECT_ENTRY] }),
  };
});

// The page's own side reads (the AI agents roster, and the like) go through the
// global `fetch`; one double answers "absent" so each keeps its fallback. The
// metadata writes this suite measures go through `fetchImpl` above instead.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { MetadataResourceEditPage } from './ResourceEditPage';
// The load-time registrations, exactly as the package entry runs them, so the
// object canvas and field inspector mounted here are the ones production mounts.
import './register-builtins';
// The built-in designers, which the package entry registers from a chunk it
// loads with a dynamic `import()` (objectui#11939 step 2): called here, at
// module scope, so they are registered before the first render.
import { registerBuiltinDesigners } from './register-builtin-designers';
registerBuiltinDesigners();

afterEach(() => {
  cleanup();
  puts.length = 0;
  fetchImpl.mockClear();
});

type WireField = { name?: string; type?: unknown; options?: unknown; picklist?: unknown };

function wireFields(body: Record<string, unknown>): WireField[] {
  const fields = body.fields;
  if (Array.isArray(fields)) return fields as WireField[];
  if (fields && typeof fields === 'object') {
    return Object.entries(fields as Record<string, WireField>).map(([name, def]) => ({ name, ...def }));
  }
  return [];
}

/** The claim, read off the wire: a choice field with no option source. */
function choiceWithoutOptions(): WireField[] {
  return puts.flatMap((p) =>
    wireFields(p.body).filter(
      (f) =>
        (f.type === 'select' || f.type === 'radio') &&
        !(Array.isArray(f.options) && f.options.length > 0) &&
        typeof f.picklist !== 'string',
    ),
  );
}

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

describe('metadata-admin object editor — a new choice field is not sent without options (objectui#11253)', () => {
  for (const [type, paletteLabel, seededName] of [
    ['select', 'Picklist', 'status'],
    ['radio', 'Radio', 'radio'],
  ] as const) {
    it(`add a \`${type}\` from the palette, wait out the autosave: no request carries it without options`, async () => {
      render(
        <MemoryRouter initialEntries={['/metadata/object/acme_task']}>
          <MetadataResourceEditPage type="object" name="acme_task" />
        </MemoryRouter>,
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Add field' }, { timeout: 8000 }));
      fireEvent.click(await screen.findByRole('button', { name: paletteLabel }));
      await outlastDebounce();

      // Held: the seeded `options: []` never reached the wire.
      expect(choiceWithoutOptions()).toEqual([]);
      const banner = await screen.findByText(new RegExp(`\`${seededName}\``));
      expect(banner).toHaveTextContent(/no options/);

      // CONTROL: one option lets the next autosave go, and the banner clears.
      fireEvent.change(await screen.findByPlaceholderText('value'), { target: { value: 'open' } });
      await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 4000 });
      const sent = wireFields(puts[puts.length - 1].body).find((f) => f.name === seededName);
      expect(sent?.type).toBe(type);
      expect(sent?.options).toEqual([expect.objectContaining({ value: 'open' })]);
      expect(choiceWithoutOptions()).toEqual([]);
      await waitFor(() => expect(screen.queryByText(new RegExp(`\`${seededName}\``))).toBeNull());
    });
  }
});
