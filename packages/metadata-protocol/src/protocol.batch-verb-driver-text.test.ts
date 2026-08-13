// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8333 — the eight batch-verb producers option C (#8086) did not reach, and
 * #8136 enumerated rather than silently narrowed.
 *
 * #8136 fixed the uninstall / overlay-delete cluster (P1–P5) and installed the
 * rule, stated once: a caught error's sentence is quoted back to a caller
 * **only when that error declared itself a client-facing refusal** — a 4xx
 * `status` in the ADR-0112 envelope. Everything else gets a stable sentence and
 * the original goes to the log. This file extends that rule to P6–P13, each of
 * which reaches a client as **data on a response** rather than as a message, so
 * no HTTP boundary's 5xx withhold can reach any of them.
 *
 * | # | site | sink |
 * |:--|:--|:--|
 * | P6  | `publishPackageDrafts` `failed[].error`        | batch-publish response |
 * | P7  | publish side effects `failures[].error`        | same |
 * | P8  | `materializeApplied.error` (feeds P7)          | same |
 * | P9  | seed-apply `error`                             | seed response |
 * | P10 | `duplicatePackage` `failed[].error`            | copy response |
 * | P11 | `revertCommit` `failed[].error`                | revert response |
 * | P12 | `rollbackToPackageCommit` `failed[].error`     | derivative of P11 |
 * | P13 | `migrateStoredMetadata` `rows[].reason`        | migration report |
 *
 * ## The measurement that had to come first, and what it changed
 *
 * #8333 is explicit that these eight must NOT be swept blind: several carry
 * **authored** refusals as well as driver text, and the sink cannot tell them
 * apart. Applying the rule to `publishPackageDrafts` without measuring would
 * blank the field-level authoring feedback #4277 exists for. So every site was
 * driven for real first, and the measurement decided the outcome:
 *
 *  - **Every site does receive undeclared driver text.** Each of the eight was
 *    reproduced end to end against a real failing `sys_metadata` (section 1
 *    below is that reproduction, kept as the pin).
 *  - **Every authored refusal reaching these catches already declares 4xx** —
 *    `NOT_OVERRIDABLE` 403, `INVALID_METADATA` 422, `METADATA_CONFLICT` 409,
 *    and the repository's `[version_not_found]` 404 / `[item_locked]` 403 /
 *    `[writable_package_required]` 422 — with ONE exception, P9's, handled at
 *    its producer (section 4).
 *  - **P8's authored population never enters its catch at all.** The real
 *    materializer (plugin-security) reports a refusal by RETURNING
 *    `{ success: false, error }`; only driver faults throw. Measured, not
 *    assumed — section 2 pins the returned string surviving untouched.
 *
 * ## P9 was the one site the rule could not simply be applied to
 *
 * `applySeedBodies` used `SeedLoaderRequestSchema.parse()`, so a malformed seed
 * body arrived in the same catch as a raw `ZodError` — authoring feedback that
 * declared nothing, and would therefore have been blanked. #8333's step 2 names
 * the cure and it is the one taken: **declare the refusal at its own producer**
 * (`safeParse` + a real 422 envelope), never loosen the rule at the collector.
 * The author is strictly better off — the old field carried a multi-line dump
 * of zod internals; it now carries the curated summary every other authoring
 * surface gets.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Predicted with `protocol.ts` reverted to `origin/main`: RED for section 1 (8),
 * section 4's first case (1), and section 5 except P7 (7) = **16 red / 10
 * green**, with sections 2 and 3 green in both directions as `[GUARD]`s and
 * P7's log case green because its `console.warn` predates this card.
 *
 * Measured: **17 red / 9 green**.
 *
 * ⚠️ ONE MISSED PREDICTION, recorded rather than tidied away, because the miss
 * is the useful part. **P7's log case came back RED.** The prediction reasoned
 * only about the log half of that case and forgot the case asserts BOTH halves:
 * `expectNothingLeaked(result)` runs first, and pre-fix P7's payload still
 * carried the driver line. So P7's entry in section 5 is EVIDENCE for the
 * withhold, not merely a guard on the logging — the pre-existing `console.warn`
 * was never in question, the payload was. Every other prediction held.
 *
 * The guards are load-bearing under a DIFFERENT variant, which is how they earn
 * their place: with `declaresClientRefusal` forced to return `false`
 * unconditionally (so nothing is ever quoted), sections 2, 3 and 4 go red —
 * measured **8 red / 18 green**. Without them this file would be satisfied by a
 * blanket "withhold everything", which is exactly the usability regression
 * #8333 warned the taker away from.
 *
 * ⚠️ A second, smaller prediction miss worth keeping: the over-broad variant was
 * predicted to take 9 cases red, and took 8. The survivor is **"P8 leaves a
 * RETURNED authored refusal completely alone"** — correctly green, because that
 * string never passes through `declaresClientRefusal` at all. The variant run
 * therefore doubles as the proof of this file's central measured claim: P8's
 * authored population bypasses the catch that this card changed.
 *
 * ⛔ Never a bare `toThrow()` anywhere here: these verbs do not throw, they
 * REPORT, and the whole defect is what the report says. Every case asserts the
 * payload text, and every refusal case asserts `code` alongside it.
 */
import { describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update). From `@objectstack/metadata-core`, never `@objectstack/objectql`
// — objectql depends on THIS package, so that import would close a cycle.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

// ---------------------------------------------------------------------------
// The one physical condition every case in section 1 drives
// ---------------------------------------------------------------------------

/**
 * The sqlite phrasing of "`sys_metadata` is not there". The dialect matrix
 * belongs to `protocol.driver-text-disclosure.test.ts` (#8136), which proves
 * the shared `looksLikeInternalErrorLeak` heuristic is dialect-bounded and that
 * the producer-side rule therefore cannot key on phrasing. This file inherits
 * that conclusion rather than re-deriving it: the rule under test here is
 * "was a client refusal DECLARED", which is phrasing-blind by construction, so
 * one dialect is a sufficient carrier.
 */
const DRIVER_TEXT = 'SQLITE_ERROR: no such table: sys_metadata';

/** Fragments that must never appear anywhere in a client-facing payload. */
const LEAKED_FRAGMENTS = ['SQLITE_ERROR', 'no such table', 'sys_metadata'];

/** The whole response body, the way each verb ships it. */
function expectNothingLeaked(payload: unknown): void {
    const wire = JSON.stringify(payload) ?? '';
    expect(wire).not.toContain(DRIVER_TEXT);
    for (const fragment of LEAKED_FRAGMENTS) expect(wire).not.toContain(fragment);
}

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
    version?: number;
}

const PKG = 'com.acme.crm';

const row = (o: Partial<Row> & { type: string; name: string }): Row => ({
    id: `row_${o.type}_${o.name}_${o.state ?? 'active'}`,
    organization_id: null,
    package_id: PKG,
    state: 'active',
    metadata: JSON.stringify({ name: o.name, label: 'seeded' }),
    checksum: 'sha256_8333_fixture',
    version: 1,
    ...o,
});

/**
 * A kernel with a real `sys_metadata` table behind it, whose named verbs fail
 * with `DRIVER_TEXT` exactly the way a missing table does. Selective by table
 * so a case can let the package scan succeed and fail only the write
 * underneath it — which is the shape that produces a `failed[]` entry rather
 * than a throw, and therefore the shape this card is about.
 */
function makeKernel(opts: {
    failOn?: readonly Verb[];
    failTable?: string;
    seed?: Row[];
} = {}) {
    const rows = new Map<string, Row>();
    for (const r of opts.seed ?? []) rows.set(r.id, r);
    const fail = new Set<Verb>(opts.failOn ?? []);
    const boom = (verb: Verb, table: string) => {
        if (fail.has(verb) && (!opts.failTable || opts.failTable === table)) {
            throw new Error(DRIVER_TEXT);
        }
    };
    const match = (r: Row, where: Record<string, unknown>): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k === '$or') return (v as Array<Record<string, unknown>>).some((c) => match(r, c));
            return v === null || v === undefined
                ? (r as any)[k] === null || (r as any)[k] === undefined
                : (r as any)[k] === v;
        });

    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown> }) {
            boom('find', table);
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values()).filter((r) => match(r, o?.where ?? {}));
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            boom('findOne', table);
            if (table !== 'sys_metadata') return null;
            for (const r of rows.values()) if (match(r, o?.where ?? {})) return r;
            return null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            boom('insert', table);
            if (table === 'sys_metadata') {
                const r = { ...(data as any) } as Row;
                r.id = String(data.id ?? `r_${rows.size}`);
                rows.set(r.id, r);
            }
            return { id: String(data.id ?? 'r_new') };
        },
        async update(table: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            // [#5480] The producer's own update-verb dispatch contract, so this
            // double cannot accept a call `ObjectQL.update` refuses.
            assertEngineUpdateDispatch(data, o);
            boom('update', table);
            const id = (o as any)?.where?.id;
            const r = id ? rows.get(id) : undefined;
            if (r) Object.assign(r, data);
            return { id: id ?? null };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            // [#4550] Likewise for delete.
            assertEngineDeleteDispatch(o);
            boom('delete', table);
            const id = (o as any)?.where?.id;
            return { deleted: id && rows.delete(id) ? 1 : 0 };
        },
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined, getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, engine, rows };
}

/** A commit row whose plan names one previously-existing artifact. */
const commitRow = (items: unknown[]) => ({
    id: 'c1',
    package_id: PKG,
    organization_id: null,
    operation: 'apply',
    message: 'the commit under revert',
    created_at: '2026-01-01T00:00:00Z',
    items: JSON.stringify(items),
});

/** Route `sys_metadata_commit` lookups to `commit`, everything else as normal. */
function serveCommit(engine: any, commit: unknown): void {
    const orig = engine.findOne.bind(engine);
    engine.findOne = async (t: string, o: any) =>
        (t === 'sys_metadata_commit' ? commit : orig(t, o));
}

/** A declared client refusal, the shape `SysMetadataRepository` raises. */
function declaredRefusal(message: string, code: string, status: number): Error {
    const err: any = new Error(message);
    err.code = code;
    err.status = status;
    return err;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. EVIDENCE — every one of the eight withholds the driver line
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8333] the batch verbs report a failure without quoting the driver', () => {
    it('P6 `publishPackageDrafts` — `failed[].error`', async () => {
        const { protocol } = makeKernel({
            failOn: ['insert'],
            failTable: 'sys_metadata',
            seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(r.failedCount).toBe(1);
        expect(r.failed[0].name).toBe('acct_view');
        expect(r.failed[0].error).toBe('publish failed');
        expectNothingLeaked(r);
    });

    it('P7 publish side effects — `materializeApplied.failures[].error`', async () => {
        const { protocol } = makeKernel({
            seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
        });
        protocol.runPublishSideEffects = async () => { throw new Error(DRIVER_TEXT); };

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        const failure = r.materializeApplied.failures[0];
        // The PREFIX is the operational fact and is unchanged, byte for byte:
        // the metadata IS live and boot reconciliation heals the drift.
        expect(failure.error).toContain('side effects failed (metadata is live; boot reconciliation heals)');
        expectNothingLeaked(r);
    });

    it('P8 publish materializer — `materializeApplied.error`', async () => {
        const { protocol } = makeKernel({
            seed: [row({ type: 'permission', name: 'acct_perm', state: 'draft' })],
        });
        // A materializer is arbitrary plugin code going straight at the engine.
        protocol.registerPublishMaterializer('permission', async () => { throw new Error(DRIVER_TEXT); });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(r.materializeApplied.failures[0].error).toBe('materialize failed');
        expectNothingLeaked(r);
    });

    it('P9 seed apply — `seedApplied.error`', async () => {
        const { protocol } = makeKernel();
        // The loader resolves its dependency graph through the protocol's own
        // metadata reads, so a `sys_metadata` outage surfaces THERE and escapes
        // the loader into this catch — measured, not supposed.
        protocol.getMetaItem = async () => { throw new Error(DRIVER_TEXT); };

        const r = await protocol.applySeedBodies(
            [{ object: 'acct', records: [{ name: 'a', ref: { $ref: 'other', externalId: 'x' } }] }],
            null,
        );

        expect(r.success).toBe(false);
        expect(r.error).toBe('seed apply failed');
        expectNothingLeaked(r);
    });

    it('P10 `duplicatePackage` — `failed[].error`', async () => {
        const { protocol, engine } = makeKernel({
            seed: [row({
                type: 'page', name: 'crm_landing',
                metadata: JSON.stringify({ name: 'crm_landing', label: 'Landing', kind: 'html', source: '<div/>' }),
            })],
        });
        const origInsert = engine.insert.bind(engine);
        engine.insert = async (t: string, d: any) => {
            if (t === 'sys_metadata') throw new Error(DRIVER_TEXT);
            return origInsert(t, d);
        };

        const r = await protocol.duplicatePackage({
            sourcePackageId: PKG, targetPackageId: 'com.acme.crm2',
        });

        expect(r.failedCount).toBe(1);
        expect(r.failed[0].error).toBe('copy failed');
        expectNothingLeaked(r);
    });

    it('P11 `revertCommit` — `failed[].error`', async () => {
        const { protocol, engine } = makeKernel({
            seed: [row({ type: 'view', name: 'acct_view' })],
        });
        serveCommit(engine, commitRow([
            { type: 'view', name: 'acct_view', existedBefore: true, prevVersion: 1 },
        ]));
        // `restoreVersion` reads the target version through `findOne` on the
        // history table — that is the call this case fails.
        const origFindOne = engine.findOne.bind(engine);
        engine.findOne = async (t: string, o: any) => {
            if (t === 'sys_metadata_history') throw new Error(DRIVER_TEXT);
            return origFindOne(t, o);
        };

        const r = await protocol.revertCommit({ commitId: 'c1' });

        expect(r.failedCount).toBe(1);
        expect(r.failed[0].error).toBe('revert failed');
        expectNothingLeaked(r);
    });

    it('P12 `rollbackToPackageCommit` — `failed[].error`', async () => {
        const { protocol, engine } = makeKernel();
        let seen = 0;
        engine.findOne = async (t: string) => {
            if (t !== 'sys_metadata_commit') return null;
            seen += 1;
            if (seen === 1) return commitRow([]);
            throw new Error(DRIVER_TEXT);
        };
        protocol.listCommits = async () => [
            { id: 'c1', operation: 'apply', createdAt: '2026-02-01T00:00:00Z' },
        ];

        const r = await protocol.rollbackToPackageCommit({ commitId: 'c1' });

        expect(r.failed[0].commitId).toBe('c1');
        expect(r.failed[0].error).toBe('revert failed');
        expectNothingLeaked(r);
    });

    it('P13 `migrateStoredMetadata` — `rows[].reason`', async () => {
        const { protocol, engine } = makeKernel({
            // `page.kind: 'jsx'` → `'html'` is a live ADR-0087 conversion, so
            // this row is genuinely non-canonical and the migration really
            // attempts the rewrite. A canonical row would never reach the save.
            seed: [row({
                type: 'page', name: 'crm_landing',
                metadata: JSON.stringify({ name: 'crm_landing', label: 'Landing', kind: 'jsx', source: '<div/>' }),
            })],
        });
        for (const verb of ['insert', 'update'] as const) {
            const orig = engine[verb].bind(engine);
            engine[verb] = async (t: string, ...rest: any[]) => {
                if (t === 'sys_metadata') throw new Error(DRIVER_TEXT);
                return orig(t, ...rest);
            };
        }

        const r = await protocol.migrateStoredMetadata({ apply: true });

        expect(r.failed).toBe(1);
        expect(r.rows[0].outcome).toBe('failed');
        expect(r.rows[0].reason)
            .toBe('the metadata store rejected the rewrite; the reason is in the server log');
        // ⚠️ The pre-#8333 fallback was `String(e)`, which renders as
        // `Error: SQLITE_ERROR: …` — a disclosure in its own right, so the
        // fallback had to change too, not just the quoted branch.
        expectNothingLeaked(r);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. [GUARD] The over-block bound — a DECLARED 4xx keeps its sentence
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8333] [GUARD] a declared 4xx refusal is quoted verbatim — green in BOTH directions, red under the over-broad variant', () => {
    it('P6 keeps `NOT_OVERRIDABLE`’s prescription, with its `code`', async () => {
        const { protocol } = makeKernel({
            // `api` is code-only, so the promote refuses it by name.
            seed: [row({ type: 'api', name: 'acct_api', state: 'draft' })],
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(r.failed[0].error).toContain('[not_overridable]');
        expect(r.failed[0].error).toContain('is not draftable');
        expect(r.failed[0].code).toBe('NOT_OVERRIDABLE');
    });

    it('P8 keeps a materializer’s declared refusal', async () => {
        const { protocol } = makeKernel({
            seed: [row({ type: 'permission', name: 'acct_perm', state: 'draft' })],
        });
        protocol.registerPublishMaterializer('permission', async () => {
            throw declaredRefusal(
                "[permission_set_owned] 'acct_perm' is owned by package 'other' — rename it or take ownership.",
                'VALIDATION_FAILED', 400,
            );
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(r.materializeApplied.failures[0].error).toContain('[permission_set_owned]');
        expect(r.materializeApplied.failures[0].error).toContain('rename it or take ownership.');
    });

    /**
     * ⚠️ The measured reason P8 was safe to convert at all, and it is a fact
     * about the REAL materializer rather than about this rule: plugin-security
     * reports its authored refusals by RETURNING `{ success: false, error }`,
     * which never enters P8's catch. The rule judges only what THREW, so this
     * string cannot be affected by it — pinned so a later "tidy" that routes
     * the returned error through the same filter is caught here.
     */
    it('P8 leaves a RETURNED authored refusal completely alone', async () => {
        const { protocol } = makeKernel({
            seed: [row({ type: 'permission', name: 'acct_perm', state: 'draft' })],
        });
        protocol.registerPublishMaterializer('permission', async () => ({
            success: false, inserted: 0, updated: 0,
            error: 'permission set name is owned by another package',
        }));

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(r.materializeApplied.failures[0].error)
            .toBe('permission set name is owned by another package');
    });

    it('P10 keeps `saveMetaItem`’s spec-validation prescription in full', async () => {
        const { protocol } = makeKernel({
            seed: [row({
                type: 'view', name: 'acct_view',
                metadata: JSON.stringify({ name: 'acct_view', columns: 'not-an-array' }),
            })],
        });

        const r = await protocol.duplicatePackage({
            sourcePackageId: PKG, targetPackageId: 'com.acme.crm2',
        });

        // The whole #4277 self-correcting sentence, not just the code: it names
        // the offending key AND how to spell it correctly.
        expect(r.failed[0].error).toContain('[invalid_metadata]');
        expect(r.failed[0].error).toContain('Unrecognized key(s) on this view container');
        expect(r.failed[0].error).toContain('defineView(');
    });

    it('P11 keeps the repository’s `[version_not_found]`, with its `code`', async () => {
        const { protocol, engine } = makeKernel({
            seed: [row({ type: 'view', name: 'acct_view' })],
        });
        serveCommit(engine, commitRow([
            { type: 'view', name: 'acct_view', existedBefore: true, prevVersion: 99 },
        ]));

        const r = await protocol.revertCommit({ commitId: 'c1' });

        expect(r.failed[0].error).toContain('[version_not_found]');
        expect(r.failed[0].error).toContain('version 99');
        expect(r.failed[0].code).toBe('VERSION_NOT_FOUND');
    });

    it('P12 keeps `[commit_not_found]`', async () => {
        const { protocol, engine } = makeKernel();
        let seen = 0;
        engine.findOne = async (t: string) => {
            if (t !== 'sys_metadata_commit') return null;
            seen += 1;
            return seen === 1 ? commitRow([]) : null;
        };
        protocol.listCommits = async () => [
            { id: 'c1', operation: 'apply', createdAt: '2026-02-01T00:00:00Z' },
        ];

        const r = await protocol.rollbackToPackageCommit({ commitId: 'c1' });

        expect(r.failed[0].error).toContain('[commit_not_found]');
        expect(r.failed[0].error).toContain("No commit 'c1'");
    });

    it('P13 keeps `[item_locked]`’s remedy', async () => {
        const { protocol } = makeKernel({
            seed: [row({
                type: 'page', name: 'crm_landing',
                metadata: JSON.stringify({ name: 'crm_landing', label: 'Landing', kind: 'jsx', source: '<div/>' }),
            })],
        });
        protocol.saveMetaItem = async () => {
            throw declaredRefusal(
                "[item_locked] Cannot overlay 'page' in package 'showcase': that package is read-only. "
                + 'Edit the source artifact and redeploy.',
                'ITEM_LOCKED', 403,
            );
        };

        const r = await protocol.migrateStoredMetadata({ apply: true });

        expect(r.rows[0].reason).toContain('[item_locked]');
        expect(r.rows[0].reason).toContain('Edit the source artifact and redeploy.');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE POSITIVE CONTROL — publish-path authoring feedback still points at
//    the offending field of the offending draft
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8333] [GUARD] a spec-validation failure on the publish path still names the field', () => {
    /**
     * The mandatory control for this card. `publishPackageDrafts`'
     * `failed[].error` is the site #8333 singled out: it ships beside `code`
     * and structured `issues`, and its whole job is telling an author WHICH
     * FIELD of WHICH DRAFT is wrong. If applying the 4xx rule here blanked that,
     * the card would be a `needs_decision`, not a patch.
     *
     * The refusal is real, not synthesized: a `flow` draft whose approval node
     * carries broken CEL (`record.owner ==`) is rejected by the #4463
     * author-time gate on the promote, which declares `422 INVALID_METADATA`
     * with `issues`. That is the same body `runtime-gate.test.ts` uses as the
     * worked example, so the two files agree on what "a broken flow" is.
     */
    it('a broken-CEL approval flow still reports path, code and issues after the withhold', async () => {
        const brokenApprovalFlow = {
            name: 'leave_approval',
            label: 'Leave approval',
            trigger: { type: 'record_change', object: 'leave_request', events: ['create'] },
            nodes: [
                { id: 'start', type: 'start' },
                {
                    id: 'approve',
                    type: 'approval',
                    config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
                },
            ],
        };
        const { protocol } = makeKernel({
            seed: [row({
                type: 'flow', name: 'leave_approval', state: 'draft',
                metadata: JSON.stringify(brokenApprovalFlow),
            })],
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        const failure = r.failed[0];
        // WHICH DRAFT.
        expect(failure.type).toBe('flow');
        expect(failure.name).toBe('leave_approval');
        // WHICH FIELD — the located path, in the human sentence.
        expect(failure.error).toContain('flows[0].nodes[1].config.approvers[0].value');
        expect(failure.error).toContain('does not parse as CEL');
        // …and the machine-readable halves the Studio form highlights with.
        expect(failure.code).toBe('INVALID_METADATA');
        expect(Array.isArray(failure.issues)).toBe(true);
        expect(failure.issues[0].path).toBe('flows[0].nodes[1].config.approvers[0].value');
        expect(failure.issues[0].rule).toBe('approval-expression-invalid');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. P9's producer-side declaration — the half that made P9 convertible
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8333] the seed request’s schema rejection DECLARES itself, so the rule quotes it', () => {
    /**
     * EVIDENCE, not a guard. Before this card `SeedLoaderRequestSchema.parse()`
     * threw a raw `ZodError` — undeclared, so #8136's rule would have blanked
     * an authoring failure. #8333 step 2's cure is applied here: declare at the
     * producer, leave the collector's positive list alone.
     */
    it('a malformed seed body is answered with the curated 422 sentence, not a zod dump', async () => {
        const { protocol } = makeKernel();

        const r = await protocol.applySeedBodies(
            [{ object: 'acct', records: [{ x: 1 }], mode: 'not-a-real-mode' }],
            null,
        );

        expect(r.success).toBe(false);
        expect(r.error).toContain('[invalid_metadata]');
        expect(r.error).toContain('failed spec validation');
        // The dotted path an author can act on. The pre-#8333 dump spelled it
        // as a raw JSON array (`"path": [ "seeds", 0, "mode" ]`) inside a
        // multi-line stringified `ZodError`, which is why this is evidence.
        expect(r.error).toContain('seeds.0.mode');
        expect(r.error).not.toContain('"code":');
    });

    it('the unreadable-bodies guard is untouched — a different fact, a different sentence', async () => {
        const { protocol } = makeKernel();
        const r = await protocol.applySeedBodies([{ object: 'acct', records: null }], null);
        expect(r.error).toBe('seed apply: no readable seed bodies');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The operator half — withheld from the caller, intact in the log
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8333] the withheld driver text still reaches the server log', () => {
    /**
     * Without this section the fix would be indistinguishable from DELETING the
     * diagnostic, which is the failure mode that makes a disclosure fix a net
     * loss for the operator. #8136 kept the original on `cause` at the exits
     * that throw; these sites do not throw, so the same guarantee is carried by
     * a `console.warn` — the shape `deletePackage`'s cleanup collector already
     * uses.
     */
    const cases: Array<[string, () => Promise<unknown>]> = [
        ['P6', async () => {
            const { protocol } = makeKernel({
                failOn: ['insert'], failTable: 'sys_metadata',
                seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
            });
            return protocol.publishPackageDrafts({ packageId: PKG });
        }],
        ['P7', async () => {
            const { protocol } = makeKernel({
                seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
            });
            protocol.runPublishSideEffects = async () => { throw new Error(DRIVER_TEXT); };
            return protocol.publishPackageDrafts({ packageId: PKG });
        }],
        ['P8', async () => {
            const { protocol } = makeKernel({
                seed: [row({ type: 'permission', name: 'acct_perm', state: 'draft' })],
            });
            protocol.registerPublishMaterializer('permission', async () => { throw new Error(DRIVER_TEXT); });
            return protocol.publishPackageDrafts({ packageId: PKG });
        }],
        ['P9', async () => {
            const { protocol } = makeKernel();
            protocol.getMetaItem = async () => { throw new Error(DRIVER_TEXT); };
            return protocol.applySeedBodies(
                [{ object: 'acct', records: [{ name: 'a', ref: { $ref: 'other', externalId: 'x' } }] }],
                null,
            );
        }],
        ['P10', async () => {
            const { protocol, engine } = makeKernel({
                seed: [row({
                    type: 'page', name: 'crm_landing',
                    metadata: JSON.stringify({ name: 'crm_landing', label: 'Landing', kind: 'html', source: '<div/>' }),
                })],
            });
            const origInsert = engine.insert.bind(engine);
            engine.insert = async (t: string, d: any) => {
                if (t === 'sys_metadata') throw new Error(DRIVER_TEXT);
                return origInsert(t, d);
            };
            return protocol.duplicatePackage({ sourcePackageId: PKG, targetPackageId: 'com.acme.crm2' });
        }],
        ['P11', async () => {
            const { protocol, engine } = makeKernel({ seed: [row({ type: 'view', name: 'acct_view' })] });
            serveCommit(engine, commitRow([
                { type: 'view', name: 'acct_view', existedBefore: true, prevVersion: 1 },
            ]));
            const origFindOne = engine.findOne.bind(engine);
            engine.findOne = async (t: string, o: any) => {
                if (t === 'sys_metadata_history') throw new Error(DRIVER_TEXT);
                return origFindOne(t, o);
            };
            return protocol.revertCommit({ commitId: 'c1' });
        }],
        ['P12', async () => {
            const { protocol, engine } = makeKernel();
            let seen = 0;
            engine.findOne = async (t: string) => {
                if (t !== 'sys_metadata_commit') return null;
                seen += 1;
                if (seen === 1) return commitRow([]);
                throw new Error(DRIVER_TEXT);
            };
            protocol.listCommits = async () => [
                { id: 'c1', operation: 'apply', createdAt: '2026-02-01T00:00:00Z' },
            ];
            return protocol.rollbackToPackageCommit({ commitId: 'c1' });
        }],
        ['P13', async () => {
            const { protocol, engine } = makeKernel({
                seed: [row({
                    type: 'page', name: 'crm_landing',
                    metadata: JSON.stringify({ name: 'crm_landing', label: 'Landing', kind: 'jsx', source: '<div/>' }),
                })],
            });
            for (const verb of ['insert', 'update'] as const) {
                const orig = engine[verb].bind(engine);
                engine[verb] = async (t: string, ...rest: any[]) => {
                    if (t === 'sys_metadata') throw new Error(DRIVER_TEXT);
                    return orig(t, ...rest);
                };
            }
            return protocol.migrateStoredMetadata({ apply: true });
        }],
    ];

    for (const [site, drive] of cases) {
        it(`${site} logs the driver line it withheld`, async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const result = await drive();
                // Withheld from the caller…
                expectNothingLeaked(result);
                // …and intact for whoever has to fix the database.
                const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
                expect(logged).toContain(DRIVER_TEXT);
            } finally {
                warn.mockRestore();
            }
        });
    }
});
