/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10291 — a single select / radio emptied by a cascade prune must
 * reach the WIRE as an explicit `null`, on the FORM save path too.
 *
 * ## Why the form path is pinned separately
 *
 * The inline-edit save exposed the defect (see plugin-detail's
 * `InlineEditSaveBar.cascadePruneWire-10291` pin), but the same option widgets
 * run the same cascade clear inside a form (ADR-0058 parity), and the form host
 * carries a SECOND, independent clear of its own. Both used to empty a scalar
 * to `undefined`. `ObjectForm` hands its values through `sanitizeFormData` —
 * which keeps an own `undefined` key — to `dataSource.update`, and the transport
 * then drops it: `JSON.stringify` omits an own key whose value is `undefined`.
 * So an edit form whose parent moved saved the stale child value, silently.
 *
 * ## What this file observes
 *
 * The request body the REAL `@object-ui/data-objectstack` adapter puts on the
 * wire through the real `@objectstack/client` — only `fetch` is stubbed. An
 * assertion on the `update` argument would read `{ tier: undefined }` as "the
 * key is there" and stay green on the defect.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';

registerAllFields();

/** `gold` is offered only under `emea`, `silver` only under `apac`. */
const REGIONAL_OPTIONS = [
  { label: 'Gold', value: 'gold', visibleWhen: "record.region == 'emea'" },
  { label: 'Silver', value: 'silver', visibleWhen: "record.region == 'apac'" },
];
/** The same two values with no option rule — what the control select offers. */
const PLAIN_OPTIONS = [
  { label: 'Gold', value: 'gold' },
  { label: 'Silver', value: 'silver' },
];

const objectSchema = {
  name: 'task',
  fields: {
    region: { type: 'text', label: 'Region' },
    /** Single select, pruned by the parent → the defect's first carrier. */
    tier: { type: 'select', label: 'Tier', dependsOn: ['region'], options: REGIONAL_OPTIONS },
    /** Radio, pruned by the parent → the defect's second carrier. */
    band: { type: 'radio', label: 'Band', dependsOn: ['region'], options: REGIONAL_OPTIONS },
    /** Multi select, pruned by the parent → the positive control: a real array. */
    tags: {
      type: 'select',
      multiple: true,
      label: 'Tags',
      dependsOn: ['region'],
      options: REGIONAL_OPTIONS,
    },
    /** Select no parent governs → the negative control: never pruned. */
    tier_any: { type: 'select', label: 'Tier (any)', options: PLAIN_OPTIONS },
  },
};

/** Every value admissible under `emea`, so nothing is pruned on load. */
const STORED = {
  id: 'r1',
  region: 'emea',
  tier: 'gold',
  band: 'gold',
  tags: ['gold'],
  tier_any: 'gold',
  updated_at: '2026-09-25 00:00:00.000',
};

/**
 * A data source whose WRITES go through the real adapter and client, with
 * `fetch` as the only stub; reads stay stubbed so the form loads without a
 * server. Every write's request body is recorded verbatim.
 */
function makeWireDataSource() {
  const bodies: { method: string; url: string; body: string }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/api/v1/discovery')) {
      return new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    bodies.push({ method, url, body: String(init?.body ?? '') });
    return new Response(
      JSON.stringify({ success: true, data: { object: 'task', id: 'r1', record: { id: 'r1' } } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  const adapter = new ObjectStackAdapter({ baseUrl: 'http://test.local', fetch, autoReconnect: false });
  const ds = {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn().mockResolvedValue({ ...STORED }),
    create: vi.fn((o: string, d: any) => adapter.create(o, d)),
    update: vi.fn((o: string, id: string, d: any, opts?: { ifMatch?: string }) =>
      adapter.update(o, id, d, opts),
    ),
  };
  return { ds, bodies };
}

const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

async function moveRegionToApacAndSubmit(container: HTMLElement) {
  const region = await waitInput(container, 'region');
  await waitFor(() => {
    expect(container.querySelector('[data-testid="select-trigger-tier"]')).toBeTruthy();
  });
  // The parent moves: `gold` is no longer offered to any regional field.
  await act(async () => {
    fireEvent.change(region, { target: { value: 'apac' } });
  });
  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
}

describe('objectui#10291 — form: a cascade-cleared scalar reaches the wire as null', () => {
  it('EDIT: the pruned single select AND radio are in the PATCH body as null; the multi select writes its array; the ungoverned select keeps its value', async () => {
    const { ds, bodies } = makeWireDataSource();
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'task', mode: 'edit', recordId: 'r1' } as any}
        dataSource={ds as any}
      />,
    );
    await moveRegionToApacAndSubmit(container);

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].method).toBe('PATCH');
    const body = JSON.parse(bodies[0].body);
    expect(body).toHaveProperty('region', 'apac');
    // (b) the scalar prunes are written — as an explicit null, the sentinel
    // the write contract reads as "clear the stored value".
    expect(body).toHaveProperty('tier', null);
    expect(body).toHaveProperty('band', null);
    // (c) positive control: the multi-value prune still writes a real array.
    expect(body).toHaveProperty('tags', []);
    // (d) negative control: a select no parent governs is not nulled. An edit
    // form writes only the fields that differ from the record it read
    // (objectui#10156), so the untouched select is not on the wire at all —
    // while a wrongful null WOULD be, because it differs from the stored 'gold'.
    expect(body).not.toHaveProperty('tier_any');
  });

  it('EDIT, no widget mounted: a dependent select `visibleWhen` keeps hidden is cleared by the FORM HOST alone — and that clear reaches the wire as null too', async () => {
    // The field is hidden when the record opens, so no `SelectField` is
    // mounted and nothing but the form host's own cascade clear can move its
    // value. Measured on this card: with only the widgets fixed, this body
    // still lacked `tier` — the host emptied it to `undefined`.
    const { ds, bodies } = makeWireDataSource();
    ds.getObjectSchema.mockResolvedValue({
      ...objectSchema,
      fields: {
        ...objectSchema.fields,
        show_tier: { type: 'boolean', label: 'Show tier' },
        tier: { ...objectSchema.fields.tier, visibleWhen: 'record.show_tier == true' },
      },
    });
    ds.findOne.mockResolvedValue({ ...STORED, show_tier: false });
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'task', mode: 'edit', recordId: 'r1' } as any}
        dataSource={ds as any}
      />,
    );
    const region = await waitInput(container, 'region');
    await waitFor(() => {
      expect(container.querySelector('[data-testid="select-trigger-tier_any"]')).toBeTruthy();
    });
    // Precondition: the governed select is NOT on screen.
    expect(container.querySelector('[data-testid="select-trigger-tier"]')).toBeNull();
    await act(async () => {
      fireEvent.change(region, { target: { value: 'apac' } });
    });
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    });

    await waitFor(() => expect(bodies).toHaveLength(1));
    const body = JSON.parse(bodies[0].body);
    expect(body).toHaveProperty('region', 'apac');
    expect(body).toHaveProperty('tier', null);
    // Untouched, so not written (objectui#10156); a wrongful null would be.
    expect(body).not.toHaveProperty('tier_any');
  });

  it('CREATE: the pruned scalar is null on the POST body, and an untouched empty select is absent — never a spurious null', async () => {
    const { ds, bodies } = makeWireDataSource();
    const { container } = render(
      <ObjectForm
        schema={
          {
            type: 'object-form',
            objectName: 'task',
            mode: 'create',
            initialValues: { region: 'emea', tier: 'gold', band: 'gold', tags: ['gold'] },
          } as any
        }
        dataSource={ds as any}
      />,
    );
    await moveRegionToApacAndSubmit(container);

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0].method).toBe('POST');
    const body = JSON.parse(bodies[0].body);
    expect(body).toHaveProperty('region', 'apac');
    expect(body).toHaveProperty('tier', null);
    expect(body).toHaveProperty('band', null);
    expect(body).toHaveProperty('tags', []);
    // (d) the control was never given a value and never touched: it stays
    // off the wire, so no server default is suppressed by an invented null.
    expect(body).not.toHaveProperty('tier_any');
  });
});
