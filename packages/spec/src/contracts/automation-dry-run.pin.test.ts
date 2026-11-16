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
 *  3. **The closed unions.** The five statuses, the two refusal codes (each
 *     an existing `AutomationResult.code` member, none minted), the seven
 *     step kinds, the three-way write permission and the six stop reasons.
 *  4. **The documented semantics, and the answer order.** The method's doc block states each ruled
 *     point (writes, identity, admission, approvals and waits, outbound
 *     nodes, unarmed and unregistered, the start condition, step order). Prose is unassertable except by
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
    FlowDryRunWritePermission,
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
export const DRY_RUN_STATUSES = ['completed', 'condition_not_met', 'stopped', 'failed', 'refused'] as const satisfies readonly FlowDryRunStatus[];
export type StatusIsExactlyTheFive = Assert< Eq< FlowDryRunStatus, (typeof DRY_RUN_STATUSES)[number] > >;
export type ResultStatusIsTheUnion = Assert< Eq< FlowDryRunResult['status'], FlowDryRunStatus > >;

export const DRY_RUN_REFUSAL_CODES = ['PERMISSION_DENIED', 'FLOW_INPUT_SCHEMA_INVALID'] as const satisfies readonly FlowDryRunRefusalCode[];
export type RefusalCodeIsExactlyTheTwo = Assert< Eq< FlowDryRunRefusalCode, (typeof DRY_RUN_REFUSAL_CODES)[number] > >;
// @ts-expect-error — registration refuses a definition with no start node, so a dry run throws before it could answer this code.
export const noStartNodeCode: FlowDryRunRefusalCode = 'FLOW_NO_START_NODE';
export type StartConditionShape = Assert< Eq<
    NonNullable< FlowDryRunResult['startCondition'] >,
    { expression: string; result: false; fault?: never } | { expression: string; fault: string; result?: never }
> >;
// @ts-expect-error — a start condition either did not hold or could not be evaluated, never both.
export const bothResultAndFault: NonNullable< FlowDryRunResult['startCondition'] > = { expression: 'record.x', result: false, fault: 'boom' };
/** No code is minted: every refusal code is an existing `AutomationResult.code` member. */
export type RefusalCodesAreExisting = Assert< Eq< FlowDryRunRefusalCode extends NonNullable< AutomationResult['code'] > ? true : false, true > >;
export type ResultRefusalShape = Assert< Eq< NonNullable< FlowDryRunResult['refusal'] >, { code: FlowDryRunRefusalCode; message: string } > >;

export const DRY_RUN_STEP_KINDS = ['route', 'assignment', 'decision', 'read', 'write', 'outbound', 'stop'] as const satisfies readonly FlowDryRunStep['kind'][];
export type StepKindIsExactlyTheSeven = Assert< Eq< FlowDryRunStep['kind'], (typeof DRY_RUN_STEP_KINDS)[number] > >;
export type WriteOperations = Assert< Eq< Extract< FlowDryRunStep, { kind: 'write' } >['operation'], 'create' | 'update' | 'delete' > >;
export type StopReasons = Assert< Eq< Extract< FlowDryRunStep, { kind: 'stop' } >['reason'], 'approval' | 'wait' | 'screen' | 'starts_flow' | 'suspends' | 'not_simulated' > >;
export const WRITE_PERMISSIONS = ['allowed', 'refused', 'not_judged'] as const satisfies readonly FlowDryRunWritePermission[];
export type WritePermissionIsExactlyTheThree = Assert< Eq< FlowDryRunWritePermission, (typeof WRITE_PERMISSIONS)[number] > >;
/** Every write step answers the permission; it is never left out. */
export type WriteStepPermissionRequired = Assert< Eq< Extract< FlowDryRunStep, { kind: 'write' } >['permission'], FlowDryRunWritePermission > >;
/** A decision reports every expression that held, not one. */
export type DecisionExpressions = Assert< Eq< Extract< FlowDryRunStep, { kind: 'decision' } >['expressions'], string[] > >;

/** A result an implementation can build without a cast: one ordered step list. */
export const stoppedAtApproval: FlowDryRunResult = {
    status: 'stopped',
    steps: [
        { kind: 'route', nodeId: 'start', nodeType: 'start' },
        { kind: 'decision', nodeId: 'big_deal', nodeType: 'decision', branch: 'big', expressions: ['record.amount > 100000'], next: ['create_task'] },
        { kind: 'write', nodeId: 'create_task', nodeType: 'create_record', operation: 'create', object: 'task', recordIds: ['dryrun:create_task:1'], values: { subject: 'Review' }, permission: 'allowed' },
        { kind: 'assignment', nodeId: 'remember', nodeType: 'assignment', values: { taskId: 'dryrun:create_task:1' } },
        { kind: 'outbound', nodeId: 'tell_owner', nodeType: 'notify', payload: { to: ['usr_owner'], body: 'Review' } },
        { kind: 'stop', nodeId: 'approve', nodeType: 'approval', reason: 'approval', approvers: ['usr_manager'] },
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
            permission: 'refused',
            refusal: { code: 'PERMISSION_DENIED', message: 'the named user may not update opportunity' },
        },
    ],
    error: 'update_record close_deal: the named user may not update opportunity',
};
export const conditionNotMet: FlowDryRunResult = {
    status: 'condition_not_met',
    steps: [],
    startCondition: { expression: 'record.stage == "won" && previous.stage != "won"', result: false },
};
/** A start condition that throws when evaluated: `'failed'`, no steps, the fault beside the condition. */
export const conditionFaulted: FlowDryRunResult = {
    status: 'failed',
    steps: [],
    startCondition: {
        expression: 'record.amount > "high"',
        fault: 'condition failed to evaluate as CEL: no such overload — source: `record.amount > "high"`.',
    },
    error: 'condition failed to evaluate as CEL: no such overload — source: `record.amount > "high"`.',
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
            '**The name.**',
            '**Step order.**',
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
            'is admitted to a\n     *    dry run for the named user',
            'The run is\n     *    never elevated: every read and every permission judgement is the\n     *    named user\'s.',
            'the widening is the dry run\'s alone.',
            "`status: 'condition_not_met'`",
            "`'not_judged'` never means allowed.",
            'the simulated fields laid over it',
            'holds only the fields the flow set',
            'each branch\'s steps together',
            'could not continue past this',
            'With no object-level check\n     *    installed, every write step answers `\'not_judged\'`.',
            "its step carries\n     *    `refusal` (`code: 'PERMISSION_DENIED'`)",
            "For a node's unconditional\n     * out-edges this is the dry run's own order",
            "A `condition` whose evaluation throws",
            "`status: 'failed'` and no steps, the condition and the thrown message\n     *    in `startCondition` (`fault`)",
            'cannot fire for a dry run: a dry run holds no\n     *    active-run key and writes nothing.',
            "On the default error strategy that is\n     *    the live run's answer",
            "Under `errorHandling.strategy: 'retry'` the answer is the dry run's\n     *    own",
        ]) {
            expect(doc, sentence).toContain(sentence);
        }
        // Ruling B (record 6917953931) replaced the by-name refusal of an
        // elevated self-triggered draft; the refusal sentence is gone.
        expect(doc).not.toContain('is refused for\n     *    every named user.');
        // After ruling B no dry-run admission rule reads the definition's `type`.
        expect(doc).toContain("judged on the supplied definition's `runAs`\n     * and `requiredPermissions` against the named user.");
        expect(doc).not.toContain("judged on the supplied definition's `type`");
    });

    it('a faulting start condition follows the live run only on the default error strategy (#33935)', () => {
        const source = readFileSync(fileURLToPath(new URL('./automation-service.ts', import.meta.url)), 'utf8');
        const statusEnd = source.indexOf('export type FlowDryRunStatus =');
        const resultStart = source.indexOf('export interface FlowDryRunResult {');
        const methodEnd = source.indexOf('dryRun?(definition: unknown, options: FlowDryRunOptions)');
        const docs = {
            "the 'failed' status doc": source.slice(source.lastIndexOf('/**', statusEnd), statusEnd),
            'the startCondition doc': source.slice(resultStart, source.indexOf('startCondition?:', resultStart)),
            'the dryRun doc block': source.slice(source.lastIndexOf('/**', methodEnd), methodEnd),
        };
        for (const [where, doc] of Object.entries(docs)) {
            expect(doc, where).toContain('On the default error strategy');
            expect(doc, where).toContain("`errorHandling.strategy: 'retry'`");
            expect(doc, where).toContain('#33935');
        }
        expect(docs["the 'failed' status doc"]).toContain("Under\n *    `errorHandling.strategy: 'retry'` it is the dry run's own answer, not a\n *    prediction");
        expect(source).not.toContain('This one follows the live run, whose');
    });

    it('answers in the live run\'s order: admission, then the start condition (unmet, then faulted), then the input-schema check', () => {
        const source = readFileSync(fileURLToPath(new URL('./automation-service.ts', import.meta.url)), 'utf8');
        const end = source.indexOf('dryRun?(definition: unknown, options: FlowDryRunOptions)');
        const doc = source.slice(source.lastIndexOf('/**', end), end);
        const order = [
            doc.indexOf("then admission: `status: 'refused'`, `PERMISSION_DENIED` in"),
            doc.indexOf('Then the start condition.'),
            doc.indexOf('A `condition` whose evaluation throws'),
            doc.indexOf('Then the node input-schema check'),
        ];
        expect(order.every((i, k) => i >= 0 && (k === 0 || order[k - 1] < i)), `answer order at ${order.join(', ')}`).toBe(true);
    });
});
