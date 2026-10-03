// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { absentTableReads, secretUnionReadView } from './absent-table-reads.js';
import type { SecretReferenceEngineLike } from './secret-reference-union.js';

/** A stack that measured exactly `tables` absent. */
const stackMissing = (...tables: string[]) => ({ tableAbsent: (name: string) => tables.includes(name) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('absentTableReads', () => {
  it('answers from the stack and records only the tables it answered true for', () => {
    const reads = absentTableReads(stackMissing('sys_secret', 'sys_file'));

    expect(reads.line()).toBeNull();
    expect(reads.absent('sys_secret')).toBe(true);
    expect(reads.absent('sys_setting')).toBe(false);
    expect(reads.absent('sys_file')).toBe(true);
    expect(reads.absent('sys_secret')).toBe(true);

    // Each table is named once, sorted, and the table that was read is not named.
    expect(reads.line()).toBe(
      '2 object(s) have no table in this database yet, so nothing is stored in them and they were not read: sys_file, sys_secret.',
    );
  });

  it('says nothing when no table was answered without a read', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reads = absentTableReads(stackMissing());

    expect(reads.absent('sys_secret')).toBe(false);
    reads.notice(true);
    reads.notice(false);

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('under --json the line goes to stderr and stdout stays a single document', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reads = absentTableReads(stackMissing('sys_file'));
    reads.absent('sys_file');

    reads.notice(true);

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('sys_file');
    expect(log).not.toHaveBeenCalled();
  });

  it('in human mode the line goes to stdout', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reads = absentTableReads(stackMissing('sys_file'));
    reads.absent('sys_file');

    reads.notice(false);

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain('sys_file');
    expect(error).not.toHaveBeenCalled();
  });
});

describe('secretUnionReadView', () => {
  function engineWith(overrides: Partial<SecretReferenceEngineLike> = {}) {
    const find = vi.fn(async (object: string) => [{ id: `${object}-row` }]);
    const getDriverForObject = vi.fn((_name: string) => ({ find }));
    const engine: SecretReferenceEngineLike = {
      getConfigs: () => ({}),
      getDriverForObject,
      ...overrides,
    };
    return { engine, find, getDriverForObject };
  }

  it('answers a read of an absent table with no rows, and never issues it', async () => {
    const { engine, find } = engineWith();
    const reads = absentTableReads(stackMissing('sys_setting'));
    const view = secretUnionReadView(engine, reads);

    await expect(view.getDriverForObject('sys_setting')!.find('sys_setting', {})).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
    expect(reads.line()).toContain('sys_setting');
  });

  it('still issues the read of a table the boot did not measure absent, and returns what it returned', async () => {
    const { engine, find } = engineWith();
    const view = secretUnionReadView(engine, absentTableReads(stackMissing('sys_setting')));

    await expect(view.getDriverForObject('sys_secret')!.find('sys_secret', { fields: ['id'] })).resolves.toEqual([
      { id: 'sys_secret-row' },
    ]);
    expect(find).toHaveBeenCalledWith('sys_secret', { fields: ['id'] }, undefined);
  });

  it('lets a refused read of a present table through: nothing is demoted to an empty answer', async () => {
    const refusal = new Error('The database refused to run this query');
    const { engine } = engineWith({
      getDriverForObject: () => ({ find: async () => { throw refusal; } }),
    });
    const view = secretUnionReadView(engine, absentTableReads(stackMissing('sys_setting')));

    await expect(view.getDriverForObject('sys_secret')!.find('sys_secret', {})).rejects.toBe(refusal);
  });

  it('keeps an object with no driver as no driver, so the union still gaps on it', () => {
    const { engine } = engineWith({ getDriverForObject: () => undefined });
    const view = secretUnionReadView(engine, absentTableReads(stackMissing()));

    expect(view.getDriverForObject('sys_secret')).toBeUndefined();
  });

  it('carries listDatasourceDefs only when the engine has it: its absence is a declared gap', () => {
    const without = secretUnionReadView(engineWith().engine, absentTableReads(stackMissing()));
    expect('listDatasourceDefs' in without).toBe(false);

    const defs = [{ name: 'ds' }];
    const withDefs = secretUnionReadView(
      engineWith({ listDatasourceDefs: () => defs }).engine,
      absentTableReads(stackMissing()),
    );
    expect(withDefs.listDatasourceDefs?.()).toEqual(defs);
  });

  it('reads the registered objects from the engine on every call', () => {
    const configs: ReturnType<SecretReferenceEngineLike['getConfigs']> = {};
    const { engine } = engineWith({ getConfigs: () => configs });
    const view = secretUnionReadView(engine, absentTableReads(stackMissing()));

    expect(view.getConfigs()).toBe(configs);
  });
});
