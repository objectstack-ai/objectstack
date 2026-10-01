// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0053 D-D1, amended 2026-09-30 — #5930] The RLS compile seam's placement
 * of the shared `FilterCondition → FilterCondition` lowering
 * (`lowerFilterCondition`, `@objectstack/spec/data`): run once on every compiled
 * policy filter, right after the two comparand faces (`judgeCompiledComparands`),
 * for `using` and `check` alike — so the read scope's drivers and the write
 * check's evaluator receive one lowered filter.
 *
 * Column-type scope (the amendment's item 7): the seam reads the declared
 * `datetime` columns its caller hands it (`RlsFieldGuard.datetime`), so the
 * whole-day rule rewrites those only — the scope every driver holds — and a
 * guard without types cannot read the type, so the rule applies type-blind
 * (#20822; the no-guard half is pinned in
 * `rls-20822-no-guard-type-blind-lowering.test.ts`). The NULL-polarity guards
 * do not depend on the type.
 *
 * Token order (item 3): nothing resolves a placeholder on either RLS clause —
 * measured: a policy comparand `'{today}'` compiles and reaches both consumers
 * verbatim. The lowering reads it as the non-day string it is and leaves it as
 * written, which is what every face does with it today.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet, RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { RLSCompiler } from './rls-compiler.js';
import { SecurityPlugin } from './security-plugin.js';

const CTX = { userId: 'u1', tenantId: 'org-1', positions: [] } as any;

const DECLARED = new Set(['id', 'stage', 'signed_on', 'due_on']);
/** The typed guard: `signed_on` is the one declared `datetime`. */
const TYPED_GUARD = { declared: DECLARED, datetime: new Set(['signed_on']) };

const policy = (clause: 'using' | 'check', predicate: string): RowLevelSecurityPolicy =>
  ({ name: 'p', object: 'contract', operation: 'all', [clause]: predicate }) as unknown as RowLevelSecurityPolicy;

const compile = (clause: 'using' | 'check', predicate: string, guard: any = TYPED_GUARD) =>
  new RLSCompiler().compileFilter([policy(clause, predicate)], CTX, clause, guard);

describe('[ADR-0053 D-D1 amended — #5930] the RLS compile seam lowers every compiled policy filter', () => {
  for (const clause of ['using', 'check'] as const) {
    it(`${clause}: a bare-day upper bound on a declared datetime becomes $lt the next day`, () => {
      expect(compile(clause, "record.signed_on <= '2026-01-05'")).toEqual({ signed_on: { $lt: '2026-01-06' } });
    });

    it(`${clause}: the last supported day keeps only { $null: false }`, () => {
      expect(compile(clause, "record.signed_on <= '9999-12-31'")).toEqual({ signed_on: { $null: false } });
    });

    it(`${clause}: a column the guard does not type as datetime is left byte-identical`, () => {
      expect(compile(clause, "record.due_on <= '2026-01-05'")).toEqual({ due_on: { $lte: '2026-01-05' } });
    });

    it(`${clause}: a guard with no types cannot read the type, so the rule applies type-blind (#20822)`, () => {
      expect(compile(clause, "record.signed_on <= '2026-01-05'", { declared: DECLARED }))
        .toEqual({ signed_on: { $lt: '2026-01-06' } });
    });

    it(`${clause}: the NULL-polarity guards apply whatever the type`, () => {
      expect(compile(clause, "record.stage != 'won'"))
        .toEqual({ $and: [{ $or: [{ stage: { $null: true } }, { stage: { $ne: 'won' } }] }] });
      expect(compile(clause, "!(record.stage == 'won')"))
        .toEqual({ $not: { $and: [{ stage: { $null: false } }, { stage: 'won' }] } });
    });

    it(`${clause}: an unresolved '{today}' reaches the seam verbatim and is left as written`, () => {
      expect(compile(clause, "record.signed_on <= '{today}'")).toEqual({ signed_on: { $lte: '{today}' } });
    });
  }
});

const CONTRACT_SCHEMA = {
  name: 'contract',
  fields: {
    stage: { type: 'text' },
    signed_on: { type: 'datetime' },
    due_on: { type: 'date' },
  },
};

const MEMBER_WITH_POLICY: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  rowLevelSecurity: [
    {
      name: 'signed_through_jan_5',
      object: 'contract',
      operation: 'all',
      using: "record.signed_on <= '2026-01-05' && record.due_on <= '2026-01-05'",
      check: "record.signed_on <= '2026-01-05' && record.due_on <= '2026-01-05'",
    },
  ],
} as unknown as PermissionSet;

async function bootWithSchema(schema: Record<string, unknown>) {
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: { registerMiddleware: vi.fn(), getSchema: () => schema, findOne: vi.fn(async () => null) },
    metadata: { get: async () => schema, list: async () => [MEMBER_WITH_POLICY] },
    'org-scoping': { name: 'com.objectstack.org-scoping' },
  };
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  return plugin;
}

/** The lowered policy: the datetime column widened, the date column untouched. */
const LOWERED_POLICY = {
  $and: [{ signed_on: { $lt: '2026-01-06' } }, { due_on: { $lte: '2026-01-05' } }],
};

describe('[ADR-0053 D-D1 amended — #5930] SecurityPlugin hands the seam the declared datetime columns', () => {
  it('using (the read scope): the datetime column is lowered, the date column is not', async () => {
    const plugin = await bootWithSchema(CONTRACT_SCHEMA);
    const filter = await (plugin as any).getReadFilter('contract', CTX);
    expect(JSON.stringify(filter)).toContain(JSON.stringify(LOWERED_POLICY));
  });

  it('check (the write gate): the same lowered filter', async () => {
    const plugin = await bootWithSchema(CONTRACT_SCHEMA);
    const filter = await (plugin as any).computeWriteCheckFilter([MEMBER_WITH_POLICY], 'contract', 'insert', CTX);
    expect(filter).toEqual(LOWERED_POLICY);
  });
});
