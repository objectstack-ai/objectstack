/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11923 — the "Runs on" row reads the spec's `events` contract.
 *
 * The row offered Create, Update and Delete from a local list, and showed a
 * rule with no `events` key as running on nothing. The spec's `events` (in
 * `BASE_VALIDATION_SHAPE`) admits only `insert` and `update` and defaults an
 * absent key to both, and the server runs such a rule on both. Pinned here:
 *
 *   - the row offers exactly the spec's events, read off the spec here too, and
 *     every rule type's schema agrees on them;
 *   - an absent key shows as the spec's default, both boxes checked;
 *   - a tick or an untick writes the full resulting list, and what the row
 *     writes parses through the spec's own `ObjectSchema`, the parse the draft
 *     save applies;
 *   - a stored `delete` (written before this fix) does not crash the panel, is
 *     kept by an unrelated edit, and is left out by the row's next write, which
 *     then parses;
 *   - a new rule starts on the spec's default (objectui#11820).
 *
 * The harness feeds every `onPatch` back into `draft`, as the Data pillar does,
 * so what the row shows after a write is what the pillar would show.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import {
  ObjectSchema,
  ValidationRuleSchema,
  ScriptValidationSchema,
  CrossFieldValidationSchema,
  StateMachineValidationSchema,
  FormatValidationSchema,
  JSONValidationSchema,
  ConditionalValidationSchema,
} from '@objectstack/spec/data';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';
import { t } from '../metadata-admin/i18n';

afterEach(() => cleanup());

const EN = 'en-US';

/** Every rule type's schema: each spreads `BASE_VALIDATION_SHAPE`, `events` included. */
const RULE_SCHEMAS = {
  script: ScriptValidationSchema,
  cross_field: CrossFieldValidationSchema,
  state_machine: StateMachineValidationSchema,
  format: FormatValidationSchema,
  json_schema: JSONValidationSchema,
  conditional: ConditionalValidationSchema,
};

/** The spec's events, as the row must offer them, in the spec's order. */
const SPEC_EVENTS: readonly string[] = ScriptValidationSchema.shape.events.unwrap().element.options;

const RULE = { type: 'script', name: 'no_negative', message: 'no', condition: 'record.amount < 0', severity: 'error' };

/** What the spec makes of a rule that names no events. */
const SPEC_DEFAULT: readonly string[] = ValidationRuleSchema.parse(RULE).events as string[];

const label = (ev: string) => t(`engine.studio.rules.event.${ev}`, EN);

function draftWith(rule: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'invoice',
    label: 'Invoice',
    fields: {
      name: { type: 'text', label: 'Name' },
      amount: { type: 'number', label: 'Amount' },
    },
    validations: [rule],
  };
}

function Harness({ onPatch, initial }: { onPatch: (p: Record<string, unknown>) => void; initial: Record<string, unknown> }) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <ObjectValidationsPanel
      draft={draft}
      onPatch={(p) => {
        onPatch(p);
        setDraft((d) => ({ ...d, ...p }));
      }}
    />
  );
}

/** The checkboxes of the "Runs on" row, and nothing else on the page. */
function runsOnBoxes(): HTMLInputElement[] {
  const row = screen.getByText('Runs on').parentElement as HTMLElement;
  return within(row).getAllByRole('checkbox') as HTMLInputElement[];
}

function box(ev: string): HTMLInputElement {
  return within(screen.getByText('Runs on').parentElement as HTMLElement).getByRole('checkbox', {
    name: label(ev),
  }) as HTMLInputElement;
}

function lastRule(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const calls = onPatch.mock.calls;
  const validations = calls[calls.length - 1][0].validations as Array<Record<string, unknown>>;
  return validations[validations.length - 1];
}

/** The draft the pillar would save, with `rule` written, parses through the spec's `ObjectSchema`. */
function expectSaveParses(rule: Record<string, unknown>) {
  const parsed = ObjectSchema.safeParse(draftWith(rule));
  expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  return parsed;
}

function renderRule(rule: Record<string, unknown>) {
  const onPatch = vi.fn();
  render(<Harness onPatch={onPatch} initial={draftWith(rule)} />);
  return onPatch;
}

describe('the "Runs on" row reads the spec\'s events contract (objectui#11923)', () => {
  it('every rule type carries the same events contract, so reading it off one type is reading it off all', () => {
    for (const [type, schema] of Object.entries(RULE_SCHEMAS)) {
      const events = schema.shape.events;
      expect(events.unwrap().element.options, type).toEqual(SPEC_EVENTS);
      expect(events.parse(undefined), type).toEqual(SPEC_DEFAULT);
    }
  });

  it('offers exactly the spec\'s events, and no Delete', () => {
    renderRule({ ...RULE, events: ['insert'] });
    expect(runsOnBoxes().map((b) => b.closest('label')?.textContent)).toEqual(SPEC_EVENTS.map(label));
    expect(screen.queryByRole('checkbox', { name: 'Delete' })).toBeNull();
  });

  it('shows a rule with no events key as the spec\'s default: both boxes checked', () => {
    renderRule(RULE);
    expect(SPEC_DEFAULT).toEqual(SPEC_EVENTS);
    for (const ev of SPEC_EVENTS) expect(box(ev)).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Create' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Update' })).toBeChecked();
  });

  it.each([
    ['insert', ['update']],
    ['update', ['insert']],
  ])('one untick of %s from the absent key writes the other event alone, and it parses', (unticked, written) => {
    const onPatch = renderRule(RULE);
    fireEvent.click(box(unticked));
    expect(onPatch).toHaveBeenCalledTimes(1);
    const rule = lastRule(onPatch);
    expect(rule.events).toEqual(written);
    const parsed = expectSaveParses(rule);
    expect(parsed.success && parsed.data.validations?.[0]?.events).toEqual(written);
    // The row now shows what was written, not the default.
    expect(box(unticked)).not.toBeChecked();
    expect(box(written[0])).toBeChecked();
  });

  it('a tick writes the full resulting list, in the spec\'s order', () => {
    const onPatch = renderRule({ ...RULE, events: ['update'] });
    expect(box('insert')).not.toBeChecked();
    fireEvent.click(box('insert'));
    const rule = lastRule(onPatch);
    expect(rule.events).toEqual(SPEC_EVENTS);
    expectSaveParses(rule);
  });

  it('unticking the last box writes [], which the spec accepts, and shows no box checked', () => {
    const onPatch = renderRule({ ...RULE, events: ['insert'] });
    fireEvent.click(box('insert'));
    const rule = lastRule(onPatch);
    expect(rule.events).toEqual([]);
    const parsed = expectSaveParses(rule);
    // `[]` is kept as written, not defaulted: the rule runs on nothing.
    expect(parsed.success && parsed.data.validations?.[0]?.events).toEqual([]);
    for (const ev of SPEC_EVENTS) expect(box(ev)).not.toBeChecked();
  });

  describe('a stored delete, written before this fix', () => {
    const STORED = { ...RULE, events: ['insert', 'delete'] };

    it('control: the spec refuses the stored rule as it is', () => {
      expect(ObjectSchema.safeParse(draftWith(STORED)).success).toBe(false);
    });

    it('renders: the boxes show the events the server runs it on, and there is no Delete box', () => {
      renderRule(STORED);
      expect(box('insert')).toBeChecked();
      expect(box('update')).not.toBeChecked();
      expect(runsOnBoxes()).toHaveLength(SPEC_EVENTS.length);
      expect(screen.queryByRole('checkbox', { name: 'Delete' })).toBeNull();
    });

    it('an unrelated edit keeps it', () => {
      const onPatch = renderRule(STORED);
      fireEvent.change(screen.getByDisplayValue('no'), { target: { value: 'No negatives' } });
      const rule = lastRule(onPatch);
      expect(rule.message).toBe('No negatives');
      expect(rule.events).toEqual(['insert', 'delete']);
    });

    it('the row\'s next write leaves it out, so that write parses', () => {
      const onPatch = renderRule(STORED);
      fireEvent.click(box('update'));
      const rule = lastRule(onPatch);
      expect(rule.events).toEqual(['insert', 'update']);
      expectSaveParses(rule);
    });
  });

  it('a new rule starts on the spec\'s default (objectui#11820)', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={draftWith(RULE)} />);
    fireEvent.click(screen.getByText('New'));
    // The per-type list sits under Advanced since objectui#11861; this pin is
    // about where a new rule starts, not about the menu's layout.
    const advanced = screen.queryByRole('button', { name: 'Advanced' });
    if (advanced) fireEvent.click(advanced);
    // A type with no guard is written at once.
    fireEvent.click(screen.getByRole('button', { name: t('engine.studio.rules.typeFormat', EN) }));
    const rule = lastRule(onPatch);
    expect(rule.type).toBe('format');
    expect(rule.events).toEqual(SPEC_DEFAULT);
    for (const ev of SPEC_EVENTS) expect(box(ev)).toBeChecked();
  });
});
