// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// R15 `field/missing-value-domain`: a `text` field named like a currency,
// country or time-zone code that declares no `valueDomain` is warned, with a
// fix naming the domain to add. The word list is the spec's one copy
// (`VALUE_DOMAIN_FIELD_NAMES`), so these cases read it rather than retype it.

import { describe, expect, it } from 'vitest';

import { VALUE_DOMAIN_FIELD_NAMES } from '@objectstack/spec/shared';

import * as indexBarrel from './index.js';
import { FIELD_MISSING_VALUE_DOMAIN, lintDataModel, type LintIssue } from './data-model-rules.js';
import { explainRule } from './rule-explanations.js';

const objectWith = (fields: Record<string, unknown>) => [
  { name: 'acme_party', nameField: 'name', fields: { name: { type: 'text' }, ...fields } },
];

const hits = (fields: Record<string, unknown>): LintIssue[] =>
  lintDataModel(objectWith(fields)).filter((i) => i.rule === FIELD_MISSING_VALUE_DOMAIN);

const CASES = Object.entries(VALUE_DOMAIN_FIELD_NAMES).flatMap(([domain, names]) =>
  names.map((name) => [name, domain] as const),
);

describe('field/missing-value-domain', () => {
  it('is published from the root barrel under its constant', () => {
    expect(FIELD_MISSING_VALUE_DOMAIN).toBe('field/missing-value-domain');
    expect(indexBarrel.FIELD_MISSING_VALUE_DOMAIN).toBe(FIELD_MISSING_VALUE_DOMAIN);
  });

  it('covers every word of the spec list (seven names over three domains)', () => {
    expect(CASES).toHaveLength(7);
    expect(new Set(CASES.map(([, d]) => d))).toEqual(
      new Set(['iso_4217_currency', 'iso_3166_alpha2', 'iana_time_zone']),
    );
  });

  it.each(CASES)('fires on a text field "%s" with no valueDomain, naming %s', (name, domain) => {
    const found = hits({ [name]: { type: 'text' } });
    expect(found).toHaveLength(1);
    const [issue] = found;
    expect(issue!.severity).toBe('warning');
    expect(issue!.path).toBe(`objects[0].fields.${name}.valueDomain`);
    expect(issue!.message).toContain(`"acme_party.${name}"`);
    expect(issue!.message).toContain(`named like a value of domain '${domain}'`);
    expect(issue!.fix).toContain(`\`valueDomain: '${domain}'\``);
  });

  it('compares the whole name case-insensitively', () => {
    expect(hits({ Country_Code: { type: 'text' } })[0]?.fix).toContain("valueDomain: 'iso_3166_alpha2'");
    expect(hits({ TZ: { type: 'text' } })[0]?.fix).toContain("valueDomain: 'iana_time_zone'");
  });

  it('fires on the array spelling of fields too', () => {
    const issues = lintDataModel([
      { name: 'acme_party', nameField: 'name', fields: [{ name: 'name', type: 'text' }, { name: 'currency', type: 'text' }] },
    ]).filter((i) => i.rule === FIELD_MISSING_VALUE_DOMAIN);
    expect(issues).toHaveLength(1);
  });

  it('does not fire on a field that already declares the domain', () => {
    for (const [name, domain] of CASES) {
      expect(hits({ [name]: { type: 'text', valueDomain: domain } }), name).toEqual([]);
    }
  });

  it('does not fire on a select field, or any non-text type, with a listed name', () => {
    expect(
      hits({ country: { type: 'select', options: [{ label: 'China', value: 'CN' }] } }),
    ).toEqual([]);
    for (const type of ['textarea', 'lookup', 'currency', 'formula', 'number']) {
      expect(hits({ currency: { type, reference: 'acme_currency' } }), type).toEqual([]);
    }
  });

  it('does not fire on a name outside the list', () => {
    for (const name of ['billing_country', 'currency_name', 'country_label', 'zone', 'timezone_offset', 'region']) {
      expect(hits({ [name]: { type: 'text' } }), name).toEqual([]);
    }
  });

  it('has an os explain entry that lists exactly the spec word list', () => {
    const text = explainRule(FIELD_MISSING_VALUE_DOMAIN)!.paragraphs.join('\n');
    const spelled = Object.entries(VALUE_DOMAIN_FIELD_NAMES)
      .map(([domain, names]) => `${names.map((n) => `\`${n}\``).join(', ')} (\`${domain}\`)`)
      .join('; ');
    expect(text).toContain(spelled);
  });
});
