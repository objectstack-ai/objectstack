// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` read doors carry the server's OWN writability verdict (#14375,
 * ADR-0130 Consequences row 6 — server half).
 *
 * ## The defect this pins against
 *
 * Studio's package switcher derived "writable" CLIENT-side from
 * `manifest.scope` alone (`scope !== 'project'`). The server's rule is
 * `isWritablePackage` (ADR-0070 D2), and it is a different predicate: it reads
 * `engine.manifests` FIRST — a package booted from an artifact through
 * `registerApp` is read-only whatever its scope says — and only then the
 * `system` / `cloud` scopes. The two rules split on exactly the row ADR-0130
 * introduces: a scope-less `type: module` carried by a multi-package artifact
 * is in `engine.manifests` (read-only) while a scope-less Studio-created base
 * is not (writable). Nothing in the raw row distinguishes them; `engine.manifests`
 * does, and only the server holds it. So the server says it.
 *
 * ## What is asserted
 *
 * The verdict on the wire, per row and per door, for the four shapes the
 * predicate distinguishes — and, as the negative, that the rows are otherwise
 * byte-for-byte what they were: the registry's own records untouched, no other
 * key added or changed. The tests drive a REAL {@link SchemaRegistry} (the
 * records are what `installPackage` actually produces) through the real
 * dispatcher, with `manifests` standing in for the engine's boot map exactly as
 * `packages-readonly-gate.test.ts` does next door.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── the four shapes ──────────────────────────────────────────────────────────
/** Pin 1 — booted code package, explicit `scope: 'project'` (today's hotcrm shape). */
const CODE_PROJECT = 'app.acme.crm';
/**
 * Pin 2 — booted code package with NO scope key: the `type: 'module'` sub-package a
 * multi-package artifact carries (ADR-0130 D4/D5). The raw body is what the
 * load path registers (D7), so the row has no `scope` at all. THE row #14375
 * exists for: the client heuristic said "writable"; the server says read-only.
 */
const CODE_MODULE = 'app.acme.crm.billing';
/** Pin 3 — platform-delivered (`system`) and marketplace-delivered (`cloud`). */
const SYSTEM_SCOPED = 'com.objectstack.platform';
const CLOUD_SCOPED = 'com.objectstack.cloudpack';
/**
 * Pin 4 — a Studio-created database base: installed through `installPackage`
 * only (never `registerApp`), and scope-less. Writable. This is the row a
 * client-side "missing scope → read-only" rule would have broken.
 */
const DB_BASE = 'com.acme.mybase';
/** A project-scoped DB base — also writable (ADR-0070: the org owns it). */
const DB_PROJECT = 'com.acme.myproject';

function manifest(id: string, extra: Record<string, unknown> = {}) {
    return { id, name: id, version: '1.0.0', ...extra } as any;
}

/**
 * A dispatcher over a real `SchemaRegistry`. `objectql` stands in for the
 * engine: the route reads `.registry` off it and the ADR-0070 predicate reads
 * `.manifests` — the same two handles the authoring side asks for.
 */
function make() {
    const registry = new SchemaRegistry({ logLevel: 'silent' } as any);
    registry.installPackage(manifest(CODE_PROJECT, { scope: 'project', type: 'app' }));
    registry.installPackage(manifest(CODE_MODULE, { type: 'module' }));
    registry.installPackage(manifest(SYSTEM_SCOPED, { scope: 'system' }));
    registry.installPackage(manifest(CLOUD_SCOPED, { scope: 'cloud' }));
    registry.installPackage(manifest(DB_BASE));
    registry.installPackage(manifest(DB_PROJECT, { scope: 'project' }));

    // Only the two code packages booted from an artifact — this is what
    // `ObjectQL.registerApp` records for every package of a loaded artifact.
    const manifests = new Map<string, any>([
        [CODE_PROJECT, manifest(CODE_PROJECT, { scope: 'project', type: 'app' })],
        [CODE_MODULE, manifest(CODE_MODULE, { type: 'module' })],
    ]);

    const objectql = { registry, manifests };
    const kernel: any = {
        context: { getService: (name: string) => (name === 'objectql' ? objectql : null) },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry };
}

/** Holds the ADR-0106 D4 read set; the caller gate is not this file's subject. */
const reader = (): any => ({
    request: {},
    environmentId: 'pkg-writable-verdict-test',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] },
});

type Row = { manifest: { id: string }; writable?: boolean } & Record<string, unknown>;

async function list(dispatcher: HttpDispatcher, query: Record<string, unknown> = {}): Promise<Row[]> {
    const r = await dispatcher.handlePackages('/', 'GET', undefined, query, reader());
    expect(r.response?.status ?? 200).toBe(200);
    return r.response?.body?.data?.packages as Row[];
}

const byId = (rows: Row[], id: string): Row => {
    const row = rows.find((p) => p.manifest?.id === id);
    if (!row) throw new Error(`row ${id} missing from listing`);
    return row;
};

// ══════════════════════════════════════════════════════════════════════════════
// 1. The verdict, per shape — GET /packages
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /packages — every row carries the server\'s writable verdict (#14375)', () => {
    it('pin 1: a booted code package with scope "project" is writable: false', async () => {
        const rows = await list(make().dispatcher);
        expect(byId(rows, CODE_PROJECT).writable).toBe(false);
    });

    it('pin 2: a booted, SCOPE-LESS module (multi-package artifact sub-package) is writable: false', async () => {
        const rows = await list(make().dispatcher);
        const row = byId(rows, CODE_MODULE);
        // The raw row really has no scope — the verdict is not coming from it.
        expect((row.manifest as any).scope).toBeUndefined();
        expect(row.writable).toBe(false);
    });

    it('pin 3: system- and cloud-scoped packages are writable: false', async () => {
        const rows = await list(make().dispatcher);
        expect(byId(rows, SYSTEM_SCOPED).writable).toBe(false);
        expect(byId(rows, CLOUD_SCOPED).writable).toBe(false);
    });

    it('pin 4: a SCOPE-LESS database base (installed, never booted) is writable: true', async () => {
        const rows = await list(make().dispatcher);
        const row = byId(rows, DB_BASE);
        expect((row.manifest as any).scope).toBeUndefined();
        expect(row.writable).toBe(true);
        // …and so is a project-scoped one the org owns.
        expect(byId(rows, DB_PROJECT).writable).toBe(true);
    });

    it('pins 2 + 4 together: the two scope-less rows are told apart — which no scope-only rule can do', async () => {
        const rows = await list(make().dispatcher);
        const module_ = byId(rows, CODE_MODULE);
        const base = byId(rows, DB_BASE);
        expect((module_.manifest as any).scope).toBe((base.manifest as any).scope); // both undefined
        expect(module_.writable).not.toBe(base.writable);
    });

    it('carries the verdict through the ?type= filter too', async () => {
        const rows = await list(make().dispatcher, { type: 'module' });
        expect(rows.map((p) => p.manifest.id)).toEqual([CODE_MODULE]);
        expect(rows[0].writable).toBe(false);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Same verdict, same predicate — GET /packages/:id
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /packages/:id — the detail door carries the same verdict (#14375)', () => {
    it('pin 2 on the detail door: the scope-less booted module is writable: false', async () => {
        const r = await make().dispatcher.handlePackages(`/${CODE_MODULE}`, 'GET', undefined, {}, reader());
        expect(r.response?.status ?? 200).toBe(200);
        expect(r.response?.body?.data?.manifest?.id).toBe(CODE_MODULE);
        expect(r.response?.body?.data?.writable).toBe(false);
    });

    it('pin 4 on the detail door: the scope-less database base is writable: true', async () => {
        const r = await make().dispatcher.handlePackages(`/${DB_BASE}`, 'GET', undefined, {}, reader());
        expect(r.response?.status ?? 200).toBe(200);
        expect(r.response?.body?.data?.writable).toBe(true);
    });

    it('an unknown id is still a 404 — the verdict never becomes an existence oracle', async () => {
        const r = await make().dispatcher.handlePackages('/com.nobody.here', 'GET', undefined, {}, reader());
        expect(r.response?.status).toBe(404);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. The negative — nothing else about the rows changed, and nothing was stored
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /packages — the verdict is additive and computed, never stored (#14375)', () => {
    it('pin 5: apart from `writable`, every row deep-equals the registry\'s own record', async () => {
        const { dispatcher, registry } = make();
        const rows = await list(dispatcher);
        const records = registry.getAllPackages() as unknown as Row[];
        expect(rows).toHaveLength(records.length);
        for (const record of records) {
            const { writable, ...rest } = byId(rows, record.manifest.id);
            expect(typeof writable).toBe('boolean');
            // Built from the pre-change shape (the registry record itself), not
            // re-derived from the new code.
            expect(rest).toEqual(record);
        }
    });

    it('pin 5b: the registry\'s own records never gain a `writable` key (spread copy, no mutation)', async () => {
        const { dispatcher, registry } = make();
        await list(dispatcher);
        await dispatcher.handlePackages(`/${CODE_MODULE}`, 'GET', undefined, {}, reader());
        for (const record of registry.getAllPackages() as unknown as Row[]) {
            expect('writable' in record).toBe(false);
        }
        expect('writable' in (registry.getPackage(CODE_MODULE) as any)).toBe(false);
    });

    it('`total` still counts the rows served', async () => {
        const r = await make().dispatcher.handlePackages('/', 'GET', undefined, {}, reader());
        expect(r.response?.body?.data?.total).toBe(6);
        expect(r.response?.body?.data?.packages).toHaveLength(6);
    });
});
