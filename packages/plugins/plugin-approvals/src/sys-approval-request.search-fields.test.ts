// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24625] `sys_approval_request` free-text search scans everything the
 * ADR-0061 auto-default would, except the snapshot. A `$search` names every
 * searched column, and the snapshot guard refuses a query naming
 * `payload_json` to any reader withheld a field of any object — so with the
 * snapshot searched, such a reader's list search and global search sweep were
 * a 403. The declared list is held to the auto-default minus the snapshot, so
 * a textual field added later is a red here rather than silently unsearched.
 */

import { describe, it, expect } from 'vitest';
import { resolveSearchFields } from '@objectstack/spec/data';
import { SysApprovalRequest } from './sys-approval-request.object.js';

const fields = SysApprovalRequest.fields as Record<string, { type?: string }>;

describe('sys_approval_request free-text search set', () => {
  it('is the auto-default set without the snapshot column', () => {
    const declared = resolveSearchFields({ fields, searchableFields: SysApprovalRequest.searchableFields });
    const auto = resolveSearchFields({ fields });
    expect(auto).toContain('payload_json');
    expect(declared).not.toContain('payload_json');
    expect([...declared].sort()).toEqual(auto.filter((f) => f !== 'payload_json').sort());
  });
});
