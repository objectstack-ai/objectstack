/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#36290 — an edit-and-save through this page
 * carries the field's `fieldHistory` both ways and never writes
 * `trackHistory`. Before this card the drawer's update path wrote
 * `trackHistory: data.trackHistory === true`, so every saved field gained an
 * explicit `false`, and the page had no `fieldHistory` to carry.
 *
 * The REAL `FieldDesigner` (only the grid and form renderers are mocked; the
 * form mock submits the drawer's initial values) over a REAL `MetadataClient`
 * and a fetch double: the assertions are on the PUT bytes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FieldSchema } from '@objectstack/spec/data';
import { MetadataClient } from '@object-ui/data-objectstack';

vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__tests__/__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__tests__/__mocks__/plugin-form')),
}));

import { MetadataFieldsPage } from './MetadataFieldsPage';

/**
 * objectstack#30786 — the page takes its edit base off the layered read
 * (`GET …/layers`, `overlay ?? code`), not the served item read, so this double
 * answers that read: the item it used to serve becomes the `code` layer (and
 * `effective`), beside the same envelope carriers.
 */
function servedAsLayers({ item, ...carriers }: { item: unknown } & Record<string, unknown>) {
  return { ...carriers, code: item, overlay: null, effective: item };
}

/**
 * `muted` turns its values off; `photo` opts a media field in through the
 * older key; `title` carries neither.
 */
const OBJECT_BODY = {
  name: 'probe_widget',
  label: 'Widget',
  fields: {
    muted: { type: 'text', label: 'Muted', fieldHistory: false },
    photo: { type: 'image', label: 'Photo', trackHistory: true },
    title: { type: 'text', label: 'Title' },
  },
};

const OBJECT_ENVELOPE = {
  type: 'object',
  name: 'probe_widget',
  item: OBJECT_BODY,
  lock: 'none',
  provenance: 'org',
  editable: true,
};

let puts: Array<Record<string, unknown>> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return json({ success: true, name: 'probe_widget' });
      }
      if (/\/meta\/object\/probe_widget\/layers(\?|$)/.test(url)) return json(servedAsLayers(OBJECT_ENVELOPE));
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

/** The fields map exactly as it went over the wire on the last PUT. */
function savedFields(): Record<string, Record<string, unknown>> {
  return puts[puts.length - 1].fields as Record<string, Record<string, unknown>>;
}

beforeEach(() => {
  puts = [];
});

afterEach(cleanup);

async function editAndSave(name: string) {
  render(<MetadataFieldsPage objectName="probe_widget" client={realClient()} />);
  fireEvent.click(await screen.findByTestId(`grid-edit-${name}`));
  await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());
  fireEvent.click(screen.getByTestId('drawer-submit'));
  await waitFor(() => expect(puts).toHaveLength(1));
  return savedFields();
}

describe('objectstack#36290 · fieldHistory round-trips, trackHistory is never written', () => {
  it('keeps a stored fieldHistory: false on the edited field, and writes no trackHistory', async () => {
    const fields = await editAndSave('muted');
    expect(fields.muted.fieldHistory).toBe(false);
    expect(fields.muted).not.toHaveProperty('trackHistory');
    // Falsification: the save re-serialised the edited field intact.
    expect(fields.muted.label).toBe('Muted');
  });

  it('keeps a stored trackHistory: true through an edit, and adds no fieldHistory', async () => {
    const fields = await editAndSave('photo');
    expect(fields.photo.trackHistory).toBe(true);
    expect(fields.photo).not.toHaveProperty('fieldHistory');
  });

  it('CONTROL: a field with neither key gains neither', async () => {
    const fields = await editAndSave('title');
    expect(fields.title).not.toHaveProperty('trackHistory');
    expect(fields.title).not.toHaveProperty('fieldHistory');
  });

  it('every field it PUTs parses through the real FieldSchema', async () => {
    const fields = await editAndSave('muted');
    for (const [name, def] of Object.entries(fields)) {
      expect(FieldSchema.safeParse(def).success, `field \`${name}\` did not parse`).toBe(true);
    }
  });
});
