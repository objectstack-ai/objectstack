// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32183, ADR-0150 D3; epic ruling R4-G] The flow doors #31696 opened read
 * every holder of a flow name, a disabled package's included, so a disable
 * moves none of their answers: each answers as `main` does, where the
 * registry's holder read did not yet leave a disabled package out.
 *
 * Read only through the served holders, a disable would move them. With CRM
 * disabled, HR's own flow action would reach the bare service (the bare read
 * no longer refuses), whose bare entries still refuse the name two engine
 * slots hold; a package whose closure holds both would run HR's flow. Both
 * moves wait for #32670, the served judgment at the send and run doors.
 *
 * Over a real `SchemaRegistry` (its `disablePackage`, its served filter) and
 * an engine double holding one slot per holder, as the engine holds them after
 * a runtime disable. Pinned as parity: for every non-empty set of disabled
 * holders, in both registration orders, every door answers what it answers
 * with nothing disabled. The CONTROLs say what that answer is.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { endpointPackageOf, flowHolderForCaller, flowServiceForCaller, flowWalkReads } from './flow-slot-view.js';
import { admitAutomationAddress, bareNameRefusal } from './domains/automation-address.js';

const CRM = 'com.crm.pkg';
const HR = 'com.hr.pkg';
/** Depends on CRM only. */
const OPS = 'com.ops.pkg';
/** Depends on both holders. */
const BOTH = 'com.both.pkg';
/** Depends on neither. */
const NONE = 'com.none.pkg';
const FLOW = 'convert_lead';
const API = 'lead_api';
const HOLDERS = [CRM, HR];
const CALLERS = [undefined, CRM, HR, OPS, BOTH, NONE];
const NAMESPACES = ['crm', 'hr', 'ops', 'none'];

function registryOf(order: readonly string[], disabled: readonly string[]): SchemaRegistry {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    const install = (id: string, namespace: string, deps: string[] = []) => registry.installPackage({
        id, name: id, version: '1.0.0', type: 'app', namespace,
        ...(deps.length > 0 ? { dependencies: Object.fromEntries(deps.map((d) => [d, '^1.0.0'])) } : {}),
    } as never, 'code');
    install(CRM, 'crm');
    install(HR, 'hr');
    install(OPS, 'ops', [CRM]);
    install(BOTH, 'both', [CRM, HR]);
    install(NONE, 'none');
    for (const holder of order) {
        registry.registerItem('flow', { name: FLOW, _packageId: holder }, 'name' as never, holder);
        registry.registerItem('api', { name: API, _packageId: holder }, 'name' as never, holder);
    }
    for (const id of disabled) registry.disablePackage(id);
    return registry;
}

/** One slot per holder, the bare entries refusing the shared name, as the engine's do. */
function engineWithBothSlots() {
    const refusal = () => Object.assign(new Error(`Flow '${FLOW}' is held by several packages`), { code: 'RESOURCE_CONFLICT', status: 409 });
    return {
        handlerReady: true,
        getFlow: vi.fn(async (name: string) => { if (name === FLOW) throw refusal(); return null; }),
        execute: vi.fn(async (name: string) => { if (name === FLOW) throw refusal(); return { success: true }; }),
        flowSlotKey: vi.fn((pkg: string | null, name: string) => (name === FLOW && pkg !== null && HOLDERS.includes(pkg) ? `${pkg}/${FLOW}` : undefined)),
        getFlowSlot: vi.fn((pkg: string | null, name: string) => (name === FLOW && pkg !== null && HOLDERS.includes(pkg) ? { name, label: `${pkg} flow` } : null)),
        executeSlot: vi.fn(async (pkg: string | null) => ({ success: true, output: { ran: pkg } })),
        toggleFlowSlot: vi.fn(async () => {}),
    };
}

/** What a thrown refusal names, or its message. */
const refusalOf = (err: any) => ['refused', err?.refusal?.candidates?.map((c: any) => c.packageId ?? c.kind) ?? String(err?.message)];

/** Every door's answer, per caller and per namespace. */
async function answersOf(registry: SchemaRegistry) {
    const out: Record<string, unknown> = {};
    for (const caller of CALLERS) {
        const engine = engineWithBothSlots();
        try {
            const service = flowServiceForCaller(engine, registry, FLOW, caller);
            await service.execute(FLOW, {} as never);
            out[`action ${caller}`] = ['ran', engine.executeSlot.mock.calls.map((c) => c[0])];
        } catch (err) {
            out[`action ${caller}`] = refusalOf(err);
        }
        out[`holder ${caller}`] = flowHolderForCaller(registry, FLOW, caller);
        const walk = flowWalkReads(engineWithBothSlots(), async () => registry);
        try {
            const callee = await walk.callee(FLOW, caller ?? null);
            out[`callee ${caller}`] = ['read', callee.packageId, (callee.flow as { label?: string } | null)?.label];
        } catch (err) {
            out[`callee ${caller}`] = refusalOf(err);
        }
    }
    out.root = await flowWalkReads(engineWithBothSlots(), async () => registry).rootPackage(FLOW);
    out.endpoint = endpointPackageOf(registry, API);
    out.bare = bareNameRefusal(registry, 'flow', FLOW)?.candidates.map((c: any) => c.packageId ?? c.kind);
    for (const namespace of NAMESPACES) {
        const admitted = admitAutomationAddress(registry, { kind: 'namespace', namespace }, { type: 'flow', name: FLOW });
        out[`address ${namespace}`] = admitted === undefined
            ? 'bare path'
            : 'packageId' in admitted ? ['slot', admitted.packageId] : [admitted.status, admitted.refusal?.candidates?.map((c: any) => c.packageId ?? c.kind)];
    }
    const env = admitAutomationAddress(registry, { kind: 'environment' }, { type: 'flow', name: FLOW });
    out['address _env'] = env === undefined ? 'bare path' : 'packageId' in env ? ['slot', env.packageId] : [env.status, env.refusal?.candidates?.map((c: any) => c.packageId ?? c.kind)];
    return out;
}

const ORDERS = [HOLDERS, [...HOLDERS].reverse()];
const DISABLED_SETS = [[CRM], [HR], [CRM, HR]];

describe('the #31696 flow doors read every holder: a disable moves no answer (ADR-0150 D3, R4-G, #32183)', () => {
    it.each(ORDERS.flatMap((order) => DISABLED_SETS.map((disabled) => [order.join(' then '), disabled.join(' and '), order, disabled] as const)))(
        'registered %s, %s disabled: every door answers as with nothing disabled',
        async (_o, _d, order, disabled) => {
            expect(await answersOf(registryOf(order, disabled))).toEqual(await answersOf(registryOf(order, [])));
        },
    );

    it.each(ORDERS.map((order) => [order.join(' then '), order] as const))('CONTROL — registered %s, nothing disabled: what `main` answers', async (_o, order) => {
        const answers = await answersOf(registryOf(order, []));
        expect(answers[`action ${HR}`]).toEqual(['ran', [HR]]);
        expect(answers[`action ${OPS}`]).toEqual(['ran', [CRM]]);
        expect(answers[`action ${BOTH}`]).toEqual(['refused', [...order]]);
        expect(answers['action undefined']).toEqual(['refused', `Flow '${FLOW}' is held by several packages`]);
        expect(answers[`callee ${HR}`]).toEqual(['read', HR, `${HR} flow`]);
        expect(answers[`holder ${BOTH}`]).toBeUndefined();
        expect(answers.bare).toEqual([...order]);
        expect(answers.endpoint).toBeUndefined();
        expect(answers['address crm']).toEqual(['slot', CRM]);
        expect(answers['address hr']).toEqual(['slot', HR]);
    });
});
