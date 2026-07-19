// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Contract test for the server-declared decision actions on
 * `sys_approval_request` (objectui#2678 P2-4 / retire-hardcoded-buttons).
 *
 * The console's generic action runtime renders + executes these wherever the
 * object is surfaced (the approvals inbox included), so the inbox no longer
 * hand-writes a button per capability. That only holds if the declared set
 * stays faithful to the REST routes it targets and to the who-can-act gating.
 * This pins both:
 *
 *   • every `type:'api'` target resolves `{id}` and points at a route that the
 *     REST server actually registers (approve/reject/reassign/recall/remind/
 *     request-info/revise/resubmit) — a typo'd verb would 404 silently in the UI;
 *   • submitter-only levers (remind/recall/resubmit) gate on
 *     `submitter_id == ctx.user.id` so a non-submitter never sees them.
 */

import { describe, it, expect } from 'vitest';
import { SysApprovalRequest } from './sys-approval-request.object.js';

const actions = (SysApprovalRequest as any).actions as any[];
const byName = (n: string) => actions.find((a) => a.name === n);
/** `ObjectSchema.create` normalizes `visible` strings into a
 *  `{ dialect: 'cel', source }` envelope — read the source for substring asserts. */
const vis = (n: string): string => {
  const v = byName(n).visible;
  return typeof v === 'string' ? v : String(v?.source ?? '');
};

/** Verbs the REST server registers under `/api/v1/approvals/requests/:id/*`. */
const ROUTE_VERBS = new Set([
  'approve', 'reject', 'reassign', 'recall', 'remind', 'request-info', 'revise', 'resubmit',
]);

describe('sys_approval_request declared actions', () => {
  it('declares the full decision + continuity set', () => {
    expect(actions.map((a) => a.name).sort()).toEqual(
      [
        'approval_approve',
        'approval_recall',
        'approval_reassign',
        'approval_reject',
        'approval_remind',
        'approval_request_info',
        'approval_resubmit',
        'approval_send_back',
      ].sort(),
    );
  });

  it('every api target points at a registered approvals route verb and injects {id}', () => {
    for (const a of actions) {
      expect(a.type).toBe('api');
      expect(a.method).toBe('POST');
      const m = /^\/api\/v1\/approvals\/requests\/\{id\}\/([a-z-]+)$/.exec(a.target);
      expect(m, `${a.name} target ${a.target}`).not.toBeNull();
      expect(ROUTE_VERBS.has(m![1]), `${a.name} → ${m![1]}`).toBe(true);
      expect(a.refreshAfter).toBe(true);
    }
  });

  it('gates submitter-only levers on the current user; approver actions only on pending', () => {
    for (const name of ['approval_remind', 'approval_recall', 'approval_resubmit']) {
      expect(vis(name)).toContain('record.submitter_id == ctx.user.id');
    }
    // Approver-side actions defer who-can-act to the service; they only trim the
    // non-pending case in the UI.
    for (const name of ['approval_approve', 'approval_reject', 'approval_send_back', 'approval_request_info', 'approval_reassign']) {
      expect(vis(name)).toContain('record.status == "pending"');
      expect(vis(name)).not.toContain('ctx.user.id');
    }
  });

  it('recall stays available while a returned request is still the submitter\'s to abandon', () => {
    expect(vis('approval_recall')).toContain('record.status == "returned"');
    expect(byName('approval_recall').confirmText).toBeTruthy();
  });

  it('reassign collects the new approver via a field-backed sys_user picker keyed as `to`', () => {
    const toParam = byName('approval_reassign').params.find((p: any) => p.name === 'to');
    expect(toParam).toMatchObject({ field: 'submitter_id', name: 'to', required: true });
  });

  it('request-info requires a comment; other params stay optional', () => {
    const ri = byName('approval_request_info').params.find((p: any) => p.name === 'comment');
    expect(ri.required).toBe(true);
    for (const name of ['approval_send_back', 'approval_remind', 'approval_recall', 'approval_resubmit']) {
      const c = byName(name).params.find((p: any) => p.name === 'comment');
      expect(c.required ?? false).toBe(false);
    }
  });
});
