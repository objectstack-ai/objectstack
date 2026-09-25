// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19120] `POST /api/v1/packages` parses the manifest's `version` leg.
 *
 * ## The defect this file pins shut
 *
 * `PackageInstallRequestSchema` binds `manifest: ManifestSchema`
 * (`packages/spec/src/api/package-api.zod.ts`), and `ManifestSchema` declares
 * `version` REQUIRED with a semantic grammar
 * (`packages/spec/src/kernel/manifest.zod.ts`). The install door parsed
 * NOTHING: `const manifest = body.manifest || body` went straight to
 * `installPackage`, the only gate on the way being an id check. So a manifest
 * with no `version` at all installed and the door answered `201` — «declared ≠
 * enforced» on a PUBLISHED API contract, which Prime Directive #10 refuses
 * outright, and the exact failure 北极星 clause 4 names:
 * 「错的必须被**响亮拒绝**并给处方,**永不静默落库**」.
 *
 * The authorising ruling is 基本裁决原则 —
 * 「spec 声明 > 实现 > 文档面;**声明而未兑现是实现缺口,补实现或退役**,
 * ⛔ 不在消费端收窄」 — and by the mechanical boundary test, making a door parse
 * what its schema ALREADY declares is 拉回已声明契约, ⛔ not 扩大接受集.
 * Nothing in `packages/spec` moves for it.
 *
 * ## ⛔ The scope fence — the `version` leg ALONE
 *
 * The declaration's residual docblock records FIVE classes this door answers
 * `201` to. This card was graded on the `version` leg, which is the leg that
 * was measured. The other four — a missing `type`, unknown keys on either body
 * form, a string-typed `enableOnInstall`/`overwrite`, install options spelled
 * on the bare form — are each their own reading and are deliberately LEFT
 * STANDING by both the fix and this file.
 *
 * ⛔ **No case here asserts anything about those four**, in either direction.
 * Pinning them as `201` would freeze four known residuals as intended
 * behaviour and turn the card that closes one of them red for doing its job;
 * pinning them as refused would be this file quietly widening a graded scope.
 * The separability evidence lives where a one-shot measurement belongs — the
 * PR body — not in a permanent expectation.
 *
 * ## Why §0 exists
 *
 * Every refusal below is a claim that the DOOR agrees with the DECLARATION,
 * never that the door matches a grammar this file has an opinion about. So the
 * fixtures are first asserted off-spec *by the declaration itself*. The
 * version-grammar canon is an open question on its own card; when it moves,
 * §0 goes red first and names what happened, instead of §1 failing for a reason
 * a reader would have to reconstruct.
 *
 * ## The harness
 *
 * Spies on BOTH install writers — the protocol primitive and the bare registry
 * fallback — because a refusal pin owes two halves: the status and code the
 * caller is told, AND that the write never happened. A door that answered `400`
 * and installed anyway would satisfy the first half alone.
 *
 * `OS_HOME` is redirected for the whole file: the positive control installs for
 * real, and `setPackageDisabled` writes an actual file under the ObjectStack
 * home — a test that wrote into the developer's own home would touch packages
 * in their running system.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManifestSchema } from '@objectstack/spec/kernel';
import { HttpDispatcher } from '../http-dispatcher.js';

let home: string;
let priorHome: string | undefined;

beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-install-version-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const PKG_ADMIN = () => ({
    request: {},
    environmentId: 'pkg-install-version-test',
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** A complete AUTHORING-stage manifest — the stage this door is reached at. */
const WELL_FORMED = { id: 'com.acme.crm', name: 'Acme CRM', namespace: 'acme', version: '1.0.0', type: 'app' };

/**
 * A manifest carrying every key the well-formed one does EXCEPT `version`.
 *
 * ⛔ Spelled as a delete rather than as a shorter literal on purpose: the two
 * fixtures must differ in exactly one key, or a refusal proves nothing about
 * which key caused it.
 */
function without<K extends string>(obj: Record<string, unknown>, key: K) {
    const copy = { ...obj };
    delete copy[key];
    return copy;
}

/**
 * A version string the DECLARATION refuses — asserted as such in §0, never
 * assumed.
 *
 * ⭐ Re-chosen once, exactly as §0 said it would have to be. This was
 * `2.0.0-beta.1` while `ManifestSchema.version` demanded a bare three-segment
 * core; the version-grammar canon then made the key SemVer 2.0.0, which accepts
 * prereleases, and §0 went red naming the move. The successor keeps what made
 * the old one a good fixture — version-SHAPED, plausible at a glance, refused
 * on the grammar alone rather than for being obviously not a version. `01.1.1`
 * is refused by SemVer 2.0.0 §2: a numeric identifier carries no leading zero.
 */
const OFF_SPEC_GRAMMAR = '01.1.1';

interface Door {
    dispatcher: HttpDispatcher;
    protocolInstall: ReturnType<typeof vi.fn>;
    registryInstall: ReturnType<typeof vi.fn>;
}

/**
 * @param existingId an id the registry should report as already installed —
 *   how §3 reaches the `409` branch this gate is ordered ahead of.
 */
function makeDoor(options: { existingId?: string } = {}): Door {
    const registryInstall = vi.fn().mockImplementation((manifest: any) => ({
        manifest,
        status: 'installed',
        enabled: true,
    }));
    const protocolInstall = vi.fn().mockImplementation(({ manifest }: any) => ({
        package: { manifest, status: 'installed', enabled: true },
    }));
    const registry = {
        installPackage: registryInstall,
        getPackage: vi.fn().mockImplementation((id: string) =>
            (options.existingId && id === options.existingId)
                ? { manifest: { id, version: '0.9.0' }, status: 'installed', enabled: true }
                : undefined),
        getAllPackages: vi.fn().mockReturnValue([]),
        disablePackage: vi.fn(),
    };
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return Promise.resolve({ installPackage: protocolInstall });
            if (name === 'objectql') return Promise.resolve({ registry });
            return null;
        },
        context: { getService: () => null },
    };
    return { dispatcher: new HttpDispatcher(kernel), protocolInstall, registryInstall };
}

/** `POST /api/v1/packages` exactly as the route reads it. */
const install = (door: Door, body: unknown, query: Record<string, unknown> = {}) =>
    door.dispatcher.handlePackages('', 'POST', body, query, PKG_ADMIN());

// ═══════════════════════════════════════════════════════════════════════
// §0 — the premise every case below rests on
// ═══════════════════════════════════════════════════════════════════════

describe('§0 the DECLARATION is what the door is being held to', () => {
    it('declares `version` REQUIRED — absence is refused by the schema itself', () => {
        expect(ManifestSchema.shape.version.safeParse(undefined).success).toBe(false);
    });

    it('declares a grammar — the §1 fixture is off-spec BY THE DECLARATION, not by this file', () => {
        // ⛔ If the version-grammar canon moves, THIS is the assertion that goes
        // red, and it says what happened. The fix under test asks
        // `ManifestSchema.shape.version` by reference, so the DOOR follows the
        // canon with no edit — only this fixture needs re-choosing.
        expect(ManifestSchema.shape.version.safeParse(OFF_SPEC_GRAMMAR).success).toBe(false);
        expect(ManifestSchema.shape.version.safeParse(123).success).toBe(false);
    });

    it('accepts the positive control, so §2 can actually fail', () => {
        expect(ManifestSchema.shape.version.safeParse(WELL_FORMED.version).success).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §1 — the refusal: code + status, and the write never happened
// ═══════════════════════════════════════════════════════════════════════

describe('§1 an under-specified `version` is refused loudly, and nothing installs', () => {
    const cases: ReadonlyArray<readonly [string, unknown]> = [
        ['WRAPPED form, no `version` at all — the card\'s own repro', { manifest: without(WELL_FORMED, 'version') }],
        ['BARE form, no `version` — `body.manifest || body` reaches the same gate', without(WELL_FORMED, 'version')],
        ['a `version` the declared grammar refuses', { manifest: { ...WELL_FORMED, version: OFF_SPEC_GRAMMAR } }],
        ['a non-string `version`', { manifest: { ...WELL_FORMED, version: 123 } }],
        ['an empty-string `version`', { manifest: { ...WELL_FORMED, version: '' } }],
    ];

    for (const [label, body] of cases) {
        it(`${label} → 400 VALIDATION_ERROR`, async () => {
            const door = makeDoor();
            const r = await install(door, body);

            expect(r.handled).toBe(true);
            // The minimum assertion an ADR-0112 refusal owes: code + status.
            // `deps.error(msg, 400)` derives `VALIDATION_ERROR` from
            // `standardErrorCodeForHttpStatus(400)`, the standard catalog's
            // member for 400 — ⛔ no new code was minted for this card.
            expect(r.response?.status).toBe(400);
            expect((r.response as any)?.body?.error?.code).toBe('VALIDATION_ERROR');
            expect((r.response as any)?.body?.success).toBe(false);
            expect((r.response as any)?.body?.data).toBeUndefined();
        });

        it(`${label} → NEITHER install writer was called`, async () => {
            const door = makeDoor();
            await install(door, body);
            // The other half of a refusal pin. A door that answered 400 and
            // installed anyway satisfies the status assertion above, and this
            // card is precisely about a write that should never have landed.
            expect(door.protocolInstall).not.toHaveBeenCalled();
            expect(door.registryInstall).not.toHaveBeenCalled();
        });
    }

    it('the sentence carries the prescription — it names the key and shows the shape to write', async () => {
        const door = makeDoor();
        const r = await install(door, { manifest: without(WELL_FORMED, 'version') });
        const message = String((r.response as any)?.body?.error?.message ?? '');
        // ⛔ Not a prose pin. The NAMED SUBJECT is the contract here: 北极星
        // clause 4 requires the refusal to give a prescription, so the author
        // must be able to read which key to add and what it looks like.
        expect(message).toContain('version');
        expect(message).toContain('1.0.0');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §2 — the positive control
// ═══════════════════════════════════════════════════════════════════════

describe('§2 a well-formed manifest still installs', () => {
    it('answers 201 and routes the manifest through the protocol primitive, unchanged', async () => {
        const door = makeDoor();
        const r = await install(door, { manifest: WELL_FORMED, settings: { a: 1 } });

        expect(r.response?.status).toBe(201);
        // The preservation half: the gate reads `manifest.version` and hands
        // the manifest on untouched — it is a gate, ⛔ not a normaliser.
        expect(door.protocolInstall).toHaveBeenCalledWith({ manifest: WELL_FORMED, settings: { a: 1 } });
        expect((r.response as any)?.body?.data?.manifest).toEqual(WELL_FORMED);
    });

    it('the BARE form installs too — the gate did not close a body form', async () => {
        const door = makeDoor();
        const r = await install(door, WELL_FORMED);

        expect(r.response?.status).toBe(201);
        expect(door.protocolInstall).toHaveBeenCalledWith({ manifest: WELL_FORMED, settings: undefined });
    });

    it('falls through to the registry writer when the protocol lacks the method', async () => {
        const registryInstall = vi.fn().mockReturnValue({ manifest: WELL_FORMED, status: 'installed', enabled: true });
        const kernel: any = {
            getService: (name: string) => {
                if (name === 'protocol') return Promise.resolve({});
                if (name === 'objectql') {
                    return Promise.resolve({
                        registry: {
                            installPackage: registryInstall,
                            getPackage: vi.fn().mockReturnValue(undefined),
                            getAllPackages: vi.fn().mockReturnValue([]),
                            disablePackage: vi.fn(),
                        },
                    });
                }
                return null;
            },
            context: { getService: () => null },
        };
        const r = await new HttpDispatcher(kernel)
            .handlePackages('', 'POST', { manifest: WELL_FORMED }, {}, PKG_ADMIN());

        // The gate sits ahead of BOTH limbs, so the fallback limb is reached by
        // a well-formed manifest exactly as before this card.
        expect(r.response?.status).toBe(201);
        expect(registryInstall).toHaveBeenCalledWith(WELL_FORMED, undefined);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §3 — ordering: a request-shape refusal does not depend on server state
// ═══════════════════════════════════════════════════════════════════════

describe('§3 the gate is ordered ahead of the duplicate-id 409', () => {
    it('an already-installed id with no `version` answers 400, ⛔ not 409', async () => {
        const door = makeDoor({ existingId: WELL_FORMED.id });
        const r = await install(door, { manifest: without(WELL_FORMED, 'version') });

        // Placed after the duplicate check, one and the same under-specified
        // body would answer 400 or 409 according to whether that id happened to
        // be installed already — two different answers to one authoring
        // mistake, and the 409 tells the author nothing about the real problem.
        expect(r.response?.status).toBe(400);
        expect((r.response as any)?.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('the 409 is untouched for a well-formed duplicate', async () => {
        const door = makeDoor({ existingId: WELL_FORMED.id });
        const r = await install(door, { manifest: WELL_FORMED });

        // The control that makes the case above a statement about ORDER rather
        // than about the 409 having been removed.
        expect(r.response?.status).toBe(409);
        expect(door.protocolInstall).not.toHaveBeenCalled();
    });

    it('the id gate still wins — no id means no sentence this gate could print', async () => {
        const door = makeDoor();
        const r = await install(door, { manifest: { name: 'nameless', type: 'app' } });

        expect(r.response?.status).toBe(400);
        expect(String((r.response as any)?.body?.error?.message ?? '')).toContain('Package id is required');
    });
});
