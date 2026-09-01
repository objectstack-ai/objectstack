// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cascade-on-delete behavior for parent→child foreign keys, with a REAL
 * {@link ObjectQL} engine + stub driver.
 *
 * Regression: deleting a parent whose child has a *required* lookup FK used to
 * default to `set_null`, issuing an UPDATE that cleared the required FK — which
 * the child's validator rejected with a misleading "<field> is required" 400
 * naming a field that isn't even on the object being deleted (CRM e2e gap).
 * A required FK can't be nulled, so `set_null` escalates to `restrict`: the
 * delete is refused with a clear dependent-count message
 * (`DELETE_RESTRICTED`, 409). Explicit `cascade`/`restrict` and optional
 * (nullable) lookups are unaffected.
 *
 * ## [#9625] What "explicit" does and does not buy you
 *
 * The escalation tests the RESOLVED behavior, one statement after
 * `deleteBehavior || 'set_null'` has already erased the difference between an
 * absent value and an authored one. So an explicitly written
 * `deleteBehavior: 'set_null'` on a required lookup escalates exactly like the
 * default — measured, not inferred, and pinned below.
 *
 * That was an UNPINNED divergence, which is why it survived: this file covered
 * a defaulted `set_null` (escalates) and an explicit `cascade` (honored) and
 * nothing between them, so the docs sentence claiming an explicit `set_null` is
 * "always honored as written" contradicted the engine with every gate green.
 * Two more shapes are pinned alongside it for the same reason — the required
 * `multiple: true` case (see below) and a `master_detail` declaring an explicit
 * `set_null`, which is silently resolved to `cascade`.
 *
 * [#9689] That question is now answered (maintainer ruling 2026-08-19):
 * `FieldSchema` REJECTS an authored `set_null` on a `master_detail` at parse
 * time, and this engine logs loudly when the combination still reaches the
 * coercion site (raw registrations — like this suite's — and metadata stored
 * before the tightening; the engine registers raw objects and never
 * re-parses, so the spec-layer rejection alone measurably does not change
 * anything here). The COERCION itself is unchanged and stays pinned below.
 *
 * ## [#9688] The multi-value refusal now judges EMPTINESS, per row
 *
 * #9625 pinned the required `multiple: true` lookup as refused whenever any
 * row referenced the parent, even when member removal would have left that
 * row's set non-empty. That pin is UPDATED here rather than kept: the
 * maintainer ruling on #9688 (2026-08-19) narrowed the escalation to the rows
 * it is actually about. The escalation exists because a cleared required FK
 * trips the child's validator — and on a `multiple: true` field the `set_null`
 * limb removes the deleted MEMBER (#9438), so that only happens when the
 * removal EMPTIES the set: `[]` violates `required` under the #9447 ruling and
 * is rejected by the record validator since #9476.
 *
 * So both sides are pinned below, and the second is the one that makes the
 * first safe:
 *   - remainder non-empty → the member is removed and the parent delete goes
 *     through (what the #9625 pin used to forbid),
 *   - remainder EMPTY (the deleted member was the last) → `DELETE_RESTRICTED`
 *     stands, and `dependentCount` counts ONLY the rows that would be emptied.
 * An authored `deleteBehavior: 'restrict'` is untouched by any of it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from './engine.js';

const acct = {
    name: 'acct',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
    },
};
const oppRequired = {
    name: 'opp',
    label: 'Opportunity',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
        // required lookup → can't be nulled
        account: { name: 'account', type: 'lookup' as const, reference: 'acct', required: true },
    },
};
const noteOptional = {
    name: 'note',
    label: 'Note',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        body: { name: 'body', type: 'text' as const },
        // optional lookup → default set_null is valid
        account: { name: 'account', type: 'lookup' as const, reference: 'acct' },
    },
};
const taskCascade = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', type: 'text' as const },
        // required FK but author explicitly opted into cascade
        account: { name: 'account', type: 'lookup' as const, reference: 'acct', required: true, deleteBehavior: 'cascade' },
    },
};
// [#9625] The fixture the divergence existed for: a required FK carrying an
// EXPLICITLY WRITTEN `set_null`. Before this file pinned it, coverage had the
// defaulted `set_null` (escalates) and an explicit `cascade` (honored) and
// nothing in between, so both readings of "does writing it out opt me out?"
// were compatible with a green suite.
const quoteExplicitSetNull = {
    name: 'quote',
    label: 'Quote',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        account: {
            name: 'account', type: 'lookup' as const, reference: 'acct',
            required: true, deleteBehavior: 'set_null',
        },
    },
};
// [#9625/#9688] Required + `multiple: true`. #9625 pinned this shape refused
// whenever anything referenced the parent; #9688 narrowed the escalation to
// the rows member removal would EMPTY, so this fixture now carries both
// outcomes depending on how many members the row holds.
const rosterRequiredMulti = {
    name: 'roster',
    label: 'Roster',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        accounts: {
            name: 'accounts', type: 'lookup' as const, reference: 'acct',
            required: true, multiple: true, deleteBehavior: 'set_null',
        },
    },
};
// [#9688] The same shape with the `set_null` DEFAULTED rather than written
// out. The escalation reads the RESOLVED behavior (#9625), so the per-row
// judgement has to reach this spelling identically.
const squadRequiredMultiDefault = {
    name: 'squad',
    label: 'Squad',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        accounts: {
            name: 'accounts', type: 'lookup' as const, reference: 'acct',
            required: true, multiple: true,
        },
    },
};
// [#9688] Required + `multiple: true` + an AUTHORED `restrict`. The control
// that keeps the narrowing inside the escalation: an authored refusal is not
// an escalated one and is never judged on emptiness.
const vaultRequiredMultiRestrict = {
    name: 'vault',
    label: 'Vault',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        accounts: {
            name: 'accounts', type: 'lookup' as const, reference: 'acct',
            required: true, multiple: true, deleteBehavior: 'restrict',
        },
    },
};
// [#9625] The control for the pair above — same shape, `required` dropped.
// Without it, a suite that only asserted the refusal could not tell
// "refused because required" from "refused because multi-value".
const watchlistOptionalMulti = {
    name: 'watchlist',
    label: 'Watchlist',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        accounts: {
            name: 'accounts', type: 'lookup' as const, reference: 'acct',
            multiple: true, deleteBehavior: 'set_null',
        },
    },
};
// [#9625] The neighbouring resolution that collapses the same two facts:
// `master_detail` maps every non-`restrict` value onto `cascade`, so an
// explicit `set_null` here is dropped without a word.
const lineExplicitSetNull = {
    name: 'line',
    label: 'Line Item',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        parent: {
            name: 'parent', type: 'master_detail' as const, reference: 'acct',
            deleteBehavior: 'set_null',
        },
    },
};

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    let nextId = 0;
    // [#9625] `$contains` and `$or` are answered because `referenceProbeFilter`
    // spells a `multiple: true` reference probe that way (#9362) — a double
    // that ignored them would report "no dependents" for every multi-value
    // relation and turn the refusals asserted below into silent successes,
    // which is the fail-OPEN direction #8895 ruled out for this guard.
    // `$contains` is answered as MEMBERSHIP over the stored array, matching
    // what the engine narrows to afterwards via `storedReferenceIncludes`.
    const matchOne = (stored: unknown, spec: unknown): boolean => {
        if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
            const [op, cmp] = Object.entries(spec as Record<string, unknown>)[0] ?? [];
            if (op === '$contains') {
                const values = Array.isArray(stored) ? stored : [stored];
                return values.some((v) => v != null && typeof v !== 'object' && String(v) === String(cmp));
            }
            if (op === '$eq') return (stored ?? null) === ((cmp as any) ?? null);
            return false;
        }
        return (stored ?? null) === ((spec as any) ?? null);
    };
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$or') { if (!(v as any[]).some((sub) => matches(row, sub))) return false; continue; }
            if (k.startsWith('$')) continue;
            if (!matchOne(row[k], v)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async upsert(o: string, data: Record<string, unknown>) { const id = data.id as string | undefined; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

describe('cascadeDeleteRelations — required FK escalates set_null → restrict', () => {
    let engine: ObjectQL;

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of [
            acct, oppRequired, noteOptional, taskCascade,
            quoteExplicitSetNull, rosterRequiredMulti, squadRequiredMultiDefault,
            vaultRequiredMultiRestrict, watchlistOptionalMulti, lineExplicitSetNull,
        ]) engine.registry.registerObject(o);
    });

    it('refuses to delete a parent with a REQUIRED-FK child (DELETE_RESTRICTED, 409) and leaves both rows', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('opp', { name: 'Deal', account: a.id });

        await expect(engine.delete('acct', { where: { id: a.id } } as any))
            .rejects.toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'opp', dependentCount: 1 });

        // [#7307] The refusal's copy is now SPLIT in two. The structured fields
        // above are unchanged — this pins which half says what, so a later edit
        // cannot quietly put the API names back in front of an end user.
        const err = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err.message).toContain('Opportunity');       // the label, …
        expect(err.message).not.toContain('opp');           // … not the API name,
        expect(err.message).not.toMatch(/deleteBehavior/);  // … and no authoring hint.
        expect(err.developerMessage).toContain("set deleteBehavior:'cascade' on opp.account");

        // Nothing was deleted or mutated.
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeTruthy();
        expect((await engine.find('opp', {})).length).toBe(1);
    });

    it('deletes a parent that has no dependents', async () => {
        const a = await engine.insert('acct', { name: 'Empty' });
        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
    });

    it('nulls the FK for an OPTIONAL (nullable) lookup child and deletes the parent', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        const n = await engine.insert('note', { body: 'hi', account: a.id });
        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
        const note = await engine.findOne('note', { where: { id: n.id } });
        expect(note).toBeTruthy();
        expect((note as any).account).toBeNull();
    });

    it('honors an explicit deleteBehavior:cascade on a required FK (children removed, no escalation)', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        const t = await engine.insert('task', { title: 'Follow up', account: a.id });
        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
        expect(await engine.findOne('task', { where: { id: t.id } })).toBeNull();
    });

    // ── [#9625] Explicit vs defaulted `set_null` on a required lookup ──────
    //
    // The escalation two lines above the probe reads the RESOLVED behavior, by
    // which point `deleteBehavior: 'set_null'` and an absent `deleteBehavior`
    // are the same string. These pin that consequence in both directions: the
    // explicit spelling escalates exactly like the default (first two), and
    // the values that really are honored as written still are (`cascade`
    // above, and the optional multi-value control below).

    it('[#9625] escalates an EXPLICITLY written deleteBehavior:set_null on a required lookup, exactly like the default', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        const q = await engine.insert('quote', { account: a.id });

        // ADR-0112 envelope — `code` AND `status`, never a bare toThrow(): an
        // unescalated engine would fail this by throwing the child validator's
        // "account is required" 400 instead, which a bare toThrow() accepts.
        const err = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err).toMatchObject({
            code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'quote', dependentCount: 1,
        });
        // The refusal is attributed to `required`, not to an authored
        // `restrict` — this is the sentence that tells an author why writing
        // `set_null` did not take effect.
        expect(err.developerMessage).toContain('account is required, so it cannot be cleared');

        // Nothing moved: the parent survives and the FK was never cleared.
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeTruthy();
        expect((await engine.findOne('quote', { where: { id: q.id } }) as any).account).toBe(a.id);
    });

    it('[#9625→#9688] a required MULTI-VALUE lookup now REMOVES the member when the remainder stays non-empty', async () => {
        // ⚠️ This assertion is the inverse of what #9625 pinned here, changed
        // deliberately under the #9688 ruling (2026-08-19) — not repaired to
        // green. #9625 measured the refusal and pinned it so that changing it
        // would have to be a decision; this is that decision landing.
        //
        // Why the refusal was too broad: the escalation exists because
        // clearing a required FK trips the child's validator with a
        // "<field> is required" 400. On a `multiple: true` field the
        // `set_null` limb does not clear the slot — since #9438 it removes the
        // deleted MEMBER — so with `beta` still in the set the write is
        // `['beta']`, a NON-EMPTY required set that no validator objects to.
        // The delete was refused citing a failure that could not happen.
        //
        // The last-member case, where the write really would be `[]`, keeps
        // the refusal — pinned in the very next test, which is what makes this
        // narrowing safe rather than a hole.
        const a = await engine.insert('acct', { name: 'Acme' });
        const b = await engine.insert('acct', { name: 'Beta' });
        const r = await engine.insert('roster', { accounts: [a.id, b.id] });

        await engine.delete('acct', { where: { id: a.id } } as any);

        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
        // The member is gone, the sibling reference survives — #9438 semantics,
        // reached now that the escalation no longer pre-empts them.
        expect((await engine.findOne('roster', { where: { id: r.id } }) as any).accounts).toEqual([b.id]);
    });

    it('[#9688] still REFUSES when the deleted member is the LAST one — the write would be `[]`', async () => {
        // ⭐ The pin that makes the narrowing above safe. `[]` on a required
        // multi-value field is empty under the #9447 ruling (2026-08-18) and
        // is rejected by the record validator since #9476 — so this row's
        // member removal has nowhere legal to land, and the escalation is
        // still exactly right for it.
        //
        // ADR-0112 envelope — `code` AND `status`, never a bare toThrow(): an
        // engine that narrowed this case too would fail here by throwing the
        // child validator's own `required` 400 (a different code and status,
        // naming a field that is not on `acct` at all), which a bare
        // toThrow() would happily accept.
        const a = await engine.insert('acct', { name: 'Acme' });
        const r = await engine.insert('roster', { accounts: [a.id] });

        const err = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err).toMatchObject({
            code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'roster', dependentCount: 1,
        });
        // Attributed to `required`, the same sentence the single-valued
        // escalation produces — the refusal did not change its story, only its
        // reach.
        expect(err.developerMessage).toContain('accounts is required, so it cannot be cleared');
        // Nothing moved: no member removal ran and the parent survives.
        expect((await engine.findOne('roster', { where: { id: r.id } }) as any).accounts).toEqual([a.id]);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeTruthy();
    });

    it('[#9688] `dependentCount` counts ONLY the rows that would be emptied, and the whole delete is refused', async () => {
        // Two referencing rows, one of each kind. The delete is refused —
        // a delete either happens or it does not — but the count reports the
        // rows it is refused OVER. Counting the removable row too would name a
        // row this delete no longer objects to, which the card called out as
        // its own small defect.
        const a = await engine.insert('acct', { name: 'Acme' });
        const b = await engine.insert('acct', { name: 'Beta' });
        const keeps = await engine.insert('roster', { accounts: [a.id, b.id] });  // remainder ['beta']
        const emptied = await engine.insert('roster', { accounts: [a.id] });      // remainder []

        const err = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err).toMatchObject({
            code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'roster', dependentCount: 1,
        });
        // 1, not 2 — the localized copy counts the same rows the structured
        // field does, so the operator and the developer are told one number.
        expect(err.message).toContain('1 Roster');
        // And nothing was written: the removable row keeps BOTH members,
        // because the refusal lands before any member-removal write runs.
        expect((await engine.findOne('roster', { where: { id: keeps.id } }) as any).accounts).toEqual([a.id, b.id]);
        expect((await engine.findOne('roster', { where: { id: emptied.id } }) as any).accounts).toEqual([a.id]);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeTruthy();
    });

    it('[#9688] a DEFAULTED set_null on a required multi-value lookup is judged the same way, in both directions', async () => {
        // The escalation reads the RESOLVED behavior (#9625), so the defaulted
        // spelling must land on exactly the same per-row judgement as the
        // explicit one. Both directions on ONE row: removing a member while
        // another remains succeeds, and then removing that last member is
        // refused.
        const a = await engine.insert('acct', { name: 'Acme' });
        const b = await engine.insert('acct', { name: 'Beta' });
        const s = await engine.insert('squad', { accounts: [a.id, b.id] });

        await engine.delete('acct', { where: { id: a.id } } as any);
        expect((await engine.findOne('squad', { where: { id: s.id } }) as any).accounts).toEqual([b.id]);

        // `b` is now the last member — the same field, the same row.
        const err = await engine.delete('acct', { where: { id: b.id } } as any).catch((e) => e);
        expect(err).toMatchObject({
            code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'squad', dependentCount: 1,
        });
        expect((await engine.findOne('squad', { where: { id: s.id } }) as any).accounts).toEqual([b.id]);
        expect(await engine.findOne('acct', { where: { id: b.id } })).toBeTruthy();
    });

    it('[#9688] an AUTHORED restrict on a required multi-value lookup is not narrowed at all', async () => {
        // The narrowing is scoped to the ESCALATION — a `set_null` that
        // `required` turned into a refusal. A `deleteBehavior: 'restrict'` the
        // author wrote means "refuse while anything references me", and
        // emptiness has nothing to do with it. Without this control an
        // implementation that judged emptiness for every multi-value field
        // would sit green while quietly overriding an authored refusal.
        const a = await engine.insert('acct', { name: 'Acme' });
        const b = await engine.insert('acct', { name: 'Beta' });
        const v = await engine.insert('vault', { accounts: [a.id, b.id] });

        const err = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err).toMatchObject({
            code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'vault', dependentCount: 1,
        });
        // Authored `restrict`, so the refusal is NOT attributed to `required`.
        expect(err.developerMessage).not.toContain('is required, so it cannot be cleared');
        expect((await engine.findOne('vault', { where: { id: v.id } }) as any).accounts).toEqual([a.id, b.id]);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeTruthy();
    });

    it('[#9625] control: the same multi-value shape WITHOUT required removes the member and deletes the parent', async () => {
        // Pairs with the test above: it is `required`, not multi-valued-ness,
        // that produces the refusal. Without this the suite could not tell the
        // two causes apart, and a change that refused every multi-value delete
        // would sit green.
        const a = await engine.insert('acct', { name: 'Acme' });
        const b = await engine.insert('acct', { name: 'Beta' });
        const w = await engine.insert('watchlist', { accounts: [a.id, b.id] });

        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
        expect((await engine.findOne('watchlist', { where: { id: w.id } }) as any).accounts).toEqual([b.id]);
    });

    it('[#9625] a master_detail declaring an explicit deleteBehavior:set_null still cascades', async () => {
        // The neighbouring resolution with the same blind spot: `restrict` is
        // the only value that deviates, so every other value is dropped here.
        // Pinned so the coercion is a documented fact rather than an absence.
        // [#9689] `FieldSchema` now rejects this combination at parse time,
        // but THIS registration is raw (the engine never re-parses), so the
        // combination still reaches the engine and the coercion still applies
        // — this pin stays TRUE by ruling; the delete-time change is the loud
        // log, pinned in its own describe below.
        const a = await engine.insert('acct', { name: 'Acme' });
        const l = await engine.insert('line', { parent: a.id });

        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(await engine.findOne('acct', { where: { id: a.id } })).toBeNull();
        // Cascaded away — NOT kept with a nulled `parent`, which is what
        // honoring the declared `set_null` would have produced.
        expect(await engine.findOne('line', { where: { id: l.id } })).toBeNull();
    });

    it('[#3023] tags the referential set_null write with __referentialFieldClear so the owner guard can exempt it', async () => {
        // The cascade FK clear is an engine-internal integrity write. It must
        // carry the server-set marker plugin-security's ownership-anchor guard
        // keys off — otherwise nulling an owner_id-style FK would trip the
        // #3004 transfer guard and abort the cascade. A user-driven update must
        // NOT carry the marker (control).
        const seen: Array<{ op: string; marker: unknown; where: unknown }> = [];
        engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
            if (opCtx.operation === 'update') {
                seen.push({
                    op: opCtx.operation,
                    marker: opCtx.context?.__referentialFieldClear,
                    where: opCtx.data,
                });
            }
            await next();
        });

        const a = await engine.insert('acct', { name: 'Acme' });
        const n = await engine.insert('note', { body: 'hi', account: a.id });

        // A normal user update — no marker.
        await engine.update('note', { id: n.id, body: 'edited' }, { context: { userId: 'u1' } } as any);
        // The cascade set_null when the parent is deleted — marked.
        await engine.delete('acct', { where: { id: a.id }, context: { userId: 'u1' } } as any);

        const userUpdate = seen.find((s) => (s.where as any)?.body === 'edited');
        const cascadeClear = seen.find((s) => (s.where as any)?.account === null);
        expect(userUpdate?.marker, 'user update carries no referential marker').toBeUndefined();
        expect(cascadeClear?.marker, 'cascade FK clear carries the marker').toBe(true);
        // And the cascade actually nulled the FK.
        expect((await engine.findOne('note', { where: { id: n.id } }) as any).account).toBeNull();
    });
});

// [#9689] (maintainer ruling 2026-08-19, Q3 = B): the coercion above stays,
// and it now LOGS. `FieldSchema` rejects an authored `set_null` on a
// `master_detail` at parse time, so a value that still reaches the engine came
// in around the parse seam (raw registration / pre-tightening stored row) —
// the population parse-time rejection measurably cannot catch. The log fires
// on exactly the authored combination: not on a bare master_detail, not on an
// authored cascade, and not on restrict (which never coerces).
describe('cascadeDeleteRelations — [#9689] authored set_null on master_detail logs loudly at the coercion site', () => {
    // A bare master_detail — the overwhelmingly common spelling; the engine
    // resolves it to cascade identically, and it must NOT log.
    const stanzaBare = {
        name: 'stanza',
        label: 'Stanza',
        fields: {
            id: { name: 'id', type: 'text' as const, primaryKey: true },
            parent: { name: 'parent', type: 'master_detail' as const, reference: 'acct' },
        },
    };
    // An authored cascade — same resolved behavior, deliberate; must NOT log.
    const verseCascade = {
        name: 'verse',
        label: 'Verse',
        fields: {
            id: { name: 'id', type: 'text' as const, primaryKey: true },
            parent: {
                name: 'parent', type: 'master_detail' as const, reference: 'acct',
                deleteBehavior: 'cascade',
            },
        },
    };

    function makeSpyLogger(withError = true) {
        const spy = {
            info: vi.fn(), warn: vi.fn(), debug: vi.fn(),
            ...(withError ? { error: vi.fn() } : {}),
        };
        return spy as Record<'info' | 'warn' | 'debug' | 'error', ReturnType<typeof vi.fn>>;
    }

    // NOTE the registration set is per test: the log fires at the COERCION
    // SITE — whenever the parent delete computes the child field's behavior —
    // not only when that child holds rows. A misdeclared child object in the
    // registry therefore logs on every parent delete (deliberate: the
    // declaration is wrong whether or not rows exist today), so the negative
    // control below must not register `line` at all.
    async function makeEngine(logger: Record<string, unknown>, objects: unknown[]) {
        const engine = new ObjectQL({ logger });
        const { driver } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        // Two-arg spelling (packageId is the signature's required 2nd arg —
        // the house pattern of batch-row-authoring-feedback.test.ts): the
        // 1-arg call this helper first shipped with added a TS2554 to the
        // frozen TEST_DEBT ledger (354 -> 355), and the ratchet only shrinks.
        for (const o of objects) engine.registry.registerObject(o as any, 'com.objectstack.test.9689');
        return engine;
    }

    it('logs via logger.error when the parent delete coerces an authored set_null to cascade', async () => {
        const logger = makeSpyLogger();
        const engine = await makeEngine(logger, [acct, lineExplicitSetNull, stanzaBare, verseCascade]);
        const a = await engine.insert('acct', { name: 'Acme' });
        const l = await engine.insert('line', { parent: a.id });

        await engine.delete('acct', { where: { id: a.id } } as any);
        // The pinned behavior is unchanged: the child cascaded away.
        expect(await engine.findOne('line', { where: { id: l.id } })).toBeNull();

        const hits = logger.error.mock.calls.filter((c) => String(c[0]).includes("deleteBehavior: 'set_null'"));
        expect(hits).toHaveLength(1);
        const msg = String(hits[0][0]);
        // Attribution: which declaration, on which relation, and the outcome.
        expect(msg).toContain('line.parent');
        expect(msg).toContain('master_detail');
        expect(msg).toContain('NOT honored');
        expect(msg).toContain('CASCADES');
        // Actionability: both legal re-declarations are named.
        expect(msg).toContain("'restrict'");
        expect(msg).toContain("'cascade'");
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('falls back to logger.warn when the sink has no error method (#9750 sanctioned shape — never an optional call)', async () => {
        const logger = makeSpyLogger(false);
        const engine = await makeEngine(logger, [acct, lineExplicitSetNull]);
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('line', { parent: a.id });

        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(logger.warn.mock.calls.some((c) => String(c[0]).includes("deleteBehavior: 'set_null'"))).toBe(true);
    });

    it('does NOT log for a bare master_detail or an authored cascade (same resolved behavior, no divergence)', async () => {
        const logger = makeSpyLogger();
        const engine = await makeEngine(logger, [acct, stanzaBare, verseCascade]);
        const a = await engine.insert('acct', { name: 'Acme' });
        const s = await engine.insert('stanza', { parent: a.id });
        const v = await engine.insert('verse', { parent: a.id });

        await engine.delete('acct', { where: { id: a.id } } as any);
        // Both cascaded (resolved behavior identical to the logging case) …
        expect(await engine.findOne('stanza', { where: { id: s.id } })).toBeNull();
        expect(await engine.findOne('verse', { where: { id: v.id } })).toBeNull();
        // … and neither logged: the divergence between declared and delivered
        // exists only for the authored set_null.
        const all = [...logger.error.mock.calls, ...logger.warn.mock.calls].map((c) => String(c[0]));
        expect(all.filter((m) => m.includes("deleteBehavior: 'set_null'"))).toHaveLength(0);
    });
});

// [#13644] The DECLARED referential-cleanup marker — `HookContext.
// referentialFieldClear` — populated on EVERY reference-cleanup write the
// engine issues, as the read-only projection of the operation-private
// `__referentialFieldClear` the #3023 pin above holds on the envelope.
//
// Why this pin exists, and why its caller context carries a full identity: the
// filer's corrected measurement (#13644) showed the engine builds the cleanup
// write as `{ ...callerContext, transaction, __referentialFieldClear: true }`
// — it INHERITS whatever identity the caller supplied — so on the path a real
// request takes (a REST DELETE carrying a userId) `ctx.user`, `ctx.session`
// and `ctx.input` are IDENTICAL between the engine's cascade and a user's
// hand-clear of the same lookup. There is no app-observable discriminator at
// all except this key, which is why "the schema declares it" alone would be
// worthless: an engine that stopped populating any one write site would
// silently return every guard to that state. Hence one pin per write site
// (scalar clear, multi-value member removal), each beside its hand-clear
// control under the SAME identity, plus the one-fact-two-faces consistency
// leg against the envelope marker.
describe('cascadeDeleteRelations — [#13644] every reference-cleanup write carries the declared ctx.referentialFieldClear', () => {
    let engine: ObjectQL;

    // The REST-shaped caller envelope — the corrected measurement's row 1,
    // the one on which every other context member is identical between
    // cascade and hand-clear.
    const CALLER = { userId: 'u1', isSystem: true };

    type Cap = {
        event: unknown; marker: unknown; hasKey: boolean;
        sessionUserId: unknown; data: unknown;
    };
    const capture = (ctx: any): Cap => ({
        event: ctx.event,
        marker: ctx.referentialFieldClear,
        // Distinguishes ABSENT from present-but-undefined: the contract is
        // "absent unless true", and a present-but-undefined key would survive
        // spreads as a phantom member.
        hasKey: 'referentialFieldClear' in ctx,
        sessionUserId: ctx.session?.userId,
        data: ctx.input?.data,
    });

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of [acct, noteOptional, watchlistOptionalMulti]) engine.registry.registerObject(o);
    });

    it('scalar set_null clear: true in BOTH phases with the caller identity inherited; the hand-clear control has no key at all', async () => {
        const seen: Cap[] = [];
        engine.on('beforeUpdate', 'note', (ctx: any) => { seen.push(capture(ctx)); });
        engine.on('afterUpdate', 'note', (ctx: any) => { seen.push(capture(ctx)); });
        // One fact, two faces: the same writes, observed on the envelope.
        const ops: Array<{ marker: unknown; data: unknown }> = [];
        engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
            if (opCtx.operation === 'update' && opCtx.object === 'note') {
                ops.push({ marker: opCtx.context?.__referentialFieldClear, data: opCtx.data });
            }
            await next();
        });

        const a = await engine.insert('acct', { name: 'Acme' });
        const n = await engine.insert('note', { body: 'hi', account: a.id });

        // The user's hand-clear of the SAME lookup, under the SAME identity.
        await engine.update('note', { id: n.id, account: null }, { context: { ...CALLER } } as any);
        const hand = seen.splice(0);
        // Restore the reference (and drop that restore's own dispatches) so
        // the cascade below has a dependent to clear — a nulled slot matches
        // no probe and the cleanup write would never be issued.
        await engine.update('note', { id: n.id, account: a.id }, { context: { ...CALLER } } as any);
        seen.splice(0);
        // The engine's cascade when the referenced record is deleted.
        await engine.delete('acct', { where: { id: a.id }, context: { ...CALLER } } as any);
        const cascade = seen.splice(0);

        expect(hand.length).toBe(2);
        for (const o of hand) {
            expect(o.marker, 'hand-clear must not read as a referential cleanup').toBeUndefined();
            expect(o.hasKey, 'the key must be ABSENT on a hand-clear, not present-but-undefined').toBe(false);
            expect(o.sessionUserId).toBe('u1');
        }
        expect(cascade.length).toBe(2);
        expect(cascade.map((o) => o.event)).toEqual(['beforeUpdate', 'afterUpdate']);
        for (const o of cascade) {
            expect(o.marker, 'the cleanup write carries the declared marker').toBe(true);
            // The inherited identity — the very thing that erases every other
            // discriminator — is present alongside the marker.
            expect(o.sessionUserId).toBe('u1');
            expect((o.data as any)?.account, 'and this really is the cleanup write').toBeNull();
        }
        // Consistency: the declared face is true exactly where the envelope
        // carries the operation-private marker, write for write. Three update
        // ops reached the middleware, in order: the hand-clear, the restore,
        // and the engine's cleanup — only the last rides the marked envelope.
        expect(ops.length).toBe(3);
        expect(ops.map((o) => o.marker)).toEqual([undefined, undefined, true]);
        expect((ops[0].data as any)?.account, 'op 1 is the hand-clear').toBeNull();
        expect((ops[1].data as any)?.account, 'op 2 is the restore').toBe(a.id);
        expect((ops[2].data as any)?.account, 'op 3 is the cleanup').toBeNull();
        // And the cleanup landed.
        expect((await engine.findOne('note', { where: { id: n.id } }) as any).account).toBeNull();
    });

    it('multiple:true member removal — the second cleanup write site — carries it identically', async () => {
        const seen: Cap[] = [];
        engine.on('beforeUpdate', 'watchlist', (ctx: any) => { seen.push(capture(ctx)); });
        engine.on('afterUpdate', 'watchlist', (ctx: any) => { seen.push(capture(ctx)); });

        const a = await engine.insert('acct', { name: 'Acme' });
        const b = await engine.insert('acct', { name: 'Beta' });
        const w = await engine.insert('watchlist', { accounts: [a.id, b.id] });

        // Hand-edit of the SAME multi-value lookup under the same identity —
        // the control for THIS write site.
        await engine.update('watchlist', { id: w.id, accounts: [a.id, b.id] }, { context: { ...CALLER } } as any);
        const hand = seen.splice(0);
        await engine.delete('acct', { where: { id: a.id }, context: { ...CALLER } } as any);
        const cascade = seen.splice(0);

        expect(hand.length).toBe(2);
        for (const o of hand) {
            expect(o.marker).toBeUndefined();
            expect(o.hasKey).toBe(false);
        }
        expect(cascade.length).toBe(2);
        expect(cascade.map((o) => o.event)).toEqual(['beforeUpdate', 'afterUpdate']);
        for (const o of cascade) {
            expect(o.marker, 'the member-removal write is a reference-cleanup write too').toBe(true);
            expect(o.sessionUserId).toBe('u1');
            expect((o.data as any)?.accounts, 'and it is the remainder write').toEqual([b.id]);
        }
        expect((await engine.findOne('watchlist', { where: { id: w.id } }) as any).accounts).toEqual([b.id]);
    });

    it('an identity-LESS delete still marks its cleanup writes (the marker does not ride the identity)', async () => {
        // The original card's rig happened to measure exactly this shape (no
        // userId on the DELETE); pinned so the marker provably keys on the
        // operation, not on any identity member the envelope may or may not
        // carry.
        const seen: Cap[] = [];
        engine.on('beforeUpdate', 'note', (ctx: any) => { seen.push(capture(ctx)); });

        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('note', { body: 'hi', account: a.id });
        await engine.delete('acct', { where: { id: a.id } } as any);

        expect(seen.length).toBe(1);
        expect(seen[0].marker).toBe(true);
        expect(seen[0].sessionUserId).toBeUndefined();
    });
});
