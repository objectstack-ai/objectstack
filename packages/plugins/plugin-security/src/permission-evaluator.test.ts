// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18785] The enforcement door asks ONE fold.
 *
 * "Does this effective object permission grant this verb?" is stated once, in
 * `@objectstack/spec`'s `objectPermissionGrants`.
 * `PermissionEvaluator.checkObjectPermission` — the fold the server actually
 * applies — asks that function instead of restating it, and so does
 * `@objectstack/lint`'s `buildAccessMatrix`. Before this card the rule had
 * three implementations that happened to agree; agreeing today is not a
 * property a security rule can be left resting on.
 *
 * ⚠️ The expectation here is written INDEPENDENTLY of the spec helper, from the
 * rule itself: read bypasses on `viewAllRecords || modifyAllRecords`; write
 * bypasses on `modifyAllRecords` ALONE and never create; export is
 * `grant ∧ read`. Asserting `checkObjectPermission === objectPermissionGrants`
 * would be a tautology — both sides move together, and the pin would survive
 * any change to the fold, including a wrong one. Stated this way, changing one
 * cell of the spec helper reddens this file, which is the only evidence that
 * the door is really asking it.
 *
 * The enumeration is exhaustive over the declared object-permission bits in all
 * three authorable states (`true` / `false` / absent): every implementation
 * compares with `=== true`, and absence is the state an author reaches by
 * omission.
 */

import { describe, it, expect } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { PermissionEvaluator, MODIFY_ALL_WRITE_KEYS } from './permission-evaluator';

const evaluator = new PermissionEvaluator();
const OBJ = 'deal';

const set = (name: string, objects: Record<string, unknown>): PermissionSet =>
  ({ name, objects } as unknown as PermissionSet);

/** The ObjectQL operation that asks each `allow*` bit at the door. */
const OPERATION_FOR: Record<Verb, string> = {
  allowRead: 'find',
  allowCreate: 'insert',
  allowEdit: 'update',
  allowDelete: 'delete',
  allowTransfer: 'transfer',
  allowExport: 'export',
};

type Verb = 'allowRead' | 'allowCreate' | 'allowEdit' | 'allowDelete' | 'allowTransfer' | 'allowExport';
const VERBS: Verb[] = ['allowRead', 'allowCreate', 'allowEdit', 'allowDelete', 'allowTransfer', 'allowExport'];

const FOLD_BITS = [
  'allowCreate', 'allowDelete', 'allowEdit', 'allowExport',
  'allowRead', 'allowTransfer', 'modifyAllRecords', 'viewAllRecords',
] as const;
const BIT_STATES: Array<boolean | undefined> = [true, false, undefined];

/** The fold, restated from the rule — deliberately NOT the spec helper. */
function referenceFold(p: Record<string, unknown>, verb: Verb): boolean {
  const modifyAll = p.modifyAllRecords === true;
  const read = p.allowRead === true || p.viewAllRecords === true || modifyAll;
  switch (verb) {
    case 'allowRead': return read;
    case 'allowCreate': return p.allowCreate === true;
    case 'allowEdit': return p.allowEdit === true || modifyAll;
    case 'allowDelete': return p.allowDelete === true || modifyAll;
    case 'allowTransfer': return p.allowTransfer === true || modifyAll;
    case 'allowExport': return p.allowExport === true && read;
  }
}

function enumerateEntries(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const total = BIT_STATES.length ** FOLD_BITS.length;
  for (let i = 0; i < total; i++) {
    const entry: Record<string, unknown> = {};
    let n = i;
    for (const bit of FOLD_BITS) {
      const s = BIT_STATES[n % BIT_STATES.length];
      n = Math.floor(n / BIT_STATES.length);
      if (s !== undefined) entry[bit] = s;
    }
    out.push(entry);
  }
  return out;
}

describe('checkObjectPermission — the one fold, asked (#18785)', () => {
  it('named cells: the fold as the rule states it', () => {
    const ask = (entry: Record<string, unknown>, verb: Verb) =>
      evaluator.checkObjectPermission(OPERATION_FOR[verb], OBJ, [set('ps', { [OBJ]: entry })]);

    // READ bypasses on EITHER super-user bit (Modify All implies View All).
    expect(ask({ viewAllRecords: true }, 'allowRead')).toBe(true);
    expect(ask({ modifyAllRecords: true }, 'allowRead')).toBe(true);

    // WRITE bypasses on Modify All Data ALONE — View All Data is a read power
    // and must never widen a write.
    expect(ask({ modifyAllRecords: true }, 'allowEdit')).toBe(true);
    expect(ask({ modifyAllRecords: true }, 'allowDelete')).toBe(true);
    expect(ask({ modifyAllRecords: true }, 'allowTransfer')).toBe(true);
    expect(ask({ viewAllRecords: true }, 'allowEdit')).toBe(false);
    expect(ask({ viewAllRecords: true }, 'allowDelete')).toBe(false);
    expect(ask({ viewAllRecords: true }, 'allowTransfer')).toBe(false);

    // CREATE is never manufactured by a super-user bit.
    expect(ask({ modifyAllRecords: true }, 'allowCreate')).toBe(false);
    expect(ask({ viewAllRecords: true }, 'allowCreate')).toBe(false);
    expect(ask({ allowCreate: true }, 'allowCreate')).toBe(true);

    // EXPORT is a CONJUNCTION: the grant alone grants nothing, and the
    // super-user bits satisfy the read half without implying export.
    expect(ask({ allowExport: true }, 'allowExport')).toBe(false);
    expect(ask({ allowExport: true, allowRead: true }, 'allowExport')).toBe(true);
    expect(ask({ allowExport: true, viewAllRecords: true }, 'allowExport')).toBe(true);
    expect(ask({ modifyAllRecords: true }, 'allowExport')).toBe(false);

    // An entry with no bits grants nothing at all.
    for (const verb of VERBS) expect(ask({}, verb)).toBe(false);
  });

  it('exhaustively matches the fold over every declared bit combination', () => {
    const entries = enumerateEntries();
    expect(entries.length).toBe(3 ** 8);
    const mismatches: string[] = [];
    let cells = 0;
    for (const entry of entries) {
      const sets = [set('ps', { [OBJ]: entry })];
      for (const verb of VERBS) {
        cells++;
        const got = evaluator.checkObjectPermission(OPERATION_FOR[verb], OBJ, sets);
        const want = referenceFold(entry, verb);
        if (got !== want) mismatches.push(`${JSON.stringify(entry)} × ${verb}: door=${got} rule=${want}`);
      }
    }
    expect(cells).toBe(3 ** 8 * VERBS.length);
    expect(mismatches).toEqual([]);
  });

  it('the Modify-All write-bypass CLASS is exactly what this file derives from its own dispatch map', () => {
    // MODIFY_ALL_WRITE_KEYS no longer decides anything — it states, on this
    // side, which bits the class contains, derived from OPERATION_TO_PERMISSION
    // and DESTRUCTIVE_OPERATIONS. Holding the fold to it is what makes a future
    // destructive operation added to the map go red in the spec instead of
    // silently losing its bypass (#1883).
    expect([...MODIFY_ALL_WRITE_KEYS].sort()).toEqual(['allowDelete', 'allowEdit', 'allowTransfer']);
    const mad = { modifyAllRecords: true };
    for (const key of MODIFY_ALL_WRITE_KEYS) {
      expect(evaluator.checkObjectPermission(OPERATION_FOR[key as Verb], OBJ, [set('ps', { [OBJ]: mad })])).toBe(true);
    }
    for (const verb of VERBS.filter((v) => !MODIFY_ALL_WRITE_KEYS.has(v as never) && v !== 'allowRead')) {
      expect(evaluator.checkObjectPermission(OPERATION_FOR[verb], OBJ, [set('ps', { [OBJ]: mad })])).toBe(false);
    }
  });

  it('export stays a CROSS-SET conjunction — the two halves may arrive from different sets', () => {
    // The spec cell is `grant ∧ read` over ONE effective entry; this door asks
    // it over the whole resolved set list, which is what the `/me/permissions`
    // most-permissive per-object merge hands the client. Collapsing it per set
    // would deny this caller.
    const reader = set('reader', { [OBJ]: { allowRead: true } });
    const exporter = set('exporter', { [OBJ]: { allowExport: true } });
    expect(evaluator.checkObjectPermission('export', OBJ, [reader, exporter])).toBe(true);
    expect(evaluator.checkObjectPermission('export', OBJ, [exporter, reader])).toBe(true);
    expect(evaluator.checkObjectPermission('export', OBJ, [exporter])).toBe(false);
    expect(evaluator.checkObjectPermission('export', OBJ, [reader])).toBe(false);
  });

  it('the unmapped-operation posture is untouched by the convergence', () => {
    const grant = set('ps', { [OBJ]: { allowRead: true, allowEdit: true, modifyAllRecords: true } });
    // Destructive but unmapped ⇒ denied unconditionally, bypass never consulted.
    expect(evaluator.checkObjectPermission('restore', OBJ, [grant])).toBe(false);
    expect(evaluator.checkObjectPermission('purge', OBJ, [grant])).toBe(false);
    // Non-destructive unknown ⇒ default-allow, as before.
    expect(evaluator.checkObjectPermission('customReadSideOp', OBJ, [grant])).toBe(true);
  });
});
