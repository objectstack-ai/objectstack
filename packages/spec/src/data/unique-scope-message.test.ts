// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema } from './field.zod';
import { IndexSchema } from './object.zod';

/**
 * The `unique` scope vocabulary is shared by two surfaces; the *meaning of bare
 * `true`* is not, and that divergence is deliberate and load-bearing (ADR-0120
 * D1, the #4986 trap):
 *
 *   - `FieldSchema.unique`  — bare `true` resolves per-organization, so
 *     `'organization'` genuinely IS its explicit spelling.
 *   - `IndexSchema.unique`  — bare `true` sets neither driver flag and the
 *     index materializes over exactly `fields`, i.e. `'global'` is what it
 *     spells. #5082 retires the positional form at protocol 18; 17.x warns
 *     through lint `unique/unscoped-declared-index`.
 *
 * One shared rejection message could only be right on one of them, and it was
 * written for the field surface. Read at the one moment it is most likely to be
 * obeyed — the author has just been refused on this very key and is looking for
 * the accepted spelling — it told a declared-index author that `'organization'`
 * is what their working `true` spells. Taking that advice asks the driver to
 * prepend the NULL-safe organization key part at registration: a
 * materialization change, silent, on an index that may already exist on a
 * deployed database. That is the unannounced reinterpretation ruled out by
 * #8323 (maintainer, 2026-08-13) and staged by #5082.
 *
 * This file pins the repair on both halves at once, because either half alone
 * is re-breakable:
 *
 *   1. the two surfaces say DIFFERENT things about bare `true` (the fix), and
 *   2. they accept and reject exactly the same values, with identical parse
 *      results and an identical rejection envelope (the constraint — #8323
 *      forbids reinterpreting declared indexes, so a message repair may not
 *      move a single value across the accept/reject line).
 *
 * (2) is what makes the duplicated union in `object.zod.ts` safe: the member
 * lists are written twice on purpose, so drift fails here rather than shipping.
 */

/** Minimal valid field, `unique` supplied by the caller. */
const parseField = (unique: unknown) =>
  FieldSchema.safeParse({ name: 'code', label: 'Code', type: 'text', unique });

/** Minimal valid declared index, `unique` supplied by the caller. */
const parseIndex = (unique: unknown) =>
  IndexSchema.safeParse({ fields: ['code'], unique });

/** The sole `unique` issue, or a failure the caller can read. */
const uniqueIssue = (result: ReturnType<typeof parseField>) => {
  expect(result.success, 'expected this value to be REFUSED').toBe(false);
  if (result.success) throw new Error('unreachable');
  const issues = result.error.issues.filter((i) => i.path.join('.') === 'unique');
  expect(issues, 'expected exactly one issue on `unique`').toHaveLength(1);
  return issues[0]!;
};

/**
 * The near-miss clause (ADR-0120 §Terminology). Shared verbatim by both
 * surfaces — `'tenant'`/`'org'` are rejected words on either, and nothing about
 * that answer is surface-dependent.
 */
const NEAR_MISS = (spelled: string) =>
  ` ${spelled} is not accepted and is not an alias — the per-organization scope is spelled 'organization' (ADR-0120: "tenant" is overloaded across deployment topologies, and the platform spells the word out).`;

/**
 * The field-surface message, pinned byte-for-byte as it shipped before the
 * split. This half of the repair is "change nothing": the hint is TRUE here and
 * is the common surface, so the fix must not cost it. A `toBe` rather than a
 * `toContain` on purpose — a later edit that "harmonises" the two messages back
 * together fails here, which is the regression this card is about.
 */
const FIELD_MESSAGE =
  "Invalid unique scope 'nonsense_scope'. Allowed: true/false, 'organization' "
  + '(one holder per organization — the explicit spelling of true), or \'global\' '
  + '(one holder across the whole installation).';

describe('unique scope rejection message — the two surfaces disagree about bare `true`', () => {
  it('the FIELD surface keeps its "explicit spelling of true" hint, unchanged', () => {
    expect(uniqueIssue(parseField('nonsense_scope')).message).toBe(FIELD_MESSAGE);
  });

  it('the DECLARED-INDEX surface names `global` as the positional meaning of bare true', () => {
    const message = uniqueIssue(parseIndex('nonsense_scope')).message;

    // The defect, stated as an assertion: this claim is false here.
    expect(message, "'organization' is NOT the explicit spelling of true on a declared index")
      .not.toContain('the explicit spelling of true');

    // What the author needs instead, attached to the scope it is true of.
    expect(message).toContain("'global'");
    expect(message).toContain('the positional meaning of bare true on a declared index');

    // The migration the author is standing in front of (#5082): the 17.x
    // warning channel and the protocol-18 rejection, named where they are read.
    expect(message).toContain('unique/unscoped-declared-index');
    expect(message).toContain('protocol 18');
    expect(message).toContain('#5082');

    // And the organization scope described by what it DOES here, not by an
    // equivalence to `true` that does not hold on this surface.
    expect(message).toContain('one holder per organization');
    expect(message).toContain('NULL-safe');
  });

  it('the contrast is real — the two surfaces do not emit the same text', () => {
    const field = uniqueIssue(parseField('nonsense_scope')).message;
    const index = uniqueIssue(parseIndex('nonsense_scope')).message;
    expect(index).not.toBe(field);
    // Both still open with the vocabulary, so an author reading either one
    // learns the whole accepted set from the first sentence.
    for (const message of [field, index]) {
      expect(message).toContain("Invalid unique scope 'nonsense_scope'.");
      expect(message).toContain("Allowed: true/false, 'organization'");
    }
  });

  it.each(['tenant', 'org'])(
    'the rejected word %s gets the same near-miss clause on BOTH surfaces',
    (word) => {
      expect(uniqueIssue(parseField(word)).message).toContain(NEAR_MISS(`'${word}'`));
      expect(uniqueIssue(parseIndex(word)).message).toContain(NEAR_MISS(`'${word}'`));
    },
  );
});

describe('unique scope — message text only: the accept/reject line does not move (#8323)', () => {
  // Every value an author can write on this key, accepted or refused. The
  // vocabulary (ADR-0120 D1) plus the two rejected words plus the shapes a
  // wrong type arrives as.
  const VALUES: Array<{ label: string; value: unknown; accepted: boolean }> = [
    { label: 'true', value: true, accepted: true },
    { label: 'false', value: false, accepted: true },
    { label: "'global'", value: 'global', accepted: true },
    { label: "'organization'", value: 'organization', accepted: true },
    { label: "'tenant'", value: 'tenant', accepted: false },
    { label: "'org'", value: 'org', accepted: false },
    { label: "'nonsense_scope'", value: 'nonsense_scope', accepted: false },
    { label: "'TRUE'", value: 'TRUE', accepted: false },
    { label: "'Global'", value: 'Global', accepted: false },
    { label: "''", value: '', accepted: false },
    { label: '1', value: 1, accepted: false },
    { label: '0', value: 0, accepted: false },
    { label: 'null', value: null, accepted: false },
    { label: '[]', value: [], accepted: false },
    { label: '{}', value: {}, accepted: false },
  ];

  it.each(VALUES)('$label is treated identically on both surfaces', ({ value, accepted }) => {
    const field = parseField(value);
    const index = parseIndex(value);

    expect(field.success).toBe(accepted);
    expect(index.success).toBe(accepted);

    if (field.success && index.success) {
      // The parse RESULT, not just the verdict: a scope must survive the round
      // trip as itself on both surfaces (no coercion, no normalisation).
      expect(field.data.unique).toStrictEqual(value);
      expect(index.data.unique).toStrictEqual(value);
    }
  });

  it('the refusal envelope is unchanged on both surfaces (code and path)', () => {
    for (const parse of [parseField, parseIndex]) {
      for (const bad of ['nonsense_scope', 'tenant', 'org', 1, null]) {
        const issue = uniqueIssue(parse(bad));
        expect(issue.code).toBe('invalid_union');
        expect(issue.path).toEqual(['unique']);
      }
    }
  });

  it('`unique` still defaults the same way on each surface', () => {
    const field = FieldSchema.safeParse({ name: 'code', label: 'Code', type: 'text' });
    expect(field.success && field.data.unique).toBe(false);

    // Optional on a declared index, and its default is the same `false`.
    const index = IndexSchema.safeParse({ fields: ['code'] });
    expect(index.success && index.data.unique).toBe(false);
  });
});
