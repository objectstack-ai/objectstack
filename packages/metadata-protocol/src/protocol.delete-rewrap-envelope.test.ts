// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7426 — `deleteMetaItem`'s catch re-wrap carries the wrapped error's `code`
 * when that code is part of the declared ADR-0112 vocabulary, and drops it when
 * it is not.
 *
 * ## The defect
 *
 * `deleteMetaItem` has TWO exits that re-wrap a thrown error instead of
 * rethrowing it (they are the only two in `protocol.ts` — every sibling verb
 * translates `ConflictError` and then `throw err`s the original untouched):
 *
 *  1. the repository path's catch — `status` carried forward
 *     (`err?.status ?? 500`), `code` NOT carried;
 *  2. the legacy raw-engine path's catch — `status` a literal 500, `code` NOT
 *     carried.
 *
 * So a refusal thrown by `SysMetadataRepository` with a full ADR-0112 envelope
 * reached the caller as **403 + `code: undefined`**, its code surviving only as
 * text inside the message. That is topology-dependent: on a project kernel
 * (`environmentId` set) the same refusal comes from `deleteMetaItem`'s own
 * two-tier block and arrives intact, so one and the same refusal answered two
 * different envelopes depending on the deployment shape.
 *
 * ## Why this file is a MATRIX and not a single case
 *
 * That re-wrap is the exit of EVERY non-conflict failure on the path, so
 * changing it changes the envelope of every failure kind at once — not only the
 * 403. The card's deliverable is therefore the enumeration: each kind that
 * reaches (or provably cannot reach) the re-wrap gets a case here, so "which
 * codes propagate through a wrapper" is a measured contract rather than a
 * side-effect of fixing one symptom.
 *
 * ## The rule, and why it is not a new invention
 *
 * `code` is carried **only when it parses as `ErrorCode`** — the spec's
 * `StandardErrorCode ∪ ERROR_CODE_LEDGER` union (ADR-0112 D4). That is
 * verbatim the predicate `toRowApiError` in the same file already applies to
 * decide which thrown code may become a wire code; this change reuses it rather
 * than authoring a second answer. A driver's own `code` (`42P01`,
 * `SQLITE_CONSTRAINT`, `ECONNREFUSED`) is not in the catalog and stays where it
 * was: out of the envelope, in the log.
 *
 * `status` is untouched at both sites — carrying it is pre-existing behaviour
 * at (1) and a literal at (2), and changing either is a separate contract
 * decision this card does not take.
 *
 * ## Reverse verification — the four categories, declared BEFORE running
 *
 * Base for every direction: `08363a09f88457ee96db6dc1869d201122681928`
 * (`origin/main` at authoring), never a moving `main`.
 *
 *  1. PREDICTED RED, MEASURED RED — the cases in `describe('the repository
 *     refusal reaches the caller with its code')`, `…('a catalogued engine code
 *     survives the re-wrap')` and the legacy-path catalogued case. With the
 *     re-wrap restored these fail on `code` being `undefined` while `status`
 *     is already correct — which is the defect stated as an assertion.
 *  2. GREEN IN BOTH DIRECTIONS — GUARDS, NOT EVIDENCE. Named `[GUARD]`. The
 *     uncatalogued-driver-code cases, the plain-`Error` cases, the
 *     `ConflictError` translation, and the "best-effort tail cannot reach the
 *     catch" cases. They pass before and after. What makes them load-bearing is
 *     the OVER-BROAD VARIANT (propagate `code` unconditionally), measured in
 *     the PR body: it turns the uncatalogued cases red.
 *  3. MISSED PREDICTIONS — recorded in the PR body, not tidied away.
 *  4. UNMEASURED — none; every assertion here was run in both directions.
 *
 * Never a bare `toThrow()`: the unfixed path already throws, so a throw-only
 * assertion is permanently green and cannot tell "refused with the wrong
 * envelope" from "refused correctly" (#7321's measured hole). Every refusal
 * case asserts `code` AND `status`.
 *
 * Harness: the real write path over a stub engine (same shape as
 * `protocol.legacy-overlay-delete.test.ts`) — a re-wrap INSIDE `deleteMetaItem`
 * cannot be tested against a harness that mocks `deleteMetaItem`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ErrorCode } from '@objectstack/spec/api';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

/**
 * The tier whose artifact-backed delete is refused BY THE REPOSITORY on a
 * control-plane kernel, derived from the registry and never listed by hand
 * (Prime Directive #8): no read-time overlay merge (`supportsOverlay: false`,
 * so #6960's carve-out does not reach it) and no per-org write door
 * (`allowOrgOverride: false`, so `assertAllowed` refuses), but a runtime write
 * channel (`allowRuntimeCreate: true`) — which is what puts `useRepoPath` true
 * and routes the delete into the repository in the first place.
 *
 * `object` is the specimen ADR-0029 D9 pins; the rest ride the same flags.
 */
const REPO_REFUSED_TYPES: readonly string[] = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => !e.supportsOverlay && !e.allowOrgOverride && e.allowRuntimeCreate)
    .map((e) => e.type)
    .sort();

/**
 * The CODE-ONLY tier — no overlay door, no runtime-create door. `useRepoPath`
 * is false for these, so on a control-plane kernel `deleteMetaItem` serves them
 * from the LEGACY raw-engine path and its own separate catch (#5264 left that
 * path ungated on purpose). This is how the second re-wrap exit is reached.
 */
const CODE_ONLY_TYPES: readonly string[] = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => !e.supportsOverlay && !e.allowOrgOverride && !e.allowRuntimeCreate)
    .map((e) => e.type)
    .sort();

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

const OVERLAY_CHECKSUM = 'sha256_rewrap_probe';

const seedRow = (type: string, name: string): Row => ({
    id: `row_${type}_${name}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify({ name, label: 'Customized' }),
    checksum: OVERLAY_CHECKSUM,
});

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null || v === undefined) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/** An error shaped the way a driver throws one: a `code`, and usually no `status`. */
const driverError = (message: string, code?: string, status?: number): Error => {
    const err = new Error(message) as Error & { code?: string; status?: number };
    if (code !== undefined) err.code = code;
    if (status !== undefined) err.status = status;
    return err;
};

/**
 * One kernel. `fail` injects a throw at a named seam so each failure KIND in
 * the matrix is produced by the real code path rather than by mocking the verb.
 */
function makeSession(opts: {
    environmentId?: string;
    artifacts?: Array<{ type: string; name: string }>;
    seed?: Row[];
    /** Throw from the overlay probe read / legacy existence read. */
    failFindOne?: () => never;
    /** Throw from the row delete (inside the repository transaction). */
    failDelete?: () => never;
    /** Throw from the history tombstone insert. */
    failHistoryInsert?: () => never;
    /** Throw from the best-effort audit insert (must NOT reach the caller). */
    failAuditInsert?: () => never;
    /** Throw from the best-effort registry heal (must NOT reach the caller). */
    failRegistryHeal?: () => never;
} = {}) {
    const rows = new Map<string, Row>();
    for (const r of opts.seed ?? []) rows.set(r.id, r);
    const historyRows: Array<Record<string, unknown>> = [];
    const artifactKeys = new Set((opts.artifacts ?? []).map((a) => `${a.type}|${a.name}`));

    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            if (opts.failFindOne) opts.failFindOne();
            for (const row of rows.values()) if (matchesWhere(row as any, o.where)) return row;
            return null;
        },
        async find(table: string) {
            if (table === 'sys_metadata_history') return historyRows;
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values());
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') {
                if (opts.failAuditInsert) opts.failAuditInsert();
                return { id: 'audit_1' };
            }
            if (table === 'sys_metadata_history') {
                if (opts.failHistoryInsert) opts.failHistoryInsert();
                historyRows.push({ ...data });
                return { id: String(data.id ?? `h_${historyRows.length}`) };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            const row = { id: `r_${rows.size + 1}`, ...(data as any) } as Row;
            rows.set(row.id, row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, o);
            void table;
            return { id: null };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            // [#4550] The producer's own delete-verb dispatch contract, so this
            // double cannot accept a call `ObjectQL.delete` refuses.
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            if (opts.failDelete) opts.failDelete();
            const id = (o as any)?.where?.id;
            const existed = rows.delete(id);
            return { deleted: existed ? 1 : 0 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            getItem: () => undefined,
            getArtifactItem: (type: string, name: string) =>
                artifactKeys.has(`${type}|${name}`) ? { name, _packageId: 'showcase' } : undefined,
            removeRuntimeShadow: () => {
                if (opts.failRegistryHeal) opts.failRegistryHeal();
                return false;
            },
            removeOverlayEntry: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(
        engine,
        () => new Map(),
        opts.environmentId,
    ) as any;
    return { protocol, rows, historyRows };
}

const refusalOf = (p: Promise<unknown>) => p.then(() => null, (e: any) => e);

const resetEnvHatch = () => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
};

beforeEach(resetEnvHatch);
afterEach(resetEnvHatch);

// ---------------------------------------------------------------------------
// The vocabulary this change keys on — stated first, because every case below
// is an application of it.
// ---------------------------------------------------------------------------

describe('#7426 — the carried-code predicate is the DECLARED vocabulary, not a hand-list', () => {
    it('the refusal codes this path throws are catalogued; driver codes are not', () => {
        // If a code stops parsing (unregistered from the ledger), the cases
        // below stop meaning what they say — so the premise is asserted, not
        // assumed. This is also the whole reason the predicate can be safe:
        // it is a closed union, so an over-broad propagation cannot smuggle a
        // driver dialect onto the wire.
        expect(ErrorCode.safeParse('NOT_OVERRIDABLE').success).toBe(true);
        expect(ErrorCode.safeParse('NOT_CREATABLE').success).toBe(true);
        expect(ErrorCode.safeParse('METADATA_CONFLICT').success).toBe(true);
        expect(ErrorCode.safeParse('ERR_DATASOURCE_UNAVAILABLE').success).toBe(true);

        for (const driverCode of ['42P01', 'SQLITE_CONSTRAINT', 'ECONNREFUSED', 'ER_DUP_ENTRY']) {
            expect(ErrorCode.safeParse(driverCode).success, driverCode).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// KIND 1 — the repository authorization refusal (the card's own case)
// ---------------------------------------------------------------------------

describe('#7426 — the repository refusal reaches the caller with its code', () => {
    /**
     * PREDICTED RED before the fix, on `code` only: `status` is already 403
     * because the re-wrap carries it. That asymmetry — status right, code gone
     * — is the defect, and asserting both is what tells them apart.
     *
     * Control-plane kernel ONLY (`environmentId === undefined`): that is the
     * topology whose refusal is thrown by `SysMetadataRepository` and therefore
     * passes through the re-wrap. The project-kernel leg of the same refusal is
     * thrown by `deleteMetaItem`'s own block and never reaches it — asserted
     * below as the invariant half.
     */
    for (const type of REPO_REFUSED_TYPES) {
        const name = `rewrap_${type}`;

        it(`carries NOT_OVERRIDABLE / 403 for an artifact-backed ${type} (control-plane)`, async () => {
            const { protocol, rows } = makeSession({
                artifacts: [{ type, name }],
                seed: [seedRow(type, name)],
            });

            const err = await refusalOf(protocol.deleteMetaItem({ type, name }));

            expect(err, `${type}: the delete was accepted`).toBeInstanceOf(Error);
            expect(err.code, type).toBe('NOT_OVERRIDABLE');
            expect(err.status, type).toBe(403);
            // The prose the operator reads is unchanged — the code is ADDED to
            // the envelope, it does not replace the message it was trapped in.
            expect(String(err.message), type).toContain('NOT_OVERRIDABLE');
            // A refusal that already deleted the row is a log line.
            expect(rows.size, type).toBe(1);
        });
    }

    it('the plural spelling reaches the same envelope', async () => {
        const { protocol } = makeSession({
            artifacts: [{ type: 'object', name: 'rewrap_plural' }],
            seed: [seedRow('object', 'rewrap_plural')],
        });

        const err = await refusalOf(protocol.deleteMetaItem({ type: 'objects', name: 'rewrap_plural' }));

        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(err.status).toBe(403);
    });

    it('[GUARD] the project kernel answered the full envelope already, and still does', async () => {
        // Green in BOTH directions: this refusal is thrown by `deleteMetaItem`'s
        // own two-tier block, ABOVE the try, so no re-wrap stands between it and
        // the caller. It is here as the invariant the fix converges ON — after
        // the change the two topologies answer the same envelope for the same
        // refusal, which is the card's actual goal.
        const { protocol } = makeSession({
            environmentId: 'env_test',
            artifacts: [{ type: 'object', name: 'rewrap_env' }],
            seed: [seedRow('object', 'rewrap_env')],
        });

        const err = await refusalOf(protocol.deleteMetaItem({ type: 'object', name: 'rewrap_env' }));

        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(err.status).toBe(403);
    });

    it('both topologies now answer the SAME envelope for the same refusal', async () => {
        // The card in one assertion. PREDICTED RED before the fix (the
        // control-plane leg carries no code), and it is the statement a caller
        // actually depends on: the envelope must not vary with the deployment.
        const control = await refusalOf(
            makeSession({
                artifacts: [{ type: 'object', name: 'rewrap_same' }],
                seed: [seedRow('object', 'rewrap_same')],
            }).protocol.deleteMetaItem({ type: 'object', name: 'rewrap_same' }),
        );
        const project = await refusalOf(
            makeSession({
                environmentId: 'env_test',
                artifacts: [{ type: 'object', name: 'rewrap_same' }],
                seed: [seedRow('object', 'rewrap_same')],
            }).protocol.deleteMetaItem({ type: 'object', name: 'rewrap_same' }),
        );

        expect({ code: control.code, status: control.status })
            .toEqual({ code: project.code, status: project.status });
    });
});

// ---------------------------------------------------------------------------
// KIND 2 — engine/driver faults through the SAME catch
// ---------------------------------------------------------------------------

describe('#7426 — a catalogued engine code survives the re-wrap', () => {
    /**
     * PREDICTED RED on `code`. The engine's own declared vocabulary
     * (`ERR_DATASOURCE_UNAVAILABLE`, `@objectstack/objectql`'s ledger entry) is
     * exactly as machine-readable as the metadata layer's, and a caller that
     * can tell "the datasource is down" from "you may not do that" is the point
     * of ADR-0112. `status` was already carried; only `code` moves.
     */
    it('the probe read fails with a catalogued code — code and status both arrive', async () => {
        const { protocol } = makeSession({
            seed: [seedRow('object', 'rewrap_ds')],
            failFindOne: () => {
                throw driverError('datasource pool exhausted', 'ERR_DATASOURCE_UNAVAILABLE', 503);
            },
        });

        const err = await refusalOf(protocol.deleteMetaItem({ type: 'object', name: 'rewrap_ds' }));

        expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
        expect(err.status).toBe(503);
    });

    it('the transactional row delete fails with a catalogued code', async () => {
        // A different seam inside the same try — the failure arrives after the
        // probe succeeded and after authorization passed, which is the "genuine
        // fault" half of the blast radius rather than a refusal.
        const { protocol } = makeSession({
            seed: [seedRow('object', 'rewrap_txn')],
            failDelete: () => {
                throw driverError('driver connection lost', 'ERR_DRIVER_CONNECT', 503);
            },
        });

        const err = await refusalOf(protocol.deleteMetaItem({ type: 'object', name: 'rewrap_txn' }));

        expect(err.code).toBe('ERR_DRIVER_CONNECT');
        expect(err.status).toBe(503);
    });
});

describe('#7426 — an UNCATALOGUED driver code stays out of the envelope', () => {
    /**
     * [GUARD — green in BOTH directions] These cannot go red on the shipped
     * change: an uncatalogued code was dropped before and is dropped after.
     * What makes them load-bearing is the OVER-BROAD VARIANT the issue names
     * explicitly — `(e as any).code = err?.code` with no predicate — which
     * turns every case here red by putting a Postgres/SQLite/Node dialect into
     * the field `ApiErrorSchema` declares as a closed union. Measured in the PR
     * body; that experiment, not this run, is their evidence.
     */
    for (const [label, code] of [
        ['Postgres undefined_table', '42P01'],
        ['SQLite constraint', 'SQLITE_CONSTRAINT'],
        ['Node socket', 'ECONNREFUSED'],
        ['MySQL duplicate', 'ER_DUP_ENTRY'],
    ] as const) {
        it(`[GUARD] ${label} (${code}) does not become an ADR-0112 code`, async () => {
            const { protocol } = makeSession({
                seed: [seedRow('object', 'rewrap_drv')],
                failFindOne: () => { throw driverError(`boom ${code}`, code); },
            });

            const err = await refusalOf(protocol.deleteMetaItem({ type: 'object', name: 'rewrap_drv' }));

            expect(err).toBeInstanceOf(Error);
            expect(err.code, code).toBeUndefined();
            // Unclassified throw, no status of its own → the pre-existing 500.
            expect(err.status, code).toBe(500);
        });
    }

    it('[GUARD] a plain Error with no code at all is unchanged — 500, no code', async () => {
        const { protocol } = makeSession({
            seed: [seedRow('object', 'rewrap_plain')],
            failHistoryInsert: () => { throw new Error('no such table: sys_metadata_history'); },
        });

        const err = await refusalOf(protocol.deleteMetaItem({ type: 'object', name: 'rewrap_plain' }));

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBeUndefined();
        expect(err.status).toBe(500);
        // The context annotation the wrap exists for is still there — the fix
        // ADDS a field, it does not restate the message.
        expect(String(err.message)).toContain('Failed to delete customization overlay');
    });
});

// ---------------------------------------------------------------------------
// KIND 3 — the conflict, which never reaches the re-wrap
// ---------------------------------------------------------------------------

describe('#7426 — [GUARD] ConflictError keeps its own translation', () => {
    /**
     * Green in BOTH directions: `ConflictError` is caught one branch ABOVE the
     * re-wrap and translated faithfully. It is here because the catch is shared
     * — an edit to the re-wrap that accidentally moved above the conflict
     * branch would silently re-label a 409 as a 500, and this is the assertion
     * that stops it.
     */
    it('a parent-version mismatch is still METADATA_CONFLICT / 409', async () => {
        const { protocol } = makeSession({ seed: [seedRow('object', 'rewrap_conflict')] });

        const err = await refusalOf(protocol.deleteMetaItem({
            type: 'object',
            name: 'rewrap_conflict',
            parentVersion: 'sha256_someone_elses_version',
        }));

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('METADATA_CONFLICT');
        expect(err.status).toBe(409);
    });
});

// ---------------------------------------------------------------------------
// KIND 4 — the best-effort tail, which provably cannot reach the re-wrap
// ---------------------------------------------------------------------------

describe('#7426 — [GUARD] the post-persistence tail cannot reach the catch', () => {
    /**
     * Green in BOTH directions, and the measurement behind one whole row of the
     * affected-kinds table: the registry heal, the table drop, the audit write,
     * the ADR-0094 projector and the mutation listeners each swallow their own
     * failure by design, so NONE of them can be re-wrapped. Without this the
     * table's "cannot reach the re-wrap" claim would be a code read.
     */
    it('a failing audit write, registry heal and mutation listener leave the receipt intact', async () => {
        const { protocol, rows } = makeSession({
            seed: [seedRow('object', 'rewrap_tail')],
            failAuditInsert: () => { throw driverError('audit table missing', '42P01'); },
            failRegistryHeal: () => { throw new Error('registry shadow removal blew up'); },
        });
        protocol.onMetadataMutation(() => { throw new Error('listener blew up'); });

        const res = await protocol.deleteMetaItem({ type: 'object', name: 'rewrap_tail' });

        expect(res.success).toBe(true);
        expect(res.reset).toBe(true);
        expect(rows.size).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// KIND 5 — the SECOND re-wrap exit: the legacy raw-engine path
// ---------------------------------------------------------------------------

describe('#7426 — the legacy raw-engine exit applies the same code rule', () => {
    /**
     * The other half of "the fix must not leave an envelope that varies by
     * kind". A code-only type on a control-plane kernel is served by
     * `deleteMetaItem`'s legacy raw-engine path, whose catch is a SEPARATE
     * re-wrap. Its `status` stays the literal 500 it has always been — that
     * path carries no authorization gate, so every failure through it really is
     * a fault, and changing its status is a different contract decision. Only
     * the `code` rule is unified.
     */
    it('names the code-only tier from the registry, so the case cannot silently empty', () => {
        expect(CODE_ONLY_TYPES.length).toBeGreaterThan(0);
    });

    it('carries a catalogued engine code out of the legacy path too', async () => {
        // PREDICTED RED before the fix.
        const type = CODE_ONLY_TYPES[0]!;
        const name = `legacy_${type}`;
        const { protocol } = makeSession({
            seed: [seedRow(type, name)],
            failDelete: () => { throw driverError('pool exhausted', 'ERR_DATASOURCE_UNAVAILABLE'); },
        });

        const err = await refusalOf(protocol.deleteMetaItem({ type, name }));

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
        // Unchanged by this card, and stated so it is not read as an oversight.
        expect(err.status).toBe(500);
    });

    it('[GUARD] an uncatalogued driver code stays out of the legacy envelope', async () => {
        const type = CODE_ONLY_TYPES[0]!;
        const name = `legacy_drv_${type}`;
        const { protocol } = makeSession({
            seed: [seedRow(type, name)],
            failDelete: () => { throw driverError('no such table', 'SQLITE_ERROR'); },
        });

        const err = await refusalOf(protocol.deleteMetaItem({ type, name }));

        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBeUndefined();
        expect(err.status).toBe(500);
    });
});
