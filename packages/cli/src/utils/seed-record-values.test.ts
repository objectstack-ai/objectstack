// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { cel } from '@objectstack/spec';
import { seedFile } from '@objectstack/spec/data';
import { judgeSeedRecordValues } from './seed-record-values.js';

/**
 * [#27259] `os validate` and `os build` judge each seed record value with the
 * insert write's value verdict (`validateInsertValues`), so a value the seed
 * load refuses is refused at authoring time, with the load's code and
 * sentence, located at the record's field. The load-side half of that claim
 * (the same code and sentence from a real seed load) is
 * `test/seed-record-values-load-parity.test.ts`.
 */

const LESSON_START = 'Budget is a currency amount: write it as a bare number';

const PROJECT = {
  name: 'proj_project',
  label: 'Project',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    budget: { type: 'currency', label: 'Budget' },
    hours: { type: 'number', label: 'Hours', min: 0 },
    stage: { type: 'select', label: 'Stage', options: [{ label: 'Open', value: 'open' }, { label: 'Done', value: 'done' }] },
    tags: { type: 'multiselect', label: 'Tags', options: [{ label: 'Alpha', value: 'alpha' }, { label: 'Beta', value: 'beta' }] },
    industry: { type: 'select', label: 'Industry', picklist: 'industry' },
    sector: { type: 'select', label: 'Sector', picklist: 'sector_elsewhere' },
    owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
    due: { type: 'date', label: 'Due' },
    brief: { type: 'file', label: 'Brief' },
  },
};

const INDUSTRY = { name: 'industry', label: 'Industry', options: [{ label: 'Tech', value: 'tech' }] };

function stackWith(records: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return {
    objects: [PROJECT],
    picklists: [INDUSTRY],
    data: [{ object: 'proj_project', records }],
    ...extra,
  };
}

describe('[#27259] judgeSeedRecordValues — the seed load\'s value verdict at authoring time', () => {
  it('refuses a currency written as an object, with the currency lesson, located at the record\'s field', () => {
    const issues = judgeSeedRecordValues(stackWith([
      { name: 'Alpha', budget: 10 },
      { name: 'Beta', budget: { value: 10, currency: 'USD' } },
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      location: 'data[0].records[1].budget',
      object: 'proj_project',
      field: 'budget',
      code: 'invalid_number',
    });
    expect(issues[0].message.startsWith(LESSON_START)).toBe(true);
    expect(issues[0].message).toContain('currencyConfig');
  });

  it('passes a bare number on the currency field', () => {
    expect(judgeSeedRecordValues(stackWith([{ name: 'Alpha', budget: 10 }]))).toEqual([]);
  });

  it('passes a value the load accepts after its rewrite: a numeric string, a blank, a scalar on a multi-value field', () => {
    expect(judgeSeedRecordValues(stackWith([
      { name: 'Alpha', budget: '10', hours: '2.5', due: '', tags: 'alpha' },
    ]))).toEqual([]);
  });

  it('refuses what the load refuses about a value: an unreadable number, a bound, an option, a date', () => {
    const issues = judgeSeedRecordValues(stackWith([
      { name: 'Alpha', hours: 'abc', stage: 'archived', due: 'yesterday' },
      { name: 'Beta', hours: -1, tags: ['alpha', 'zzz'] },
    ]));
    expect(issues.map((i) => [i.location, i.code])).toEqual([
      ['data[0].records[0].hours', 'invalid_number'],
      ['data[0].records[0].stage', 'invalid_option'],
      ['data[0].records[0].due', 'invalid_date'],
      ['data[0].records[1].hours', 'min_value'],
      ['data[0].records[1].tags', 'invalid_option'],
    ]);
  });

  it('judges a picklist-bound field against the options the stack\'s picklist resolves', () => {
    expect(judgeSeedRecordValues(stackWith([{ name: 'Alpha', industry: 'tech' }]))).toEqual([]);
    const issues = judgeSeedRecordValues(stackWith([{ name: 'Alpha', industry: 'retail' }]));
    expect(issues.map((i) => [i.field, i.code])).toEqual([['industry', 'invalid_option']]);
  });

  it('leaves to the load what it rewrites or a deployment decides: an expression, a seed file, a reference, a file, a list declared elsewhere', () => {
    expect(judgeSeedRecordValues(stackWith([
      {
        name: 'Alpha',
        hours: cel`1 + 1`,
        due: cel`daysFromNow(3)`,
        brief: seedFile('fixtures/brief.pdf'),
        owner: 'admin@example.com',
        sector: 'anything',
      },
    ]))).toEqual([]);
  });

  it('does not judge `required`: a row missing a required value is the load\'s (defaults and hooks may fill it)', () => {
    expect(judgeSeedRecordValues(stackWith([{ budget: 5 }, { name: null, budget: 6 }]))).toEqual([]);
  });

  it('CONTROL: a field the object does not declare gets no answer from this check', () => {
    expect(judgeSeedRecordValues(stackWith([{ name: 'Alpha', no_such_field: { value: 10 } }]))).toEqual([]);
  });

  it('CONTROL: a dataset for an object the stack does not declare is not judged', () => {
    expect(judgeSeedRecordValues({
      objects: [PROJECT],
      data: [{ object: 'sys_business_unit', records: [{ name: 'HQ', budget: { value: 1 } }] }],
    })).toEqual([]);
  });

  it('judges a package body\'s datasets against every package\'s objects, located where they sit', () => {
    const issues = judgeSeedRecordValues({
      packages: [
        { manifest: { id: 'com.example.core', name: 'core', version: '1.0.0', type: 'app', objects: [PROJECT] } },
        { manifest: { id: 'com.example.seed', name: 'seed', version: '1.0.0', type: 'app', data: [{ object: 'proj_project', records: [{ name: 'A', budget: { value: 1, currency: 'EUR' } }] }] } },
      ],
    });
    expect(issues.map((i) => [i.location, i.code])).toEqual([['packages[1].manifest.data[0].records[0].budget', 'invalid_number']]);
  });

  it('reads only: the stack it is handed is unchanged', () => {
    const stack = stackWith([{ name: 'Alpha', budget: '10', tags: 'alpha', due: '' }]);
    const before = JSON.stringify(stack);
    judgeSeedRecordValues(stack);
    expect(JSON.stringify(stack)).toBe(before);
  });
});
