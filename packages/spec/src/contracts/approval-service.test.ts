// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#10331] `organization_id` existed on the wire (plugin-approvals stamps it
// on insert and `rowFromRequest` returns it) but not on the published row
// types, so every consumer cast past the contract to reach it. These pins keep
// the declaration honest: the field must stay readable off the DECLARED types
// without a cast, at the exact optional-nullable shape the write expression
// produces (`context.organizationId ?? context.tenantId ?? input.organizationId
// ?? null` — a resolved org id, or `null` when none resolved, or absent on
// rows written before stamping existed).

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { ApprovalActionRow, ApprovalRequestRow } from './approval-service';

describe('approval row organization_id declaration (#10331)', () => {
    it('is readable off ApprovalRequestRow without a cast, at the stamped shape', () => {
        // Reading the property off the declared type — no `as`, no indexing
        // through `any`. This line failing to compile is the regression.
        const read = (row: ApprovalRequestRow): string | null | undefined => row.organization_id;

        // Exactly `string | null | undefined`: `null` is the write path's
        // "no org resolved" value and must not be silently narrowed away.
        expectTypeOf<ApprovalRequestRow['organization_id']>().toEqualTypeOf<string | null | undefined>();

        // Optional: a row written before the stamp existed still satisfies the
        // type (this object literal fails to compile if the field is required).
        const preStamp: ApprovalRequestRow = {
            id: 'req_1',
            process_name: 'flow:review',
            object_name: 'showcase_project',
            record_id: 'rec_1',
            status: 'pending',
        };
        expect(read(preStamp)).toBeUndefined();
        expect(read({ ...preStamp, organization_id: null })).toBeNull();
        expect(read({ ...preStamp, organization_id: 'o_plant' })).toBe('o_plant');
    });

    it('is readable off ApprovalActionRow without a cast, at the stamped shape', () => {
        // Every `sys_approval_action` insert site stamps the owning request's
        // org on the persisted row; see the field's docblock for the read-path
        // caveat (the service's `rowFromAction` mapping does not surface it).
        const read = (row: ApprovalActionRow): string | null | undefined => row.organization_id;

        expectTypeOf<ApprovalActionRow['organization_id']>().toEqualTypeOf<string | null | undefined>();

        const minimal: ApprovalActionRow = {
            id: 'aact_1',
            request_id: 'req_1',
            action: 'submit',
        };
        expect(read(minimal)).toBeUndefined();
        expect(read({ ...minimal, organization_id: null })).toBeNull();
        expect(read({ ...minimal, organization_id: 'o_plant' })).toBe('o_plant');
    });
});
