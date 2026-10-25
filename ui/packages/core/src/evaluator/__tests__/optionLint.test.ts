/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Build-time guardrail for cascading option predicates (#1583, #2284).
 */
import { describe, it, expect } from 'vitest';
import { lintOptionPredicates, type LintFieldLike } from '../optionLint';

/** country (cn/us) → province, the canonical cascade. */
function cascade(provinceOptions: Array<{ value: string; visibleWhen?: string }>): LintFieldLike[] {
  return [
    {
      name: 'country',
      type: 'select',
      options: [
        { label: 'China', value: 'cn' },
        { label: 'United States', value: 'us' },
      ],
    },
    {
      name: 'province',
      type: 'select',
      dependsOn: 'country',
      options: provinceOptions.map((o) => ({ label: o.value, value: o.value, visibleWhen: o.visibleWhen })),
    },
  ];
}

describe('lintOptionPredicates — clean predicates', () => {
  it('passes a correct country → province cascade', () => {
    const issues = lintOptionPredicates(
      cascade([
        { value: 'zj', visibleWhen: "record.country == 'cn'" },
        { value: 'ca', visibleWhen: "record.country == 'us'" },
        { value: 'other' }, // predicate-less → always offered, nothing to check
      ]),
    );
    expect(issues).toEqual([]);
  });

  it('passes an `in [...]` membership predicate whose literals are all in domain', () => {
    const issues = lintOptionPredicates(
      cascade([{ value: 'zj', visibleWhen: "record.country in ['cn', 'us']" }]),
    );
    expect(issues).toEqual([]);
  });

  it('leaves role/context predicates (current_user.*) untouched', () => {
    const issues = lintOptionPredicates([
      {
        name: 'tier',
        type: 'select',
        options: [
          { label: 'Standard', value: 'standard' },
          { label: 'Admin only', value: 'admin_only', visibleWhen: "'admin' in current_user.positions" },
        ],
      },
    ]);
    expect(issues).toEqual([]);
  });

  it('skips comparisons against a non-enum sibling (open domain)', () => {
    // `region` is free text — its domain is unknowable, so any literal is allowed.
    const issues = lintOptionPredicates([
      { name: 'region', type: 'text' },
      {
        name: 'city',
        type: 'select',
        dependsOn: 'region',
        options: [{ label: 'SF', value: 'sf', visibleWhen: "record.region == 'anything-goes'" }],
      },
    ]);
    expect(issues).toEqual([]);
  });

  it('returns [] for empty / missing field lists', () => {
    expect(lintOptionPredicates([])).toEqual([]);
    expect(lintOptionPredicates(null)).toEqual([]);
    expect(lintOptionPredicates(undefined)).toEqual([]);
  });
});

describe('lintOptionPredicates — the #2284 literal typo', () => {
  it('flags a literal outside the controlling enum domain (country == \'chna\')', () => {
    const issues = lintOptionPredicates(
      cascade([{ value: 'zj', visibleWhen: "record.country == 'chna'" }]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      field: 'province',
      option: 'zj',
      code: 'option-literal-not-in-domain',
    });
    expect(issues[0].message).toContain("'chna'");
    expect(issues[0].message).toContain("'cn'");
  });

  it('flags the mirrored operand order (\'chna\' == record.country)', () => {
    const issues = lintOptionPredicates(
      cascade([{ value: 'zj', visibleWhen: "'chna' == record.country" }]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('option-literal-not-in-domain');
  });

  it('flags a bad literal inside an `in [...]` list but not the good ones', () => {
    const issues = lintOptionPredicates(
      cascade([{ value: 'zj', visibleWhen: "record.country in ['cn', 'chna']" }]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("'chna'");
  });

  it('flags `!=` against an out-of-domain literal too', () => {
    const issues = lintOptionPredicates(
      cascade([{ value: 'zj', visibleWhen: "record.country != 'chna'" }]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('option-literal-not-in-domain');
  });
});

describe('lintOptionPredicates — unknown field & syntax', () => {
  it('flags a misspelled sibling field reference (record.contry)', () => {
    const issues = lintOptionPredicates(
      cascade([{ value: 'zj', visibleWhen: "record.contry == 'cn'" }]),
    );
    // `contry` is unknown; the literal check is skipped (no such enum domain).
    expect(issues.some((i) => i.code === 'unknown-field')).toBe(true);
    expect(issues.every((i) => i.code !== 'option-literal-not-in-domain')).toBe(true);
  });

  it('flags a CEL syntax error and stops deeper checks for that predicate', () => {
    // The classic `{ref}` brace mistake — `{…}` parses as a CEL map literal.
    const issues = lintOptionPredicates(
      cascade([{ value: 'zj', visibleWhen: "{record.country} == 'cn'" }]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('syntax');
  });

  it('reports one issue per faulty option, keyed by field + option value', () => {
    const issues = lintOptionPredicates(
      cascade([
        { value: 'zj', visibleWhen: "record.country == 'chna'" },
        { value: 'ca', visibleWhen: "record.country == 'usa'" },
        { value: 'ok', visibleWhen: "record.country == 'cn'" },
      ]),
    );
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.option).sort()).toEqual(['ca', 'zj']);
  });
});
