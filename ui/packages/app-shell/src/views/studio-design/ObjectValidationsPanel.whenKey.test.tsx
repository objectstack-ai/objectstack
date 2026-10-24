/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `whenKeyPin` — the Validations panel emits metadata the SPEC accepts.
 *
 * The panel's own docblock promises its skeletons "never 422". That was a claim
 * about a foreign schema with no instrument behind it, and it was false for the
 * whole life of the `conditional` type: the skeleton and the shared CEL editor
 * both spelled that rule's guard `condition`, which `ConditionalValidationSchema`
 * refuses BY NAME in favour of `when` (objectui#9802).
 *
 * ⇒ this pin does not assert source text or restate the panel's own spelling —
 * that is how the defect survived, since every existing assertion matched the
 * producer's output against the producer's own idea of the key. It takes what
 * the panel actually emits through `onPatch` and runs it through the spec's own
 * `ValidationRuleSchema` and `ObjectSchema` — the same parse the object-draft
 * save applies. A skeleton that would 422 fails here.
 *
 * The guard's key is per rule type and BOTH spellings are live: `script` and
 * `cross_field` carry `condition`, `conditional` carries `when`, and each shape
 * refuses the other's key. A blanket rename in either direction re-breaks the
 * other type, so the type-switch carry is pinned in both directions too.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { ValidationRuleSchema, ObjectSchema } from '@objectstack/spec/data';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';

afterEach(() => cleanup());

/** Menu labels, verbatim from the `engine.studio.rules.type*` English pack. */
const MENU: ReadonlyArray<[type: string, label: string]> = [
  ['script', 'Script — CEL fail condition'],
  ['cross_field', 'Cross-field — CEL over multiple fields'],
  ['state_machine', 'State machine — allowed transitions'],
  ['format', 'Format — regex / built-in format'],
  ['json_schema', 'JSON schema — validate a JSON field'],
  ['conditional', 'Conditional — apply a rule when a guard holds'],
];

const baseDraft = {
  name: 'invoice',
  label: 'Invoice',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
  },
  validations: [
    { type: 'script', name: 'no_negative', message: 'no', condition: 'record.amount < 0', severity: 'error' },
  ],
};

/** Readable failure text: the spec's own issues, not a bare `false`. */
// Structurally typed, not `ZodSafeParseResult`: the two schemas parse to different
// shapes, and this only ever reads an issue's diagnostic fields.
function issuesOf(result: { success: boolean; error?: { issues: readonly unknown[] } }): string {
  if (result.success) return '(accepted)';
  return (result.error?.issues ?? [])
    .map((raw) => {
      const i = raw as { code?: unknown; path?: unknown; keys?: unknown; message?: unknown };
      return `${String(i.code)}@${JSON.stringify(i.path)}${i.keys ? ' keys=' + JSON.stringify(i.keys) : ''}: ${String(i.message)}`;
    })
    .join(' | ');
}

/** Run a rule through BOTH the union and the whole-object draft-save parse. */
function expectSpecAccepts(rule: unknown, what: string) {
  const asRule = ValidationRuleSchema.safeParse(rule);
  expect(`${what} :: ValidationRuleSchema :: ${issuesOf(asRule)}`).toBe(`${what} :: ValidationRuleSchema :: (accepted)`);
  const asDraft = ObjectSchema.safeParse({ ...baseDraft, validations: [rule] });
  expect(`${what} :: ObjectSchema :: ${issuesOf(asDraft)}`).toBe(`${what} :: ObjectSchema :: (accepted)`);
}

/** The types whose new rule waits for its guard before it is written (objectui#11820). */
const GUARDED = new Set(['script', 'cross_field', 'conditional']);
const GUARD = 'has(record.amount) && record.amount < 0';
const THEN_GUARD = 'has(record.amount) && record.amount > 1000';

/** Switch the open rule's guard editor to raw CEL and type `cel` into it. */
function typeGuard(cel: string) {
  fireEvent.click(screen.getByRole('button', { name: /Expression/ }));
  const box = screen.getAllByRole('combobox').find((el) => el.tagName === 'TEXTAREA') as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: cel } });
}

/** Pick `label` in the open rule's Type picker, the shared `Select` (objectui#11865). */
async function pickType(label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId('rule-type'), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

/**
 * Add `label` from the New menu and return the rule the panel WROTE to the
 * draft. A guarded type is written only once the author gives it its guard —
 * and a conditional, its `then` rule's too — so those are filled in first.
 */
function addFromMenu(label: string): Record<string, unknown> {
  const onPatch = vi.fn();
  render(<ObjectValidationsPanel draft={baseDraft} onPatch={onPatch} />);
  fireEvent.click(screen.getByText('New'));
  // The per-type list sits under Advanced since objectui#11861.
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
  const type = MENU.find(([, l]) => l === label)?.[0] ?? '';
  if (GUARDED.has(type)) {
    expect(onPatch).not.toHaveBeenCalled();
    typeGuard(GUARD);
    if (type === 'conditional') {
      expect(onPatch).not.toHaveBeenCalled();
      const then = screen.getByLabelText('Then — rule applied when the condition holds (JSON)');
      const seeded = JSON.parse((then as HTMLTextAreaElement).value) as Record<string, unknown>;
      fireEvent.change(then, { target: { value: JSON.stringify({ ...seeded, condition: THEN_GUARD }) } });
      fireEvent.blur(then);
    }
  }
  expect(onPatch).toHaveBeenCalledTimes(1);
  const patch = onPatch.mock.calls[0][0];
  return patch.validations[patch.validations.length - 1];
}

describe('whenKeyPin — ObjectValidationsPanel emits spec-parseable metadata', () => {
  // The class, not just the instance: every type the New menu offers.
  it.each(MENU)('the %s rule the New menu writes parses through the spec the draft save uses', (type, label) => {
    const added = addFromMenu(label);
    expect(added.type).toBe(type);
    expectSpecAccepts(added, `${type} skeleton`);
  });

  it('writes the conditional guard under `when` — the key the spec accepts', () => {
    const added = addFromMenu('Conditional — apply a rule when a guard holds');
    expect(added.when).toBe(GUARD);
    expect(added).not.toHaveProperty('condition');
    // …and the nested `then` is a `script` rule, so ITS guard stays `condition`.
    expect(added.then).toMatchObject({ type: 'script', condition: THEN_GUARD });
  });

  it('the spec refuses the key this panel used to write — so the pin above has teeth', () => {
    const added = addFromMenu('Conditional — apply a rule when a guard holds');
    // Exactly the shape the panel emitted before objectui#9802, rebuilt here by
    // moving the guard back to the old key. Same parser, one key changed.
    const { when, ...rest } = added as { when?: unknown };
    const oldShape = { ...rest, condition: when };
    const refused = ValidationRuleSchema.safeParse(oldShape);
    expect(refused.success).toBe(false);
    expect(issuesOf(refused)).toMatch(/unrecognized_keys.*condition/);
  });

  it('reads a saved conditional rule\'s guard from `when`', () => {
    const guard = 'has(record.amount) && record.amount > 100';
    const draft = {
      ...baseDraft,
      validations: [
        {
          type: 'conditional',
          name: 'big_invoice',
          message: 'too big',
          severity: 'error',
          when: guard,
          then: { type: 'script', name: 'big_invoice_then', message: '', condition: 'false', severity: 'error' },
        },
      ],
    };
    render(<ObjectValidationsPanel draft={draft} onPatch={() => {}} />);
    // Read through the WRONG key and this renders empty — the editor showed a
    // blank guard for every conditional rule a spec-valid producer had written.
    expect(screen.getByDisplayValue(guard)).toBeInTheDocument();
  });

  it('writes an edited conditional guard back to `when`, and the result still parses', () => {
    const guard = 'has(record.amount) && record.amount > 100';
    const next = 'has(record.amount) && record.amount > 500';
    const rule = {
      type: 'conditional',
      name: 'big_invoice',
      message: 'too big',
      severity: 'error',
      when: guard,
      then: { type: 'script', name: 'big_invoice_then', message: '', condition: 'false', severity: 'error' },
    };
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={{ ...baseDraft, validations: [rule] }} onPatch={onPatch} />);
    fireEvent.change(screen.getByDisplayValue(guard), { target: { value: next } });
    const patch = onPatch.mock.calls[onPatch.mock.calls.length - 1][0];
    const written = patch.validations[0];
    expect(written.when).toBe(next);
    expect(written).not.toHaveProperty('condition');
    expectSpecAccepts(written, 'edited conditional');
  });

  it('writes an edited SCRIPT guard back to `condition` — the symmetric half', () => {
    // The same shared editor serves `script`. Pinning only the conditional side
    // would leave a blanket rename to `when` looking like a valid repair.
    // A guard the row builder cannot represent, so the raw CEL editor is the
    // mounted mode — a row-shaped predicate renders the builder and no textarea.
    const guard = 'has(record.amount) && record.amount < 0';
    const next = 'has(record.amount) && record.amount < -1';
    const onPatch = vi.fn();
    const scriptDraft = {
      ...baseDraft,
      validations: [{ type: 'script', name: 'no_negative', message: 'no', condition: guard, severity: 'error' }],
    };
    render(<ObjectValidationsPanel draft={scriptDraft} onPatch={onPatch} />);
    fireEvent.change(screen.getByDisplayValue(guard), { target: { value: next } });
    const patch = onPatch.mock.calls[onPatch.mock.calls.length - 1][0];
    const written = patch.validations[0];
    expect(written.condition).toBe(next);
    expect(written).not.toHaveProperty('when');
    expectSpecAccepts(written, 'edited script');
  });

  it('carries the guard across a type switch in each side\'s own spelling', async () => {
    // script (`condition`) → conditional (`when`)
    const onPatch = vi.fn();
    render(<ObjectValidationsPanel draft={baseDraft} onPatch={onPatch} />);
    expect(screen.getByTestId('rule-type')).toHaveTextContent('Script — CEL fail condition');
    await pickType('Conditional — apply a rule when a guard holds');
    const toConditional = onPatch.mock.calls[0][0].validations[0];
    expect(toConditional.when).toBe('record.amount < 0');
    expect(toConditional).not.toHaveProperty('condition');
    expectSpecAccepts(toConditional, 'script → conditional');
    cleanup();

    // conditional (`when`) → script (`condition`) — the same carry, reversed.
    const onPatch2 = vi.fn();
    const conditionalDraft = {
      ...baseDraft,
      validations: [
        {
          type: 'conditional',
          name: 'big_invoice',
          message: 'too big',
          severity: 'error',
          when: 'record.amount > 100',
          then: { type: 'script', name: 'big_invoice_then', message: '', condition: 'false', severity: 'error' },
        },
      ],
    };
    render(<ObjectValidationsPanel draft={conditionalDraft} onPatch={onPatch2} />);
    expect(screen.getByTestId('rule-type')).toHaveTextContent('Conditional — apply a rule when a guard holds');
    await pickType('Script — CEL fail condition');
    const toScript = onPatch2.mock.calls[0][0].validations[0];
    expect(toScript.condition).toBe('record.amount > 100');
    expect(toScript).not.toHaveProperty('when');
    expectSpecAccepts(toScript, 'conditional → script');
  });
});
