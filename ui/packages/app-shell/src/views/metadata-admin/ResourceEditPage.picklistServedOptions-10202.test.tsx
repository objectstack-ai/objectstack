// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10202 — the metadata-admin object designer saves an object whose
 * fields name a shared picklist.
 *
 * ## The defect this file keeps fixed
 *
 * The runtime serves a picklist-bound field with `picklist` AND the options it
 * resolved from the list and its extensions (`PicklistServedFieldSchema`), and
 * the designer seeds its draft from that served read (`layers.effective`). The
 * authoring door refuses the two keys together, so before this card ANY edit of
 * such an object — renaming an unrelated field's label — PUT the served pair
 * back and came back `422 INVALID_METADATA` at `fields.FIELD.options`. Measured
 * on objectstack `main` (`faf8dce4`) with a picklist-bound field on a showcase
 * object: `PUT /api/v1/meta/object/NAME?mode=draft` with the served body →
 * 422, the issue path `fields.priority_tier.options`.
 *
 * The page is the real `MetadataResourceEditPage` with its registered object
 * canvas, field inspector and `object` resource config. The client is a real
 * `MetadataClient` (its `save` is the door that runs the write guard); only its
 * transport and the mount's reads are doubles. The transport refuses a body the
 * way the authoring door does — any field carrying `picklist` beside `options`
 * — so the claim is read off the WIRE.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

type Row = Record<string, unknown>;

/** The account object as the runtime SERVES it: `tier` resolved from its picklist, `status` inline. */
const SERVED: Row = {
  name: 'acme_account',
  label: 'Account',
  fields: {
    title: { type: 'text', label: 'Title' },
    tier: {
      type: 'select',
      label: 'Tier',
      picklist: 'acme_tier',
      options: [
        { label: 'Gold', value: 'gold' },
        { label: 'Silver', value: 'silver' },
        { label: 'Platinum', value: 'platinum' },
      ],
    },
    regions: {
      type: 'multiselect',
      label: 'Regions',
      picklist: 'acme_region',
      options: [{ label: 'EU', value: 'eu' }],
    },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'Open', value: 'open', color: '#22c55e' },
        { label: 'Closed', value: 'closed' },
      ],
    },
  },
};

const OBJECT_ENTRY = {
  type: 'object',
  name: 'object',
  label: 'Object',
  allowEnvironmentOverlay: true,
  schema: { type: 'object', properties: { label: { type: 'string', title: 'Label' } } },
};

/** The authoring door's refusal for a field carrying both keys, as `FieldSchema` words its path. */
function doorRefusal(body: Row): Array<{ path: string; message: string; code: string }> {
  const fields = (body.fields ?? {}) as Record<string, Row>;
  return Object.entries(fields)
    .filter(([, def]) => def && def.picklist !== undefined && def.options !== undefined)
    .map(([name]) => ({
      path: `fields.${name}.options`,
      message: '`picklist` and `options` cannot both be declared',
      code: 'custom',
    }));
}

const puts: Array<{ url: string; body: Row; status: number }> = [];

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    const body = JSON.parse(String(init.body)) as Row;
    const issues = doorRefusal(body);
    const status = issues.length > 0 ? 422 : 200;
    puts.push({ url, body, status });
    return status === 422
      ? new Response(JSON.stringify({ error: 'failed spec validation', code: 'INVALID_METADATA', issues }), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        })
      : new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});

/** The draft the server now holds: the last ACCEPTED PUT, or none. */
const storedDraft = (): Row | null => {
  const ok = puts.filter((p) => p.status === 200);
  return ok.length > 0 ? ok[ok.length - 1].body : null;
};

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  list: vi.fn(async (type: string) =>
    type === 'picklist'
      ? [
          { name: 'acme_tier', label: 'Tier', options: [{ label: 'Gold', value: 'gold' }, { label: 'Silver', value: 'silver' }] },
          { name: 'acme_region', label: 'Region', options: [{ label: 'EU', value: 'eu' }] },
        ]
      : [],
  ),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async () => SERVED),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({ effective: SERVED, code: SERVED, editable: true })),
  getDraft: vi.fn(async () => {
    const d = storedDraft();
    return d ? { item: d } : null;
  }),
});

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({ entries: [OBJECT_ENTRY] }),
  };
});

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { MetadataResourceEditPage } from './ResourceEditPage';
import { getMetadataResource } from './registry';
// The load-time registrations and the built-in resource configs, exactly as the
// package entry runs them.
import './register-builtins';
import '../../services/builtinComponents.js';
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

async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

function renderDesigner() {
  render(
    <MemoryRouter initialEntries={['/metadata/object/acme_account']}>
      <MetadataResourceEditPage type="object" name="acme_account" />
    </MemoryRouter>,
  );
}

/** Select `title` on the canvas and rename its label — an edit that touches no bound field. */
async function renameTitleLabel(next: string) {
  const card = (await screen.findAllByText('Title', {}, { timeout: 8000 }))
    .map((el) => el.closest('[role="button"]'))
    .find((el): el is HTMLElement => !!el);
  expect(card, 'the `title` field is on the canvas').toBeTruthy();
  fireEvent.click(card!);
  const input = (await screen.findByTestId('field-label-input', {}, { timeout: 8000 })) as HTMLInputElement;
  fireEvent.change(input, { target: { value: next } });
}

describe('metadata-admin object designer — a picklist-bound field saves without its served options (objectui#10202)', () => {
  it('THE PIN: an edit of an unrelated field saves; no bound field carries `options`, every other field is byte-identical', async () => {
    renderDesigner();
    await renameTitleLabel('Headline');
    await outlastDebounce();
    await waitFor(() => expect(puts.length).toBeGreaterThan(0), { timeout: 4000 });

    const sent = puts[puts.length - 1];
    expect(sent.status, `refused: ${JSON.stringify(doorRefusal(sent.body))}`).toBe(200);
    const fields = sent.body.fields as Record<string, Row>;
    // Every bound field leaves without `options` — not only the edited one.
    expect(fields.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    expect(fields.regions).toEqual({ type: 'multiselect', label: 'Regions', picklist: 'acme_region' });
    // Strip nothing else: the inline select keeps its options byte-identical.
    expect(JSON.stringify(fields.status)).toBe(JSON.stringify((SERVED.fields as Record<string, Row>).status));
    // The edit itself went out.
    expect(fields.title).toEqual({ type: 'text', label: 'Headline' });
    expect(puts.every((p) => p.status === 200)).toBe(true);
  });

  it('the live check does not tell the author to fix the served pair the save never sends', async () => {
    renderDesigner();
    await screen.findAllByText('Title', {}, { timeout: 8000 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(screen.queryByText(/cannot both be declared/)).toBeNull();
  });

  it('the registered `fromDraft` is the strip, and it leaves the editor draft untouched', () => {
    const fromDraft = getMetadataResource('object')?.fromDraft;
    expect(fromDraft).toBeTypeOf('function');
    const draft = JSON.parse(JSON.stringify(SERVED)) as Row;
    const body = fromDraft!(draft);
    expect((body.fields as Record<string, Row>).tier).not.toHaveProperty('options');
    expect((draft.fields as Record<string, Row>).tier).toHaveProperty('options');
  });
});
