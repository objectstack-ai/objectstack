// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0061 §Conformance — the dogfood proof behind the search-conformance
// ledger: a MULTI-FIELD `$search` match over the REAL HTTP API. The ADR's own
// example, verbatim: searching "retail" must return an account matched by
// `industry`, not `name` (the showcase seed's Northwind row carries
// `industry: 'retail'` and no account name contains "retail"). Also proves
// the `$searchFields` narrowing (can only narrow, never widen) so the
// executor's security posture is pinned at the HTTP level, not just in
// `search-filter.test.ts` unit tests.

import { describe, it, expect, beforeAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { getSharedShowcase } from './shared-showcase.js';

describe('showcase: $search over the HTTP API (ADR-0061 conformance proof)', () => {
  let stack: VerifyStack;
  let token: string;

  const query = async (body: Record<string, unknown>) => {
    const res = await stack.apiAs(token, 'POST', '/data/showcase_account/query', body);
    expect(res.status).toBe(200);
    const data = await res.json();
    return (data?.data?.records ?? data?.records ?? []) as Array<Record<string, unknown>>;
  };

  beforeAll(async () => {
    stack = await getSharedShowcase();
    token = await stack.signIn();
  }, 60_000);

  it('multi-field match: "retail" returns Northwind via industry, not name', async () => {
    const records = await query({ search: 'retail' });
    const names = records.map((r) => String(r.name));
    expect(names).toContain('Northwind');
    // Guard the premise: Northwind's NAME does not contain "retail", so its
    // presence in the result can only come from a non-name field…
    expect(names.find((n) => n === 'Northwind')!.toLowerCase()).not.toContain('retail');
    // …and prove it positively: restricting the same search to `industry`
    // alone still returns Northwind — the hit IS the industry field.
    const viaIndustry = await query({ search: 'retail', searchFields: ['industry'] });
    expect(viaIndustry.map((r) => r.name)).toContain('Northwind');
    // (The seed also has an account literally NAMED "acme retail" — a useful
    // control: the unrestricted search returns it via `name`, proving the
    // cross-field OR spans both fields in one query.)
    expect(names.some((n) => n.toLowerCase().includes('retail'))).toBe(true);
  });

  it('select label→value mapping: the capitalized label "Retail" also matches', async () => {
    const records = await query({ search: 'Retail' });
    expect(records.map((r) => r.name)).toContain('Northwind');
  });

  it('$searchFields narrows: "retail" restricted to name matches nothing', async () => {
    const records = await query({ search: 'retail', searchFields: ['name'] });
    expect(records.map((r) => r.name)).not.toContain('Northwind');
  });

  /**
   * [#7641] The TEXTUAL case-fold, pinned away from the select path.
   *
   * This pin stayed green through the whole defect because its only case
   * assertion was the select LABEL above ("Retail" → Northwind), which passes
   * on a case-SENSITIVE build: `optionValuesMatching` lowercases both sides in
   * JS before emitting `$in`, so the label half never touches the operator.
   * The textual half does, and it was broken — `fieldClausesForTerm` emitted
   * `$contains`, which #4706 Q2 = A rules case-SENSITIVE.
   *
   * Narrowing to `['name']` is what makes this assertion load-bearing: it keeps
   * the label→value mapping out of the verdict, so the only thing that can
   * satisfy it is the operator folding case. Asserted over the real HTTP API,
   * so it covers the whole chain — compiler, engine, and the driver actually
   * executing `$icontains` — not just the emitted filter tree.
   */
  it('textual case-fold: "retail" and "Retail" both match the capitalized name "Acme Retail"', async () => {
    // The seed stores the name CAPITALIZED, so a lowercase term can only hit
    // via a case-insensitive operator. This is the exact HTTP repro from #7641.
    const lower = await query({ search: 'retail', searchFields: ['name'] });
    expect(lower.map((r) => r.name)).toContain('Acme Retail');
    // The capitalized spelling matched even on the broken build; asserting both
    // is what makes a regression read as "the fold went away" rather than "the
    // fixture moved".
    const upper = await query({ search: 'Retail', searchFields: ['name'] });
    expect(upper.map((r) => r.name)).toContain('Acme Retail');
    // Same rows either way — case is not allowed to change the result set.
    expect(lower.map((r) => r.name).sort()).toEqual(upper.map((r) => r.name).sort());
  });

  it('terms AND: "retail northwind" still matches; "retail contoso" does not', async () => {
    const both = await query({ search: 'retail northwind' });
    expect(both.map((r) => r.name)).toContain('Northwind');
    const cross = await query({ search: 'retail contoso' });
    expect(cross.map((r) => r.name)).not.toContain('Northwind');
    expect(cross.map((r) => r.name)).not.toContain('Contoso');
  });
});
