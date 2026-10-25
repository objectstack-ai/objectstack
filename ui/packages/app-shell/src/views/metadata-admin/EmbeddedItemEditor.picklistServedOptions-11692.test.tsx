// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11692 — the embedded-item editor saves an item of an object whose
 * fields name a shared picklist.
 *
 * `EmbeddedItemEditor` saves an item that lives inside an object (one of its
 * `fields`, `indexes` or `validations`) by re-reading the parent's
 * `layered.effective` — the SERVED object, where a picklist-bound field carries
 * `picklist` AND the options the runtime resolved from the list — splicing the
 * item in, and PUTting the whole parent. The authoring door refuses `options`
 * beside `picklist` for the whole object (`422 INVALID_METADATA` at
 * `fields.FIELD.options`), so saving any item of such an object was refused for
 * a field the edit never touched.
 *
 * The client is a real `MetadataClient`: its `layered` read is served by a
 * double, and its transport refuses a PUT body the way the authoring door does,
 * so the claim is read off the WIRE. The editor is mounted directly, as its
 * sibling suites do.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

type Row = Record<string, unknown>;

/** The object as the runtime SERVES it: one bound field, one inline select, one number field. */
const SERVED: Row = {
  name: 'acme_account',
  label: 'Account',
  fields: {
    amount: { type: 'number', label: 'Amount' },
    tier: {
      type: 'select',
      label: 'Tier',
      picklist: 'acme_tier',
      options: [
        { label: 'Gold', value: 'gold' },
        { label: 'Platinum', value: 'platinum' },
      ],
    },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Closed', value: 'closed' },
      ],
    },
  },
};

const SERVED_FIELDS = SERVED.fields as Record<string, Row>;

/** The authoring door's refusal for a field carrying both keys. */
function doorRefusal(body: Row): string[] {
  return Object.entries((body.fields ?? {}) as Record<string, Row>)
    .filter(([, def]) => def && def.picklist !== undefined && def.options !== undefined)
    .map(([name]) => `fields.${name}.options`);
}

const puts: Array<{ url: string; body: Row; status: number }> = [];

const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'PUT') {
    const body = JSON.parse(String(init.body)) as Row;
    const refused = doorRefusal(body);
    const status = refused.length > 0 ? 422 : 200;
    puts.push({ url: String(url), body, status });
    return new Response(
      JSON.stringify(
        status === 422
          ? {
              error: 'failed spec validation',
              code: 'INVALID_METADATA',
              issues: refused.map((path) => ({
                path,
                code: 'custom',
                message: '`picklist` and `options` cannot both be declared. Keep `picklist` and delete `options`.',
              })),
            }
          : { success: true },
      ),
      { status, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: fetchImpl as unknown as typeof fetch });
Object.assign(client, {
  layered: vi.fn(async () => ({ effective: SERVED, code: SERVED, overlay: null, overlayScope: null })),
});

const FIELD_SCHEMA = {
  type: 'object',
  properties: { label: { type: 'string', title: 'Label' } },
} satisfies Record<string, unknown>;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'field', label: 'Field', allowEnvironmentOverlay: true, schema: FIELD_SCHEMA }],
  }),
}));

import { EmbeddedItemEditor } from './EmbeddedItemEditor';

afterEach(() => {
  cleanup();
  puts.length = 0;
  fetchImpl.mockClear();
});

async function saveItem(itemName: string): Promise<{ url: string; body: Row; status: number }> {
  render(
    <EmbeddedItemEditor
      parentType="object"
      parentName="acme_account"
      embeddedPath="fields"
      itemName={itemName}
      editAs="field"
      initialRaw={{ name: itemName, ...SERVED_FIELDS[itemName] }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /save into object/i }));
  await waitFor(() => expect(puts).toHaveLength(1));
  return puts[0]!;
}

describe('EmbeddedItemEditor — a picklist-bound object saves without its served options (objectui#11692)', () => {
  it('saving another item (`amount`): the door accepts the parent, the bound field without `options`, the inline select byte-identical', async () => {
    const put = await saveItem('amount');

    expect(put.status, `refused at ${doorRefusal(put.body).join(', ')}`).toBe(200);
    expect(put.url).toContain('/meta/object/acme_account');
    const fields = put.body.fields as Record<string, Row>;
    expect(fields.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    expect(JSON.stringify(fields.status)).toBe(JSON.stringify(SERVED_FIELDS.status));
    // The control: the edited item itself is in the body.
    expect(fields.amount).toEqual({ type: 'number', label: 'Amount' });
  });

  it('saving the bound field itself, untouched: the door accepts the parent, and the item keeps its binding without the served options', async () => {
    const put = await saveItem('tier');

    expect(put.status, `refused at ${doorRefusal(put.body).join(', ')}`).toBe(200);
    const fields = put.body.fields as Record<string, Row>;
    expect(fields.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    expect(JSON.stringify(fields.status)).toBe(JSON.stringify(SERVED_FIELDS.status));
  });
});
