// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24670] `PATCH /api/v1/packages/:id` accepts the manifest's `dependencies`
 * row, judged by `ManifestSchema`'s own `dependencies` row from
 * `@objectstack/spec` and never restated here.
 *
 * ## The defect
 *
 * The door built its patch from `name`, `description` and `version` only, so a
 * package's `dependencies` could be set at create and never again. The save
 * door's closure verdict reads exactly that declaration, and its refusal tells
 * the author to "declare a dependency … in the `dependencies` of P's
 * manifest" — a remedy no door applied to a package that already exists.
 *
 * ## What this file pins (the in-memory registry and the door's own judgment)
 *
 * - the row is persisted: flat or under the `manifest` wrapper, the registry's
 *   manifest carries it and `GET /packages/:id` serves it; the row replaces
 *   the stored one whole;
 * - a malformed row is refused `400 VALIDATION_ERROR` — the envelope
 *   `POST /packages` answers for the same row at create — and NOTHING is
 *   written: not the row, not a valid `name` sent beside it, and on the
 *   protocol branch the protocol is never called;
 * - `name`, `description` and `version` behave as before, and a patch that
 *   does not send `dependencies` leaves the stored row alone.
 *
 * The protocol branch's durable half (`sys_packages`, a restart) and the
 * remedy end to end are pinned over the shipped pieces in
 * `../package-dependencies-patch.integration.test.ts`.
 *
 * ## Harness
 *
 * The real `HttpDispatcher` over a real `SchemaRegistry`. `@objectstack/objectql`
 * resolves through `exports` to its `dist/`: rebuild it before reading a
 * result here after touching `registry.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

let home: string;
let priorHome: string | undefined;

beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-24670-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const ID = 'com.acme.crm';
const DECLARED = { 'com.acme.core': '^1.0.0' };

/** A complete authoring-stage manifest, declaring one dependency. */
const manifest = () => ({
    id: ID,
    name: 'Acme CRM',
    namespace: 'crm',
    version: '1.0.0',
    type: 'app',
    description: 'before',
    dependencies: { ...DECLARED },
});

/**
 * One process: a registry holding the package, and the door. With
 * `protocol`, the door's protocol branch reaches that double; without it, the
 * door takes its in-memory fallback.
 */
function boot(protocol?: { updatePackage: (...args: any[]) => any }) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage(manifest() as any, 'authored');
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'objectql') return Promise.resolve({ registry });
            if (name === 'protocol' && protocol) return Promise.resolve(protocol);
            return null;
        },
        context: { getService: () => null },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const call = async (method: string, path: string, body?: unknown) => {
        const res = await dispatcher.handlePackages(path, method, body, {}, PKG_ADMIN());
        const json = JSON.parse(JSON.stringify(res.response?.body ?? null));
        return { status: res.response?.status ?? 0, code: json?.error?.code as string | undefined, body: json };
    };
    /** The manifest the registry holds, as a plain value. */
    const stored = () => JSON.parse(JSON.stringify(registry.getPackage(ID)?.manifest ?? null));
    return { registry, call, stored };
}

/** Rows `ManifestSchema`'s `dependencies` row refuses: a non-string version, a list, a scalar, a null. */
const MALFORMED: ReadonlyArray<[string, unknown]> = [
    ['a non-string version requirement', { 'com.acme.core': 1 }],
    ['a list of ids', ['com.acme.core']],
    ['a bare string', 'com.acme.core'],
    ['null', null],
];

describe('[#24670] PATCH /packages/:id — `dependencies` is persisted (in-memory fallback)', () => {
    for (const [form, wrap] of [
        ['flat', (patch: object) => patch],
        ['under the `manifest` wrapper', (patch: object) => ({ manifest: patch })],
    ] as const) {
        it(`${form}: the row reaches the registry's manifest and GET /packages/:id serves it`, async () => {
            const p = boot();
            const row = { 'com.acme.core': '^2.0.0', 'com.acme.billing': '^1.0.0' };

            const patched = await p.call('PATCH', `/${ID}`, wrap({ dependencies: row }));

            expect(patched.status, JSON.stringify(patched.body)).toBe(200);
            expect(p.stored().dependencies).toEqual(row);
            const read = await p.call('GET', `/${ID}`);
            expect(read.status).toBe(200);
            expect(read.body?.data?.manifest?.dependencies).toEqual(row);
        });
    }

    it('the row replaces the stored one whole: an entry it leaves out is removed, and `{}` clears it', async () => {
        const p = boot();

        await p.call('PATCH', `/${ID}`, { dependencies: { 'com.acme.billing': '^1.0.0' } });
        expect(p.stored().dependencies).toEqual({ 'com.acme.billing': '^1.0.0' });

        const cleared = await p.call('PATCH', `/${ID}`, { dependencies: {} });
        expect(cleared.status).toBe(200);
        expect(p.stored().dependencies).toEqual({});
    });
});

describe('[#24670] PATCH /packages/:id — a malformed `dependencies` row is refused, and nothing is written', () => {
    for (const [what, row] of MALFORMED) {
        it(`${what}: 400 VALIDATION_ERROR naming \`dependencies\`, the stored manifest unchanged`, async () => {
            const p = boot();
            const before = p.stored();

            const answer = await p.call('PATCH', `/${ID}`, { dependencies: row });

            expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
            expect(answer.body?.error?.message).toContain('dependencies');
            expect(p.stored()).toEqual(before);
        });
    }

    it('a valid `name` sent beside a malformed row is not written either', async () => {
        const p = boot();
        const before = p.stored();

        const answer = await p.call('PATCH', `/${ID}`, { manifest: { name: 'Renamed', dependencies: { x: 2 } } });

        expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect(p.stored()).toEqual(before);
    });

    it('the protocol branch: refused before the protocol is called', async () => {
        const updatePackage = vi.fn();
        const p = boot({ updatePackage });

        const answer = await p.call('PATCH', `/${ID}`, { dependencies: { 'com.acme.core': 1 } });

        expect({ status: answer.status, code: answer.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect(updatePackage).not.toHaveBeenCalled();
    });

    it('the same envelope `POST /packages` answers for the same row at create', async () => {
        const p = boot();
        const row = { 'com.acme.core': 1 };

        const atCreate = await p.call('POST', '', { manifest: { ...manifest(), id: 'com.acme.other', namespace: 'other', dependencies: row } });
        const atEdit = await p.call('PATCH', `/${ID}`, { dependencies: row });

        expect({ status: atCreate.status, code: atCreate.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect({ status: atEdit.status, code: atEdit.code }).toEqual({ status: atCreate.status, code: atCreate.code });
    });
});

describe('[#24670] PATCH /packages/:id — the three existing keys behave as before', () => {
    it('a name / description / version patch persists exactly those and leaves `dependencies` as stored', async () => {
        const p = boot();

        const answer = await p.call('PATCH', `/${ID}`, { name: '  Renamed  ', description: 'after', version: '2.0.0' });

        expect(answer.status).toBe(200);
        expect(p.stored()).toMatchObject({ name: 'Renamed', description: 'after', version: '2.0.0', dependencies: DECLARED });
    });

    it('an empty name and a non-SemVer version are still refused 400, and an empty body names `dependencies` among the keys', async () => {
        const p = boot();
        const before = p.stored();

        expect((await p.call('PATCH', `/${ID}`, { name: '  ' })).status).toBe(400);
        expect((await p.call('PATCH', `/${ID}`, { version: '1.2' })).status).toBe(400);
        const empty = await p.call('PATCH', `/${ID}`, {});
        expect({ status: empty.status, code: empty.code }).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect(empty.body?.error?.message).toContain('dependencies');
        expect(p.stored()).toEqual(before);
    });

    it('the protocol branch receives the parsed row beside the other keys', async () => {
        const updatePackage = vi.fn().mockResolvedValue({ package: { id: ID } });
        const p = boot({ updatePackage });

        const answer = await p.call('PATCH', `/${ID}`, { manifest: { description: 'after', dependencies: DECLARED } });

        expect(answer.status).toBe(200);
        expect(updatePackage).toHaveBeenCalledWith({ packageId: ID, patch: { description: 'after', dependencies: DECLARED } });
    });
});
