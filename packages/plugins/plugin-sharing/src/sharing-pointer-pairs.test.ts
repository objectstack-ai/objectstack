// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysRecordShare } from './objects/sys-record-share.object.js';
import { SysShareLink } from './objects/sys-share-link.object.js';

/**
 * The two sharing tables declare the ActivityPointer pair — #11386 (ADR-0052
 * §5, carrier landed by #11339).
 *
 * They live in one file because they live in one package, NOT because they
 * were adopted as one decision: `record-orphan-cleanup.ts` states the shared
 * invariant ("record gone ⇒ the row cannot describe any access at all"), but
 * each table reaches it down a different path, and each was re-verified on its
 * own — see the per-object blocks below.
 *
 * What both share, and what makes the declaration matter more here than on a
 * log: an unresolved `record_id` on a grant table does not merely fail to
 * DISPLAY. It names no live record, so the row enforces nothing while
 * appearing to be a grant — and then the orphan sweep deletes it for
 * describing a record that does not exist.
 */
describe('sys_record_share — declared pointer pair (#11386)', () => {
  const fields = SysRecordShare.fields as Record<string, Record<string, unknown>>;

  it('declares record_id as the id half, resolved through object_name', () => {
    // Dereferenced as a real address, not stored as a label:
    // `sharing-service.ts` writes the pair from `input.object` /
    // `input.recordId` and gates share management on it, and the orphan sweep
    // asks per row whether `(object_name, record_id)` still exists.
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

  it('does NOT declare source_id as a pointer half — it names a sharing RULE, not a record', () => {
    // The measured near-miss on this object: `source_id` sits beside the pair,
    // is text, and reads like an id half. It is the reconciliation handle for
    // the rule that materialised the grant — no sibling column names an object
    // for it, and resolving it as a record id would be a fabricated pointer.
    expect(fields.source_id).toBeDefined();
    expect(fields.source_id.referenceVia).toBeUndefined();
  });
});

describe('sys_share_link — declared pointer pair (#11386)', () => {
  const fields = SysShareLink.fields as Record<string, Record<string, unknown>>;

  it('declares record_id as the id half, resolved through object_name', () => {
    // Verified through THIS object's own consumer, which is not the sharing
    // middleware: `share-link-routes.ts` calls `engine.find(link.object_name,
    // …)` with `record_id` as the address, and `share-link-service.ts`
    // resolves a token through the fail-closed gate
    // `if (!(await this.recordStillExists(row.object_name, row.record_id))) return null`.
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

  it('does NOT declare token as a pointer half — a capability secret is not a record address', () => {
    expect(fields.token).toBeDefined();
    expect(fields.token.referenceVia).toBeUndefined();
  });
});
