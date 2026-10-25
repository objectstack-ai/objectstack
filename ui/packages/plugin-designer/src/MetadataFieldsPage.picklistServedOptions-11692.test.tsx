/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11692 — the Setup fields page saves an object whose fields name a
 * shared picklist.
 *
 * The page reads the object through `MetadataClient.get()` — the SERVED form,
 * where a picklist-bound field carries `picklist` AND the options the runtime
 * resolved from the list — and writes the whole document back with every
 * per-field key carried over. The authoring door refuses `options` beside
 * `picklist` for the whole object (`422 INVALID_METADATA` at
 * `fields.FIELD.options`), so relabelling an unrelated field was refused.
 *
 * Both halves of the page's field map are covered: a bound `select` (a type the
 * drawer authors, rebuilt through `fromDesignerField`) and a bound `multiselect`
 * (a type it only carries, through `carryPreservedField`).
 *
 * A REAL `MetadataClient` over a fetch double that answers the single-item read
 * with the server's envelope and refuses a PUT body the way the authoring door
 * does, so the claim is read off the WIRE. `FieldDesigner` is the only other
 * double, a prop recorder, as in `MetadataFieldsPage.saveEnvelope.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { DesignerFieldDefinition } from '@object-ui/types';

type Row = Record<string, unknown>;

/** The object as the runtime SERVES it. */
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
        { label: 'Open', value: 'open' },
        { label: 'Closed', value: 'closed' },
      ],
    },
  },
};

const SERVED_STATUS = JSON.stringify((SERVED.fields as Record<string, Row>).status);

interface RecordedDesignerProps {
  fields: DesignerFieldDefinition[];
  onFieldsChange?: (fields: DesignerFieldDefinition[]) => void;
}

let designerProps: RecordedDesignerProps | null = null;

vi.mock('./FieldDesigner', () => ({
  FieldDesigner: (props: RecordedDesignerProps) => {
    designerProps = props;
    return null;
  },
}));

import { MetadataFieldsPage } from './MetadataFieldsPage';

/** The authoring door's refusal for a field carrying both keys. */
function doorRefusal(body: Row): string[] {
  return Object.entries((body.fields ?? {}) as Record<string, Row>)
    .filter(([, def]) => def && def.picklist !== undefined && def.options !== undefined)
    .map(([name]) => `fields.${name}.options`);
}

let puts: Array<{ body: Row; status: number }> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Row;
        const refused = doorRefusal(body);
        const status = refused.length > 0 ? 422 : 200;
        puts.push({ body, status });
        return status === 422
          ? json(
              {
                error: 'failed spec validation',
                code: 'INVALID_METADATA',
                issues: refused.map((path) => ({
                  path,
                  code: 'custom',
                  message: '`picklist` and `options` cannot both be declared. Keep `picklist` and delete `options`.',
                })),
              },
              422,
            )
          : json({ success: true, name: 'acme_account' });
      }
      if (/\/meta\/object\/acme_account(\?|$)/.test(url)) {
        return json({ type: 'object', name: 'acme_account', item: SERVED });
      }
      return json({ items: [] });
    }) as unknown as typeof fetch,
  });
}

beforeEach(() => {
  puts = [];
  designerProps = null;
});

describe('MetadataFieldsPage — a picklist-bound object saves without its served options (objectui#11692)', () => {
  it('relabelling an unrelated field: the door accepts the body, no bound field carries `options`, the inline select is byte-identical', async () => {
    render(<MetadataFieldsPage objectName="acme_account" client={realClient()} />);
    await waitFor(() => expect(designerProps?.fields.map((f) => f.name)).toEqual(['title', 'tier', 'status']));

    const next = designerProps!.fields.map((f) => (f.name === 'title' ? { ...f, label: 'Headline' } : f));
    await act(async () => {
      designerProps!.onFieldsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    const [put] = puts;
    expect(put!.status, `refused at ${doorRefusal(put!.body).join(', ')}`).toBe(200);
    const fields = put!.body.fields as Record<string, Row>;
    // The designable bound field, and the carried-through one: binding kept, served options gone.
    expect(fields.tier).toMatchObject({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    expect(fields.tier).not.toHaveProperty('options');
    expect(fields.regions).toEqual({ type: 'multiselect', label: 'Regions', picklist: 'acme_region' });
    // A field that names no picklist keeps its inline options exactly as served.
    expect(JSON.stringify(fields.status!.options)).toBe(JSON.stringify(JSON.parse(SERVED_STATUS).options));
    // The control: the edit itself landed.
    expect(fields.title).toMatchObject({ type: 'text', label: 'Headline' });
  });
});
