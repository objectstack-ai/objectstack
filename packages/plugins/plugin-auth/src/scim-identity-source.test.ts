// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0135 D4 — the boot backfill's two read answers that no real-engine case
 * in `scim-deactivation-reconcile-user.test.ts` reaches: an absent
 * `sys_scim_subject` table is an answer (no directory ever provisioned a user
 * here), and every other read failure is reported to the caller. The marking
 * rule itself is pinned end to end, through the vendor's `POST /Users`, in that
 * file's `(h)` cases.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/objectql';
import { backfillScimProvisionedIdentitySource, type ScimIdentitySourceEngine } from './scim-identity-source.js';

function engineWhoseSubjectReadFails(error: unknown): ScimIdentitySourceEngine & { update: ReturnType<typeof vi.fn> } {
  return {
    find: vi.fn(async (object: string) => {
      if (object === 'sys_scim_subject') throw error;
      return [];
    }),
    update: vi.fn(async (_object: string, data: Record<string, unknown>, options?: Record<string, unknown>) => {
      // The real engine's three-way dispatch — a double looser than this is no double at all.
      assertEngineUpdateDispatch(data, options);
      return data;
    }),
  };
}

describe('[ADR-0135 D4] the SCIM identity-source backfill reads its subject table', () => {
  it('an absent sys_scim_subject table is no directory-provisioned user, and nothing is written', async () => {
    const engine = engineWhoseSubjectReadFails(new Error('no such table: sys_scim_subject'));
    await expect(backfillScimProvisionedIdentitySource(engine)).resolves.toEqual({ directoryProvisioned: 0, marked: 0 });
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('any other read failure reaches the caller instead of reading as zero users', async () => {
    const refusal = new Error('connection refused');
    const engine = engineWhoseSubjectReadFails(refusal);
    await expect(backfillScimProvisionedIdentitySource(engine)).rejects.toBe(refusal);
    expect(engine.update).not.toHaveBeenCalled();
  });

  it('a missing table named for ANOTHER relation is not read as an absent subject table', async () => {
    const engine = engineWhoseSubjectReadFails(new Error('no such table: main.sys_scim_user'));
    await expect(backfillScimProvisionedIdentitySource(engine)).rejects.toThrow('no such table');
  });
});
