/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A create form does not apply `readonlyWhen` (objectui#13436).
 *
 * objectql exempts INSERT from `readonlyWhen` entirely, but the renderer used
 * to evaluate it on a create form against the seeded defaults. Two shapes
 * locked fields the server accepts on insert:
 *
 *   - a predicate over a column with a default:
 *     `record.status == 'pending_verify' || record.status == 'active'` with
 *     `status` defaulted to `'pending_verify'`;
 *   - a `!=` predicate over an unset column:
 *     `record.approval_status != 'returned'` (`null != 'returned'` is TRUE).
 *
 * A create form is the one the host hands no `previousValues` (the same
 * `isCreateForm` signal the read-only submit strip gates on). An edit form
 * (with `previousValues`) keeps applying the rule, and static `readonly: true`
 * still locks on create.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) so the cold transform is billed to the
// import phase — objectui#3010 / object-ui/no-dynamic-import-in-test-hook.
import '../../../renderers';

function renderForm(schema: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={{ type: 'form', showSubmit: false, showCancel: false, ...schema }} />);
}

const LOCKED_ON_STATUS = "record.status == 'pending_verify' || record.status == 'active'";
const LOCKED_UNLESS_RETURNED = "record.approval_status != 'returned'";

const defaultedFields = [
  { name: 'status', label: 'Status', type: 'input', readonly: true },
  { name: 'bank_name', label: 'Bank name', type: 'input', required: true, readonlyWhen: LOCKED_ON_STATUS },
  { name: 'account_no', label: 'Account no', type: 'input', required: true, readonlyWhen: LOCKED_ON_STATUS },
];

const unsetFields = [
  { name: 'approval_status', label: 'Approval status', type: 'input' },
  { name: 'title', label: 'Title', type: 'input', readonlyWhen: LOCKED_UNLESS_RETURNED },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('form renderer — readonlyWhen on a create form (objectui#13436)', () => {
  it('leaves a field editable on create when the predicate is TRUE against a seeded default', () => {
    renderForm({ fields: defaultedFields, defaultValues: { status: 'pending_verify' } });

    expect(screen.getByLabelText(/^Bank name/)).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText(/^Account no/)).not.toHaveAttribute('readonly');
  });

  it('still locks a static `readonly: true` field on create', () => {
    renderForm({ fields: defaultedFields, defaultValues: { status: 'pending_verify' } });

    expect(screen.getByLabelText(/^Status/)).toHaveAttribute('readonly');
  });

  it('leaves a field editable on create when a `!=` predicate is TRUE over an unset column', () => {
    renderForm({ fields: unsetFields });

    expect(screen.getByLabelText(/^Title/)).not.toHaveAttribute('readonly');
  });

  it('keeps locking on an edit form: the defaulted-column predicate', () => {
    renderForm({
      fields: defaultedFields,
      defaultValues: { status: 'pending_verify', bank_name: 'B', account_no: '1' },
      previousValues: { status: 'pending_verify', bank_name: 'B', account_no: '1' },
    });

    expect(screen.getByLabelText(/^Bank name/)).toHaveAttribute('readonly');
    expect(screen.getByLabelText(/^Account no/)).toHaveAttribute('readonly');
  });

  it('keeps locking on an edit form: the `!=` predicate over an unset column', () => {
    renderForm({
      fields: unsetFields,
      defaultValues: { title: 'T' },
      previousValues: { title: 'T' },
    });

    expect(screen.getByLabelText(/^Title/)).toHaveAttribute('readonly');
  });

  it('reports no readonlyWhen fault on create, where the rule is not applied; an edit form still does', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const readonlyWhenWarnings = () =>
      warn.mock.calls.filter((args) => String(args[0]).includes('readonlyWhen of field'));

    // Unique sources: `warnPredicateFailure` dedupes per source module-wide.
    renderForm({
      fields: [{ name: 'memo', label: 'Memo', type: 'input', visibleWhen: 'true', readonlyWhen: 'record.memo_13436_create ==' }],
    });
    expect(readonlyWhenWarnings()).toHaveLength(0);

    renderForm({
      fields: [{ name: 'memo', label: 'Memo', type: 'input', visibleWhen: 'true', readonlyWhen: 'record.memo_13436_edit ==' }],
      defaultValues: { memo: 'm' },
      previousValues: { memo: 'm' },
    });
    expect(readonlyWhenWarnings().length).toBeGreaterThan(0);
  });
});
