// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FLOW_CEL_ENGINE_BOUND_ROOTS, findUnknownRefs, scopeRoots } from './flow-ref-check';
import type { ScopeRef } from './flow-scope';

const roots = (...tokens: string[]) =>
  scopeRoots(tokens.map((t) => ({ token: t, label: t, group: 'variables' }) as ScopeRef));

describe('scopeRoots', () => {
  it('reduces ref tokens to their path roots, de-duped', () => {
    const s = roots('lead_score', 'record', 'record.email', 'record.account');
    expect([...s].sort()).toEqual(['lead_score', 'record']);
  });
});

describe('findUnknownRefs (predicate)', () => {
  const known = roots('lead_score', 'record', 'previous', 'account_data');

  it('accepts in-scope roots and any path under them', () => {
    expect(findUnknownRefs('lead_score >= 60', 'predicate', known)).toEqual([]);
    expect(findUnknownRefs('record.email != null && previous.status == "x"', 'predicate', known)).toEqual([]);
    expect(findUnknownRefs('account_data.annual_revenue > 1000', 'predicate', known)).toEqual([]);
  });

  it('flags a typo with a nearest-match suggestion', () => {
    const u = findUnknownRefs('recrod.email != null', 'predicate', known);
    expect(u).toHaveLength(1);
    expect(u[0]).toEqual({ token: 'recrod', suggestion: 'record' });
  });

  it('flags a genuinely unknown ref with no close match (no suggestion)', () => {
    const u = findUnknownRefs('discount_pct > 30', 'predicate', known);
    expect(u.map((x) => x.token)).toEqual(['discount_pct']);
    expect(u[0].suggestion).toBeUndefined();
  });

  it('skips function / macro calls', () => {
    expect(findUnknownRefs('daysFromNow(90) > record.close_date', 'predicate', known)).toEqual([]);
    expect(findUnknownRefs('has(record.x) && size(account_data) > 0', 'predicate', known)).toEqual([]);
  });

  it('skips runtime globals and $-prefixed roots', () => {
    expect(findUnknownRefs('env.KEY != "" && $error.message == null', 'predicate', known)).toEqual([]);
    expect(findUnknownRefs('data.lead_score > 0', 'predicate', known)).toEqual([]);
  });

  it('ignores identifiers inside string literals', () => {
    expect(findUnknownRefs('record.status == "qualifying"', 'predicate', known)).toEqual([]);
    // a bareword that only appears inside a string is not a reference
    expect(findUnknownRefs('record.stage == "discount_pct"', 'predicate', known)).toEqual([]);
  });

  it('only checks the root, never members', () => {
    // `email` is a member of the in-scope `record`; never flagged on its own.
    expect(findUnknownRefs('record.email.bogus', 'predicate', known)).toEqual([]);
  });

  it('skips CEL keywords/literals', () => {
    expect(findUnknownRefs('record.active == true && record.x != null', 'predicate', known)).toEqual([]);
  });

  it('returns nothing when scope is unknown (empty roots)', () => {
    expect(findUnknownRefs('totally_made_up', 'predicate', new Set())).toEqual([]);
  });

  it('de-dupes a repeated unknown root', () => {
    const u = findUnknownRefs('foo > 1 && foo < 9', 'predicate', known);
    expect(u.map((x) => x.token)).toEqual(['foo']);
  });
});

describe('findUnknownRefs (CEL comprehension macros bind their iteration variable) (objectui#10538)', () => {
  const known = new Set(['rows']);
  const cel = (source: string) => findUnknownRefs({ dialect: 'cel', source }, 'value', known);

  it("accepts the spec's canonical assignment-value example", () => {
    // The `AssignmentValue` JSDoc in @objectstack/spec: "joinNonEmpty(rows.map(r, r.subject), "\n")".
    expect(cel('joinNonEmpty(rows.map(r, r.subject), "\\n")')).toEqual([]);
  });

  it('binds the iteration variable of each of the five macros inside that macro', () => {
    expect(cel('rows.map(r, r.subject)')).toEqual([]);
    expect(cel('rows.map(r, r.active, r.subject)')).toEqual([]);
    expect(cel('rows.filter(x, x.done).size()')).toEqual([]);
    expect(cel('rows.exists(e, e.a > 1)')).toEqual([]);
    expect(cel('rows.all(a, a.ok)')).toEqual([]);
    expect(cel('rows.exists_one(o, o.id == 1)')).toEqual([]);
  });

  it('binds both variables of a nested macro', () => {
    expect(cel('rows.map(r, r.items.filter(i, i.ok))')).toEqual([]);
  });

  it('still flags the same name used after the macro closes', () => {
    expect(cel('rows.map(r, r.subject) + r')).toEqual([{ token: 'r', suggestion: undefined }]);
  });

  it('still flags an inner variable used outside its own macro', () => {
    expect(cel('rows.map(r, r.items.filter(i, i.ok) + i)')).toEqual([{ token: 'i', suggestion: undefined }]);
  });

  it("still flags a bound variable used as a different macro's receiver", () => {
    expect(cel('rows.exists(r, r.ok) && r.items.all(i, i.ok)')).toEqual([{ token: 'r', suggestion: undefined }]);
  });

  it('still flags an unknown receiver root, with its suggestion', () => {
    expect(cel('rowz.map(r, r.subject)')).toEqual([{ token: 'rowz', suggestion: 'rows' }]);
  });

  it('binds nothing for a member call that is not one of the five macros', () => {
    expect(cel('rows.join(sep, other)').map((u) => u.token)).toEqual(['sep', 'other']);
  });
});

describe('findUnknownRefs (template)', () => {
  const known = roots('approval_path', 'record');

  it('only scans inside {…} holes', () => {
    expect(findUnknownRefs('Hello world, contact us', 'template', known)).toEqual([]);
    expect(findUnknownRefs('Path: {approval_path} for {record.name}', 'template', known)).toEqual([]);
  });

  it('flags an unknown reference inside a hole, with a suggestion', () => {
    const u = findUnknownRefs('Path: {aproval_path}', 'template', known);
    expect(u).toHaveLength(1);
    expect(u[0]).toEqual({ token: 'aproval_path', suggestion: 'approval_path' });
  });
});

describe('findUnknownRefs (CEL roles follow the engine-bound roots) (objectui#12499)', () => {
  // A scope that offers none of the engine-bound roots, so each pass below is
  // the engine-bound allow-list's doing, not the graph scope's.
  const known = roots('lead_score', 'record');

  it('mirrors the members of ENGINE_BOUND_ROOTS in objectstack packages/lint/src/flow-cel-root-scope.ts', () => {
    expect([...FLOW_CEL_ENGINE_BOUND_ROOTS].sort()).toEqual(['current_user', 'previous', 'vars']);
  });

  it.each(['predicate', 'value'] as const)('reports nothing for vars, current_user and previous in the %s role', (role) => {
    expect(findUnknownRefs('has(vars.campaignRecord) && vars.campaignRecord.status == "open"', role, known)).toEqual([]);
    expect(findUnknownRefs('vars["$error"] != null', role, known)).toEqual([]);
    expect(findUnknownRefs('current_user.id == record.owner', role, known)).toEqual([]);
    expect(findUnknownRefs('previous != null', role, known)).toEqual([]);
    expect(findUnknownRefs({ dialect: 'cel', source: 'previous.status != record.status' }, role, known)).toEqual([]);
  });

  it.each(['predicate', 'value'] as const)('reports user in the %s role, with current_user as the suggestion', (role) => {
    expect(findUnknownRefs('user.id == "u1"', role, known)).toEqual([{ token: 'user', suggestion: 'current_user' }]);
  });

  it('accepts user when the flow declares a variable of that name', () => {
    expect(findUnknownRefs('user.id == "u1"', 'predicate', roots('user', 'record'))).toEqual([]);
  });

  it('CONTROL: still reports an undeclared root beside the engine-bound ones', () => {
    expect(findUnknownRefs('vars.x && foo.bar', 'predicate', known)).toEqual([{ token: 'foo', suggestion: undefined }]);
  });

  it('leaves the template and hole roles on the runtime globals alone', () => {
    // The ruling keeps those roles' allow-list as it was; only the CEL roles moved.
    expect(findUnknownRefs('Hi {user.name}', 'template', known)).toEqual([]);
    expect(findUnknownRefs('Hi {{user.name}}', 'hole', known)).toEqual([]);
  });
});
