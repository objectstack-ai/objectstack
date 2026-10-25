// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The assignment node's per-value text / expression choice (objectui#7588),
 * rendered through `FlowNodeConfigField`, the editor's only caller, so the
 * pins cover how the editor learns which map it is serving: the node type and
 * field path read against the spec's expression ledger.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  ASSIGNMENT_ARRAY_FORM_PRESCRIPTION,
  ASSIGNMENT_VALUE_ENVELOPE_REFUSAL,
  VALUE_SLOT_TEMPLATE_REFUSAL,
} from '@objectstack/spec/automation';
import { FlowNodeConfigField } from './FlowNodeConfigField';
import type { FlowConfigField } from './flow-node-config';

afterEach(cleanup);

const TOGGLE = 'Write as a CEL expression';

const ASSIGNMENTS: FlowConfigField = {
  id: 'assignments',
  path: ['config', 'assignments'],
  label: 'Assignments',
  kind: 'keyValue',
};

const FIELD_VALUES: FlowConfigField = {
  id: 'fields',
  path: ['config', 'fields'],
  label: 'Field values',
  kind: 'keyValue',
};

function renderField(field: FlowConfigField, nodeType: string, value: unknown) {
  const onCommit = vi.fn();
  render(
    <FlowNodeConfigField
      field={field}
      value={value}
      onCommit={onCommit}
      context={{ draft: {}, node: { id: 'n1', type: nodeType } }}
    />,
  );
  return onCommit;
}

describe('assignment value cell — text or CEL expression (objectui#7588)', () => {
  it('offers the toggle on the assignment map, on the other value-role maps the ledger names, and on no other key/value map', () => {
    renderField(ASSIGNMENTS, 'assignment', {
      label: 'Weekly digest',
      digest: { dialect: 'cel', source: 'joinNonEmpty(names, ", ")' },
    });
    const toggles = screen.getAllByRole('button', { name: TOGGLE });
    expect(toggles.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(screen.getByDisplayValue('joinNonEmpty(names, ", ")')).toBeTruthy();
    // A stdlib call is not refused and not flagged.
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    // `@objectstack/spec` 17.5.0 declares `create_record` / `update_record`
    // `fields.*` as `value`-role slots in its expression ledger, so the same
    // choice reaches those maps (objectui#11073). Through 17.4.0 this row
    // asserted NO toggle on `create_record`'s field values. 18.0.0-next.0 adds
    // `screen` `defaults.*`, `script` `inputs.*` and `subflow` `input.*`
    // (objectui#12030); through 17.x `subflow`'s `input` was this case's control.
    const VALUE_ROLE_MAPS: Array<[string, FlowConfigField]> = [
      ['create_record', FIELD_VALUES],
      ['update_record', FIELD_VALUES],
      ['screen', { id: 'defaults', path: ['config', 'defaults'], label: 'Defaults', kind: 'keyValue' }],
      ['script', { id: 'inputs', path: ['config', 'inputs'], label: 'Inputs', kind: 'keyValue' }],
      ['subflow', { id: 'input', path: ['config', 'input'], label: 'Input mapping', kind: 'keyValue' }],
    ];
    for (const [nodeType, field] of VALUE_ROLE_MAPS) {
      renderField(field, nodeType, { name: 'Acme', total: { dialect: 'cel', source: 'a + b' } });
      expect(
        screen.getAllByRole('button', { name: TOGGLE }).map((b) => b.getAttribute('aria-pressed')),
        `${nodeType}: one toggle per value, the envelope pressed`,
      ).toEqual(['false', 'true']);
      expect(screen.getByDisplayValue('a + b')).toBeTruthy();
      cleanup();
    }

    // Control: a key/value map the ledger gives no `value` role keeps plain
    // text cells — an object naming a `dialect` there is just data.
    renderField({ id: 'headers', path: ['config', 'headers'], label: 'Headers', kind: 'keyValue' }, 'http', {
      name: '{record.name}',
    });
    expect(screen.queryAllByRole('button', { name: TOGGLE })).toHaveLength(0);
  });

  it('commits a `{token}` string unchanged on blur, and shows the spec refusal of it', () => {
    const onCommit = renderField(ASSIGNMENTS, 'assignment', { label: '{record.first} {record.last}' });
    fireEvent.blur(screen.getByDisplayValue('{record.first} {record.last}'));
    expect(onCommit).toHaveBeenLastCalledWith({ label: '{record.first} {record.last}' });
    // `@objectstack/spec` 18 (ADR-0032 §3) reads a value-slot string as the
    // literal it spells and refuses a `{…}` token in it; the cell shows that
    // sentence, as it shows any other refusal (objectui#12030). Through 17.x a
    // `{token}` string drew no alert here.
    expect(screen.getByRole('alert').textContent).toContain(VALUE_SLOT_TEMPLATE_REFUSAL);
  });

  it('stores an expression as a `{ dialect, source }` envelope and leaves the text values alone', () => {
    const onCommit = renderField(ASSIGNMENTS, 'assignment', { total: 'amount * 2', label: '{name}' });
    fireEvent.click(screen.getAllByRole('button', { name: TOGGLE })[0]);
    expect(onCommit).toHaveBeenLastCalledWith({ total: { dialect: 'cel', source: 'amount * 2' }, label: '{name}' });
    expect(screen.getAllByRole('button', { name: TOGGLE })[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the spec refusal inline for a malformed envelope, and for a blank expression', () => {
    renderField(ASSIGNMENTS, 'assignment', { bad: { dialect: 'template', source: 'Hi {name}' } });
    expect(screen.getByRole('alert').textContent).toContain(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);
    cleanup();

    const onCommit = renderField(ASSIGNMENTS, 'assignment', { empty: '' });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: TOGGLE }));
    expect(onCommit).toHaveBeenLastCalledWith({ empty: { dialect: 'cel', source: '' } });
    expect(screen.getByRole('alert').textContent).toContain(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL);
  });

  it('names the legacy array form with the spec prescription, and an expression writes the map', () => {
    const onCommit = renderField(ASSIGNMENTS, 'assignment', [
      { variable: 'label', value: '{name}' },
      { variable: 'total', value: 'amount' },
    ]);
    expect(screen.getByRole('note').textContent).toBe(ASSIGNMENT_ARRAY_FORM_PRESCRIPTION);
    fireEvent.click(screen.getAllByRole('button', { name: TOGGLE })[1]);
    expect(onCommit).toHaveBeenLastCalledWith({ label: '{name}', total: { dialect: 'cel', source: 'amount' } });
  });
});
