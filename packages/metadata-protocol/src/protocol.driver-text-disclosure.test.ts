// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8136 — option C of #8086: `metadata-protocol` stops interpolating raw driver
 * text into client-facing messages. The raw text goes to the log; the caller
 * gets a sentence that names the operation and quotes nothing.
 *
 * ## The defect, as measured before this change
 *
 * `DELETE /api/v1/packages/:id` answered, verbatim:
 *
 * ```
 * HTTP 500
 * { "success": false, "error": { "code": "INTERNAL_ERROR",
 *   "message": "SQLITE_ERROR: no such table: sys_metadata" } }
 * ```
 *
 * Two carriers in this package, both on the uninstall path:
 *
 *  1. `deletePackage`'s FIRST database touch — `engine.find('sys_metadata')` —
 *     sat outside every `try` in the method (the per-item `catch` wraps only
 *     the `deleteMetaItem` loop), so a driver error propagated whole and
 *     undeclared.
 *  2. `deleteMetaItem`'s two re-wrap exits interpolated `err.message` into
 *     `Failed to delete customization overlay: ...`, and that string is ALSO
 *     what `deletePackage` collects into `failed[].error` — which rides onto a
 *     `PACKAGE_DELETE_PARTIAL` **400** inside `details`. No 5xx message
 *     withhold at any HTTP boundary can reach it there, which is the argument
 *     for fixing the producer rather than adding a fourth belt.
 *
 * ## Why this file does NOT test a phrasing heuristic
 *
 * Three downstream boundaries run `looksLikeInternalErrorLeak` — a heuristic
 * over the message. #8132 measured its hole for Postgres and #8263 taught it
 * the two dialects this repo runs. That is an interim by construction: a
 * phrasing test can only ever know the dialects someone has met.
 *
 * So the dialect matrix below deliberately includes engines the predicate does
 * NOT recognise, and **asserts that it does not** before asserting the text is
 * withheld anyway. That pairing is the whole point of option C: correctness
 * that does not depend on having enumerated the world's SQL engines. If a
 * future PR teaches the predicate one of these dialects, the `toBe(false)`
 * half goes red and the reader is sent back here to re-read why the matrix was
 * built that way — it must not be quietly "repaired" by deleting the case.
 *
 * ## The rule under test, stated once
 *
 * A caught error's sentence may be quoted to a caller only when that error
 * DECLARED itself a client-facing refusal (4xx `status`, ADR-0112). Anything
 * undeclared — a bare driver `Error` — or declared a server fault is withheld.
 * This is a positive list, not a negative heuristic, so an unmet dialect is
 * handled correctly by default.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Predicted, with the fix reverted (`git checkout origin/main -- protocol.ts`):
 *
 *  - RED: every case in sections 1, 2 and 4 — the withhold cases. They assert
 *    the POSITIVE withheld shape (a declared envelope plus the absence of the
 *    driver line), so an unfixed producer fails them on the message, not on a
 *    vague "it changed".
 *  - GREEN IN BOTH DIRECTIONS — `[GUARD]`, not evidence: section 3, the
 *    over-block bound. A declared 4xx refusal keeps its sentence verbatim
 *    before and after. What makes them load-bearing is the OVER-BROAD VARIANT
 *    (`declaresClientRefusal` returning `false` unconditionally, so nothing is
 *    ever quoted): **measured, 2 failed | 14 passed**, and the two are exactly
 *    these. Without them this file is satisfied by a blanket replacement,
 *    which would delete the self-correcting refusals #4277 exists for.
 *  - The `looksLikeInternalErrorLeak` measurements are green in both
 *    directions too: they describe the shared predicate, which this card does
 *    not touch (⛔ widening it is the explicitly ruled-out route).
 *
 * Measured: **13 failed | 3 passed** with the producer reverted. The 3 green
 * are section 0 and the two `[GUARD]` cases named above.
 *
 * ⚠️ ONE MISSED PREDICTION, kept rather than tidied away. The declared-5xx
 * case was drafted inside section 3 and predicted green-in-both-directions
 * with the other guards. It came back RED, and it was right to: the unfixed
 * re-wrap interpolated `err.message` UNCONDITIONALLY, so a declared 5xx fault
 * was quoted too. That makes it evidence for the fix, not a bound on it, and
 * it has been moved into section 2 where the other evidence lives. The
 * mislabelling is recorded because it is the useful part — "declared" and
 * "declared a CLIENT refusal" are not the same predicate, and drafting them as
 * one is exactly the confusion `declaresClientRefusal` exists to prevent.
 *
 * Never a bare `toThrow()`: the unfixed path already throws, so a throw-only
 * assertion is permanently green and cannot tell "refused while disclosing"
 * from "refused correctly". Every refusal case asserts `code` AND `status`.
 */
import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). From `@objectstack/metadata-core`, never `@objectstack/objectql`
// — objectql depends on THIS package, so that import would close a cycle.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { looksLikeInternalErrorLeak } from '@objectstack/types';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';

// ---------------------------------------------------------------------------
// The dialect matrix
// ---------------------------------------------------------------------------

/**
 * One physical condition — `sys_metadata` is not there — as five engines
 * phrase it. `knownToPredicate` records what the SHARED heuristic makes of
 * each, measured against the shipping predicate in the first test below rather
 * than asserted from memory.
 *
 * The three `false` rows are the reason this card is not "add the phrasing":
 * MySQL, MSSQL and Oracle each say it differently again, and the list of
 * engines nobody here has run is unbounded.
 */
const DIALECTS: ReadonlyArray<{ engine: string; text: string; knownToPredicate: boolean }> = [
    { engine: 'sqlite', text: 'SQLITE_ERROR: no such table: sys_metadata', knownToPredicate: true },
    { engine: 'postgres', text: 'relation "sys_metadata" does not exist', knownToPredicate: true },
    { engine: 'mysql', text: "Table 'crm.sys_metadata' doesn't exist", knownToPredicate: false },
    { engine: 'mssql', text: "Invalid object name 'sys_metadata'.", knownToPredicate: false },
    { engine: 'oracle', text: 'ORA-00942: table or view does not exist', knownToPredicate: false },
];

/** Fragments that must never appear anywhere in a client-facing payload. */
const LEAKED_FRAGMENTS = ['sys_metadata', 'SQLITE_ERROR', 'no such table', 'ORA-00942', 'Invalid object name'];

function expectNothingLeaked(payload: unknown, dialectText: string): void {
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain(dialectText);
    for (const fragment of LEAKED_FRAGMENTS) expect(wire).not.toContain(fragment);
}

// ---------------------------------------------------------------------------
// Type tiers, DERIVED from the registry (Prime Directive #8) — never listed
// ---------------------------------------------------------------------------

/**
 * `deleteMetaItem` picks its path from `isOverlayAllowed || isRuntimeCreateAllowed`
 * — topology-independent (`useRepoPath`). So the registry decides which of the
 * two re-wrap exits a type reaches, and a flag flipped there re-tiers these
 * with nothing to keep in sync.
 */
const REPO_PATH_TYPE = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.allowOrgOverride || e.allowRuntimeCreate)
    .map((e) => e.type)
    .sort()[0]!;

/** Code-only (`allowRuntimeCreate: false` and `allowOrgOverride: false`) — the legacy raw-engine path #5264 kept alive. */
const LEGACY_PATH_TYPE = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => !e.allowOrgOverride && !e.allowRuntimeCreate)
    .map((e) => e.type)
    .sort()[0]!;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Verb = 'find' | 'findOne' | 'insert' | 'update' | 'delete';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
}

const seedRow = (type: string, name: string, packageId: string): Row => ({
    id: `row_${type}_${name}`,
    type,
    name,
    organization_id: null,
    package_id: packageId,
    state: 'active',
    metadata: JSON.stringify({ name, label: 'seeded' }),
    checksum: 'sha256_disclosure_fixture',
});

/**
 * A kernel whose driver fails the named verbs with `dbError`, exactly the way
 * a missing table does. Everything else answers normally, so a case can let
 * the package read succeed and fail only the per-item delete underneath it —
 * which is how the `failed[]` data path is reached.
 */
function makeKernel(opts: {
    dbError: string;
    failOn: readonly Verb[];
    seed?: Row[];
    environmentId?: string;
}) {
    const rows = new Map<string, Row>();
    for (const r of opts.seed ?? []) rows.set(r.id, r);
    const fail = new Set<Verb>(opts.failOn);
    const boom = (verb: Verb) => {
        if (fail.has(verb)) throw new Error(opts.dbError);
    };

    const engine: any = {
        async find(table: string) {
            boom('find');
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values());
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            boom('findOne');
            if (table !== 'sys_metadata') return null;
            for (const row of rows.values()) {
                const ok = Object.entries(o?.where ?? {}).every(([k, v]) =>
                    v === null || v === undefined
                        ? (row as any)[k] === null || (row as any)[k] === undefined
                        : (row as any)[k] === v);
                if (ok) return row;
            }
            return null;
        },
        async insert(_table: string, data: Record<string, unknown>) {
            boom('insert');
            return { id: String(data.id ?? 'r_new') };
        },
        async update(_table: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            // [#5480] The producer's own update-verb dispatch contract, so this
            // double cannot accept a call `ObjectQL.update` refuses.
            assertEngineUpdateDispatch(data, o);
            boom('update');
            return { id: null };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            // [#4550] The producer's own delete-verb dispatch contract, so this
            // double cannot accept a call `ObjectQL.delete` refuses.
            assertEngineDeleteDispatch(o);
            boom('delete');
            if (table !== 'sys_metadata') return { deleted: 0 };
            const id = (o as any)?.where?.id;
            return { deleted: rows.delete(id) ? 1 : 0 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => {},
            uninstallPackage: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        opts.environmentId,
    ) as any;
    return { protocol, rows };
}

/** Every refusal assertion in this file goes through here: `code` AND `status`, never one. */
function expectDeclaredEnvelope(err: any, code: string, status: number): void {
    expect(err?.code).toBe(code);
    expect(err?.status).toBe(status);
}

async function captureThrow(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the call to throw, and it resolved');
}

// ---------------------------------------------------------------------------
// 0. What the shared predicate actually knows — measured, not recalled
// ---------------------------------------------------------------------------

describe('[#8136] the shared leak heuristic is dialect-bounded, which is why the cure is at the producer', () => {
    it('recognises the two engines this repo runs, and none of the three it does not', () => {
        for (const { engine, text, knownToPredicate } of DIALECTS) {
            expect(looksLikeInternalErrorLeak(text), `${engine}: ${text}`).toBe(knownToPredicate);
        }
        // Stated positively so the asymmetry cannot be read as an accident:
        // three of five phrasings of ONE condition are invisible to every
        // boundary that runs the predicate.
        expect(DIALECTS.filter((d) => !d.knownToPredicate)).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// 1. Carrier one — `deletePackage`'s first database touch
// ---------------------------------------------------------------------------

describe('[#8136] a driver failure on the uninstall overlay read is declared, not disclosed', () => {
    for (const { engine, text } of DIALECTS) {
        it(`withholds the ${engine} phrasing and answers a declared envelope`, async () => {
            const { protocol } = makeKernel({ dbError: text, failOn: ['find'] });

            const err = await captureThrow(() =>
                protocol.deletePackage({ packageId: 'com.acme.crm', allTenants: true }));

            // The POSITIVE shape. This is the file's existing contract for "a
            // `sys_metadata` read failed" (`metadataStoreUnavailableError`),
            // reused rather than a second sentence minted for one condition.
            expectDeclaredEnvelope(err, 'SERVICE_UNAVAILABLE', 503);
            expect(String(err.message)).toContain('The metadata store could not be read');
            expectNothingLeaked({ message: err.message, code: err.code }, text);
        });
    }

    it('relocates the driver error to `cause` rather than losing it', async () => {
        const text = DIALECTS[0]!.text;
        const { protocol } = makeKernel({ dbError: text, failOn: ['find'] });

        const err = await captureThrow(() =>
            protocol.deletePackage({ packageId: 'com.acme.crm', allTenants: true }));

        // The operator half of the contract: withheld from the caller, intact
        // for `handleRouteError` / `logWithheldServerFault`. Without this the
        // fix would be indistinguishable from deleting the diagnostic.
        expect(String((err as any).cause?.message)).toBe(text);
    });

    it('keeps the failure a FAILURE — an unreachable store is never reported as a completed uninstall', async () => {
        // The trap in fixing this the other way: routing the read through
        // `rethrowUnlessMetadataStoreUnprovisioned` would turn an outage into
        // `rows = []`, and this method reports that as an uninstall that
        // deleted nothing. ADR-0110 D3 — a miss and an outage are different
        // facts — on a destructive verb.
        const { protocol } = makeKernel({ dbError: DIALECTS[1]!.text, failOn: ['find'] });
        const err = await captureThrow(() =>
            protocol.deletePackage({ packageId: 'com.acme.crm', allTenants: true }));
        expect(err).toBeInstanceOf(Error);
        expect((err as any).status).toBeGreaterThanOrEqual(500);
    });
});

// ---------------------------------------------------------------------------
// 2. Carrier two — `deleteMetaItem`'s two re-wrap exits
// ---------------------------------------------------------------------------

describe('[#8136] the overlay-delete re-wraps name the operation without quoting the driver', () => {
    it(`repository path (${REPO_PATH_TYPE}) withholds the driver line`, async () => {
        const text = DIALECTS[0]!.text;
        const { protocol } = makeKernel({ dbError: text, failOn: ['findOne'] });

        const err = await captureThrow(() =>
            protocol.deleteMetaItem({ type: REPO_PATH_TYPE, name: 'acct_overlay' }));

        expect(String(err.message)).toContain('Failed to delete customization overlay');
        expectNothingLeaked({ message: err.message }, text);
        // `status` is deliberately untouched by this card (#7426 owns it).
        expect(err.status).toBe(500);
        expect(String((err as any).cause?.message)).toBe(text);
    });

    it(`legacy raw-engine path (${LEGACY_PATH_TYPE}) withholds it too — one rule, both exits`, async () => {
        const text = DIALECTS[2]!.text;
        // Control-plane kernel (no environmentId) + a code-only type is the one
        // topology that reaches the legacy path (#5264).
        const { protocol } = makeKernel({ dbError: text, failOn: ['findOne'] });

        const err = await captureThrow(() =>
            protocol.deleteMetaItem({ type: LEGACY_PATH_TYPE, name: 'nightly_job' }));

        expect(String(err.message)).toContain('Failed to delete customization overlay');
        expectNothingLeaked({ message: err.message }, text);
        expect(err.status).toBe(500);
        expect(String((err as any).cause?.message)).toBe(text);
    });

    it('withholds every dialect, including the three the predicate cannot see', async () => {
        for (const { engine, text } of DIALECTS) {
            const { protocol } = makeKernel({ dbError: text, failOn: ['findOne'] });
            const err = await captureThrow(() =>
                protocol.deleteMetaItem({ type: REPO_PATH_TYPE, name: 'acct_overlay' }));
            expect(String(err.message), engine).not.toContain(text);
            expectNothingLeaked({ message: err.message }, text);
        }
    });

    /**
     * ⚠️ Drafted as a `[GUARD]` in section 3 and MEASURED RED — see the file
     * header. It is evidence, not a bound, and lives here for that reason: the
     * unfixed re-wrap quoted `err.message` UNCONDITIONALLY, so a declared 5xx
     * fault was disclosed exactly as a bare driver error was.
     */
    it('withholds a DECLARED 5xx too — a server fault is the operator’s detail, not the caller’s', async () => {
        // The reason the rule keys on 4xx rather than on "was anything declared
        // at all": a producer that declared a fault has said the detail belongs
        // in the log (`declaresServerFault`, #5811).
        const fault: any = new Error('relation "sys_metadata" does not exist');
        fault.code = 'SERVICE_UNAVAILABLE';
        fault.status = 503;

        const { protocol } = makeKernel({ dbError: 'unused', failOn: [] });
        protocol.getOverlayRepo = () => ({
            get: async () => { throw fault; },
            delete: async () => { throw fault; },
        });

        const err = await captureThrow(() =>
            protocol.deleteMetaItem({ type: REPO_PATH_TYPE, name: 'acct_overlay' }));

        expectNothingLeaked({ message: err.message }, fault.message);
        expectDeclaredEnvelope(err, 'SERVICE_UNAVAILABLE', 503);
    });
});

// ---------------------------------------------------------------------------
// 3. [GUARD] The over-block bound — a DECLARED refusal keeps its sentence
// ---------------------------------------------------------------------------

describe('[#8136] [GUARD] a declared 4xx refusal is quoted verbatim — green in BOTH directions, red under the over-broad variant', () => {
    /**
     * The bound that stops this fix being satisfied by "withhold everything".
     * `SysMetadataRepository`'s refusals (`[item_locked]`,
     * `[writable_package_required]`, `[no_draft]`, …) name the exact remedy,
     * and #4277 is the card that exists so they do. Blanking them would trade a
     * usability regression for no disclosure gain — measured red under the
     * over-broad variant, see the PR body.
     */
    it('keeps a repository refusal intact through the re-wrap', async () => {
        const refusal: any = new Error(
            "[item_locked] Cannot overlay 'view' in package 'showcase': that package is read-only. "
            + 'Edit the source artifact and redeploy.',
        );
        refusal.code = 'ITEM_LOCKED';
        refusal.status = 403;

        const { protocol } = makeKernel({ dbError: 'unused', failOn: [] });
        protocol.getOverlayRepo = () => ({
            get: async () => { throw refusal; },
            delete: async () => { throw refusal; },
        });

        const err = await captureThrow(() =>
            protocol.deleteMetaItem({ type: REPO_PATH_TYPE, name: 'acct_overlay' }));

        // The prescription survives, whole — this is the half a blanket
        // sanitizer would destroy.
        expect(String(err.message)).toContain('[item_locked]');
        expect(String(err.message)).toContain('Edit the source artifact and redeploy.');
        // …and the envelope #7426 installed is unchanged.
        expectDeclaredEnvelope(err, 'ITEM_LOCKED', 403);
    });

});

// ---------------------------------------------------------------------------
// 4. The DATA path — #8131's half, closed at the producer
// ---------------------------------------------------------------------------

describe('[#8136] the uninstall response body carries no driver text either', () => {
    /**
     * This is the half no HTTP boundary can fix. `failed[]` and `cleanups[]`
     * ride onto a `PACKAGE_DELETE_PARTIAL` **400** inside `details` — not the
     * message — so #8130's 5xx withhold and #8016's mapping both pass over it.
     *
     * ⛔ Note what is NOT asserted here: a filter inside the collector. There
     * is none, deliberately. `failed[].error` is clean because
     * `deleteMetaItem` is, which is what "fix it at the producer" means.
     */
    it('`failed[].error` reports the item without the driver line', async () => {
        const text = DIALECTS[1]!.text;
        const { protocol } = makeKernel({
            dbError: text,
            // The package read succeeds; only the per-item delete underneath it
            // fails, which is the shape that produces a PARTIAL rather than a throw.
            failOn: ['findOne'],
            seed: [seedRow(REPO_PATH_TYPE, 'acct_overlay', 'com.acme.crm')],
        });

        const result = await protocol.deletePackage({ packageId: 'com.acme.crm', allTenants: true });

        expect(result.failedCount).toBe(1);
        expect(result.failed[0]?.name).toBe('acct_overlay');
        // The whole response body, the way the handler ships it in `details`.
        expectNothingLeaked(result, text);
    });

    it('`cleanups[].error` withholds a failing cleanup’s driver line', async () => {
        const text = DIALECTS[4]!.text;
        const { protocol } = makeKernel({ dbError: text, failOn: [] });
        // A cleanup is arbitrary plugin code going straight at the engine —
        // plugin-security removes package-owned `sys_permission_set` rows — so
        // a driver failure lands in that catch verbatim.
        protocol.registerUninstallCleanup('security-grants', async () => {
            throw new Error(text);
        });

        const result = await protocol.deletePackage({ packageId: 'com.acme.crm', allTenants: true });

        const cleanup = result.cleanups.find((c: any) => c.name === 'security-grants');
        expect(cleanup?.success).toBe(false);
        expect(cleanup?.error).toBe('cleanup failed');
        expectNothingLeaked(result, text);
    });

    it('[GUARD] a cleanup that DECLARED a refusal keeps its sentence', async () => {
        const refusal: any = new Error(
            '[grant_revocation_blocked] 3 grants are pinned by an active session — retry after it ends.',
        );
        refusal.code = 'VALIDATION_FAILED';
        refusal.status = 400;

        const { protocol } = makeKernel({ dbError: 'unused', failOn: [] });
        protocol.registerUninstallCleanup('security-grants', async () => { throw refusal; });

        const result = await protocol.deletePackage({ packageId: 'com.acme.crm', allTenants: true });

        const cleanup = result.cleanups.find((c: any) => c.name === 'security-grants');
        expect(cleanup?.error).toContain('[grant_revocation_blocked]');
        expect(cleanup?.error).toContain('retry after it ends.');
    });
});
