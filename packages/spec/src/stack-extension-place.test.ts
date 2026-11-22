// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35901] `defineStack` judges the two placement questions that need a
 * package's OBJECTS: a list placement (and a placed group's `relatedList`)
 * names a child object the extension's own package body defines and that
 * points at the extended object, and a placed group's key is not one of the
 * extended object's own. Refusals assert the ADR-0112 envelope and the named
 * subjects; every refusal row's control differs from it by one entry alone.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

type Refusal = Error & { code?: string; status?: number; issues?: readonly string[] };

const manifest = {
  id: 'com.example.xpl',
  namespace: 'xpl',
  name: 'xpl',
  version: '1.0.0',
  type: 'module' as const,
};

const account = {
  name: 'xpl_account',
  label: 'Account',
  fields: {
    name: { type: 'text' as const, label: 'Name', group: 'basic' },
    industry: { type: 'text' as const, label: 'Industry', group: 'basic' },
  },
  fieldGroups: [{ key: 'basic', label: 'Basic' }],
};
const opportunity = {
  name: 'xpl_opportunity',
  label: 'Opportunity',
  fields: { account_id: { type: 'lookup' as const, label: 'Account', reference: 'xpl_account' } },
};

/** The extension package: its own child object, and its extension of the account. */
const contract = {
  name: 'xplx_contract',
  label: 'Contract',
  fields: {
    account_id: { type: 'lookup' as const, label: 'Account', reference: 'xpl_account' },
    title: { type: 'text' as const, label: 'Title' },
  },
};
const memo = { name: 'xplx_memo', label: 'Memo', fields: { title: { type: 'text' as const, label: 'Title' } } };

const extensionPackage = (place: unknown[], objects: unknown[] = [contract, memo]) => ({
  manifest: {
    id: 'com.example.xpl-ext',
    namespace: 'xplx',
    name: 'xpl_ext',
    version: '1.0.0',
    type: 'module' as const,
    objects,
    objectExtensions: [{
      extend: 'xpl_account',
      fields: { tax_id: { type: 'text' as const, label: 'Tax ID' } },
      place,
    }],
  },
});

const stackWith = (place: unknown[], objects?: unknown[]) =>
  ({ manifest, objects: [account, opportunity], packages: [extensionPackage(place, objects)] }) as any;

const refusalOf = (fn: () => unknown): Refusal | undefined => {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
};

describe('defineStack — an extension places only a child list its own package brings', () => {
  it('accepts a list placement naming its own child that points at the extended object (control)', () => {
    expect(() => defineStack(stackWith([
      { field: 'tax_id', group: 'basic', after: 'industry' },
      { list: 'xplx_contract', after: 'xpl_opportunity' },
      { list: 'xplx_contract.account_id', before: 'sys_activity' },
    ]))).not.toThrow();
  });

  it('refuses a list of the extended object\'s package, naming it as not this package\'s', () => {
    const refusal = refusalOf(() => defineStack(stackWith([{ list: 'xpl_opportunity' }])));
    expect(refusal?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(typeof refusal?.status).toBe('number');
    expect(refusal?.issues).toHaveLength(1);
    expect(refusal?.issues?.[0]).toContain("place[0].list names 'xpl_opportunity', which is not a child object this package defines");
    expect(refusal?.issues?.[0]).toContain("The lists of 'xpl_account' and of other packages are arranged by their owners");
  });

  it('refuses its own object that does not point at the extended object, and a field that is not the FK', () => {
    const refusal = refusalOf(() => defineStack(stackWith([{ list: 'xplx_memo' }, { list: 'xplx_contract.title' }])));
    expect(refusal?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refusal?.issues).toHaveLength(2);
    expect(refusal?.issues?.[0]).toContain("'xplx_memo' has no lookup / master_detail field whose reference is 'xpl_account'");
    expect(refusal?.issues?.[1]).toContain("'xplx_contract.title' is not a lookup / master_detail field");
  });

  it('judges a placed group\'s relatedList the same way', () => {
    const refusal = refusalOf(() => defineStack(stackWith([
      { group: { key: 'deals', label: 'Deals', relatedList: 'xpl_opportunity' }, after: 'basic' },
    ])));
    expect(refusal?.issues).toHaveLength(1);
    expect(refusal?.issues?.[0]).toContain("place[0].group.relatedList names 'xpl_opportunity'");
  });
});

describe('defineStack — an extension adds a group of its own', () => {
  it('accepts a new group key (control)', () => {
    expect(() => defineStack(stackWith([{ group: { key: 'tax', label: 'Tax' }, after: 'basic' }]))).not.toThrow();
  });

  it('refuses a group key the extended object declares itself', () => {
    const refusal = refusalOf(() => defineStack(stackWith([{ group: { key: 'basic', label: 'Mine' } }])));
    expect(refusal?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refusal?.issues).toHaveLength(1);
    expect(refusal?.issues?.[0]).toContain("adds group 'basic', which is a group 'xpl_account' declares itself");
  });
});

describe('defineStack — a missing anchor is no refusal', () => {
  it('accepts anchors the extended object does not have (the merge puts the item at the end)', () => {
    expect(() => defineStack(stackWith([
      { field: 'tax_id', group: 'basic', after: 'gone' },
      { list: 'xplx_contract', after: 'xpl_nowhere' },
      { group: { key: 'tax', label: 'Tax' }, before: 'missing' },
    ]))).not.toThrow();
  });
});
