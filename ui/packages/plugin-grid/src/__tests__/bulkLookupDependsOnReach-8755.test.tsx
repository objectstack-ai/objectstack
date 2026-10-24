/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8755 — a `dependsOn` LOOKUP param on the BULK action dialog gates,
 * UNGATES, and filters, exactly as the option params beside it already did.
 *
 * The twin of `app-shell/src/views/ActionParamDialog.lookupDependsOnReach-8672.test.tsx`
 * at the third and last surface that reads `CASCADE_OPTION_WIDGET_TYPES`.
 *
 * ## What was broken, and why it is NOT a new authoring route
 *
 * `BulkActionDialog`'s `ParamField` threaded its in-progress `values` to the
 * OPTION widgets only (`select` / `multiselect` / `radio` / `checkboxes`, the
 * members of `CASCADE_OPTION_WIDGET_TYPES`, supplied since objectui#4757). A
 * `lookup` param is in none of those, so `LookupField` fell through to the
 * `SchemaRendererContext` tail that objectui#7206 measured as unconditionally
 * `{}` — unsettable, not merely unset — `dependenciesMissing` could never
 * clear, and the trigger rendered DISABLED FOREVER, prompting for the very
 * param the user had just filled.
 *
 * ⭐ The load-bearing measurement is `leg A / already-live`: the SAME key, on
 * the SAME surface, arriving through the SAME route, has always been honoured
 * for the option family. `bulkParamToField` does not destructure `dependsOn`
 * out, so it rides `...extra` onto the field bag, and `SelectField` /
 * `RadioField` read `field.dependsOn` through `useCascadingOptions`. So this
 * change introduces no key, no spelling and no route — it stops one of the two
 * widget families that both read `dependsOn` here from reading it into a dead
 * control. Retiring the key instead (ADR-0049 enforce-or-remove, the other
 * disposition this card offered) would have deleted a shipping capability.
 *
 * ## ⚠️ And it is NOT licensed by the bulk param schema — leg B says so
 *
 * `@objectstack/spec`'s `BulkActionParamSchema` "accepts" `dependsOn`. That
 * accept is a NULL READING: leg B fires a nonsense key at the same schema in
 * the same run and it is accepted too, so the schema refuses nothing and its
 * acceptance authorises nothing. The strict sibling `ActionParamSchema` refuses
 * both. ⛔ Nobody may cite the bulk schema's accept as evidence that the key is
 * authorable — that inference is the trap this card was filed to close, and leg
 * B is here so it fails loudly rather than being re-derived.
 *
 * ⚠️ That was the reading through `@objectstack/spec` 17.4.0. 17.5.0 CLOSED
 * `BulkActionParamSchema` and declares `dependsOn` on it (objectui#11073), so
 * leg B did fail loudly — and was re-pinned to the new reading: the accept is
 * now a declaration, and the key IS authorable on a bulk param. The sibling
 * `ActionParamSchema` still refuses it.
 *
 * ## Every reading has a lit control beside it
 *
 * - leg A pairs the subject with a CONTROL lookup identical but for `dependsOn`
 *   (enabled throughout), with a KEYSTROKE WITNESS whose option set re-resolves
 *   on the same keystroke — so "the gate lifted" is read against a keystroke
 *   proven to have reached the dialog — and with a NEGATIVE control that an
 *   empty parent still gates, so the fix cannot be read as "the gate was
 *   deleted";
 * - leg B pairs every refusal and every accept with a positive control document
 *   that must PARSE and a nonsense-key document whose verdict is the strictness
 *   reading itself;
 * - leg C reads both families in both directions;
 * - leg D offers two records under one reference and asserts the declared param
 *   sees one while the control param sees both — so a narrowed list cannot be a
 *   picker that simply failed to load.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { CASCADE_OPTION_WIDGET_TYPES, EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { ActionParamSchema, BulkActionParamSchema } from '@objectstack/spec/ui';
// Module scope, per AGENTS.md 测试纪律: the dialog reaches its widgets through
// `getLazyFieldWidget` -> `React.lazy(() => import('./widgets/LookupField'))`
// inside `@object-ui/fields`, and a first dynamic import() under a saturated
// transform pipeline can eat most of RTL's 1s `findBy` budget. This barrel
// STATICALLY re-exports those widget modules, so the lazy factories resolve in
// a microtask instead of racing the assertions below.
import '@object-ui/fields';

import { BulkActionDialog } from '../components/BulkActionDialog';
import { bulkParamToField } from '../components/bulkParamToField';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
  // Radix probes pointer-capture APIs happy-dom lacks.
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
});

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Fixtures                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** The parent the child lookup names. A plain text param, so it is typable. */
const REGION = { name: 'region', label: 'Region', type: 'text' };

/** SUBJECT — the card's shape: a bulk lookup param declaring a cascade. */
const GATED_LOOKUP = {
  name: 'contact',
  label: 'Contact',
  type: 'lookup',
  object: 'contacts',
  dependsOn: ['region'],
};

/** CONTROL — the same lookup, same target, differing ONLY in `dependsOn`. */
const CONTROL_LOOKUP = {
  name: 'control_contact',
  label: 'Control contact',
  type: 'lookup',
  object: 'contacts',
};

/**
 * CONTROL for the KEYSTROKE. A `radio` IS in `CASCADE_OPTION_WIDGET_TYPES`, so
 * this dialog has threaded its in-progress values to it since objectui#4757 and
 * this option's predicate re-resolves on every change to `region`. Without it a
 * gate that failed to lift would be indistinguishable from a dialog that never
 * saw the keystroke.
 */
const KEYSTROKE_WITNESS = {
  name: 'tier',
  label: 'Tier',
  type: 'radio',
  options: [
    { label: 'Enterprise', value: 'ent', visibleWhen: "record.region == 'north'" },
    { label: 'Small business', value: 'smb', visibleWhen: "record.region == 'south'" },
  ],
};

/**
 * The ALREADY-LIVE reading, as a fixture: an option param declaring the same
 * `dependsOn` key, on the same surface, by the same inline route. It gates and
 * ungates today — which is why retiring the key was not available to this card.
 */
const OPTION_WITH_SAME_KEY = {
  name: 'plan',
  label: 'Plan',
  type: 'radio',
  dependsOn: ['region'],
  options: [
    { label: 'Basic', value: 'basic' },
    { label: 'Pro', value: 'pro' },
  ],
};

const CONTACTS = [
  { id: 'k1', name: 'Ada (north)', region: 'north' },
  { id: 'k2', name: 'Bo (south)', region: 'south' },
];

/** Honours the `$filter` record, so the cascade is observable as RENDERED ROWS
 *  and not only as call arguments. */
function makeDataSource() {
  const queries: Array<{ objectName: string; params: any }> = [];
  return {
    queries,
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    find: vi.fn(async (objectName: string, params: any) => {
      queries.push({ objectName, params });
      let recs = CONTACTS;
      const filter = params?.$filter;
      if (filter && typeof filter === 'object' && filter.region) {
        recs = recs.filter((c) => c.region === filter.region);
      }
      return { data: recs, total: recs.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_o: string, id: string) => CONTACTS.find((c) => c.id === id) ?? null),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' }, region: { type: 'text' } },
    }),
  } as any;
}

function openDialog(params: Array<Record<string, unknown>>, ds: any = makeDataSource()) {
  const def: any = { name: 'bulk_edit', label: 'Bulk edit', operation: 'update', params };
  render(
    <BulkActionDialog
      def={def}
      rows={[{ id: 'r1' }, { id: 'r2' }]}
      resource="account"
      dataSource={ds}
      open
      onClose={() => {}}
    />,
  );
  return ds;
}

/** The dialog labels its controls `bulk-param-<name>`; type into one by id. */
const typeRegion = (value: string) => {
  const el = document.getElementById('bulk-param-region');
  expect(el).not.toBeNull();
  fireEvent.change(el as HTMLElement, { target: { value } });
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg A — the dialog supplies the record to the pickers too                   */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8755 leg A — a `dependsOn` lookup BULK param gates on an EMPTY parent and ungates when it is filled', () => {
  it('already-live CONTROL — the SAME key on an OPTION param gates and ungates on this surface today', async () => {
    // ⭐ The measurement the disposition turns on. `dependsOn` is not an inert
    // key on `BulkActionParam`: it rides `...extra` onto the field bag and the
    // option widgets read it through `useCascadingOptions`. So the defect below
    // is ONE family failing to read a key the surface already honours — not an
    // unauthorised key being honoured, which is the reading that would have
    // pointed at retirement instead.
    openDialog([REGION, OPTION_WITH_SAME_KEY]);

    // Gated while the named parent is empty. Read off the widget's POSITIVE
    // gated signal, never off the absence of options: an un-mounted lazy widget
    // produces that absence for free, and the first draft of this case failed
    // for exactly that reason — it raced the Suspense boundary and typed into a
    // control that did not exist yet.
    expect(await screen.findByTestId('radio-empty-plan')).toBeInTheDocument();
    expect(screen.queryByTestId('radio-option-basic')).not.toBeInTheDocument();

    typeRegion('north');

    // …and released by it, with no change to this file's subject.
    expect(await screen.findByTestId('radio-option-basic')).toBeInTheDocument();
    expect(screen.getByTestId('radio-option-pro')).toBeInTheDocument();
  });

  it('NEGATIVE CONTROL — with the parent still empty the declared lookup is gated, and the control beside it is not', async () => {
    openDialog([REGION, GATED_LOOKUP, CONTROL_LOOKUP]);

    // CONTROL first: an identical lookup differing only in `dependsOn` renders a
    // normal, enabled trigger. This is what makes the gated reading below a
    // measurement of `dependsOn` rather than of a lookup that cannot render here.
    const control = await screen.findByTestId('lookup-trigger-control_contact');
    expect(control).toBeEnabled();

    // ⭐ The gate is NOT deleted — it is given a way out. An empty parent must
    // still gate, or the picker would issue the unfiltered query the cascade
    // exists to prevent.
    const gated = screen.getByTestId('lookup-trigger-gated');
    expect(gated).toBeDisabled();
    expect(gated).toHaveTextContent('Select region first');
  });

  it('⭐ LIFTS the gate when the named parent is filled — the assertion this card turns around', async () => {
    openDialog([REGION, GATED_LOOKUP, KEYSTROKE_WITNESS]);

    // Both witness options are offered before anything is typed: `record.region`
    // is unresolvable, which fails OPEN.
    expect(await screen.findByTestId('radio-option-ent')).toBeInTheDocument();
    expect(screen.getByTestId('radio-option-smb')).toBeInTheDocument();
    expect(screen.getByTestId('lookup-trigger-gated')).toBeDisabled();

    typeRegion('north');

    // The keystroke DID reach the dialog and DID re-render it: the witness's
    // offered set narrowed. This is what makes the assertion after it a reading
    // of the supply rule and not of the event.
    await waitFor(() => expect(screen.queryByTestId('radio-option-smb')).not.toBeInTheDocument());
    expect(screen.getByTestId('radio-option-ent')).toBeInTheDocument();

    // ⭐ THE CARD, INVERTED. Before this change the trigger stayed
    // `lookup-trigger-gated` and `disabled` forever, prompting for the param the
    // user had just filled. The gated test id is `LookupField`'s own signal, so
    // its disappearance and the named trigger's arrival are one fact read twice.
    const ungated = await screen.findByTestId('lookup-trigger-contact');
    expect(ungated).toBeEnabled();
    expect(screen.queryByTestId('lookup-trigger-gated')).not.toBeInTheDocument();
    expect(ungated).not.toHaveTextContent('Select region first');
  });

  it('re-gates when the parent is CLEARED, so the record is read live and not once', async () => {
    openDialog([REGION, GATED_LOOKUP]);
    expect(await screen.findByTestId('lookup-trigger-gated')).toBeDisabled();

    typeRegion('north');
    expect(await screen.findByTestId('lookup-trigger-contact')).toBeEnabled();

    typeRegion('');
    await waitFor(() => expect(screen.getByTestId('lookup-trigger-gated')).toBeDisabled());
  });

  it('the key reaches the widget through `...extra`, not through a named forward', () => {
    // The mechanism the `domain:ui` seat relayed onto this card, measured where
    // a reader of the renders above can find it: `bulkParamToField` destructures
    // out the keys the dialog itself consumes and spreads the REST verbatim, and
    // `dependsOn` is not among the destructured ones. ⛔ If a later change adds
    // it to that destructure list, the renders above go red for a reason no
    // render can name — this reads the adapter directly so the cause is visible.
    //
    // ⭐ The param is spread with a `help` key DECLARED, and that is the whole
    // point of the control below. An earlier draft read `field.help` off a
    // fixture that carried no `help` at all — so `undefined` was what the
    // adapter returned whatever it did with its destructure list, and contract
    // review proved it by deleting `help: _help,` and watching the case stay
    // green. A control that cannot come back red is not a control.
    const field = bulkParamToField({ ...GATED_LOOKUP, help: 'rendered by the dialog, not the widget' } as any, false);
    expect(field.dependsOn).toEqual(['region']);
    // LIT CONTROL on the same call, in both directions: `help` IS declared on
    // the param above and IS in the adapter's destructure list, so its absence
    // here is a reading of that list — and `dependsOn`'s presence is therefore a
    // reading of the spread, not of an adapter that copies everything.
    expect(field.help).toBeUndefined();
    expect(field.type).toBe('lookup');
    expect(field.reference).toBe('contacts');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg B — the authoring surface, and why its "accept" proves nothing          */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ A VERSION-QUALIFIED contract: this is a reading of the `@objectstack/spec`
 * this repo has installed, and the answers move if those schemas do. It is
 * pinned because the STRICTNESS DIFFERENCE between the two param schemas is
 * doing work that is invisible at every call site.
 *
 * ⚠️ THEY MOVED at 17.5.0 (objectui#11073). Through 17.4.0 the bulk schema was
 * `.passthrough()` and refused nothing, so its accept of `dependsOn` was a NULL
 * reading. 17.5.0 CLOSED it — a nonsense key is refused by name — and declares
 * `dependsOn` as a member, so the same accept is now EVIDENCE: `dependsOn` is
 * authorable on a bulk param. Re-pinned as that, rather than relaxed.
 */
describe('objectui#8755 leg B — the bulk param schema is strict since 17.5.0, so its accept of `dependsOn` is a reading', () => {
  const NONSENSE = 'zzz_not_a_key_any_producer_emits';
  const bulkParam = (over: Record<string, unknown>) => ({
    name: 'contact', label: 'Contact', type: 'lookup', object: 'contacts', ...over,
  });
  const actionParam = (over: Record<string, unknown>) => ({
    name: 'contact', label: 'Contact', type: 'lookup', reference: 'contacts', ...over,
  });

  it('POSITIVE CONTROL — both schemas parse their own minimal valid param', () => {
    // Without this, every verdict below could be a schema being misused.
    expect(BulkActionParamSchema.safeParse(bulkParam({})).success).toBe(true);
    expect(ActionParamSchema.safeParse(actionParam({})).success).toBe(true);
  });

  it('⭐ NEGATIVE CONTROL — a nonsense key is REFUSED by BOTH schemas since 17.5.0', () => {
    // Through 17.4.0 this one assertion was the whole card's warning: the bulk
    // schema ACCEPTED the nonsense key, so an "accept" meant nothing there.
    // 17.5.0 closed it (objectui#11073), and the two schemas now agree that an
    // unknown key is an error — which is what makes the SUBJECT row a reading.
    const bulk = BulkActionParamSchema.safeParse(bulkParam({ [NONSENSE]: 1 }));
    expect(bulk.success).toBe(false);
    expect(bulk.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);

    const strict = ActionParamSchema.safeParse(actionParam({ [NONSENSE]: 1 }));
    expect(strict.success).toBe(false);
    expect(strict.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('SUBJECT — `dependsOn` is accepted by the now-strict bulk schema, so it IS authorable on a bulk param', () => {
    // Read this ONLY together with the negative control above. Through 17.4.0
    // the schema that accepted this also accepted
    // `zzz_not_a_key_any_producer_emits`, so the accept carried no information;
    // since 17.5.0 that schema refuses the nonsense key, and this accept is a
    // declaration reading (objectui#11073).
    expect(BulkActionParamSchema.safeParse(bulkParam({ dependsOn: ['region'] })).success).toBe(true);

    // …while the strict sibling names it, which is what objectui#8672 left
    // standing: inline `dependsOn` on a single-record action param is refused,
    // and the honoured route there is the field-backed one.
    const strict = ActionParamSchema.safeParse(actionParam({ dependsOn: ['region'] }));
    expect(strict.success).toBe(false);
    const unrecognized = strict.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect((unrecognized as { keys?: string[] } | undefined)?.keys).toContain('dependsOn');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg C — TWO supply rules; the shared option set gains no member             */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8755 leg C — the fix ORs a second family; it does not widen the shared option set', () => {
  it('records WHY, and guards against "simplifying" it into CASCADE_OPTION_WIDGET_TYPES.add(lookup)', () => {
    // The same guard `app-shell`'s objectui#8672 pin carries, restated at this
    // surface because this is the other consumer of that shared object: a member
    // added there would silently change the object form's cascade-CLEAR loop as
    // well. The families stay separate and each surface ORs them.
    expect(CASCADE_OPTION_WIDGET_TYPES.has('lookup')).toBe(false);
    expect(EXPANDABLE_FIELD_TYPES.has('lookup')).toBe(true);
    // Lit controls on the same two reads, in both directions: an option widget
    // is in the first set and not the second.
    expect(CASCADE_OPTION_WIDGET_TYPES.has('radio')).toBe(true);
    expect(EXPANDABLE_FIELD_TYPES.has('radio')).toBe(false);
  });

  it('AT LEAST ONE of this dialog’s two reads consults the set `@object-ui/core` exports', async () => {
    // Identity, not membership — the shape objectui#4770 established for the
    // other family. The behavioural cases above pass against ANY set holding
    // `lookup`, including a re-inlined private copy; the spy is installed on the
    // Set object exported by `@object-ui/core`, so it records a call only if
    // this dialog consulted THAT object while rendering.
    //
    // ⚠️ STATED AT THE STRENGTH THIS INSTRUMENT HAS, AND NO HIGHER. The dialog
    // reads that object twice per param — `bulkParamToField`'s
    // `widgetNeedsDataSource` (pre-existing) and `paramNeedsDependentValues`
    // (the site this card adds) — and a `has` spy cannot tell the two apart, so
    // a recorded call proves only that AT LEAST ONE of them is not a private
    // copy. It was green before this card's change, and contract review measured
    // that it STAYS green when the record-supply read alone is re-forked onto a
    // private literal `Set`. ⛔ So it does not pin the new site; the case below
    // is the one that does, and leg A and leg D pin the behaviour.
    const spy = vi.spyOn(EXPANDABLE_FIELD_TYPES, 'has');
    try {
      openDialog([REGION, GATED_LOOKUP]);
      await screen.findByTestId('lookup-trigger-gated');
      expect(spy.mock.calls.map(([k]) => k)).toContain('lookup');
    } finally {
      spy.mockRestore();
    }
  });

  it('⭐ and the RECORD-SUPPLY read is that same object — forcing it to answer `false` re-gates the picker', async () => {
    // The discriminating instrument the `has`-call spy above is not. It does not
    // watch WHICH read happened; it changes what the shared object ANSWERS and
    // reads the consequence at the one site this card adds.
    //
    //  - real code: `paramNeedsDependentValues` asks THIS object, is told
    //    `lookup` is not a member, supplies no `dependentValues`, and the
    //    trigger stays gated even after the parent is filled — what is asserted.
    //  - a private-copy fork of that one site: it never asks this object, still
    //    answers true, still supplies the record, and the gate LIFTS ⇒ RED.
    //
    // The other read (`widgetNeedsDataSource`) is stubbed by the same mock, and
    // deliberately: it only decides whether a `dataSource` prop is threaded, and
    // `dependenciesMissing` does not read it, so it cannot produce the gate.
    const real = EXPANDABLE_FIELD_TYPES.has.bind(EXPANDABLE_FIELD_TYPES);
    const spy = vi
      .spyOn(EXPANDABLE_FIELD_TYPES, 'has')
      .mockImplementation((k: string) => (k === 'lookup' ? false : real(k)));
    try {
      // SELF-TEST of the stub before anything is read through it, on a known
      // input each way — otherwise a mock that silently failed to install would
      // render this case's green as a reading of the dialog.
      expect(EXPANDABLE_FIELD_TYPES.has('lookup')).toBe(false);
      expect(EXPANDABLE_FIELD_TYPES.has('user')).toBe(true);

      openDialog([REGION, GATED_LOOKUP, KEYSTROKE_WITNESS]);
      expect(await screen.findByTestId('lookup-trigger-gated')).toBeDisabled();

      typeRegion('north');

      // KEYSTROKE WITNESS — the same control leg A uses: the radio's offered set
      // narrows, so the dialog demonstrably saw the change. Without it, "still
      // gated" could be a dialog that never re-rendered.
      await waitFor(() => expect(screen.queryByTestId('radio-option-smb')).not.toBeInTheDocument());
      expect(screen.getByTestId('radio-option-ent')).toBeInTheDocument();

      // SUBJECT — the gate did NOT lift, because the supply site asked the
      // object this test controls.
      expect(screen.getByTestId('lookup-trigger-gated')).toBeDisabled();
      expect(screen.queryByTestId('lookup-trigger-contact')).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
    // …and the stub is gone again, so no later case inherits it.
    expect(EXPANDABLE_FIELD_TYPES.has('lookup')).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg D — end to end, the parent NARROWS the picker                          */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#8755 leg D — the filled parent narrows the bulk picker query', () => {
  it('⭐ the control offers the record the subject must not', async () => {
    const ds = openDialog([REGION, GATED_LOOKUP, CONTROL_LOOKUP]);

    await screen.findByTestId('lookup-trigger-control_contact');
    typeRegion('north');

    // SUBJECT — `region: 'north'` reaches the query as a hard `$filter`, so only
    // Ada is a candidate. This is what proves the dialog supplied a CORRECT
    // record and not merely a non-empty one: an unscoped picker lists Bo.
    fireEvent.click(await screen.findByTestId('lookup-trigger-contact'));
    await waitFor(() => expect(screen.getByText('Ada (north)')).toBeInTheDocument());
    expect(screen.queryByText('Bo (south)')).not.toBeInTheDocument();
    expect(
      ds.queries.some((q: any) => q.objectName === 'contacts' && q.params?.$filter?.region === 'north'),
    ).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Ada (north)')).not.toBeInTheDocument());

    // CONTROL — the sibling param declares no `dependsOn`, so the SAME reference
    // over the SAME records is unfiltered and Bo IS offered. Without this, "Bo
    // is absent" could just mean the picker never loaded.
    fireEvent.click(screen.getByTestId('lookup-trigger-control_contact'));
    await waitFor(() => expect(screen.getByText('Bo (south)')).toBeInTheDocument());
    expect(screen.getByText('Ada (north)')).toBeInTheDocument();
  });
});
