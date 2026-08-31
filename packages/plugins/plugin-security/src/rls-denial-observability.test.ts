// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13639] An RLS denial caused by an unresolved variable must leave a TRACE.
 *
 * The measured failure shape is the worst-shaped one an operator can be handed:
 * the user sees zero rows, no error is raised, nothing appears in the log, and
 * the built-in explanation tool says the policy "narrows" rather than "denies" —
 * every available signal points away from the cause. And the denial is
 * DELIBERATE (fail-closed working as designed), which is precisely why it needs
 * a trace: a correct refusal that is indistinguishable from "the data genuinely
 * doesn't match" costs hours, and the information that ends that search — the
 * variable path, the member index — was computed by `compileCelToFilter` and
 * then discarded one line before it could be used.
 *
 * What these pins hold, in the order the repair has to satisfy them:
 *  1. the refusal now LOGS, and the line carries the REASON (the variable path
 *     and the index), not merely the fact that something was dropped;
 *  2. the DECISION is byte-for-byte unmoved — `RLS_DENY_FILTER` still lands,
 *     `compileExpression` still returns `null`, the sentinel still excludes
 *     every record it is matched against. This is an observability change and
 *     nothing about the verdict may move;
 *  3. the negatives — a shape that correctly logged BEFORE still logs (exactly
 *     once, with its own message), a normal resolving expression logs nothing,
 *     and a dropped policy that is NOT a denial (a sibling still grants) stays
 *     silent, because that caller sees rows and has no mystery to debug;
 *  4. the line does not become noise on a read path: once per distinct cause,
 *     not once per request.
 *
 * ⛔ Deliberately NOT covered here: `explain`'s `isDenyAll` / the
 * `__deny_all__` vs `__rls_deny__` sentinel question. That is a design fork the
 * filer declined to answer and this slice does not touch.
 */

import { describe, it, expect, vi } from 'vitest';
import type { RowLevelSecurityPolicy } from '@objectstack/spec/security';
import { matchesFilterCondition } from '@objectstack/formula';

import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';

type WarnCall = [string, Record<string, unknown>?];

function compilerWithLogger() {
  const warn = vi.fn();
  const compiler = new RLSCompiler();
  compiler.setLogger({ warn });
  const lines = () => (warn.mock.calls as WarnCall[]).map((c) => String(c[0]));
  return { compiler, warn, lines };
}

function policy(using: string, name = 'territory_scope', object = 'task'): RowLevelSecurityPolicy {
  return { name, object, operation: 'select', using } as RowLevelSecurityPolicy;
}

/** A membership array with a NULL member — the shape #13630 added a refusal for. */
const MEMBER_NULL_CTX = {
  userId: 'u1',
  tenantId: 'org-1',
  rlsMembership: { territory_user_ids: ['u2', null, 'u4'] },
} as never;

/** No active organization — the long-standing SCALAR fail-closed path. */
const NO_ORG_CTX = { userId: 'u1' } as never;

describe('#13639 — a fail-closed RLS denial logs, with the REASON', () => {
  it('a membership shape whose member is null: the line names the VARIABLE PATH and the INDEX', () => {
    const { compiler, warn, lines } = compilerWithLogger();

    const filter = compiler.compileFilter(
      [policy('assigned_to_id in current_user.territory_user_ids')],
      MEMBER_NULL_CTX,
    );

    // The decision is the same fail-closed one it has always been.
    expect(filter).toEqual(RLS_DENY_FILTER);

    // …and it is no longer silent.
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0] as WarnCall;

    // The REASON, not merely the fact — this is the whole defect. The compiler
    // computed every one of these and they were thrown away at `!result.ok`.
    expect(message).toContain('current_user.territory_user_ids'); // WHICH variable
    expect(message).toContain('unresolved member at index 1');    // WHICH member
    expect(message).toContain('assigned_to_id in current_user.territory_user_ids'); // WHICH predicate
    expect(message).toContain("policy 'territory_scope'");        // WHICH policy
    expect(message).toContain("on 'task'");                       // WHICH object
    // And the consequence, so "zero rows" is readable as a refusal.
    expect(message).toContain('ZERO ROWS');
    expect(message).toContain('__rls_deny__');

    expect(meta).toMatchObject({
      object: 'task',
      policy: 'territory_scope',
      clause: 'using',
      reason: 'unresolved-variable',
      filter: RLS_DENY_FILTER.id,
    });
    expect(String(meta?.detail)).toContain('unresolved member at index 1');

    expect(lines()).toHaveLength(1);
  });

  it('the SCALAR "no active organization" path names its variable too', () => {
    const { compiler, warn } = compilerWithLogger();

    const filter = compiler.compileFilter(
      [policy('organization_id == current_user.organization_id', 'tenant_isolation')],
      NO_ORG_CTX,
    );

    expect(filter).toEqual(RLS_DENY_FILTER);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0] as WarnCall;
    expect(message).toContain('current_user.organization_id');
    expect(message).toContain('DENY (fail closed)');
    expect(meta).toMatchObject({ reason: 'unresolved-variable' });
  });

  it('an EMPTY pre-resolved membership set names itself (the compiler answers `ok`, so it has no detail to carry)', () => {
    const { compiler, warn } = compilerWithLogger();

    const filter = compiler.compileFilter(
      [policy('assigned_to_id in current_user.territory_user_ids')],
      { userId: 'u1', tenantId: 'org-1', rlsMembership: { territory_user_ids: [] } } as never,
    );

    expect(filter).toEqual(RLS_DENY_FILTER);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0] as WarnCall;
    expect(message).toContain('membership set is EMPTY');
    expect(meta).toMatchObject({ reason: 'empty-membership' });
  });

  it('the `check` clause denies and reports under its own clause name (ADR-0058 D4)', () => {
    const { compiler, warn } = compilerWithLogger();

    const p = {
      name: 'own_rows',
      object: 'task',
      operation: 'update',
      using: 'owner_id == current_user.id',
      check: 'assigned_to_id in current_user.territory_user_ids',
    } as RowLevelSecurityPolicy;

    expect(compiler.compileFilter([p], MEMBER_NULL_CTX, 'check')).toEqual(RLS_DENY_FILTER);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0] as WarnCall;
    expect(message).toContain('check clause');
    expect(meta).toMatchObject({ clause: 'check', reason: 'unresolved-variable' });
  });
});

describe('#13639 — the DECISION is unchanged (observability only)', () => {
  it('`__rls_deny__` still lands, and still excludes every record it is matched against', () => {
    const { compiler } = compilerWithLogger();

    const filter = compiler.compileFilter(
      [policy('assigned_to_id in current_user.territory_user_ids')],
      MEMBER_NULL_CTX,
    );

    // The sentinel itself, unchanged — value, shape and identity.
    expect(filter).toEqual(RLS_DENY_FILTER);
    expect(filter).toEqual({ id: '__rls_deny__:00000000-0000-0000-0000-000000000000' });
    expect(Object.keys(filter as object)).toEqual(['id']);

    // Record attribution still excludes: zero rows still means zero rows. This
    // is the same predicate test `explain`'s record-grained pass runs.
    for (const record of [
      { id: 'rec-1', assigned_to_id: 'u2' },
      { id: '00000000-0000-0000-0000-000000000000', assigned_to_id: 'u4' },
      { id: '', assigned_to_id: null },
    ]) {
      expect(matchesFilterCondition(record, filter as never)).toBe(false);
    }
  });

  it('`compileExpression` keeps its published `Record | null` contract', () => {
    const { compiler } = compilerWithLogger();
    const ctx = { id: 'u1', territory_user_ids: ['u2', null] } as never;

    // The refusal is still spelled `null` — the reason rides on the internal
    // seam, never on this method's return type.
    expect(compiler.compileExpression('assigned_to_id in current_user.territory_user_ids', ctx)).toBeNull();
    expect(compiler.compileExpression('', ctx)).toBeNull();
    // …and a resolving predicate still returns exactly the filter it always did.
    expect(compiler.compileExpression('owner_id == current_user.id', ctx)).toEqual({ owner_id: 'u1' });
  });

  it('a policy that RESOLVES is unaffected — same filter, no sentinel', () => {
    const { compiler } = compilerWithLogger();
    const filter = compiler.compileFilter(
      [policy('assigned_to_id in current_user.territory_user_ids')],
      { userId: 'u1', rlsMembership: { territory_user_ids: ['u2', 'u4'] } } as never,
    );
    expect(filter).toEqual({ assigned_to_id: { $in: ['u2', 'u4'] } });
    expect(filter).not.toEqual(RLS_DENY_FILTER);
  });
});

describe('#13639 — the negatives', () => {
  it('a normal RESOLVING expression logs nothing at all', () => {
    const { compiler, warn } = compilerWithLogger();
    const filter = compiler.compileFilter(
      [policy('owner_id == current_user.id', 'own_rows')],
      { userId: 'u1', tenantId: 'org-1' } as never,
    );
    expect(filter).toEqual({ owner_id: 'u1' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('a shape that CORRECTLY logged before still logs — once, with its own message', () => {
    const { compiler, warn, lines } = compilerWithLogger();

    // Arithmetic: genuinely non-pushdownable, an AUTHORING fault. It earned the
    // ADR-0056 D4 "DROPPED (no enforcement)" line before this change and must
    // still earn exactly that one line — not a second, differently-worded one.
    const filter = compiler.compileFilter([policy('amount + 1 > 2', 'bad')], { userId: 'u1' } as never);

    expect(filter).toEqual(RLS_DENY_FILTER);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toContain('uncompilable predicate');
    expect(lines()[0]).toContain('DROPPED (no enforcement)');
    // …now carrying the compiler's reason as well as the fact.
    expect(lines()[0]).toContain('unsupported operand "+"');
    expect(lines()[0]).not.toContain('DENY (fail closed)');
  });

  it('a dropped policy that is NOT a denial stays silent — the caller sees rows', () => {
    const { compiler, warn } = compilerWithLogger();

    // One policy cannot resolve; a sibling grants. The caller gets rows, so
    // there is no mystery to explain and no line to spend on a read path.
    const filter = compiler.compileFilter(
      [
        policy('assigned_to_id in current_user.territory_user_ids', 'territory'),
        policy('owner_id == current_user.id', 'own_rows'),
      ],
      MEMBER_NULL_CTX,
    );

    expect(filter).toEqual({ owner_id: 'u1' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('no applicable policy for the clause is NOT a denial and logs nothing', () => {
    const { compiler, warn } = compilerWithLogger();
    const checkOnly = { name: 'post_image', object: 'task', operation: 'all', check: 'x == 1' } as RowLevelSecurityPolicy;
    expect(compiler.compileFilter([checkOnly], NO_ORG_CTX, 'using')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('#13639 — the line is a trace, not a flood (this seam runs on read paths)', () => {
  it('the SAME cause across repeated requests warns ONCE', () => {
    const { compiler, warn } = compilerWithLogger();
    const p = policy('assigned_to_id in current_user.territory_user_ids');

    for (let i = 0; i < 25; i++) {
      expect(compiler.compileFilter([p], MEMBER_NULL_CTX)).toEqual(RLS_DENY_FILTER);
    }

    // 25 denials — all correct, all fail-closed — and one line to read.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a DIFFERENT cause is a different line (dedup never swallows a new fact)', () => {
    const { compiler, warn, lines } = compilerWithLogger();
    const p = policy('assigned_to_id in current_user.territory_user_ids');

    compiler.compileFilter([p], MEMBER_NULL_CTX);
    // Same policy, same variable — a different member index is a different cause.
    compiler.compileFilter([p], {
      userId: 'u1',
      rlsMembership: { territory_user_ids: ['u2', 'u4', undefined] },
    } as never);
    // A different policy on a different object is a different cause too.
    compiler.compileFilter([policy('org_id == current_user.organization_id', 'wall', 'deal')], NO_ORG_CTX);

    expect(warn).toHaveBeenCalledTimes(3);
    expect(lines()[0]).toContain('index 1');
    expect(lines()[1]).toContain('index 2');
    expect(lines()[2]).toContain("on 'deal'");
  });

  it('a compiler with NO logger bound never throws on the deny path', () => {
    const compiler = new RLSCompiler();
    expect(compiler.compileFilter([policy('x in current_user.nope')], NO_ORG_CTX)).toEqual(RLS_DENY_FILTER);
  });
});
