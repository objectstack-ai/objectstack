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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
    ApprovalActionRow,
    ApprovalRequestRow,
    ApprovalStatus,
    IApprovalService,
} from './approval-service';

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

// ---------------------------------------------------------------------------
// [#15389] `continueRestoredRun` — the approvals half of the operator repair
// pair, declared on the contract.
//
// The maintainer ruling of 2026-09-09 (decision batch #106, item 3) settled
// option A: the verb is declared on `IApprovalService` as an OPTIONAL member,
// with the shape and docblock discipline #16495 gave
// `IAutomationService.cancelRun` / `restoreConsumedSuspension`. These pins are
// that block's sibling, and they hold the three things the ruling actually
// decided: the member exists, it is optional, and it carries the ruled posture
// in its docblock — including the note that promising a repair verb that will
// refuse is worse than promising nothing.
//
// The type-level identities are exported aliases for the same reason the
// #16495 block's are: an unread alias inside a test body is TS6196, and a pin
// no program compiles is no pin at all. `check:test-typecheck` compiles this
// file.
// ---------------------------------------------------------------------------

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ContinueRestoredRun = NonNullable<IApprovalService['continueRestoredRun']>;

/**
 * `continueRestoredRun(requestId, options?)` — who asked and why travel
 * through the contract, exactly as they do on the engine verb this completes.
 */
export type ContinueTakesRequestIdAndOptions = Assert<
    Eq<Parameters<ContinueRestoredRun>, [requestId: string, options?: { requestedBy?: string; reason?: string }]>
>;

/**
 * The replay result: what moved, which run, which outcome and edge, and
 * whether the signal was the literal one or was rebuilt. A dropped or widened
 * member turns this alias red.
 */
export type ContinueAnswersTheReplayResult = Assert<
    Eq<
        Awaited<ReturnType<ContinueRestoredRun>>,
        {
            resumed: boolean;
            runId: string;
            decision: string;
            branchLabel?: string;
            source: 'journal' | 'reconstructed';
            resumeError?: string;
        }
    >
>;

/** A conforming request row, at the minimum the contract requires. */
const requestRow = (id: string, status: ApprovalStatus): ApprovalRequestRow => ({
    id,
    process_name: 'flow:expense_review',
    object_name: 'expense',
    record_id: 'rec_1',
    status,
});

/**
 * The smallest thing that satisfies `IApprovalService` — every REQUIRED member
 * and nothing else. It is the population the optionality pin is about: a
 * service with no operator repair verb still conforms.
 */
const minimalService = (): IApprovalService => ({
    listRequests: async () => [],
    countRequests: async () => 0,
    getRequest: async () => null,
    decide: async (requestId) => ({ request: requestRow(requestId, 'approved'), finalized: true, decision: 'approve' }),
    recall: async (requestId) => ({ request: requestRow(requestId, 'recalled') }),
    sendBack: async (requestId) => ({ request: requestRow(requestId, 'returned') }),
    resubmit: async (requestId) => ({ request: requestRow(requestId, 'returned') }),
    reassign: async (requestId) => ({ request: requestRow(requestId, 'pending') }),
    remind: async (requestId) => ({ request: requestRow(requestId, 'pending'), notified: 0 }),
    requestInfo: async (requestId) => ({ request: requestRow(requestId, 'pending') }),
    comment: async (requestId) => ({ request: requestRow(requestId, 'pending') }),
    listActions: async () => [],
});

describe('[#15389] continueRestoredRun — the approvals operator repair verb, declared', () => {
    it('is optional: the minimal implementation still conforms and has no operator door', () => {
        const service = minimalService();

        // The ruled optionality. A door standing in front of THIS service has
        // to probe and refuse fail-closed — it may not call and report success.
        expect(service.continueRestoredRun).toBeUndefined();
    });

    it('carries the signature through the contract — who asked, and why, reach the implementation', async () => {
        const seen: Array<Record<string, unknown>> = [];
        const service: IApprovalService = {
            ...minimalService(),
            continueRestoredRun: async (requestId, options) => {
                seen.push({ requestId, ...options });
                return requestId === 'req_journalled'
                    ? {
                          resumed: true,
                          runId: 'run_stranded',
                          decision: 'reject',
                          branchLabel: 'reject',
                          source: 'journal',
                      }
                    : {
                          resumed: true,
                          runId: 'run_stranded',
                          decision: 'reject',
                          branchLabel: 'reject',
                          source: 'reconstructed',
                          resumeError: 'a concurrent resume is already advancing this run',
                      };
            },
        };

        const exact = await service.continueRestoredRun!('req_journalled', {
            requestedBy: 'ops@example.com',
            reason: 'notify node fixed; re-issuing the recorded rejection',
        });
        expect(exact.resumed).toBe(true);
        expect(exact.runId).toBe('run_stranded');
        // The outcome is REPLAYED, never re-decided: it is the one already on
        // the row, and the edge it walks is the one it always walked.
        expect(exact.decision).toBe('reject');
        expect(exact.branchLabel).toBe('reject');
        // `journal` is the literal re-issue; `reconstructed` is the inferred
        // one. A caller that cannot tell them apart cannot say what it trusts.
        expect(exact.source).toBe('journal');
        expect(exact.resumeError).toBeUndefined();

        const rebuilt = await service.continueRestoredRun!('req_pre_journal');
        expect(rebuilt.source).toBe('reconstructed');
        expect(rebuilt.resumeError).toContain('concurrent resume');

        // The optional parameters ARE the reason the signature follows the
        // implementation: an operator repair records who asked and why.
        expect(seen).toEqual([
            {
                requestId: 'req_journalled',
                requestedBy: 'ops@example.com',
                reason: 'notify node fixed; re-issuing the recorded rejection',
            },
            { requestId: 'req_pre_journal' },
        ]);
    });

    it('refuses a replay result that omits `source` (compile-time, under check:test-typecheck)', () => {
        const service: IApprovalService = {
            ...minimalService(),
            // @ts-expect-error — `source` is required: a caller told a run moved, but not whether the
            // signal was the literal one or a rebuild, cannot tell an exact replay from an inferred one.
            continueRestoredRun: async (_requestId) => ({ resumed: true, runId: 'run_stranded', decision: 'reject' }),
        };

        expect(service.continueRestoredRun).toBeDefined();
    });

    it('the docblock carries the ruled posture: no re-decision, no door, and the promising-nothing note', () => {
        const source = readFileSync(fileURLToPath(new URL('./approval-service.ts', import.meta.url)), 'utf8');
        const at = source.indexOf('continueRestoredRun?(');
        expect(at).toBeGreaterThan(-1);
        // The doc block immediately above the declaration — from its last `/**`.
        const doc = source.slice(source.lastIndexOf('/**', at), at);

        // The sibling this was ruled to copy, named where a later author reads it.
        expect(doc).toContain('#16495');
        // What the engine verb leaves undone, which is the whole reason this exists.
        expect(doc).toMatch(/the continuation must be[\s*]+re-issued/);
        // ⛔ It replays a recorded outcome; it does not re-decide.
        expect(doc).toMatch(/does not re-open, re-decide or rewrite the request row/);
        expect(doc).toMatch(/does not relax the node's `resumeAuthority: 'service'`/);
        // Optional ⇒ absent means no door, and the door refuses fail-closed.
        expect(doc).toMatch(/NO[\s*]+operator door/);
        expect(doc).toMatch(/refuse[\s*]+fail-closed/);
        // The #16495 note, in its own words — the reason optionality is not a shrug.
        expect(doc).toMatch(/promising a repair verb that will refuse is worse[\s*]+than promising nothing/);
        // C was refused: declaring the member is not declaring a route.
        expect(doc).toMatch(/refused a REST\/CLI route/);
    });
});
