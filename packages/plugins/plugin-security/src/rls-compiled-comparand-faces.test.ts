// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20212] `RLSCompiler.compileFilter` runs the platform's two shared comparand
 * faces (`assertListComparandShapes`, `normalizeFilterComparandTypes`,
 * `@objectstack/spec/data`) on every compiled policy filter, for `using` and
 * `check` alike, with or without a field guard.
 *
 * What these pins hold, unit-side (the real-stack half is
 * `rls-null-comparand-fails-closed.test.ts`):
 *  1. a policy whose compiled filter the faces refuse is DROPPED onto the
 *     per-request fail-closed route: alone, the clause answers `RLS_DENY_FILTER`
 *     and one `DENY (fail closed)` WARN carrying `reason: 'refused-comparand'`;
 *  2. beside a granting sibling it vanishes from the OR in silence, exactly as a
 *     per-request refusal does;
 *  3. every other compiled filter passes through unchanged: the faces add
 *     nothing to a filter they accept (they return it by reference).
 */

import { describe, it, expect, vi } from 'vitest';
import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { compileCelToFilter } from '@objectstack/formula';
import { lowerFilterCondition } from '@objectstack/spec/data';

import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';

type WarnCall = [string, Record<string, unknown>?];

function compilerWithLogger() {
  const warn = vi.fn();
  const compiler = new RLSCompiler();
  compiler.setLogger({ warn });
  return { compiler, warn };
}

function policy(clause: 'using' | 'check', predicate: string, name = 'status_scope'): RowLevelSecurityPolicy {
  return { name, object: 'ticket', operation: 'all', [clause]: predicate } as RowLevelSecurityPolicy;
}

const CTX = {
  userId: 'u1',
  tenantId: 'org-1',
  positions: ['p_sales'],
  org_user_ids: ['u1', 'u2'],
  email: 'u1@example.com',
} as never;

/** The field guard the plugin passes when the schema resolves. */
const GUARD = { declared: new Set(['id', 'status', 'owner', 'score']) };

const NULL_FAMILY = [
  "!(record.status in ['open', null])",
  "record.status in ['open', null]",
  'record.status > null',
  'record.status >= null',
  'record.status < null',
  'record.status <= null',
  'record.status in [null]',
] as const;

describe('[#20212] a compiled filter the shared faces refuse is dropped, fail closed', () => {
  for (const clause of ['using', 'check'] as const) {
    for (const guard of [undefined, GUARD]) {
      for (const predicate of NULL_FAMILY) {
        it(`${clause} \`${predicate}\` (${guard ? 'with' : 'without'} a field guard) → RLS_DENY_FILTER, one refused-comparand WARN`, () => {
          const { compiler, warn } = compilerWithLogger();

          const filter = compiler.compileFilter([policy(clause, predicate)], CTX, clause, guard);

          expect(filter).toBe(RLS_DENY_FILTER);
          expect(warn).toHaveBeenCalledTimes(1);
          const [message, meta] = warn.mock.calls[0] as WarnCall;
          expect(message.startsWith('[RLS] DENY (fail closed)')).toBe(true);
          expect(meta).toMatchObject({
            object: 'ticket',
            policy: 'status_scope',
            clause,
            reason: 'refused-comparand',
            filter: RLS_DENY_FILTER.id,
          });
          expect(String(meta?.detail)).toContain('INVALID_FILTER');
        });
      }
    }
  }

  it('beside a granting sibling the refused policy vanishes from the OR, with no WARN, like a per-request refusal', () => {
    for (const clause of ['using', 'check'] as const) {
      const results: unknown[] = [];
      for (const refused of [NULL_FAMILY[0], 'record.status == current_user.positions']) {
        const { compiler, warn } = compilerWithLogger();
        const filter = compiler.compileFilter(
          [policy(clause, refused, 'refused'), policy(clause, "record.status == 'open'", 'sibling')],
          CTX,
          clause,
          GUARD,
        );
        results.push({ filter, warned: warn.mock.calls.length });
      }
      expect(results, clause).toEqual([
        { filter: { status: 'open' }, warned: 0 },
        { filter: { status: 'open' }, warned: 0 },
      ]);
    }
  });

  it('two refused policies deny with one line each', () => {
    const { compiler, warn } = compilerWithLogger();
    const filter = compiler.compileFilter(
      [policy('using', 'record.status > null', 'a'), policy('using', 'record.status in [null]', 'b')],
      CTX,
    );
    expect(filter).toBe(RLS_DENY_FILTER);
    expect((warn.mock.calls as WarnCall[]).map(([, meta]) => [meta?.policy, meta?.reason])).toEqual([
      ['a', 'refused-comparand'],
      ['b', 'refused-comparand'],
    ]);
  });
});

describe('[#20212] CONTROL — a compiled filter the faces accept passes through unchanged', () => {
  const ACCEPTED = [
    "record.status == 'open'",
    "record.status != 'open'",
    "record.status in ['open', 'pending']",
    "!(record.status in ['open', 'pending'])",
    'record.score > 2',
    'record.score <= 2',
    'record.score >= 1 && record.score < 5',
    'record.status == null',
    'record.status != null',
    "record.status.startsWith('op')",
    "record.status.endsWith('ed')",
    "record.status.contains('lose')",
    'record.owner in current_user.org_user_ids',
    '!(record.owner in current_user.org_user_ids)',
    'record.owner == current_user.id',
    'record.owner != current_user.id',
    'record.owner == current_user.email',
    "record.status == 'open' || record.owner == current_user.id",
  ];

  for (const clause of ['using', 'check'] as const) {
    for (const predicate of ACCEPTED) {
      it(`${clause} \`${predicate}\``, () => {
        const { compiler, warn } = compilerWithLogger();
        const compiled = compileCelToFilter(predicate, {
          variables: {
            current_user: { id: 'u1', organization_id: 'org-1', positions: ['p_sales'], org_user_ids: ['u1', 'u2'], email: 'u1@example.com' },
          },
        });
        expect(compiled.ok, predicate).toBe(true);

        const filter = compiler.compileFilter([policy(clause, predicate)], CTX, clause, GUARD);

        // [ADR-0053 D-D1, amended — #5930] The faces pass the compiled filter
        // through unchanged; what the seam hands on is the shared lowering of
        // it (the NULL-polarity guards — this GUARD declares no `datetime`
        // column, so the whole-day rule reads none), and nothing else.
        expect(filter).toEqual(compiled.ok ? lowerFilterCondition(compiled.filter, { isDatetimeColumn: () => false }) : undefined);
        expect(warn).not.toHaveBeenCalled();
      });
    }
  }
});
