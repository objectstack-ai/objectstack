// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8441 — the `code` limb beside the `error` limb #8333 closed.
 *
 * #8333 fixed the batch verbs' `error` STRING at eight producers (P6–P13): a
 * caught sentence is quoted back only when the error declared itself a
 * client-facing refusal (a 4xx `status`). It left the sibling `code` limb alone
 * on purpose and said why at the site — "a different field with a different
 * rule (a closed union)". This file is that field.
 *
 * ## The two rules are NOT the same question, and that is the whole card
 *
 * | limb | question | predicate |
 * |:--|:--|:--|
 * | `error` | did the producer AUTHOR this sentence for a caller? | 4xx `status` (`declaresClientRefusal`) |
 * | `code`  | is this value a MEMBER of the catalog? | `StandardErrorCode ∪ ERROR_CODE_LEDGER` (`clientFacingFailureCode`) |
 *
 * A message is free text, so no catalog bounds it and status-alone is the safe
 * test. `code` writes `ApiErrorSchema.code`, a CLOSED union (ADR-0112 D4) a
 * driver's dialect must never enter. Applying #8333's rule here would be the
 * wrong test on the wrong field in both directions at once — section 2's
 * `ERR_DATASOURCE_UNAVAILABLE` case is the discriminator that proves it: one
 * error, 503, whose sentence is withheld and whose ledger-registered code is
 * kept.
 *
 * ## The measurement, on the FIXED branch
 *
 * Measured after #8333 landed (`f58b1a88`), so with the message withhold
 * already in place, by failing `sys_metadata` with the shape a driver really
 * throws — `Object.assign(new Error(…), { code: 'SQLITE_ERROR', errno: 1 })`:
 *
 * ```
 * publishPackageDrafts → failed[0] = { error: 'publish failed', code: 'SQLITE_ERROR' }
 * revertCommit         → failed[0] = { error: 'revert failed',  code: 'SQLITE_ERROR' }
 * ```
 *
 * A narrower disclosure than the sentence was, the same class, and one a client
 * may branch on. Both ride response DATA, so no HTTP boundary reaches them.
 *
 * ## ⚠️ Why #8333's own pins could not see this — the fake, not the rule
 *
 * `protocol.batch-verb-driver-text.test.ts` throws `new Error(DRIVER_TEXT)`,
 * a bare error with NO `code` property. Its `expectNothingLeaked` scans the
 * whole payload for `SQLITE_ERROR`, so it WOULD have caught this — the fixture
 * simply never carried the field under test. Hence the harness here attaches a
 * real driver `code`, and every assertion below is non-vacuous only because of
 * that. (Re-run against pre-#8441 `protocol.ts` to confirm: section 1 goes red.)
 *
 * ## ⛔ The fix must FILTER, never delete
 *
 * `code` is the half a client branches on: `BATCH_ABORTED` rides the same
 * array (section 2), and the Studio publish form highlights the offending field
 * from `INVALID_METADATA` + `issues` (section 3, the mandatory positive control
 * inherited from #8333). Blanking the limb would trade a real authoring surface
 * for a disclosure narrower than the one already closed — worse than doing
 * nothing. So: catalogued in, catalogued through; anything else replaced by a
 * catalogued stand-in. No code was minted for this card.
 *
 * ## Reverse verification — both directions predicted BEFORE running
 *
 * **(a) `protocol.ts` reverted to pre-#8441.** Predicted **4 red / 8 green**:
 * section 1 (2, the driver code ships), section 5's substitution case (1, an
 * uncatalogued code on a declared 4xx passes through verbatim), and section 6
 * (1 — it asserts the PAYLOAD as well as the log, which is exactly the miss
 * #8333 recorded for its own P7 log case, so it is predicted red here rather
 * than rediscovered). Sections 2, 3 and 4 green in both directions: pass-through
 * was already the behaviour, and section 4's sites were never in scope.
 * Measured: **4 red / 8 green** — as predicted, including section 6.
 *
 * **(b) The over-broad variant** — `clientFacingFailureCode` forced to return
 * `undefined` (i.e. "just drop the limb", the tempting wrong fix). Predicted
 * **8 red / 4 green**: sections 2 (4) and 3 (1) go red because the declared
 * codes vanish, section 5's substitution case red, and section 1 red too —
 * deliberately, because it pins the SUBSTITUTED value rather than mere absence,
 * and absence is the failure this card must not ship. Green: section 4 (2) and
 * section 5's no-code case (1) and section 6 (1), none of which involve a code
 * that should survive. Measured: **8 red / 4 green** — as predicted.
 *
 * Together the two directions bound the fix on both sides: (a) proves it does
 * something, (b) proves it does not do too much.
 */
import { describe, expect, it, vi } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), from `@objectstack/metadata-core` — never `@objectstack/objectql`,
// which depends on THIS package and would close a cycle.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
// The closed union itself. Asserting membership against the SCHEMA rather than
// against a literal is what makes section 1 a contract test: whatever lands on
// the wire has to parse, whoever changes the catalog next.
import { ErrorCode } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

// ---------------------------------------------------------------------------
// The one physical condition every case in section 1 drives
// ---------------------------------------------------------------------------

/** The sqlite phrasing of "`sys_metadata` is not there". */
const DRIVER_TEXT = 'SQLITE_ERROR: no such table: sys_metadata';

/**
 * ⚠️ The difference from #8333's fixture, and the reason this file exists: a
 * real better-sqlite3 failure carries `code` as a PROPERTY, not only inside the
 * sentence. node:sqlite spells it `ERR_SQLITE_ERROR`, postgres a five-character
 * SQLSTATE; the rule under test is membership, so one dialect carries it.
 */
const driverFault = () => Object.assign(new Error(DRIVER_TEXT), { code: 'SQLITE_ERROR', errno: 1 });

/** Fragments that must never appear anywhere in a client-facing payload. */
const LEAKED_FRAGMENTS = ['SQLITE_ERROR', 'no such table', 'sys_metadata'];

/** The whole response body, the way each verb ships it. */
function expectNothingLeaked(payload: unknown): void {
    const wire = JSON.stringify(payload) ?? '';
    expect(wire).not.toContain(DRIVER_TEXT);
    for (const fragment of LEAKED_FRAGMENTS) expect(wire).not.toContain(fragment);
}

/** Whatever a batch verb puts on `failed[].code` must be a catalog member. */
function expectCataloged(code: unknown): void {
    expect(typeof code).toBe('string');
    expect(ErrorCode.safeParse(code).success).toBe(true);
}

// ---------------------------------------------------------------------------
// Harness — #8333's, with the driver `code` its fixture did not carry
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
    checksum: 'sha256_8441_fixture',
    version: 1,
    ...o,
});

/**
 * A kernel with a real `sys_metadata` behind it whose named verbs fail the way
 * a missing table does — selective by table, so a case can let the package scan
 * succeed and fail only the write underneath it. That is the shape that
 * produces a `failed[]` row rather than a throw, and therefore the shape this
 * card is about.
 */
function makeKernel(opts: {
    failOn?: readonly Verb[];
    failTable?: string;
    failWith?: () => Error;
    seed?: Row[];
} = {}) {
    const rows = new Map<string, Row>();
    for (const r of opts.seed ?? []) rows.set(r.id, r);
    const fail = new Set<Verb>(opts.failOn ?? []);
    const boom = (verb: Verb, table: string) => {
        if (fail.has(verb) && (!opts.failTable || opts.failTable === table)) {
            throw (opts.failWith ?? driverFault)();
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

/** Fail `restoreVersion`'s history read — the call that drives `revertCommit`'s `failed[]`. */
function failHistoryRead(engine: any, thrown: () => Error): void {
    const orig = engine.findOne.bind(engine);
    engine.findOne = async (t: string, o: any) => {
        if (t === 'sys_metadata_history') throw thrown();
        return orig(t, o);
    };
}

/** Route `sys_metadata_commit` lookups to `commit`, everything else as normal. */
function serveCommit(engine: any, commit: unknown): void {
    const orig = engine.findOne.bind(engine);
    engine.findOne = async (t: string, o: any) =>
        (t === 'sys_metadata_commit' ? commit : orig(t, o));
}

const byName = (failed: any[], name: string) => failed.find((f) => f.name === name);

// ═══════════════════════════════════════════════════════════════════════════
// 1. EVIDENCE — the driver's own dialect never reaches the payload
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8441] a raw driver `code` is withheld from the batch verbs’ `failed[]`', () => {
    it('`publishPackageDrafts` answers a catalogued code, not `SQLITE_ERROR`', async () => {
        const { protocol } = makeKernel({
            failOn: ['insert'],
            failTable: 'sys_metadata',
            seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(r.failedCount).toBe(1);
        expect(r.failed[0].name).toBe('acct_view');
        // The `error` limb is #8333's and stays exactly where it was.
        expect(r.failed[0].error).toBe('publish failed');
        // ⛔ NOT merely "absent": the limb still answers, with the catalogued
        // stand-in for an unclassified fault. Dropping it is the wrong fix.
        expect(r.failed[0].code).toBe('INTERNAL_ERROR');
        expectCataloged(r.failed[0].code);
        expectNothingLeaked(r);
    });

    it('`revertCommit` answers a catalogued code, not `SQLITE_ERROR`', async () => {
        const { protocol, engine } = makeKernel({ seed: [row({ type: 'view', name: 'acct_view' })] });
        serveCommit(engine, commitRow([
            { type: 'view', name: 'acct_view', existedBefore: true, prevVersion: 1 },
        ]));
        failHistoryRead(engine, driverFault);

        const r = await protocol.revertCommit({ commitId: 'c1' });

        expect(r.failedCount).toBe(1);
        expect(r.failed[0].error).toBe('revert failed');
        expect(r.failed[0].code).toBe('INTERNAL_ERROR');
        expectCataloged(r.failed[0].code);
        expectNothingLeaked(r);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. [GUARD] The over-block bound — every CATALOGUED code passes through
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8441] [GUARD] a catalogued code reaches the caller unchanged — red under the drop-the-limb variant', () => {
    it('`publishPackageDrafts` keeps `NOT_OVERRIDABLE` on the causal row and `BATCH_ABORTED` on the rest', async () => {
        const { protocol } = makeKernel({
            // `api` is code-only, so the promote refuses it by name; the view
            // is collateral and must still be marked all-or-nothing.
            seed: [
                row({ type: 'api', name: 'acct_api', state: 'draft' }),
                row({ type: 'view', name: 'acct_view', state: 'draft' }),
            ],
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(byName(r.failed, 'acct_api').code).toBe('NOT_OVERRIDABLE');
        expect(byName(r.failed, 'acct_api').error).toContain('[not_overridable]');
        // The sibling declared code on the SAME array — the reason the issue
        // says this limb must be filtered rather than deleted.
        expect(byName(r.failed, 'acct_view').code).toBe('BATCH_ABORTED');
    });

    it('`revertCommit` keeps the repository’s `VERSION_NOT_FOUND`', async () => {
        const { protocol, engine } = makeKernel({ seed: [row({ type: 'view', name: 'acct_view' })] });
        serveCommit(engine, commitRow([
            { type: 'view', name: 'acct_view', existedBefore: true, prevVersion: 99 },
        ]));

        const r = await protocol.revertCommit({ commitId: 'c1' });

        expect(r.failed[0].code).toBe('VERSION_NOT_FOUND');
        expect(r.failed[0].error).toContain('[version_not_found]');
    });

    /**
     * THE DISCRIMINATOR. One error carries both halves of the card: a 503 —
     * so `declaresClientRefusal` is false and #8333's rule withholds the
     * sentence — with `ERR_DATASOURCE_UNAVAILABLE`, a code `ERROR_CODE_LEDGER`
     * registers, so the catalog rule KEEPS it. If the `code` limb were governed
     * by the 4xx question instead, this code would be destroyed; if it were
     * ungated, section 1's `SQLITE_ERROR` would ship. Only membership answers
     * both correctly, which is why the card is not a re-run of #8333.
     */
    it('a ledger-registered ENGINE code survives a 5xx whose sentence is withheld', async () => {
        const outage = () => Object.assign(new Error(DRIVER_TEXT), {
            code: 'ERR_DATASOURCE_UNAVAILABLE',
            status: 503,
        });
        const { protocol } = makeKernel({
            failOn: ['insert'],
            failTable: 'sys_metadata',
            failWith: outage,
            seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        // #8333's half: undeclared for quoting, so the sentence is withheld…
        expect(r.failed[0].error).toBe('publish failed');
        // …and #8441's half: the code was REGISTERED, so a client still learns
        // the datasource is down and can retry on it.
        expect(r.failed[0].code).toBe('ERR_DATASOURCE_UNAVAILABLE');
        expectNothingLeaked(r);
    });

    it('the same registered code survives on `revertCommit`', async () => {
        const { protocol, engine } = makeKernel({ seed: [row({ type: 'view', name: 'acct_view' })] });
        serveCommit(engine, commitRow([
            { type: 'view', name: 'acct_view', existedBefore: true, prevVersion: 1 },
        ]));
        failHistoryRead(engine, () => Object.assign(new Error(DRIVER_TEXT), {
            code: 'ERR_DATASOURCE_UNAVAILABLE',
            status: 503,
        }));

        const r = await protocol.revertCommit({ commitId: 'c1' });

        expect(r.failed[0].code).toBe('ERR_DATASOURCE_UNAVAILABLE');
        expectNothingLeaked(r);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE POSITIVE CONTROL — inherited from #8333, and SHARPER for this field
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8441] [GUARD] the Studio publish surface still gets the code it branches on', () => {
    /**
     * #8333's mandatory control, re-run against the field it actually reads.
     * The Studio form highlights the offending field from `code` + `issues`, so
     * a `code` this card blanked or rewrote would break authoring feedback to
     * close a disclosure smaller than the one already closed.
     *
     * The refusal is real, not synthesized: a `flow` draft whose approval node
     * carries broken CEL (`record.owner ==`) is rejected by the #4463
     * author-time gate on the promote, which declares `422 INVALID_METADATA`
     * with structured `issues`.
     */
    it('a broken-CEL approval flow still reports path, code and issues', async () => {
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
        // WHICH FIELD — the located path, in the human sentence (#8333's half).
        expect(failure.error).toContain('flows[0].nodes[1].config.approvers[0].value');
        expect(failure.error).toContain('does not parse as CEL');
        // …and the machine-readable halves the form highlights with. `code` is
        // THIS card's field: catalogued, so it passes through byte for byte.
        expect(failure.code).toBe('INVALID_METADATA');
        expectCataloged(failure.code);
        expect(Array.isArray(failure.issues)).toBe(true);
        expect(failure.issues[0].path).toBe('flows[0].nodes[1].config.approvers[0].value');
        expect(failure.issues[0].rule).toBe('approval-expression-invalid');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. SCOPE — the two sibling collectors that need no filter, and why
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8441] the delete-backed `failed[]` collectors are clean at their producer', () => {
    /**
     * EVIDENCE for a decision, not a guard on new code. `discardPackageDrafts`
     * and `deletePackage` build the identical `...(e?.code ? …)` limb and were
     * deliberately left ungated — #8136 recorded the same call for their
     * `error` limb. The reason holds one field over: both wrap exactly one
     * call, `deleteMetaItem`, whose two re-wrap exits already run
     * `carryCatalogedErrorCode`, so an uncatalogued driver code cannot survive
     * to them. Measured under the same code-carrying driver fault, and pinned
     * so a later change to `deleteMetaItem`'s exits is caught HERE rather than
     * on a customer's wire.
     */
    it('`discardPackageDrafts` carries no driver code under a failing store', async () => {
        const { protocol } = makeKernel({
            failOn: ['delete'],
            failTable: 'sys_metadata',
            seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
        });

        const r = await protocol.discardPackageDrafts({ packageId: PKG });

        expect(r.failed).toHaveLength(1);
        expect(r.failed[0].code).toBeUndefined();
        expectNothingLeaked(r);
    });

    it('`deletePackage` carries no driver code under a failing store', async () => {
        const { protocol } = makeKernel({
            failOn: ['delete'],
            failTable: 'sys_metadata',
            seed: [row({ type: 'view', name: 'acct_view' })],
        });

        const r = await protocol.deletePackage({ packageId: PKG, allTenants: true });

        expect(r.failed).toHaveLength(1);
        expect(r.failed[0].code).toBeUndefined();
        expectNothingLeaked(r);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The substitution's exact shape
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8441] what replaces an uncatalogued code, and what stays absent', () => {
    /**
     * An uncatalogued code on a DECLARED refusal. Both limbs answer their own
     * question and they disagree, which is the case that proves they are two
     * rules: the 4xx sentence is quoted in full (#8333), while the code — a
     * dialect, not a catalog member — is replaced by the code the declared
     * status maps to. That derivation is `toRowApiError`'s, reused rather than
     * a second vocabulary invented for this card.
     */
    it('a 4xx refusal spelling its code off-catalog keeps its sentence and gets the status’s code', async () => {
        const refusalWithDialect = () => Object.assign(
            new Error('[item_locked] Cannot overlay this item: the package is read-only.'),
            { code: 'sqlite_item_locked', status: 403 },
        );
        const { protocol } = makeKernel({
            failOn: ['insert'],
            failTable: 'sys_metadata',
            failWith: refusalWithDialect,
            seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        // #8333's rule: DECLARED 4xx, so the authored sentence survives whole.
        expect(r.failed[0].error).toContain('[item_locked]');
        expect(r.failed[0].error).toContain('the package is read-only.');
        // #8441's rule: not a catalog member, so the status's standard code.
        expect(r.failed[0].code).toBe('PERMISSION_DENIED');
        expectCataloged(r.failed[0].code);
        // …and the dialect itself is gone.
        expect(JSON.stringify(r)).not.toContain('sqlite_item_locked');
    });

    /**
     * The shape that is deliberately NOT changed: an error with no code at all
     * still produces no `code` key. Minting one where the wire never carried
     * one is an addition to the response — a separate contract decision, and
     * the posture `carryCatalogedErrorCode` already takes toward `status`.
     */
    it('an error carrying no code still produces no `code` key', async () => {
        const { protocol } = makeKernel({
            failOn: ['insert'],
            failTable: 'sys_metadata',
            failWith: () => new Error(DRIVER_TEXT),
            seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
        });

        const r = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(r.failed[0].error).toBe('publish failed');
        expect('code' in r.failed[0]).toBe(false);
        expectNothingLeaked(r);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. The operator half — withheld from the caller, intact in the log
// ═══════════════════════════════════════════════════════════════════════════

describe('[#8441] the withheld dialect still reaches the server log', () => {
    /**
     * Without this the fix would be indistinguishable from DELETING the
     * diagnostic — the failure mode that makes a disclosure fix a net loss for
     * the operator. #8333 added the `console.warn` at both sites; this asserts
     * the code-carrying fault still lands in it while the payload stays clean.
     */
    it('the driver line reaches `console.warn` while `failed[]` stays catalogued', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { protocol } = makeKernel({
                failOn: ['insert'],
                failTable: 'sys_metadata',
                seed: [row({ type: 'view', name: 'acct_view', state: 'draft' })],
            });

            const r = await protocol.publishPackageDrafts({ packageId: PKG });

            // Withheld from the caller…
            expectNothingLeaked(r);
            expectCataloged(r.failed[0].code);
            // …and intact for whoever has to fix the database.
            const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
            expect(logged).toContain(DRIVER_TEXT);
        } finally {
            warn.mockRestore();
        }
    });
});
