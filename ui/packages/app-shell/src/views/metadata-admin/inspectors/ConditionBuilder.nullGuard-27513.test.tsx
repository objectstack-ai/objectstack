// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27513 — the builder's ordering comparison on a field compiles
 * behind a null guard.
 *
 * The defect, as the release walkthrough measured it: on a Validations tab,
 * "Reject the save when… `record.estimated_hours` greater than `40`" on an
 * optional Number field saved as `record.estimated_hours > 40`. CEL has no `>`
 * overload for `null`, so the server refused the rule at publish and held the
 * whole package back. The "Number can't be negative" preset already writes the
 * guarded shape (`record.x != null && record.x < 0`); the builder now writes it
 * too.
 *
 * The verdicts here are read off the CEL the builder EMITS, judged by the
 * server's own null-guard rule (`@objectstack/lint`'s
 * `findUnguardedNullableOperands`, the gate the publish runs) and evaluated by
 * the engine the server evaluates a validation rule with. ⛔ Neither is called
 * from the builder: it decides nothing about nullability and guards every
 * ordering comparison on a catalog field.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpressionEngine } from '@objectstack/formula';
import { findUnguardedNullableOperands } from '@objectstack/lint';

// objectui#4697 — ConditionBuilder calls useObjectFields(objectName)
// unconditionally even when `fields` is supplied; keep that fetch off the network.
const state = vi.hoisted(() => ({
  metadataClient: {
    get: vi.fn(async (): Promise<unknown> => undefined),
    list: vi.fn(async () => [] as unknown[]),
    withPreviewDrafts() { return this; },
  },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ConditionBuilder, RECORD_CONDITION_SUBJECTS } from './ConditionBuilder';

afterEach(cleanup);

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

/** The card's Work Order: an optional Number and a Picklist. */
const FIELDS = [
  { name: 'estimated_hours', label: 'Estimated Hours', type: 'number' },
  { name: 'status', label: 'Status', type: 'select' },
];
/** What the server's index calls nullable on that object: neither is required or defaulted. */
const NULLABLE = { nullableFields: new Set(['estimated_hours', 'status']) };

const GUARDED = 'record.estimated_hours != null && record.estimated_hours > 40';
const UNGUARDED = 'record.estimated_hours > 40';

/** Evaluate `source` exactly as objectql's validation-rule evaluator does. */
function evaluate(source: string, record: Record<string, unknown>) {
  const res = ExpressionEngine.evaluate<boolean>({ dialect: 'cel', source }, { record, previous: undefined });
  return res.ok ? { ok: true, value: res.value } : { ok: false };
}

/** The Validations tab's mount: record scope, the server host's subjects. */
function Harness({ initial }: { initial: string }) {
  const [v, setV] = React.useState(initial);
  return (
    <div>
      <ConditionBuilder
        value={v}
        onCommit={setV}
        fields={FIELDS}
        scope="record"
        subjects={{ context: RECORD_CONDITION_SUBJECTS }}
      />
      <pre data-testid="committed">{v}</pre>
    </div>
  );
}

const committed = () => screen.getByTestId('committed').textContent ?? '';
const comboboxes = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="combobox"]')) as HTMLElement[];
/** The raw editor's textarea, present only when the builder fell back to it. */
const rawEditor = (c: HTMLElement) => c.querySelector('textarea');

async function pick(trigger: HTMLElement, option: string) {
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('an ordering comparison on a field compiles behind a null guard (objectstack#27513)', () => {
  it('the card flow — Add condition, the optional number, greater than, 40 — writes the guarded shape', async () => {
    const { container } = render(<Harness initial="" />);
    fireEvent.click(screen.getByRole('button', { name: /Add condition/ }));
    await pick(comboboxes(container)[0], 'record.estimated_hours');
    await pick(comboboxes(container)[1], 'greater than');
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: '40' } });

    expect(committed()).toBe(GUARDED);
    // The server's null-guard gate accepts it, and the engine evaluates it on
    // a row with no hours instead of faulting.
    expect(findUnguardedNullableOperands(committed(), NULLABLE)).toEqual([]);
    expect(evaluate(committed(), { estimated_hours: null, status: 'new' })).toEqual({ ok: true, value: false });
    expect(evaluate(committed(), { estimated_hours: 41, status: 'new' })).toEqual({ ok: true, value: true });
    expect(evaluate(committed(), { estimated_hours: 40, status: 'new' })).toEqual({ ok: true, value: false });
  });

  it('INSTRUMENT CONTROL — the emission this replaces is refused by the same gate and faults in the same engine', () => {
    expect(findUnguardedNullableOperands(UNGUARDED, NULLABLE)).toMatchObject([
      { operand: 'record.estimated_hours', operator: '>' },
    ]);
    expect(evaluate(UNGUARDED, { estimated_hours: null, status: 'new' })).toEqual({ ok: false });
  });

  it('the guarded text reopens as the one row it compiles from', () => {
    const { container } = render(<Harness initial={GUARDED} />);
    expect(rawEditor(container)).toBeNull();
    expect((screen.getByPlaceholderText('value') as HTMLInputElement).value).toBe('40');
    expect(screen.getAllByPlaceholderText('value')).toHaveLength(1);
    expect(committed()).toBe(GUARDED);
  });

  it('beside another row the guarded row is parenthesised, and the OR join round-trips', async () => {
    const { container } = render(<Harness initial="record.status == 'new' || record.estimated_hours == 40" />);
    await pick(comboboxes(container).at(-1)!, 'greater than');
    const cel = committed();
    expect(cel).toBe(`record.status == 'new' || (${GUARDED})`);
    expect(findUnguardedNullableOperands(cel, NULLABLE)).toEqual([]);

    cleanup();
    const again = render(<Harness initial={cel} />);
    expect(rawEditor(again.container)).toBeNull();
    expect(screen.getAllByPlaceholderText('value')).toHaveLength(2);
  });

  it('a stored comparison written without the guard keeps its spelling until the author edits that row', () => {
    const { container } = render(<Harness initial={`${UNGUARDED} && record.status == 'new'`} />);
    // Adopted as rows, not rewritten: the builder writes nothing on mount.
    expect(rawEditor(container)).toBeNull();
    expect(committed()).toBe(`${UNGUARDED} && record.status == 'new'`);

    // Editing the other row leaves this one's bytes alone.
    fireEvent.change(screen.getAllByPlaceholderText('value')[1], { target: { value: 'done' } });
    expect(committed()).toBe(`${UNGUARDED} && record.status == 'done'`);

    // Editing this row writes it the way the builder writes.
    fireEvent.change(screen.getAllByPlaceholderText('value')[0], { target: { value: '50' } });
    expect(committed()).toBe(
      "(record.estimated_hours != null && record.estimated_hours > 50) && record.status == 'done'",
    );
  });

  it('equality needs no guard: CEL compares against null without a fault', async () => {
    const { container } = render(<Harness initial="record.estimated_hours > 40" />);
    await pick(comboboxes(container).at(-1)!, 'equals');
    expect(committed()).toBe('record.estimated_hours == 40');
    expect(findUnguardedNullableOperands(committed(), NULLABLE)).toEqual([]);
  });

  it('a subject that names no catalog field is not guarded', async () => {
    const { container } = render(<Harness initial="record.id == 5" />);
    await pick(comboboxes(container).at(-1)!, 'greater than');
    expect(committed()).toBe('record.id > 5');
  });
});
