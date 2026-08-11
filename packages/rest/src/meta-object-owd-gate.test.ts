// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7674 — the ADR-0090 D11 object posture gate, driven through the REAL save
 * path on the topology it was measured absent from.
 *
 * ## Why this file exists, and why the unit suite could not stand in for it
 *
 * `plugin-security/src/object-posture-gate.test.ts` is **18/18 green** and was
 * green throughout — it calls `objectPostureGate(ctx)` directly, so it proves
 * the verdict function and nothing about whether anything ever calls it. On
 * `origin/main` before this change, a grep for `owd_external_wider` across the
 * whole repo found exactly two files: the gate source and that unit test. No
 * test anywhere reached the gate through `saveMetaItem`, and the #3050 call
 * site that dispatches it was wrapped in `if (this.environmentId !== undefined)`
 * — a key the CLI's lightweight host-config assembler leaves undefined
 * (`serve.ts`'s `config.objects && !hasObjectQL` branch → `new ObjectQLPlugin()`
 * with no options; `isHostConfig` → `shouldBootWithLibrary === false` is the
 * flagship showcase's own boot shape). So R1 and R2 executed on **no
 * self-hosted deployment at all**, and the measured answers to the three PUTs
 * below were `200`, `200`, `200`.
 *
 * A unit-tested gate with no integration coverage through the real save path is
 * exactly how that survived, which is why this file is a peer of the one-line
 * predicate change rather than a garnish on it.
 *
 * ## The harness is the host-config topology, deliberately
 *
 * Nothing here is hand-built: a REAL better-sqlite3 `:memory:` engine, a REAL
 * `ObjectStackProtocolImplementation` constructed the way the lightweight
 * assembler constructs it (**no environment id, no declared channel** — so the
 * constructor default `'environment'` is what arms the gate), the REAL
 * `registerObjectPostureGate` wiring plugin-security performs at init, and the
 * REAL `PUT /api/v1/meta/:type/:name` route a client calls. `environmentId`
 * being undefined is asserted in `boot()` rather than assumed: it is the
 * premise of the whole file, and a harness that quietly grew one would turn
 * every case below into a test of the pre-#7674 code path.
 *
 * ## Rejection cases assert the ENVELOPE (ADR-0112)
 *
 * Every refusal asserts `code` AND `status`. A bare "it failed" assertion would
 * be worthless twice over here: this route ANSWERS rather than throws, and the
 * unfixed build answers `200`, so a status-only check would at least catch it —
 * but a `rejects.toThrow()`-shaped check at the protocol level would not, since
 * an object body that reaches persistence on a misconfigured store throws a
 * bare driver `Error` whose `code` and `status` are both `undefined`. The pair
 * is what separates "refused by the gate" from "failed somewhere downstream".
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
import { RestServer } from './rest-server';

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
    engine.registry.registerObject(SysMetadata as any);
    engine.registry.registerObject(SysMetadataHistoryObject as any);
    // The ADR-0029 save-audit sink. Registered so a permitted write's audit row
    // lands rather than degrading into a logged best-effort failure — the noise
    // would otherwise read like a defect in a suite about refusals.
    engine.registry.registerObject(SysMetadataAuditObject as any);
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

    /** Overlay rows actually in `sys_metadata` for a name — the persistence half. */
    const storedRows = async (name: string) =>
        engine.find('sys_metadata', { where: { type: 'object', name } } as any);

    return { engine, protocol, put, storedRows };
}

// ---------------------------------------------------------------------------
// R2 — ADR-0090 D11: external ≤ internal, on all three doors the issue measured
// ---------------------------------------------------------------------------

describe('[#7674] R2 `owd_external_wider` through PUT /api/v1/meta/object/:name', () => {
    /**
     * The issue's three measured 200s, as one table. They are separate doors
     * rather than one: `?mode=draft` takes the draft branch of `saveMetaItem`,
     * `?package=` binds the row to a software package, and the bare PUT is the
     * active path. #4463 D1 records what happens when only one of two doors
     * gates — the draft is the first half of a second minting path — so all
     * three are pinned, not just the headline one.
     */
    it.each([
        { door: 'the active path (bare PUT)', query: {} as Record<string, unknown> },
        { door: 'the draft path (`?mode=draft`)', query: { mode: 'draft' } },
        { door: 'package authoring (`?package=demo_pkg`)', query: { package: 'demo_pkg' } },
    ])('refuses 403 owd_external_wider on $door', async ({ query }) => {
        const { put, storedRows } = await boot();

        const res = await put('qa_probe', probeObject({
            sharingModel: 'private',
            externalSharingModel: 'public_read',
        }), query);

        // ADR-0112 envelope — both halves. `200` is what this answered before.
        expect(res._status).toBe(403);
        expect(res._json?.code).toBe('owd_external_wider');
        expect(String(res._json?.error)).toContain('externalSharingModel');

        // The point the status code alone cannot make: the gate is
        // PRE-persistence. A 403 answered after the row landed would still be
        // the defect, and `GET` would still return the violating pair.
        expect(await storedRows('qa_probe')).toEqual([]);
    }, 60_000);

    it('catches the unset-internal case too — an absent `sharingModel` is `private` (ADR-0090 D1)', async () => {
        // The gate resolves an unset internal to `private` rather than skipping
        // the comparison, so the most natural authoring mistake — declaring only
        // the external side — is refused rather than waved through.
        const { put, storedRows } = await boot();

        const res = await put('qa_probe', probeObject({ externalSharingModel: 'public_read_write' }));

        expect(res._status).toBe(403);
        expect(res._json?.code).toBe('owd_external_wider');
        expect(await storedRows('qa_probe')).toEqual([]);
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
        // Distinct from R2: `public_read` external against `public_read`
        // internal is NOT external-wider, so R2 passes the body. Only the
        // comparison against the PACKAGED declaration (external `private`) can
        // refuse it. A suite that only ever sent an external-wider pair could
        // not tell the two rules apart.
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
        { pair: 'no OWD keys at all', over: {} },
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
     * package author is treated as one by this door too — package authoring is
     * gated at build time instead (`validateSecurityPosture` is `CLI_ONLY` in
     * `AUTHORING_RULES`, and R1's own message prescribes that route: "widen it
     * in the package source and publish through the package pipeline").
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
