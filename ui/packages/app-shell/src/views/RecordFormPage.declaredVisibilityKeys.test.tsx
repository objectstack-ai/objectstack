/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6514 — the record form page gates on the keys `@objectstack/spec`
 * DECLARES, and no longer on the one it refuses.
 *
 * ## What was wrong
 *
 * The page filtered `objectDef.fields` with
 * `evaluateVisibility(f.visible, expressionEvaluator)`. `FieldSchema` is a
 * `strictObject` and `visible` is not one of its keys — it appears in
 * `FIELD_KEY_GUIDANCE` as prose that REFUSES the spelling, deliberately not as
 * an alias, because "this surface declares BOTH forms and the two answers have
 * opposite polarity". So the gate was unreachable through the authoring
 * surface: a field `visible` written in object metadata is rejected before it
 * can reach this call site, and the census re-run for this card found zero
 * field-level `visible` keys across the framework's 113 `*.object.*` files.
 *
 * The declared keys are `hidden` (a static boolean — INVERTED, so
 * `visible: false` is `hidden: true`) and `visibleWhen` (a CEL predicate, shown
 * only when TRUE). Maintainer ruling, 2026-08-27, Option A.
 *
 * ## Why BOTH directions are asserted, per key
 *
 * `visible` -> `hidden` is an INVERSION, and getting an inversion backwards
 * raises no error. It produces one of two silent outcomes: a field that should
 * show disappears with no diagnostic, or a field that should be hidden LEAKS to
 * a user who must not see it. A suite that asserts only the hiding half passes
 * just as well against logic that hides EVERYTHING, so it would prove nothing
 * about the polarity. Each key therefore carries a hiding case and its
 * complement:
 *
 *   - `hidden: true` -> absent          | `hidden: false` / absent -> present
 *   - `visibleWhen`, either way -> present: since objectstack#35249 the
 *     predicate is judged by the form, where the record is bound, and the
 *     list reads `hidden` alone. `hidden: true` still wins over a TRUE
 *     predicate (the AND below).
 *
 * Measured directions (both legs run for this card):
 *   - RED before the fix: every `hidden: true` / false-`visibleWhen` absence
 *     case (the page read neither key, so those fields rendered), and both
 *     dead-key cases (the page hid them on the refused spelling).
 *   - GREEN before the fix: the complements — a field with no `visible` was
 *     already present. They are not red-before-fix and cannot be; they are the
 *     half that goes RED under an INVERTED implementation, which is the actual
 *     threat model. That leg was measured by mutating the helper's polarity;
 *     see the PR body.
 *
 * ## Composition
 *
 * `hidden` and `visibleWhen` compose as AND (a field shows only if it is not
 * statically hidden AND its predicate holds) — the same shape
 * `@object-ui/core`'s `resolveFieldRuleState` already uses for the
 * `readonly`/`readonlyWhen` and `required`/`requiredWhen` pairs, where the
 * static and the predicate OR into the restrictive verdict. `visibleWhen` is
 * documented as "shown only when TRUE (else hidden)" — a necessary condition,
 * never a licence to un-hide a statically hidden field.
 *
 * ## Fenced boundary
 *
 * Field-level visibility keeps the contract's CURRENT scope: no `current_user`
 * binding is added here, and none is needed — `current_user` is already bound
 * on this page's evaluator by objectui#6493, and the spec's fault-open at this
 * tier is documented as intended (objectui#6443 / #6487). Per-user field hiding
 * goes through the option/form layers that bind the user. Nothing in this file
 * changes which roots the evaluator carries.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { RecordFormPage } from './RecordFormPage';

registerAllFields();

const h = React.createElement;

const { formSchemas, getAuthConfig, authState, drawn } = vi.hoisted(() => ({
  formSchemas: [] as any[],
  // `drawn.adapter` set ⇒ the REAL `ObjectForm` draws the page's schema over
  // it (objectstack#35249's drawn-level rows); unset ⇒ the probe stands in.
  drawn: { adapter: null as null | Record<string, any> },
  getAuthConfig: vi.fn(async () => ({ features: {} as Record<string, unknown> })),
  authState: {
    user: null as Record<string, unknown> | null,
    activeOrganization: null as { name: string } | null,
  },
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    get user() { return authState.user; },
    getAuthConfig,
    get activeOrganization() { return authState.activeOrganization; },
  }),
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => {
  const real = await importOriginal<Record<string, any>>();
  return {
    ...real,
    ObjectForm: (props: any) => {
      formSchemas.push(props.schema);
      return drawn.adapter ? h(real.ObjectForm, props) : h('div', { 'data-testid': 'object-form' });
    },
  };
});

const metadataState = { objects: [] as any[], loading: false };
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => metadataState }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => drawn.adapter }));

/** The served shape: `ExpressionInputSchema` normalises authored strings into this. */
const cel = (source: string) => ({ dialect: 'cel', source });

/**
 * One object carrying every arm of the matrix. Both fixture users have
 * `role: 'user'`, so `ALWAYS`/`NEVER` are decided by the predicate alone and
 * not by which user is signed in; only `commission` moves with the user.
 */
const ALWAYS = cel("current_user.role == 'user'");
const NEVER = cel("current_user.role == 'nobody_6514'");

const CONTACTS = {
  name: 'contacts',
  label: 'Contacts',
  fields: {
    // Ungated control. Present in every case — without it, an implementation
    // that dropped ALL fields would satisfy every `not.toContain` below.
    name: { type: 'text' },

    // --- static `hidden`, both directions -------------------------------
    archived_note: { type: 'text', hidden: true },
    plain_note: { type: 'text', hidden: false },

    // --- predicate `visibleWhen`, both directions ------------------------
    never_shown: { type: 'text', visibleWhen: NEVER },
    always_shown: { type: 'text', visibleWhen: ALWAYS },
    commission: { type: 'currency', visibleWhen: cel("'sales_manager' in current_user.positions") },

    // --- composition: the static gate is not overridable by the predicate --
    hidden_but_predicated: { type: 'text', hidden: true, visibleWhen: ALWAYS },
    // A total (`has()`-guarded) predicate over the record (objectstack#35249).
    record_gated: { type: 'text', visibleWhen: cel('has(record.stage) && record.stage == "closed_lost"') },

    // --- the DELETED read: the spec-refused spelling decides nothing ------
    legacy_predicate: { type: 'text', visible: NEVER },
    legacy_literal: { type: 'text', visible: false },
  },
};

const MANAGER = { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user', positions: ['sales_manager'] };
const CLERK = { id: 'u2', name: 'Bo', email: 'bo@example.com', role: 'user', positions: ['sales_clerk'] };

function renderPage() {
  return render(
    h(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      children: h(
        MemoryRouter,
        { initialEntries: ['/apps/crm/contacts/new'] },
        h(Routes, null, h(Route, {
          path: '/apps/:appName/:objectName/new',
          element: h(RecordFormPage, { mode: 'create' }),
        })),
      ),
    }),
  );
}

/**
 * The field list from the LAST schema handed to `ObjectForm`. `features` is
 * fetched, so the first render is always the pre-fetch one; reading anything
 * but the last would assert against a bag the page has not settled on.
 */
const lastFields = (): string[] => formSchemas[formSchemas.length - 1].fields;

beforeEach(() => {
  metadataState.objects = [CONTACTS];
  metadataState.loading = false;
  authState.user = CLERK;
  authState.activeOrganization = null;
  getAuthConfig.mockResolvedValue({ features: {} });
  formSchemas.length = 0;
  drawn.adapter = null;
});
afterEach(cleanup);

describe('objectui#6514 — RecordFormPage honours the static `hidden` key, in both directions', () => {
  it('WITHHOLDS a field declared `hidden: true`', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // RED before the fix: the page read `visible`, which this field does not
    // carry, so `evaluateVisibility(undefined)` answered `true` and the field
    // an author had explicitly hidden was rendered.
    expect(lastFields()).not.toContain('archived_note');
    // The control — a change that empties the list must not pass here.
    expect(lastFields()).toContain('name');
  });

  it('SHOWS a field declared `hidden: false`, and one that declares no `hidden` at all', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // The complement. `hidden` is INVERTED relative to the key it replaces, and
    // an implementation that read the inversion backwards would hide these two
    // while still passing every absence case above.
    expect(lastFields()).toContain('plain_note');
    expect(lastFields()).toContain('name');
  });
});

describe('objectstack#35249 — RecordFormPage lists a `visibleWhen` field for the FORM to judge', () => {
  // The page's list reads the static `hidden` only. A field's `visibleWhen` is
  // evaluated by the form, where the record and this page's scope are bound
  // (`expressionUser.mountParity.test.tsx` pins that scope's verdicts); judged
  // here, with no record, a `has()`-guarded predicate answered a clean FALSE
  // and the field never reached the form.
  it('lists a field whose `visibleWhen` reads the record, whatever the predicate answers without one', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).toContain('record_gated');
    expect(lastFields()).toContain('name');
  });

  it('lists a field whose `visibleWhen` is FALSE or TRUE for the signed-in user alike', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    expect(lastFields()).toEqual(expect.arrayContaining(['never_shown', 'always_shown', 'commission']));
  });
});

describe('objectui#6514 — the two declared keys compose as AND', () => {
  it('keeps a `hidden: true` field withheld even when its `visibleWhen` is TRUE', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // `visibleWhen` is documented as "shown only when TRUE (else hidden)" — a
    // necessary condition, not a licence to un-hide. Same shape as
    // `resolveFieldRuleState`'s `readonly || readonlyWhen`.
    expect(lastFields()).not.toContain('hidden_but_predicated');
    // …and the predicate alone still shows its own field, so this case is not
    // passing merely because `visibleWhen` stopped working.
    expect(lastFields()).toContain('always_shown');
  });
});

describe('objectui#6514 — the spec-refused `visible` read is DELETED, not merely supplemented', () => {
  it('ignores a field-level `visible` predicate that would have hidden the field', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // RED before the fix (the field was ABSENT then — the whole defect). The
    // key is refused by `FieldSchema`, so metadata carrying it never validates;
    // a field that reaches the renderer with one must not have it obeyed, or
    // the dead read is still alive under a second contract.
    expect(lastFields()).toContain('legacy_predicate');
  });

  it('ignores a field-level `visible: false` literal', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // The literal arm of the same refusal. Also RED before the fix.
    expect(lastFields()).toContain('legacy_literal');
  });
});

/**
 * objectstack#35249 — the field a record predicate admits is DRAWN on the page.
 *
 * The real `ObjectForm` draws the schema this page hands it, over a data
 * source serving the object and the record, under the page's own
 * `ExpressionProvider`. The predicates are total (`has()`-guarded), the shape
 * that answered a clean FALSE when the page's list judged them with no record.
 */
const LOST = cel(
  '(has(record.stage) && record.stage == "closed_lost") || (has(record.requested_status) && record.requested_status == "closed_lost")',
);
const WON = cel(
  '(has(record.stage) && record.stage == "closed_won") || (has(record.requested_status) && record.requested_status == "closed_won")',
);
const DEAL = {
  name: 'deal',
  label: 'Deal',
  fieldGroups: [
    { key: 'basics', label: 'Basics' },
    { key: 'outcome', label: 'Outcome' },
  ],
  fields: {
    title: { type: 'text', label: 'Title', group: 'basics' },
    stage: {
      type: 'select',
      label: 'Stage',
      group: 'basics',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Closed Lost', value: 'closed_lost' },
        { label: 'Closed Won', value: 'closed_won' },
      ],
    },
    loss_reason: { type: 'text', label: 'Loss Reason', group: 'outcome', visibleWhen: LOST },
    win_reason: { type: 'text', label: 'Win Reason', group: 'outcome', visibleWhen: WON },
    loss_memo: { type: 'text', label: 'Loss Memo', group: 'outcome', hidden: true, visibleWhen: LOST },
    next_step: { type: 'text', label: 'Next Step', group: 'outcome' },
  },
};
const LOST_DEAL = { id: 'd1', title: 'Stark Expansion', stage: 'closed_lost', loss_reason: 'Price', next_step: 'Debrief' };

function serveDeal(object: Record<string, unknown> = DEAL) {
  metadataState.objects = [object];
  drawn.adapter = {
    getObjectSchema: vi.fn(async () => structuredClone(object)),
    findOne: vi.fn(async () => structuredClone(LOST_DEAL)),
    create: vi.fn(async (_o: string, d: Record<string, unknown>) => ({ id: 'd2', ...d })),
    update: vi.fn(async () => ({ id: 'd1' })),
  };
}

function renderDealPage(mode: 'edit' | 'create') {
  const path = mode === 'edit' ? '/apps/crm/deal/record/d1/edit' : '/apps/crm/deal/new';
  return render(
    h(I18nProvider, {
      config: { defaultLanguage: 'en', detectBrowserLanguage: false },
      children: h(
        MemoryRouter,
        { initialEntries: [path] },
        h(Routes, null,
          h(Route, { path: '/apps/:appName/:objectName/record/:recordId/edit', element: h(RecordFormPage, { mode: 'edit' }) }),
          h(Route, { path: '/apps/:appName/:objectName/new', element: h(RecordFormPage, { mode: 'create' }) }),
        ),
      ),
    }),
  );
}

const drawnField = (name: string) => document.body.querySelector(`[name="${name}"]`) != null;

describe('objectstack#35249 — RecordFormPage draws the field a record predicate admits', () => {
  it('edit, form laid out from `fieldGroups`: the predicate that holds draws its field', async () => {
    serveDeal();
    renderDealPage('edit');
    await waitFor(() => expect(drawnField('title')).toBe(true));
    await waitFor(() => expect(document.body.textContent).toContain('Outcome'));

    expect(drawnField('loss_reason'), 'visibleWhen holds for the record: drawn').toBe(true);
    expect(drawnField('win_reason'), 'CONTROL: visibleWhen is false for the record: hidden').toBe(false);
    expect(drawnField('loss_memo'), 'CONTROL: `hidden: true` wins over a predicate that holds').toBe(false);
    expect(drawnField('next_step'), 'CONTROL: no predicate: drawn').toBe(true);
  });

  it('edit, authored form view: a section naming the field draws it too', async () => {
    serveDeal({
      ...DEAL,
      form: {
        type: 'simple',
        sections: [
          { name: 'main', label: 'Main', fields: ['title', 'stage'] },
          { name: 'close', label: 'Close', fields: ['loss_reason', 'win_reason', 'loss_memo', 'next_step'] },
        ],
      },
    });
    renderDealPage('edit');
    await waitFor(() => expect(drawnField('title')).toBe(true));
    await waitFor(() => expect(document.body.textContent).toContain('Close'));

    expect(drawnField('loss_reason')).toBe(true);
    expect(drawnField('win_reason')).toBe(false);
    expect(drawnField('loss_memo')).toBe(false);
    expect(drawnField('next_step')).toBe(true);
  });

  it('create: the record-reading predicate is judged against the empty record and the form stays usable', async () => {
    serveDeal();
    renderDealPage('create');
    await waitFor(() => expect(drawnField('title')).toBe(true));

    expect(drawnField('loss_reason'), 'no stage yet: the predicate is false').toBe(false);
    expect(drawnField('next_step')).toBe(true);
    // The renderer refuses a submit while a field's `visibleWhen` faults
    // (ADR-0137 D2). The predicate is total, so it answers FALSE without
    // faulting and the create goes through.
    fireEvent.change(document.body.querySelector('input[name="title"]') as HTMLInputElement, { target: { value: 'New deal' } });
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(drawn.adapter!.create).toHaveBeenCalledTimes(1));
    expect(drawn.adapter!.create.mock.calls[0][1]).toMatchObject({ title: 'New deal' });
  });
});
