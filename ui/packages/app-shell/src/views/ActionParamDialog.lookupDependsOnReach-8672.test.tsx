/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8672 — a `dependsOn` lookup ACTION PARAM gates, UNGATES, and filters.
 *
 * ⭐ These were MEASUREMENT pins and are now CONTRACT pins. The file that stood
 * here recorded today's behaviour and endorsed none of it: legs A and C were
 * labelled "CURRENT SHAPE, NOT CONTRACT" and told whoever implemented one of the
 * card's three dispositions to expect them red and rewrite them. The maintainer
 * ruled **A — wire it** (director seat, decision batch #115, 2026-09-11), so
 * that is what happened: every `expect` below now states what the code MUST do.
 *
 * ## What ruling A settled, and what each leg holds to it
 *
 * - **Leg A — the dialog.** `ActionParamDialog` supplies its live record to the
 *   reference-bearing pickers, not only to the option widgets, so a lookup param
 *   declaring `dependsOn` is gated while the named parent is EMPTY and ungates
 *   the moment it carries a value. The record is the dialog's own in-progress
 *   `values`: unlike the grid (`ctx.pendingRow ?? ctx.row`, objectui#7165/#7188)
 *   this surface holds no row at all — its params ARE the record, which is the
 *   measurement the ruling left to the implementer.
 * - **Leg B — the authoring surface. UNCHANGED by the ruling, which says so in
 *   as many words:** `@objectstack/spec`'s `ActionParamSchema` still refuses
 *   `dependsOn` written INLINE on a param. The honoured route is the
 *   field-backed one, so leg A still has to synthesise a resolved
 *   `ActionParamDef` rather than author a param.
 * - **Leg C — the resolver.** `resolveActionParams` reads the DECLARED spelling
 *   `field.dependsOn` and no longer reads snake `field.depends_on`, which
 *   `FieldSchema` refuses by name. Both halves of that swap are pinned: the
 *   declared key must arrive, and the refused one must not.
 * - **Leg D — the two halves meeting.** The end-to-end route the repo's own
 *   `RESOLVED_ONLY_PARAM_KEYS.dependsOn` message points authors to ("make the
 *   param field-backed … to pick it up"), driven from an object field def
 *   through the resolver into the rendered dialog and out to the picker's
 *   query. ⭐ This is the leg that would have been impossible before the ruling
 *   and the one that fails if either half is reverted alone.
 *
 * ## Every reading still has a lit control beside it
 *
 * An ungated trigger and a narrowed candidate list are both shapes a broken
 * fixture produces for free, so neither is asserted alone:
 *
 * - leg A keeps the CONTROL lookup (identical but for `dependsOn`, asserted
 *   enabled throughout) and the keystroke witness — a `radio` whose `visibleWhen`
 *   reacts to the same keystroke — so "the gate lifted" is read against a
 *   keystroke proven to have reached the dialog, and it keeps the NEGATIVE
 *   control that an empty parent still gates, so the fix cannot be read as
 *   "the gate was deleted";
 * - leg B pairs each refusal with a positive control document that must PARSE
 *   and an unknown-key document that must be REFUSED;
 * - leg C pairs each reading with a sibling key resolved off the SAME field def
 *   in the same call;
 * - leg D offers two records under one reference and asserts the declared param
 *   sees one while the control param sees both — so a narrowed list cannot be a
 *   picker that simply failed to load.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ActionParamDef } from '@object-ui/core';
import { CASCADE_OPTION_WIDGET_TYPES, EXPANDABLE_FIELD_TYPES } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ActionParamSchema } from '@objectstack/spec/ui';
import { FieldSchema } from '@objectstack/spec/data';
// Module scope, per AGENTS.md 测试纪律: the dialog reaches `LookupField` through
// a `React.lazy` factory inside `@object-ui/fields`, and a first dynamic
// import() under a saturated transform pipeline can eat most of RTL's 1s
// `findBy` budget. This barrel statically re-exports those widget modules, so
// the lazy factories resolve in a microtask instead of racing the assertions.
import '@object-ui/fields';
import { ActionParamDialog } from './ActionParamDialog';
import {
  resolveActionParams,
  type ResolveActionParamsContext,
  type RawActionParam,
} from '@object-ui/fields';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as never;
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg A — the dialog supplies the record                  CONTRACT           */
/* ────────────────────────────────────────────────────────────────────────── */

/** The parent the child lookup names. A plain text param, so it is typable. */
const ACCOUNT: ActionParamDef = { name: 'account', label: 'Account', type: 'text' };

/**
 * The card's shape verbatim: `{ type: 'lookup', referenceTo: 'contacts',
 * dependsOn: ['account'] }`. Synthesised as a RESOLVED `ActionParamDef` on
 * purpose — leg B measures that this cannot be authored as a raw param at all,
 * and leg D drives the route that CAN produce it.
 */
const GATED_LOOKUP: ActionParamDef = {
  name: 'contact',
  label: 'Contact',
  type: 'lookup',
  referenceTo: 'contacts',
  dependsOn: ['account'],
};

/** CONTROL — the same lookup, same target, differing ONLY in `dependsOn`. */
const CONTROL_LOOKUP: ActionParamDef = {
  name: 'control_contact',
  label: 'Control contact',
  type: 'lookup',
  referenceTo: 'contacts',
};

/**
 * CONTROL for the KEYSTROKE. A `radio` IS in `CASCADE_OPTION_WIDGET_TYPES`, so
 * the dialog threads its in-progress values to it and this option's predicate
 * re-resolves on every change to `account`. Without it, a gate that failed to
 * lift would be indistinguishable from a dialog that never saw the keystroke.
 */
const KEYSTROKE_WITNESS: ActionParamDef = {
  name: 'tier',
  label: 'Tier',
  type: 'radio',
  options: [
    { label: 'Enterprise', value: 'ent', visibleWhen: "record.account == 'acme'" },
    { label: 'Small business', value: 'smb', visibleWhen: "record.account == 'other'" },
  ],
};

function openDialog(params: ActionParamDef[], dataSource?: unknown) {
  const dialog = (
    <ActionParamDialog
      state={{ open: true, params, resolve: () => {} }}
      onOpenChange={() => {}}
    />
  );
  return render(
    dataSource
      ? <SchemaRendererProvider dataSource={dataSource as never}>{dialog}</SchemaRendererProvider>
      : dialog,
  );
}

const typeAccount = (value: string, label = 'Account') =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('objectui#8672 leg A — a `dependsOn` lookup param gates on an EMPTY parent and ungates when it is filled', () => {
  it('NEGATIVE CONTROL — with the parent still empty the declared lookup is gated, and the control beside it is not', async () => {
    openDialog([ACCOUNT, GATED_LOOKUP, CONTROL_LOOKUP]);

    // CONTROL first: an identical lookup differing only in `dependsOn` renders a
    // normal, enabled trigger. This is what makes the gated reading below a
    // measurement of `dependsOn` rather than of a lookup that cannot render here.
    const control = await screen.findByTestId('lookup-trigger-control_contact');
    expect(control).toBeEnabled();

    // ⭐ The gate is NOT deleted by ruling A — it is given a way out. An empty
    // parent must still gate, or the picker would issue the unfiltered query
    // that the cascade exists to prevent.
    const gated = screen.getByTestId('lookup-trigger-gated');
    expect(gated).toBeDisabled();
    expect(gated).toHaveTextContent('Select account first');
  });

  it('⭐ LIFTS the gate when the named parent is filled — the assertion ruling A turned around', async () => {
    openDialog([ACCOUNT, GATED_LOOKUP, KEYSTROKE_WITNESS]);

    // Both witness options are offered before anything is typed: `record.account`
    // is unresolvable, which fails OPEN.
    expect(await screen.findByTestId('radio-option-ent')).toBeInTheDocument();
    expect(screen.getByTestId('radio-option-smb')).toBeInTheDocument();
    expect(screen.getByTestId('lookup-trigger-gated')).toBeDisabled();

    typeAccount('acme');

    // The keystroke DID reach the dialog and DID re-render it: the witness's
    // offered set narrowed. Kept from the measurement pins — it is what makes
    // the assertion after it a reading of the supply rule and not of the event.
    await waitFor(() => expect(screen.queryByTestId('radio-option-smb')).not.toBeInTheDocument());
    expect(screen.getByTestId('radio-option-ent')).toBeInTheDocument();

    // ⭐ THE CARD, INVERTED. Before ruling A this stayed `lookup-trigger-gated`
    // and `disabled` forever, prompting for the field the user had just filled.
    // The gated test id is `LookupField`'s own signal, so its disappearance and
    // the named trigger's arrival are one fact read two ways.
    const ungated = await screen.findByTestId('lookup-trigger-contact');
    expect(ungated).toBeEnabled();
    expect(screen.queryByTestId('lookup-trigger-gated')).not.toBeInTheDocument();
    expect(ungated).not.toHaveTextContent('Select account first');
  });

  it('re-gates when the parent is CLEARED, so the record is read live and not once', async () => {
    // Guards the shape where a host seeds the record at mount: `values` is read
    // on every render, so emptying the parent must put the gate back.
    openDialog([ACCOUNT, GATED_LOOKUP]);
    expect(await screen.findByTestId('lookup-trigger-gated')).toBeDisabled();

    typeAccount('acme');
    expect(await screen.findByTestId('lookup-trigger-contact')).toBeEnabled();

    typeAccount('');
    await waitFor(() => expect(screen.getByTestId('lookup-trigger-gated')).toBeDisabled());
  });

  it('records WHY: TWO supply rules, and the shared option set was deliberately NOT widened', () => {
    // The mechanism behind the renders above, stated where it can be found from
    // them. `ActionParamDialog`'s `paramNeedsDependentValues()` ORs two families
    // that mean different things, exactly as the object form's two lines do.
    //
    // ⛔ This assertion is not a leftover from the measurement pins: it is the
    // guard against "simplifying" the fix into `CASCADE_OPTION_WIDGET_TYPES.add
    // ('lookup')`. That set is shared verbatim with the object form's
    // cascade-CLEAR loop and with `plugin-grid`'s `BulkActionDialog`, so a
    // member added there changes two surfaces this card never measured and
    // decides objectui#4771's open boundary for them.
    expect(CASCADE_OPTION_WIDGET_TYPES.has('lookup')).toBe(false);
    expect(EXPANDABLE_FIELD_TYPES.has('lookup')).toBe(true);
    // Lit controls on the same two reads, in both directions: an option widget
    // is in the first set and not the second.
    expect(CASCADE_OPTION_WIDGET_TYPES.has('radio')).toBe(true);
    expect(EXPANDABLE_FIELD_TYPES.has('radio')).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg B — where the authoring surface is                  CONTRACT           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ A VERSION-QUALIFIED contract: it is a reading of the `@objectstack/spec`
 * this repo has installed, and the answer moves if that schema does. Ruling A
 * left it standing explicitly — "`ActionParamSchema` still refuses `dependsOn`
 * written inline on a param — that stays; the honoured route is the field-backed
 * one" — so this leg is the fence that keeps the fix on that route.
 */
describe('objectui#8672 leg B — `@objectstack/spec` still refuses `dependsOn` INLINE on an action param', () => {
  const param = (over: Record<string, unknown>) => ({
    name: 'contact',
    label: 'Contact',
    type: 'lookup',
    reference: 'contacts',
    ...over,
  });

  it('POSITIVE CONTROL — a lookup action param with no cascade key parses', () => {
    // Without this the refusals below could be a schema that refuses everything.
    expect(ActionParamSchema.safeParse(param({})).success).toBe(true);
  });

  it('NEGATIVE CONTROL — an unknown key is refused, so the schema is live and strict', () => {
    const r = ActionParamSchema.safeParse(param({ zzz_not_a_key: 1 }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });

  it('SUBJECT — `dependsOn` on a lookup action param is an unrecognized key', () => {
    const r = ActionParamSchema.safeParse(param({ dependsOn: ['account'] }));
    expect(r.success).toBe(false);
    const unrecognized = r.error?.issues.find((i) => i.code === 'unrecognized_keys');
    expect(unrecognized).toBeDefined();
    expect((unrecognized as { keys?: string[] } | undefined)?.keys).toContain('dependsOn');
  });

  it('the refusal is not lookup-specific — a `select` param is refused the same way', () => {
    // Recorded so a reader does not take the refusal for a narrow, type-scoped
    // rule it is not: no action param of any type admits `dependsOn` inline.
    const r = ActionParamSchema.safeParse({
      name: 'city', label: 'City', type: 'select', dependsOn: ['country'],
    });
    expect(r.success).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg C — the field-backed read follows the declared spelling  CONTRACT      */
/* ────────────────────────────────────────────────────────────────────────── */

const ctx = (field: Record<string, unknown>): ResolveActionParamsContext => ({
  objectName: 'crm_case',
  objects: [{ name: 'crm_case', fields: { contact_id: field } }] as never,
  fieldLabel: (_o, _f, fallback) => fallback,
});

const FIELD_BACKED: RawActionParam[] = [{ field: 'contact_id' }];

describe('objectui#8672 leg C — the field-backed route reads the spelling `FieldSchema` declares', () => {
  it('CONTROL — `FieldSchema` accepts camel `dependsOn` on a lookup field and refuses the snake twin by name', () => {
    const base = { name: 'contact_id', label: 'Contact', type: 'lookup', reference: 'contacts' };
    // POSITIVE CONTROL: the field def parses at all.
    expect(FieldSchema.safeParse(base).success).toBe(true);
    // The spelling the spec declares (objectui#7357 retired objectui's twin).
    expect(FieldSchema.safeParse({ ...base, dependsOn: ['account_id'] }).success).toBe(true);
    // …and the spelling this resolver used to read is refused here. That
    // asymmetry is the whole reason the read moved rather than gaining a
    // second arm behind the declared one.
    expect(FieldSchema.safeParse({ ...base, depends_on: ['account_id'] }).success).toBe(false);
  });

  it('⭐ a spec-valid field declaring camel `dependsOn` now RESOLVES it', () => {
    const [resolved] = resolveActionParams(
      FIELD_BACKED,
      ctx({ type: 'lookup', label: 'Contact', reference: 'contacts', dependsOn: ['account_id'] }),
    );
    // LIT CONTROL on the same call: a sibling key off the SAME field def, so a
    // reading below cannot come from a fixture the resolver never saw.
    expect(resolved.referenceTo).toBe('contacts');
    expect(resolved.type).toBe('lookup');
    // SUBJECT — this was `undefined` until ruling A, which is why the route the
    // repo's own `RESOLVED_ONLY_PARAM_KEYS.dependsOn` message points authors to
    // reached nothing.
    expect(resolved.dependsOn).toEqual(['account_id']);
  });

  it('the snake spelling the spec refuses NO LONGER reaches the resolved param', () => {
    const [resolved] = resolveActionParams(
      FIELD_BACKED,
      ctx({ type: 'lookup', label: 'Contact', reference: 'contacts', depends_on: ['account_id'] }),
    );
    // Same lit control: the def WAS read, so the `undefined` below is a refusal
    // and not an unread fixture.
    expect(resolved.referenceTo).toBe('contacts');
    // ⛔ The retirement half. Keeping this leg behind the declared one would
    // leave this resolver the last reader of a spelling no parseable document
    // can carry (AGENTS.md #0.1 — no consumer-side tolerance for metadata the
    // producer refuses).
    expect(resolved.dependsOn).toBeUndefined();
  });

  it('a def declaring BOTH spellings resolves the declared one — no snake fallback survives', () => {
    const [resolved] = resolveActionParams(
      FIELD_BACKED,
      ctx({
        type: 'lookup', label: 'Contact', reference: 'contacts',
        dependsOn: ['account_id'], depends_on: ['legacy_id'],
      }),
    );
    expect(resolved.dependsOn).toEqual(['account_id']);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg D — end to end, the route the repo points authors to    CONTRACT       */
/* ────────────────────────────────────────────────────────────────────────── */

/** Only the two members these assertions read; the picker passes more. */
type QueryParams = { $filter?: Record<string, unknown> };

const CONTACTS = [
  { id: 'k1', name: 'Ada (acme)', account_id: 'acme' },
  { id: 'k2', name: 'Bo (other)', account_id: 'other' },
];

/** Honours the `$filter` record, so the cascade is observable as RENDERED ROWS
 *  and not only as call arguments. */
function makeDataSource() {
  const queries: Array<{ objectName: string; params: QueryParams }> = [];
  return {
    queries,
    find: vi.fn(async (objectName: string, params: QueryParams) => {
      queries.push({ objectName, params });
      let recs = CONTACTS;
      const filter = params?.$filter;
      if (filter && typeof filter === 'object' && filter.account_id) {
        recs = recs.filter((c) => c.account_id === filter.account_id);
      }
      return { data: recs, total: recs.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_o: string, id: string) => CONTACTS.find((c) => c.id === id) ?? null),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' }, account_id: { type: 'text' } },
    }),
  };
}

/** The object def an author really writes — three fields, one declaring the
 *  cascade and one deliberately not. */
const CASE_FIELDS: Record<string, Record<string, unknown>> = {
  account_id: { type: 'text', label: 'Account' },
  contact_id: {
    type: 'lookup', label: 'Contact', reference: 'contacts', dependsOn: ['account_id'],
  },
  control_contact_id: { type: 'lookup', label: 'Control contact', reference: 'contacts' },
};

const FIELD_BACKED_PARAMS: RawActionParam[] = [
  { field: 'account_id' },
  { field: 'contact_id' },
  { field: 'control_contact_id' },
];

describe('objectui#8672 leg D — a field-backed lookup param cascades end to end', () => {
  const resolveAll = () =>
    resolveActionParams(FIELD_BACKED_PARAMS, {
      objectName: 'crm_case',
      objects: [{ name: 'crm_case', fields: CASE_FIELDS }] as never,
      fieldLabel: (_o, _f, fallback) => fallback,
    });

  it('the declared cascade survives the resolver and reaches the rendered dialog', async () => {
    const params = resolveAll();
    // The resolver's half, asserted where the render can be read against it.
    expect(params.map((p) => p.name)).toEqual(['account_id', 'contact_id', 'control_contact_id']);
    expect(params[1].dependsOn).toEqual(['account_id']);
    expect(params[2].dependsOn).toBeUndefined();

    openDialog(params, makeDataSource());

    // CONTROL — the sibling param with no cascade is open from the start.
    expect(await screen.findByTestId('lookup-trigger-control_contact_id')).toBeEnabled();
    // SUBJECT — gated on the empty parent, then released by it.
    expect(screen.getByTestId('lookup-trigger-gated')).toBeDisabled();

    typeAccount('acme');

    expect(await screen.findByTestId('lookup-trigger-contact_id')).toBeEnabled();
  });

  it('⭐ and the parent NARROWS the picker — the control offers the record the subject must not', async () => {
    const ds = makeDataSource();
    openDialog(resolveAll(), ds);

    await screen.findByTestId('lookup-trigger-control_contact_id');
    typeAccount('acme');

    // SUBJECT — `account_id: 'acme'` reaches the query as a hard `$filter`, so
    // only Ada is a candidate. This is what proves the dialog supplied a
    // CORRECT record and not merely a non-empty one: an unscoped picker lists Bo.
    fireEvent.click(await screen.findByTestId('lookup-trigger-contact_id'));
    await waitFor(() => expect(screen.getByText('Ada (acme)')).toBeInTheDocument());
    expect(screen.queryByText('Bo (other)')).not.toBeInTheDocument();
    expect(
      ds.queries.some((q) => q.objectName === 'contacts' && q.params?.$filter?.account_id === 'acme'),
    ).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Ada (acme)')).not.toBeInTheDocument());

    // CONTROL — the sibling param declares no `dependsOn`, so the SAME reference
    // over the SAME records is unfiltered and Bo IS offered. Without this,
    // "Bo is absent" could just mean the picker never loaded.
    fireEvent.click(screen.getByTestId('lookup-trigger-control_contact_id'));
    await waitFor(() => expect(screen.getByText('Bo (other)')).toBeInTheDocument());
    expect(within(document.body).getByText('Ada (acme)')).toBeInTheDocument();
  });
});
