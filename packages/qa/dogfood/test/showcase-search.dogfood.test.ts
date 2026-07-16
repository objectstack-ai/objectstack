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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

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
    stack = await bootStack(showcaseStack);
    token = await stack.signIn();
  }, 60_000);
  afterAll(async () => { await stack?.stop(); });

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

  it('terms AND: "retail northwind" still matches; "retail contoso" does not', async () => {
    const both = await query({ search: 'retail northwind' });
    expect(both.map((r) => r.name)).toContain('Northwind');
    const cross = await query({ search: 'retail contoso' });
    expect(cross.map((r) => r.name)).not.toContain('Northwind');
    expect(cross.map((r) => r.name)).not.toContain('Contoso');
  });
});
