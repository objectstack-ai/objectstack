// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { withheldColumns, formatWithheldColumns } from './migrate-withheld-columns.js';

/** A served fold missing what a disabled extension adds, over a storage fold that keeps it. */
function fakeEngine(disabled: ReadonlySet<string>) {
  const ext = (pkg: string, fields: string[]) => ({
    packageId: pkg, ownership: 'extend', definition: { fields: Object.fromEntries(fields.map((f) => [f, {}])) },
  });
  const contributors = [
    { packageId: 'app', ownership: 'own', definition: { fields: { id: {}, name: {} } } },
    ext('off', ['a_off', 'b_off']),
    ext('on', ['c_on']),
  ];
  const all = ['id', 'name', 'a_off', 'b_off', 'c_on'];
  const served = all.filter((f) => !(disabled.has('off') && f.endsWith('_off')));
  const body = (names: string[]) => ({ fields: Object.fromEntries(names.map((f) => [f, { type: 'text' }])) });
  return {
    getObject: () => body(served),
    getConfigs: () => ({ acct: {} }),
    registry: {
      getStorageObject: () => body(all),
      getObjectContributors: () => contributors,
      isPackageDisabled: (id?: string) => id !== undefined && disabled.has(id),
    },
  };
}

describe('withheldColumns (#30626)', () => {
  it('names each field a disabled extension adds, with its package; an enabled one is not named', () => {
    expect(withheldColumns(fakeEngine(new Set(['off'])))).toEqual([
      { object: 'acct', field: 'a_off', packageId: 'off' },
      { object: 'acct', field: 'b_off', packageId: 'off' },
    ]);
    expect(withheldColumns(fakeEngine(new Set()))).toEqual([]);
  });

  it('a column rule narrows the list to the columns the walk would cover', () => {
    const select = (schema: any) => Object.keys(schema?.fields ?? {}).filter((f) => f.startsWith('a_')).map((name) => ({ name }));
    expect(withheldColumns(fakeEngine(new Set(['off'])), undefined, select).map((c) => c.field)).toEqual(['a_off']);
  });

  it('an engine without the registry surface names nothing', () => {
    expect(withheldColumns({ getObject: () => undefined, getConfigs: () => ({ acct: {} }) })).toEqual([]);
  });

  it('formats nothing for an empty list, a header and one line per column otherwise', () => {
    expect(formatWithheldColumns([])).toEqual([]);
    const lines = formatWithheldColumns([{ object: 'acct', field: 'a_off', packageId: 'off' }]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('acct.a_off');
    expect(lines[1]).toContain('off');
  });
});
