// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13961] The zero-rows vocabulary published on `explain`'s two payload
 * fields must name BOTH sentinels, and must say which field is the decision.
 *
 * Why this pin exists. `ExplainDecision.readFilter` and
 * `ExplainRecordAttribution.rowFilter` are the machine artifact behind the
 * explain prose, and their published description was a closed, two-item
 * enumeration: "`null` = unrestricted, `{ id: '__deny_all__' }` = zero rows".
 * Then the platform grew a SECOND zero-rows shape that reaches those fields —
 * plugin-security's fail-closed RLS denial, an `id` equality against
 * `__rls_deny__` plus a colon and a UUID-shaped suffix — published exactly as
 * composed rather than rewritten to the deny-all spelling. The enumeration a
 * reader would trust was then missing a member, on a diagnostic surface whose
 * whole purpose is telling an operator the truth about a request.
 *
 * ⛔ Scope: **the claim shape, not the wording.** Rephrasing a sentence,
 * reordering the clauses, or naming a third shape that later becomes
 * reachable is free. Dropping either sentinel from either field's published
 * description, or dropping the statement that the sibling verdict fields —
 * not the payload — are the decision, is not.
 *
 * Read THROUGH the schema (`.shape.<field>.description`), never by grepping
 * the source: the description is what generators publish — the reference page
 * at `content/docs/references/security/explain.mdx` and the emitted JSON
 * Schema both copy this exact string — so reading it off the schema object is
 * reading the published artifact's own source, and a `.describe()` that got
 * detached from the field (moved onto a wrapper, dropped in a refactor) shows
 * up here as `undefined` instead of passing on a source line that still exists.
 *
 * The RLS sentinel's prefix is pinned as a LITERAL rather than imported from
 * `@objectstack/plugin-security`: `packages/spec` carries no runtime
 * dependency (Prime Directive #2), and a spec test that reached into another
 * package's source would also be a cross-package test input. The producer-side
 * half of the agreement — that the constant really is spelled this way — is
 * owned by plugin-security's own suites.
 */

import { describe, it, expect } from 'vitest';

import { ExplainDecisionSchema, ExplainRecordAttributionSchema } from './explain.zod';

/** The composed deny-all sentinel — the member the enumeration always had. */
const DENY_ALL = '__deny_all__';
/** The fail-closed RLS denial's marker prefix — the member it was missing. */
const RLS_DENY = '__rls_deny__';

const descriptionOf = (schema: unknown, field: string): string => {
  const shape = (schema as { shape: Record<string, { description?: string }> }).shape;
  const description = shape[field]?.description;
  expect(
    description,
    `${field} must carry a .describe() — a JSDoc-only field publishes an EMPTY description cell`,
  ).toBeTypeOf('string');
  return description as string;
};

describe.each([
  { field: 'readFilter', schema: ExplainDecisionSchema, decidedBy: [/\ballowed\b/, /\bverdict\b/] },
  {
    field: 'rowFilter',
    schema: ExplainRecordAttributionSchema,
    decidedBy: [/\boutcome\b/, /\bmatchesRecord\b/, /\bverdict\b/],
  },
])('$field — the published zero-rows vocabulary', ({ field, schema, decidedBy }) => {
  it('names BOTH zero-rows sentinels', () => {
    const description = descriptionOf(schema, field);
    expect(description).toContain(DENY_ALL);
    expect(description).toContain(RLS_DENY);
  });

  it('still names the unrestricted pole, so the enumeration stays complete at both ends', () => {
    expect(descriptionOf(schema, field)).toContain('null');
  });

  it('says the sibling verdict fields — not this payload — are the decision', () => {
    const description = descriptionOf(schema, field);
    for (const marker of decidedBy) expect(description).toMatch(marker);
  });

  it('tells a payload-matching consumer it must match BOTH shapes', () => {
    expect(descriptionOf(schema, field)).toMatch(/match both/i);
  });
});
