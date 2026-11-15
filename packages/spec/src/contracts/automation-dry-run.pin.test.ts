// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33757] `IAutomationService.dryRun`: run a flow definition that need not be
 * published, once, unarmed, as a named user, against a supplied start, without
 * changing live data. The contract half of #33661, which implements it.
 *
 * Pinned at the type level, because a TypeScript interface member has no Zod
 * schema to assert against (the `automation-toggle-flow-caller` pin's form,
 * compiled by `check:test-typecheck` under `tsconfig.test.json`):
 *
 *  1. **The signature.** Optional, `(definition: unknown, options:
 *     FlowDryRunOptions) => Promise<FlowDryRunResult>`, so an implementation
 *     without it still satisfies the contract.
 *  2. **The options name a user and carry no grants.** `userId` is a required
 *     string; positions, permission sets, posture and email do not compile, so
 *     a caller cannot dry-run with grants the user does not hold.
 *  3. **The closed unions.** The four statuses, the three refusal codes (each
 *     an existing `AutomationResult.code` member, none minted) and the seven
 *     step kinds.
 *  4. **The documented semantics.** The method's doc block states each ruled
 *     point (writes, identity, admission, approvals and waits, outbound
 *     nodes, unarmed and unregistered). Prose is unassertable except by
 *     reading it, so the contract source is read.
 *
 * ⛔ Not pinned here: the behaviour. That is #33661, in
 * `@objectstack/service-automation` and `@objectstack/runtime`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import type {
    AutomationResult,
    FlowDryRunOptions,
    FlowDryRunRefusalCode,
    FlowDryRunResult,
    FlowDryRunStatus,
    FlowDryRunStep,
    IAutomationService,
} from './automation-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

type DryRun = NonNullable< IAutomationService['dryRun'] >;

// Exported deliberately — an unread alias is TS6196, and a pin no program compiles is no pin at all.

/** 1. The signature. */
export type DryRunSignature = Assert< Eq< DryRun, (definition: unknown, options: FlowDryRunOptions) => Promise< FlowDryRunResult > > >;
/** Optional: the member may be absent. */
export type DryRunIsOptional = Assert< Eq< undefined extends IAutomationService['dryRun'] ? true : false, true > >;
export class ServiceWithoutDryRun implements Pick< IAutomationService, 'execute' | 'listFlows' | 'dryRun' > {
    async execute() { return { success: true }; }
    async listFlows() { return []; }
}

/** 2. The options: a required acting user, and the start keys `execute` reads. */
export type UserIdIsRequired = Assert< Eq< FlowDryRunOptions['userId'], string > >;
export type UserIdNotOptional = Assert< Eq< {} extends Pick< FlowDryRunOptions, 'userId' > ? true : false, false > >;
export const minimalOptions: FlowDryRunOptions = { userId: 'usr_maker' };
export const startOptions: FlowDryRunOptions = {
    userId: 'usr_maker',
    object: 'opportunity',
    event: 'on_update',
    record: { id: 'opp_1', stage: 'won' },
    previous: { id: 'opp_1', stage: 'open' },
    params: { note: 'x' },
    locale: 'zh-CN',
    tenantId: 'org_1',
};
// @ts-expect-error — the acting user is required.
export const noUser: FlowDryRunOptions = { record: { id: 'opp_1' } };
// @ts-expect-error — no grants: the engine resolves the named user's own positions.
export const withPositions: FlowDryRunOptions = { userId: 'usr_maker', positions: ['admin'] };
// @ts-expect-error — no grants: the engine resolves the named user's own permission sets.
export const withPermissions: FlowDryRunOptions = { userId: 'usr_maker', permissions: ['modify_all'] };
// @ts-expect-error — no grants: the engine resolves the named user's own posture.
export const withPosture: FlowDryRunOptions = { userId: 'usr_maker', posture: 'PLATFORM_ADMIN' };
// @ts-expect-error — no grants: the engine resolves the named user's own email.
export const withEmail: FlowDryRunOptions = { userId: 'usr_maker', email: 'boss@example.com' };
// @ts-expect-error — the run is never elevated: there is no run-as channel.
export const withRunAs: FlowDryRunOptions = { userId: 'usr_maker', runAs: 'system' };

/** 3. The closed unions, spelled once. `satisfies` proves membership; `Eq` proves there is nothing else. */
export const DRY_RUN_STATUSES = ['completed', 'stopped', 'failed', 'refused'] as const satisfies readonly FlowDryRunStatus[];
export type StatusIsExactlyTheFour = Assert< Eq< FlowDryRunStatus, (typeof DRY_RUN_STATUSES)[number] > >;
export type ResultStatusIsTheUnion = Assert< Eq< FlowDryRunResult['status'], FlowDryRunStatus > >;

export const DRY_RUN_REFUSAL_CODES = ['PERMISSION_DENIED', 'FLOW_NO_START_NODE', 'FLOW_INPUT_SCHEMA_INVALID'] as const satisfies readonly FlowDryRunRefusalCode[];
export type RefusalCodeIsExactlyTheThree = Assert< Eq< FlowDryRunRefusalCode, (typeof DRY_RUN_REFUSAL_CODES)[number] > >;
/** No code is minted: every refusal code is an existing `AutomationResult.code` member. */
export type RefusalCodesAreExisting = Assert< Eq< FlowDryRunRefusalCode extends NonNullable< AutomationResult['code'] > ? true : false, true > >;
export type ResultRefusalShape = Assert< Eq< NonNullable< FlowDryRunResult['refusal'] >, { code: FlowDryRunRefusalCode; message: string } > >;

export const DRY_RUN_STEP_KINDS = ['route', 'assignment', 'decision', 'read', 'write', 'outbound', 'stop'] as const satisfies readonly FlowDryRunStep['kind'][];
export type StepKindIsExactlyTheSeven = Assert< Eq< FlowDryRunStep['kind'], (typeof DRY_RUN_STEP_KINDS)[number] > >;
export type WriteOperations = Assert< Eq< Extract< FlowDryRunStep, { kind: 'write' } >['operation'], 'create' | 'update' | 'delete' > >;
export type StopReasons = Assert< Eq< Extract< FlowDryRunStep, { kind: 'stop' } >['reason'], 'pause' | 'not_simulated' > >;

/** A result an implementation can build without a cast: one ordered step list. */
export const stoppedAtApproval: FlowDryRunResult = {
    status: 'stopped',
    steps: [
        { kind: 'route', nodeId: 'start', nodeType: 'start' },
        { kind: 'decision', nodeId: 'big_deal', nodeType: 'decision', branch: 'big', expression: 'record.amount > 100000', next: ['create_task'] },
        { kind: 'write', nodeId: 'create_task', nodeType: 'create_record', operation: 'create', object: 'task', recordIds: ['dryrun:create_task:1'], values: { subject: 'Review' } },
        { kind: 'assignment', nodeId: 'remember', nodeType: 'assignment', values: { taskId: 'dryrun:create_task:1' } },
        { kind: 'outbound', nodeId: 'tell_owner', nodeType: 'notify', payload: { to: ['usr_owner'], body: 'Review' } },
        { kind: 'stop', nodeId: 'approve', nodeType: 'approval', reason: 'pause', approvers: ['usr_manager'] },
    ],
};
export const refusedAtAdmission: FlowDryRunResult = {
    status: 'refused',
    steps: [],
    refusal: { code: 'PERMISSION_DENIED', message: 'This caller may not start this flow.' },
};
export const failedOnPermission: FlowDryRunResult = {
    status: 'failed',
    steps: [
        { kind: 'route', nodeId: 'start', nodeType: 'start' },
        {
            kind: 'write',
            nodeId: 'close_deal',
            nodeType: 'update_record',
            operation: 'update',
            object: 'opportunity',
            recordIds: ['opp_1'],
            values: { stage: 'closed' },
            refusal: { code: 'PERMISSION_DENIED', message: 'no edit access' },
        },
    ],
    error: 'update_record close_deal: no edit access',
};
// @ts-expect-error — a dry run has no run to resume or read back: no `runId`.
export const withRunId: FlowDryRunResult = { status: 'completed', steps: [], runId: 'run_1' };

describe('IAutomationService.dryRun — the contract (#33757)', () => {
    it('an implementation reads the options and answers the result without a cast', async () => {
        const seen: string[] = [];
        const service: Pick< IAutomationService, 'dryRun' > = {
            dryRun: async (_definition, options) => {
                seen.push(options.userId);
                return stoppedAtApproval;
            },
        };
        const result = await service.dryRun?.({ name: 'draft' }, startOptions);
        expect(seen).toEqual(['usr_maker']);
        expect(result?.steps.map((s) => s.kind)).toEqual(['route', 'decision', 'write', 'assignment', 'outbound', 'stop']);
    });

    it('a service without dryRun still satisfies the contract, and a caller finds the member absent', () => {
        const service: Pick< IAutomationService, 'execute' | 'listFlows' | 'dryRun' > = new ServiceWithoutDryRun();
        expect(service.dryRun).toBeUndefined();
    });

    it("the method's doc block states each ruled point", () => {
        const source = readFileSync(fileURLToPath(new URL('./automation-service.ts', import.meta.url)), 'utf8');
        const end = source.indexOf('dryRun?(definition: unknown, options: FlowDryRunOptions)');
        expect(end).toBeGreaterThan(0);
        const start = source.lastIndexOf('/**', end);
        const doc = source.slice(start, end);
        for (const heading of [
            '**Unarmed and unregistered.**',
            '**Identity: the named user.**',
            '**Admission: the by-name start rule.**',
            '**Writes: simulated, never made.**',
            '**Side effects outside the data.**',
            '**Approval nodes and waits: the run stops.**',
        ]) {
            expect(doc, heading).toContain(heading);
        }
        for (const sentence of [
            'It is never elevated.',
            'never registered',
            'No run is persisted',
            'no other flow, no audit row.',
            'never send or call anything',
            'no child run starts.',
            'every named user.',
        ]) {
            expect(doc, sentence).toContain(sentence);
        }
    });
});
