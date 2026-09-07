// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15416 — `OBJECT_API_METHOD_NOT_ALLOWED` named the conjunct that PASSED.
 *
 * Measured on a walled boot: `sys_user` declares
 * `apiMethods: ['get','list','update','bulk']`, and `deleteMany`, `createMany`
 * and the cross-object `POST /batch` each answered
 *
 *   {"error":"API operation 'bulk' is not allowed on object 'sys_user'",
 *    "allowed":[... ,"bulk", ...]}
 *
 * — a message contradicted by its own envelope. The refusals were CORRECT in
 * outcome (`deleteMany` is `bulk ∧ delete`, `createMany` is `bulk ∧ create`,
 * and `updateMany` / `batch`, which need only `bulk`, are admitted); it was the
 * NAME that pointed at the half that passed.
 *
 * ## Why a "some 405 happened" test would not do
 *
 * The `allowed` array is load-bearing as a DISCRIMINATOR, not decoration: a
 * declaration re-widened to create/update can still 405 for an unrelated
 * reason, so only the set proves WHICH gate answered. Every assertion below
 * therefore reads the NAME out of the message and grades it against the same
 * envelope's `allowed` array — a test that only counted refusals would have
 * been green throughout the defect.
 *
 * The last block is the one that generalises: it sweeps every whitelist against
 * every conjunction-bearing call shape and asserts the envelope's two halves
 * can never disagree again, whatever the derivation grows into.
 */

import { describe, it, expect } from 'vitest';
import { API_PRIMITIVES, resolveEffectiveApiMethods, effectiveOperationsArray } from '@objectstack/spec/data';
import { apiAccessDenialFromEnable } from './rest-server';

/** The operation the refusal NAMES, read back out of the wire message. */
function namedOperation(body: Record<string, unknown>): string | undefined {
  return /^API operation '([^']*)' is not allowed on object '([^']*)'$/.exec(String(body.error))?.[1];
}

/** A 405 body, asserted to be one — a 404/null here is a different gate answering. */
function refusal(enable: any, op: string, opts?: any): Record<string, unknown> {
  const d = apiAccessDenialFromEnable(enable, 'sys_user', op, opts);
  expect(d, `expected ${op} to be refused`).not.toBeNull();
  expect(d!.status).toBe(405);
  return d!.body;
}

/** The card's own declaration, verbatim. */
const SYS_USER = { apiMethods: ['get', 'list', 'update', 'bulk'] };

describe('#15416 the refusal names the conjunct that FAILED (bulk ∧ child)', () => {
  it('deleteMany names `delete`, not the `bulk` its own set contains', () => {
    const body = refusal(SYS_USER, 'bulk', { bulkChild: 'delete' });
    expect(namedOperation(body)).toBe('delete');
    // Both halves of the repair, stated separately: the name is now absent from
    // the set, and the set still means "what the object declares" (option 2 —
    // redefining `allowed` — was explicitly not taken, so `bulk` stays in it).
    expect(body.allowed).not.toContain('delete');
    expect(body.allowed).toContain('bulk');
    expect(body.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
    expect(body.object).toBe('sys_user');
  });

  it('createMany names `create`', () => {
    const body = refusal(SYS_USER, 'bulk', { bulkChild: 'create' });
    expect(namedOperation(body)).toBe('create');
    expect(body.allowed).not.toContain('create');
    expect(body.allowed).toContain('bulk');
  });

  it('the cross-object batch route names the child op it was refused for', () => {
    // `POST /api/v1/batch` gates each op as `bulk ∧ child(op.action)`; the card
    // measured all three shapes collapsing onto one indistinguishable envelope.
    expect(namedOperation(refusal(SYS_USER, 'bulk', { bulkChild: 'delete' }))).toBe('delete');
    expect(namedOperation(refusal(SYS_USER, 'bulk', { bulkChild: 'create' }))).toBe('create');
  });

  it('still names `bulk` when `bulk` is the half that actually failed', () => {
    // The mirror case, and the reason this is not "always name the child":
    // here the child is granted and the bulk primitive is not.
    const body = refusal({ apiMethods: ['create'] }, 'bulk', { bulkChild: 'create' });
    expect(namedOperation(body)).toBe('bulk');
    expect(body.allowed).not.toContain('bulk');
  });

  it('names a missing write when the batched child is itself a conjunction', () => {
    // `upsert` is create ∧ update; granting bulk + update leaves `create`.
    const body = refusal({ apiMethods: ['bulk', 'update'] }, 'bulk', { bulkChild: 'upsert' });
    expect(namedOperation(body)).toBe('create');
    expect(body.allowed).not.toContain('create');
  });

  it('leaves the admitted bulk shapes admitted — no decision moved', () => {
    expect(apiAccessDenialFromEnable(SYS_USER, 'sys_user', 'bulk', { bulkChild: 'update' })).toBeNull();
    expect(apiAccessDenialFromEnable(SYS_USER, 'sys_user', 'bulk')).toBeNull();
  });
});

describe('#15416 the same repair on the writeMode-refined import', () => {
  it('an `insert` import names `create`, not the `import` its set contains', () => {
    // The card's fourth measurement: `import` derives from create ∨ update, so
    // `update` alone puts `import` IN the effective set while an insert-mode
    // import still needs `create`.
    const body = refusal(SYS_USER, 'import', { writeMode: 'insert' });
    expect(namedOperation(body)).toBe('create');
    expect(body.allowed).toContain('import');
    expect(body.allowed).not.toContain('create');
  });

  it('an `update` import names `update`', () => {
    const body = refusal({ apiMethods: ['get', 'list', 'create'] }, 'import', { writeMode: 'update' });
    expect(namedOperation(body)).toBe('update');
    expect(body.allowed).toContain('import');
    expect(body.allowed).not.toContain('update');
  });

  it('an `upsert` import names the write it is missing', () => {
    expect(namedOperation(refusal(SYS_USER, 'import', { writeMode: 'upsert' }))).toBe('create');
    expect(namedOperation(refusal({ apiMethods: ['create'] }, 'import', { writeMode: 'upsert' }))).toBe('update');
  });
});

describe('#15416 refusals that were never self-contradicting are left alone', () => {
  it('a plain primitive miss still names the primitive asked for', () => {
    const body = refusal({ apiMethods: ['get', 'list'] }, 'delete');
    expect(namedOperation(body)).toBe('delete');
  });

  it('deny-all names the operation requested', () => {
    const body = refusal({ apiMethods: [] }, 'bulk', { bulkChild: 'create' });
    expect(namedOperation(body)).toBe('bulk');
    expect(body.allowed).toEqual([]);
  });

  it('a flag-gated derived verb still names itself', () => {
    // `search` needs `list` AND `searchable`; the flag is not a primitive, so
    // there is no conjunct to name and `search` is already absent from the set.
    const body = refusal({ apiMethods: ['get', 'list'], searchable: false }, 'search');
    expect(namedOperation(body)).toBe('search');
    expect(body.allowed).not.toContain('search');
  });

  it('the 404 arm is untouched', () => {
    const d = apiAccessDenialFromEnable({ apiEnabled: false }, 'sys_user', 'bulk', { bulkChild: 'delete' });
    expect(d?.status).toBe(404);
    expect(d?.body.code).toBe('OBJECT_API_DISABLED');
  });
});

describe('#15416 the envelope halves cannot disagree, over every whitelist', () => {
  /** Every subset of the six primitives — the whole declaration space. */
  function everyWhitelist(): string[][] {
    const out: string[][] = [];
    for (let mask = 0; mask < 1 << API_PRIMITIVES.length; mask += 1) {
      out.push(API_PRIMITIVES.filter((_, i) => mask & (1 << i)));
    }
    return out;
  }

  const CALLS: Array<[string, any]> = [
    ['bulk', { bulkChild: 'create' }],
    ['bulk', { bulkChild: 'update' }],
    ['bulk', { bulkChild: 'delete' }],
    ['bulk', { bulkChild: 'upsert' }],
    ['bulk', undefined],
    ['import', { writeMode: 'insert' }],
    ['import', { writeMode: 'update' }],
    ['import', { writeMode: 'upsert' }],
    ['import', undefined],
    ['upsert', undefined],
    ['export', undefined],
    ['aggregate', undefined],
    ['get', undefined],
    ['create', undefined],
    ['delete', undefined],
  ];

  it('never names an operation the same envelope lists as allowed', () => {
    let refusals = 0;
    for (const apiMethods of everyWhitelist()) {
      for (const [op, opts] of CALLS) {
        const d = apiAccessDenialFromEnable({ apiMethods }, 'sys_user', op, opts);
        if (!d || d.status !== 405) continue;
        refusals += 1;
        const named = namedOperation(d.body);
        expect(named, `unparseable refusal for ${op} on [${apiMethods}]`).toBeTruthy();
        expect(
          d.body.allowed,
          `[${apiMethods}] refused ${op} ${JSON.stringify(opts ?? {})} by naming "${named}", which it also lists as allowed`,
        ).not.toContain(named);
      }
    }
    // The sweep is only evidence if it actually refused things: a matrix that
    // admitted everything would pass the assertion above vacuously.
    expect(refusals).toBeGreaterThan(100);
  });

  it('names something the declaration could have granted — never a fiction', () => {
    // The name must be a real operation word, not an invented one: it is either
    // the operation asked for or a primitive the object did not declare.
    for (const apiMethods of everyWhitelist()) {
      for (const [op, opts] of CALLS) {
        const d = apiAccessDenialFromEnable({ apiMethods }, 'sys_user', op, opts);
        if (!d || d.status !== 405) continue;
        const named = namedOperation(d.body)!;
        const isPrimitive = (API_PRIMITIVES as readonly string[]).includes(named);
        expect(
          isPrimitive || named === op,
          `[${apiMethods}] refused ${op} by naming "${named}", which is neither the operation asked for nor a primitive`,
        ).toBe(true);
      }
    }
  });

  it('the `allowed` array itself is unchanged by this card', () => {
    // Option 2 (redefining `allowed` to be the set the gate evaluated against)
    // was NOT taken: the set is still the object's declared effective closure,
    // computed the way every other consumer computes it.
    for (const apiMethods of everyWhitelist()) {
      const d = apiAccessDenialFromEnable({ apiMethods }, 'sys_user', 'bulk', { bulkChild: 'delete' });
      if (!d || d.status !== 405) continue;
      expect(d.body.allowed).toEqual(effectiveOperationsArray(resolveEffectiveApiMethods({ apiMethods })));
    }
  });
});
