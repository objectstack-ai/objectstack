// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14328] The engine's trigger KIND is spec's answer, not a second copy of the
 * chain.
 *
 * `AutomationEngine.resolveTriggerBinding` used to hand-keep the precedence that
 * decides which trigger a flow asks for — `record-*` token, array form,
 * `timeRelative`, `schedule` cadence / `type: 'schedule'`, `type: 'api'` /
 * `triggerType: 'api'` — in parallel with `@objectstack/spec`'s
 * `resolveFlowTriggerKind`, which `defineStack`'s trigger-capability refusal and
 * `@objectstack/lint`'s `validate-flow-trigger-readiness` both read. Two
 * hand-kept copies of one rule with nothing pinning them together: a branch added
 * to one side leaves `defineStack` accepting a stack the runtime leaves inert, or
 * refusing one it would arm.
 *
 * These cases drive the REAL engine — `registerFlow` then the public
 * `getFlowRuntimeStates()` / `getTriggerBindingAudit()`, the same surfaces the CLI
 * boot banner and the kernel:bootstrapped audit read — and assert a LITERAL kind
 * per case. The literal is what discriminates: an `expect(engineKind).toBe(
 * resolveFlowTriggerKind(flow))` alone is satisfied by two wrong answers that
 * happen to agree, and by `undefined === undefined` for a case that silently
 * stopped resolving. The equality against the resolver is asserted too, but as
 * the second half of the pin, never as the whole of it.
 *
 * The last case is the coupling itself: every kind spec publishes in
 * `FLOW_TRIGGER_KINDS` must be reachable through the engine. Spec adding a fifth
 * kind reddens it — which is the drift this card closes. (The engine's `switch`
 * also fails THIS package's type-check on that day, via its `never` default;
 * this case is the runtime half of the same guard.)
 *
 * ⚠️ The ARRAY form is deliberately NOT covered here as an equality case: it is
 * the one documented divergence — `resolveFlowTriggerKind` answers `undefined`
 * for it while the engine routes it to the record-change trigger so that trigger
 * can refuse it LOUDLY at bind time. Its preservation is pinned below (routing +
 * precedence) and end-to-end, against the real trigger that emits the refusal, in
 * `@objectstack/trigger-record-change`'s
 * `array-form-refusal-end-to-end.test.ts` — the only place both halves can meet
 * without inverting a package dependency.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FLOW_TRIGGER_KINDS, resolveFlowTriggerKind } from '@objectstack/spec/automation';
import { AutomationEngine } from './engine.js';
import type { FlowTrigger, FlowTriggerBinding } from './engine.js';

function createTestLogger() {
    return { debug() {}, info() {}, warn() {}, error() {} } as any;
}

/** A minimal registrable flow whose start node carries `config`. */
function flowWith(
    name: string,
    config: Record<string, unknown>,
    type: string = 'autolaunched',
) {
    return {
        name,
        label: name,
        type,
        status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };
}

describe('[#14328] the engine takes its trigger kind from spec.resolveFlowTriggerKind', () => {
    let engine: AutomationEngine;
    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    /** The kind the REAL engine resolved, read off a public surface. */
    function engineKind(name: string): string | undefined {
        const row = engine.getFlowRuntimeStates().find((s) => s.name === name);
        expect(row, `flow '${name}' is registered`).toBeDefined();
        return row!.triggerType;
    }

    // Each row: the whole precedence chain, one literal kind each. `expected` is
    // the pre-#14328 engine's answer, written out — so a unification that got a
    // case wrong reddens here rather than being blessed by a resolver that agrees
    // with itself.
    const chain: Array<{ case: string; flow: ReturnType<typeof flowWith>; expected: string }> = [
        {
            case: 'string record-* token',
            flow: flowWith('rc', { objectName: 'task', triggerType: 'record-after-update' }),
            expected: 'record_change',
        },
        {
            case: 'timeRelative descriptor',
            flow: flowWith('tr', { timeRelative: { object: 'task', field: 'due_date' } }),
            expected: 'time_relative',
        },
        {
            case: 'timeRelative OUTRANKS its own schedule cadence (the sweep interval)',
            flow: flowWith('tr_sched', {
                timeRelative: { object: 'task', field: 'due_date' },
                schedule: { cron: '0 * * * *' },
            }),
            expected: 'time_relative',
        },
        {
            case: 'schedule cadence',
            flow: flowWith('sched', { schedule: { cron: '0 9 * * *' } }),
            expected: 'schedule',
        },
        {
            case: "type: 'schedule' with no cadence on the start node",
            flow: flowWith('sched_type', {}, 'schedule'),
            expected: 'schedule',
        },
        {
            case: "type: 'api'",
            flow: flowWith('api_type', {}, 'api'),
            expected: 'api',
        },
        {
            case: "triggerType: 'api'",
            flow: flowWith('api_token', { triggerType: 'api' }),
            expected: 'api',
        },
    ];

    for (const row of chain) {
        it(`resolves ${row.case} to '${row.expected}', and to what spec answers`, () => {
            // `registerFlow` hands back the canonicalized flow it stored — the
            // same object `this.flows` holds and the engine resolved against.
            const stored = engine.registerFlow(row.flow.name, row.flow as never);

            // Half 1 — the literal. This is the half that can fail on its own.
            expect(engineKind(row.flow.name)).toBe(row.expected);

            // Half 2 — and it is spec's answer, on that same stored flow, so a
            // registration that rewrote the start node cannot hide behind the
            // literal above.
            expect(resolveFlowTriggerKind(stored)).toBe(row.expected);
        });
    }

    it('resolves a flow with NO trigger declaration to no kind (manual / screen)', () => {
        const stored = engine.registerFlow('manual', flowWith('manual', {}) as never);

        expect(engineKind('manual')).toBeUndefined();
        expect(resolveFlowTriggerKind(stored)).toBeUndefined();
        // …and it is absent from the silent-miss audit: nothing to bind.
        expect(engine.getTriggerBindingAudit().map((a) => a.flowName)).not.toContain('manual');
    });

    it('names the same kind on getTriggerBindingAudit — the surface the boot banner prints', () => {
        // The card's stated payoff: the audit an admin reads names the kind
        // `defineStack` named at authoring, by construction.
        const stored = new Map<string, unknown>();
        stored.set(
            'sched',
            engine.registerFlow('sched', flowWith('sched', { schedule: { cron: '0 9 * * *' } }) as never),
        );
        stored.set(
            'rc',
            engine.registerFlow(
                'rc',
                flowWith('rc', { objectName: 'task', triggerType: 'record-after-create' }) as never,
            ),
        );

        const audit = engine.getTriggerBindingAudit();
        const byFlow = new Map(audit.map((a) => [a.flowName, a.triggerType]));
        expect(byFlow.get('sched')).toBe('schedule');
        expect(byFlow.get('rc')).toBe('record_change');
        // Each row's kind is the authoring-time answer for the same flow.
        for (const [name, kind] of byFlow) {
            expect(resolveFlowTriggerKind(stored.get(name)), `audit row '${name}'`).toBe(kind);
        }
    });

    it('reaches EVERY kind spec publishes in FLOW_TRIGGER_KINDS', () => {
        // The coupling, as a runtime pin: a kind added to spec that the engine has
        // no binding shape for resolves to `undefined` here and reddens this case.
        // Without it, such a flow is simply inert — accepted by `defineStack`,
        // armed by nothing, and invisible on every surface above.
        const reached = new Set<string>();
        for (const row of chain) {
            engine.registerFlow(row.flow.name, row.flow as never);
            const kind = engineKind(row.flow.name);
            if (kind) reached.add(kind);
        }
        expect([...reached].sort()).toEqual([...FLOW_TRIGGER_KINDS].sort());
    });
});

describe('[#14328] the ARRAY-form divergence is PRESERVED, not unified away', () => {
    let engine: AutomationEngine;
    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
    });

    function arrayFlow(name: string, extra: Record<string, unknown> = {}) {
        return flowWith(name, {
            objectName: 'task',
            triggerType: ['record-after-create', 'record-after-delete'],
            ...extra,
        });
    }

    it('routes array form to record_change even though spec answers NO kind for it', () => {
        const stored = engine.registerFlow('array_flow', arrayFlow('array_flow') as never);

        // The divergence, both sides of it, in one case. Spec deliberately answers
        // `undefined` (multi-event unions are unsupported, #3457, and reading it as
        // "asks for a record-change trigger" would have `defineStack` demand a
        // capability the flow can never use). The engine deliberately routes it
        // anyway, so `@objectstack/trigger-record-change` can refuse it LOUDLY at
        // bind time (#3481) instead of the flow vanishing into "manual".
        expect(resolveFlowTriggerKind(stored)).toBeUndefined();
        const row = engine.getFlowRuntimeStates().find((s) => s.name === 'array_flow');
        expect(row?.triggerType).toBe('record_change');
    });

    it('keeps the array pre-check AHEAD of the resolver (it outranks timeRelative)', () => {
        // Ordering is the whole reason the pre-check sits before the resolver call
        // rather than beside the per-kind cases. A start node carrying BOTH an
        // array `triggerType` and a `timeRelative` descriptor resolved to
        // record_change before #14328; the resolver — blind to the array — answers
        // `time_relative` for it. Moving the pre-check after the resolver call
        // silently re-routes this flow and swaps the loud refusal for a sweep.
        const stored = engine.registerFlow(
            'array_and_time_relative',
            arrayFlow('array_and_time_relative', {
                timeRelative: { object: 'task', field: 'due_date' },
            }) as never,
        );

        expect(resolveFlowTriggerKind(stored)).toBe('time_relative');
        const row = engine
            .getFlowRuntimeStates()
            .find((s) => s.name === 'array_and_time_relative');
        expect(row?.triggerType).toBe('record_change');
    });

    it('hands the record-change trigger the raw array and a joined event token', () => {
        // The two fields the refusal is built from: `config.triggerType` carries the
        // raw array (so the trigger can name the offending shape) and `event` is the
        // joined string that maps to NO hook (so the trigger's single-token mapper
        // reports it verbatim and binds nothing).
        // Typed as the real `FlowTrigger`, NOT `… as never`: the cast erases the
        // contextual type for `start`, which leaves `binding` implicitly `any`
        // (TS7006). This package has no `typecheck` script, so its `tsc --noEmit`
        // runs only in the type-check DEBT lane — which compiles `src/**`, tests
        // included, and is a shrink-only ratchet. Same shape as `engine.test.ts`.
        const started: FlowTriggerBinding[] = [];
        const trigger: FlowTrigger = {
            type: 'record_change',
            start: (binding) => {
                started.push(binding);
            },
            stop: () => {},
        };
        engine.registerTrigger(trigger);
        engine.registerFlow('array_flow', arrayFlow('array_flow') as never);

        expect(started).toHaveLength(1);
        expect(started[0].event).toBe('record-after-create,record-after-delete');
        expect((started[0].config as { triggerType?: unknown }).triggerType).toEqual([
            'record-after-create',
            'record-after-delete',
        ]);
    });

    it('leaves an array with NO record-* element to the resolver (not the record case)', () => {
        // The pre-check is narrow on purpose: only an array containing a `record-*`
        // token is the diagnostic route. Anything else falls through to spec's
        // answer, which for this flow is the schedule cadence it also declares.
        const stored = engine.registerFlow(
            'sched_array',
            flowWith('sched_array', {
                triggerType: ['schedule', 'manual'],
                schedule: { cron: '0 9 * * *' },
            }) as never,
        );

        const row = engine.getFlowRuntimeStates().find((s) => s.name === 'sched_array');
        expect(row?.triggerType).toBe('schedule');
        expect(resolveFlowTriggerKind(stored)).toBe('schedule');
    });
});
