/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-master-detail-form` must not show a PERMANENT "Loading columns…" for a
 * detail collection whose child-object schema fetch THREW (objectui#6372).
 *
 * ## The arm this covers, and why it is not the one objectui#6360 fixed
 *
 * `MasterDetailForm`'s detail-resolution effect has two arms that return an
 * entry with no `columns`:
 *
 *   1. `!d.childObject` — the objectui#5940 decline. Its render half landed in
 *      objectui#6360 as the `md-detail-no-child-object` config hint.
 *   2. `catch` — the schema fetch FAILED. This one.
 *
 * Arm 2's entry DOES name a child object, so it skips the config hint and falls
 * through to `Loading columns…`. That message never ends: the fetch that would
 * have supplied those columns already failed and is not retried.
 *
 * ## Why "no columns" cannot be the test
 *
 * ⭐ "Failed" and "still in flight" are represented IDENTICALLY on a plain
 * `MasterDetailDetailConfig[]` — both are simply an entry with no `columns`. An
 * assertion that keyed on the absence of columns would therefore fire for the
 * legitimately-pending detail too. The distinction only exists once the resolver
 * carries a per-entry resolution STATUS, which is what this card adds, so the
 * assertions below read the refusal placeholder that only the failed status can
 * produce — and the degenerate control at the bottom holds the loading branch
 * alive for the entry that really is still resolving.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

const PARENT = 'po';
const parentSchema = { name: PARENT, fields: { ref: { type: 'text', label: 'Ref' } } };
/**
 * A child schema that genuinely RESOLVES: it carries the master_detail field
 * back to the parent, so `deriveDetail` finds the relationship and the entry
 * reaches `ready`. Without that field the fetch succeeds and the DERIVE throws,
 * which is a different failure — see the last control in this file.
 */
const resolvableChildSchema = {
  name: 'po_line',
  fields: {
    po: { type: 'master_detail', reference: PARENT, label: 'PO' },
    amount: { type: 'number', label: 'Amount' },
  },
};

/**
 * A data source whose `getObjectSchema` answers the PARENT normally and rejects
 * for the named child objects. Keeping the parent healthy is deliberate: it is
 * what makes the failure attributable to the child fetch rather than to a
 * wholesale broken data source.
 */
function dataSourceRejectingFor(failing: string[], childSchema?: any) {
  return {
    getObjectSchema: vi.fn(async (obj: string) => {
      if (failing.includes(obj)) throw new Error(`SCHEMA_UNAVAILABLE: ${obj}`);
      if (obj === PARENT) return parentSchema;
      return childSchema ?? resolvableChildSchema;
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

describe('object-master-detail-form — a detail whose schema fetch THREW (objectui#6372)', () => {
  it('renders a refusal placeholder instead of a permanent "Loading columns…"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = dataSourceRejectingFor(['po_line']);
    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    // The fetch was attempted and rejected — this is the state under test, read
    // from the data source rather than assumed.
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('po_line'));

    const placeholder = await waitFor(() => view.getByTestId('md-detail-schema-unavailable'));

    // The placeholder must NAME the child object whose schema could not be
    // loaded. A generic "unavailable" message would pass a presence check and
    // still leave the author with nothing to act on.
    expect(placeholder.textContent).toContain('po_line');

    // The spinner-shaped message must be gone for THIS detail: the fetch has
    // already failed and is not retried, so "loading" is not merely unhelpful,
    // it is false.
    expect(view.container.textContent).not.toContain('Loading columns…');

    // The section still renders, so the author sees WHICH collection refused.
    expect(view.container.textContent).toContain('PO lines');

    view.unmount();
  });

  it('logs the error the `catch` used to discard, naming the child object', async () => {
    // Parity bar: the `!d.childObject` decline arm has warned since
    // objectui#5940. The `catch` arm was bare — the thrown error was dropped on
    // the floor, so whoever debugged this had neither a message nor a stack.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = dataSourceRejectingFor(['po_line']);
    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    await waitFor(() => expect(view.queryByTestId('md-detail-schema-unavailable')).not.toBeNull());

    const call = warn.mock.calls.find((c) => String(c[0]).includes('po_line'));
    expect(call, 'expected a console.warn naming the child object that failed').toBeTruthy();

    // ⭐ The THROWN VALUE itself must reach the log, not just a message about
    // it: a warn that names the object but drops the error still discards the
    // stack, which is the half that makes this debuggable.
    const carriesError = call!.some((a) => a instanceof Error && /SCHEMA_UNAVAILABLE/.test(a.message));
    expect(carriesError, 'expected the thrown error to be logged, not discarded').toBe(true);

    view.unmount();
  });

  it('DEGENERATE CONTROL: a detail whose fetch SUCCEEDS and RESOLVES shows no refusal placeholder', async () => {
    // ⭐ Without this, a renderer that showed the refusal placeholder for every
    // unresolved detail — or for every detail, full stop — would pass the tests
    // above. The behaviour has to be attributable to the FAILURE.
    const ds = dataSourceRejectingFor([]);
    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('po_line'));
    // The entry resolved all the way to a rendered grid — not merely "no
    // placeholder", which a stuck-forever entry would also satisfy.
    await waitFor(() => expect(view.queryByTestId('line-items')).not.toBeNull());

    expect(view.queryByTestId('md-detail-schema-unavailable')).toBeNull();
    expect(view.container.textContent).not.toContain('Loading columns…');

    view.unmount();
  });

  it('DEGENERATE CONTROL: a fetch that SUCCEEDS but fails to DERIVE is not called a load failure', async () => {
    // ⭐ Measured while building this card, and the reason the resolver catches
    // the fetch and the derive SEPARATELY: the single bare `catch` covered both,
    // so "the schema fetch threw" and "the schema loaded but named no
    // relationship field" were indistinguishable.
    //
    // Routing both to the refusal placeholder would make it state something
    // false — the schema loaded fine here. What this control holds is that the
    // derive failure did not get swept into objectui#6372's placeholder.
    //
    // ⚠️ Its WAIT was rewritten by objectui#6394, which is the card that gave
    // this arm a render of its own: it waited on "Loading columns…", the
    // permanent-spinner outcome objectui#6372 deliberately left standing here
    // and triage has since ruled out. The subject of the control — this is NOT
    // a load failure — is unchanged and still asserted below; the error is
    // still no longer discarded.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Loads fine, but carries no field referencing the parent.
    const ds = dataSourceRejectingFor([], { name: 'po_line', fields: { amount: { type: 'number' } } });
    const view = renderForm([{ childObject: 'po_line', title: 'PO lines' }], ds);

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('po_line'));
    // The derive failure's OWN placeholder (objectui#6394), naming
    // `relationshipField` — not the "Loading columns…" this waited on before
    // that card, and not the refusal below.
    await waitFor(() => expect(view.queryByTestId('md-detail-no-relationship-field')).not.toBeNull());
    expect(view.container.textContent).not.toContain('Loading columns…');

    // NOT the load-failure placeholder: the load succeeded.
    expect(view.queryByTestId('md-detail-schema-unavailable')).toBeNull();

    // The derive error still reaches the log — it carries the whole diagnosis
    // (which child, which parent, which key to set) and was previously dropped.
    const call = warn.mock.calls.find((c) => String(c[0]).includes('relationshipField'));
    expect(call, 'expected the derive failure to be logged, not discarded').toBeTruthy();
    expect(call!.some((a) => a instanceof Error)).toBe(true);

    view.unmount();
  });

  it('DEGENERATE CONTROL: a detail that is still IN FLIGHT keeps "Loading columns…"', async () => {
    // ⭐ The other direction, and the reason a per-entry status is needed at
    // all: a fix that simply deleted or reworded the loading branch would pass
    // the first test. A detail whose fetch has not settled must still say it is
    // loading — that message is TRUE here.
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
    expect(view.queryByTestId('md-detail-schema-unavailable')).toBeNull();

    release({ name: 'po_line', fields: {} });
    view.unmount();
  });

  it('DEGENERATE CONTROL: the objectui#6360 config hint still owns the `!childObject` arm', async () => {
    // ⭐ The two arms must stay distinguishable. A fix that routed BOTH to the
    // refusal placeholder would erase objectui#6360's hint — the one that names
    // the key the author has to set — and would still pass the first test.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = dataSourceRejectingFor(['po_line']);
    const view = renderForm([{ title: 'Unconfigured' }], ds);

    const hint = await waitFor(() => view.getByTestId('md-detail-no-child-object'));
    expect(hint.textContent).toContain('childObject');
    expect(view.queryByTestId('md-detail-schema-unavailable')).toBeNull();

    view.unmount();
  });
});
