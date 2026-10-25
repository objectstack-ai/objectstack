/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-master-detail-form` must not show a PERMANENT "Loading columns…" for a
 * detail collection whose schema LOADED FINE but failed to DERIVE
 * (objectui#6394).
 *
 * ## The arm this covers, and how it differs from the two already closed
 *
 * `MasterDetailForm`'s detail-resolution effect has THREE arms that return an
 * entry with no usable columns:
 *
 *   1. `!d.childObject` — the objectui#5940 decline, rendered since
 *      objectui#6360 as the `md-detail-no-child-object` config hint.
 *   2. the FETCH threw — objectui#6372, rendered as the
 *      `md-detail-schema-unavailable` refusal placeholder.
 *   3. the fetch SUCCEEDED and `deriveDetail` threw — this card. The child
 *      schema carries no lookup/master_detail field referencing the parent, so
 *      no relationship field can be found.
 *
 * Arm 3 used to return the entry unresolved, so it fell through to
 * `Loading columns…` — permanently, because the derive is not retried any more
 * than the fetch is.
 *
 * ## Why it is neither of the other two placeholders
 *
 * ⭐ Reusing objectui#6372's refusal would state that the schema could not be
 * loaded, which is FALSE here — the fetch resolved. Triage ruled option 2 for
 * exactly that reason ("dishonest copy for a schema that loaded fine"): this is
 * a CONFIGURATION error with a named remedy the code already holds, so it takes
 * the config-hint shape and NAMES `relationshipField` as the key to set.
 *
 * ## Three arms, three outcomes
 *
 * ⭐ Every assertion about arm 3 is paired with a control, because a renderer
 * that showed this hint for EVERY unresolved detail would satisfy the first
 * test alone: a still-pending detail must keep "Loading columns…" (that message
 * is TRUE there), a failed FETCH must keep objectui#6372's refusal, and a
 * detail with no `childObject` must keep objectui#6360's hint.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const PARENT = 'purchase_order';
const parentSchema = { name: PARENT, fields: { ref: { type: 'text', label: 'Ref' } } };

/**
 * A child schema that LOADS FINE and cannot be derived from: it carries no
 * lookup/master_detail field referencing the parent, which is exactly what
 * `deriveDetail` throws on ("could not find a lookup/master_detail field on
 * \"po_line\" referencing \"purchase_order\". Set relationshipField explicitly.").
 */
const underivableChildSchema = {
  name: 'po_line',
  fields: {
    amount: { type: 'number', label: 'Amount' },
    note: { type: 'text', label: 'Note' },
  },
};

/** The same child, but carrying the FK — this one resolves all the way. */
const resolvableChildSchema = {
  name: 'po_line',
  fields: {
    po: { type: 'master_detail', reference: PARENT, label: 'PO' },
    amount: { type: 'number', label: 'Amount' },
  },
};

function dataSourceServing(childSchema: any, failing: string[] = []) {
  return {
    getObjectSchema: vi.fn(async (obj: string) => {
      if (failing.includes(obj)) throw new Error(`SCHEMA_UNAVAILABLE: ${obj}`);
      if (obj === PARENT) return parentSchema;
      return childSchema;
    }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
  } as any;
}

function renderForm(details: any[], ds: any) {
  return render(
    <MasterDetailForm
      schema={{ objectName: PARENT, mode: 'create', fields: ['ref'], details } as any}
      dataSource={ds}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('object-master-detail-form — a detail whose schema LOADED but failed to DERIVE (objectui#6394)', () => {
  it('renders a config hint naming `relationshipField` instead of a permanent "Loading columns…"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = dataSourceServing(underivableChildSchema);
    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    // The fetch was attempted and SUCCEEDED — read from the data source rather
    // than assumed, because it is what separates this arm from objectui#6372.
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('po_line'));
    await expect(ds.getObjectSchema.mock.results[0].value).resolves.toBeTruthy();

    const hint = await waitFor(() => view.getByTestId('md-detail-no-relationship-field'));

    // ⭐ The hint must NAME THE KEY the author has to set. A generic "could not
    // resolve this collection" placeholder would pass a presence check and
    // leave the author exactly where "Loading columns…" left them — which is
    // the whole complaint, and the reason triage ruled the config-hint shape.
    expect(hint.textContent).toContain('relationshipField');
    // Both ends of the relationship it could not find, so the author knows
    // WHICH collection and WHICH parent are involved.
    expect(hint.textContent).toContain('po_line');
    expect(hint.textContent).toContain(PARENT);

    // The spinner-shaped message must be gone for THIS detail: the derive has
    // already failed and is not retried, so "loading" is not merely unhelpful,
    // it is false.
    expect(view.container.textContent).not.toContain('Loading columns…');

    // ⛔ And it must NOT be objectui#6372's refusal: that placeholder says the
    // schema could not be loaded, and this one loaded fine.
    expect(view.queryByTestId('md-detail-schema-unavailable')).toBeNull();
    // Nor objectui#6360's — this detail DID name its child object.
    expect(view.queryByTestId('md-detail-no-child-object')).toBeNull();

    // The section still renders, so the author sees which collection to fix.
    expect(view.container.textContent).toContain('PO lines');

    warn.mockRestore();
    view.unmount();
  });

  it('still logs the derive error, carrying the thrown Error and not just a message about it', async () => {
    // objectui#6372 stopped this arm discarding the error; rendering a hint must
    // not re-swallow it. The thrown message holds the full diagnosis (which
    // child, which parent, which key) — the placeholder shows the author the
    // key, the log keeps the stack for whoever debugs it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = dataSourceServing(underivableChildSchema);
    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    // Anchored on the state under test, so this cannot read green for an entry
    // that never reached the failed derive at all.
    await waitFor(() => expect(view.queryByTestId('md-detail-no-relationship-field')).not.toBeNull());

    const call = warn.mock.calls.find((c) => String(c[0]).includes('relationshipField'));
    expect(call, 'expected the derive failure to be logged, not discarded').toBeTruthy();
    const carriesError = call!.some(
      (a) => a instanceof Error && /could not find a lookup\/master_detail field/.test(a.message),
    );
    expect(carriesError, 'expected the thrown error object itself to reach the log').toBe(true);

    warn.mockRestore();
    view.unmount();
  });

  it('DEGENERATE CONTROL: a detail whose FETCH threw keeps objectui#6372’s refusal placeholder', async () => {
    // ⭐ Without this, routing every unresolved detail to the new config hint
    // would pass the tests above while erasing objectui#6372's placeholder —
    // and telling an author to set `relationshipField` for a schema that could
    // not be fetched is advice they cannot act on.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = dataSourceServing(underivableChildSchema, ['po_line']);
    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    const placeholder = await waitFor(() => view.getByTestId('md-detail-schema-unavailable'));
    expect(placeholder.textContent).toContain('po_line');
    expect(view.queryByTestId('md-detail-no-relationship-field')).toBeNull();

    warn.mockRestore();
    view.unmount();
  });

  it('DEGENERATE CONTROL: a detail still IN FLIGHT keeps "Loading columns…"', async () => {
    // ⭐ The message is TRUE while the fetch has not settled, and a fix that
    // simply deleted or repointed the loading branch would pass the first test.
    let release: (v: any) => void = () => {};
    const pending = new Promise((resolve) => { release = resolve; });
    const ds = {
      getObjectSchema: vi.fn(async (obj: string) => {
        if (obj === PARENT) return parentSchema;
        return pending;
      }),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(), update: vi.fn(), delete: vi.fn(), bulk: vi.fn(),
    } as any;

    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('po_line'));
    await waitFor(() => expect(view.container.textContent).toContain('Loading columns…'));
    expect(view.queryByTestId('md-detail-no-relationship-field')).toBeNull();
    expect(view.queryByTestId('md-detail-schema-unavailable')).toBeNull();

    release(underivableChildSchema);
    view.unmount();
  });

  it('DEGENERATE CONTROL: a detail that DERIVES renders its grid — no hint at all', async () => {
    // ⭐ The behaviour has to be attributable to the FAILED DERIVE, not to
    // "this renderer shows a hint for every detail".
    const ds = dataSourceServing(resolvableChildSchema);
    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('po_line'));
    // Resolved all the way to a rendered grid — not merely "no hint", which a
    // stuck-forever entry would also satisfy.
    await waitFor(() => expect(view.queryByTestId('line-items')).not.toBeNull());

    expect(view.queryByTestId('md-detail-no-relationship-field')).toBeNull();
    expect(view.container.textContent).not.toContain('Loading columns…');

    view.unmount();
  });

  it('DEGENERATE CONTROL: a detail with no `childObject` keeps objectui#6360’s hint', async () => {
    // ⭐ The two config hints must stay distinguishable: this one has no child
    // object to link to the parent at all, so `childObject` — not
    // `relationshipField` — is the key its author has to set.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = dataSourceServing(underivableChildSchema);
    const view = renderForm([{ title: 'Unconfigured' }], ds);

    const hint = await waitFor(() => view.getByTestId('md-detail-no-child-object'));
    expect(hint.textContent).toContain('childObject');
    expect(view.queryByTestId('md-detail-no-relationship-field')).toBeNull();

    warn.mockRestore();
    view.unmount();
  });
});
