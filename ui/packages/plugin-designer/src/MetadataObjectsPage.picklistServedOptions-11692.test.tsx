/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11692 — the Setup objects page saves an object whose fields name a
 * shared picklist.
 *
 * The page lists objects through `MetadataClient.list('object')` — the SERVED
 * form, where a picklist-bound field carries `picklist` AND the options the
 * runtime resolved from the list (the list read resolves through the same fold
 * as the single-item read) — and a manager edit spreads that served document
 * into the PUT. The authoring door refuses `options` beside `picklist` for the
 * whole object, so relabelling an object was refused for a field the edit
 * never touched.
 *
 * A REAL `MetadataClient` over a fetch double that serves the list and refuses
 * a PUT body the way the authoring door does, so the claim is read off the
 * WIRE. `ObjectManager` is the only other double, a prop recorder, as in
 * `MetadataObjectsPage.specKeyGroup.test.tsx`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { ObjectDefinition } from '@object-ui/types';

type Row = Record<string, unknown>;

/** The object as the runtime SERVES it in the list. */
const SERVED: Row = {
  name: 'acme_account',
  label: 'Account',
  isSystem: false,
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

interface RecordedManagerProps {
  objects: ObjectDefinition[];
  onObjectsChange?: (objects: ObjectDefinition[]) => void;
}

let managerProps: RecordedManagerProps | null = null;

vi.mock('./ObjectManager', () => ({
  ObjectManager: (props: RecordedManagerProps) => {
    managerProps = props;
    return null;
  },
}));

import { MetadataObjectsPage } from './MetadataObjectsPage';

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
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
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
          : json({ success: true });
      }
      return json({ items: [SERVED] });
    }) as unknown as typeof fetch,
  });
}

beforeEach(() => {
  puts = [];
  managerProps = null;
});

describe('MetadataObjectsPage — a picklist-bound object saves without its served options (objectui#11692)', () => {
  it('relabelling the object: the door accepts the body, no bound field carries `options`, every other field byte-identical', async () => {
    render(<MetadataObjectsPage client={realClient()} />);
    await waitFor(() => expect(managerProps?.objects).toHaveLength(1));

    const next = managerProps!.objects.map((o) => ({ ...o, label: 'Customer' }));
    await act(async () => {
      managerProps!.onObjectsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    const [put] = puts;
    expect(put!.status, `refused at ${doorRefusal(put!.body).join(', ')}`).toBe(200);
    const fields = put!.body.fields as Record<string, Row>;
    const served = SERVED.fields as Record<string, Row>;
    expect(fields.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    expect(JSON.stringify(fields.status)).toBe(JSON.stringify(served.status));
    expect(JSON.stringify(fields.title)).toBe(JSON.stringify(served.title));
    // The control: the relabel itself landed.
    expect(put!.body.label).toBe('Customer');
  });
});
