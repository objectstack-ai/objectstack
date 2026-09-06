// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `getMetaItems({ type: 'package' })` stamps the server's OWN writability
 * verdict on every package item (#14375, ADR-0130 Consequences row 6 — the
 * producer the REST `GET /packages` door spreads its registry half from).
 *
 * The verdict is `isWritablePackage` (ADR-0070 D2), the same predicate the
 * authoring (`saveMetaItem`) and lifecycle (`DELETE` / `disable`) gates already
 * enforce — #8146's "one answer to 'is this package writable?'" applied to the
 * read side. It reads `engine.manifests` FIRST: a package booted from an
 * artifact through `registerApp` is read-only whatever its scope says, and a
 * scope-less BOOTED package — a marketplace install / offline file import,
 * which reaches the registry with no `ManifestSchema` parse — lands there
 * too, while a scope-less Studio-created base (`POST /api/v1/packages`) does
 * not. ⛔ Neither is a module carried by a multi-package artifact:
 * `defineStack` parses every `packages[]` entry through `ManifestSchema`, whose
 * `scope` is `.default('project')`, so no package of a compiled artifact is
 * ever scope-less. Only the server holds
 * `engine.manifests`, which is why the client could never derive this.
 *
 * The engine is the same shape `meta-overlay-cache.test.ts` drives: the
 * registry surface this method touches, a `find` that answers the overlay
 * query with nothing, and — the subject here — a `manifests` map.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** Booted code package, explicit `scope: 'project'`. */
const CODE_PROJECT = 'app.acme.crm';
/** Booted and SCOPE-LESS — a marketplace / offline import, registered unparsed. */
const CODE_MODULE = 'app.acme.crm.billing';
/** Platform / marketplace delivered. */
const SYSTEM_SCOPED = 'com.objectstack.platform';
const CLOUD_SCOPED = 'com.objectstack.cloudpack';
/** Studio-created database base: installed, never booted, scope-less. */
const DB_BASE = 'com.acme.mybase';

type Row = { manifest: Record<string, unknown>; status: string; enabled: boolean };

function row(id: string, extra: Record<string, unknown> = {}): Row {
    return { manifest: { id, name: id, version: '1.0.0', ...extra }, status: 'installed', enabled: true };
}

function make() {
    const records: Row[] = [
        row(CODE_PROJECT, { scope: 'project', type: 'app' }),
        row(CODE_MODULE, { type: 'module' }),
        row(SYSTEM_SCOPED, { scope: 'system' }),
        row(CLOUD_SCOPED, { scope: 'cloud' }),
        row(DB_BASE),
    ];
    const byId = new Map(records.map((r) => [r.manifest.id as string, r]));
    // What `ObjectQL.registerApp` records — for every package of a loaded artifact
    // (CODE_PROJECT, parsed and therefore `scope: 'project'`) and for a
    // marketplace / offline import (CODE_MODULE, unparsed and therefore scope-less).
    const manifests = new Map<string, unknown>([
        [CODE_PROJECT, byId.get(CODE_PROJECT)!.manifest],
        [CODE_MODULE, byId.get(CODE_MODULE)!.manifest],
    ]);
    const engine: any = {
        manifests,
        find: async () => [],
        registry: {
            listItems: (type: string) => (type === 'package' ? records : []),
            getPackage: (id: string) => byId.get(id),
            getItem: () => undefined,
            getObject: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { protocol, records };
}

async function listPackages(protocol: ObjectStackProtocolImplementation) {
    const res = await protocol.getMetaItems({ type: 'package' });
    return res.items as Array<Row & { writable?: boolean }>;
}

const pick = (items: Array<Row & { writable?: boolean }>, id: string) => {
    const it = items.find((p) => p.manifest.id === id);
    if (!it) throw new Error(`item ${id} missing`);
    return it;
};

describe('getMetaItems({ type: "package" }) carries the writable verdict (#14375)', () => {
    it('pin 1: a booted code package with scope "project" is writable: false', async () => {
        const items = await listPackages(make().protocol);
        expect(pick(items, CODE_PROJECT).writable).toBe(false);
    });

    it('pin 2: a booted, SCOPE-LESS module is writable: false — the row itself carries no scope', async () => {
        const items = await listPackages(make().protocol);
        const it_ = pick(items, CODE_MODULE);
        expect(it_.manifest.scope).toBeUndefined();
        expect(it_.writable).toBe(false);
    });

    it('pin 3: system- and cloud-scoped packages are writable: false', async () => {
        const items = await listPackages(make().protocol);
        expect(pick(items, SYSTEM_SCOPED).writable).toBe(false);
        expect(pick(items, CLOUD_SCOPED).writable).toBe(false);
    });

    it('pin 4: a SCOPE-LESS database base (never booted) is writable: true', async () => {
        const items = await listPackages(make().protocol);
        const it_ = pick(items, DB_BASE);
        expect(it_.manifest.scope).toBeUndefined();
        expect(it_.writable).toBe(true);
    });

    it('pins 2 + 4: the two scope-less rows differ ONLY in the verdict — the scope cannot tell them apart', async () => {
        const items = await listPackages(make().protocol);
        expect(pick(items, CODE_MODULE).manifest.scope).toBe(pick(items, DB_BASE).manifest.scope);
        expect(pick(items, CODE_MODULE).writable).toBe(false);
        expect(pick(items, DB_BASE).writable).toBe(true);
    });

    it('pin 5: additive and computed — the served row minus `writable` equals the registry record, which is never mutated', async () => {
        const { protocol, records } = make();
        const items = await listPackages(protocol);
        expect(items).toHaveLength(records.length);
        for (const record of records) {
            const { writable, ...rest } = pick(items, record.manifest.id as string);
            expect(typeof writable).toBe('boolean');
            expect(rest).toEqual(record);
            expect('writable' in record).toBe(false);
        }
    });

    it('does not leak onto other types: an `app` listing gains no `writable` key', async () => {
        const { protocol } = make();
        const res = await protocol.getMetaItems({ type: 'app' });
        for (const it_ of res.items as Array<Record<string, unknown>>) {
            expect('writable' in it_).toBe(false);
        }
    });
});
