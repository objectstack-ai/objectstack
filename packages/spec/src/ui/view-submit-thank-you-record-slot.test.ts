// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28005 (ruling B) — the `thank-you` panel's record slot, pinned at the schema
 * door.
 *
 * The panel's `title` / `message` take the redirect's token,
 * `{{record.field_name}}`, and nothing else spelled with a brace. Parse time
 * judges the SHAPE only; which field a token may name (engine-generated only)
 * is the lint rule's, where the form's object is known
 * (`@objectstack/lint` `validate-thank-you-record-fields.test.ts`).
 *
 * Each refusal pins the guidance an author reads — the offending token and the
 * one spelling to write — not merely that the parse failed.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';

import { FormViewSchema, thankYouRecordFieldNames } from './view.zod';
import { projectPublishedJsonSchema } from '../../scripts/lib/refinement-projection';

const FORM_BASE = { type: 'simple', sections: [{ fields: ['subject'] }] };

function form(panel: Record<string, unknown>): unknown {
  return { ...FORM_BASE, submitBehavior: { kind: 'thank-you', ...panel } };
}

function accept(value: unknown): void {
  const r = FormViewSchema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify(r.error?.issues ?? '')}`).toBe(true);
}

/** Reject `value` and return its issues, each a path + message. */
function reject(value: unknown): Array<{ path: PropertyKey[]; message: string }> {
  const r = FormViewSchema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return (r.error?.issues ?? []).map((i) => ({ path: i.path, message: i.message }));
}

describe('thank-you panel text takes `{{record.field_name}}` and no other brace', () => {
  it('a message naming a case number parses, and the text arrives verbatim', () => {
    const value = form({ title: 'Thanks', message: 'Your case number is {{record.case_number}}.' });
    accept(value);
    const parsed = FormViewSchema.parse(value) as { submitBehavior?: { message?: string } };
    expect(parsed.submitBehavior?.message).toBe('Your case number is {{record.case_number}}.');
  });

  it('a title token, several tokens, and text with no token all parse', () => {
    accept(form({ title: 'Case {{record.case_number}} received' }));
    accept(form({ message: '{{record.case_number}} / {{record.ticket_no}}' }));
    accept(form({ title: 'Thank you!', message: 'We will be in touch.' }));
    accept(form({}));
  });

  it.each([
    ['single braces', 'Your case is {record.case_number}', '{record.case_number}'],
    ['spaces inside the braces', 'Your case is {{ record.case_number }}', '{{ record.case_number }}'],
    ['no `record.` root', 'Your case is {{case_number}}', '{{case_number}}'],
    ['an uppercase field segment', 'Your case is {{record.CaseNumber}}', '{{record.CaseNumber}}'],
    ['a dotted path', 'Your case is {{record.account.name}}', '{{record.account.name}}'],
    ['a stray closing brace', 'Done }', '}'],
  ])('refuses %s, naming the offender and the one spelling', (_label, text, offender) => {
    const issues = reject(form({ message: text }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['submitBehavior', 'message']);
    expect(issues[0].message).toContain(`\`${offender}\` is not that shape`);
    expect(issues[0].message).toContain('`{{record.field_name}}`');
  });

  it('refuses a malformed title on the title, and names the member', () => {
    const issues = reject(form({ title: 'Case {{record.Case}}' }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['submitBehavior', 'title']);
    expect(issues[0].message).toMatch(/^A `thank-you` panel's `title`/);
  });

  it('the refusal carries no tracker id and no ruling date', () => {
    const [issue] = reject(form({ message: '{case}' }));
    expect(issue.message).not.toMatch(/#\d{3,6}|\b20\d\d-\d\d-\d\d\b|\bruling\b/i);
  });

  it('the published JSON Schema carries the shape as a `pattern` (no dropped refinement)', () => {
    const json = JSON.stringify(
      projectPublishedJsonSchema(FormViewSchema as unknown as z.ZodType, { io: 'input', unrepresentable: 'any' }),
    );
    expect(json).toContain(JSON.stringify('^(?:[^{}]|\\{\\{record\\.[a-z_][a-z0-9_]*\\}\\})*$'));
  });
});

describe('thankYouRecordFieldNames — the one reading of which fields a panel names', () => {
  it('reads title then message, each name once, in order of first appearance', () => {
    expect(thankYouRecordFieldNames({
      kind: 'thank-you',
      title: 'Case {{record.case_number}}',
      message: '{{record.ticket_no}} and again {{record.case_number}}',
    })).toEqual(['case_number', 'ticket_no']);
  });

  it('answers [] for any other kind, no panel text, no token, and non-objects', () => {
    expect(thankYouRecordFieldNames({ kind: 'redirect', url: '/thanks?c={{record.case_number}}' })).toEqual([]);
    expect(thankYouRecordFieldNames({ kind: 'thank-you' })).toEqual([]);
    expect(thankYouRecordFieldNames({ kind: 'thank-you', message: 'Thanks!' })).toEqual([]);
    expect(thankYouRecordFieldNames(undefined)).toEqual([]);
    expect(thankYouRecordFieldNames('thank-you')).toEqual([]);
  });

  it('reads only well-formed tokens', () => {
    expect(thankYouRecordFieldNames({ kind: 'thank-you', message: '{{ record.a }} {record.b} {{record.c}}' }))
      .toEqual(['c']);
  });
});
