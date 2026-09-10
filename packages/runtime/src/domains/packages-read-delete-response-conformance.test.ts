// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16781 deliverable 2 — the payloads `GET /packages` and
 * `DELETE /packages/:id` actually serve, parsed against the contracts
 * `@objectstack/spec/api` declares for them.
 *
 * ## What was measured, and why this file exists
 *
 * The contract review of PR #16628 (comment 5578894182, finding F2) measured
 * two doors answering shapes their own declared schemas refuse:
 *
 *   - `GET /packages` answered `{ packages, total }`, while
 *     `ListInstalledPackagesResponseSchema` requires `hasMore`;
 *   - `DELETE /packages/:id` answered `{ success, registryRemoved, persisted }`,
 *     while `UninstallPackageApiResponseSchema` requires `packageId`.
 *
 * Both were reconciled toward the SPEC (protocol is the baseline) and both
 * reconciliations are ADDITIVE: a key each door was missing was added, and no
 * key that was on either wire left it. This file is the conformance coverage
 * `route-ledger.ts`'s `responseSchema` field is forbidden to be written
 * without — 「⛔ DO NOT FILL A ROW THAT HAS NO CONFORMANCE COVERAGE」 — and it
 * is also what says WHICH of the two rows may carry a name and which may not.
 *
 * ## The declared surface here is the WHOLE BODY, not the `data`
 *
 * Unlike the `/packages` lifecycle rows (`PublishPackageDraftsResponseSchema`
 * and friends), which declare the `data` payload alone, both schemas here are
 * `BaseResponseSchema.extend({ data })` — they name the envelope AND its
 * payload. So the parses below are handed `body`, not `body.data`, and a
 * regression in the envelope reddens here too.
 *
 * ## ⚠️ The list row's remaining gap is the #14242 STAGE mismatch, not F2
 *
 * F2 was not the only thing standing between `GET /packages` and its declared
 * schema, and this file measures the rest rather than declaring past it.
 * `ListInstalledPackagesResponseSchema` types each row as
 * `InstalledPackageSchema`, whose `manifest` is `ManifestSchema` — the
 * AUTHORING-stage manifest, where `objects` is an array of GLOB PATTERNS. What
 * the registry stores, and therefore what this door serves, is the ASSEMBLED
 * body: `ObjectQL.registerApp` is handed `manifest.objects` as object
 * DEFINITIONS and `SchemaRegistry.installPackage` records what it was given.
 *
 * That is the mismatch #14242 identified one layer down, whose maintainer
 * ruling (2026-09-02, quoted in `stack.zod.ts` at `ArtifactPackageSchema`) was
 * to «declare the assembled stage rather than widen the authoring one». No
 * assembled-stage counterpart of `InstalledPackageSchema` exists in
 * `@objectstack/spec/api` yet, and authoring one is a `packages/spec` change
 * this card is explicitly routed away from.
 *
 * ⇒ The `GET /packages` ledger row is deliberately left WITHOUT a
 * `responseSchema`. Writing one would be exactly the "declared but unverified"
 * surface the ledger header exists to prevent: it would read as a promise the
 * door keeps only for glob-authored packages and breaks for every
 * `defineStack()` host, which is the shipped open-core path. The boundary is
 * pinned below in BOTH directions, so whoever declares the assembled stage
 * gets a red test telling them the row has become fillable.
 *
 * ## The residue on the delete row, PINNED rather than hidden
 *
 * `UninstallPackageApiResponseSchema` does not carry `registryRemoved` or
 * `persisted`, which the delete door really serves, so a declared parse
 * STRIPS them. Deleting live keys from a published payload to make the parse
 * total is a wire removal and out of this card's scope; widening the schema is
 * again `packages/spec`. So the gap is asserted BY NAME: a measured, bounded
 * residue, where either side moving turns this red instead of drifting.
 *
 * ## Harness
 *
 * Borrowed from `packages-single-door.test.ts`: a REAL `SchemaRegistry` with a
 * real package installed, and identity through the real resolver (the kernel
 * offers an `auth` session and an ObjectQL engine whose `find` answers the
 * permission-set tables), so the rows under test are the rows the door builds
 * and the gates inside the domain run rather than being bypassed.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import {
    ListInstalledPackagesResponseSchema,
    UninstallPackageApiResponseSchema,
} from '@objectstack/spec/api';
import { HttpDispatcher, type HttpDispatcherResult } from '../http-dispatcher.js';

const PREFIX = '/api/v1';

/**
 * The GLOB-authored manifest — the AUTHORING stage `ManifestSchema` declares,
 * where `objects` names file patterns.
 */
const GLOB_PKG = {
    id: 'com.acme.glob', namespace: 'glob', version: '1.0.0', type: 'app', scope: 'project',
    name: 'Glob Authored', objects: ['./src/objects/*.object.yml'],
};

/**
 * The ASSEMBLED manifest a `defineStack()` host produces — `objects` carries
 * object DEFINITIONS, which is the payload `ObjectQL.registerApp` iterates.
 * This is the shipped open-core shape.
 */
const CODE_PKG = {
    id: 'com.acme.code', namespace: 'code', version: '1.0.0', type: 'app', scope: 'project',
    name: 'Code Defined', objects: [{ name: 'code_lead', fields: { title: { type: 'text' } } }],
};

/** The permission store the shared authz resolver reads, in its shipped shapes. */
const TABLES: Record<string, any[]> = {
    sys_user: [{ id: 'u_admin', email: 'u_admin@example.com' }],
    sys_user_permission_set: [{ user_id: 'u_admin', permission_set_id: 'ps_pkg' }],
    sys_permission_set: [
        { id: 'ps_pkg', name: 'pkg_admin', system_permissions: ['manage_metadata', 'studio.access'] },
    ],
};

/**
 * The fixture's ONE hand-written where-matcher: equality plus `$in` — the two
 * shapes the shared resolver actually issues — and it REFUSES every other
 * shape loudly instead of silently matching (the check:where-matcher
 * convention).
 */
function matchesWhere(row: any, where: any): boolean {
    for (const [field, cond] of Object.entries(where ?? {})) {
        if (field.startsWith('$')) {
            throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
        }
        if (cond !== null && typeof cond === 'object') {
            const ops = Object.keys(cond as object);
            if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
                throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
            }
            if (!(cond as any).$in.includes(row[field])) return false;
            continue;
        }
        if (row[field] !== cond) return false;
    }
    return true;
}

/**
 * @param manifests packages to install into the real registry.
 * @param protocol  optional `protocol` slot; supplied for the delete cases so
 *                  `persisted` is a REAL object on the wire rather than the
 *                  `undefined` a JSON round-trip would silently drop.
 */
function dispatcher(manifests: any[], protocol?: unknown): HttpDispatcher {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    for (const m of manifests) registry.installPackage(m as any);

    const ql = {
        registry,
        find: async (object: string, q: any = {}) => {
            const rows = (TABLES[object] ?? []).filter((row: any) => matchesWhere(row, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
    };
    const auth = { api: { getSession: async () => ({ user: { id: 'u_admin' } }) } };
    const services: Record<string, unknown> = { objectql: ql, auth, ...(protocol ? { protocol } : {}) };
    return new HttpDispatcher({
        getState: () => 'running',
        getService: (n: string) => services[n],
        getServiceAsync: async (n: string) => services[n],
    } as any);
}

function responseOf(res: HttpDispatcherResult, what: string): NonNullable<HttpDispatcherResult['response']> {
    const { response } = res;
    if (!response) throw new Error(`${what} answered no response at all`);
    return response;
}

/**
 * Drive the door and read back what a CLIENT would see.
 *
 * The JSON round-trip is load-bearing rather than ceremonial: an in-process
 * object carries an `undefined` member as a present key while the wire does
 * not, and the conformance claim is about the wire.
 */
async function send(
    method: string, url: string, manifests: any[], protocol?: unknown,
): Promise<{ status: number; body: any }> {
    const ctx: any = { request: new Request(`http://pin.local${url}`, { method }) };
    const res = await dispatcher(manifests, protocol)
        .dispatch(method, url.substring(PREFIX.length), undefined, {}, ctx, PREFIX);
    const response = responseOf(res, `${method} ${url}`);
    return { status: response.status, body: JSON.parse(JSON.stringify(response.body)) };
}

/** Keys of `raw` that the declared parse refused to carry through. */
function strippedKeys(raw: Record<string, unknown>, parsed: Record<string, unknown>): string[] {
    return Object.keys(raw).filter((k) => !(k in parsed));
}

describe('#16781 — GET /packages: the F2 gap is closed on EVERY authoring path', () => {
    for (const [label, pkg] of [['glob-authored', GLOB_PKG], ['assembled / defineStack', CODE_PKG]] as const) {
        it(`${label}: \`hasMore\` — the key F2 measured missing — is on the wire`, async () => {
            const r = await send('GET', `${PREFIX}/packages`, [pkg]);
            expect(r.status).toBe(200);
            expect(r.body.data.hasMore).toBe(false);
            expect(r.body.data.total).toBe(1);
        });

        it(`${label}: the \`data\` envelope carries ONLY keys the contract declares`, async () => {
            const r = await send('GET', `${PREFIX}/packages`, [pkg]);
            // Read off the declaration rather than restated: `nextCursor` is
            // optional and absent (this door does not paginate), so the served
            // set is exactly these three.
            expect(Object.keys(r.body.data).sort()).toEqual(['hasMore', 'packages', 'total']);
        });
    }

    it('a glob-authored row parses END TO END — this is the shape the contract describes', async () => {
        const r = await send('GET', `${PREFIX}/packages`, [GLOB_PKG]);
        const parsed = ListInstalledPackagesResponseSchema.parse(r.body);
        expect(parsed.success).toBe(true);
        expect(parsed.data.hasMore).toBe(false);
        expect(parsed.data.packages).toHaveLength(1);
        expect(strippedKeys(r.body.data, parsed.data as any)).toEqual([]);
    });

    it('`hasMore` is what closed F2: the pre-#16781 body is REFUSED', async () => {
        const r = await send('GET', `${PREFIX}/packages`, [GLOB_PKG]);
        // The exact payload this door served before the reconciliation, built
        // by deleting the one key that was added — so this is a statement
        // about the fix, not about a hand-written literal.
        const before = { ...r.body, data: { ...r.body.data } };
        delete before.data.hasMore;

        const verdict = ListInstalledPackagesResponseSchema.safeParse(before);
        expect(verdict.success).toBe(false);
        expect(verdict.error!.issues.some((i) => i.path.join('.') === 'data.hasMore')).toBe(true);
    });

    /**
     * ⭐ THE BOUNDARY, and the reason the `GET /packages` ledger row carries no
     * `responseSchema`.
     *
     * This asserts a CURRENT FAILURE on purpose. On the shipped `defineStack()`
     * path the served row still does not parse — and the surviving issue is
     * `manifest.objects` ALONE, the #14242 authoring-vs-assembled stage
     * mismatch, with `data.hasMore` gone from the issue list because this card
     * closed it. When someone declares the assembled stage (the ruled remedy),
     * this test goes red and tells them the row has become fillable.
     */
    it('the assembled row does NOT yet parse, and the ONLY surviving issue is the #14242 stage mismatch', async () => {
        const r = await send('GET', `${PREFIX}/packages`, [CODE_PKG]);
        const verdict = ListInstalledPackagesResponseSchema.safeParse(r.body);

        expect(verdict.success).toBe(false);
        expect(verdict.error!.issues.map((i) => i.path.join('.')))
            .toEqual(['data.packages.0.manifest.objects.0']);
    });
});

describe('#16781 — DELETE /packages/:id conforms to UninstallPackageApiResponseSchema', () => {
    /** A `protocol` slot whose `deletePackage` answers the clean-uninstall shape. */
    const protocolStub = () => ({
        deletePackage: vi.fn().mockResolvedValue({
            success: true, deletedCount: 2, failedCount: 0, failed: [], cleanups: [],
        }),
    });

    const del = (pkg: any = CODE_PKG) =>
        send('DELETE', `${PREFIX}/packages/${pkg.id}`, [pkg], protocolStub());

    it('the served body parses, and `packageId` — the key F2 measured missing — names the package', async () => {
        const r = await del();
        expect(r.status).toBe(200);

        const parsed = UninstallPackageApiResponseSchema.parse(r.body);
        expect(parsed.success).toBe(true);
        expect(parsed.data.packageId).toBe(CODE_PKG.id);
        expect(parsed.data.success).toBe(true);
    });

    it('it parses on BOTH authoring paths — this row carries no manifest, so #14242 cannot reach it', async () => {
        const parsed = UninstallPackageApiResponseSchema.parse((await del(GLOB_PKG)).body);
        expect(parsed.data.packageId).toBe(GLOB_PKG.id);
    });

    it('`packageId` is what closed F2: the pre-#16781 body is REFUSED', async () => {
        const r = await del();
        const before = { ...r.body, data: { ...r.body.data } };
        delete before.data.packageId;

        const verdict = UninstallPackageApiResponseSchema.safeParse(before);
        expect(verdict.success).toBe(false);
        expect(verdict.error!.issues.some((i) => i.path.join('.') === 'data.packageId')).toBe(true);
    });

    it('the UNDECLARED residue is exactly `registryRemoved` + `persisted` — named, not hidden', async () => {
        const r = await del();
        const parsed: any = UninstallPackageApiResponseSchema.parse(r.body);

        // The door serves these; the schema does not carry them, so a declared
        // parse drops them. Removing them from the wire is a payload DELETION
        // and out of this card's scope; widening the schema is a
        // `packages/spec` change this card is routed away from. Asserted by
        // name so the gap stays a measured fact rather than a silent one.
        expect(strippedKeys(r.body.data, parsed.data)).toEqual(['registryRemoved', 'persisted']);
    });
});
