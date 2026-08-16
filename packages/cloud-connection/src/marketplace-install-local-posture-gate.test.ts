// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ⛔ [#8976] THIS FILE IS NOT AN AUTHORIZATION TEST. Do not read it as one.
 *
 * The word "gate" here means the ADR-0120 D5e CONFIRMATION CEREMONY — a
 * question about the manifest's data shape — and the caller answers it
 * THEMSELVES, by putting `confirmGlobalUniques` in their own request body (see
 * "confirming records the attestation…" below, and the `confirmGlobalUniques:
 * true` in almost every case here). A check whose verdict is read out of the
 * request being checked can say nothing whatsoever about who may call the
 * route. This file was green for the entire period in which
 * `POST /install-local` admitted a caller with no session at all, on a bare
 * `x-user-id` header, straight through to `syncSchemas()` against the shared
 * database.
 *
 * Auditing whether install-local is gated? The file that answers that is
 * `marketplace-install-local-capability-enumeration.test.ts` — every mutating
 * route, derived from the plugin's own route table, against three principals.
 * The final `describe` in this file asserts that companion still exists, so
 * this pointer cannot quietly rot into a wrong answer.
 *
 * [ADR-0120 D5e] What this file DOES pin: the `isolated`-posture install gate
 * for installation-wide (`'global'`) uniques, exercised at the real install
 * seam.
 *
 * What is being pinned, and why each half matters:
 *
 * - **It stops, per index.** Under `isolated` an app's `'global'` unique
 *   constrains ACROSS CUSTOMERS and can reveal that another customer holds a
 *   value (ADR-0120 S10/S14). The install must not land while that is
 *   unanswered — an advisory nobody reads is the ADR-0049/0078 class this ADR
 *   exists to close.
 * - **It leaves nothing behind.** A stopped install writes no ledger entry and
 *   registers nothing, so the installer can rewrite the metadata to
 *   `'organization'` and retry without an uninstall.
 * - **It never re-asks.** The confirmation lands in the install manifest
 *   (ADR-0104 attestation style), and a reinstall/upgrade reads it back. This is
 *   what keeps the ceremony one-time — and what keeps it OUT of the boot path
 *   (#4884: never a startup warning).
 * - **It is posture-scoped.** Under `single` / `group` the same manifest
 *   installs silently: there `'global'` means the installation, which under
 *   `group` IS the customer company. No finding is a decision point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';
import { LocalManifestSource } from './local-manifest-source.js';

type Handler = (c: any) => Promise<any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

function makeCtx(rawApp: any, services: Record<string, any>) {
    const hooks = new Map<string, any>();
    return {
        ctx: {
            hook: (e: string, h: any) => hooks.set(e, h),
            getService: (name: string) => {
                if (name === 'http-server') return { getRawApp: () => rawApp };
                const svc = services[name];
                if (svc === undefined) throw new Error(`no ${name}`);
                return svc;
            },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        },
        fire: async () => { await hooks.get('kernel:ready')?.(); },
    };
}

function makeC(body: any) {
    const json = vi.fn((payload: any, status?: number) => ({ payload, status: status ?? 200 }));
    return {
        req: {
            url: 'http://localhost:3000/api/v1/marketplace/install-local',
            raw: new Request('http://localhost:3000/x'),
            json: async () => body,
            param: () => undefined,
        },
        json,
    };
}

/** An app carrying BOTH `'global'` spellings on its own objects, plus the
 *  per-organization and platform-owned shapes the gate must ignore. */
const APP_WITH_GLOBAL_UNIQUES = {
    id: 'com.acme.mrp',
    namespace: 'mrp',
    version: '1.0.0',
    objects: [
        {
            name: 'material',
            fields: {
                // S14: "unique across the whole company" — right under `group`,
                // crosses customers under `isolated`. THE decision point.
                code: { type: 'text', unique: 'global' },
                // per-organization — correct under every posture, never asked.
                name: { type: 'text', unique: true },
            },
            indexes: [
                // the deprecated bare spelling: same physical shape, same hazard
                { name: 'uk_material_ext', fields: ['external_id'], unique: true },
                // per-organization declared index — never asked
                { fields: ['plant', 'batch'], unique: 'organization' },
            ],
        },
        {
            // platform-owned: the S5 engine idempotency inventory, platform-wide
            // by construction — never a decision point.
            name: 'sys_job',
            fields: {},
            indexes: [{ fields: ['name'], unique: true }],
        },
    ],
};

const EXPECTED_IDS = ['material:field:code', 'material:index:external_id'];

let dir: string;
let posture: string | undefined;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-d5e-'));
    posture = process.env.OS_TENANCY_POSTURE;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (posture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = posture;
    vi.restoreAllMocks();
});

async function mountInstall(storageDir: string) {
    const register = vi.fn();
    const syncSchemas = vi.fn(async () => undefined);
    const rawApp = makeRawApp();
    const { ctx, fire } = makeCtx(rawApp, {
        manifest: { register },
        auth: installerAuthService('usr_installer'),
        objectql: withInstallerGrants({ syncSchemas }, 'usr_installer'),
    });
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir });
    await plugin.start(ctx as any);
    await fire();
    const install = rawApp.routes.get('POST /api/v1/marketplace/install-local')!;
    return { install, register, syncSchemas, ctx };
}

describe("ADR-0120 D5e — install into an 'isolated' environment", () => {
    it('HARD-STOPS and lists each installation-wide unique', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const { install } = await mountInstall(dir);

        const res = await install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES }));

        expect(res.status).toBe(409);
        expect(res.payload.success).toBe(false);
        expect(res.payload.error.code).toBe('UNIQUE_SCOPE_CONFIRMATION_REQUIRED');
        // Per-index listing — the ceremony is per constraint, not per app.
        expect(res.payload.error.details.findings.map((f: any) => f.id)).toEqual(EXPECTED_IDS);
        expect(res.payload.error.message).toContain('material.code — field-level');
        expect(res.payload.error.message).toContain("material — declared index 'uk_material_ext' [external_id]");
        expect(res.payload.error.message).toContain("rewrite it to `unique: 'organization'`");
        // The per-organization declarations and the sys_ object are NOT listed:
        // asking about those on every install is the #4884 false-alarm class.
        expect(res.payload.error.message).not.toContain('sys_job');
        expect(res.payload.error.message).not.toContain('plant');
    });

    it('a stopped install registers nothing and writes no ledger entry', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const { install, register, syncSchemas } = await mountInstall(dir);
        register.mockClear();

        await install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES }));

        expect(register).not.toHaveBeenCalled();
        expect(syncSchemas).not.toHaveBeenCalled();
        expect(new LocalManifestSource(dir).read('com.acme.mrp').entry).toBeNull();
    });

    it('confirming records the attestation in the install manifest and installs', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const { install, register } = await mountInstall(dir);

        const res = await install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES, confirmGlobalUniques: true }));

        expect(res.payload.success).toBe(true);
        expect(register).toHaveBeenCalled();
        const entry = new LocalManifestSource(dir).read('com.acme.mrp').entry!;
        expect(entry.globalUniqueAttestation).toMatchObject({
            posture: 'isolated',
            confirmed: EXPECTED_IDS.slice().sort(),
            attestedBy: 'usr_installer',
        });
        expect(typeof entry.globalUniqueAttestation!.attestedAt).toBe('string');
    });

    it('never re-asks: the reinstall of an attested package installs silently', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const first = await mountInstall(dir);
        await first.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES, confirmGlobalUniques: true }));

        // Fresh plugin instance = a process restart. The record is on DISK, so
        // the answer survives — a memory-only confirmation would re-ask here,
        // which is the boot-time nagging #4884 forbids.
        const second = await mountInstall(dir);
        const res = await second.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES }));

        expect(res.payload.success).toBe(true);
        expect(new LocalManifestSource(dir).read('com.acme.mrp').entry!.globalUniqueAttestation!.confirmed)
            .toEqual(EXPECTED_IDS.slice().sort());
    });

    it('ASKS AGAIN when the attestation record is corrupt — fail-safe, not fail-open', async () => {
        // #5426 — the direction pin. `read()` now separates "never installed"
        // from "installed but unreadable"; this call site deliberately keeps
        // treating them alike (`.entry`), and this test says WHICH way that
        // conflation must fall.
        //
        // ⚠️ REVERSE-VERIFICATION, stated honestly: reverting #5426 does NOT
        // turn this red. The old `read()` returned a bare `null` for a corrupt
        // file, so the gate already re-asked — the behaviour is unchanged and
        // that is the point (the wiring is semantically equivalent). What this
        // pins is the FUTURE: now that a corrupt entry is distinguishable, the
        // tempting "we know it was installed, treat it as attested" reading is
        // one line away, and it would skip a one-time ceremony over a file
        // nobody could read. Repeating the ceremony costs a prompt; skipping it
        // can expose one customer's value to another (ADR-0120 S10/S14).
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const first = await mountInstall(dir);
        await first.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES, confirmGlobalUniques: true }));
        // Truncate the attested entry in place — the issue's repro.
        writeFileSync(join(dir, 'com.acme.mrp.json'), '{"manifestId":"com.acme.mrp","globalUniqu', 'utf8');

        const second = await mountInstall(dir);
        const res = await second.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES }));

        expect(res.status).toBe(409);
        expect(res.payload.error.code).toBe('UNIQUE_SCOPE_CONFIRMATION_REQUIRED');
        expect(res.payload.error.details.findings.map((f: any) => f.id)).toEqual(EXPECTED_IDS);
    });

    it('asks about a NEW constraint an upgrade introduces, and only that one', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const first = await mountInstall(dir);
        await first.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES, confirmGlobalUniques: true }));

        const upgraded = {
            ...APP_WITH_GLOBAL_UNIQUES,
            version: '2.0.0',
            objects: [
                ...APP_WITH_GLOBAL_UNIQUES.objects,
                { name: 'plant', fields: { site_code: { type: 'text', unique: 'global' } } },
            ],
        };
        const second = await mountInstall(dir);
        const res = await second.install(makeC({ manifest: upgraded }));

        expect(res.status).toBe(409);
        expect(res.payload.error.details.findings.map((f: any) => f.id)).toEqual(['plant:field:site_code']);
    });

    it('a PARTIAL confirmation still stops on the unconfirmed remainder', async () => {
        // The per-index ceremony has teeth: echoing back one id does not
        // blanket-approve a list the installer did not read.
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const { install } = await mountInstall(dir);

        const res = await install(makeC({
            manifest: APP_WITH_GLOBAL_UNIQUES,
            confirmGlobalUniques: ['material:field:code'],
        }));

        expect(res.status).toBe(409);
        expect(res.payload.error.details.findings.map((f: any) => f.id)).toEqual(['material:index:external_id']);
        expect(new LocalManifestSource(dir).read('com.acme.mrp').entry).toBeNull();
    });

    it('an app whose uniques are all per-organization installs without ceremony', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const { install } = await mountInstall(dir);

        const res = await install(makeC({
            manifest: {
                id: 'com.acme.clean',
                version: '1.0.0',
                objects: [{
                    name: 'contact',
                    fields: { email: { type: 'email', unique: true } },
                    indexes: [{ fields: ['department', 'code'], unique: 'organization' }],
                }],
            },
        }));

        expect(res.payload.success).toBe(true);
        expect(new LocalManifestSource(dir).read('com.acme.clean').entry!.globalUniqueAttestation).toBeUndefined();
    });
});

describe('ADR-0120 D5e — the gate is posture-scoped', () => {
    for (const p of ['single', 'group'] as const) {
        it(`installs the SAME manifest with no ceremony under '${p}'`, async () => {
            // Posture portability: one app package, every posture. Under
            // `single` there is one customer; under `group` the installation IS
            // the customer company — which is what `'global'` means there.
            process.env.OS_TENANCY_POSTURE = p;
            const { install } = await mountInstall(dir);

            const res = await install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES }));

            expect(res.payload.success).toBe(true);
            expect(new LocalManifestSource(dir).read('com.acme.mrp').entry!.globalUniqueAttestation).toBeUndefined();
        });
    }

    it("an attestation given under 'single' is not consent under 'isolated'", async () => {
        // The question "knowing organizations here are separate CUSTOMERS, is
        // this genuinely platform-wide?" was never asked under `single`. A
        // record from there answers a different question, so it must not carry.
        process.env.OS_TENANCY_POSTURE = 'single';
        const first = await mountInstall(dir);
        await first.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES, confirmGlobalUniques: true }));

        process.env.OS_TENANCY_POSTURE = 'isolated';
        const second = await mountInstall(dir);
        const res = await second.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES }));

        expect(res.status).toBe(409);
        expect(res.payload.error.details.findings.map((f: any) => f.id)).toEqual(EXPECTED_IDS);
    });

    it('carries an existing attestation forward when the posture is no longer gated', async () => {
        process.env.OS_TENANCY_POSTURE = 'isolated';
        const first = await mountInstall(dir);
        await first.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES, confirmGlobalUniques: true }));

        // A posture flip must not silently erase the record: the confirmation
        // remains a true fact about the posture it was given under, and the
        // deployment may flip back.
        process.env.OS_TENANCY_POSTURE = 'group';
        const second = await mountInstall(dir);
        await second.install(makeC({ manifest: APP_WITH_GLOBAL_UNIQUES }));

        expect(new LocalManifestSource(dir).read('com.acme.mrp').entry!.globalUniqueAttestation)
            .toMatchObject({ posture: 'isolated', confirmed: EXPECTED_IDS.slice().sort() });
    });
});

describe('ADR-0120 D5e — the gate is NOT a boot-time check (#4884)', () => {
    it('rehydrating an unattested install at kernel:ready neither stops nor warns about scope', async () => {
        // A ledger entry written before the gate existed (or whose environment
        // flipped to `isolated` afterwards) is EXACTLY the case the ADR routes
        // to `os doctor` / `os migrate plan`. Firing here would nag on every
        // boot of every such deployment forever — the #4884 false-alarm class.
        const ledger = new LocalManifestSource(dir);
        ledger.write({
            packageId: 'com.acme.mrp',
            versionId: '1.0.0',
            manifestId: 'com.acme.mrp',
            version: '1.0.0',
            manifest: APP_WITH_GLOBAL_UNIQUES,
            installedAt: new Date().toISOString(),
            installedBy: 'usr_legacy',
        });

        process.env.OS_TENANCY_POSTURE = 'isolated';
        const { ctx, register } = await mountInstall(dir);

        // Rehydrate ran during mount (kernel:ready) — the app is registered…
        expect(register.mock.calls.some((call) => call[0]?.id === 'com.acme.mrp')).toBe(true);
        // …and nothing complained about unique scope at boot.
        const warned = (ctx.logger.warn as any).mock.calls.map((c: any[]) => String(c[0])).join('\n');
        expect(warned).not.toContain('UNIQUE_SCOPE');
        expect(warned).not.toContain('installation-wide unique');
    });
});

/**
 * [#8976] The scope disclaimer at the top of this file, made EXECUTABLE.
 *
 * A prose pointer to "the file that actually pins authorization" is worth
 * exactly as much as its target's continued existence, and nothing warns you
 * when a rename or a delete turns it into a confident wrong answer — which is
 * the precise failure this whole card is about: a green test that reads as
 * coverage it does not provide. So the pointer is asserted, not merely written.
 * If the enumeration pin moves, this goes red and the sentence above gets
 * corrected instead of quietly lying to the next auditor.
 */
describe('#8976 — what this file does NOT cover', () => {
    it('points at the companion that DOES pin authorization, and it still exists', () => {
        expect(existsSync(new URL('./marketplace-install-local-capability-enumeration.test.ts', import.meta.url)))
            .toBe(true);
    });
});
