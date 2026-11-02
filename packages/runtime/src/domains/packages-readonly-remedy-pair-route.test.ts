// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29568, ADR-0146 D2/D3/D11] The remedy every read-only refusal on the
 * `/packages` doors names: customize in the package's paired `<id>.custom`.
 *
 * ## The defect
 *
 * `422 WRITABLE_PACKAGE_REQUIRED` (seven doors) and `422
 * DUPLICATE_SOURCE_NOT_A_BASE` (the duplicate door) appended the ADR-0131 D6
 * remedy: "customise what this package provides beside it, as
 * environment-level state (ADR-0131 D6): save an item under its own name …".
 * Since ADR-0146 D11 that package-less save onto an item the package ships is
 * refused `403 NOT_OVERRIDABLE`, naming the pair, so the refusal prescribed a
 * dead end. Measured on `main` before this change, on the showcase over its
 * real routes: a package-less `PUT` of `view/showcase_task.in_progress`
 * answered `403 NOT_OVERRIDABLE`; the ensure door then answered `201`, and the
 * same view saved into `com.example.showcase.custom` declaring `overrides`
 * answered `200` and was served at the base's name.
 *
 * ## What is pinned
 *
 * At each of the eight sites, the code and status are unchanged and the
 * message ends with (or, at the duplicate door, carries) the new sentence,
 * spelled out WHOLE below — not a fragment, so a reworded sentence is a
 * deliberate edit here. Each site also asserts the three phrases only the old
 * sentence carried (`under its own name`, `environment-level state`, `ADR-0131
 * D6`) are absent: the new sentence shares none of them, so the old one cannot
 * pass these pins under any truncation or concatenation. The read-only verdict
 * itself, its ordering and the listing it protects are pinned in
 * `packages-readonly-gate.test.ts`; the route the sentence names is followed
 * end to end, over a booted stack, in
 * `../package-readonly-remedy-follow.integration.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

/** A code-booted package (registered into `engine.manifests`), as the showcase is. */
const CODE_LOADED = 'com.acme.helpdesk';
/** A platform-delivered package (manifest `scope: 'system'`). */
const PLATFORM_SCOPED = 'com.objectstack.platform';
/** A code-booted package whose id has no pair: the pairing rule refuses an id already shaped like one. */
const UNPAIRABLE = 'com.vendor.toolkit.custom';

/** The sentence, whole, for a package whose pair the pairing rule derives. */
const remedy = (id: string): string =>
    `customize what it ships in its paired package '${id}.custom' (ADR-0146 D3): ensure it with `
    + `POST /api/v1/packages/${id}/ensure-customization, then save the item there (?package=${id}.custom), `
    + `declaring overrides: { package: '${id}', basedOn } to replace an item '${id}' ships. A type that takes `
    + 'no override, or a locked item, is refused naming its route or the lock; a package that cannot have a '
    + 'pair is refused at that door, naming why.';

/** The phrases only the retired ADR-0131 D6 sentence carried. */
const RETIRED = ['under its own name', 'environment-level state', 'ADR-0131 D6'];

function manifest(id: string, scope?: 'system' | 'project') {
    return { id, name: id, version: '1.0.0', namespace: 'helpdesk', ...(scope ? { scope } : {}) } as any;
}

function make() {
    const registry = new SchemaRegistry({ logLevel: 'silent' } as any);
    registry.installPackage(manifest(CODE_LOADED, 'project'), 'code');
    registry.installPackage({ ...manifest(PLATFORM_SCOPED, 'system'), namespace: 'platform' }, 'code');
    registry.installPackage({ ...manifest(UNPAIRABLE, 'project'), namespace: 'toolkit' }, 'code');
    const manifests = new Map<string, any>([
        [CODE_LOADED, manifest(CODE_LOADED)],
        [UNPAIRABLE, manifest(UNPAIRABLE)],
    ]);
    const objectql = { registry, manifests };
    // The duplicate door needs a protocol to reach its gate; the refusal runs
    // before it, so this double is never called (asserted below).
    const protocol = { duplicatePackage: vi.fn(async () => ({ success: true, copiedCount: 0 })) };
    const kernel: any = {
        context: {
            getService: (name: string) => (name === 'objectql' ? objectql : name === 'protocol' ? protocol : null),
        },
    };
    return Object.assign(new HttpDispatcher(kernel), { protocol });
}

const admin = (): any => ({
    request: {},
    environmentId: 'pkg-readonly-remedy-test',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata'], tenantId: 'org_acme' },
});

/** The seven doors that answer `WRITABLE_PACKAGE_REQUIRED`, and the verb each message names. */
const WRITABLE_DOORS: Array<{ verb: string; call: (d: HttpDispatcher, id: string) => Promise<any> }> = [
    { verb: 'delete', call: (d, id) => d.handlePackages(`/${id}`, 'DELETE', {}, {}, admin()) },
    { verb: 'disable', call: (d, id) => d.handlePackages(`/${id}/disable`, 'PATCH', {}, {}, admin()) },
    { verb: 'publish', call: (d, id) => d.handlePackages(`/${id}/publish`, 'POST', {}, {}, admin()) },
    { verb: 'revert', call: (d, id) => d.handlePackages(`/${id}/revert`, 'POST', {}, {}, admin()) },
    { verb: 'adopt items into', call: (d, id) => d.handlePackages(`/${id}/adopt-orphans`, 'POST', {}, {}, admin()) },
    { verb: 'edit', call: (d, id) => d.handlePackages(`/${id}`, 'PATCH', { name: 'Renamed' }, {}, admin()) },
    {
        verb: 'overwrite',
        call: (d, id) => d.handlePackages(
            '', 'POST', { manifest: { id, name: id, version: '1.0.0', type: 'app' }, overwrite: true }, {}, admin(),
        ),
    },
];

function expectNotRetired(message: string): void {
    for (const phrase of RETIRED) expect(message, `the retired remedy's "${phrase}"`).not.toContain(phrase);
}

let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-pkg-readonly-remedy-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

describe('422 WRITABLE_PACKAGE_REQUIRED names the paired .custom route (ADR-0146), at every door', () => {
    for (const { verb, call } of WRITABLE_DOORS) {
        for (const id of [CODE_LOADED, PLATFORM_SCOPED]) {
            it(`${verb} '${id}': same code and status, and the remedy is the pair route`, async () => {
                const r = await call(make(), id);
                const error = r.response?.body?.error;
                expect(r.response?.status, JSON.stringify(r.response?.body)).toBe(422);
                expect(error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
                const message = String(error?.message);
                expect(message.startsWith(`[writable_package_required] Cannot ${verb} package '${id}': it is read-only`))
                    .toBe(true);
                expect(message.endsWith(`— ${verb} a package you own, or ${remedy(id)}`), message).toBe(true);
                expectNotRetired(message);
            });
        }
    }

    it('an id the pairing rule derives no pair for is sent to the ensure door, which says why, with no pair id', async () => {
        const r = await make().handlePackages(`/${UNPAIRABLE}`, 'DELETE', {}, {}, admin());
        expect(r.response?.status).toBe(422);
        expect(r.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
        const message = String(r.response?.body?.error?.message);
        expect(message.endsWith(
            `— delete a package you own, or customize what it ships in its paired customization package `
            + `(ADR-0146 D3): POST /api/v1/packages/${UNPAIRABLE}/ensure-customization answers that package, or `
            + 'why this one has none.',
        ), message).toBe(true);
        expect(message).not.toContain(`${UNPAIRABLE}.custom`);
        expectNotRetired(message);
    });
});

describe('422 DUPLICATE_SOURCE_NOT_A_BASE carries the same route between its two other remedies', () => {
    it('duplicate of a code package: same code and status, the pair route, and the unmanaged copy', async () => {
        const d = make();
        const r = await d.handlePackages(
            `/${CODE_LOADED}/duplicate`, 'POST', { targetPackageId: 'com.acme.dupbase' }, {}, admin(),
        );
        expect(d.protocol.duplicatePackage).not.toHaveBeenCalled();
        const error = r.response?.body?.error;
        expect(r.response?.status, JSON.stringify(r.response?.body)).toBe(422);
        expect(error?.code).toBe('DUPLICATE_SOURCE_NOT_A_BASE');
        const message = String(error?.message);
        expect(message).toContain(
            `Duplicate a base you own, or ${remedy(CODE_LOADED)} For an editable copy of the whole package, `
            + "install it unmanaged instead (installMode 'unmanaged')",
        );
        expectNotRetired(message);
    });
});
