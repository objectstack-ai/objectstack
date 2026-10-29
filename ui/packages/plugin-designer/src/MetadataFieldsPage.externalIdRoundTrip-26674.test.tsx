/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26674 — a stored `externalId: true` survives a Studio
 * edit-and-save through this page, now that the designer drawer no longer
 * offers the switch.
 *
 * `field.externalId` is graded `dead` but NOT retired: `FieldSchema` still
 * parses it, so removing the control must never strip a stored value. This
 * runs the REAL `FieldDesigner` (only the grid and form renderers are mocked)
 * over a REAL `MetadataClient` and a fetch double, so the assertion is on the
 * PUT bytes after the drawer's own update path ran — the path that wrote
 * `externalId: data.externalId === true` before this card.
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
 * `code` is the field the author edits; `sku` carries the flag on a field the
 * author never opens; `title` is the control with no flag at all.
 */
const OBJECT_BODY = {
  name: 'probe_widget',
  label: 'Widget',
  fields: {
    code: { type: 'text', label: 'Code', externalId: true },
    sku: { type: 'text', label: 'SKU', externalId: true },
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
      if (/\/meta\/object\/probe_widget(\?|$)/.test(url)) return json(OBJECT_ENVELOPE);
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

describe('objectstack#26674 · a stored externalId survives an edit-and-save', () => {
  it('keeps `externalId: true` on the edited field and on an untouched one', async () => {
    render(<MetadataFieldsPage objectName="probe_widget" client={realClient()} />);

    fireEvent.click(await screen.findByTestId('grid-edit-code'));
    await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());
    // The drawer no longer offers the switch it would otherwise have reset.
    expect(screen.getByTestId('drawer-field-trackHistory')).toBeTruthy();
    expect(screen.queryByTestId('drawer-field-externalId')).toBeNull();

    fireEvent.click(screen.getByTestId('drawer-submit'));
    await waitFor(() => expect(puts).toHaveLength(1));

    const fields = savedFields();
    expect(fields.code.externalId).toBe(true);
    expect(fields.sku.externalId).toBe(true);
    // Control: a field that never carried the flag does not gain one.
    expect(fields.title.externalId).toBeUndefined();
    // Falsification: the save re-serialised the edited field intact.
    expect(fields.code.label).toBe('Code');
    expect(fields.code.type).toBe('text');
  });

  it('every field it PUTs still parses through the real FieldSchema', async () => {
    render(<MetadataFieldsPage objectName="probe_widget" client={realClient()} />);

    fireEvent.click(await screen.findByTestId('grid-edit-code'));
    await waitFor(() => expect(screen.getByTestId('mock-drawer-form')).toBeTruthy());
    fireEvent.click(screen.getByTestId('drawer-submit'));
    await waitFor(() => expect(puts).toHaveLength(1));

    for (const [name, def] of Object.entries(savedFields())) {
      expect(FieldSchema.safeParse(def).success, `field \`${name}\` did not parse`).toBe(true);
    }
  });
});
