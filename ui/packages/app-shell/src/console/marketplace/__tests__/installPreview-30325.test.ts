// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `installPreviewOf` counts what a served package body adds the way the
 * install door reads that body (objectstack#30325): every package body of the
 * shapes the door accepts, `objects` as a list or a map, `permissions` only as
 * a LIST of sets (the manifest-stage capability grant is an object), sample
 * records from the top-level `data[]` the seed step loads, and each
 * `isDefault: true` set as an Everyone suggestion.
 */

import { describe, expect, it } from 'vitest';
import { installPreviewOf } from '../installPreview';

const records = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `r${i}` }));

describe('installPreviewOf (objectstack#30325)', () => {
  it('a flattened bundle: manifest nested, collections at the top', () => {
    expect(installPreviewOf({
      manifest: { id: 'app.acme.crm', version: '6.0.0', type: 'app', permissions: { network: { hosts: ['api.acme.test'] } } },
      objects: [{ name: 'crm_account' }, { name: 'crm_contact' }, { name: 'crm_lead' }],
      permissions: [
        { name: 'crm_user', label: 'CRM User', isDefault: true },
        { name: 'crm_admin', label: 'CRM Admin' },
      ],
      data: [
        { object: 'crm_account', externalId: 'name', records: records(4) },
        { object: 'crm_contact', externalId: 'email', records: records(3) },
      ],
    })).toEqual({ objects: 3, permissionSets: 2, sampleRecords: 7, sampleRecordsAtMost: false, suggestedGrants: ['crm_user'] });
  });

  it('a flat body whose only `permissions` is the capability grant counts no permission set', () => {
    expect(installPreviewOf({
      id: 'com.acme.tool', version: '1.0.0', type: 'plugin',
      permissions: { network: { hosts: ['x.test'] } },
      objects: { tool_item: { label: 'Item' }, tool_tag: { label: 'Tag' } },
    })).toEqual({ objects: 2, permissionSets: 0, sampleRecords: 0, sampleRecordsAtMost: false, suggestedGrants: [] });
  });

  it('a multi-package artifact: objects and sets of every package body', () => {
    expect(installPreviewOf({
      manifest: { id: 'app.acme.suite', version: '1.0.0', type: 'app' },
      packages: [
        { manifest: { id: 'app.acme.suite', type: 'app', objects: [{ name: 'a_one' }], permissions: [{ name: 'suite_user', isDefault: true }] } },
        { manifest: { id: 'app.acme.suite.extra', type: 'module', objects: [{ name: 'b_one' }, { name: 'b_two' }] } },
      ],
    })).toEqual({ objects: 3, permissionSets: 1, sampleRecords: 0, sampleRecordsAtMost: false, suggestedGrants: ['suite_user'] });
  });

  it('a dataset scoped by environment or locale makes the count an upper bound', () => {
    const env = installPreviewOf({ id: 'x', data: [{ object: 'o', env: ['dev'], records: records(2) }, { object: 'p', records: records(1) }] });
    expect(env).toMatchObject({ sampleRecords: 3, sampleRecordsAtMost: true });
    const locale = installPreviewOf({ id: 'x', data: [{ object: 'o', locale: ['zh-CN'], records: records(2) }] });
    expect(locale).toMatchObject({ sampleRecords: 2, sampleRecordsAtMost: true });
    const everywhere = installPreviewOf({ id: 'x', data: [{ object: 'o', env: ['prod', 'dev', 'test'], records: records(2) }] });
    expect(everywhere).toMatchObject({ sampleRecords: 2, sampleRecordsAtMost: false });
  });

  it('skips data entries the seed step skips: no object, or no records list', () => {
    expect(installPreviewOf({ id: 'x', data: [{ records: records(5) }, { object: 'o' }, { object: 'p', records: records(1) }] }))
      .toMatchObject({ sampleRecords: 1 });
  });

  it('not a package body: null, so the confirm says it could not read it', () => {
    expect(installPreviewOf(undefined)).toBeNull();
    expect(installPreviewOf('nope')).toBeNull();
    expect(installPreviewOf([])).toBeNull();
  });
});
