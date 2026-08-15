// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7674 → #8310 — OWD posture at the runtime object door, driven through the
 * REAL save path on the host-config topology, re-pinned to the ruled door
 * ORDER.
 *
 * ## The door order this file pins (#8310 maintainer ruling)
 *
 * `saveMetaItem` runs `assertRuntimeAuthoringRules` (the shared lint table —
 * 422 `INVALID_METADATA`, per-rule `issues`) BEFORE `runAuthoringGate` (the
 * ADR-0094-seam plugin gate — 403). Since #8310 declared `object` in
 * `validateSecurityPosture`'s `runtimeTypes`:
 *
 *  - **The 422 lint door answers FIRST** for every posture defect it judges:
 *    an unauthored `sharingModel` (`security-owd-unset` — absence is not a
 *    decision; the ruled strictness), and external > internal
 *    (`security-external-wider-than-internal`).
 *  - **The 403 R1 door (`owd_widening_forbidden`, env-tighten-only over a
 *    packaged declaration) remains** for writes that pass lint — no lint
 *    rule can judge it, because it needs the packaged declaration.
 *  - **R2 (`owd_external_wider`) is RETIRED from the plugin gate** as the
 *    lint door's duplicate (same ruling; see `object-posture-gate.ts`). Its
 *    former pins here are re-pinned onto the 422 envelope, and the door-order
 *    case below proves the lint door answers even when R1 would also refuse.
 *  - The former pin that a write with NO OWD keys at all SAVES (ADR-0094
 *    read absence as the D1 `private` default) is OVERTURNED by the ruling:
 *    absence now refuses (`security-owd-unset`), pinned below.
 *
 * #7674's original point stands underneath: this file reaches the doors
 * through the real `PUT /api/v1/meta/:type/:name` route on the host-config
 * topology (no environment id), where a unit-only gate once silently ran on
 * no deployment at all.
 *
 * ## Rejection cases assert the ENVELOPE (ADR-0112)
 *
 * Every refusal asserts `code` AND `status` (and for the 422s, the lint rule
 * id inside `issues`). This route ANSWERS rather than throws, and an object
 * body that reaches persistence on a misconfigured store throws a bare driver
 * `Error` whose `code` and `status` are both `undefined` — the pair is what
 * separates "refused by the gate" from "failed somewhere downstream".
 *
 * ## Scope
 *
 * This is an AUTHORING-validation pin, not an external-principal enforcement
 * one. External-principal enforcement is #2696-planned; a wider external
 * baseline discloses nothing today. Nothing here should be read as asserting
 * that an external principal is refused at read time.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import {
    ObjectStackProtocolImplementation,
    resetEnvWritableMetadataTypes,
    type MetadataAuthoringChannel,
} from '@objectstack/metadata-protocol';
// The REAL overlay store definitions the protocol writes to — not a mirror
// (#5785: a hand-declared `sys_metadata` restarts the drift clock).
import {
    SysMetadata,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
} from '@objectstack/platform-objects/metadata';
// The REAL wiring `security-plugin.ts` performs at init — not a re-implementation
// of the verdict. A local copy of the gate would make this suite a test of the
// copy, which is the failure mode the file exists to close.
import { registerObjectPostureGate } from '@objectstack/plugin-security';
import { RestServer } from './rest-server.js';

const META_ITEM = '/api/v1/meta/:type/:name';

/** The real backend, constructed the canonical way (`examples/app-crm`). */
const makeSqliteDriver = () => new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
});

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
    delete process.env.OS_METADATA_WRITABLE;
    resetEnvWritable();
});

/**
 * `OS_METADATA_WRITABLE` is memoised in TWO places, and both must be cleared
 * or the suite becomes order-dependent: the protocol's own static
 * (`isOverlayAllowed`) and the repository module's
 * (`SysMetadataRepository.assertAllowed`). Measured the hard way during reverse
 * verification — with the fix in place the posture gate refuses first, so the
 * repository memo is never populated and clearing the protocol's alone LOOKS
 * sufficient; take the fix out and the repository memo is warmed empty by an
 * earlier case, and the escape hatch silently stops working two tests later.
 */
function resetEnvWritable(): void {
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
}

function createMockServer() {
    const noop = () => {};
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => {}, close: async () => {},
    };
}

function makeRes() {
    const res: any = {
        _status: 200,
        write: () => true, end: () => {}, send: () => res, setHeader: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

/**
 * A packaged object, for R1. `_packageId` is what makes
 * `registry.getArtifactItem` — and therefore `isArtifactBacked` — answer true;
 * its posture is the BASELINE an environment overlay may only tighten.
 */
const PACKAGED_ACCOUNT = {
    name: 'qa_packaged_account',
    label: 'Packaged Account',
    _packageId: 'demo_pkg',
    sharingModel: 'public_read',
    externalSharingModel: 'private',
    fields: { name: { type: 'text' as const, label: 'Name' } },
};

/**
 * An overlay body for the packaged object — the same document a Studio author
 * would PUT back. Deliberately WITHOUT `_packageId`: that key is the registry's
 * provenance envelope, not an authorable one, and sending it would make the
 * body fail spec validation before the posture gate ever sees it.
 */
const packagedOverlay = (over: Record<string, unknown> = {}) => ({
    name: PACKAGED_ACCOUNT.name,
    label: PACKAGED_ACCOUNT.label,
    fields: { name: { type: 'text' as const, label: 'Name' } },
    ...over,
});

/** The probe body from the issue, parameterized by its OWD pair. */
const probeObject = (over: Record<string, unknown> = {}) => ({
    name: 'qa_probe',
    label: 'QA Probe',
    fields: { name: { type: 'text' as const, label: 'Name' } },
    ...over,
});

/**
 * Boot the host-config topology.
 *
 * @param opts.channel omitted ⇒ the constructor DEFAULT (`'environment'`),
 * which is the shape the lightweight assembler produces and the one under
 * test. Passing `'package-author'` exercises the #6710 carve-out explicitly.
 * @param opts.envWritableObject set `OS_METADATA_WRITABLE=object`. R1's own
 * docblock names this as the path it judges — without it,
 * `SysMetadataRepository.assertAllowed()` refuses an `object` overlay of a
 * PACKAGED item outright (`NOT_OVERRIDABLE`), so an R1-legal overlay could
 * never land and "R1 permits tightening" would be unobservable.
 */
async function boot(opts: { channel?: MetadataAuthoringChannel; envWritableObject?: boolean } = {}) {
    const { channel } = opts;
    if (opts.envWritableObject) {
        process.env.OS_METADATA_WRITABLE = 'object';
    }
    resetEnvWritable();
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(makeSqliteDriver(), true);
    await engine.init();
    // The metadata-storage platform objects, registered through the SAME seam
    // `assembleMetadataProtocol` uses — one `registerApp` manifest under
    // `com.objectstack.metadata-objects`, not three hand-rolled
    // `registerObject` calls. The audit sink is in the list so a permitted
    // write's audit row lands rather than degrading into a logged best-effort
    // failure, which would otherwise read like a defect in a suite about
    // refusals.
    engine.registerApp({
        id: 'com.objectstack.metadata-objects',
        name: 'Metadata Platform Objects',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject],
    });
    engine.registry.registerObject(PACKAGED_ACCOUNT as any, 'demo_pkg');
    await engine.syncSchemas();

    const protocol = channel === undefined
        ? new ObjectStackProtocolImplementation(engine as any)
        : new ObjectStackProtocolImplementation(engine as any, undefined, undefined, channel);

    // THE PREMISE, asserted rather than assumed. Every case below is about a
    // deployment with no environment id; a harness that acquired one would be
    // testing the path that always worked.
    expect(
        (protocol as any).environmentId,
        'the host-config topology is the premise: #7674 re-keys the gate, it does not bind an environment id',
    ).toBeUndefined();

    // Exactly what `security-plugin.ts` does at init.
    expect(registerObjectPostureGate(protocol as any)).toBe(true);

    const rest = new RestServer(
        createMockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    // [#6603] the route demands `manage_metadata` — an authoring capability.
    // The caller here HOLDS it: this suite is about the posture gate, and a
    // capability refusal would answer 403 for an unrelated reason.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();

    const route = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === META_ITEM);
    if (!route) throw new Error(`PUT ${META_ITEM} is not registered`);

    const put = async (name: string, body: unknown, query: Record<string, unknown> = {}) => {
        const res = makeRes();
        await route.handler({ params: { type: 'object', name }, query, headers: {}, body } as any, res);
        return res;
    };

    /**
     * Overlay rows actually in `sys_metadata` for a name — the persistence half.
     *
     * The options bag is TYPED, not erased. `ObjectQL.find`'s second parameter
     * is already `EngineQueryOptions`, so the literal infers against it and
     * `tsc` stays the enforcing channel for these keys — the #4674 lesson the
     * `query-options/no-any-erasure` rule exists for (an unknown key here is
     * silently DROPPED, never rejected, because the options schemas are not
     * `.strict()`). Nothing about this query is off-contract, so it needs no
     * `as unknown as EngineQueryOptions` escape either.
     */
    const storedRows = async (name: string) =>
        engine.find('sys_metadata', { where: { type: 'object', name } });

    return { engine, protocol, put, storedRows };
}

// ---------------------------------------------------------------------------
// The 422 lint door — external ≤ internal and authored-OWD-required (#8310)
// ---------------------------------------------------------------------------

describe('[#8310] the 422 lint door through PUT /api/v1/meta/object/:name', () => {
    /**
     * #7674 pinned these doors on the plugin gate's 403; #8310 re-pins them on
     * the 422 lint envelope, because `validateSecurityPosture` now runs for
     * `object` writes FIRST. The bare PUT and the package door both take the
     * active-state gate; the draft door is pinned separately below (the lint
     * discipline gates the draft→active PROMOTION, #4463 D1, not the draft
     * save itself).
     */
    it.each([
        { door: 'the active path (bare PUT)', query: {} as Record<string, unknown> },
        { door: 'package authoring (`?package=demo_pkg`)', query: { package: 'demo_pkg' } },
    ])('refuses 422 security-external-wider-than-internal on $door', async ({ query }) => {
        const { put, storedRows } = await boot();

        const res = await put('qa_probe', probeObject({
            sharingModel: 'private',
            externalSharingModel: 'public_read',
        }), query);

        // ADR-0112 envelope — both halves, plus the lint rule id the 422
        // carries in `issues`. `403 owd_external_wider` is what this answered
        // before the retirement; `200` is what it answered before #7674.
        expect(res._status).toBe(422);
        expect(res._json?.code).toBe('INVALID_METADATA');
        expect((res._json?.issues ?? []).map((i: any) => i.rule))
            .toContain('security-external-wider-than-internal');

        // The point the status code alone cannot make: the gate is
        // PRE-persistence. A 422 answered after the row landed would still be
        // the defect, and `GET` would still return the violating pair.
        expect(await storedRows('qa_probe')).toEqual([]);
    }, 60_000);

    it('an OWD-less publish is refused — 422 security-owd-unset (absence is not a decision)', async () => {
        // THE RULED STRICTNESS (#8310, overturning this file's previous "no
        // OWD keys at all SAVES" pin): ADR-0094's reading — absence defaults
        // to the D1 `private` — governed while no lint rule ran at this door.
        // The maintainer ruling flips it: the runtime object door requires an
        // AUTHORED posture, and a body with no `sharingModel` is refused
        // outright rather than silently defaulted.
        const { put, storedRows } = await boot();

        const res = await put('qa_probe', probeObject());

        expect(res._status).toBe(422);
        expect(res._json?.code).toBe('INVALID_METADATA');
        expect((res._json?.issues ?? []).map((i: any) => i.rule)).toContain('security-owd-unset');
        expect(await storedRows('qa_probe')).toEqual([]);
    }, 60_000);

    it('declaring only the external side is refused as the MISSING internal decision (owd-unset)', async () => {
        // #7674's unset-internal case, re-pinned. R2 resolved the unset
        // internal to `private` and called the defect `owd_external_wider`;
        // the ruled door names the actual defect — the internal decision was
        // never authored.
        const { put, storedRows } = await boot();

        const res = await put('qa_probe', probeObject({ externalSharingModel: 'public_read_write' }));

        expect(res._status).toBe(422);
        expect(res._json?.code).toBe('INVALID_METADATA');
        expect((res._json?.issues ?? []).map((i: any) => i.rule)).toContain('security-owd-unset');
        expect(await storedRows('qa_probe')).toEqual([]);
    }, 60_000);

    it('the draft door: a dirty draft SAVES (D1), and the draft→active PROMOTION refuses 422', async () => {
        // #7674 pinned a 403 on `?mode=draft` because the plugin gate ran on
        // drafts too. The lint discipline is deliberately different (#4463
        // D1): drafts are work-in-progress and save ungated; the gate arms on
        // the draft→active promotion, so the second minting path stays closed
        // without making a half-finished body unsaveable. That discipline now
        // governs the object door too.
        const { put, protocol } = await boot();

        const res = await put('qa_probe', probeObject({
            sharingModel: 'private',
            externalSharingModel: 'public_read',
        }), { mode: 'draft' });
        expect(res._status, `draft save must pass ungated: ${JSON.stringify(res._json)}`).toBe(200);

        const err = await (protocol as any).publishMetaItem({ type: 'object', name: 'qa_probe' })
            .then(() => null, (e: any) => e);
        expect(err, 'the promotion is where the lint verdict binds').toBeInstanceOf(Error);
        expect(err.status).toBe(422);
        expect(err.code).toBe('INVALID_METADATA');
        expect((err.issues ?? []).map((i: any) => i.rule))
            .toContain('security-external-wider-than-internal');
    }, 60_000);

    it('door ORDER: when lint AND R1 would both refuse, the 422 lint door answers first', async () => {
        // An env overlay over the packaged object whose body is BOTH
        // external-wider (lint) and posture-widening against the packaged
        // baseline (R1: external `public_read` > declared external `private`).
        // The ruling fixes the order: the lint table answers first
        // (`saveMetaItem` runs it before `runAuthoringGate`), so the author
        // sees the 422 vocabulary, never a coin-flip between two doors.
        const { put, storedRows } = await boot();

        const res = await put('qa_packaged_account', packagedOverlay({
            sharingModel: 'private',
            externalSharingModel: 'public_read',
        }));

        expect(res._status).toBe(422);
        expect(res._json?.code).toBe('INVALID_METADATA');
        expect((res._json?.issues ?? []).map((i: any) => i.rule))
            .toContain('security-external-wider-than-internal');
        expect(await storedRows('qa_packaged_account')).toEqual([]);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// R1 — ADR-0086 D1: an environment overlay may only TIGHTEN a packaged posture
// ---------------------------------------------------------------------------

describe('[#7674] R1 `owd_widening_forbidden` through PUT /api/v1/meta/object/:name', () => {
    /**
     * On a host config R1 is the ONLY guard, which is why it belongs here and
     * not only in the unit suite. The ADR-0005 two-tier authorization that
     * would normally refuse an overlay of a packaged `object` with
     * `not_overridable` is ITSELF scoped to `environmentId !== undefined`, so on
     * this topology the write sails past it and arrives at the posture gate
     * with nothing else in front of it.
     */
    it('refuses an env overlay that widens a packaged object\'s internal OWD', async () => {
        // Declared baseline: `public_read`. The overlay asks for
        // `public_read_write`, and leaves the external side unset so R2 has
        // nothing to compare — only R1 can produce this refusal.
        const { put, storedRows } = await boot();

        const res = await put('qa_packaged_account', packagedOverlay({
            sharingModel: 'public_read_write',
        }));

        expect(res._status).toBe(403);
        expect(res._json?.code).toBe('owd_widening_forbidden');
        expect(String(res._json?.error)).toContain('TIGHTEN');
        expect(await storedRows('qa_packaged_account')).toEqual([]);
    }, 60_000);

    it('refuses a widened EXTERNAL side against the packaged baseline', async () => {
        // Distinct from the lint door: `public_read` external against
        // `public_read` internal is NOT external-wider, so the 422 lint table
        // passes the body. Only the comparison against the PACKAGED
        // declaration (external `private`) can refuse it — which is exactly
        // why R1 SURVIVES the #8310 retirement while R2 did not. A suite that
        // only ever sent an external-wider pair could not tell the doors
        // apart.
        const { put, storedRows } = await boot();

        const res = await put('qa_packaged_account', packagedOverlay({
            sharingModel: 'public_read',
            externalSharingModel: 'public_read',
        }));

        expect(res._status).toBe(403);
        expect(res._json?.code).toBe('owd_widening_forbidden');
        expect(await storedRows('qa_packaged_account')).toEqual([]);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// The negative direction — load-bearing, not decoration
// ---------------------------------------------------------------------------

describe('[#7674] what the gate must still let through', () => {
    /**
     * Arming a gate that had never run is exactly the change that overshoots
     * into refusing legitimate authoring, and a suite of nothing but refusals
     * would be green for a gate that rejects everything. These cases are the
     * other half of the claim.
     */
    it.each([
        { pair: 'private / private', over: { sharingModel: 'private', externalSharingModel: 'private' } },
        { pair: 'public_read / private (external TIGHTER)', over: { sharingModel: 'public_read', externalSharingModel: 'private' } },
        { pair: 'public_read / public_read (equal, not wider)', over: { sharingModel: 'public_read', externalSharingModel: 'public_read' } },
        // 'no OWD keys at all' left this table on #8310: absence is now a
        // 422 refusal (`security-owd-unset`), pinned in the lint-door suite
        // above — the ruling overturned ADR-0094's absence-defaults-to-private
        // reading at this door.
        { pair: 'internal only, external unset', over: { sharingModel: 'private' } },
    ])('a legal pair still saves — $pair', async ({ over }) => {
        const { put, storedRows } = await boot();

        const res = await put('qa_probe', probeObject(over));

        expect(res._status, `unexpected refusal: ${JSON.stringify(res._json)}`).toBe(200);
        expect(res._json?.success).toBe(true);
        expect(await storedRows('qa_probe')).toHaveLength(1);
    }, 60_000);

    it('an env overlay that TIGHTENS a packaged object is allowed (R1 is directional)', async () => {
        // `OS_METADATA_WRITABLE=object` is the escape hatch R1's own docblock
        // names as the path it judges. Without it the overlay is refused a
        // layer later by `SysMetadataRepository.assertAllowed()`
        // (`NOT_OVERRIDABLE`) — a DIFFERENT door, measured on this harness —
        // and this case would then pass for a reason that has nothing to do
        // with the posture gate.
        const { put, storedRows } = await boot({ envWritableObject: true });

        // The packaged baseline is `public_read` / `private`; the overlay
        // narrows the internal side to `private`. ADR-0086 D1 permits exactly
        // this direction, and R1 refusing it would be the overshoot.
        const res = await put('qa_packaged_account', packagedOverlay({
            sharingModel: 'private',
            externalSharingModel: 'private',
        }));

        expect(res._status, `unexpected refusal: ${JSON.stringify(res._json)}`).toBe(200);
        expect(await storedRows('qa_packaged_account')).toHaveLength(1);
    }, 60_000);

    /**
     * [#6710] The declared carve-out, preserved. A kernel that claims to BE the
     * package author is treated as one by BOTH doors — the lint table and the
     * plugin gate each skip the `package-author` channel — because package
     * authoring is judged at BUILD time by the same rules, before anything is
     * published (`validateSecurityPosture` runs on every CLI command, and R1's
     * own message prescribes that route: "widen it in the package source and
     * publish through the package pipeline").
     *
     * [#8310] Read that as "judged earlier", NOT as "gated at build time
     * instead" — the header above is the correction: the same rule answers at
     * THIS door too for `object` writes, and the
     * `security-external-wider-than-internal` case at the top of this file
     * refuses the exact body used below (`private` / `public_read`) with a
     * 422. What exempts the write here is the CHANNEL — not the posture, and
     * not a gap in the rule's reach.
     *
     * That reach is not total at this door either: `security-owd-unset`
     * exempts system objects, so an `isSystem` / `sys_*` object whose
     * `sharingModel` is never authored stays effectively PUBLIC at runtime.
     * Deliberate as shipped; whether it should stay is #8641's question, and
     * nothing in this file pins it either way.
     *
     * This case is the guard against the worse defect available here: a gate
     * that starts refusing package authoring is a regression, not a fix. It is
     * green both before and after #7674 — deliberately, because what it pins is
     * the thing that must NOT have moved.
     */
    it('the `package-author` channel still bypasses the gate — the #6710 carve-out is intact', async () => {
        const { put, storedRows } = await boot({ channel: 'package-author' });

        const res = await put('qa_probe', probeObject({
            sharingModel: 'private',
            externalSharingModel: 'public_read',
        }));

        expect(res._status, `the control plane must still install its own packages: ${JSON.stringify(res._json)}`).toBe(200);
        expect(await storedRows('qa_probe')).toHaveLength(1);
    }, 60_000);
});
