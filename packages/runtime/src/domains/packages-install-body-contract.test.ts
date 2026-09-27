// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19328] `POST /api/v1/packages` parses the WHOLE body through the union
 * `@objectstack/spec` declares for it — `PackageInstallBodySchema`, the wrapped
 * request or a bare manifest.
 *
 * ## The four rows this file pins shut
 *
 * The door parsed two legs of the manifest (`id`, `version`) and read the rest
 * of the body positionally, so four classes the declaration refuses still
 * answered `201` — re-driven against this door on `origin/main` before the fix:
 *
 * | row | body | before | after |
 * |----:|:--|:--|:--|
 * | 1b | a manifest with no `type` (either form) | `201`, installed | `400`, nothing installed |
 * | 2 | an unknown key inside the manifest, or on a bare body | `201`, the key STORED | `400`, nothing installed |
 * | 3 | `enableOnInstall: 'false'` / `overwrite: 'true'` | `201` and ENABLED / `409` | `400` |
 * | 4 | install options spelled on the bare form | `enableOnInstall` ignored, `overwrite` and `settings` honoured, all three stored as manifest keys | `400`, naming the wrapped form |
 *
 * Row 3 is the sharp one: a caller who spelled an explicit `false` got the
 * opposite, because `'false'` matched neither `=== true` nor `=== false` and
 * fell through to 「缺省」.
 *
 * ## What is deliberately NOT refused — the declaration decides
 *
 * An unknown key at the TOP LEVEL of the wrapped form. The wrapped branch is a
 * plain `z.object` (strip mode) and its docblock forbids closing it here, so
 * `{ manifest, bogus }` parses green with `bogus` dropped. ⛔ No case below
 * pins that as intended behaviour in either direction: §5 asserts the door
 * AGREES WITH THE DECLARATION on it, which stays green whichever way the
 * declaration is later decided.
 *
 * ## Envelope
 *
 * Every refusal is the one the door's other body refusals — the `id` and
 * `version` legs — already answer: `400`, whose standard member is
 * `VALIDATION_ERROR`. ⛔ No code was minted for this card. Each refusal pin
 * owes both halves: the status and code the caller is told, AND that nothing
 * was written (a door that answered `400` and installed anyway satisfies the
 * first half alone).
 *
 * ## Harness
 *
 * The real `HttpDispatcher` over a real `SchemaRegistry`, so "installed" and
 * "enabled" are the registry's own answers. `OS_HOME` is redirected because
 * `setPackageDisabled` writes a real state file, and every case installs its
 * own id — the file is one shared document.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PackageInstallBodySchema } from '@objectstack/spec/api';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';
import { loadDisabledPackageIds } from '../package-state-store.js';

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
    home = mkdtempSync(join(tmpdir(), 'os-install-body-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

/**
 * A complete AUTHORING-stage manifest — the stage this door is reached at.
 * The namespace is the key made legal for the declared namespace grammar
 * (lowercase, digits, underscores, at most 20 characters).
 */
const manifest = (key: string) => ({
    id: `com.acme.${key}`,
    name: `Acme ${key}`,
    namespace: key.replace(/[^a-z0-9]/g, '_').slice(0, 20),
    version: '1.0.0',
    type: 'app',
});

/** The fixture minus one key — spelled as a delete so the pair differs in exactly that key. */
function without(obj: Record<string, unknown>, key: string) {
    const copy = { ...obj };
    delete copy[key];
    return copy;
}

/**
 * The body the first-party SDK puts on the wire, built the way
 * `client.packages.install(manifest, options)` builds it
 * (`packages/client/src/index.ts`) and round-tripped through JSON as the
 * transport does — so `undefined` options vanish exactly as they do in
 * production. The SDK side of the same shape is pinned in
 * `packages/client/src/client.test.ts` («POSTs the manifest and omits
 * `overwrite` unless requested»); this is the door side.
 */
function sdkInstallBody(
    m: Record<string, unknown>,
    options?: { settings?: Record<string, unknown>; enableOnInstall?: boolean; overwrite?: boolean },
) {
    return JSON.parse(JSON.stringify({
        manifest: m,
        settings: options?.settings,
        enableOnInstall: options?.enableOnInstall,
        ...(options?.overwrite !== undefined ? { overwrite: options.overwrite } : {}),
    }));
}

function door() {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    const kernel: any = {
        getService: (name: string) => (name === 'objectql' ? Promise.resolve({ registry }) : null),
        context: { getService: () => null },
    };
    const dispatcher = new HttpDispatcher(kernel);
    const install = (body: unknown, query: Record<string, unknown> = {}) =>
        dispatcher.handlePackages('', 'POST', body, query, PKG_ADMIN());
    return { registry, install };
}

/** The context above names no environment, so the durable record is keyed by `undefined`. */
const persistedDisabled = () => loadDisabledPackageIds(undefined);

/** The minimum an ADR-0112 refusal owes: status + code, and no success body. */
function expectRefused(result: any) {
    expect(result.handled).toBe(true);
    expect(result.response?.status).toBe(400);
    expect(result.response?.body?.success).toBe(false);
    expect(result.response?.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(result.response?.body?.data).toBeUndefined();
}

const messageOf = (result: any) => String(result.response?.body?.error?.message ?? '');

// ═══════════════════════════════════════════════════════════════════════
// §0 — the premise: every refused body is refused BY THE DECLARATION
// ═══════════════════════════════════════════════════════════════════════

describe('§0 the declaration is what the door is held to', () => {
    it('refuses every row body below and accepts both control forms', () => {
        const m = manifest('premise');
        const refused: unknown[] = [
            { manifest: without(m, 'type') },
            without(m, 'type'),
            { manifest: { ...m, bogus: 1 } },
            { ...m, bogus: 1 },
            { manifest: m, enableOnInstall: 'false' },
            { manifest: m, overwrite: 'true' },
            { ...m, enableOnInstall: false },
            { ...m, overwrite: true },
            { ...m, settings: { a: 1 } },
        ];
        for (const body of refused) {
            expect(PackageInstallBodySchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
        }
        expect(PackageInstallBodySchema.safeParse({ manifest: m }).success).toBe(true);
        expect(PackageInstallBodySchema.safeParse(m).success).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §1 — row 1b: a manifest with no `type`
// ═══════════════════════════════════════════════════════════════════════

describe('§1 row 1b — a manifest with no `type` is refused, and nothing installs', () => {
    it('WRAPPED form', async () => {
        const { registry, install } = door();
        const m = manifest('notype.wrapped');
        const r = await install({ manifest: without(m, 'type') });

        expectRefused(r);
        expect(registry.getPackage(m.id)).toBeUndefined();
        // The named subject: the key the author has to add, located on the form they wrote.
        expect(messageOf(r)).toContain('manifest.type');
    });

    it('BARE form', async () => {
        const { registry, install } = door();
        const m = manifest('notype.bare');
        const r = await install(without(m, 'type'));

        expectRefused(r);
        expect(registry.getPackage(m.id)).toBeUndefined();
        expect(messageOf(r)).toContain('type');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §2 — row 2: unknown keys
// ═══════════════════════════════════════════════════════════════════════

describe('§2 row 2 — an unknown key the declaration refuses is refused, and never stored', () => {
    it('inside the manifest of the WRAPPED form', async () => {
        const { registry, install } = door();
        const m = manifest('unknown.inner');
        const r = await install({ manifest: { ...m, bogus: 1 } });

        expectRefused(r);
        expect(registry.getPackage(m.id)).toBeUndefined();
        expect(messageOf(r)).toContain('bogus');
    });

    it('on a BARE body', async () => {
        const { registry, install } = door();
        const m = manifest('unknown.bare');
        const r = await install({ ...m, bogus: 1 });

        expectRefused(r);
        expect(registry.getPackage(m.id)).toBeUndefined();
        expect(messageOf(r)).toContain('bogus');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §3 — row 3: string-typed booleans
// ═══════════════════════════════════════════════════════════════════════

describe('§3 row 3 — a string-typed `enableOnInstall` / `overwrite` is refused, never read', () => {
    it("`enableOnInstall: 'false'` is refused — ⛔ never installed ENABLED", async () => {
        const { registry, install } = door();
        const m = manifest('str.enable.false');
        const r = await install({ manifest: m, enableOnInstall: 'false' });

        expectRefused(r);
        // The inversion this row is about: before the fix this id was installed
        // and ENABLED. Refused, it is neither.
        expect(registry.getPackage(m.id)).toBeUndefined();
        expect(persistedDisabled().has(m.id)).toBe(false);
        expect(messageOf(r)).toContain('enableOnInstall');
    });

    it("`enableOnInstall: 'true'` is refused too — the fix is a type check, not a string match", async () => {
        const { registry, install } = door();
        const m = manifest('str.enable.true');
        const r = await install({ manifest: m, enableOnInstall: 'true' });

        expectRefused(r);
        expect(registry.getPackage(m.id)).toBeUndefined();
    });

    it("`overwrite: 'true'` is refused — ⛔ not read as absent (409), and the installed row is untouched", async () => {
        const { registry, install } = door();
        const m = manifest('str.overwrite');
        expect((await install({ manifest: m })).response?.status).toBe(201);

        const r = await install({ manifest: { ...m, name: 'Clobbered' }, overwrite: 'true' });

        expectRefused(r);
        expect(registry.getPackage(m.id)?.manifest?.name).toBe(m.name);
        expect(messageOf(r)).toContain('overwrite');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §4 — row 4: install options on the bare form
// ═══════════════════════════════════════════════════════════════════════

describe('§4 row 4 — install options on the BARE form are refused, naming the wrapped form', () => {
    it('`enableOnInstall` — refused, nothing installed, and the refusal prescribes the wrapped form', async () => {
        const { registry, install } = door();
        const m = manifest('bare.enable');
        const r = await install({ ...m, enableOnInstall: false });

        expectRefused(r);
        expect(registry.getPackage(m.id)).toBeUndefined();
        // Named subjects, ⛔ not prose: the misplaced key, and the key of the
        // form it belongs in — the declaration's own remedy («a caller that
        // needs an option sends the wrapped form»).
        expect(messageOf(r)).toContain('enableOnInstall');
        expect(messageOf(r)).toContain('"manifest"');
    });

    it('`overwrite` — refused (it USED to be honoured here), the installed row untouched, the query route named', async () => {
        const { registry, install } = door();
        const m = manifest('bare.overwrite');
        expect((await install(m)).response?.status).toBe(201);

        const r = await install({ ...m, name: 'Clobbered', overwrite: true });

        expectRefused(r);
        expect(registry.getPackage(m.id)?.manifest?.name).toBe(m.name);
        expect(messageOf(r)).toContain('?overwrite=true');
    });

    it('`settings` — refused (it USED to be honoured here AND stored as a manifest key)', async () => {
        const { registry, install } = door();
        const m = manifest('bare.settings');
        const r = await install({ ...m, settings: { a: 1 } });

        expectRefused(r);
        expect(registry.getPackage(m.id)).toBeUndefined();
        expect(messageOf(r)).toContain('settings');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §5 — the door follows the declaration, including where it strips
// ═══════════════════════════════════════════════════════════════════════

describe('§5 the door answers what the declaration answers', () => {
    it('an unknown TOP-LEVEL key on the wrapped form: door and declaration agree, whichever way that is', async () => {
        // ⛔ Deliberately a PARITY assertion, not a status pin. The wrapped
        // branch strips today, so both accept; if the declaration is ever
        // closed, both must refuse — and the door follows with no edit,
        // because it asks the declaration.
        const { registry, install } = door();
        const m = manifest('toplevel.unknown');
        const body = { manifest: m, bogus: 1 };
        const declared = PackageInstallBodySchema.safeParse(body).success;
        const r = await install(body);

        expect(r.response?.status).toBe(declared ? 201 : 400);
        expect(registry.getPackage(m.id) !== undefined).toBe(declared);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §6 — ordering: the two legs keep their sentences; no dependence on server state
// ═══════════════════════════════════════════════════════════════════════

describe('§6 the whole-body verdict is ordered after the `id`/`version` legs and ahead of the 409', () => {
    it('a body missing `version` AND `type` still gets the `version` leg\'s prescription', async () => {
        const { install } = door();
        const r = await install({ manifest: without(without(manifest('order.version'), 'version'), 'type') });

        expectRefused(r);
        // The published sentence of the earlier leg, not displaced by the
        // less specific whole-body one.
        expect(messageOf(r)).toContain('1.0.0');
        expect(messageOf(r)).not.toContain('Invalid package install body');
    });

    it('an already-installed id with an off-spec body answers 400, ⛔ not 409', async () => {
        const { registry, install } = door();
        const m = manifest('order.conflict');
        expect((await install({ manifest: m })).response?.status).toBe(201);

        const r = await install({ manifest: without(m, 'type') });

        expectRefused(r);
        expect(registry.getPackage(m.id)?.manifest?.type).toBe('app');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §7 — the controls: every declared form still installs as intended
// ═══════════════════════════════════════════════════════════════════════

describe('§7 controls — well-formed bodies in both forms still install as intended', () => {
    it('WRAPPED, no options → 201, ENABLED, and the manifest is stored as SENT (a gate, not a normaliser)', async () => {
        const { registry, install } = door();
        const m = manifest('ctl.wrapped');
        const r = await install({ manifest: m });

        expect(r.response?.status).toBe(201);
        expect(r.response?.body?.data?.enabled).toBe(true);
        // `ManifestSchema` applies `scope` / `defaultDatasource` defaults at
        // parse time; the door stores what it was sent, as it always has.
        expect(registry.getPackage(m.id)?.manifest).toEqual(m);
    });

    it('BARE → 201, ENABLED — the parse did not close a declared body form', async () => {
        const { registry, install } = door();
        const m = manifest('ctl.bare');
        const r = await install(m);

        expect(r.response?.status).toBe(201);
        expect(registry.getPackage(m.id)?.enabled).toBe(true);
        expect(registry.getPackage(m.id)?.manifest).toEqual(m);
    });

    it('BARE over an installed id with `?overwrite=true` → 201 — the query route stays open to the bare form', async () => {
        const { install } = door();
        const m = manifest('ctl.bare.query');
        expect((await install(m)).response?.status).toBe(201);

        const r = await install({ ...m, name: 'Upgraded' }, { overwrite: 'true' });
        expect(r.response?.status).toBe(201);
    });

    it('WRAPPED `settings` reach the install writer', async () => {
        const { registry, install } = door();
        const m = manifest('ctl.settings');
        const r = await install({ manifest: m, settings: { a: 1 } });

        expect(r.response?.status).toBe(201);
        expect(registry.getPackage(m.id)?.settings).toEqual({ a: 1 });
    });

    it("the SDK's own request shape, `install(m, { enableOnInstall: false })` → 201 and DISABLED, in all three records", async () => {
        // The one production caller of this key. If the parse had broken the
        // SDK's wire shape, this is where it would show.
        const { registry, install } = door();
        const m = manifest('ctl.sdk.disabled');
        const r = await install(sdkInstallBody(m, { enableOnInstall: false }));

        expect(r.response?.status).toBe(201);
        expect(r.response?.body?.data?.enabled).toBe(false);
        expect(registry.getPackage(m.id)?.enabled).toBe(false);
        expect(persistedDisabled().has(m.id)).toBe(true);
    });

    it("the SDK's own request shape, `install(m)` → 201 and ENABLED (absent option ⇒ a fresh id lands enabled)", async () => {
        const { registry, install } = door();
        const m = manifest('ctl.sdk.default');
        const r = await install(sdkInstallBody(m));

        expect(r.response?.status).toBe(201);
        expect(registry.getPackage(m.id)?.enabled).toBe(true);
        expect(persistedDisabled().has(m.id)).toBe(false);
    });

    it("the SDK's own request shape, `install(m, { overwrite: true })` over an installed id → 201", async () => {
        const { registry, install } = door();
        const m = manifest('ctl.sdk.overwrite');
        expect((await install(sdkInstallBody(m))).response?.status).toBe(201);

        const r = await install(sdkInstallBody({ ...m, name: 'Upgraded' }, { overwrite: true }));

        expect(r.response?.status).toBe(201);
        expect(registry.getPackage(m.id)?.manifest?.name).toBe('Upgraded');
    });
});
