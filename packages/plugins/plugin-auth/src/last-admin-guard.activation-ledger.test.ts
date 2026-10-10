// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3, ADR-0126 §4] The last-administrator guard's ledger half.
 *
 * The authorization resolver reads a permission set's deactivation from the
 * activation ledger (`sys_metadata_activation`), not from the set row, so a
 * ledger row switching `admin_full_access` off un-makes every grant-derived
 * platform administrator at once. `refuseLedgerSwitchingAdminOff` refuses that
 * write and passes every other one.
 */

import { describe, it, expect } from 'vitest';
import { refuseLedgerSwitchingAdminOff } from './last-admin-guard.js';

const engineWith = (rows: Array<Record<string, unknown>>) => {
  const reads: unknown[] = [];
  return {
    reads,
    async find(_object: string, query: any) {
      reads.push(query?.where);
      const where: Record<string, unknown> = query?.where ?? {};
      const matched = rows.filter((r) => Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$') || (v !== null && typeof v === 'object')) throw new Error(`fake engine: unsupported where '${k}'`);
        return r[k] === v;
      }));
      return typeof query?.limit === 'number' ? matched.slice(0, query.limit) : matched;
    },
  };
};

describe('[ADR-0131 D3] refuseLedgerSwitchingAdminOff', () => {
  it('refuses an insert switching admin_full_access off, the 0 spelling included', async () => {
    for (const active of [false, 0]) {
      await expect(
        refuseLedgerSwitchingAdminOff(engineWith([]), { metadata_type: 'permission', name: 'admin_full_access', active }, undefined),
      ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, object: 'sys_metadata_activation' });
    }
  });

  it('refuses an update by id whose stored row is admin_full_access', async () => {
    const engine = engineWith([{ id: 'act_1', metadata_type: 'permission', name: 'admin_full_access', active: true }]);
    await expect(refuseLedgerSwitchingAdminOff(engine, { active: false }, 'act_1')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(engine.reads).toEqual([{ id: 'act_1' }]);
  });

  it('refuses a switch-off whose target row cannot be read — fail closed', async () => {
    await expect(refuseLedgerSwitchingAdminOff(engineWith([]), { active: false }, 'act_gone')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('CONTROL — another set, a position, a flow, or switching admin_full_access ON pass with no read', async () => {
    const engine = engineWith([]);
    for (const data of [
      { metadata_type: 'permission', name: 'crm_full', active: false },
      { metadata_type: 'position', name: 'admin_full_access', active: false },
      { metadata_type: 'flow', name: 'admin_full_access', active: false },
      { metadata_type: 'permission', name: 'admin_full_access', active: true },
    ]) {
      await expect(refuseLedgerSwitchingAdminOff(engine, data, undefined)).resolves.toBeUndefined();
    }
    expect(engine.reads).toEqual([]);
  });
});
