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
 *   - a FALSE `visibleWhen` -> absent   | a TRUE `visibleWhen` -> present
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
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { RecordFormPage } from './RecordFormPage';

const h = React.createElement;

const { formSchemas, getAuthConfig, authState } = vi.hoisted(() => ({
  formSchemas: [] as any[],
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

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: any) => {
    formSchemas.push(schema);
    return h('div', { 'data-testid': 'object-form' });
  },
}));

const metadataState = { objects: [] as any[], loading: false };
vi.mock('../providers/MetadataProvider', () => ({ useMetadata: () => metadataState }));
vi.mock('../providers/AdapterProvider', () => ({ useAdapter: () => null }));

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

describe('objectui#6514 — RecordFormPage honours the `visibleWhen` predicate, in both directions', () => {
  it('WITHHOLDS a field whose `visibleWhen` is FALSE', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // RED before the fix, same reason: the predicate lived on a key nothing read.
    expect(lastFields()).not.toContain('never_shown');
    expect(lastFields()).toContain('name');
  });

  it('SHOWS a field whose `visibleWhen` is TRUE', async () => {
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));

    // The complement — RED against inverted predicate handling.
    expect(lastFields()).toContain('always_shown');
  });

  it('decides the same predicate per user — excluded, then admitted', async () => {
    authState.user = CLERK;
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    expect(lastFields()).not.toContain('commission');

    cleanup();
    formSchemas.length = 0;
    authState.user = MANAGER;
    renderPage();
    await waitFor(() => expect(formSchemas.length).toBeGreaterThan(0));
    // Both halves in ONE case: the same authored predicate, opposite verdicts.
    // A gate stuck in either position fails one of these two lines.
    expect(lastFields()).toContain('commission');
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
