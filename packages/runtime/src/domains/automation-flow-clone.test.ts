// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12156] `POST /automation/:name/clone` — ADR-0126 §7.1.
 *
 * The clone door an admin reaches for when a packaged flow cannot be edited in
 * place. Three of the ADR's rules are the reason this file exists, and each has
 * a measurement behind it rather than a preference:
 *
 *  1. **Whole-definition copy.** The centrepiece here is the #11703
 *     counter-example expressed as a test: the cloned definition must deep-equal
 *     its source apart from the three fields a clone mutates. #11703 measured a
 *     clone assembled from an ENUMERATED facet list dropping three of six facets
 *     in silence — the record was created, the success toast fired, and the
 *     difference was discoverable only by diffing the two rows. A flow has far
 *     more facets than a permission set, so that failure mode is not merely
 *     available here, it is likely. Deep equality is the only assertion that
 *     fails when a facet goes missing; an assertion that spot-checks `nodes` and
 *     `edges` is the enumerated list again, wearing a test's clothes.
 *
 *  2. **No ancestry** (amendment ruling 2 / §9). Nothing records what the clone
 *     was copied from — not in the definition, not on the response. The
 *     converse is asserted too: the SOURCE's package provenance must not ride
 *     across, or the clone would carry `_packageId` naming the base's package,
 *     which is ancestry by another name (and would leave the clone locked and
 *     owned by the package the admin was trying to get out from under).
 *
 *  3. **Same-name is refused, loudly, with the sanctioned path.** Not because
 *     storage rejects it — storage legitimately holds both rows (ADR-0005
 *     amendment, #6825) — but because the engine's flow map is keyed by BARE
 *     name, so the second definition silently shadows the first and the survivor
 *     is decided by registration order (#11665 §2.2, #11997).
 *
 * The harness is `automation-toggle-unknown-flow.test.ts`'s: a fake automation
 * service holding exactly the flows it is given, driven through the real
 * `HttpDispatcher` so the route, its gate and the envelope are all under test
 * rather than the helper alone.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails } from '../validation-failure.js';
// Read from the implementation rather than restated: a second spelling of a
// contract value is a second contract, and it agrees only until one of them
// moves. (The wire status is asserted as the literal 409 beside it — that one
// IS the contract, so it is pinned independently of what the module calls it.)
import {
    FLOW_CLONE_DROPPED_KEYS,
    FLOW_CLONE_MUTATED_FIELDS,
    FLOW_CLONE_NAME_TAKEN_STATUS,
    FLOW_CLONE_STATUS,
} from '../flow-clone.js';

/**
 * The caller holds `manage_metadata`. A clone REGISTERS flow metadata, so it
 * sits inside the #10145 authoring-write set — without this every case below
 * would stop at a 403 in front of the behaviour it is named after. The gate
 * itself is asserted at the bottom of this file.
 */
const CTX = { request: {}, executionContext: { userId: 'user_1', systemPermissions: ['manage_metadata'] } } as any;

/**
 * A packaged exemplar carrying a facet of every kind a flow has: scalars, an
 * enum, a number, nested arrays of objects, a nested config object, a nested
 * `errorHandling` block — and the ADR-0010 protection envelope a packaged flow
 * really does carry once the loader has registered it (`FlowSchema` spreads
 * `MetadataProtectionFields`, so these are part of the parsed definition, not
 * decoration around it).
 *
 * Deliberately fat. The #11703 lesson is that a clone test passes trivially
 * when the fixture has nothing to lose, so {@link EXEMPLAR_FACET_FLOOR} below
 * pins that this exemplar keeps exercising the assertion.
 */
function packagedExemplar(): Record<string, unknown> {
    return {
        // ── the three fields a clone mutates ──────────────────────────
        name: 'crm_opportunity_escalation',
        label: 'Opportunity Escalation',
        status: 'active',
        // ── everything else must survive verbatim ─────────────────────
        description: 'Escalates a stalled opportunity to the regional manager.',
        successMessage: 'Escalation sent',
        errorMessage: 'Escalation could not be sent',
        version: 4,
        type: 'record_change',
        runAs: 'system',
        variables: [
            { name: 'stale_days', type: 'number', defaultValue: 30 },
            { name: 'region', type: 'text' },
        ],
        nodes: [
            {
                id: 'start',
                type: 'start',
                label: 'Start',
                config: {
                    objectName: 'opportunity',
                    triggerType: 'after_update',
                    condition: 'record.stage == "negotiation"',
                },
            },
            { id: 'notify', type: 'notify', label: 'Notify manager', config: { channel: 'email', to: '{record.manager_email}' } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'notify' },
            { id: 'e2', source: 'notify', target: 'end' },
        ],
        errorHandling: { strategy: 'retry', maxRetries: 3, initialDelayMs: 1000 },
        // ── ADR-0010 protection envelope (loader-set, packaged flow) ──
        _packageId: 'crm',
        _packageVersion: '3.2.0',
        _provenance: 'package',
        _lock: 'no-overlay',
        _lockReason: 'Shipped by the CRM package.',
        _lockSource: 'package',
    };
}

/**
 * How many facet keys the exemplar must carry beyond the three a clone mutates
 * and the envelope it drops. A future edit that thins the fixture out fails
 * here rather than quietly turning the deep-equality assertion into a
 * comparison of two nearly-empty objects.
 */
const EXEMPLAR_FACET_FLOOR = 10;

/**
 * The fake engine: `getFlow` resolves `null` for an unknown name (the real
 * `engine.ts` returns `this.flows.get(name) ?? null`), `registerFlow` is
 * synchronous and stores what it is given.
 *
 * It does NOT validate, on purpose — the real `registerFlow` canonicalizes and
 * validates, and re-implementing that here would test this file's idea of the
 * engine rather than the route. What is under test is which definition the
 * route hands over.
 */
function makeDispatcher(seed: Record<string, unknown>[] = [packagedExemplar()]) {
    const flows = new Map<string, Record<string, unknown>>(
        seed.map((f) => [f.name as string, f]),
    );
    const spies = {
        getFlow: vi.fn(async (name: string) => flows.get(name) ?? null),
        registerFlow: vi.fn((name: string, definition: unknown) => {
            flows.set(name, definition as Record<string, unknown>);
        }),
    };
    const services: Record<string, unknown> = { automation: spies };
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), spies, flows };
}

/** Drop `keys` from a shallow copy — used to state "everything except …". */
function omit(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
    const copy = { ...source };
    for (const key of keys) delete copy[key];
    return copy;
}

const clonePath = (source: string) => `/${source}/clone`;
const NEW = { name: 'acme_opportunity_escalation', label: 'Opportunity Escalation (ACME)' };

describe('#12156 — whole-definition copy (the #11703 counter-example as a test)', () => {
    it('carries EVERY facet: the clone deep-equals its source apart from name/label/status', async () => {
        const source = packagedExemplar();
        const { dispatcher } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(clonePath(source.name as string), 'POST', NEW, CTX);
        expect(result.response?.status).toBe(200);
        const clone = (result.response?.body?.data ?? result.response?.body)?.flow as Record<string, unknown>;

        // The fixture is worth comparing in the first place.
        const facetKeys = Object.keys(omit(source, [...FLOW_CLONE_MUTATED_FIELDS, ...FLOW_CLONE_DROPPED_KEYS]));
        expect(facetKeys.length).toBeGreaterThanOrEqual(EXEMPLAR_FACET_FLOOR);

        // THE assertion. Not a spot-check of `nodes`/`edges` — an enumerated
        // check is the very shape #11703 measured failing, so the comparison is
        // whole-object or it is nothing.
        expect(omit(clone, FLOW_CLONE_MUTATED_FIELDS)).toEqual(
            omit(source, [...FLOW_CLONE_MUTATED_FIELDS, ...FLOW_CLONE_DROPPED_KEYS]),
        );

        // Stated a second way, so a failure NAMES the missing facet instead of
        // printing two large objects side by side.
        for (const key of facetKeys) {
            expect(clone, `facet '${key}' was dropped by the clone`).toHaveProperty(key);
            expect(clone[key], `facet '${key}' changed value`).toEqual(source[key]);
        }
    });

    it('mutates exactly the three fields ADR-0126 §7.1 names, and no others', async () => {
        const source = packagedExemplar();
        const { dispatcher } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(clonePath(source.name as string), 'POST', NEW, CTX);
        const clone = (result.response?.body?.data ?? result.response?.body)?.flow as Record<string, unknown>;

        expect(clone.name).toBe(NEW.name);
        expect(clone.label).toBe(NEW.label);
        // `draft`: the schema's own default for something never deployed. It is
        // NOT an off-switch — see `flow-clone.ts` and the notice assertion below.
        expect(clone.status).toBe(FLOW_CLONE_STATUS);
        expect(clone.status).not.toBe(source.status);

        // The set that differs is exactly the mutated set.
        const differing = Object.keys(clone).filter((k) => JSON.stringify(clone[k]) !== JSON.stringify(source[k]));
        expect(differing.sort()).toEqual([...FLOW_CLONE_MUTATED_FIELDS].sort());
    });

    it('registers the clone under the NEW name, with the definition it returned', async () => {
        const source = packagedExemplar();
        const { dispatcher, spies, flows } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(clonePath(source.name as string), 'POST', NEW, CTX);
        const clone = (result.response?.body?.data ?? result.response?.body)?.flow;

        expect(spies.registerFlow).toHaveBeenCalledTimes(1);
        expect(spies.registerFlow).toHaveBeenCalledWith(NEW.name, clone);
        expect(flows.get(NEW.name)).toEqual(clone);
        // …and the source is still there, untouched. A clone is not a rename.
        expect(flows.get(source.name as string)).toEqual(packagedExemplar());
    });

    it('is a DEEP copy — editing the clone cannot reach back into the original', async () => {
        // The source handed to `cloneFlowDefinition` is the engine's LIVE
        // `FlowParsed` out of its flow map. A shallow spread would leave the two
        // definitions sharing one `nodes` array, so the first edit to either
        // would silently rewrite the other's automation.
        const source = packagedExemplar();
        const { dispatcher } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(clonePath(source.name as string), 'POST', NEW, CTX);
        const clone = (result.response?.body?.data ?? result.response?.body)?.flow as any;

        clone.nodes[1].config.to = '{record.other_email}';
        clone.variables[0].defaultValue = 999;
        clone.errorHandling.maxRetries = 99;

        expect((source as any).nodes[1].config.to).toBe('{record.manager_email}');
        expect((source as any).variables[0].defaultValue).toBe(30);
        expect((source as any).errorHandling.maxRetries).toBe(3);
    });
});

describe('#12156 — no ancestry is recorded anywhere (amendment ruling 2, §9)', () => {
    it('drops the source package envelope: the clone is org-owned, not a second copy of the package', async () => {
        const source = packagedExemplar();
        const { dispatcher } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(clonePath(source.name as string), 'POST', NEW, CTX);
        const clone = (result.response?.body?.data ?? result.response?.body)?.flow as Record<string, unknown>;

        // The exemplar really did carry them, so this is measuring a strip and
        // not an absence.
        for (const key of ['_packageId', '_provenance', '_lock']) {
            expect(source, `fixture no longer carries '${key}'`).toHaveProperty(key);
        }
        for (const key of FLOW_CLONE_DROPPED_KEYS) {
            expect(clone, `'${key}' survived onto the clone`).not.toHaveProperty(key);
        }
        // Which is the point: `_packageId` names the base's package, so keeping
        // it would BE the ancestry ruling 2 forbids — and would leave the clone
        // locked by the package the admin cloned to get out from under.
        expect(JSON.stringify(clone)).not.toContain('crm');
    });

    it('records no provenance field on the definition and none on the response', async () => {
        const source = packagedExemplar();
        const { dispatcher } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(clonePath(source.name as string), 'POST', NEW, CTX);
        const data = (result.response?.body?.data ?? result.response?.body) as Record<string, unknown>;
        const clone = data.flow as Record<string, unknown>;

        // A response field is the cheapest place for ancestry to reappear, and
        // a UI that reads one starts displaying a lineage the platform has ruled
        // it does not track.
        const forbidden = ['clonedFrom', 'cloned_from', 'source', 'sourceFlow', 'copiedFrom', 'basedOn', 'baseFlow', 'ancestor', 'origin'];
        for (const key of forbidden) {
            expect(data, `response carries ancestry key '${key}'`).not.toHaveProperty(key);
            expect(clone, `definition carries ancestry key '${key}'`).not.toHaveProperty(key);
        }
        // Nothing anywhere in the response names the flow it was copied from.
        expect(JSON.stringify(data)).not.toContain(source.name);
    });
});

describe('#12156 — the new machine name is mandatory', () => {
    it('refuses a clone with no `name`, located on the field, before anything is registered', async () => {
        const { dispatcher, spies } = makeDispatcher();

        let thrown: any;
        try {
            await dispatcher.handleAutomation(clonePath('crm_opportunity_escalation'), 'POST', { label: 'Copy' }, CTX);
        } catch (e) {
            thrown = e;
        }
        expect(thrown, 'a clone with no `name` was accepted').toBeDefined();
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'name', code: 'required' }]);
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('refuses an empty or non-string `name`', async () => {
        const { dispatcher, spies } = makeDispatcher();
        for (const name of ['', '   ', 42, null]) {
            await expect(
                dispatcher.handleAutomation(clonePath('crm_opportunity_escalation'), 'POST', { name, label: 'Copy' }, CTX),
                JSON.stringify(name),
            ).rejects.toThrow();
        }
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('refuses a clone with no `label` — two flows sharing one display name are indistinguishable', async () => {
        const { dispatcher, spies } = makeDispatcher();

        let thrown: any;
        try {
            await dispatcher.handleAutomation(clonePath('crm_opportunity_escalation'), 'POST', { name: 'copy_flow' }, CTX);
        } catch (e) {
            thrown = e;
        }
        expect(thrown, 'a clone with no `label` was accepted').toBeDefined();
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'label', code: 'required' }]);
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('refuses an unknown key rather than silently ignoring it', async () => {
        // The neighbour toggle route's #3899 posture: a key one letter off is a
        // located 400, never a silent drop. `status` is the tempting one — a
        // caller may well try to choose it, and it is exactly the field the ADR
        // says the CLONE decides.
        const { dispatcher, spies } = makeDispatcher();

        let thrown: any;
        try {
            await dispatcher.handleAutomation(
                clonePath('crm_opportunity_escalation'),
                'POST',
                { ...NEW, status: 'active' },
                CTX,
            );
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeDefined();
        expect(validationFailureDetails(thrown)?.fields).toMatchObject([{ field: 'status', code: 'unknown_field' }]);
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('checks the body BEFORE the registry — a malformed body never triggers a lookup', async () => {
        const { dispatcher, spies } = makeDispatcher();
        await expect(
            dispatcher.handleAutomation(clonePath('definitely_not_a_flow'), 'POST', { name: 42 }, CTX),
        ).rejects.toThrow();
        expect(spies.getFlow).not.toHaveBeenCalled();
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });
});

describe('#12156 — a same-name clone is refused loudly, naming the sanctioned path', () => {
    it('answers 409 RESOURCE_CONFLICT when the target name is the source name', async () => {
        const source = packagedExemplar();
        const { dispatcher, spies } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(
            clonePath(source.name as string),
            'POST',
            { name: source.name, label: 'Another Escalation' },
            CTX,
        );

        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(FLOW_CLONE_NAME_TAKEN_STATUS);
        expect(FLOW_CLONE_NAME_TAKEN_STATUS).toBe(409);
        const error = result.response?.body?.error;
        expect(result.response?.body?.success).toBe(false);
        // ADR-0112: a semantic code AND a status, never the number alone.
        expect(error?.code).toBe('RESOURCE_CONFLICT');
        expect(error?.httpStatus).toBe(409);

        // ⛔ Nothing was registered. "Refuse first, register second" is the only
        // acceptable order here: the whole reason same-name is banned is that a
        // second definition under one bare name silently shadows the first.
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('answers 409 for ANY taken name, not only the source name', async () => {
        const source = packagedExemplar();
        const occupant = { ...packagedExemplar(), name: 'acme_opportunity_escalation', label: 'Someone else' };
        const { dispatcher, spies, flows } = makeDispatcher([source, occupant]);

        const result = await dispatcher.handleAutomation(clonePath(source.name as string), 'POST', NEW, CTX);

        expect(result.response?.status).toBe(409);
        expect(spies.registerFlow).not.toHaveBeenCalled();
        // The occupant is untouched — a clone never overwrites.
        expect(flows.get(occupant.name)?.label).toBe('Someone else');
    });

    it('the message names the offending name, the reason, and what to do instead', async () => {
        const source = packagedExemplar();
        const { dispatcher } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(
            clonePath(source.name as string),
            'POST',
            { name: source.name, label: 'Another Escalation' },
            CTX,
        );
        const message: string = result.response?.body?.error?.message ?? '';

        // Named, the way the body rejections name their offending key.
        expect(message).toContain(source.name as string);
        // The REASON — this is not a storage conflict, and a caller told only
        // "already exists" will reasonably assume it is one and go hunting.
        expect(message).toContain('shadow');
        expect(message).toContain('ADR-0126');
        // THE SANCTIONED PATH, which is what the card asks for: retry under a
        // name no flow uses, spelled concretely enough to act on.
        expect(message).toMatch(/Retry with a machine name no flow uses/);
        expect(message).toContain(`${source.name}_copy`);
    });
});

describe('#12156 — the source, the notice, and the gate', () => {
    it('cloning a flow that does not exist is 404, not 500 (#7535 posture)', async () => {
        const { dispatcher, spies } = makeDispatcher();

        const result = await dispatcher.handleAutomation(clonePath('definitely_not_a_flow'), 'POST', NEW, CTX);

        expect(result.response?.status).toBe(404);
        expect(result.response?.body?.error?.code).toBe('RESOURCE_NOT_FOUND');
        expect(result.response?.body?.error?.message).toContain('definitely_not_a_flow');
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('states plainly that references are NOT re-pointed, and that the clone is armed', async () => {
        const source = packagedExemplar();
        const { dispatcher } = makeDispatcher([source]);

        const result = await dispatcher.handleAutomation(clonePath(source.name as string), 'POST', NEW, CTX);
        const notice: string = ((result.response?.body?.data ?? result.response?.body) as any)?.notice ?? '';

        // ADR-0126 §9: automatic re-pointing is explicitly not chartered, and
        // the ADR requires the surface to TELL the admin so.
        expect(notice).toMatch(/not re-pointed/i);
        // And the fact an admin is most likely to be caught by: `draft` is a
        // lifecycle label, not an off-switch — the engine only disables on
        // `obsolete`/`invalid`, so a cloned record-change flow runs beside the
        // one it was copied from. Saying so is cheaper than the surprise.
        expect(notice).toMatch(/off-switch/i);
        expect(notice).toContain('toggle');
    });

    it('is an authoring write — a caller without `manage_metadata` is refused 403, nothing registered', async () => {
        // A clone REGISTERS flow metadata at environment scope, which is
        // precisely the escalation #10145 measured and closed for `POST /`.
        // An ungated clone door would reopen it, with the twist that the caller
        // need not author a definition at all — it copies a trusted one.
        const { dispatcher, spies } = makeDispatcher();
        const unentitled = { request: {}, executionContext: { userId: 'user_2', systemPermissions: [] } } as any;

        const result = await dispatcher.handleAutomation(
            clonePath('crm_opportunity_escalation'),
            'POST',
            NEW,
            unentitled,
        );

        expect(result.response?.status).toBe(403);
        expect(result.response?.body?.error?.code).toBe('PERMISSION_DENIED');
        // Refused BEFORE the service is consulted (#10145: nothing is
        // registered or unregistered before the refusal).
        expect(spies.getFlow).not.toHaveBeenCalled();
        expect(spies.registerFlow).not.toHaveBeenCalled();
    });

    it('does not shadow the legacy execution door for a flow literally named `clone`', async () => {
        // `POST /automation/trigger/clone` RUNS the flow named `clone`; the
        // authoring gate excludes `parts[0] === 'trigger'` so that door is not
        // over-blocked. Asserted here because the exclusion is invisible at the
        // route and easy to drop when the gate is next edited.
        const execute = vi.fn(async () => ({ success: true, runId: 'run_1' }));
        const services: Record<string, unknown> = { automation: { execute } };
        const resolve = (name: string) => services[name];
        const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n), context: { getService: resolve } };
        const dispatcher = new HttpDispatcher(kernel);
        const unentitled = { request: {}, executionContext: { userId: 'user_2', systemPermissions: [] } } as any;

        const result = await dispatcher.handleAutomation('/trigger/clone', 'POST', {}, unentitled);

        expect(result.response?.status).not.toBe(403);
        expect(execute).toHaveBeenCalled();
    });
});
