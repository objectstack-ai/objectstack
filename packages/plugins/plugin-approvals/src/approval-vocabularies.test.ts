// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two approval vocabularies are DERIVED from the contract, not re-typed
 * (#3786).
 *
 * `sys_approval_request.status` and `sys_approval_action.action` used to spell
 * their option lists out — five values and twelve — each under a "Keep in sync
 * with `ApprovalStatus` / `ApprovalActionKind` (spec/contracts)" comment. They
 * happened to agree, but nothing made them, and both directions of drift are
 * quiet: a value the column accepts and the contract omits is invisible to every
 * consumer typed against the contract, while one the contract declares and the
 * column rejects surfaces only at write time, on whichever tenant first reaches
 * that transition. An audit vocabulary is a bad place for either.
 *
 * Both columns now spread `APPROVAL_STATUSES` / `APPROVAL_ACTION_KINDS`, so
 * disagreement is unrepresentable **while the spread is there**. What this file
 * pins is exactly that qualifier: it fails if someone re-inlines a literal that
 * has drifted. It cannot catch an identical re-inline — that is correct today
 * and fragile tomorrow — which is why the derivation, not this test, is the
 * mechanism.
 */

import { describe, it, expect } from 'vitest';
import {
  APPROVAL_STATUSES,
  APPROVAL_STATUS_LABELS,
  APPROVAL_ACTION_KINDS,
  APPROVAL_ACTION_KIND_LABELS,
} from '@objectstack/spec/contracts';

import { SysApprovalRequest } from './sys-approval-request.object.js';
import { SysApprovalAction } from './sys-approval-action.object.js';

/** `Field.select` normalizes options to either bare strings or `{ value, label }`. */
const optionValues = (obj: unknown, field: string): string[] => {
  const raw = (obj as any)?.fields?.[field]?.options ?? [];
  return raw.map((o: unknown) => (typeof o === 'string' ? o : (o as any)?.value));
};

const optionLabels = (obj: unknown, field: string): string[] => {
  const raw = (obj as any)?.fields?.[field]?.options ?? [];
  return raw.map((o: unknown) => (typeof o === 'string' ? o : (o as any)?.label));
};

describe('approval vocabularies are derived from @objectstack/spec/contracts (#3786)', () => {
  it('the contract vocabularies are non-empty and reachable', () => {
    // Guard the guard: an unresolvable import would make both assertions below
    // compare an empty list against an empty list and pass.
    expect(APPROVAL_STATUSES.length).toBeGreaterThan(3);
    expect(APPROVAL_ACTION_KINDS.length).toBeGreaterThan(8);
  });

  it('sys_approval_request.status offers exactly the contract statuses, in order', () => {
    expect(optionValues(SysApprovalRequest, 'status')).toEqual([...APPROVAL_STATUSES]);
  });

  it('sys_approval_action.action offers exactly the contract action kinds, in order', () => {
    expect(optionValues(SysApprovalAction, 'action')).toEqual([...APPROVAL_ACTION_KINDS]);
  });

  it('sys_approval_request.status labels are the authored contract labels (#8543)', () => {
    // The English display text lives in APPROVAL_STATUS_LABELS, beside the
    // vocabulary — never re-typed at the column, and the generated `en` bundle
    // is a verbatim copy of it. A raw machine value leaking into a label here
    // is exactly the defect #8543/#8580 closed.
    expect(optionLabels(SysApprovalRequest, 'status')).toEqual(
      APPROVAL_STATUSES.map((s) => APPROVAL_STATUS_LABELS[s]),
    );
    expect(optionLabels(SysApprovalRequest, 'status')).not.toEqual(
      optionValues(SysApprovalRequest, 'status'),
    );
  });

  it('sys_approval_action.action labels are the authored contract labels (#8580)', () => {
    // The #7232 humanization covered `status` and missed this sibling — the
    // shipped en bundle rendered `submit` / `request_info` raw. The labels now
    // derive from APPROVAL_ACTION_KIND_LABELS in the contract.
    expect(optionLabels(SysApprovalAction, 'action')).toEqual(
      APPROVAL_ACTION_KINDS.map((k) => APPROVAL_ACTION_KIND_LABELS[k]),
    );
    expect(optionLabels(SysApprovalAction, 'action')).not.toEqual(
      optionValues(SysApprovalAction, 'action'),
    );
  });

  it('the two vocabularies stay distinct', () => {
    // A copy-paste that pointed one column at the other constant would satisfy
    // "derived from the contract" while being the wrong vocabulary entirely.
    expect([...APPROVAL_STATUSES]).not.toEqual([...APPROVAL_ACTION_KINDS]);
    expect(optionValues(SysApprovalRequest, 'status')).not.toEqual(
      optionValues(SysApprovalAction, 'action'),
    );
  });
});
