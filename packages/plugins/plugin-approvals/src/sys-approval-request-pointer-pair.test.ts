// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysApprovalRequest } from './sys-approval-request.object.js';

/**
 * `sys_approval_request` declares the ActivityPointer pair — #11386 (ADR-0052
 * §5, carrier landed by #11339).
 *
 * Re-verified for THIS object rather than inherited from the shape it shares
 * with the audit ledger: here the pair is not a display key, it is the key the
 * approval machinery QUERIES ON. `approval-service.ts` finds a record's open
 * request with `where: { object_name, record_id, status: 'pending' }`, and
 * `lifecycle-hooks.ts` holds the record LOCK on the same pair (single and
 * `$in` batch forms). `submit()` writes both halves from `input.object` /
 * `input.recordId`, so a stored id is always a record id of the object the
 * sibling names.
 *
 * Consequence, and why the declaration earns its place on this object: a
 * seeded request whose `record_id` stayed a verbatim natural key locked
 * nothing and surfaced under no record — a row that LOOKED pending while being
 * invisible to both queries that give it meaning.
 */
describe('sys_approval_request — declared pointer pair (#11386)', () => {
  const fields = SysApprovalRequest.fields as Record<string, Record<string, unknown>>;

  it('declares record_id as the id half, resolved through object_name', () => {
    expect(fields.record_id.referenceVia).toBe('object_name');
  });

  it('keeps the id half a plain text column with no contradicting static reference', () => {
    expect(fields.record_id.type).toBe('text');
    expect(fields.record_id.reference).toBeUndefined();
  });

  it('declares the sibling the pointer names', () => {
    expect(fields.object_name).toBeDefined();
    expect(fields.object_name.type).toBe('text');
  });

  it('keeps BOTH halves required — so an un-addressable pointer cannot be authored here at all', () => {
    // The loader's "id half authored, object half empty" refusal is reachable
    // on objects whose halves are optional (`sys_audit_log`). On this object
    // the schema forecloses it one layer earlier. Recorded because it is the
    // measured difference between two objects carrying the same pair — and
    // because `required: true` is also why a deferred pointer here cannot be
    // back-filled by pass 2 the way an optional one is.
    expect(fields.record_id.required).toBe(true);
    expect(fields.object_name.required).toBe(true);
  });
});
