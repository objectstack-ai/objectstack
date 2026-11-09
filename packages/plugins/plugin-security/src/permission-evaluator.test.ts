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
  allowRestoreOwnDeleted: 'restore',
  manageRecycleBin: 'purge',
};

type Verb =
  | 'allowRead' | 'allowCreate' | 'allowEdit' | 'allowDelete' | 'allowTransfer' | 'allowExport'
  | 'allowRestoreOwnDeleted' | 'manageRecycleBin';
/** The verbs the 3-state sweep over {@link FOLD_BITS} asks. */
const VERBS: Verb[] = ['allowRead', 'allowCreate', 'allowEdit', 'allowDelete', 'allowTransfer', 'allowExport'];
/** [#30237 PR 4] The recycle-bin keys, asked by `restore` and `purge`. */
const BIN_VERBS: Verb[] = ['allowRestoreOwnDeleted', 'manageRecycleBin'];
const ALL_VERBS: Verb[] = [...VERBS, ...BIN_VERBS];

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
    // An object permission that edits or deletes a record also reads it.
    case 'allowEdit': return read && (p.allowEdit === true || modifyAll);
    case 'allowDelete': return read && (p.allowDelete === true || modifyAll);
    case 'allowTransfer': return p.allowTransfer === true || modifyAll;
    case 'allowExport': return p.allowExport === true && read;
    // [#30237 Q5 = A] Bounded by read; Modify All implies both; the manager
    // bit implies restoring your own; allowDelete implies neither.
    case 'manageRecycleBin': return read && (p.manageRecycleBin === true || modifyAll);
    case 'allowRestoreOwnDeleted':
      return read && (p.allowRestoreOwnDeleted === true || p.manageRecycleBin === true || modifyAll);
  }
}

function enumerateEntries(
  bits: readonly string[] = FOLD_BITS,
  states: ReadonlyArray<boolean | undefined> = BIT_STATES,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const total = states.length ** bits.length;
  for (let i = 0; i < total; i++) {
    const entry: Record<string, unknown> = {};
    let n = i;
    for (const bit of bits) {
      const s = states[n % states.length];
      n = Math.floor(n / states.length);
      if (s !== undefined) entry[bit] = s;
    }
    out.push(entry);
  }
  return out;
}

/** [#30237 PR 4] Every bit the recycle-bin keys' fold reads, plus the one it must NOT read (allowDelete). */
const BIN_FOLD_BITS = [
  'allowDelete', 'allowRead', 'allowRestoreOwnDeleted', 'manageRecycleBin', 'modifyAllRecords', 'viewAllRecords',
] as const;

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
    expect([...MODIFY_ALL_WRITE_KEYS].sort()).toEqual([
      'allowDelete', 'allowEdit', 'allowRestoreOwnDeleted', 'allowTransfer', 'manageRecycleBin',
    ]);
    const mad = { modifyAllRecords: true };
    for (const key of MODIFY_ALL_WRITE_KEYS) {
      expect(evaluator.checkObjectPermission(OPERATION_FOR[key as Verb], OBJ, [set('ps', { [OBJ]: mad })])).toBe(true);
    }
    for (const verb of ALL_VERBS.filter((v) => !MODIFY_ALL_WRITE_KEYS.has(v as never) && v !== 'allowRead')) {
      expect(evaluator.checkObjectPermission(OPERATION_FOR[verb], OBJ, [set('ps', { [OBJ]: mad })])).toBe(false);
    }
  });

  for (const [verb, op] of [['allowEdit', 'update'], ['allowDelete', 'delete']] as const) {
    it(`${op}: an object permission that ${op}s a record also reads it — a grant without read grants nothing`, () => {
      // The shape a row stored before the authoring refusal still carries.
      expect(evaluator.checkObjectPermission(op, OBJ, [set('writer', { [OBJ]: { [verb]: true } })])).toBe(false);
      expect(evaluator.checkObjectPermission(op, OBJ, [set('writer', { [OBJ]: { allowRead: false, [verb]: true } })])).toBe(false);
      expect(evaluator.checkObjectPermission(op, OBJ, [set('writer', { [OBJ]: { allowRead: true, [verb]: true } })])).toBe(true);
      expect(evaluator.checkObjectPermission(op, OBJ, [set('writer', { [OBJ]: { viewAllRecords: true, [verb]: true } })])).toBe(true);
      // A wildcard grant without read is the same shape.
      expect(evaluator.checkObjectPermission(op, OBJ, [set('writer', { '*': { [verb]: true } })])).toBe(false);
    });

    it(`${op}: the read half may arrive from a different set, as export's does`, () => {
      const reader = set('reader', { [OBJ]: { allowRead: true } });
      const writer = set('writer', { [OBJ]: { [verb]: true } });
      expect(evaluator.checkObjectPermission(op, OBJ, [reader, writer])).toBe(true);
      expect(evaluator.checkObjectPermission(op, OBJ, [writer, reader])).toBe(true);
      expect(evaluator.checkObjectPermission(op, OBJ, [writer])).toBe(false);
      expect(evaluator.checkObjectPermission(op, OBJ, [reader])).toBe(false);
    });
  }

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
    // [#30237 PR 4] `restore` and `purge` are MAPPED now, so Modify All answers them.
    expect(evaluator.checkObjectPermission('restore', OBJ, [grant])).toBe(true);
    expect(evaluator.checkObjectPermission('purge', OBJ, [grant])).toBe(true);
    // Non-destructive unknown ⇒ default-allow, as before.
    expect(evaluator.checkObjectPermission('customReadSideOp', OBJ, [grant])).toBe(true);
  });

  it('[#30237 PR 4] restore asks allowRestoreOwnDeleted and purge asks manageRecycleBin (Q5 = A, named cells)', () => {
    const ask = (entry: Record<string, unknown>, op: 'restore' | 'purge') =>
      evaluator.checkObjectPermission(op, OBJ, [set('ps', { [OBJ]: entry })]);

    // The grants, each bounded by read.
    expect(ask({ allowRead: true, allowRestoreOwnDeleted: true }, 'restore')).toBe(true);
    expect(ask({ allowRestoreOwnDeleted: true }, 'restore')).toBe(false);
    expect(ask({ allowRead: false, allowRestoreOwnDeleted: true }, 'restore')).toBe(false);
    expect(ask({ allowRead: true, manageRecycleBin: true }, 'purge')).toBe(true);
    expect(ask({ manageRecycleBin: true }, 'purge')).toBe(false);
    expect(ask({ viewAllRecords: true, manageRecycleBin: true }, 'purge')).toBe(true);

    // The manager bit implies restoring your own; restoring your own implies no purge.
    expect(ask({ allowRead: true, manageRecycleBin: true }, 'restore')).toBe(true);
    expect(ask({ allowRead: true, allowRestoreOwnDeleted: true }, 'purge')).toBe(false);

    // Modify All implies both; View All implies neither.
    expect(ask({ modifyAllRecords: true }, 'restore')).toBe(true);
    expect(ask({ modifyAllRecords: true }, 'purge')).toBe(true);
    expect(ask({ viewAllRecords: true }, 'restore')).toBe(false);
    expect(ask({ viewAllRecords: true }, 'purge')).toBe(false);

    // allowDelete implies neither: deleting a record is not taking it back, nor destroying it for good.
    expect(ask({ allowRead: true, allowDelete: true }, 'restore')).toBe(false);
    expect(ask({ allowRead: true, allowDelete: true }, 'purge')).toBe(false);
    expect(ask({ allowRead: true, allowEdit: true, allowDelete: true, allowTransfer: true }, 'restore')).toBe(false);

    // The bin keys widen no other verb.
    const binOnly = { allowRead: true, allowRestoreOwnDeleted: true, manageRecycleBin: true };
    for (const op of ['insert', 'update', 'delete', 'transfer', 'export']) {
      expect(evaluator.checkObjectPermission(op, OBJ, [set('ps', { [OBJ]: binOnly })])).toBe(false);
    }
  });

  it('[#30237 PR 4] exhaustively matches the bin keys\' fold over every combination of the bits it reads', () => {
    const entries = enumerateEntries(BIN_FOLD_BITS);
    expect(entries.length).toBe(3 ** BIN_FOLD_BITS.length);
    const mismatches: string[] = [];
    for (const entry of entries) {
      const sets = [set('ps', { [OBJ]: entry })];
      for (const verb of BIN_VERBS) {
        const got = evaluator.checkObjectPermission(OPERATION_FOR[verb], OBJ, sets);
        const want = referenceFold(entry, verb);
        if (got !== want) mismatches.push(`${JSON.stringify(entry)} × ${verb}: door=${got} rule=${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('[#30237 PR 4] no bit widens another verb: every verb over every present/absent combination of all ten bits', () => {
    const entries = enumerateEntries([...FOLD_BITS, 'allowRestoreOwnDeleted', 'manageRecycleBin'], [true, undefined]);
    expect(entries.length).toBe(2 ** 10);
    const mismatches: string[] = [];
    for (const entry of entries) {
      const sets = [set('ps', { [OBJ]: entry })];
      for (const verb of ALL_VERBS) {
        const got = evaluator.checkObjectPermission(OPERATION_FOR[verb], OBJ, sets);
        const want = referenceFold(entry, verb);
        if (got !== want) mismatches.push(`${JSON.stringify(entry)} × ${verb}: door=${got} rule=${want}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  for (const [verb, op] of [['allowRestoreOwnDeleted', 'restore'], ['manageRecycleBin', 'purge']] as const) {
    it(`[#30237 PR 4] ${op}: the read half may arrive from a different set, as delete's does`, () => {
      const reader = set('reader', { [OBJ]: { allowRead: true } });
      const binner = set('binner', { [OBJ]: { [verb]: true } });
      expect(evaluator.checkObjectPermission(op, OBJ, [reader, binner])).toBe(true);
      expect(evaluator.checkObjectPermission(op, OBJ, [binner, reader])).toBe(true);
      expect(evaluator.checkObjectPermission(op, OBJ, [binner])).toBe(false);
      expect(evaluator.checkObjectPermission(op, OBJ, [reader])).toBe(false);
    });
  }
});
