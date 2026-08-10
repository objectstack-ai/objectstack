// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7127 — `FieldSchema.defaultValue` must be one of the key's three legal
 * shapes (CEL envelope / runtime token / literal), and legal for ITS OWN
 * field: envelope accepted structurally, token gated per-token × per-type,
 * literal checked through the same `valueSchemaFor(def, 'stored')` the #6970
 * action-param gate runs (ADR-0104 D1 — one rule set, two surfaces).
 *
 * Before this, `defaultValue` was a bare `z.unknown()`: a default that could
 * never satisfy its own field parsed clean and surfaced as bad data or a
 * runtime failure far from the cause.
 *
 * Every rejection pin asserts issue PATH + CODE + MESSAGE CONTENT — never a
 * bare `success === false`, which cannot tell this rejection from the schema
 * refusing the field for an unrelated reason.
 */

import { describe, it, expect } from 'vitest';

import { FieldSchema } from './field.zod';
import { ObjectSchema } from './object.zod';

/** Parse a field and return its first `defaultValue` issue, or `null`. */
function defaultValueIssue(field: Record<string, unknown>) {
  const r = FieldSchema.safeParse({ name: 'probe_field', label: 'Probe', ...field });
  if (r.success) return null;
  return r.error.issues.find((i) => i.path.join('.') === 'defaultValue') ?? null;
}

type Case = {
  label: string;
  field: Record<string, unknown>;
  accepted: boolean;
  /** Substrings the refusal message must carry (rejection rows only). */
  contains?: string[];
};

const CASES: Case[] = [
  // ── Literal branch: the residual hole the issue measured, now refused ─────
  {
    label: "number + literal 'abc'",
    field: { type: 'number', defaultValue: 'abc' },
    accepted: false,
    contains: ['"probe_field"', '(number)', '"abc"', 'stored value contract'],
  },
  {
    label: 'datetime + wall clock (no zone)',
    field: { type: 'datetime', defaultValue: '2026-08-10T15:00' },
    accepted: false,
    contains: ['ISO-8601 instant'],
  },
  {
    label: 'select + a non-member of its own options',
    field: {
      type: 'select',
      options: [{ label: 'Gold', value: 'gold' }, { label: 'Silver', value: 'silver' }],
      defaultValue: 'platinum',
    },
    accepted: false,
    contains: ['"platinum"'],
  },
  { label: 'boolean + 42', field: { type: 'boolean', defaultValue: 42 }, accepted: false, contains: ['42'] },
  {
    label: 'number + arbitrary object',
    field: { type: 'number', defaultValue: { a: 1 } },
    accepted: false,
  },
  {
    label: 'multi-value user + scalar literal (arity is part of the stored contract)',
    field: { type: 'user', multiple: true, defaultValue: 'usr_1' },
    accepted: false,
  },

  // ── Literal branch: valid literals stay accepted ──────────────────────────
  { label: 'VALID number', field: { type: 'number', defaultValue: 7 }, accepted: true },
  { label: 'VALID boolean', field: { type: 'boolean', defaultValue: false }, accepted: true },
  { label: 'VALID date (calendar day)', field: { type: 'date', defaultValue: '2026-08-10' }, accepted: true },
  {
    label: 'VALID select member',
    field: { type: 'select', options: [{ label: 'Gold', value: 'gold' }], defaultValue: 'gold' },
    accepted: true,
  },
  {
    label: 'VALID multi-value user array',
    field: { type: 'user', multiple: true, defaultValue: ['usr_1'] },
    accepted: true,
  },
  {
    label: 'json — explicitly OPEN contract, any literal rides',
    field: { type: 'json', defaultValue: { anything: ['at', 'all'] } },
    accepted: true,
  },
  {
    label: "'' is a PRESENT default (engine semantics) and a valid text literal",
    field: { type: 'text', defaultValue: '' },
    accepted: true,
  },

  // ── Token branch: NOW() per-type (Q1 / Q2) ────────────────────────────────
  { label: 'NOW() on datetime', field: { type: 'datetime', defaultValue: 'NOW()' }, accepted: true },
  { label: 'NOW() on date (supported end-to-end, Q1 in)', field: { type: 'date', defaultValue: 'NOW()' }, accepted: true },
  { label: 'NOW() on time (supported end-to-end, Q1 in)', field: { type: 'time', defaultValue: 'NOW()' }, accepted: true },
  {
    label: 'NOW() on text — refused; the silent instant-into-text interception nobody chose (Q2)',
    field: { type: 'text', defaultValue: 'NOW()' },
    accepted: false,
    contains: ['"probe_field"', '(text)', '"NOW()"', '`datetime`', '`date`', '`time`'],
  },
  {
    label: 'now() lowercase is the SAME token (case-insensitive), same refusal on number',
    field: { type: 'number', defaultValue: 'now()' },
    accepted: false,
    contains: ['NOW()'],
  },
  {
    label: 'NOW() on json — the token branch applies even where the literal contract is open',
    field: { type: 'json', defaultValue: 'NOW()' },
    accepted: false,
  },

  // ── Token branch: current_user per-type (Q4 strict) ───────────────────────
  { label: 'current_user on user', field: { type: 'user', defaultValue: 'current_user' }, accepted: true },
  {
    label: "current_user on lookup(reference: 'sys_user')",
    field: { type: 'lookup', reference: 'sys_user', defaultValue: 'current_user' },
    accepted: true,
  },
  {
    label: 'current_user on number',
    field: { type: 'number', defaultValue: 'current_user' },
    accepted: false,
    contains: ['"current_user"', 'sys_user.id'],
  },
  {
    label: 'current_user on lookup targeting another object',
    field: { type: 'lookup', reference: 'accounts', defaultValue: 'current_user' },
    accepted: false,
    contains: ['`accounts`', "reference: 'sys_user'"],
  },
  {
    label: 'current_user on lookup with NO reference (strict: the gate reads the target)',
    field: { type: 'lookup', defaultValue: 'current_user' },
    accepted: false,
    contains: ['no declared object'],
  },
  {
    label: 'current_user on text — passes valueSchemaFor as a string, but the token branch runs FIRST',
    field: { type: 'text', defaultValue: 'current_user' },
    accepted: false,
  },

  // ── Token branch: multi-value refusal (Q3) ────────────────────────────────
  {
    label: 'current_user on user + multiple:true — a token resolves to one scalar',
    field: { type: 'user', multiple: true, defaultValue: 'current_user' },
    accepted: false,
    contains: ['multi-value', 'single scalar'],
  },
  {
    label: 'NOW() on multiselect — inherently multi, same refusal',
    field: { type: 'multiselect', options: [{ label: 'A', value: 'a' }], defaultValue: 'NOW()' },
    accepted: false,
    contains: ['multi-value'],
  },

  // ── Envelope branch: structural acceptance only ───────────────────────────
  {
    label: 'CEL envelope on date',
    field: { type: 'date', defaultValue: { dialect: 'cel', source: 'today()' } },
    accepted: true,
  },
  {
    label: 'envelope with an unknown dialect is STILL an envelope (runtime concern, not parse)',
    field: { type: 'number', defaultValue: { dialect: 'made_up', source: 'x' } },
    accepted: true,
  },
  {
    label: 'envelope MISSING `source` is not an envelope — judged (and refused) as an object literal',
    field: { type: 'datetime', defaultValue: { dialect: 'cel' } },
    accepted: false,
  },

  // ── Near-misses (Q5): suggested inside refusals, never accepted, never widened ──
  {
    label: "datetime + 'now' — refused as a literal, with the token suggested",
    field: { type: 'datetime', defaultValue: 'now' },
    accepted: false,
    contains: ['Did you mean the runtime token `NOW()`', 'never accepted as tokens'],
  },
  {
    label: "user + '{current_user}' (filter-vocabulary braces) — refused, with the token suggested",
    field: { type: 'user', defaultValue: '{current_user}' },
    accepted: false,
    contains: ['Did you mean the runtime token `current_user`'],
  },
  {
    label: "text + 'CURRENT_USER' — a VALID string literal; near-misses are never widened into refusals",
    field: { type: 'text', defaultValue: 'CURRENT_USER' },
    accepted: true,
  },
];

describe('#7127 FieldSchema.defaultValue — three shapes, each judged on its own terms', () => {
  for (const { label, field, accepted, contains } of CASES) {
    it(`${accepted ? 'accepts' : 'rejects'}: ${label}`, () => {
      const issue = defaultValueIssue(field);
      if (accepted) {
        expect(issue).toBeNull();
        return;
      }
      expect(issue).not.toBeNull();
      expect(issue!.path).toEqual(['defaultValue']);
      expect(issue!.code).toBe('custom');
      // Self-prescribing house style: the message names the field and carries
      // the case-specific prescription.
      expect(issue!.message).toContain('"probe_field"');
      for (const fragment of contains ?? []) {
        expect(issue!.message).toContain(fragment);
      }
    });
  }

  it('skips ABSENT defaults — null and undefined mean "no default" (engine semantics)', () => {
    expect(defaultValueIssue({ type: 'number', defaultValue: null })).toBeNull();
    expect(defaultValueIssue({ type: 'number' })).toBeNull();
  });

  it('reports through the real authoring door with a full field path', () => {
    const r = ObjectSchema.safeParse({
      name: 'probe_object',
      label: 'Probe',
      fields: {
        due_at: { type: 'datetime', label: 'Due', defaultValue: '2026-08-10T15:00' },
      },
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('fields.due_at.defaultValue');
  });

  it('carries the value contract\'s own words on the literal branch — the same detail the action-param gate carries', () => {
    const issue = defaultValueIssue({ type: 'datetime', defaultValue: '2026-08-10T15:00' })!;
    expect(issue.message).toContain('expected an ISO-8601 instant with explicit zone');
  });

  it('does not disturb the ADR-0113 refinement sharing the same block — both issues surface together', () => {
    const r = FieldSchema.safeParse({
      name: 'probe_field',
      label: 'Probe',
      type: 'number',
      requiredWhen: 'record.other == 1',
      storage: { notNull: true },
      defaultValue: 'abc',
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('storage.notNull');
    expect(paths).toContain('defaultValue');
  });
});
