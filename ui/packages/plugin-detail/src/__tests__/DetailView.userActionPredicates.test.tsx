/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4419 — the record detail header honors `userActions.{delete,edit}`
 * in its PREDICATE form, not only its boolean one.
 *
 * The asymmetry this file pins: `userActions: { delete: false }` reached all
 * three delete surfaces (row kebab, selection bar, detail header) because the
 * HOST lowers the boolean into `schema.showDelete`. The object form —
 * `delete: { visibleWhen: … }` — reached only the row kebab, because the
 * header ANDed three gates (`schema.showDelete ∧ objectAllowsDelete ∧
 * canDeleteRecord`) and never evaluated the predicate. An author upgrading
 * from "nobody may delete this object" to "these records may not be deleted"
 * silently lost the surface they were most likely to have tested on.
 *
 * ## Which evaluator, and why this shape
 *
 * The header reuses the SAME helper family the row surfaces use, so one
 * authored predicate gets one answer platform-wide:
 *
 *   • `userActionPredicates()` from `@object-ui/core` — THE parser for the
 *     boolean/object form, the exact import `RelatedList` already makes
 *     (`RelatedList.tsx`'s `rowEditPredicates` / `rowDeletePredicates`).
 *   • `useRowPredicate()` from `@object-ui/react` — the canonical CEL
 *     evaluation. `plugin-grid`'s `evalRowActionVisibility` (the body of
 *     `isBuiltinRowActionVisible`) documents itself as mirroring
 *     `useRowPredicate(pred, row, { fallback: false, warnOnError: true,
 *     label, fields })` "exactly, boolean short-circuit included" — it is
 *     hook-FREE only because a row loop evaluates a variable number of
 *     actions inside one `useMemo`. The header evaluates a fixed arity of
 *     one record, so the hook form is the same evaluator without that
 *     constraint.
 *
 * Posture copied verbatim from `DataTableBuiltinRowActionItem`: `visibleWhen`
 * counts as declared by `!= null` (so `visibleWhen: false` HIDES rather than
 * reading as ungated) and fails CLOSED; `disabledWhen` is gated by `!= null`
 * too and fails SOFT.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { DetailView } from '../DetailView';
import { __clearRecordEditableCache } from '../useRecordEditable';
import { PermissionProvider } from '@object-ui/permissions';
import type { DetailViewSchema } from '@object-ui/types';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';

/** The card's own fixture: a PAID invoice is the predicate-FALSE record. */
const PAID = { id: 'INV-1011', name: 'INV-1011', status: 'paid', owner: 'u1' };
/** …and an OPEN one is the predicate-TRUE control. */
const OPEN = { id: 'INV-1001', name: 'INV-1001', status: 'open', owner: 'u1' };

/** `showcase_invoice`'s real declaration (`invoice.object.ts:58`). */
const INVOICE_USER_ACTIONS = {
  edit: { disabledWhen: "record.status == 'paid'" },
  delete: { visibleWhen: "record.status != 'paid'" },
};

const OBJECT_FIELDS = {
  name: { type: 'text' },
  status: { type: 'select' },
  owner: { type: 'lookup', reference: 'user' },
};

/**
 * The record-level explain probe, served from a double — see the identical
 * note in `DetailView.test.tsx`. `visible: true` keeps `canEditRecord` /
 * `canDeleteRecord` true so the ONLY thing moving in this file is the
 * predicate conjunct.
 */
function installExplainDouble() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
}

function makeDataSource(userActions: unknown) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'showcase_invoice',
      fields: OBJECT_FIELDS,
      ...(userActions === undefined ? {} : { userActions }),
    }),
  } as any;
}

function schemaFor(
  data: Record<string, unknown>,
  overrides: Partial<DetailViewSchema> = {},
): DetailViewSchema {
  return {
    type: 'detail-view',
    title: 'Invoice',
    objectName: 'showcase_invoice',
    data,
    fields: [{ name: 'name', label: 'Name' }],
    showEdit: true,
    showDelete: true,
    showBack: false,
    ...overrides,
  };
}

/**
 * Mount the header and WAIT for the async `getObjectSchema` to land, so a
 * "Delete is gone" assertion can never pass merely because the object schema
 * (and therefore the predicate) had not arrived yet.
 */
async function mountHeader(
  data: Record<string, unknown>,
  userActions: unknown,
  overrides: Partial<DetailViewSchema> = {},
  wrap: (ui: React.ReactElement) => React.ReactElement = (ui) => ui,
) {
  const dataSource = makeDataSource(userActions);
  const view = render(wrap(<DetailView schema={schemaFor(data, overrides)} dataSource={dataSource} />));
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalledWith('showcase_invoice'));
  return view;
}

/** Open the header's unified "⋯" overflow and return its rendered item labels. */
async function openHeaderOverflow(): Promise<string[]> {
  const trigger = screen.getByRole('button', { name: /more actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return screen
    .getAllByRole('menuitem')
    .map((el) => (el.textContent ?? '').trim());
}

/** The header's primary Edit CTA (desktop). */
function headerEditButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /^edit$/i });
}

const roles: RoleDefinition[] = [
  { name: 'reader', label: 'Reader', description: 'read only' },
];
const READ_ONLY: ObjectPermissionConfig = {
  object: 'showcase_invoice',
  roles: { reader: { actions: ['read'] } },
};

describe('DetailView header — `userActions` predicates (objectui#4419)', () => {
  beforeEach(() => {
    __clearRecordEditableCache();
    installExplainDouble();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // RED #1 — the card's own repro: predicate FALSE ⇒ the header stops offering
  // Delete. Pre-fix this menu still lists "Delete".
  // -------------------------------------------------------------------------
  it('hides the header Delete on a record its `delete.visibleWhen` excludes', async () => {
    await mountHeader(PAID, INVOICE_USER_ACTIONS);
    const items = await openHeaderOverflow();
    expect(items).not.toContain('Delete');
    // The companion: the overflow itself still rendered, so "no Delete" cannot
    // be "no menu".
    expect(items).toContain('Share');
  });

  // -------------------------------------------------------------------------
  // RED #2 — new behavior: `edit.disabledWhen` greys the header Edit CTA
  // (kebab symmetry). Pre-fix the button is enabled.
  // -------------------------------------------------------------------------
  it('renders the header Edit DISABLED when `edit.disabledWhen` holds', async () => {
    const onEdit = vi.fn();
    const dataSource = makeDataSource(INVOICE_USER_ACTIONS);
    render(
      <DetailView schema={schemaFor(PAID)} dataSource={dataSource} onEdit={onEdit} />,
    );
    await waitFor(() =>
      expect(dataSource.getObjectSchema).toHaveBeenCalledWith('showcase_invoice'),
    );
    const edit = await waitFor(() => {
      const btn = headerEditButton();
      expect(btn).toBeInTheDocument();
      expect(btn).toBeDisabled();
      return btn!;
    });
    fireEvent.click(edit);
    expect(onEdit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // MUST-NOT-CHANGE — green on both sides of the fix.
  // -------------------------------------------------------------------------
  it('keeps the header Delete on a record its `delete.visibleWhen` admits', async () => {
    await mountHeader(OPEN, INVOICE_USER_ACTIONS);
    expect(await openHeaderOverflow()).toContain('Delete');
  });

  it('keeps the header Edit ENABLED when `edit.disabledWhen` does not hold', async () => {
    const onEdit = vi.fn();
    const dataSource = makeDataSource(INVOICE_USER_ACTIONS);
    render(
      <DetailView schema={schemaFor(OPEN)} dataSource={dataSource} onEdit={onEdit} />,
    );
    await waitFor(() =>
      expect(dataSource.getObjectSchema).toHaveBeenCalledWith('showcase_invoice'),
    );
    const edit = headerEditButton()!;
    expect(edit).toBeInTheDocument();
    expect(edit).not.toBeDisabled();
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalled();
  });

  it('leaves an object with NO `userActions` completely ungated', async () => {
    await mountHeader(PAID, undefined);
    // Asserted BEFORE the overflow opens: Radix `aria-hidden`s the rest of the
    // page while a menu is open, so a role query would find nothing and the
    // "not disabled" assertion would pass on a null instead of on the button.
    expect(headerEditButton()).not.toBeDisabled();
    expect(await openHeaderOverflow()).toContain('Delete');
  });

  /**
   * The BOOLEAN form stays the HOST's channel. `userActionPredicates(false)`
   * is `undefined` — no predicate — exactly as on the row kebab, so the header
   * reads `schema.showDelete` and nothing else. The producer that lowers
   * `delete: false` into `showDelete: false` is what hides it (both halves
   * asserted below), and this fix must not grow a SECOND definition of the
   * boolean form on this surface.
   */
  it('leaves the boolean form to the host: `delete: false` yields no predicate…', async () => {
    await mountHeader(PAID, { delete: false });
    expect(await openHeaderOverflow()).toContain('Delete');
  });

  it('…and the host lowering it to `showDelete: false` still hides Delete', async () => {
    await mountHeader(PAID, { delete: false }, { showDelete: false });
    expect(await openHeaderOverflow()).not.toContain('Delete');
  });

  it('keeps Delete hidden when the permission gate says no, predicate or not', async () => {
    // `objectAllowsDelete` is false (the role grants `read` only) while the
    // predicate HOLDS — the fourth conjunct must not resurrect the button.
    await mountHeader(OPEN, INVOICE_USER_ACTIONS, {}, (ui) => (
      <PermissionProvider roles={roles} permissions={[READ_ONLY]} userRoles={['reader']}>
        {ui}
      </PermissionProvider>
    ));
    expect(await openHeaderOverflow()).not.toContain('Delete');
  });

  it('leaves non-CRUD header chrome untouched on an excluded record', async () => {
    await mountHeader(PAID, INVOICE_USER_ACTIONS);
    expect(await openHeaderOverflow()).toContain('Share');
  });

  it('accepts the canonical `{ dialect, source }` envelope', async () => {
    await mountHeader(PAID, {
      delete: { visibleWhen: { dialect: 'cel', source: "record.status != 'paid'" } },
    });
    expect(await openHeaderOverflow()).not.toContain('Delete');
  });

  /**
   * `visibleWhen: false` is a DECLARED gate that excludes every record — the
   * `!= null` rule, not truthiness (the invariant objectui#3492 established
   * and `isBuiltinRowActionVisible` restates).
   */
  it('treats a literal `visibleWhen: false` as declared, not ungated', async () => {
    await mountHeader(OPEN, { delete: { visibleWhen: false } });
    expect(await openHeaderOverflow()).not.toContain('Delete');
  });
});
