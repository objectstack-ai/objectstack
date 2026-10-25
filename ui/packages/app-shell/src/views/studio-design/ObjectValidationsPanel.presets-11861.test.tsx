/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11861 — the Validations "New" menu opens on a few common rules, in
 * plain words, and keeps the spec's rule types under "Advanced".
 *
 * What is pinned, and against what:
 *
 *   - the menu: the presets first, the per-type list folded under Advanced
 *     and, unfolded, the same six types in the same order as before;
 *   - every preset in the table (the class, not a hand-picked instance) writes
 *     a rule the spec's own `ValidationRuleSchema` and `ObjectSchema` accept —
 *     the parse the object-draft save applies;
 *   - objectui#11820 holds for presets too: a preset that fills its condition
 *     is written at once, on Create + Update; one that leaves the condition
 *     empty is held, not written, and opens with the condition focused;
 *   - a filled condition never faults on an empty field: the server evaluates
 *     a rule fail-CLOSED, so a fault would reject the write. Evaluated through
 *     `@objectstack/formula`, the engine the server uses;
 *   - a preset picks the author's own fields, never a `system` or hidden one,
 *     and is offered disabled, saying what it needs, when there are none.
 *
 * The harness feeds every `onPatch` back into `draft`, as the Data pillar does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { ValidationRuleSchema, ObjectSchema } from '@objectstack/spec/data';
import { celEngine } from '@objectstack/formula';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';
import { VALIDATION_PRESETS, type PresetFieldOpt } from './validationPresets';
import { t } from '../metadata-admin/i18n';

afterEach(() => cleanup());

const EN = 'en-US';

/** An object with two author dates, a money field and two audit timestamps. */
const draft: Record<string, unknown> = {
  name: 'project',
  label: 'Project',
  fields: {
    name: { type: 'text', label: 'Name' },
    created_at: { type: 'datetime', label: 'Created At', system: true },
    updated_at: { type: 'datetime', label: 'Updated At', system: true },
    start_date: { type: 'date', label: 'Start Date' },
    end_date: { type: 'date', label: 'End Date' },
    budget: { type: 'currency', label: 'Budget' },
  },
  validations: [],
};

/**
 * No author date pair and no visible number: one author date, the two audit
 * datetimes (a pair a preset must NOT take for "start" and "end"), and a hidden
 * number.
 */
const bareDraft: Record<string, unknown> = {
  name: 'note',
  label: 'Note',
  fields: {
    name: { type: 'text', label: 'Name' },
    created_at: { type: 'datetime', label: 'Created At', system: true },
    updated_at: { type: 'datetime', label: 'Updated At', system: true },
    due_date: { type: 'date', label: 'Due Date' },
    score: { type: 'number', label: 'Score', hidden: true },
  },
  validations: [],
};

/** The fields as the panel hands them to a preset. */
function fieldsOf(d: Record<string, unknown>): PresetFieldOpt[] {
  return Object.entries(d.fields as Record<string, Record<string, unknown>>).map(([name, def]) => ({
    name,
    label: def.label as string | undefined,
    type: def.type as string | undefined,
    hidden: def.hidden === true,
    system: def.system === true,
  }));
}

function Harness({ onPatch, initial }: { onPatch: (p: Record<string, unknown>) => void; initial: Record<string, unknown> }) {
  const [d, setD] = React.useState(initial);
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

/** The New menu's trigger: the empty block's button while no rule is listed (objectui#12514). */
function openNew() {
  fireEvent.click(screen.queryByTestId('rules-empty-new') ?? screen.getByText('New'));
}

const presetButton = (id: string) => screen.getByTestId(`rule-preset-${id}`);

/** Switch the open rule's guard editor to raw CEL and type `cel` into it. */
function typeGuard(cel: string) {
  fireEvent.click(screen.getByRole('button', { name: /Expression/ }));
  const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: cel } });
}

function lastValidations(onPatch: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  const calls = onPatch.mock.calls;
  return calls[calls.length - 1][0].validations as Array<Record<string, unknown>>;
}

/** Readable failure text: the spec's own issues, not a bare `false`. */
function issuesOf(result: { success: boolean; error?: { issues: readonly unknown[] } }): string {
  if (result.success) return '(accepted)';
  return (result.error?.issues ?? [])
    .map((raw) => {
      const i = raw as { code?: unknown; path?: unknown; message?: unknown };
      return `${String(i.code)}@${JSON.stringify(i.path)}: ${String(i.message)}`;
    })
    .join(' | ');
}

function expectSpecAccepts(rule: unknown, what: string) {
  expect(`${what} :: ${issuesOf(ValidationRuleSchema.safeParse(rule))}`).toBe(`${what} :: (accepted)`);
  expect(`${what} :: ${issuesOf(ObjectSchema.safeParse({ ...draft, validations: [rule] }))}`).toBe(`${what} :: (accepted)`);
}

const GUARD = 'record.budget != null && record.budget > 1000000';

/** The per-type menu, as it read before objectui#11861, in its order. */
const TYPE_LABEL_KEYS = [
  'engine.studio.rules.typeScript',
  'engine.studio.rules.typeCrossField',
  'engine.studio.rules.typeStateMachine',
  'engine.studio.rules.typeFormat',
  'engine.studio.rules.typeJsonSchema',
  'engine.studio.rules.typeConditional',
];

describe('the Validations New menu opens on presets (objectui#11861)', () => {
  it('offers 3–5 presets first, in plain words, and folds the type list under Advanced', () => {
    expect(VALIDATION_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(VALIDATION_PRESETS.length).toBeLessThanOrEqual(5);

    render(<Harness onPatch={vi.fn()} initial={draft} />);
    openNew();
    for (const preset of VALIDATION_PRESETS) {
      expect(screen.getByRole('button', { name: t(preset.labelKey, EN) })).toBeInTheDocument();
    }
    // The type list is not what the menu opens on.
    for (const key of TYPE_LABEL_KEYS) {
      expect(screen.queryByRole('button', { name: t(key, EN) })).toBeNull();
    }

    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    // Unfolded: every type, in the order the menu always had.
    const region = document.getElementById(advanced.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(within(region).getAllByRole('button').map((b) => b.textContent)).toEqual(TYPE_LABEL_KEYS.map((k) => t(k, EN)));
  });

  it('opens folded again on every opening', () => {
    render(<Harness onPatch={vi.fn()} initial={draft} />);
    openNew();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    openNew(); // close
    openNew();
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false');
  });

  // The class: every preset in the table, whichever way its plan goes.
  it.each(VALIDATION_PRESETS.map((p) => [p.id, p] as const))(
    'the %s preset writes a rule the spec accepts, on Create + Update',
    (_id, preset) => {
      const onPatch = vi.fn();
      render(<Harness onPatch={onPatch} initial={draft} />);
      openNew();
      fireEvent.click(presetButton(preset.id));
      if (onPatch.mock.calls.length === 0) {
        // Held (objectui#11820): its condition is the author's to give.
        expect(screen.getByTestId('rule-unsaved')).toBeInTheDocument();
        typeGuard(GUARD);
      }
      expect(onPatch).toHaveBeenCalledTimes(1);
      const written = lastValidations(onPatch)[0];
      expect(written.type).toBe(preset.type);
      expect(written.events).toEqual(['insert', 'update']);
      expectSpecAccepts(written, `${preset.id} preset`);
    },
  );

  it('“End date on or after start date” is written at once, on the author’s two dates, as editable rows', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={draft} />);
    openNew();
    // The row says which fields it will use before it is picked.
    expect(presetButton('end_after_start')).toHaveAccessibleDescription('Uses “Start Date” and “End Date”.');
    fireEvent.click(presetButton('end_after_start'));

    expect(onPatch).toHaveBeenCalledTimes(1);
    const cel = 'record.start_date != null && record.end_date != null && record.end_date < record.start_date';
    expect(lastValidations(onPatch)[0]).toMatchObject({
      type: 'cross_field',
      name: 'validation_1',
      condition: cel,
      // fields[0] is where the server attaches the violation: the end date.
      fields: ['end_date', 'start_date'],
      message: 'End Date must be on or after Start Date.',
    });
    expect(screen.queryByTestId('rule-unsaved')).toBeNull();
    // Opened as builder rows (the compiled line under them), not as raw CEL.
    expect(screen.getByText(cel)).toBeInTheDocument();
    expect(screen.queryAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA')).toBeUndefined();
  });

  it('“Number can’t be negative” is written at once, on the author’s number field', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={draft} />);
    openNew();
    expect(presetButton('not_negative')).toHaveAccessibleDescription('Uses “Budget”.');
    fireEvent.click(presetButton('not_negative'));
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(lastValidations(onPatch)[0]).toMatchObject({
      type: 'script',
      condition: 'record.budget != null && record.budget < 0',
      message: 'Budget can’t be negative.',
    });
    expect(screen.getByText('record.budget != null && record.budget < 0')).toBeInTheDocument();
  });

  it('“Reject the save when…” is held, not written, and opens with the condition focused', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={draft} />);
    openNew();
    fireEvent.click(presetButton('reject_when'));

    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('rule-unsaved')).toHaveTextContent('Not saved — needs a condition');
    expect(screen.getByTestId('rule-held')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Create' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Update' })).toBeChecked();
    const group = screen.getByRole('group', { name: /Fail condition/ });
    await waitFor(() => expect(document.activeElement).toBe(group));

    typeGuard(GUARD);
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(lastValidations(onPatch)[0]).toMatchObject({ type: 'script', condition: GUARD, message: '' });
  });

  it('control — a preset that fills its condition leaves the menu’s own closing focus alone', async () => {
    render(<Harness onPatch={vi.fn()} initial={draft} />);
    openNew();
    fireEvent.click(presetButton('not_negative'));
    // The menu hands focus back to "New", as it always did.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('New')));
    expect(document.activeElement).not.toBe(screen.getByRole('group', { name: /Fail condition/ }));
  });

  it('a preset the object cannot serve is disabled, says what it needs, and never takes a system or hidden field', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={bareDraft} />);
    openNew();
    const dates = presetButton('end_after_start');
    const numbers = presetButton('not_negative');
    // `created_at` + `updated_at` would make a datetime pair, and `score` a
    // number — but those are the platform's and a hidden field.
    expect(dates).toBeDisabled();
    expect(dates).toHaveAccessibleDescription('Needs two date fields on this object.');
    expect(numbers).toBeDisabled();
    expect(numbers).toHaveAccessibleDescription('Needs a number field on this object.');
    fireEvent.click(dates);
    fireEvent.click(numbers);
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.queryByText('validation_1')).toBeNull();
    // The author's own condition needs no field: still offered.
    expect(presetButton('reject_when')).toBeEnabled();
  });
});

/**
 * Sample records per preset whose plan fills a condition. A new filled preset
 * without a row here fails below — its condition has to be shown not to fault.
 */
const SAMPLES: Record<string, { violates: Record<string, unknown>; complies: Record<string, unknown> }> = {
  end_after_start: {
    violates: { start_date: '2026-06-01', end_date: '2026-01-01' },
    complies: { start_date: '2026-01-01', end_date: '2026-01-01' },
  },
  not_negative: { violates: { budget: -0.5 }, complies: { budget: 0 } },
};

describe('a preset’s filled condition is safe on the fail-closed server (objectui#11861)', () => {
  const fields = fieldsOf(draft);
  // The server's `record` scope carries every declared field, null when unset.
  const empty = Object.fromEntries(fields.map((f) => [f.name, null]));
  const cel = (source: string) => ({ dialect: 'cel' as const, source });
  const filled = VALIDATION_PRESETS.flatMap((preset) => {
    const plan = preset.plan(fields, EN);
    return plan.ready && plan.condition ? [[preset.id, plan.condition] as const] : [];
  });

  it('the fixture exercises filled presets at all', () => {
    expect(filled.length).toBeGreaterThan(0);
  });

  it.each(filled)('%s: false on an empty record, true on a violation, false on a compliant one', (id, condition) => {
    const sample = SAMPLES[id];
    expect(sample, `no SAMPLES row for the ${id} preset`).toBeDefined();
    expect(celEngine.evaluate(cel(condition), { record: empty })).toEqual({ ok: true, value: false });
    expect(celEngine.evaluate(cel(condition), { record: { ...empty, ...sample.violates } })).toEqual({ ok: true, value: true });
    expect(celEngine.evaluate(cel(condition), { record: { ...empty, ...sample.complies } })).toEqual({ ok: true, value: false });
  });

  it('control — the unguarded comparison DOES fault on an empty record, so the guard is load-bearing', () => {
    const r = celEngine.evaluate(cel('record.end_date < record.start_date'), { record: empty });
    expect(r.ok).toBe(false);
  });
});
