// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5367, maintainer ruling 2026-08-06] All TEN of `read-scope-sql.ts`'s
 * fail-closed refusals carry `READ_SCOPE_COMPILE_FAILED` / **500** — and the
 * refusal SET did not move.
 *
 * ## What was wrong
 *
 * These ten were the last family classified by PROSE. `rest-server.ts`'s
 * `/analytics/dataset/query` catch matched `read-scope-sql` in the message text
 * — the final surviving entry of the hardcoded substring list #5352 introduced —
 * and answered `400 DATASET_INVALID`. Two separate defects in one verdict:
 *
 *   1. **Misattribution.** `compileScopedFilterToSql(filter, alias)` receives an
 *      RLS `FilterCondition` the security service compiled from an ADMIN-authored
 *      sharing rule / permission set, and a join alias the DATASET COMPILER
 *      generated. Neither is caller input — the caller's own predicate goes
 *      through `filter-normalizer.ts` and has answered `INVALID_FILTER` / 400
 *      since #5352. So what can arrive here is a broken policy or drift between
 *      two of our own components (#5557's `$regex` was literally the second), and
 *      for this request's caller both are a server fault. `400` told them to fix
 *      a request that was never wrong, and kept the real fault out of 5xx alerting.
 *   2. **Disclosure.** A 400 echoed the message verbatim, so
 *      `unsafe field identifier "…"` and `unsupported operator "$x" on "owner"`
 *      handed the tenant the field names and comparands of the RLS policy.
 *
 * Option A on the decision card was `READ_SCOPE_INVALID` / 422; the maintainer
 * took option B (500, named code) because no consumer reads a code on this path,
 * because a 4xx misreports a condition the client cannot fix, and because the 500
 * withhold closes the disclosure structurally instead of message by message.
 *
 * ## The two halves of this file
 *
 * `describe('the refusal SET is unchanged')` pins WHICH inputs are refused, what
 * each says, and — the other half of "we only touched the envelope" — that the
 * neighbouring ACCEPTED inputs still compile to the same SQL. Every assertion in
 * it passes both before and after this change.
 *
 * `describe('every refusal carries …')` is the change. Run it against pre-#5367
 * code and all ten fail with `code` / `status` `undefined`, while the block above
 * stays green.
 *
 * ## [#6125] An eleventh site, and why it is registered HERE
 *
 * The `undefined` comparand refusal (row ⑥) was added on 2026-08-07 by #6125's
 * ruling. It is in this table for the invariant at the bottom of the file rather
 * than for its own sake: what #5352 cost was a module where SOME refusals
 * carried the envelope, which is indistinguishable from none of them at the HTTP
 * boundary. So the rule this table encodes is that the inventory grows whenever
 * the module gains a refusing site — a new `throw` that is not listed here is
 * the defect returning. Row ⑥'s own behaviour (four comparand positions, and the
 * `null` control group that must NOT move) is pinned in
 * `read-scope-undefined-comparand.test.ts`; only its ENVELOPE is asserted here.
 *
 * ## [#6387] A twelfth site — TWO rows, because it has two triggers
 *
 * Rows ⑦ and ⑧ (non-boolean `$null` / `$exists`) were added on 2026-08-07 by
 * #6387, pushing #5347 / #5369's boolean-domain refusal down from `driver-sql`.
 * They are the second instance of the `quoteIdent` shape the note below
 * describes: ONE gate, reached by two genuinely different triggers, both listed
 * so the pair is asserted to answer the SAME envelope. They deliberately share
 * one wording (#5240 — one condition, one wording; only the operator name and
 * the path vary), and that "only those vary" is pinned in
 * `read-scope-boolean-flag-comparand.test.ts` along with the behaviour itself.
 * Here, as always, only the ENVELOPE is asserted.
 *
 * The end-to-end consequence — that the REST face answers
 * `500 ANALYTICS_QUERY_FAILED` with the policy content WITHHELD from the body and
 * intact in `logError` — is `packages/rest`'s
 * `analytics-read-scope-refusal-envelope.test.ts`. Producer and boundary are
 * different facts; #5352 was a defect that read as fixed from either side alone.
 */

import { describe, it, expect } from 'vitest';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

/** The ADR-0112 fields an HTTP boundary classifies on. */
interface Refusal extends Error {
  code?: unknown;
  status?: unknown;
}

function refusalFor(filter: unknown, alias = 'crm_opportunity'): Refusal | undefined {
  try {
    compileScopedFilterToSql(filter as never, alias);
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

/**
 * Every refusing site in `read-scope-sql.ts`, in source order.
 *
 * FIFTEEN rows over THIRTEEN throw sites: TWO sites are each reached by two
 * triggers, and every trigger is listed on purpose.
 *
 *   - `quoteIdent`, with two `kind` values. That alias-vs-field split was option
 *     C on #5367's decision card — the one place where the two triggers are
 *     genuinely different (a bad alias is OUR generator, a bad field is the
 *     admin's policy) and where a per-branch verdict was on the table. Option B
 *     collapsed it: both answer the same 500, so the two rows must produce the
 *     same envelope, and asserting that is what makes the collapse a tested
 *     decision rather than an omission.
 *   - [#6387] `assertBooleanFlagComparands`, with two operators. Same shape,
 *     same reason it is not collapsed to one row: `$null` and `$exists` are
 *     different triggers whose messages differ (by operator name and path) and
 *     whose envelope must not.
 *
 * `site` names the `throw readScopeCompileError(...)` the row reaches, so the
 * table can be checked against the source without guessing. `sensitive` records
 * what the message discloses and must NOT reach a caller — the disclosure half of
 * the defect, and the reason the boundary test asserts on the BODY and not only on
 * the status.
 */
const REFUSALS: Array<{
  name: string;
  site: string;
  filter: unknown;
  alias?: string;
  message: RegExp;
  sensitive: string;
}> = [
  {
    name: '① unsafe ALIAS identifier',
    site: 'quoteIdent',
    filter: { owner_id: 'u1' },
    alias: 'not a valid alias',
    message: /unsafe alias identifier "not a valid alias" — refusing to build read scope \(fail-closed\)/,
    sensitive: 'not a valid alias',
  },
  {
    name: '② unsafe FIELD identifier',
    site: 'quoteIdent',
    filter: { 'secret policy field': 'u1' },
    message: /unsafe field identifier "secret policy field" — refusing to build read scope \(fail-closed\)/,
    sensitive: 'secret policy field',
  },
  {
    name: '③ read scope is not a filter object',
    site: 'compileNode: not a filter object',
    filter: 'owner_id = 1',
    message: /read scope must be a filter object \(fail-closed\)/,
    sensitive: '',
  },
  {
    name: '④ $and / $or that is not an array',
    site: 'compileNode: combinator needs an array',
    filter: { $and: { owner_id: 'u1' } },
    message: /"\$and" requires an array \(fail-closed\)/,
    sensitive: '',
  },
  {
    name: '⑤ unsupported top-level operator',
    site: 'compileNode: unsupported top-level operator',
    filter: { $nor: [{ owner_id: 'u1' }] },
    message: /unsupported top-level operator "\$nor" \(fail-closed\)/,
    sensitive: '$nor',
  },
  {
    name: '⑥ undefined in a comparand position',
    site: 'compileField: undefined comparand',
    filter: { owner_id: undefined },
    message: /comparand at "owner_id" is undefined — refusing to build read scope \(fail-closed\)/,
    sensitive: 'owner_id',
  },
  {
    name: '⑦ non-boolean $null comparand',
    site: 'compileField: non-boolean $null/$exists comparand',
    filter: { owner_id: { $null: 'false' } },
    message: /comparand for "\$null" at "owner_id"\.\$null is not a boolean — refusing to build read scope \(fail-closed\)/,
    sensitive: 'owner_id',
  },
  {
    name: '⑧ non-boolean $exists comparand',
    site: 'compileField: non-boolean $null/$exists comparand',
    filter: { owner_id: { $exists: 'false' } },
    message: /comparand for "\$exists" at "owner_id"\.\$exists is not a boolean — refusing to build read scope \(fail-closed\)/,
    sensitive: 'owner_id',
  },
  {
    name: '⑨ bare array value',
    site: 'compileField: bare array value',
    filter: { region_code: ['emea', 'apac'] },
    message: /bare array value for "region_code" — use \{ \$in: \[\.\.\.\] \} \(fail-closed\)/,
    sensitive: 'region_code',
  },
  {
    name: '⑩ nested / relation value',
    site: 'compileField: nested/relation value',
    filter: { owner: { manager_id: 'u1' } },
    message: /"owner" has a nested\/relation value which is not supported in a read scope \(fail-closed\)/,
    sensitive: 'owner',
  },
  {
    name: '⑪ $in without an array',
    site: 'compileOperator: $in needs an array',
    filter: { region_code: { $in: 'emea' } },
    message: /\$in for "region_code" needs an array \(fail-closed\)/,
    sensitive: 'region_code',
  },
  {
    name: '⑫ $nin without an array',
    site: 'compileOperator: $nin needs an array',
    filter: { region_code: { $nin: 'emea' } },
    message: /\$nin for "region_code" needs an array \(fail-closed\)/,
    sensitive: 'region_code',
  },
  {
    // [#13571] The empty EXCLUSION refuses; the empty INCLUSION keeps its
    // constant — see the ACCEPTED table's "#5243" row. Deliberate asymmetry
    // ("shape errors throw, boolean identities reduce" — #5322; a reduction to
    // constant TRUE vacates the scope, so it is on the throw side), not an
    // oversight: read-scope-sql.ts's #13571 header section carries the ruling.
    name: '⑬ $nin with an EMPTY array',
    site: 'compileOperator: empty $nin vacates the scope',
    filter: { region_code: { $nin: [] } },
    message: /\$nin for "region_code" is empty — an empty exclusion excludes nothing and would compile the read scope to constant TRUE \(fail-closed\)/,
    sensitive: 'region_code',
  },
  {
    name: '⑭ $between without [min,max]',
    site: 'compileOperator: $between needs [min,max]',
    filter: { credit_limit: { $between: [10] } },
    message: /\$between for "credit_limit" needs \[min,max\] \(fail-closed\)/,
    sensitive: 'credit_limit',
  },
  {
    name: '⑮ unsupported operator',
    site: 'compileOperator: unsupported operator',
    filter: { owner_email: { $regex: 'admin@' } },
    message: /unsupported operator "\$regex" on "owner_email" \(fail-closed\)/,
    sensitive: 'owner_email',
  },
];

/**
 * Read scopes that must keep COMPILING, with the SQL they compile to.
 *
 * The other half of "only the envelope moved": a refusal-shape edit that
 * accidentally widened the refusal shows up here as a throw, and one that changed
 * the lowering shows up as a SQL mismatch. Both green before and after #5367.
 */
const ACCEPTED: Array<{ name: string; filter: unknown; sql: string; params: unknown[] }> = [
  {
    name: 'implicit equality',
    filter: { owner_id: 'u1' },
    sql: '"crm_opportunity"."owner_id" = ?',
    params: ['u1'],
  },
  {
    name: 'an $in with an array',
    filter: { region_code: { $in: ['emea', 'apac'] } },
    sql: '"crm_opportunity"."region_code" IN (?, ?)',
    params: ['emea', 'apac'],
  },
  {
    // [#13571] STAYS accepted while the empty `$nin` refuses (REFUSALS ⑬):
    // this constant is FALSE — narrowing at its own arm — and the RLS compiler
    // deliberately emits the shape at positive polarity inside composites
    // (#13570's "own rows keep flowing" pin), so refusing it here would 500 a
    // live, ruled-correct scope. The asymmetry is the #13571 ruling itself.
    name: 'an empty $in as the FALSE constant (#5243)',
    filter: { region_code: { $in: [] } },
    sql: '1 = 0',
    params: [],
  },
  {
    name: 'an empty $and as TRUE (#5322)',
    filter: { $and: [] },
    sql: '',
    params: [],
  },
  {
    name: 'an empty $or as the FALSE constant (#5322)',
    filter: { $or: [] },
    sql: '1 = 0',
    params: [],
  },
  {
    name: 'a $not of {} as FALSE (#5297)',
    filter: { $not: {} },
    sql: '1 = 0',
    params: [],
  },
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#5367] the read-scope refusal SET is unchanged — only the error shape moved', () => {
  for (const c of REFUSALS) {
    it(`still REFUSES: ${c.name} (${c.site})`, () => {
      const err = refusalFor(c.filter, c.alias);
      expect(err, `${c.name} was accepted — a read scope must never be silently dropped`).toBeInstanceOf(Error);
      expect(String(err?.message)).toMatch(c.message);
    });
  }

  for (const c of ACCEPTED) {
    it(`still ACCEPTS (and lowers identically): ${c.name}`, () => {
      const out = compileScopedFilterToSql(c.filter as never, 'crm_opportunity');
      expect(out.sql).toBe(c.sql);
      expect(out.params).toEqual(c.params);
    });
  }
});

describe('[#5367] every read-scope refusal carries the ADR-0112 envelope (READ_SCOPE_COMPILE_FAILED / 500)', () => {
  for (const c of REFUSALS) {
    it(`${c.name} → code READ_SCOPE_COMPILE_FAILED, status 500`, () => {
      const err = refusalFor(c.filter, c.alias);
      expect(err).toBeInstanceOf(Error);
      expect(err?.code).toBe('READ_SCOPE_COMPILE_FAILED');
      // 500, not any 4xx: the caller cannot fix an administrator's policy, and a
      // 4xx would both misattribute the fault and put the policy in their body.
      expect(err?.status).toBe(500);
      expect(err?.code).not.toBe('DATASET_INVALID');
    });
  }

  it('covers every refusing site in the module — no half-envelope', () => {
    // #5352's lesson, stated as a guard: seven of `filter-normalizer.ts`'s nine
    // sites carrying an envelope was indistinguishable from none of them at the
    // HTTP boundary, because the commonest input hit one of the two bare ones.
    // Fifteen inputs over the module's THIRTEEN throw sites (see the table's
    // note on the two sites with two triggers each), and every one of them
    // enveloped. [#6125] added the eleventh site, [#6387] the twelfth, and
    // [#13571] the thirteenth (the empty-`$nin` refusal); these two numbers
    // are the ratchet that makes a future unenveloped `throw` fail HERE instead
    // of at an HTTP boundary.
    expect(REFUSALS).toHaveLength(15);
    expect(new Set(REFUSALS.map((c) => c.site)).size).toBe(13);
    for (const c of REFUSALS) {
      expect(refusalFor(c.filter, c.alias)?.code, `${c.site} is still bare`).toBe('READ_SCOPE_COMPILE_FAILED');
    }
  });

  it('the alias/field split answers ONE verdict — option C collapsed by the ruling', () => {
    // The two `quoteIdent` rows have different triggers (our own generated alias
    // vs the admin's policy field) and, under option B, identical verdicts. If a
    // later change wants to distinguish them it has to change this line, which is
    // the point: the collapse is a recorded decision, not an oversight.
    const [aliasRow, fieldRow] = REFUSALS;
    const a = refusalFor(aliasRow.filter, aliasRow.alias);
    const f = refusalFor(fieldRow.filter, fieldRow.alias);
    expect([a?.code, a?.status]).toEqual([f?.code, f?.status]);
    expect([a?.code, a?.status]).toEqual(['READ_SCOPE_COMPILE_FAILED', 500]);
  });

  it('the messages DO name policy internals — which is why the boundary withholds them', () => {
    // Not a style note: this is the input to the disclosure half of the fix. Each
    // `sensitive` string is something a tenant must not be able to read out of an
    // error body, and it IS in the message (the operator needs it in the log).
    // `packages/rest`'s boundary test asserts none of it reaches the response.
    for (const c of REFUSALS.filter((r) => r.sensitive !== '')) {
      expect(String(refusalFor(c.filter, c.alias)?.message), c.name).toContain(c.sensitive);
    }
  });
});
