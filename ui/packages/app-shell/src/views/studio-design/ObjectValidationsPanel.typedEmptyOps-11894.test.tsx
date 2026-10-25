// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio Rules tab hands the condition builder each field's declared type
 * and `multiple` flag, so the benchmark's validation rule compiles to CEL the
 * server can evaluate (objectui#11894).
 *
 * The measured failure: a rule built here as `record.status` *equals* `done`
 * AND `record.due_date` *is false / empty* saved as
 * `record.status == 'done' && !record.due_date`, and every write to a done
 * record was refused (`no such overload: !null` / `!string`). The builder
 * types its value-less operators by the field list it is given, and this panel
 * then gave it names, labels and hidden flags only — so every field here read
 * as undeclared and kept the `!` form. The panel now copies `type` and
 * `multiple`.
 *
 * Each verdict is read off what the panel WRITES through `onPatch` and
 * evaluated with `@objectstack/formula`'s `ExpressionEngine.evaluate`, called
 * with `{ record, previous }` as objectql's `checkPredicate` calls it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpressionEngine } from '@objectstack/formula';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';

afterEach(() => cleanup());

beforeAll(() => {
  // Radix Select probes pointer-capture APIs the test DOM lacks.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
});

/** The benchmark's object, as its draft declares it. */
function draftWith(condition: string) {
  return {
    name: 'repair_ticket',
    label: 'Repair ticket',
    fields: {
      status: { type: 'select', label: 'Status' },
      due_date: { type: 'date', label: 'Due date' },
      urgent: { type: 'boolean', label: 'Urgent' },
      watchers: { type: 'lookup', label: 'Watchers', reference: 'sys_user', multiple: true },
    },
    validations: [
      { type: 'script', name: 'done_needs_due_date', message: 'A done ticket needs a due date', condition, severity: 'error' },
    ],
  };
}

/** Evaluate `source` exactly as objectql's validation-rule evaluator does. */
function evaluate(source: string, record: Record<string, unknown>): { ok: true; value: unknown } | { ok: false; error: string } {
  const res = ExpressionEngine.evaluate<boolean>({ dialect: 'cel', source }, { record, previous: undefined });
  return res.ok ? { ok: true, value: res.value } : { ok: false, error: String(res.error?.message ?? res.error) };
}

/** The condition-builder row whose subject trigger reads `subject`. */
function rowOf(subject: string): HTMLElement {
  const trigger = screen.getAllByRole('combobox').find((el) => el.textContent === subject);
  expect(trigger, `no condition row names ${subject}`).toBeTruthy();
  // The row box, not the trigger: a Select trigger is `rounded-md` itself.
  return trigger!.parentElement!.closest('.space-y-1.rounded-md') as HTMLElement;
}

/** Pick `label` from the operator dropdown of the row naming `subject`. */
async function pickOp(subject: string, label: string) {
  const controls = within(rowOf(subject)).getAllByRole('combobox');
  await userEvent.click(controls[controls.length - 1]);
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

/** The guard the panel last wrote for the one rule. */
function writtenCondition(onPatch: ReturnType<typeof vi.fn>): unknown {
  const patch = onPatch.mock.calls.at(-1)?.[0] as { validations: Array<{ condition?: unknown }> };
  return patch.validations[0].condition;
}

describe('the Rules tab types the condition builder (objectui#11894)', () => {
  it('BUILDING the benchmark rule: "due date is empty" is written as a null check that evaluates both ways', async () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draftWith("record.status == 'done' && record.due_date == 'x'")} onPatch={onPatch} />);
    await pickOp('record.due_date', 'is empty');
    const cel = writtenCondition(onPatch);
    expect(cel).toBe("record.status == 'done' && record.due_date == null");
    expect(evaluate(cel as string, { status: 'done', due_date: null })).toEqual({ ok: true, value: true });
    expect(evaluate(cel as string, { status: 'done', due_date: '2026-10-20' })).toEqual({ ok: true, value: false });
  });

  it('LOADING the rule: the null check reopens as the "is empty" row it was built as', () => {
    render(<ObjectValidationsPanel draft={draftWith("record.status == 'done' && record.due_date == null")} onPatch={vi.fn()} />);
    const controls = within(rowOf('record.due_date')).getAllByRole('combobox');
    expect(controls[controls.length - 1]).toHaveTextContent('is empty');
  });

  it('the rule the old builder stored opens in the raw editor as written, not rewritten', () => {
    const onPatch = vi.fn();
    const stored = "record.status == 'done' && !record.due_date";
    render(<ObjectValidationsPanel draft={draftWith(stored)} onPatch={onPatch} />);
    const raw = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement | undefined;
    expect(raw, 'expected the raw CEL editor').toBeTruthy();
    expect(raw!.value).toBe(stored);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('a lookup declared `multiple` builds "is empty" as null or an empty list — the flag reaches the builder', async () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draftWith("record.status == 'done' && record.watchers == 'x'")} onPatch={onPatch} />);
    await pickOp('record.watchers', 'is empty');
    const cel = writtenCondition(onPatch) as string;
    expect(cel).toBe("record.status == 'done' && (record.watchers == null || size(record.watchers) == 0)");
    expect(evaluate(cel, { status: 'done', watchers: [] })).toEqual({ ok: true, value: true });
    expect(evaluate(cel, { status: 'done', watchers: null })).toEqual({ ok: true, value: true });
    expect(evaluate(cel, { status: 'done', watchers: ['u1'] })).toEqual({ ok: true, value: false });
  });

  it('CONTROL — a boolean field on the same draft still compiles to the bare field and its negation', async () => {
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={draftWith("record.status == 'done' && record.urgent == 'x'")} onPatch={onPatch} />);
    await pickOp('record.urgent', 'is false');
    expect(writtenCondition(onPatch)).toBe("record.status == 'done' && !record.urgent");
    expect(evaluate(writtenCondition(onPatch) as string, { status: 'done', urgent: false })).toEqual({ ok: true, value: true });
    await pickOp('record.urgent', 'is true');
    expect(writtenCondition(onPatch)).toBe("record.status == 'done' && record.urgent");
  });
});
