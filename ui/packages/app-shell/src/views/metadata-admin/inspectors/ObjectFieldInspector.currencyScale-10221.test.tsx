// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10221 — the field designer does not offer a `Scale` control on a
 * `currency` field.
 *
 * `scale` is retired from the currency type (ruling B on
 * objectstack-ai/objectstack#19629), and a currency's decimal places are the
 * currency's ISO 4217 minor unit, not a setting (ruling 乙 on
 * objectstack-ai/objectstack#19910). The numeric section used to render the
 * same four controls for `number`, `currency` and `percent`, so the designer
 * offered a decimal-places knob on money that no display face honours.
 *
 * Pinned in both directions, because a missing control and a section that
 * failed to render look the same from the outside:
 *   - currency: no `Scale`, while `Precision`, `Min` and `Max` still render;
 *   - number and percent: `Scale` is still offered (the control — the
 *     retirement is currency-only).
 *
 * The last case pins the premise the card asked to be measured, not guessed:
 * the `Precision` control beside it writes the FIELD-LEVEL `precision` (the
 * spec's total digit count of the stored decimal) as a top-level key, and
 * never `currencyConfig.precision`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

function renderField(def: Record<string, unknown>) {
  const onPatch = vi.fn();
  render(
    <ObjectFieldInspector
      type="object"
      name="probe_widget"
      draft={{ name: 'probe_widget', fields: { amount: def } }}
      selection={{ kind: 'field', id: 'amount' }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={'en-US'}
    />,
  );
  /** The field definition the host's Save would persist after the last edit. */
  const saved = () =>
    (onPatch.mock.calls.at(-1)![0].fields as Record<string, Record<string, unknown>>).amount;
  return { onPatch, saved };
}

describe('ObjectFieldInspector · no `Scale` control on a currency field (objectui#10221)', () => {
  it('renders no Scale control on a currency field, and the rest of the numeric section', () => {
    renderField({ type: 'currency', label: 'Amount' });

    expect(screen.queryByLabelText('Scale')).toBeNull();
    // Falsification: the numeric section itself rendered — this is a targeted
    // withdrawal, not a section that failed to appear.
    expect(screen.getByLabelText('Precision')).toBeInTheDocument();
    expect(screen.getByLabelText('Min')).toBeInTheDocument();
    expect(screen.getByLabelText('Max')).toBeInTheDocument();
  });

  it('renders no Scale control even when the stored currency field still carries `scale`', () => {
    // A stored value must not resurrect the control that wrote it.
    renderField({ type: 'currency', label: 'Amount', scale: 2 });
    expect(screen.queryByLabelText('Scale')).toBeNull();
  });

  it.each(['number', 'percent'])('still offers Scale on a %s field (control)', (type) => {
    renderField({ type, label: 'Amount' });
    expect(screen.getByLabelText('Scale')).toBeInTheDocument();
    expect(screen.getByLabelText('Precision')).toBeInTheDocument();
  });

  it('the Precision control on a currency field writes the field-level `precision`, not `currencyConfig.precision`', () => {
    const { saved } = renderField({ type: 'currency', label: 'Amount' });

    fireEvent.change(screen.getByLabelText('Precision'), { target: { value: '18' } });

    const def = saved();
    expect(def.precision).toBe(18);
    expect('currencyConfig' in def).toBe(false);
  });
});
