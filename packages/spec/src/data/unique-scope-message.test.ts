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
 *   - `IndexSchema.unique`  — bare `true` set neither driver flag and the
 *     index materialized over exactly `fields`, i.e. `'global'` is what it
 *     spelled. Since protocol 18 (#5082) the positional form is REFUSED here,
 *     with a prescription naming both stated scopes; 17.x warned through lint
 *     `unique/unscoped-declared-index`, and stored metadata converts it to
 *     `'global'` (the ADR-0087 conversion `declared-index-unique-scope`).
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
 *   2. they accept and reject exactly the same values — with identical parse
 *      results and an identical rejection envelope — on every row but ONE:
 *      bare `true`, which the field accepts (D1: valid indefinitely) and the
 *      declared index refuses since protocol 18 (D7). #8323 forbids
 *      reinterpreting declared indexes, so no other value may cross the
 *      accept/reject line, and the one that does crosses it as a REFUSAL with
 *      a prescription, never as a silent change of meaning.
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

/**
 * A parse from EITHER surface. Spelled as the union rather than as one of the
 * two, because reading the same assertion off both is the whole point of this
 * file — a helper typed to one surface silently makes the other half unwritable.
 */
type ScopeParse = ReturnType<typeof parseField> | ReturnType<typeof parseIndex>;

/** The sole `unique` issue, or a failure the caller can read. */
const uniqueIssue = (result: ScopeParse) => {
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

  it('the DECLARED-INDEX surface never calls `organization` the spelling of true, and says bare true is not accepted', () => {
    const message = uniqueIssue(parseIndex('nonsense_scope')).message;

    // The defect, stated as an assertion: this claim is false here.
    expect(message, "'organization' is NOT the explicit spelling of true on a declared index")
      .not.toContain('the explicit spelling of true');

    // The accepted set, read off the message: no `true` in it.
    expect(message).toContain("Allowed: false, 'organization'");
    expect(message).toContain("'global'");
    expect(message).toContain('Bare true is not accepted on a declared index: state the scope.');
    expect(message).not.toMatch(/#\d{3,5}\b/);

    // And the organization scope described by what it DOES here, not by an
    // equivalence to `true` that does not hold on this surface.
    expect(message).toContain('one holder per organization');
    expect(message).toContain('NULL-safe');
  });

  it('bare `true` on a DECLARED INDEX is refused with the protocol-18 prescription (ADR-0120 D5a)', () => {
    const issue = uniqueIssue(parseIndex(true));
    // Same envelope as every other refusal on this key.
    expect(issue.code).toBe('invalid_union');
    expect(issue.path).toEqual(['unique']);
    // The prescription: the retired spelling, both stated scopes and which one
    // keeps the index bare `true` built, and the migration command. Asserted
    // by phrase, not byte — the scopes and the command are what an author
    // (and an upgrading agent grepping the refusal) acts on.
    expect(issue.message).toMatch(/^`indexes\[\]\.unique: true` was retired at protocol 18 \(ADR-0120 D1\)/);
    expect(issue.message).toContain("`unique: 'global'` (installation-wide — the exact index bare `true` built");
    expect(issue.message).toContain("`unique: 'organization'` (one holder per organization");
    expect(issue.message).toContain('Field-level `unique: true` is unaffected.');
    expect(issue.message).toContain(
      'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.',
    );
    expect(issue.message).not.toMatch(/#\d{3,5}\b/);
  });

  it('bare `true` on a FIELD is still accepted and still means per-organization (ADR-0120 D1 — not retired)', () => {
    const field = parseField(true);
    expect(field.success).toBe(true);
    if (field.success) expect(field.data.unique).toBe(true);
  });

  it('the contrast is real — the two surfaces do not emit the same text', () => {
    const field = uniqueIssue(parseField('nonsense_scope')).message;
    const index = uniqueIssue(parseIndex('nonsense_scope')).message;
    expect(index).not.toBe(field);
    // Both still open with the vocabulary, so an author reading either one
    // learns the whole accepted set from the first sentence.
    for (const message of [field, index]) {
      expect(message).toContain("Invalid unique scope 'nonsense_scope'.");
      expect(message).toMatch(/Allowed: (true\/)?false, 'organization'/);
    }
    // The one member the two surfaces disagree on, as each states it.
    expect(field).toContain("Allowed: true/false, 'organization'");
    expect(index).toContain("Allowed: false, 'organization'");
  });

  it.each(['tenant', 'org'])(
    'the rejected word %s gets the same near-miss clause on BOTH surfaces',
    (word) => {
      expect(uniqueIssue(parseField(word)).message).toContain(NEAR_MISS(`'${word}'`));
      expect(uniqueIssue(parseIndex(word)).message).toContain(NEAR_MISS(`'${word}'`));
    },
  );
});

describe('unique scope — the accept/reject line moves for bare `true` on a declared index and for nothing else', () => {
  // Every value an author can write on this key, accepted or refused. The
  // vocabulary (ADR-0120 D1) plus the two rejected words plus the shapes a
  // wrong type arrives as. `index` differs from `field` on exactly one row —
  // bare `true`, retired on the declared-index surface at protocol 18 — and a
  // second split row is the drift this table exists to catch.
  const VALUES: Array<{ label: string; value: unknown; field: boolean; index: boolean }> = [
    { label: 'true', value: true, field: true, index: false },
    { label: 'false', value: false, field: true, index: true },
    { label: "'global'", value: 'global', field: true, index: true },
    { label: "'organization'", value: 'organization', field: true, index: true },
    { label: "'tenant'", value: 'tenant', field: false, index: false },
    { label: "'org'", value: 'org', field: false, index: false },
    { label: "'nonsense_scope'", value: 'nonsense_scope', field: false, index: false },
    { label: "'TRUE'", value: 'TRUE', field: false, index: false },
    { label: "'Global'", value: 'Global', field: false, index: false },
    { label: "''", value: '', field: false, index: false },
    { label: '1', value: 1, field: false, index: false },
    { label: '0', value: 0, field: false, index: false },
    { label: 'null', value: null, field: false, index: false },
    { label: '[]', value: [], field: false, index: false },
    { label: '{}', value: {}, field: false, index: false },
  ];

  it('the two surfaces split on exactly one row, and it is bare `true`', () => {
    expect(VALUES.filter((v) => v.field !== v.index).map((v) => v.label)).toEqual(['true']);
  });

  it.each(VALUES)('$label: field accepts=$field, declared index accepts=$index', ({ value, field: fieldOk, index: indexOk }) => {
    const field = parseField(value);
    const index = parseIndex(value);

    expect(field.success).toBe(fieldOk);
    expect(index.success).toBe(indexOk);

    // The parse RESULT, not just the verdict: a scope must survive the round
    // trip as itself on every surface that accepts it (no coercion, no
    // normalisation).
    if (field.success) expect(field.data.unique).toStrictEqual(value);
    if (index.success) expect(index.data.unique).toStrictEqual(value);
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
