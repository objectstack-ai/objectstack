// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` lifecycle — the ADR-0070 READ-ONLY gate (#7560).
 *
 * ## The defect
 *
 * A QA run drove an AUTHORIZED admin at two platform packages:
 *
 *   • `PATCH /packages/<platform pkg>/disable` → **200**
 *   • `DELETE /packages/<platform pkg>`        → **200**, and the package was
 *     really gone from `GET /packages` on the running process.
 *
 * One API call took platform functionality out of a live deployment. `DELETE`
 * came back on restart (the packages are code-loaded, so nothing is permanently
 * destroyed); `disable` did NOT — `setPackageDisabled` persists the choice to
 * `<OS_HOME>/package-state/<env>.json` and the registry replays it at boot.
 *
 * ## Two axes, not one
 *
 * #7033 / PR #7083 gave the whole `/packages` domain CALLER authorization
 * (`manage_metadata` on writes, the ADR-0106 D4 set on reads, an anonymous
 * floor) — *who may call the route*. That is pinned next door in
 * `packages-capability-gate.test.ts` and is NOT what this file is about. This
 * file pins *what the route may do once the caller is allowed*: the caller here
 * holds `manage_metadata` throughout, and is refused anyway, because read-only
 * is a property of the PACKAGE. Tightening the caller gate would not have fixed
 * this and would have broken legitimate admins.
 *
 * ## What is asserted, and why it is not the status code
 *
 * The original report's harm was not "200 instead of 422" — it was that the
 * package LEFT THE REGISTRY LISTING of the running process. So every refusal
 * case below asserts the listing observable (`registry.getAllPackages()`), and
 * the tests drive a REAL {@link SchemaRegistry}, not a `vi.fn()` double: a mock
 * `uninstallPackage` cannot tell you whether the package survived.
 *
 * ## The gate must not be an outage
 *
 * A gate that refuses everything is not a fix. Every refusal case is mirrored by
 * a writable-package case that still succeeds AND whose effect is observed in
 * the same listing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── package ids under test ───────────────────────────────────────────────────
/** Read-only signal #1: manifest `scope: 'system'` (platform-delivered). */
const PLATFORM_SCOPED = 'com.objectstack.platform';
/** Read-only signal #1b: manifest `scope: 'cloud'` (marketplace/control-plane). */
const CLOUD_SCOPED = 'com.objectstack.cloudpack';
/**
 * Read-only signal #2: a CODE-LOADED package — registered into
 * `engine.manifests` by `registerApp` at boot. Its manifest scope is the plain
 * default (`project`), so only the manifest-map signal marks it read-only. This
 * is the shape the #7560 repro used ("restart — the package is back, confirming
 * it is code-loaded").
 */
const CODE_LOADED = 'com.objectstack.showcase';
/** The writable base — a DB-installed project package the org owns. */
const WRITABLE = 'com.acme.myapp';

function manifest(id: string, scope?: 'system' | 'cloud' | 'project') {
    return {
        id,
        name: id,
        version: '1.0.0',
        ...(scope ? { scope } : {}),
    } as any;
}

/**
 * A dispatcher over a real `SchemaRegistry`. `objectql` stands in for the
 * engine: the route reads `.registry` off it, and the ADR-0070 predicate reads
 * `.manifests` — the same two handles `ObjectStackProtocolImplementation` asks
 * for on the authoring side.
 */
function make() {
    const registry = new SchemaRegistry({ logLevel: 'silent' } as any);
    registry.installPackage(manifest(PLATFORM_SCOPED, 'system'));
    registry.installPackage(manifest(CLOUD_SCOPED, 'cloud'));
    registry.installPackage(manifest(CODE_LOADED, 'project'));
    registry.installPackage(manifest(WRITABLE, 'project'));

    // Only the code-loaded package booted from an artifact.
    const manifests = new Map<string, any>([[CODE_LOADED, manifest(CODE_LOADED)]]);

    const objectql = { registry, manifests };
    const protocol = {
        // Present so a DELETE that is ALLOWED reaches its persisted half too —
        // the allow-path must be exercised end to end, not just to the gate.
        deletePackage: async () => ({ deletedCount: 1 }),
        // [#14451] This double MINTS THE TARGET PACKAGE RECORD, because the real
        // `duplicatePackage` does: its `registry.installPackage` call runs ahead
        // of the copy loop, which is why the reported defect left a real, empty
        // `com.acme.dupbase` in `GET /packages`.
        //
        // ⚠️ Not decoration — it is what makes the refusal cases falsifiable. A
        // double that only returned a value would leave "the target is not in
        // the listing" true whether or not the gate exists, i.e. an assertion
        // that can never go red. With the mint in place, deleting the gate makes
        // those cases fail on the listing, not merely on the status.
        duplicatePackage: vi.fn(async (req: any) => {
            registry.installPackage(manifest(req.targetPackageId));
            // The exact empty-success body the card measured on a running code
            // package: HTTP 200, `success: false`, nothing copied, nothing named
            // as failed.
            return {
                success: false,
                copiedCount: 0,
                failedCount: 0,
                targetPackageId: req.targetPackageId,
                copied: [],
                failed: [],
            };
        }),
    };
    const kernel: any = {
        context: {
            getService: (name: string) =>
                name === 'objectql' ? objectql : name === 'protocol' ? protocol : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry, protocol };
}

/** Authorized under #7033 — holds the write capability on every call below. */
const admin = (): any => ({
    request: {},
    environmentId: 'pkg-readonly-gate-test',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata'] },
});
/** Engine self-invocation. Read-only is about the package, not the caller. */
const system = (): any => ({
    request: {},
    environmentId: 'pkg-readonly-gate-test',
    executionContext: { isSystem: true },
});

const listedIds = (registry: SchemaRegistry): string[] =>
    registry.getAllPackages().map((p: any) => p.manifest.id);

// `setPackageDisabled` writes a real JSON file under OS_HOME on the ALLOW path.
// Point OS_HOME at a temp dir so the suite never touches the developer's
// `~/.objectstack` (and so a leftover disable cannot leak between runs).
let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-pkg-readonly-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. REFUSED — a read-only package survives both lifecycle verbs
// ══════════════════════════════════════════════════════════════════════════════

const READ_ONLY_PACKAGES: Array<{ label: string; id: string }> = [
    { label: 'platform-scoped (manifest scope: system)', id: PLATFORM_SCOPED },
    { label: 'cloud-scoped (manifest scope: cloud)', id: CLOUD_SCOPED },
    { label: 'code-loaded (booted into engine.manifests)', id: CODE_LOADED },
];

describe('/packages lifecycle — DELETE refuses a read-only package (#7560)', () => {
    for (const pkg of READ_ONLY_PACKAGES) {
        it(`422s DELETE on the ${pkg.label} package AND leaves it in the registry listing`, async () => {
            const { dispatcher, registry } = make();
            const before = listedIds(registry);

            const r = await dispatcher.handlePackages(`/${pkg.id}`, 'DELETE', {}, {}, admin());

            expect(r.response?.status).toBe(422);
            expect(r.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
            // THE observable the card was written from: asserting the status
            // alone would not have caught the original defect's actual harm.
            expect(listedIds(registry)).toEqual(before);
            expect(listedIds(registry)).toContain(pkg.id);
            expect(registry.getPackage(pkg.id)).toBeDefined();
        });
    }
});

describe('/packages lifecycle — PATCH /:id/disable refuses a read-only package (#7560)', () => {
    for (const pkg of READ_ONLY_PACKAGES) {
        it(`422s disable on the ${pkg.label} package AND leaves it ENABLED`, async () => {
            const { dispatcher, registry } = make();
            expect(registry.getPackage(pkg.id)?.enabled).toBe(true);

            const r = await dispatcher.handlePackages(`/${pkg.id}/disable`, 'PATCH', {}, {}, admin());

            expect(r.response?.status).toBe(422);
            expect(r.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
            // The lifecycle state is untouched — the refusal ran BEFORE
            // `disablePackage`, not after it.
            expect(registry.getPackage(pkg.id)?.enabled).toBe(true);
            expect(registry.getPackage(pkg.id)?.status).not.toBe('disabled');
        });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. STILL WORKS — the gate is not an outage
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages lifecycle — a WRITABLE package still disables and deletes (#7560)', () => {
    it('disables the writable package and the listing reflects it', async () => {
        const { dispatcher, registry } = make();

        const r = await dispatcher.handlePackages(`/${WRITABLE}/disable`, 'PATCH', {}, {}, admin());

        expect(r.response?.status).toBe(200);
        expect(registry.getPackage(WRITABLE)?.enabled).toBe(false);
        expect(registry.getPackage(WRITABLE)?.status).toBe('disabled');
    });

    it('re-enables the writable package (the disable is reversible, as before)', async () => {
        const { dispatcher, registry } = make();
        await dispatcher.handlePackages(`/${WRITABLE}/disable`, 'PATCH', {}, {}, admin());
        const r = await dispatcher.handlePackages(`/${WRITABLE}/enable`, 'PATCH', {}, {}, admin());

        expect(r.response?.status).toBe(200);
        expect(registry.getPackage(WRITABLE)?.enabled).toBe(true);
    });

    it('deletes the writable package and it leaves the listing', async () => {
        const { dispatcher, registry } = make();
        expect(listedIds(registry)).toContain(WRITABLE);

        const r = await dispatcher.handlePackages(`/${WRITABLE}`, 'DELETE', {}, {}, admin());

        expect(r.response?.status).toBe(200);
        expect(r.response?.body?.data?.registryRemoved).toBe(true);
        expect(listedIds(registry)).not.toContain(WRITABLE);
        // …and the read-only siblings are all still there: the delete removed
        // exactly one package, which is the pre-#7560 behaviour for a package
        // the org owns.
        expect(listedIds(registry).sort()).toEqual([CLOUD_SCOPED, CODE_LOADED, PLATFORM_SCOPED].sort());
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. The gate's axis: it keys on the PACKAGE, not on the caller
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages lifecycle — read-only is a property of the package (#7560)', () => {
    it('refuses an isSystem caller too — the write gate exempts isSystem, this one does not', async () => {
        const { dispatcher, registry } = make();
        const r = await dispatcher.handlePackages(`/${PLATFORM_SCOPED}`, 'DELETE', {}, {}, system());
        expect(r.response?.status).toBe(422);
        expect(listedIds(registry)).toContain(PLATFORM_SCOPED);
    });

    it('is NOT the #7033 caller gate: the admin is authorized (no 401/403) and still refused', async () => {
        const { dispatcher } = make();
        const r = await dispatcher.handlePackages(`/${PLATFORM_SCOPED}/disable`, 'PATCH', {}, {}, admin());
        expect(r.response?.status).not.toBe(401);
        expect(r.response?.status).not.toBe(403);
        expect(r.response?.status).toBe(422);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. The refusal's shape — ADR-0070's existing vocabulary, not a new one
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages lifecycle — the refusal matches the ADR-0070 authoring refusal (#7560)', () => {
    it('answers 422 / WRITABLE_PACKAGE_REQUIRED with the package id and the ADR pointer', async () => {
        const { dispatcher } = make();
        const r = await dispatcher.handlePackages(`/${PLATFORM_SCOPED}`, 'DELETE', {}, {}, admin());
        const err = r.response?.body?.error;
        expect(r.response?.status).toBe(422);
        expect(err?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
        expect(err?.httpStatus).toBe(422);
        expect(err?.message).toContain('read-only');
        expect(err?.details?.packageId).toBe(PLATFORM_SCOPED);
        expect(err?.details?.docs).toBe('docs/adr/0070-package-first-authoring.md');
    });

    it('names the verb it refused, so disable and delete are distinguishable', async () => {
        const { dispatcher } = make();
        const del = await dispatcher.handlePackages(`/${PLATFORM_SCOPED}`, 'DELETE', {}, {}, admin());
        const dis = await dispatcher.handlePackages(`/${PLATFORM_SCOPED}/disable`, 'PATCH', {}, {}, admin());
        expect(del.response?.body?.error?.message).toContain('delete');
        expect(dis.response?.body?.error?.message).toContain('disable');
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. The gate is not an existence oracle — an unknown id still 404s
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages lifecycle — an unknown package id keeps its 404 (#7560)', () => {
    it('404s DELETE on an id nobody installed, rather than re-labelling it 422', async () => {
        const { dispatcher } = make();
        const kernel: any = { context: { getService: (n: string) => (n === 'objectql' ? { registry: new SchemaRegistry({ logLevel: 'silent' } as any), manifests: new Map() } : null) } };
        const d = new HttpDispatcher(kernel);
        const r = await d.handlePackages('/com.nobody.nothing', 'DELETE', {}, {}, admin());
        expect(r.response?.status).toBe(404);
        void dispatcher;
    });

    it('404s disable on an id nobody installed', async () => {
        const kernel: any = { context: { getService: (n: string) => (n === 'objectql' ? { registry: new SchemaRegistry({ logLevel: 'silent' } as any), manifests: new Map() } : null) } };
        const d = new HttpDispatcher(kernel);
        const r = await d.handlePackages('/com.nobody.nothing/disable', 'PATCH', {}, {}, admin());
        expect(r.response?.status).toBe(404);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. [#14451] POST /:id/duplicate — the SOURCE must be a base
//
// ## The defect this section pins
//
// `POST /api/v1/packages/com.example.todo/duplicate` against a RUNNING code
// package answered **HTTP 200** with
// `{"success":false,"copiedCount":0,"failedCount":0,"copied":[],"failed":[]}`
// and left a real, empty `com.acme.dupbase` behind in `GET /packages`.
// Reproduced independently twice on two separate `os dev` processes.
//
// `copiedCount: 0` there is BY CONSTRUCTION: `duplicatePackage` clones the
// source's `sys_metadata` rows, and a code package's metadata is delivered as
// code, so the scan is one that could never have found anything. That is the
// #11063 ruling one route over — "a read that could not happen must not be
// reported as a read that found nothing" — and the caller could not tell it
// from a base that really is empty.
//
// ⛔ The fix is NOT to make duplicate clone code items. ADR-0070 D4 is declared
// and NOT built ("D4–D6 remaining") and its object is a *base*; cloning a code
// package would EXTEND D4, and the ADR still lists that as an open question
// ("should customising a code item also fork it into a writable base?").
//
// ## What is asserted, and why it is not the status code
//
// The harm was the empty shell, so every refusal case asserts the listing —
// and the protocol double MINTS that shell exactly as the real implementation
// does, so these assertions can actually go red. A double that merely returned
// a value would make "the target is absent" true with or without the gate.
// ══════════════════════════════════════════════════════════════════════════════

const DUP_TARGET = 'com.acme.dupbase';

describe('/packages duplicate — a source that is not a base is refused (#14451)', () => {
    for (const pkg of READ_ONLY_PACKAGES) {
        it(`422s duplicate of the ${pkg.label} package AND mints no target record`, async () => {
            const { dispatcher, registry, protocol } = make();
            const before = listedIds(registry);

            const r = await dispatcher.handlePackages(
                `/${pkg.id}/duplicate`, 'POST', { targetPackageId: DUP_TARGET, targetName: 'Dup Base' }, {}, admin(),
            );

            expect(r.response?.status).toBe(422);
            expect(r.response?.body?.error?.code).toBe('DUPLICATE_SOURCE_NOT_A_BASE');
            // THE observable the card was written from: the pre-fix answer left
            // a real, listed, `writable: true` package record behind.
            expect(listedIds(registry)).toEqual(before);
            expect(listedIds(registry)).not.toContain(DUP_TARGET);
            expect(registry.getPackage(DUP_TARGET)).toBeUndefined();
            // The refusal ran BEFORE the protocol call — which is the only
            // placement that can keep the shell from being minted, since
            // `duplicatePackage` installs it ahead of its own copy loop.
            expect(protocol.duplicatePackage).not.toHaveBeenCalled();
            // …and the source is untouched: this route never wrote to it, and
            // the refusal must not have changed that.
            expect(registry.getPackage(pkg.id)).toBeDefined();
        });
    }

    it('answers the ADR-0112 envelope with the package id and the ADR pointer', async () => {
        const { dispatcher } = make();
        const r = await dispatcher.handlePackages(
            `/${CODE_LOADED}/duplicate`, 'POST', { targetPackageId: DUP_TARGET }, {}, admin(),
        );
        const err = r.response?.body?.error;
        expect(r.response?.status).toBe(422);
        expect(err?.code).toBe('DUPLICATE_SOURCE_NOT_A_BASE');
        expect(err?.httpStatus).toBe(422);
        expect(err?.details?.packageId).toBe(CODE_LOADED);
        expect(err?.details?.docs).toBe('docs/adr/0070-package-first-authoring.md');
        // The remedy is the one that EXISTS for a code package (ADR-0005
        // overlay), and the message says why the copy would be empty rather
        // than only that it is refused.
        expect(err?.message).toContain('ADR-0005');
        expect(err?.message).toContain('read-only');
    });

    it('is its OWN code, not WRITABLE_PACKAGE_REQUIRED — the two conditions differ', async () => {
        const { dispatcher } = make();
        const dup = await dispatcher.handlePackages(
            `/${CODE_LOADED}/duplicate`, 'POST', { targetPackageId: DUP_TARGET }, {}, admin(),
        );
        const del = await dispatcher.handlePackages(`/${CODE_LOADED}`, 'DELETE', {}, {}, admin());
        // Same predicate (`isWritablePackage`), same status, different meaning:
        // DELETE is refused because the package may not be WRITTEN to; duplicate
        // is refused because the GESTURE does not apply to this source. A caller
        // told `WRITABLE_PACKAGE_REQUIRED` here would hunt for a way to make a
        // code package writable, which is neither possible nor the remedy.
        expect(del.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
        expect(dup.response?.body?.error?.code).toBe('DUPLICATE_SOURCE_NOT_A_BASE');
        expect(dup.response?.body?.error?.code).not.toBe(del.response?.body?.error?.code);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. [#14451] The gate is not an outage — the control that must be non-zero
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages duplicate — a WRITABLE base still duplicates (#14451)', () => {
    it('reaches the protocol with the source and target it was given, and mints the target', async () => {
        const { dispatcher, registry, protocol } = make();
        expect(listedIds(registry)).not.toContain(DUP_TARGET);

        const r = await dispatcher.handlePackages(
            `/${WRITABLE}/duplicate`, 'POST', { targetPackageId: DUP_TARGET, targetName: 'Dup Base' }, {}, admin(),
        );

        expect(r.response?.status).toBe(200);
        expect(protocol.duplicatePackage).toHaveBeenCalledTimes(1);
        expect(protocol.duplicatePackage.mock.calls[0]?.[0]).toMatchObject({
            sourcePackageId: WRITABLE,
            targetPackageId: DUP_TARGET,
            targetName: 'Dup Base',
        });
        // The non-zero control the refusal cases are read against: on the allow
        // path the double really does mint the record, so their `not.toContain`
        // is a measurement rather than a vacuous truth.
        expect(listedIds(registry)).toContain(DUP_TARGET);
    });

    it('an EMPTY writable base still answers 200 / copiedCount 0 — that read HAPPENED', async () => {
        // ⛔ Deliberately unchanged by this card. The axis is whether the gesture
        // APPLIES to the source, never whether it found anything: a base that
        // owns no active rows is a read that ran and came back empty, which is
        // the legitimate arm of the #11063 ruling. Narrowing this to "refuse an
        // empty result" would refuse a legitimate duplicate of a fresh base.
        const { dispatcher } = make();
        const r = await dispatcher.handlePackages(
            `/${WRITABLE}/duplicate`, 'POST', { targetPackageId: DUP_TARGET }, {}, admin(),
        );
        expect(r.response?.status).toBe(200);
        expect(r.response?.body?.data?.copiedCount).toBe(0);
        expect(r.response?.body?.data?.success).toBe(false);
    });

    it('an UNKNOWN source id falls through to the protocol — the gate is no existence oracle', async () => {
        // Same rule `requireWritablePackage` follows: an id that resolves to
        // nothing is treated as writable, so it reaches the route's own answer
        // instead of being re-labelled 422 by a gate that would then leak which
        // ids exist.
        const { dispatcher, protocol } = make();
        const r = await dispatcher.handlePackages(
            '/com.nobody.nothing/duplicate', 'POST', { targetPackageId: DUP_TARGET }, {}, admin(),
        );
        expect(r.response?.status).not.toBe(422);
        expect(protocol.duplicatePackage).toHaveBeenCalledTimes(1);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. [#14451] The sibling refusal stops prescribing a dead end
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages lifecycle — the read-only refusal no longer sends callers at duplicate (#14451)', () => {
    for (const verb of [
        { label: 'DELETE', path: (id: string) => `/${id}`, method: 'DELETE' },
        { label: 'disable', path: (id: string) => `/${id}/disable`, method: 'PATCH' },
    ]) {
        it(`${verb.label} prescribes the ADR-0005 overlay, not POST /:id/duplicate`, async () => {
            const { dispatcher } = make();
            const r = await dispatcher.handlePackages(verb.path(CODE_LOADED), verb.method, {}, {}, admin());
            const message = String(r.response?.body?.error?.message ?? '');

            expect(r.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
            // It used to read "…or duplicate this one into a writable base
            // (POST /packages/<id>/duplicate) and change that" — a remedy that,
            // for exactly the packages this refusal fires on, now answers 422
            // and before that answered an empty 200. A refusal that prescribes a
            // dead end is worse than one that prescribes nothing.
            expect(message).not.toContain('/duplicate');
            expect(message).toContain('ADR-0005');
        });
    }
});
