// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8769 — `publishMetaItem` is the SEVENTH `/meta` entry point, and it was the
 * only one that did not funnel through `canonicalizeMetaRequestType`.
 *
 * `canonicalMetaType`'s header calls that fold "the request boundary (all six
 * `/meta` entry points funnel through it)". The publish verb is on the same URL
 * family — `/api/v1/meta/:type/:name/publish` and its `…/published` overlay —
 * and reached the draftability check through `PLURAL_TO_SINGULAR` instead: the
 * MANIFEST-COLLECTION map, i.e. the exact lookup #7894 replaced at the other
 * six. One contract, two dialects, decided by which verb you used.
 *
 * ── What the fold actually reaches, measured rather than assumed ───────────
 *
 * The card filed this as pure coherence — "fail-closed today, nothing is
 * minted, nothing is bypassed" — on the reading that a plural-addressed publish
 * looks for a row under the plural `type` and finds none. That reading is right
 * for the four MANIFEST-ABSENT types and wrong for the manifest-present ones,
 * and the difference is the whole reason this file has three groups rather than
 * one:
 *
 *  • **Manifest-absent types** (`field`, `seed`, `external_catalog`,
 *    `translation` — legitimately not stack collections, which is why #7894
 *    moved the boundary off this map). `PLURAL_TO_SINGULAR['translations']` is
 *    `undefined`, so the type stayed plural all the way down: the draftability
 *    check saw an unrecognised type and took the PERMISSIVE PLUGIN branch of
 *    `isRuntimeCreateAllowed`, and the row lookup then missed. Fail-closed, but
 *    closed for the wrong reason and with the wrong verdict — group A and B.
 *  • **Manifest-present types** (`view` → `views`). `promoteDraftForPublish`
 *    folds through the manifest map BEFORE the row lookup, so the promotion
 *    always resolved the canonical row. What did NOT fold is
 *    `getEffectiveLock`'s OVERLAY limb, which queries `sys_metadata` with the
 *    raw `type` (its artifact limb folds; the overlay limb does not). So the
 *    ADR-0010 `_lock` carried by the stored active row was looked up under a
 *    `type` no row has, came back `'none'` — the verdict "the author declared
 *    no protection" — and the promotion the lock existed to refuse went ahead.
 *    That is group C, and it is the one part of this seam that was not
 *    fail-closed.
 *
 * ── Reverse verification, direction predicted BEFORE running ───────────────
 *
 * Taking the fix back out (`git checkout origin/main -- ../metadata-protocol/src/protocol.ts`
 * AND REBUILDING it — `packages/objectql` resolves `@objectstack/metadata-protocol`
 * through its `dist`, so a source-only revert measures nothing while looking
 * like it measured something) must turn the folding cases RED and leave every
 * control GREEN.
 *
 * ⚠️ Verify the ablation reached `dist` with an EXECUTABLE marker, never a
 * comment: tsup strips comments from the built JS, so a prose marker is absent
 * from the artifact in BOTH directions and "absent" proves nothing. The marker
 * that works here is the call count —
 * `grep -o canonicalizeMetaRequestType dist/index.js | wc -l` is **8** with the
 * fix (one definition + seven call sites) and **7** without it.
 *
 *   with the fix                    without it (origin/main)
 *   ----------------------------    ------------------------------------------
 *   A plural → same row     200     404 `no_draft`                      → RED
 *   A canonical control     200     200, unchanged                      → GREEN
 *   A non-spelling control  404     404, unchanged                      → GREEN
 *   B plural `fields`       403 NOT_OVERRIDABLE
 *                                   404 `no_draft` — the gate PASSED via
 *                                   the permissive plugin branch        → RED
 *   B canonical control     403     403, unchanged                      → GREEN
 *   C plural, locked        403 ITEM_LOCKED
 *                                   200, active row overwritten         → RED
 *   C canonical control     403     403, unchanged                      → GREEN
 *
 * Predicted 3 red / 4 green; measured 3 red / 4 green, each red for its
 * predicted reason rather than merely in the predicted count:
 * `[no_draft] … for translations/zh_cn` (A), `expected 'NO_DRAFT' to be
 * 'NOT_OVERRIDABLE'` (B — the gate had PASSED via the permissive plugin branch)
 * and `expected a refusal, got success` (C — the locked publish went through).
 * Captured output is quoted in the PR body.
 *
 * ── Why a REAL engine and not an engine double ─────────────────────────────
 *
 * The thing under test is which type key the protocol derives before the
 * repository ever sees the call, so a double that answers a hand-written
 * approximation of the row lookup would erase the defect in the harness and pin
 * nothing (the #7743 lesson: the gate is proven where it is exercised and
 * absent where it is used). Everything below drives the real `ObjectQL`, the
 * real `ObjectStackProtocolImplementation` and the real `SysMetadataRepository`
 * over an in-memory DRIVER, then reads the stored ROW. The harness is the
 * self-contained shape `publish-meta-response-conformance.test.ts` settled on
 * for this door, kept local for the same reason it states: a gate that imports
 * its substrate from another gate's file couples two tripwires that have to be
 * able to fail independently.
 */
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        // [#8682] Part of the real row's uniqueness key `(type, name,
        // organization_id, package_id)`; the declared-field door judges the
        // payload against this map, so omitting it is a fixture defect.
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them — the short-circuiting shape answers a different query
    // than the one written and stays green while doing it (#7620).
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

/**
 * An ENVIRONMENT kernel (`environmentId: 'env_prod'`), deliberately — not the
 * `undefined` topology the sibling conformance gate uses. `lockWriteRefusal`
 * opens with `if (this.environmentId === undefined) return null`, so on an
 * environment-less kernel the ADR-0010 gate is skipped wholesale and group C
 * below would be green against both the fix AND the defect: a harness that
 * cannot reach the gate cannot pin it. Groups A and B are indifferent to the
 * topology and share it rather than carrying a second one.
 */
async function makeProtocol() {
    const engine = new ObjectQL();
    const { driver, stores } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_prod');
    const rows = () => Array.from(stores.get('sys_metadata')?.values() ?? []) as any[];
    return { protocol, rows };
}

/** The refusal envelope ADR-0112 pins: `code` AND `status`, never "it threw". */
async function refusalOf(fn: () => Promise<unknown>): Promise<{ code?: string; status?: number; message: string }> {
    try {
        await fn();
    } catch (e: any) {
        return { code: e?.code, status: e?.status, message: String(e?.message ?? e) };
    }
    throw new Error('expected a refusal, got success');
}

/**
 * A `translation` body. `TranslationItemSchema` requires `locale`; `name` is
 * declared and optional, and is deliberately NOT snake_case-constrained for
 * this type (translation items are conventionally named after their locale).
 */
const translationBody = (label: string) => ({ locale: 'zh-CN', name: 'zh_cn', label });

/** [#7741] the inline arm requires the object binding pair. */
const viewBody = (label: string) => ({
    name: 'case_grid', type: 'grid', label, columns: ['id'], object: 'case', viewKind: 'list',
});

const ORG = 'org_x';

// ═══════════════════════════════════════════════════════════════════════════
// A — a MANIFEST-ABSENT type: the plural URL spelling resolves the same row
// ═══════════════════════════════════════════════════════════════════════════
//
// `translation` is one of the four types `PLURAL_TO_SINGULAR` legitimately
// omits, so this group is the #7894 shape one verb over. `PUT
// /meta/translations/zh_cn` folds and writes under `type='translation'`;
// before this fix `POST /meta/translations/zh_cn/publish` looked for a row
// under `type='translations'`, which no writer ever creates.
describe('#8769 · publish addressed with a manifest-absent plural resolves the canonical row', () => {
    it('`translations` promotes the draft written under `translation`', async () => {
        const { protocol, rows } = await makeProtocol();
        await (protocol as any).saveMetaItem({
            type: 'translation', name: 'zh_cn', organizationId: ORG,
            item: translationBody('A'), mode: 'draft',
        });

        const receipt: any = await (protocol as any).publishMetaItem({
            type: 'translations', name: 'zh_cn', organizationId: ORG,
        });

        expect(receipt.success).toBe(true);
        // The ROW, not just the receipt: the promotion landed on the canonical
        // key and left no second namespace behind. A fold that resolved the
        // read but persisted under the caller's spelling is the #4432 defect,
        // and only the stored row can tell the two apart.
        const active = rows().filter((r) => r.state === 'active');
        expect(active.map((r) => r.type)).toEqual(['translation']);
        expect(rows().some((r) => r.type === 'translations')).toBe(false);
        expect(rows().filter((r) => r.state === 'draft')).toEqual([]);
    });

    it('CONTROL — the canonical spelling still publishes (a fold was added, not a lookup loosened)', async () => {
        const { protocol, rows } = await makeProtocol();
        await (protocol as any).saveMetaItem({
            type: 'translation', name: 'zh_cn', organizationId: ORG,
            item: translationBody('A'), mode: 'draft',
        });

        const receipt: any = await (protocol as any).publishMetaItem({
            type: 'translation', name: 'zh_cn', organizationId: ORG,
        });

        expect(receipt.success).toBe(true);
        expect(rows().filter((r) => r.state === 'active').map((r) => r.type)).toEqual(['translation']);
    });

    it('CONTROL — a spelling the URL map does NOT carry still resolves nothing', async () => {
        // The discriminating half of the pair above. The boundary folds a
        // DECLARED spelling; it did not become tolerant of anything ending in
        // `s`. `translationz` is not a plural of anything, so it is
        // indistinguishable from a plugin kind by static means (the residue
        // `metaUrlSpellingRefusal` documents) and must still miss.
        const { protocol } = await makeProtocol();
        await (protocol as any).saveMetaItem({
            type: 'translation', name: 'zh_cn', organizationId: ORG,
            item: translationBody('A'), mode: 'draft',
        });

        const refusal = await refusalOf(() => (protocol as any).publishMetaItem({
            type: 'translationz', name: 'zh_cn', organizationId: ORG,
        }));
        expect(refusal.code).toBe('NO_DRAFT');
        expect(refusal.status).toBe(404);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// B — the permissive PLUGIN branch is no longer taken for a declared type
// ═══════════════════════════════════════════════════════════════════════════
//
// `field` declares `allowOrgOverride: false, allowRuntimeCreate: false` — it is
// not draftable at all. Unfolded, `'fields'` is in neither
// `STATIC_REGISTRY_TYPES` nor `RUNTIME_CREATE_ALLOWED_TYPES` (both index the
// manifest plural, which `field` does not have), and
// `isRuntimeCreateAllowed`'s "no static entry ⇒ this is a plugin kind" arm
// answered TRUE. So the draftability gate PASSED on a type it exists to refuse,
// and the request died further down on `no_draft` — the right outcome reached
// by a route that had already forgotten which type it was judging.
describe('#8769 · the draftability gate judges the real registry entry, not the plugin fallback', () => {
    it('`fields` is refused by the draftability gate — 403 NOT_OVERRIDABLE, not 404 no_draft', async () => {
        const { protocol } = await makeProtocol();

        const refusal = await refusalOf(() => (protocol as any).publishMetaItem({
            type: 'fields', name: 'showcase_task.title', organizationId: ORG,
        }));

        expect(refusal.code).toBe('NOT_OVERRIDABLE');
        expect(refusal.status).toBe(403);
        // The sentence names the type the platform actually judged. Before the
        // fold it would have named the caller's spelling — if it had been
        // reached at all, which it was not.
        expect(refusal.message).toContain("'field'");
    });

    it('CONTROL — the canonical `field` was already refused the same way', async () => {
        const { protocol } = await makeProtocol();

        const refusal = await refusalOf(() => (protocol as any).publishMetaItem({
            type: 'field', name: 'showcase_task.title', organizationId: ORG,
        }));

        expect(refusal.code).toBe('NOT_OVERRIDABLE');
        expect(refusal.status).toBe(403);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// C — the ADR-0010 overlay lock, the half of this seam that was NOT fail-closed
// ═══════════════════════════════════════════════════════════════════════════
//
// `view` IS in the manifest map, so `promoteDraftForPublish` folded it and the
// promotion always found the canonical row. `getEffectiveLock` did not: its
// artifact limb folds through `PLURAL_TO_SINGULAR`, its OVERLAY limb queries
// `sys_metadata` with the raw `type`. Addressed as `views`, the lock read
// matched no row and returned `'none'` — which is not a neutral value, it is
// the verdict "the author declared no protection" (#5706) — while the promote
// one line later read the folded key and overwrote the row the lock protected.
describe('#8769 · a plural-addressed publish cannot address around the overlay `_lock`', () => {
    /**
     * Stage: active `view` row carrying `_lock: 'no-overlay'`, plus a pending
     * draft. Built in that order deliberately — the draft is saved BEFORE the
     * lock is written, because `saveMetaItem` refuses a write once the lock is
     * live, and "a draft that predates the lock" is the state this door has to
     * hold shut. The lock is written straight into the stored row rather than
     * through the save door for the same reason.
     */
    async function stageLockedActiveWithPendingDraft() {
        const { protocol, rows } = await makeProtocol();
        await (protocol as any).saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG, item: viewBody('v1'), mode: 'draft',
        });
        await (protocol as any).publishMetaItem({ type: 'view', name: 'case_grid', organizationId: ORG });
        await (protocol as any).saveMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG, item: viewBody('v2'),
            mode: 'draft', force: true,
        });

        const activeRow = rows().find((r) => r.type === 'view' && r.state === 'active');
        expect(activeRow, 'fixture: an active row must exist to carry the lock').toBeTruthy();
        const body = typeof activeRow.metadata === 'string'
            ? JSON.parse(activeRow.metadata) : activeRow.metadata;
        activeRow.metadata = JSON.stringify({ ...body, _lock: 'no-overlay', _lockReason: 'test fixture' });
        expect(rows().some((r) => r.state === 'draft'), 'fixture: a pending draft must exist').toBe(true);
        return { protocol, rows };
    }

    it('CONTROL — the canonical spelling is refused by the lock', async () => {
        const { protocol } = await stageLockedActiveWithPendingDraft();

        const refusal = await refusalOf(() => (protocol as any).publishMetaItem({
            type: 'view', name: 'case_grid', organizationId: ORG,
        }));

        expect(refusal.code).toBe('ITEM_LOCKED');
        expect(refusal.status).toBe(403);
    });

    it('the plural spelling is refused by the SAME lock', async () => {
        const { protocol, rows } = await stageLockedActiveWithPendingDraft();

        const refusal = await refusalOf(() => (protocol as any).publishMetaItem({
            type: 'views', name: 'case_grid', organizationId: ORG,
        }));

        expect(refusal.code).toBe('ITEM_LOCKED');
        expect(refusal.status).toBe(403);
        // The refusal has to have stopped the WRITE, not merely produced a
        // sentence: the draft is still pending and the protected active body is
        // the one the lock was written onto.
        expect(rows().some((r) => r.state === 'draft')).toBe(true);
        const active = rows().find((r) => r.type === 'view' && r.state === 'active');
        expect(JSON.parse(active.metadata).label).toBe('v1');
    });
});
