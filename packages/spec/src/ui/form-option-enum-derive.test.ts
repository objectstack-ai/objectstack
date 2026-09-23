// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19678 — enum members come from the schema, never hand-listed (ruling
 * 不动 + 声明, 2026-09-23).
 *
 * A form option `value` is a system identifier: `SelectOptionSchema.value`,
 * which `FormSelectOptionSchema` reuses by reference. So an enum member that
 * carries a hyphen or a capital — `object.managedBy`'s `system-data`,
 * `action.openIn`'s `new-tab`, `action.execution`'s `perRecord` — cannot be
 * written as an inline option at all, and `defineForm` throws at module load
 * when an author tries. The ruling keeps that bound and declares the answer:
 * on a metadata form, a row whose key is a spec enum omits `options`, the
 * control derives the members from the served JSON Schema, and the meanings go
 * in `helpText`.
 *
 * What this file pins is where an author meets that rule:
 *
 * 1. **The wall says what to do.** `defineForm`'s refusal of an unspellable
 *    value still carries the grammar message, and now names the derive path as
 *    its remedy. The firing control reads TODAY's message live — the object
 *    face raises the same grammar issue through the same property schema, with
 *    no remedy — and proves the predicate this file asserts with is red on it.
 * 2. **The verdict did not move.** The same values are refused and the same
 *    values accepted as before; only a message grew.
 * 3. **The remedy is scoped.** It rides a grammar refusal of an inline option
 *    `value` and nothing else a form parse can raise.
 * 4. **The describe states the rule** on the served JSON Schema, where the
 *    metadata-admin renderer and an AI author read it.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { SelectOptionSchema } from '../data/field.zod';
import { defineForm, FormFieldSchema, FormSelectOptionSchema } from './view.zod';

type Issue = { code: string; path: PropertyKey[]; message: string; errors?: Issue[][] };

/** Every leaf issue, with the full path (a field row is a union, so its issues nest). */
function leaves(issues: readonly Issue[], at: readonly PropertyKey[] = []): Array<Issue & { fullPath: PropertyKey[] }> {
  return issues.flatMap((issue) => {
    const fullPath = [...at, ...issue.path];
    return issue.code === 'invalid_union' && issue.errors
      ? issue.errors.flatMap((branch) => leaves(branch, fullPath))
      : [{ ...issue, fullPath }];
  });
}

/**
 * The ONE predicate this file judges a message by: does it name the derive
 * path? It asserts the named subjects — omitting `options`, the served JSON
 * Schema the members come from, `helpText` for their meanings — never the
 * sentence around them.
 */
function namesDerivePath(message: string): boolean {
  return /\bomit/i.test(message)
    && message.includes('`options`')
    && message.includes('JSON Schema')
    && message.includes('`helpText`');
}

/** Build a one-row metadata form whose row lists a single inline option. */
function formWithOption(value: string, extra: Record<string, unknown> = {}) {
  return () => defineForm({
    schemaId: 'action',
    type: 'simple',
    sections: [{ label: 'Behavior', fields: [{ field: 'openIn', options: [{ label: 'Option', value, ...extra }] }] }],
  });
}

/** The issue `defineForm` raised at the row's option value, or a loud failure. */
function optionValueIssue(build: () => unknown) {
  let thrown: unknown;
  try {
    build();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, 'expected defineForm to REFUSE at module load').toBeInstanceOf(z.ZodError);
  const hit = leaves((thrown as z.ZodError).issues as unknown as Issue[])
    .find((i) => i.fullPath.join('.') === 'sections.0.fields.0.options.0.value');
  expect(hit, `no issue at the option value in ${String((thrown as Error).message)}`).toBeDefined();
  return hit!;
}

/** Today's message for the same value, read live off the object face — the same property schema. */
function objectFaceMessage(value: string): string {
  const r = SelectOptionSchema.safeParse({ label: 'Option', value });
  expect(r.success).toBe(false);
  const hit = (r.error!.issues as unknown as Issue[]).find((i) => i.path.join('.') === 'value');
  expect(hit, 'the object face raised no issue at `value`').toBeDefined();
  return hit!.message;
}

// The card's own three members, plus the two-character floor.
const UNSPELLABLE = [
  { value: 'new-tab', code: 'invalid_format', why: 'a hyphen (action.openIn)' },
  { value: 'perRecord', code: 'invalid_format', why: 'a capital (action.execution)' },
  { value: 'system-data', code: 'invalid_format', why: 'a hyphen (object.managedBy)' },
  { value: 'x', code: 'too_small', why: 'a single character' },
] as const;

describe('defineForm: the refusal of an unspellable option value names the derive path', () => {
  it.each(UNSPELLABLE)('`$value` ($why) is refused with the remedy', ({ value, code }) => {
    const issue = optionValueIssue(formWithOption(value));
    expect(issue.code).toBe(code);
    expect(namesDerivePath(issue.message), issue.message).toBe(true);
  });

  it.each(UNSPELLABLE)('`$value`: the grammar message is kept, and the remedy follows it', ({ value }) => {
    const today = objectFaceMessage(value);
    const issue = optionValueIssue(formWithOption(value));
    expect(issue.message.startsWith(`${today}. `), issue.message).toBe(true);
  });

  it('firing control — the predicate is RED on today\'s message', () => {
    // The object face raises the grammar issue through the very property schema
    // the form face shares, and carries no remedy: this is the message
    // `defineForm` threw before the ruling was executed.
    for (const { value } of UNSPELLABLE) {
      const today = objectFaceMessage(value);
      expect(namesDerivePath(today), today).toBe(false);
    }
  });

  it('a nested row (composite `fields`) gets the same remedy', () => {
    let thrown: unknown;
    try {
      defineForm({
        schemaId: 'action',
        type: 'simple',
        sections: [{ label: 'Behavior', fields: [{ field: 'outer', fields: [{ field: 'inner', options: [{ label: 'New tab', value: 'new-tab' }] }] }] }],
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(z.ZodError);
    const hit = leaves((thrown as z.ZodError).issues as unknown as Issue[])
      .find((i) => i.fullPath.join('.') === 'sections.0.fields.0.fields.0.options.0.value');
    expect(hit).toBeDefined();
    expect(namesDerivePath(hit!.message), hit!.message).toBe(true);
  });
});

describe('the verdict did not move — the bound stays (ruling item 1)', () => {
  it('the form face refuses exactly what it refused before', () => {
    for (const { value } of UNSPELLABLE) {
      expect(FormSelectOptionSchema.safeParse({ label: 'Option', value }).success, value).toBe(false);
    }
    expect(FormSelectOptionSchema.safeParse({ label: 'New tab', value: 'new_tab' }).success).toBe(true);
  });

  it('a spellable inline option still builds', () => {
    const form = defineForm({
      schemaId: 'action',
      type: 'simple',
      sections: [{ label: 'Behavior', fields: [{ field: 'mode', options: [{ label: 'Custom', value: 'custom' }] }] }],
    });
    expect(form.data).toEqual({ provider: 'schema', schemaId: 'action' });
  });
});

describe('the remedy is scoped to a grammar refusal of an inline option value', () => {
  it('an unknown key on the option is answered without it', () => {
    let thrown: unknown;
    try {
      formWithOption('new_tab', { colour: 'red' })();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(z.ZodError);
    const all = leaves((thrown as z.ZodError).issues as unknown as Issue[]);
    expect(all.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    for (const issue of all) expect(namesDerivePath(issue.message), issue.message).toBe(false);
  });

  it('an unrelated refusal on the same form is answered without it', () => {
    let thrown: unknown;
    try {
      defineForm({ schemaId: 'action', type: 'no_such_layout' as never, sections: [] });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(z.ZodError);
    for (const issue of leaves((thrown as z.ZodError).issues as unknown as Issue[])) {
      expect(namesDerivePath(issue.message), issue.message).toBe(false);
    }
  });
});

describe('the form field\'s `options` describe states the rule (ruling item 2)', () => {
  const served = z.toJSONSchema(FormFieldSchema, { io: 'input', unrepresentable: 'any' }) as {
    properties?: { options?: { description?: string } };
  };
  const text = served.properties?.options?.description ?? '';

  it('names the derive path for a spec-enum row on a metadata form', () => {
    expect(text).toContain('spec enum');
    expect(text).toContain('`defineForm`');
    expect(namesDerivePath(text), text).toBe(true);
  });

  it('keeps the per-option `default` prescription it already carried', () => {
    expect(text).toContain('per-option `default`');
  });
});
