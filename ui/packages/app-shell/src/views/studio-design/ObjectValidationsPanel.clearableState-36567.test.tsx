/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36567 — a state-machine row can say its state may be cleared.
 *
 * A `state_machine` rule judges a clear of its field (`null` or `''`) as a
 * transition to `''`, allowed only from a state that lists `''` among its
 * targets. The row's "Next states" box holds the named targets; the `''`
 * target is the row's "May be cleared" checkbox, and editing the box keeps it.
 *
 * The harness feeds every `onPatch` back into `draft`, as the Data pillar does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ValidationRuleSchema } from '@objectstack/spec/data';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';
import { t } from '../metadata-admin/i18n';

afterEach(() => cleanup());

const rule = {
  type: 'state_machine',
  name: 'status_flow',
  message: 'Bad move',
  field: 'status',
  transitions: { paused: ['open', ''], open: ['paused'] },
};

const draft: Record<string, unknown> = {
  name: 'ticket',
  label: 'Ticket',
  fields: { status: { type: 'select', label: 'Status' } },
  validations: [rule],
};

function Harness({ onPatch }: { onPatch: (p: Record<string, unknown>) => void }) {
  const [d, setD] = React.useState(draft);
  return (
    <ObjectValidationsPanel
      draft={d}
      onPatch={(p) => {
        onPatch(p);
        setD((prev) => ({ ...prev, ...p }));
      }}
    />
  );
}

function lastTransitions(onPatch: ReturnType<typeof vi.fn>): Record<string, string[]> {
  const calls = onPatch.mock.calls;
  const written = (calls[calls.length - 1][0].validations as Array<Record<string, unknown>>)[0];
  expect(ValidationRuleSchema.safeParse(written).success).toBe(true);
  return written.transitions as Record<string, string[]>;
}

const nextStates = () => screen.getAllByPlaceholderText(t('engine.studio.rules.transitionTo', 'en-US'));
const clearable = () =>
  screen.getAllByRole('checkbox', { name: t('engine.studio.rules.transitionClearable', 'en-US') });

describe('a state-machine row can author and keep the empty-string target (objectstack#36567)', () => {
  it("a rule with paused: ['open', ''] round-trips through a row edit unchanged", () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    // The box shows the named targets only; the '' target is the checkbox.
    expect(nextStates()[0]).toHaveValue('open');
    expect(clearable()[0]).toBeChecked();
    expect(clearable()[1]).not.toBeChecked();

    fireEvent.change(nextStates()[0], { target: { value: 'open, closed' } });
    expect(lastTransitions(onPatch).paused).toEqual(['open', 'closed', '']);

    fireEvent.change(nextStates()[0], { target: { value: 'open' } });
    expect(lastTransitions(onPatch)).toEqual(rule.transitions);
  });

  it('the checkbox adds and removes the empty-string target', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);

    fireEvent.click(clearable()[1]);
    expect(lastTransitions(onPatch).open).toEqual(['paused', '']);

    fireEvent.click(clearable()[0]);
    expect(lastTransitions(onPatch)).toEqual({ paused: ['open'], open: ['paused', ''] });
  });
});
