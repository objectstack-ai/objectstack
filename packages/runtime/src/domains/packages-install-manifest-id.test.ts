// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19417] `POST /api/v1/packages` parses the manifest's `id` leg.
 *
 * ## The defect this file pins shut
 *
 * `MANIFEST_ID_PATTERN` (`packages/spec/src/kernel/manifest.zod.ts`) is the
 * reverse-domain rule declared ONCE and referenced by BOTH faces of one
 * identity — `ManifestSchema.id`, what an author writes, and
 * `PackageSchema.manifestId`, what the registry stores and publishes by. The
 * install door read `manifest.id` POSITIONALLY (`typeof manifest?.id ===
 * 'string' ? manifest.id.trim() : ''`) and parsed nothing, so a complete
 * manifest carrying `id: 'pkg-a'` installed and the door answered `201` while
 * `defineStack()`, `os build`, `os validate` and the publish face all refused
 * the same id. The author got a package that could never be rebuilt or
 * published — «declared ≠ enforced» on a PUBLISHED API contract, which Prime
 * Directive #10 refuses outright, and the exact failure 北极星 clause 4 names:
 * 「错的必须被**响亮拒绝**并给处方,**永不静默落库**」.
 *
 * The authorising ruling is 基本裁决原则 —
 * 「spec 声明 > 实现 > 文档面;**声明而未兑现是实现缺口,补实现或退役**,
 * ⛔ 不在消费端收窄」 — and by the mechanical boundary test, making a door parse
 * what its schema ALREADY declares is 拉回已声明契约, ⛔ not 扩大接受集.
 * Nothing in `packages/spec` moves for it.
 *
 * ## ⛔ The scope fence — the `id` leg ALONE
 *
 * The declaration's residual docblock records the classes this door answers
 * `201` to. This card was graded on the `id` leg, which is the leg that was
 * measured. A missing `type`, unknown keys on either body form, a string-typed
 * `enableOnInstall`/`overwrite` and install options spelled on the bare form
 * are each their own reading and are deliberately LEFT STANDING by both the fix
 * and this file.
 *
 * ⛔ **No case here asserts anything about those four**, in either direction —
 * the discipline `packages-install-manifest-version.test.ts` recorded for the
 * same fence and the reason it gave: pinning them as `201` would freeze four
 * known residuals as intended behaviour and turn the card that closes one of
 * them red for doing its job; pinning them as refused would be this file quietly
 * widening a graded scope. The separability evidence lives where a one-shot
 * measurement belongs — the PR body and the changeset — not in a permanent
 * expectation.
 *
 * ## Why §0 exists
 *
 * Every refusal below is a claim that the DOOR agrees with the DECLARATION,
 * never that the door matches a grammar this file has an opinion about. So each
 * fixture is first asserted off-spec *by the declaration itself*. If
 * `MANIFEST_ID_PATTERN` ever moves, §0 goes red first and names what happened,
 * instead of §1 failing for a reason a reader would have to reconstruct.
 *
 * ## Why §3 is the longest section
 *
 * `''` fails `MANIFEST_ID_PATTERN` too, so WHERE this gate sits decides whether
 * a PUBLISHED message moves or only the accept set does. The gate is ordered
 * AFTER the `!pkgId` check, and §3 pins that in both directions: an absent or
 * empty id still prints `Package id is required` and ⛔ never the schema's
 * sentence. It is ordered BEFORE the `version` gate and before the duplicate
 * `409`, each with a lit control that makes the case a statement about ORDER
 * rather than about the other gate having been removed.
 *
 * ## The harness
 *
 * Spies on BOTH install writers — the protocol primitive and the bare registry
 * fallback — because a refusal pin owes two halves: the status and code the
 * caller is told, AND that the write never happened. A door that answered `400`
 * and installed anyway would satisfy the first half alone.
 *
 * `OS_HOME` is redirected for the whole file: the positive control installs for
 * real, so a test that wrote into the developer's own home would touch packages
 * in their running system.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ManifestSchema, manifestIdRefusal } from '@objectstack/spec/kernel';
import { HttpDispatcher } from '../http-dispatcher.js';

let home: string;
let priorHome: string | undefined;

beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-install-id-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

const PKG_ADMIN = () => ({
    request: {},
    environmentId: 'pkg-install-id-test',
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** A complete AUTHORING-stage manifest — the stage this door is reached at. */
const WELL_FORMED = { id: 'com.acme.crm', name: 'Acme CRM', namespace: 'acme', version: '1.0.0', type: 'app' };

/**
 * The card's own named case: a bare word, the shape the scaffolder and `os init`
 * used to produce. Asserted off-spec in §0, never assumed.
 */
const CARD_CASE = 'pkg-a';

/**
 * The ids the door must start refusing, each a different way of failing ONE
 * rule — a bare word with no dot, an underscore inside a segment, an uppercase
 * segment, and a value whose only defect is the whitespace around it.
 *
 * ⚠️ The last one is why the gate reads the RAW value rather than the trimmed
 * `pkgId`: the trim keys the package, and if it also laundered the id past its
 * own rule the door would still store a manifest whose `id` the declaration
 * refuses.
 */
const OFF_SPEC_IDS = [CARD_CASE, 'com.example.my_erp', 'Com.Acme.Crm', '  com.acme.crm  '] as const;

/**
 * A manifest carrying every key the well-formed one does EXCEPT the named one.
 *
 * ⛔ Spelled as a delete rather than as a shorter literal on purpose: two
 * fixtures must differ in exactly one key, or a refusal proves nothing about
 * which key caused it.
 */
function without<K extends string>(obj: Record<string, unknown>, key: K) {
    const copy = { ...obj };
    delete copy[key];
    return copy;
}

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

const messageOf = (r: Awaited<ReturnType<typeof install>>) =>
    String((r.response as any)?.body?.error?.message ?? '');

// ═══════════════════════════════════════════════════════════════════════
// §0 — the premise every case below rests on
// ═══════════════════════════════════════════════════════════════════════

describe('§0 the DECLARATION is what the door is being held to', () => {
    it('refuses every §1 fixture BY THE DECLARATION, not by this file', () => {
        // ⛔ If `MANIFEST_ID_PATTERN` moves, THIS is the assertion that goes red
        // and says what happened. The fix under test asks
        // `ManifestSchema.shape.id` by reference, so the DOOR follows the rule
        // with no edit — only these fixtures would need re-choosing.
        for (const id of OFF_SPEC_IDS) {
            expect(ManifestSchema.shape.id.safeParse(id).success).toBe(false);
        }
    });

    it('accepts the positive control, so §2 can actually fail', () => {
        expect(ManifestSchema.shape.id.safeParse(WELL_FORMED.id).success).toBe(true);
    });

    it('⭐ refuses `\'\'` too — which is what makes §3 a real decision, not a formality', () => {
        // The whole of §3 exists because this is `false`. Were `''` admitted by
        // the declaration, the gate's placement relative to `Package id is
        // required` could not move a published message and there would be
        // nothing to rule on.
        expect(ManifestSchema.shape.id.safeParse('').success).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §1 — the refusal: code + status, and the write never happened
// ═══════════════════════════════════════════════════════════════════════

describe('§1 an id the declaration refuses is refused loudly, and nothing installs', () => {
    const cases: ReadonlyArray<readonly [string, unknown]> = [
        ...OFF_SPEC_IDS.map((id) => [
            `WRAPPED form, id '${id}'`,
            { manifest: { ...WELL_FORMED, id } },
        ] as const),
        [
            `BARE form, id '${CARD_CASE}' — \`body.manifest || body\` reaches the same gate`,
            { ...WELL_FORMED, id: CARD_CASE },
        ],
    ];

    for (const [label, body] of cases) {
        it(`${label} → 400 VALIDATION_ERROR`, async () => {
            const door = makeDoor();
            const r = await install(door, body);

            expect(r.handled).toBe(true);
            // The minimum assertion an ADR-0112 refusal owes: code + status.
            // `deps.error(msg, 400)` derives `VALIDATION_ERROR` from
            // `standardErrorCodeForHttpStatus(400)` — ⛔ no new code was minted
            // for this card.
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

    it('⭐ the sentence is the DECLARATION\'S, surfaced rather than reworded', async () => {
        const door = makeDoor();
        const r = await install(door, { manifest: { ...WELL_FORMED, id: CARD_CASE } });

        // ⛔ Not a prose pin on wording this file chose. The door is held to
        // `manifestIdRefusal`'s OWN output, by reference: if spec rewords the
        // refusal, the door follows it and this stays green; if the door starts
        // inventing a fourth sentence for one rule, this goes red.
        expect(messageOf(r)).toBe(manifestIdRefusal('manifest.id', CARD_CASE));
    });

    it('that sentence carries the prescription — key, value, and a VERIFIED repair', async () => {
        const door = makeDoor();
        const r = await install(door, { manifest: { ...WELL_FORMED, id: CARD_CASE } });
        const message = messageOf(r);

        // 北极星 clause 4 requires the refusal to give a prescription. These are
        // the three things an author who is already stuck needs: which key, what
        // they actually wrote, and something to write instead.
        expect(message).toContain('manifest.id');
        expect(message).toContain(`'${CARD_CASE}'`);
        expect(message).toContain('com.example.pkg-a');
        // And the suggested repair is itself legal — the arm verifies its
        // candidate against the pattern before offering it, so a refusal can
        // never teach an id the same door would refuse.
        expect(ManifestSchema.shape.id.safeParse('com.example.pkg-a').success).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §2 — the positive control
// ═══════════════════════════════════════════════════════════════════════

describe('§2 a conforming id still installs', () => {
    it('⭐ answers 201 and routes the manifest through the protocol primitive, unchanged', async () => {
        const door = makeDoor();
        const r = await install(door, { manifest: WELL_FORMED, settings: { a: 1 } });

        // Without this, §1 is satisfied by a door that refuses everything.
        expect(r.response?.status).toBe(201);
        // The preservation half: the gate reads `manifest.id` and hands the
        // manifest on untouched — it is a gate, ⛔ not a normaliser.
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
        // a conforming manifest exactly as before this card.
        expect(r.response?.status).toBe(201);
        expect(registryInstall).toHaveBeenCalledWith(WELL_FORMED, undefined);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// §3 — ordering, and the published message that does NOT move
// ═══════════════════════════════════════════════════════════════════════

describe('§3a the `Package id is required` sentence is UNCHANGED — both directions', () => {
    const cases: ReadonlyArray<readonly [string, unknown]> = [
        ['no `id` key at all', { manifest: without(WELL_FORMED, 'id') }],
        ['an empty-string `id`', { manifest: { ...WELL_FORMED, id: '' } }],
        ['a whitespace-only `id` — the trim still decides this one', { manifest: { ...WELL_FORMED, id: '   ' } }],
        ['a non-string `id`', { manifest: { ...WELL_FORMED, id: 123 } }],
        ['BARE form, no `id`', without(WELL_FORMED, 'id')],
    ];

    for (const [label, body] of cases) {
        it(`${label} → still 400 \`Package id is required\``, async () => {
            const door = makeDoor();
            const r = await install(door, body);

            expect(r.response?.status).toBe(400);
            expect(messageOf(r)).toContain('Package id is required');
            // ⭐ The other direction, and the reason this section exists. `''`
            // fails `MANIFEST_ID_PATTERN` as surely as `pkg-a` does, so a gate
            // placed one line EARLIER would answer these with the schema's
            // sentence instead — replacing a published message for bodies this
            // door already refused, and doing it on the one input where the
            // refusal's suggestion arm has nothing to offer. The gate is
            // ordered after the `!pkgId` check precisely so this cannot happen,
            // and the accept set is all that narrows.
            expect(messageOf(r)).not.toContain('Invalid package id');
        });

        it(`${label} → NEITHER install writer was called`, async () => {
            const door = makeDoor();
            await install(door, body);
            expect(door.protocolInstall).not.toHaveBeenCalled();
            expect(door.registryInstall).not.toHaveBeenCalled();
        });
    }
});

describe('§3b the id gate is ordered AHEAD of the `version` gate', () => {
    it('an off-spec id with no `version` is answered on the ID, ⛔ not the version', async () => {
        const door = makeDoor();
        const r = await install(door, { manifest: without({ ...WELL_FORMED, id: CARD_CASE }, 'version') });

        // The version refusal's sentence NAMES the id it is prescribing for
        // («add it to the manifest for '<id>'»). Prescribing a `version` repair
        // for an id that can never be legal sends the author round twice, so
        // the id is judged first.
        expect(r.response?.status).toBe(400);
        expect(messageOf(r)).toBe(manifestIdRefusal('manifest.id', CARD_CASE));
        expect(messageOf(r)).not.toContain('manifest.version is required');
    });

    it('the version gate is untouched for a CONFORMING id with no `version`', async () => {
        const door = makeDoor();
        const r = await install(door, { manifest: without(WELL_FORMED, 'version') });

        // The lit control that makes the case above a statement about ORDER
        // rather than about the version gate having been removed.
        expect(r.response?.status).toBe(400);
        expect(messageOf(r)).toContain('manifest.version is required');
        expect(messageOf(r)).not.toContain('Invalid package id');
    });
});

describe('§3c the id gate is ordered AHEAD of the duplicate-id 409', () => {
    it('an already-installed OFF-SPEC id answers 400, ⛔ not 409', async () => {
        const door = makeDoor({ existingId: CARD_CASE });
        const r = await install(door, { manifest: { ...WELL_FORMED, id: CARD_CASE } });

        // A request-shape refusal must not depend on server state: placed after
        // the duplicate check, one and the same unpublishable id would answer
        // 400 or 409 according to whether it happened to be installed already —
        // two different answers to one authoring mistake, and the 409 tells the
        // author nothing about the real problem.
        expect(r.response?.status).toBe(400);
        expect((r.response as any)?.body?.error?.code).toBe('VALIDATION_ERROR');
    });

    it('the 409 is untouched for a conforming duplicate', async () => {
        const door = makeDoor({ existingId: WELL_FORMED.id });
        const r = await install(door, { manifest: WELL_FORMED });

        // The control that makes the case above a statement about ORDER rather
        // than about the 409 having been removed.
        expect(r.response?.status).toBe(409);
        expect(door.protocolInstall).not.toHaveBeenCalled();
    });

    it('`?overwrite=true` still reaches 201 for a conforming duplicate', async () => {
        const door = makeDoor({ existingId: WELL_FORMED.id });
        const r = await install(door, { manifest: WELL_FORMED }, { overwrite: 'true' });

        // The opt-in past the 409 is a separate branch and this gate sits ahead
        // of it too — so the control needs its own limb, or «ahead of the 409»
        // would be pinned on the refusing path alone.
        expect(r.response?.status).toBe(201);
    });

    it('⛔ `?overwrite=true` does NOT buy past the id gate', async () => {
        const door = makeDoor({ existingId: CARD_CASE });
        const r = await install(door, { manifest: { ...WELL_FORMED, id: CARD_CASE } }, { overwrite: 'true' });

        // `overwrite` opts back into replacing an existing package. It has never
        // been an opt-out of the request's own shape, and an id the publish face
        // refuses is a shape defect whichever way the duplicate branch goes.
        expect(r.response?.status).toBe(400);
        expect(door.protocolInstall).not.toHaveBeenCalled();
        expect(door.registryInstall).not.toHaveBeenCalled();
    });
});
