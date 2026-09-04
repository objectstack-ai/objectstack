// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14770] `getMetaItem` — the SINGULAR verb — applies the registry read gate
 * ITSELF, so a caller cannot spend a raw active organization on a type that has
 * no per-org read channel.
 *
 * ── The defect, and why the singular verb is the sharper half ─────────────
 *
 * #14683 (PR #14767) moved {@link organizationIdForMetaRead} INSIDE the PLURAL
 * verb, `getMetaItems`, and deliberately did not carry to this one. There, the
 * two `queryByOrg` reads are UNIONed, so an ungated organization can only ADD
 * rows — the resurrection that card is about. Here the two `findOverlay` reads
 * combine with `??`, which is PRECEDENCE, so an ungated organization can
 * SUBSTITUTE:
 *
 *     const record = (orgId ? await findOverlay(orgId) : undefined)
 *         ?? await findOverlay(null);
 *
 * On a type the registry declares `allowOrgOverride: false`, a pre-#6190
 * phantom org-scoped row — the kind `loadMetaFromDb` walks past and
 * `reportUnhydratableOrgScopedRows` exists to warn about — was served INSTEAD
 * OF the live env-wide document, to a caller that asked for the live one. Not
 * an extra row in a list: the served document. §1 is that case, and it is the
 * case this whole card exists for.
 *
 * ── ⛔ §2 is the half that must NOT move ──────────────────────────────────
 *
 * The card's title names the `??` as precedence-not-union, and that is the
 * DEFECT STATEMENT, not a licence to convert the combinator.
 *
 * ⚠️ Each citation at its real scope. ADR-0005's decision block DOES name this
 * method — `RUNTIME READ getMetaItem(type, name)` → `1. sys_metadata … ←
 * overlay (wins)`, `2. SchemaRegistry / MetadataService ← artifact default` —
 * but the pair it ranks is overlay-vs-artifact-default, not
 * org-row-vs-env-wide-row. It settles that an overlay WINS rather than merges.
 * The inner precedence rests on two other things: ADR-0005 design principle 3
 * stores the ENTIRE item document per overlay row (so a layering has nothing
 * to layer), and the field-level patch model that would have given "layering"
 * any meaning was retired and deleted whole under ADR-0049 (#13185, PR #13186,
 * maintainer ruling 2026-08-29), with ADR-0126 §6 ruling out the phase it was
 * held for; and `organizationIdForMetaRead`'s own docblock quotes this very
 * expression as the intended shape while defining #9454. ADR-0029 D9 reaches
 * the same shape one type over — quoted, not paraphrased: `resolveObject`
 * "selects its base layer as `overlay ?? owner` instead of `owner`" — though
 * its status line reads "Design only — nothing is implemented yet", so it
 * corroborates rather than rules. ⇒ §2 pins precedence for a type that
 * legitimately HAS a per-org channel, so a future reading of the title as
 * "make it a union" fails a test instead of landing.
 *
 * ── §3–§5 are the idempotence proof the ruling made this conditional on ───
 *
 * Direction "callee-side" was ruled conditional on demonstrating that moving
 * the predicate INSIDE does not change the scope any already-gating call site
 * receives. §3 discharges `f(t, undefined) === undefined`; §4 discharges
 * `f(t, f(t, o)) === f(t, o)` over the COMPLETE population of accepted URL
 * spellings rather than a hand-listed sample, so a newly declared type or a
 * changed fold cannot slip past it; §5 pins that ONE binding serves BOTH arms
 * (the ADR-0033 `previewDrafts` read and the active-overlay read), which is
 * the half-fix shape #9454's hoist comment refuses one door over.
 *
 * ── Why the observation channel is the WHERE multiset ─────────────────────
 *
 * §4 seeds NO rows and reads the `organization_id` partitions the engine was
 * asked for. That is the whole of what this change moves — which partitions
 * are read — and observing it directly keeps the assertion body-independent,
 * so it covers every declared type instead of the handful with a
 * hand-written schema-valid body. §1/§2 pay for that by asserting the real
 * SERVED DOCUMENT on both sides of the gate, so neither half rests on a query
 * nobody proved returns a row.
 */

import { describe, expect, it } from 'vitest';
import { organizationIdForMetaRead } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { META_URL_TO_SINGULAR, canonicalMetaUrlType } from '@objectstack/spec/shared';
import { ObjectStackProtocolImplementation } from './protocol.js';

const ORG = 'org_acme';

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

const storedRow = (
    type: string,
    name: string,
    extra: Partial<StoredRow> = {},
): StoredRow => ({
    id: `r_${type}_${name}_${extra.organization_id ?? 'env'}_${extra.state ?? 'active'}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    // `label` is the observation channel for WHICH row was served — the two
    // rows of a pair differ only by scope, so a served label names its origin.
    metadata: JSON.stringify({ name, label: `${extra.organization_id ?? 'env'} ${name}` }),
    ...extra,
});

/**
 * The engine double: `findOne` over a row table, plus the registry surface the
 * single-item read path touches on its way past the overlay.
 *
 * ⛔ No `find` / `insert` / `update` / `delete`, deliberately — the read path
 * under test issues exactly one verb, and a double declaring verbs no case
 * exercises would owe `check:engine-double-contract` a dispatch contract that
 * protects nothing. Same shape the sibling plural-door pin drives.
 */
function makeHarness(rows: StoredRow[]) {
    const findOnes: Array<Record<string, unknown>> = [];
    const engine: any = {
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return undefined;
            const where = opts?.where ?? {};
            findOnes.push({ ...where });
            // `check:where-matcher` — a hand-written matcher with no combinator
            // branch reads `$and` as a field name and answers the wrong
            // question rather than failing. Refuse the shape this double does
            // not implement, matching the sibling doubles' convention.
            for (const k of Object.keys(where)) {
                if (k.startsWith('$')) {
                    throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
                }
            }
            return rows.find((r) =>
                Object.entries(where).every(([k, v]) => {
                    if (v === undefined) return true;
                    return (r as unknown as Record<string, unknown>)[k] === v;
                }),
            );
        },
        registry: {
            registerItem: () => undefined,
            registerObject: () => undefined,
            listItems: () => [],
            getItem: () => undefined,
            getObject: () => undefined,
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    return { protocol, findOnes };
}

/** Every `organization_id` partition the engine was asked for, deduplicated. */
const partitions = (finds: Array<Record<string, unknown>>): Array<string | null> =>
    [...new Set(finds.map((f) => (f.organization_id ?? null) as string | null))].sort(
        (a, b) => String(a).localeCompare(String(b)),
    );

/** The same, folded per canonical type. */
function partitionsByType(finds: Array<Record<string, unknown>>): Map<string, Set<string | null>> {
    const out = new Map<string, Set<string | null>>();
    for (const f of finds) {
        const t = canonicalMetaUrlType(String(f.type));
        if (!out.has(t)) out.set(t, new Set());
        out.get(t)!.add((f.organization_id ?? null) as string | null);
    }
    return out;
}

/** The label the served document carries — `'env …'` or `'org_acme …'`. */
const servedLabel = (res: any): string => res?.item?.label;

/**
 * The COMPLETE accepted-spelling population: every URL spelling the `/meta`
 * doors fold, unioned with every registry singular. Derived, never listed —
 * a newly declared type arrives in this sweep on its own.
 */
const ALL_SPELLINGS: string[] = [
    ...new Set([
        ...Object.keys(META_URL_TO_SINGULAR),
        ...DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type),
    ]),
].sort();

/**
 * The org-overridable canonical types, derived. Widened to `string[]`
 * deliberately: the registry's `type` is a literal union, and the uses below
 * ask the question of a type read back OUT of a WHERE clause or a fold — a
 * plain `string` by construction.
 */
const OVERRIDABLE: readonly string[] = DEFAULT_METADATA_TYPE_REGISTRY
    .filter((e) => e.allowOrgOverride)
    .map((e) => e.type);

// ═══════════════════════════════════════════════════════════════════════════
// §0 — the population this rests on, pinned so a registry change is visible
// ═══════════════════════════════════════════════════════════════════════════

describe('§0 the org-overridable set', () => {
    it('is exactly the ADR-0005 tier-A five', () => {
        expect([...OVERRIDABLE].sort()).toEqual(
            ['dashboard', 'email_template', 'report', 'translation', 'view'],
        );
    });

    it("`object` — the type the ungated runtime callers hard-code — is NOT overridable", () => {
        // The premise of §1. `runtime/src/domains/meta.ts` reaches this verb
        // three times, twice hard-coded to `'object'`; a FOURTH raw-org caller
        // lives in `runtime/src/domains/packages.ts` (`applyPublishedSeeds`,
        // `type: 'seed'`, equally non-overridable). If either type ever flips,
        // §1 is measuring something else and must be re-derived.
        expect(OVERRIDABLE).not.toContain('object');
        expect(organizationIdForMetaRead('object', ORG)).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — ⭐ THE CARD'S CASE: a phantom must not shadow the live env-wide row
// ═══════════════════════════════════════════════════════════════════════════

describe('§1 a pre-#6190 phantom does not become the served document', () => {
    const rows = () => [
        // The live env-wide document — what the caller asked for.
        storedRow('object', 'showcase_task'),
        // The phantom: an org-scoped row of an `allowOrgOverride: false` type.
        // `loadMetaFromDb` walks past it at boot, so it is dead — it exists
        // only because the runtime used to stamp `organization_id` on every
        // type before #6190.
        storedRow('object', 'showcase_task', { organization_id: ORG }),
    ];

    it('serves the env-wide row to a caller that passes a RAW active organization', async () => {
        const { protocol, findOnes } = makeHarness(rows());
        const res = await protocol.getMetaItem({
            type: 'object',
            name: 'showcase_task',
            organizationId: ORG,
        });
        expect(servedLabel(res)).toBe('env showcase_task');
        // And the phantom's partition was never even read — the gate resolves
        // to `undefined`, so the `orgId ? … : undefined` arm is skipped whole.
        expect(partitions(findOnes)).toEqual([null]);
    });

    it('answers identically whether or not the caller names the organization', async () => {
        const withOrg = makeHarness(rows());
        const withoutOrg = makeHarness(rows());
        const a = await withOrg.protocol.getMetaItem({
            type: 'object', name: 'showcase_task', organizationId: ORG,
        });
        const b = await withoutOrg.protocol.getMetaItem({
            type: 'object', name: 'showcase_task',
        });
        expect(servedLabel(a)).toBe(servedLabel(b));
        expect(partitions(withOrg.findOnes)).toEqual(partitions(withoutOrg.findOnes));
    });

    it('holds for every non-overridable declared type, not just `object`', async () => {
        const nonOverridable = DEFAULT_METADATA_TYPE_REGISTRY
            .filter((e) => !e.allowOrgOverride)
            .map((e) => e.type);
        expect(nonOverridable.length).toBeGreaterThan(5);
        for (const type of nonOverridable) {
            const { protocol, findOnes } = makeHarness([
                storedRow(type, 'probe'),
                storedRow(type, 'probe', { organization_id: ORG }),
            ]);
            const res = await protocol.getMetaItem({ type, name: 'probe', organizationId: ORG });
            expect(servedLabel(res), `${type} served the phantom`).toBe('env probe');
            expect(partitions(findOnes), `${type} read the org partition`).toEqual([null]);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — ⛔ precedence is the RULING: the `??` must survive this fix
// ═══════════════════════════════════════════════════════════════════════════

describe('§2 org-scoped row still WINS where the registry declares a per-org channel', () => {
    it('serves the org row, not the env-wide one, for an overridable type', async () => {
        // ADR-0005: `1. sys_metadata … ← overlay (wins)`. This is the
        // behaviour #9454 exists to make reachable — the author's PUT landed an
        // org-scoped row, and a read that names the organization must see it.
        const { protocol } = makeHarness([
            storedRow('view', 'task_list'),
            storedRow('view', 'task_list', { organization_id: ORG }),
        ]);
        const res = await protocol.getMetaItem({
            type: 'view', name: 'task_list', organizationId: ORG,
        });
        expect(servedLabel(res)).toBe(`${ORG} task_list`);
    });

    it('is REPLACEMENT, not a merge of the two rows', async () => {
        // ⛔ The pin that forbids reading the card's title as a licence to turn
        // `??` into a union. The env-wide row carries a key the org row does
        // not; a layering would surface it, and ADR-0005 principle 3 (whole
        // document per row, patch model retired under ADR-0049) says it must
        // not. `getMetaItem` serves ONE document, whole.
        const env = storedRow('view', 'task_list');
        env.metadata = JSON.stringify({ name: 'task_list', label: 'env task_list', envOnlyKey: 1 });
        const { protocol } = makeHarness([
            env,
            storedRow('view', 'task_list', { organization_id: ORG }),
        ]);
        const res = await protocol.getMetaItem({
            type: 'view', name: 'task_list', organizationId: ORG,
        });
        expect(servedLabel(res)).toBe(`${ORG} task_list`);
        expect(res.item.envOnlyKey).toBeUndefined();
    });

    it('falls back to the env-wide row when the org has no overlay of its own', async () => {
        const { protocol, findOnes } = makeHarness([storedRow('view', 'task_list')]);
        const res = await protocol.getMetaItem({
            type: 'view', name: 'task_list', organizationId: ORG,
        });
        expect(servedLabel(res)).toBe('env task_list');
        // BOTH partitions read — the org one first, the env-wide one as the
        // `??` fallback. That is the precedence chain, intact. (`partitions`
        // returns a SORTED set, so this asserts membership, not read order.)
        expect(partitions(findOnes)).toEqual([null, ORG]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — idempotence, leg 1: `f(t, undefined) === undefined`
// ═══════════════════════════════════════════════════════════════════════════

describe('§3 a caller that names no organization is untouched', () => {
    it('reads only the env-wide partition, for every accepted spelling', async () => {
        // The population that covers `import-mapping.ts`, `import-prepare.ts`,
        // plugin-email's template read, service-analytics' draft probe and
        // plugin-auth's `metaReader` in one statement: none of them passes an
        // `organizationId`, and the predicate short-circuits on `undefined`
        // before it ever consults the registry flag.
        for (const spelling of ALL_SPELLINGS) {
            const { protocol, findOnes } = makeHarness([]);
            await protocol.getMetaItem({ type: spelling, name: 'probe' }).catch(() => undefined);
            for (const [type, parts] of partitionsByType(findOnes)) {
                expect([...parts], `${spelling} → ${type}`).toEqual([null]);
            }
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4 — idempotence, leg 2: `f(t, f(t, o)) === f(t, o)`, over the whole
//       accepted-spelling population
// ═══════════════════════════════════════════════════════════════════════════

describe('§4 an already-gating caller receives the same scope it did before', () => {
    it('the predicate is idempotent for every accepted spelling', () => {
        // The algebra, stated directly. `f` answers `o` when the registry
        // declares the type per-org overridable and `undefined` otherwise, so
        // a second application cannot move the answer.
        for (const spelling of ALL_SPELLINGS) {
            const once = organizationIdForMetaRead(spelling, ORG);
            expect(organizationIdForMetaRead(spelling, once), spelling).toBe(once);
        }
    });

    it('the REST by-name door gates on the string this method folds to', () => {
        // The door computes `organizationIdForMetaRead(canonicalMetaUrlType(
        // req.params.type), ctx?.tenantId)` and then passes `type:
        // req.params.type` — the RAW segment. The first statement of
        // `getMetaItem` folds that segment through `canonicalizeMetaRequestType`,
        // which IS `canonicalMetaUrlType`. So the gate inside reads the
        // identical STRING the door gated on, and the second application is
        // the algebraic no-op above.
        //
        // ⛔ This is why the gate sits AFTER the fold. `declaresOrgOverride`
        // tolerates the MANIFEST plurals and not the URL-only ones
        // (`translations` / `email_templates` have no manifest key) — #10340
        // measured what that costs when a raw segment reaches the predicate.
        for (const spelling of ALL_SPELLINGS) {
            const doorGate = organizationIdForMetaRead(canonicalMetaUrlType(spelling), ORG);
            const innerGate = organizationIdForMetaRead(canonicalMetaUrlType(spelling), doorGate);
            expect(innerGate, spelling).toBe(doorGate);
        }
    });

    it('a gated door reading an overridable type still reaches the org partition', async () => {
        // The other direction of the no-op: idempotence must not be achieved by
        // denying everyone. A door that already resolved `ORG` for `view` gets
        // the org partition read, exactly as before this change.
        const gated = organizationIdForMetaRead('view', ORG);
        expect(gated).toBe(ORG);
        const { protocol, findOnes } = makeHarness([]);
        await protocol.getMetaItem({ type: 'view', name: 'probe', organizationId: gated });
        expect(partitions(findOnes)).toEqual([null, ORG]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — ONE binding, BOTH arms
// ═══════════════════════════════════════════════════════════════════════════

describe('§5 the draft-preview arm gets the same scope as the active read', () => {
    it('does not resurrect a phantom DRAFT row for a non-overridable type', async () => {
        // ADR-0033 `previewDrafts` runs its own `findDraft` pair off the SAME
        // `orgId` binding. A gate threaded into only the active arm would leave
        // this one serving exactly the phantom the active read had just stopped
        // serving — the half-fix #9454's hoist comment refuses.
        const { protocol, findOnes } = makeHarness([
            storedRow('object', 'showcase_task', { state: 'draft' }),
            storedRow('object', 'showcase_task', { state: 'draft', organization_id: ORG }),
        ]);
        const res = await protocol.getMetaItem({
            type: 'object',
            name: 'showcase_task',
            organizationId: ORG,
            previewDrafts: true,
        });
        expect(servedLabel(res)).toBe('env showcase_task');
        expect(partitions(findOnes)).toEqual([null]);
    });

    it('still prefers the org DRAFT row for an overridable type', async () => {
        const { protocol } = makeHarness([
            storedRow('view', 'task_list', { state: 'draft' }),
            storedRow('view', 'task_list', { state: 'draft', organization_id: ORG }),
        ]);
        const res = await protocol.getMetaItem({
            type: 'view',
            name: 'task_list',
            organizationId: ORG,
            previewDrafts: true,
        });
        expect(servedLabel(res)).toBe(`${ORG} task_list`);
    });
});
