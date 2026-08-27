// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8990 — `sys_approval_request`'s decision actions on the SPARSE action face.
 *
 * This object is the hardest case in the migration and the only one whose
 * predicates traverse. Every approver / submitter lever gates on
 * `record.viewer.*` — a per-viewer block the approvals service ATTACHES on
 * `getRequest` / `listRequests`, not a declared column — and the action binding
 * is whatever record the client already fetched (#4953 item 2: it stays sparse
 * by decision). So `record.viewer` is absent on any read that did not go
 * through those two paths, and CEL aborts the whole expression at key
 * resolution rather than reading null.
 *
 * The object's own comment already said "where it is absent the predicate fails
 * closed", and that was true — but it was true by FAULT, which is the shape
 * this card exists to remove: a fault and a considered `false` are the same
 * pixel to the user (no button), so the intended fail-closed and an authoring
 * bug were indistinguishable. After the migration the fail-closed answer is a
 * real `false` that the engine returns, and this file pins both halves.
 *
 * The guard form here is NOT the canonical two-term conjunction, and that is
 * measured rather than preferred. `has(record.viewer) && record.viewer != null
 * && record.viewer.can_act` still faults on `{viewer: {}}` and on
 * `{viewer: {can_act: null}}`: the leaf is a second read and a second operator.
 * Guarding the leaf instead subsumes the parent `!= null` half, because `has()`
 * on a path whose parent is null answers `false` rather than faulting. Both
 * claims are pinned below so the form cannot be "corrected" back into a
 * faulting one by someone applying the canonical rule literally.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { SysApprovalRequest } from './sys-approval-request.object.js';

const USER = { id: 'u1', email: 'me@example.com' };

function evaluate(source: string, record: Record<string, unknown>): boolean | string {
  const r = celEngine.evaluate({ dialect: 'cel', source }, { record, user: USER });
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

/**
 * `defineObject` normalizes a CEL shorthand string into a `{dialect, source}`
 * envelope at parse time, so the stored value is not the string the file
 * spells. Read through this rather than the raw key, or every assertion below
 * runs against `undefined` and passes for the wrong reason.
 */
function sourceOf(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { source?: unknown }).source === 'string') {
    return (raw as { source: string }).source;
  }
  return undefined;
}

const ACTIONS = (SysApprovalRequest.actions ?? []) as Array<Record<string, unknown>>;
const visibleOf = (name: string): string => {
  const a = ACTIONS.find((x) => x.name === name);
  if (!a) throw new Error(`no action ${name}`);
  const source = sourceOf(a.visible);
  if (!source) throw new Error(`action ${name} has no CEL source`);
  return source;
};

/** The bindings a real read of this object can produce, sparse ones included. */
const BINDINGS: Array<[string, Record<string, unknown>]> = [
  ['a row with no viewer block at all', { status: 'pending' }],
  ['a row whose viewer projected as null', { status: 'pending', viewer: null }],
  ['a viewer block carrying none of the flags', { status: 'pending', viewer: {} }],
  ['a viewer block whose flags are null', { status: 'pending', viewer: { can_act: null, can_override: null, is_submitter: null } }],
  ['no status projected', { viewer: { can_act: true } }],
  ['status projected as null', { status: null, viewer: { can_act: true } }],
  ['a fully populated approver row', { status: 'pending', viewer: { can_act: true, can_override: false, is_submitter: false } }],
  ['a fully populated submitter row', { status: 'pending', viewer: { can_act: false, can_override: false, is_submitter: true } }],
];

describe('#8990 — sys_approval_request decision actions never fault on a sparse binding', () => {
  it('every action predicate reads record.* and is has()-guarded on each path', () => {
    const predicates = ACTIONS.map((a) => sourceOf(a.visible)).filter((v): v is string => typeof v === 'string');
    expect(predicates.length).toBe(8);
    const unguarded: string[] = [];
    for (const source of predicates) {
      for (const m of source.matchAll(/record((?:\.[a-z_][a-z0-9_]*)+)/gi)) {
        const path = m[1].slice(1);
        if (!source.includes(`has(record.${path})`)) unguarded.push(`record.${path} in: ${source}`);
      }
    }
    expect(unguarded).toEqual([]);
  });

  it('every action predicate returns a boolean on every binding', () => {
    const faults: string[] = [];
    for (const action of ACTIONS) {
      const source = sourceOf(action.visible);
      if (!source) continue;
      for (const [label, record] of BINDINGS) {
        const verdict = evaluate(source, record);
        if (typeof verdict !== 'boolean') faults.push(`${String(action.name)} on ${label}: ${verdict}`);
      }
    }
    expect(faults).toEqual([]);
  });
});

describe('#8990 — the fail-closed intent survives as a real false, and the levers still open', () => {
  it('an absent viewer block closes every viewer-gated lever', () => {
    const row = { status: 'pending' };
    for (const name of ['approval_approve', 'approval_reject', 'approval_reassign', 'approval_send_back', 'approval_request_info', 'approval_remind', 'approval_recall', 'approval_resubmit']) {
      expect([name, evaluate(visibleOf(name), row)]).toEqual([name, false]);
    }
  });

  it('a current pending approver still gets approve / reject / reassign / send back / request info', () => {
    const approver = { status: 'pending', viewer: { can_act: true, can_override: false, is_submitter: false } };
    for (const name of ['approval_approve', 'approval_reject', 'approval_reassign', 'approval_send_back', 'approval_request_info']) {
      expect([name, evaluate(visibleOf(name), approver)]).toEqual([name, true]);
    }
    // Submitter levers stay closed for them.
    expect(evaluate(visibleOf('approval_remind'), approver)).toBe(false);
  });

  it('an override-only admin gets the four levers the override covers, and nothing else (#3424, +recall #12716)', () => {
    // Re-expressed for #12716. This pin previously read "the three core decision
    // levers and nothing else" — true when written, and it is the shape of pin
    // the recall override arm was expected to turn red. It did not go red (it
    // never asserted anything about recall), but its TITLE became false the
    // moment recall joined the set, so it is restated rather than left to read
    // as a claim the code no longer honours.
    const admin = { status: 'pending', viewer: { can_act: false, can_override: true, is_submitter: false } };
    expect(evaluate(visibleOf('approval_approve'), admin)).toBe(true);
    expect(evaluate(visibleOf('approval_reject'), admin)).toBe(true);
    expect(evaluate(visibleOf('approval_reassign'), admin)).toBe(true);
    // #12716 — the fourth lever. An override admin is a NON-SUBMITTER who now
    // sees Recall: the service has authorised them since #3424, and this is the
    // one lever that releases a stuck request without writing a decision on
    // someone else's behalf.
    expect(evaluate(visibleOf('approval_recall'), admin)).toBe(true);
    // `can_override` was never OR'd into the secondary levers, and still is not.
    expect(evaluate(visibleOf('approval_send_back'), admin)).toBe(false);
    expect(evaluate(visibleOf('approval_request_info'), admin)).toBe(false);
    // Nor into the remaining submitter levers — recall is the only one that
    // moved, and remind/resubmit stay shut for an actor who is not the submitter.
    expect(evaluate(visibleOf('approval_remind'), admin)).toBe(false);
    expect(evaluate(visibleOf('approval_resubmit'), { ...admin, status: 'returned' })).toBe(false);
  });

  it('the recall override arm is pending-only in effect, because `can_override` is itself pending-scoped (#12716)', () => {
    // The negative direction, and the reason the arm needs no status test of its
    // own. `attachViewers` computes
    //   can_override: row.status === 'pending' && isOverrideActor(...)
    // — ANDed — so for the SAME override actor the flag the service attaches is
    // true on `pending` and false on `returned`. Both rows below are viewer
    // blocks the service really emits: forcing `can_override: true` onto a
    // `returned` row would pin a state the server never produces, and would
    // measure CEL's grouping rather than the product's behaviour.
    //
    // That is what makes "pending-only" enforced rather than asserted in prose.
    // The flag's own scoping is pinned against the REAL service — an override
    // admin reading a genuinely `returned` request — in `approval-revise.test.ts`;
    // this pair is the predicate half of the same claim.
    const onPending = { status: 'pending', viewer: { can_act: false, can_override: true, is_submitter: false } };
    const onReturned = { status: 'returned', viewer: { can_act: false, can_override: false, is_submitter: false } };
    expect(evaluate(visibleOf('approval_recall'), onPending)).toBe(true);
    expect(evaluate(visibleOf('approval_recall'), onReturned)).toBe(false);
    // And the submitter's own `returned` arm is untouched by the new OR — the
    // revise-window withdraw stays exactly as available as it was.
    expect(evaluate(visibleOf('approval_recall'), {
      status: 'returned', viewer: { can_act: false, can_override: false, is_submitter: true },
    })).toBe(true);
  });

  it('the submitter still gets remind / recall on pending and resubmit / recall on returned', () => {
    const submitter = { can_act: false, can_override: false, is_submitter: true };
    expect(evaluate(visibleOf('approval_remind'), { status: 'pending', viewer: submitter })).toBe(true);
    expect(evaluate(visibleOf('approval_recall'), { status: 'pending', viewer: submitter })).toBe(true);
    expect(evaluate(visibleOf('approval_recall'), { status: 'returned', viewer: submitter })).toBe(true);
    expect(evaluate(visibleOf('approval_resubmit'), { status: 'returned', viewer: submitter })).toBe(true);
    // Terminal states close all three.
    expect(evaluate(visibleOf('approval_remind'), { status: 'approved', viewer: submitter })).toBe(false);
    expect(evaluate(visibleOf('approval_recall'), { status: 'approved', viewer: submitter })).toBe(false);
    expect(evaluate(visibleOf('approval_resubmit'), { status: 'pending', viewer: submitter })).toBe(false);
  });
});

describe('#8990 — why the guard form is leaf-first (measured, not preferred)', () => {
  /**
   * These four pins are the reason `record.viewer != null` is absent from the
   * migrated predicates. They record the measurement so the next author reading
   * the canonical `has(record.x) && record.x != null` rule and "completing" it
   * here can see that the completion is what breaks it.
   */
  it('the canonical two-term conjunction is NOT sufficient over a nested read', () => {
    const canonical = 'has(record.viewer) && record.viewer != null && record.viewer.can_act';
    expect(evaluate(canonical, { viewer: {} })).toBe('FAULT No such key: can_act');
    expect(evaluate(canonical, { viewer: { can_act: null } }))
      .toBe("FAULT Logical operator requires bool operands, got 'null'");
  });

  it('guarding the leaf subsumes the parent != null half', () => {
    const leafFirst = 'has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true';
    expect(evaluate(leafFirst, {})).toBe(false);
    expect(evaluate(leafFirst, { viewer: null })).toBe(false);
    expect(evaluate(leafFirst, { viewer: {} })).toBe(false);
    expect(evaluate(leafFirst, { viewer: { can_act: null } })).toBe(false);
    expect(evaluate(leafFirst, { viewer: { can_act: true } })).toBe(true);
  });

  it('the outer has() is load-bearing — the leaf guard alone still faults on an absent root', () => {
    expect(evaluate('has(record.viewer.can_act) && record.viewer.can_act == true', {}))
      .toBe('FAULT No such key: viewer');
  });

  it('the `== true` comparison is load-bearing — a bare truthy read of a null leaf faults', () => {
    expect(evaluate('has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act', { viewer: { can_act: null } }))
      .toBe("FAULT Logical operator requires bool operands, got 'null'");
  });
});
