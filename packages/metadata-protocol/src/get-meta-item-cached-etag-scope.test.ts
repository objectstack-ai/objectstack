// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16525] WHICH organization value `getMetaItemCached` folds into the ETag —
 * the SUPPLIED request member, or the EFFECTIVE scope the registry read gate
 * returns — and why the answer is not the defect the card feared.
 *
 * ── The question, and the measurement ─────────────────────────────────────
 *
 * The card put two facts side by side. `organizationIdForMetaRead(type, org)`
 * answers `undefined` for a supplied organization whenever the registry
 * declares `allowOrgOverride: false`, and `getMetaItem` then resolves
 * `(orgId ? findOverlay(orgId) : undefined) ?? findOverlay(null)` — so a
 * gated-away organization is served the env-wide record. `getMetaItemCached`
 * delegates to that. ⇒ If the ETag names the SUPPLIED organization while the
 * body is the env-wide representation, the validator states a scope that was
 * never served.
 *
 * MEASURED, and the answer is the SUPPLIED member:
 *
 *     const scope = [
 *         request.organizationId ? `org:${request.organizationId}` : undefined,
 *         request.locale || undefined,
 *     ].filter(...);
 *
 * §1 reproduces the divergence end to end — `object` is `allowOrgOverride:
 * false`, a supplied organization is gated away, the env-wide record is
 * served, and the validator still names the organization.
 *
 * ── ⭐ Why that is a COST and not a correctness fault ──────────────────────
 *
 * Because `content` — the serialized document actually being sent — is inside
 * the same hash. The validator is therefore a function of the bytes, not only
 * of the declared scope, so the harm the card names ("a validator claiming to
 * describe an org-scoped representation that was never served") cannot reach
 * a caller: a `304` is answered only on an exact match of a hash that covers
 * those bytes, so a caller is only ever pinned to the representation IT
 * previously received. §3 pins that, and it is the half a future change is
 * most likely to break silently — hashing a cheap version marker instead of
 * the document would leave §1 and §2 green and destroy the whole argument.
 *
 * What is left is validator FRAGMENTATION: N organizations reading one
 * env-wide document through a non-overridable type hold N validators for
 * byte-identical content. Wasteful, not wrong.
 *
 * ── ⚠️ §1 is a CHARACTERIZATION pin, not a prohibition ────────────────────
 *
 * Folding the EFFECTIVE value instead would merge those validators and make
 * the declared scope true. It is deliberately NOT done here: it changes every
 * published ETag that carries an organization (one forced miss per caller per
 * deploy) and buys nothing at the only production door, which already supplies
 * the effective value (pinned in `@objectstack/rest`,
 * `rest-server-meta-cached-etag-door-scope.test.ts`). ⇒ If §1 reddens, read
 * #16525 before making it green: it means the fold moved, which is a decision,
 * not a regression.
 *
 * ── Why the observation channel is a BODY-vs-VALIDATOR pair ───────────────
 *
 * Asserting an ETag literal would pin the hash function, which is not what
 * this card is about. Every assertion below compares two reads that differ in
 * exactly one input, and asserts the served BODIES alongside the validators —
 * so an ETag difference can never be attributed to a body difference nobody
 * checked, and a body difference can never hide behind a validator nobody
 * read.
 */

import { describe, expect, it } from 'vitest';
import { organizationIdForMetaRead } from '@objectstack/metadata-core';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { ObjectStackProtocolImplementation } from './protocol.js';

const ORG = 'org_acme';
const OTHER_ORG = 'org_globex';

/** `allowOrgOverride: false` — a supplied organization is gated away. */
const NON_OVERRIDABLE = 'object';

/** `allowOrgOverride: true` — a supplied organization survives the gate. */
const OVERRIDABLE = 'view';

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

/**
 * A row whose `label` names the partition it came from, so a served document
 * says which row answered without the assertion having to guess.
 */
const storedRow = (
    type: string,
    name: string,
    extra: Partial<StoredRow> = {},
): StoredRow => ({
    id: `r_${type}_${name}_${extra.organization_id ?? 'env'}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
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
 * protects nothing. Same shape the sibling org-read-gate pin drives.
 */
function makeHarness(rows: StoredRow[]) {
    const engine: any = {
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return undefined;
            const where = opts?.where ?? {};
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
    return new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
}

/** The label the served document carries — `'env …'` or `'org_acme …'`. */
const servedLabel = (res: any): string => res?.data?.label;

// ═══════════════════════════════════════════════════════════════════════════
// §0 — the registry facts every section below rests on, read not assumed
// ═══════════════════════════════════════════════════════════════════════════

describe('§0 the fixture types really are on opposite sides of the read gate', () => {
    it(`${NON_OVERRIDABLE} is declared allowOrgOverride: false`, () => {
        const entry = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === NON_OVERRIDABLE);
        expect(entry, `no registry entry for '${NON_OVERRIDABLE}'`).toBeDefined();
        expect(entry!.allowOrgOverride).toBe(false);
        expect(organizationIdForMetaRead(NON_OVERRIDABLE, ORG)).toBeUndefined();
    });

    it(`${OVERRIDABLE} is declared allowOrgOverride: true`, () => {
        const entry = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === OVERRIDABLE);
        expect(entry, `no registry entry for '${OVERRIDABLE}'`).toBeDefined();
        expect(entry!.allowOrgOverride).toBe(true);
        expect(organizationIdForMetaRead(OVERRIDABLE, ORG)).toBe(ORG);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §1 — (a) WHICH VALUE. The ETag folds the SUPPLIED member.
//      ⚠️ Characterization. If this reddens, read #16525 before greening it.
// ═══════════════════════════════════════════════════════════════════════════

describe('§1 the ETag names the SUPPLIED organization, not the effective scope', () => {
    it('a gated-away organization is absent from the BODY and present in the VALIDATOR', async () => {
        // A pre-#6190 phantom org row sits beside the env-wide one. The gate is
        // what keeps it out of the response; without it this case would prove
        // nothing about the ETag, because the two reads would differ in body.
        const protocol = makeHarness([
            storedRow(NON_OVERRIDABLE, 'customer'),
            storedRow(NON_OVERRIDABLE, 'customer', { organization_id: ORG, id: 'phantom' }),
        ]);

        const supplied = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: ORG,
        });
        const orgless = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer',
        });

        // ⭐ The control that makes the validator assertion mean anything: the
        // gate held, so BOTH reads were answered by the env-wide row and the
        // phantom was not served.
        expect(servedLabel(supplied), 'the phantom org row was served').toBe('env customer');
        expect(servedLabel(orgless)).toBe('env customer');
        expect(JSON.stringify(supplied.data)).toBe(JSON.stringify(orgless.data));

        // ⇒ Byte-identical representations, different validators. The scope
        // component is the request member, unreduced by the read gate.
        expect(
            supplied.etag.value,
            'the ETag no longer distinguishes a gated-away organization — see #16525',
        ).not.toBe(orgless.etag.value);
    });

    it('two organizations gated away from the same document hold two validators', async () => {
        const protocol = makeHarness([storedRow(NON_OVERRIDABLE, 'customer')]);

        const a = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: ORG,
        });
        const b = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: OTHER_ORG,
        });

        expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
        // The fragmentation the card names. Wasteful, and harmless for the
        // reason §3 pins.
        expect(a.etag.value).not.toBe(b.etag.value);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §2 — (b) REACHABILITY of the fallback the fold was written against
// ═══════════════════════════════════════════════════════════════════════════

describe('§2 the org-resolved-then-env-wide fallback is present, not future', () => {
    /**
     * The fold's own comment argued from "any FUTURE path that resolves an org
     * row but falls back to the env-wide body". That path is the `??` in
     * `getMetaItem` and it runs today on an OVERRIDABLE type whose
     * organization simply has no row — reachable through the production
     * cached door, which forwards the organization for exactly these types.
     */
    it('an overridable type with no org row serves env-wide under an org-named validator', async () => {
        const protocol = makeHarness([storedRow(OVERRIDABLE, 'account_list')]);

        const supplied = await protocol.getMetaItemCached({
            type: OVERRIDABLE, name: 'account_list', organizationId: ORG,
        });
        const orgless = await protocol.getMetaItemCached({
            type: OVERRIDABLE, name: 'account_list',
        });

        // The organization survived the gate here — and still resolved nothing,
        // so the env-wide row answered.
        expect(organizationIdForMetaRead(OVERRIDABLE, ORG)).toBe(ORG);
        expect(servedLabel(supplied)).toBe('env account_list');
        expect(JSON.stringify(supplied.data)).toBe(JSON.stringify(orgless.data));
        expect(supplied.etag.value).not.toBe(orgless.etag.value);
    });

    it('the same type WITH an org row serves it, so the fallback above was a real fallback', async () => {
        // ⭐ Without this control the case above is indistinguishable from a
        // harness that can never resolve an org row at all.
        const protocol = makeHarness([
            storedRow(OVERRIDABLE, 'account_list'),
            storedRow(OVERRIDABLE, 'account_list', { organization_id: ORG, id: 'org_row' }),
        ]);

        const supplied = await protocol.getMetaItemCached({
            type: OVERRIDABLE, name: 'account_list', organizationId: ORG,
        });
        expect(servedLabel(supplied)).toBe(`${ORG} account_list`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — ⭐ WHY §1 IS A COST AND NOT A FAULT: the served bytes are in the hash
// ═══════════════════════════════════════════════════════════════════════════

describe('§3 the validator is a function of the served bytes, not of the scope alone', () => {
    it('an unchanged document answers 304 to the validator it issued', async () => {
        // ⭐ The control that must FIRE. Every assertion below reads "no 304";
        // if the 304 arm were unreachable in this harness they would all pass
        // for the wrong reason.
        const rows = [storedRow(NON_OVERRIDABLE, 'customer')];
        const protocol = makeHarness(rows);

        const first = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: ORG,
        });
        const again = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: ORG,
            cacheRequest: { ifNoneMatch: `"${first.etag.value}"` },
        });

        expect(again.notModified, 'the 304 arm is unreachable in this harness').toBe(true);
    });

    it('a changed document never answers 304, though the scope is unchanged', async () => {
        // This is the invariant the whole "harmless" argument rests on. A hash
        // over the scope and a cheap version marker — a plausible optimization —
        // leaves §1 and §2 green and turns this red.
        const rows = [storedRow(NON_OVERRIDABLE, 'customer')];
        const protocol = makeHarness(rows);

        const first = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: ORG,
        });

        rows[0].metadata = JSON.stringify({ name: 'customer', label: 'env customer REVISED' });

        const after = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: ORG,
            cacheRequest: { ifNoneMatch: `"${first.etag.value}"` },
        });

        expect(after.notModified, 'a stale validator was honoured across a body change').toBe(false);
        expect(servedLabel(after)).toBe('env customer REVISED');
        expect(after.etag.value).not.toBe(first.etag.value);
    });

    it("one organization's validator is never honoured for another's request", async () => {
        const protocol = makeHarness([storedRow(NON_OVERRIDABLE, 'customer')]);

        const mine = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: ORG,
        });
        const theirs = await protocol.getMetaItemCached({
            type: NON_OVERRIDABLE, name: 'customer', organizationId: OTHER_ORG,
            cacheRequest: { ifNoneMatch: `"${mine.etag.value}"` },
        });

        expect(theirs.notModified).toBe(false);
        expect(servedLabel(theirs)).toBe('env customer');
    });
});
