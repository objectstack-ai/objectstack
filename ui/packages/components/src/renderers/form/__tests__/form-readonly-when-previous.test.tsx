/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `readonlyWhen` written against `previous.*` must lock the field in the edit
 * form — objectui#3484.
 *
 * The engine (`@object-ui/core`'s `resolveFieldRuleState`) has always taken a
 * `previous` record; nothing on the PRODUCING side ever passed one. So a
 * predicate like `previous.status != 'draft'` evaluated against a scope with no
 * `previous` root, faulted, and fell back to the fail-open default: the field
 * rendered as an ordinary editable control on a record the author had declared
 * frozen. The user could type into it, submit, and watch the change disappear —
 * the server strips it, and the save reports success.
 *
 * The fix is the missing producer: an edit-mode host hands the renderer the
 * record it already read, as `previousValues`.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) so the cold transform is billed to the
// import phase — objectui#3010 / object-ui/no-dynamic-import-in-test-hook.
import '../../../renderers';

function renderForm(schema: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={{ type: 'form', showSubmit: false, showCancel: false, ...schema }} />);
}

const LOCKED_BY_PREVIOUS = {
  name: 'type',
  label: 'Type',
  type: 'input',
  readonlyWhen: "previous.status != 'draft'",
};

describe('form renderer — readonlyWhen over `previous.*` (#3484)', () => {
  it('locks the field when the host supplies the persisted record', () => {
    renderForm({
      fields: [{ name: 'status', label: 'Status', type: 'input' }, LOCKED_BY_PREVIOUS],
      defaultValues: { status: 'closed', type: 'quality_abnormal' },
      previousValues: { status: 'closed', type: 'quality_abnormal' },
    });

    expect(screen.getByLabelText(/^Type$/)).toHaveAttribute('readonly');
  });

  it('leaves the field editable when the predicate is FALSE for the persisted record', () => {
    renderForm({
      fields: [{ name: 'status', label: 'Status', type: 'input' }, LOCKED_BY_PREVIOUS],
      defaultValues: { status: 'draft', type: 'quality_abnormal' },
      previousValues: { status: 'draft', type: 'quality_abnormal' },
    });

    expect(screen.getByLabelText(/^Type$/)).not.toHaveAttribute('readonly');
  });

  it('is the PRIOR value that decides, not the live edit', () => {
    // The user has already changed `status` to 'draft' in the form. The server
    // evaluates `previous.status` against the row as stored, so the field stays
    // locked for this save; the client must reach the same verdict.
    renderForm({
      fields: [{ name: 'status', label: 'Status', type: 'input' }, LOCKED_BY_PREVIOUS],
      defaultValues: { status: 'draft', type: 'quality_abnormal' },
      previousValues: { status: 'closed', type: 'quality_abnormal' },
    });

    expect(screen.getByLabelText(/^Type$/)).toHaveAttribute('readonly');
  });

  it('stays editable with no previousValues — an INSERT has no prior row', () => {
    // objectql exempts INSERT from the readonlyWhen strip, so a create form
    // must not lock on a `previous.*` predicate either.
    renderForm({
      fields: [{ name: 'status', label: 'Status', type: 'input' }, LOCKED_BY_PREVIOUS],
      defaultValues: { status: 'closed' },
    });

    expect(screen.getByLabelText(/^Type$/)).not.toHaveAttribute('readonly');
  });

  it('binds `previous` for a column the form does not render', () => {
    // `source_method` is on the record but not on the form. Pre-fix the
    // predicate faulted on the missing key and failed open.
    renderForm({
      fields: [LOCKED_BY_PREVIOUS],
      defaultValues: { type: 'quality_abnormal' },
      previousValues: { type: 'quality_abnormal', status: 'closed' },
    });

    expect(screen.getByLabelText(/^Type$/)).toHaveAttribute('readonly');
  });

  it('overlays the persisted record UNDER the live values for `record.*` too', () => {
    // Server scope is `merged = { ...previous, ...data }`, so a `record.*`
    // predicate may name a column this form does not render.
    renderForm({
      fields: [{ name: 'type', label: 'Type', type: 'input', readonlyWhen: "record.status == 'paid'" }],
      defaultValues: { type: 'quality_abnormal' },
      previousValues: { type: 'quality_abnormal', status: 'paid' },
    });

    expect(screen.getByLabelText(/^Type$/)).toHaveAttribute('readonly');
  });
});
