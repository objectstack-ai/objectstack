// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22227] The deadline semantic on the field definition — the protocol half
 * of objectui#11815's maintainer ruling D (declared-only overdue: no name
 * guessing, the deadline declares when it is settled).
 *
 * - **`dueLike`** declares a `date` / `datetime` field a deadline, so a
 *   renderer may show relative overdue wording and an overdue colour once it
 *   has passed. Absent means not a deadline.
 * - **`settledWhen`** is a per-record CEL predicate in the `visibleWhen`
 *   family; while it holds the deadline is settled and no overdue affordance
 *   applies.
 *
 * Declared = enforced (ADR-0049) at the parse seam, three ways: either key on
 * a type outside `date` / `datetime` is refused, and `settledWhen` without
 * `dueLike: true` is refused. The CEL half of the authoring gate (parse,
 * `record.<field>`, the bound roots) is `@objectstack/lint`'s field-rule pass,
 * pinned in `validate-expressions.test.ts`.
 *
 * The type set is HARDCODED below on purpose (not iterated off the
 * module-local `DEADLINE_FIELD_TYPES`), so these pins are an independent
 * measurement of the set rather than a tautology — the #11949 discipline.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema } from './field.zod';
import { fieldForm } from './field.form';

const DEADLINE_TYPES = ['date', 'datetime'] as const;

// =========================================================================
// 1. The accepted shapes — full parse green, the authored values kept
// =========================================================================

describe('FieldSchema accepts the deadline semantic on date and datetime', () => {
  for (const type of DEADLINE_TYPES) {
    it(`accepts dueLike + settledWhen on type: '${type}', keeping both through parse`, () => {
      const result = FieldSchema.safeParse({
        name: 'due_date', label: 'Due Date', type,
        dueLike: true, settledWhen: "record.status == 'done'",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dueLike).toBe(true);
        // The bare string normalizes to the evaluated envelope, like every
        // sibling in the family.
        expect(result.data.settledWhen).toEqual({ dialect: 'cel', source: "record.status == 'done'" });
      }
    });

    it(`accepts dueLike alone on type: '${type}' — settledWhen is optional`, () => {
      const result = FieldSchema.safeParse({ name: 'due_date', label: 'Due Date', type, dueLike: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dueLike).toBe(true);
        expect('settledWhen' in result.data).toBe(false);
      }
    });
  }

  it('control: a date field with neither key parses unchanged, and no default materializes', () => {
    const result = FieldSchema.safeParse({ name: 'start_date', label: 'Start Date', type: 'date' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('dueLike' in result.data).toBe(false);
      expect('settledWhen' in result.data).toBe(false);
    }
  });

  it('accepts dueLike: false — an explicit "not a deadline" on a date field', () => {
    const result = FieldSchema.safeParse({ name: 'start_date', label: 'Start Date', type: 'date', dueLike: false });
    expect(result.success).toBe(true);
  });
});

// =========================================================================
// 2. The refusals — each at its own path, naming its own subject
// =========================================================================

const issuesAt = (input: Record<string, unknown>, key: string) => {
  const result = FieldSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? [] : result.error.issues.filter((i) => i.path[0] === key);
};

describe('the deadline keys are refused off date and datetime', () => {
  // One representative per family, plus `time` — the near miss: a time of day
  // has no calendar day to fall behind — and `formula`, which may RETURN a date
  // but is computed per read.
  const wrongTypes = ['text', 'time', 'number', 'boolean', 'select', 'lookup', 'formula', 'autonumber'] as const;
  for (const type of wrongTypes) {
    it(`refuses dueLike on type: '${type}' with one custom issue at [dueLike]`, () => {
      const issues = issuesAt({ name: 'f', label: 'F', type, dueLike: true }, 'dueLike');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      // Named subjects: the legal set and the offending type.
      expect(issues[0]!.message).toContain("'date', 'datetime'");
      expect(issues[0]!.message).toContain(`\`${type}\``);
    });

    it(`refuses settledWhen on type: '${type}' with ONE custom issue at [settledWhen] — the type refusal, not the missing-dueLike one`, () => {
      const issues = issuesAt({ name: 'f', label: 'F', type, settledWhen: 'record.done == true' }, 'settledWhen');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.message).toContain("'date', 'datetime'");
      expect(issues[0]!.message).toContain(`\`${type}\``);
      // It must not send this author to add `dueLike: true`, which the type
      // refusal above would then answer.
      expect(issues[0]!.message).not.toContain('Add `dueLike: true`');
    });
  }

  it('refuses dueLike: false off-type too — an authored value on a type it describes nothing on', () => {
    const issues = issuesAt({ name: 'f', label: 'F', type: 'text', dueLike: false }, 'dueLike');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('custom');
  });
});

describe('settledWhen without dueLike: true is refused (ADR-0049: a declared key is enforced)', () => {
  for (const type of DEADLINE_TYPES) {
    it(`refuses settledWhen with dueLike absent on type: '${type}'`, () => {
      const issues = issuesAt({ name: 'd', label: 'D', type, settledWhen: 'record.done == true' }, 'settledWhen');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.message).toContain('`dueLike: true`');
    });

    it(`refuses settledWhen with dueLike: false on type: '${type}'`, () => {
      const issues = issuesAt(
        { name: 'd', label: 'D', type, dueLike: false, settledWhen: 'record.done == true' },
        'settledWhen',
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.message).toContain('`dueLike: true`');
    });
  }

  it('refuses a blank settledWhen with the evaluated-slot rule, as for every sibling', () => {
    const issues = issuesAt({ name: 'd', label: 'D', type: 'date', dueLike: true, settledWhen: '   ' }, 'settledWhen');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.code).toBe('invalid_union');
  });

  it('refuses a non-CEL value shape (a boolean is not a predicate)', () => {
    const issues = issuesAt({ name: 'd', label: 'D', type: 'date', dueLike: true, settledWhen: true }, 'settledWhen');
    expect(issues.length).toBeGreaterThan(0);
  });
});

// =========================================================================
// 3. The offer side — the field form shows each key exactly where it parses
// =========================================================================

describe('field.form offers the deadline keys on exactly the types the door accepts', () => {
  const rows = (fieldForm.sections ?? []).flatMap((s) => s.fields ?? []) as Array<{ field?: string; visibleWhen?: unknown }>;
  const rowFor = (key: string) => rows.find((r) => r.field === key);
  // `defineForm` normalizes a bare predicate string to its `{ dialect, source }`
  // envelope, so the gate is read off `source`.
  const gateOf = (row: { visibleWhen?: unknown }) => {
    const v = row.visibleWhen as string | { source?: string } | undefined;
    return typeof v === 'string' ? v : String(v?.source);
  };

  it('offers dueLike, gated on date / datetime', () => {
    const row = rowFor('dueLike');
    expect(row).toBeDefined();
    expect(gateOf(row!)).toContain("data.type in ['date','datetime']");
  });

  it('offers settledWhen, gated on date / datetime AND a declared deadline', () => {
    const row = rowFor('settledWhen');
    expect(row).toBeDefined();
    const gate = gateOf(row!);
    expect(gate).toContain("data.type in ['date','datetime']");
    expect(gate).toContain('data.dueLike == true');
  });
});
