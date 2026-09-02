// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reference-spelling contract of `resolveMasterDetailRelation` — three
 * spellings, three different answers, pinned so none of them can drift
 * silently.
 *
 * The module accepts the canonical `reference` and the REJECTED alias
 * `referenceTo`, and reads the OTHER rejected alias `reference_to` not at all.
 * That asymmetry is deliberate and is the thing most likely to be "tidied" by
 * someone who notices only that a sibling reader (`resolveCbpRelation` in
 * `plugin-security`) accepts all three: the ADR-0087 conversion layer already
 * normalises `reference_to` on stored rehydration and on `os migrate meta`,
 * and deliberately does not normalise `referenceTo`. So the one spelling that
 * can arrive here unconverted is exactly the one this reader accepts. Pinning
 * the asymmetry as a RECORD is the point — a test that only checked the happy
 * path would let either half move without a failure.
 *
 * The loud half is pinned the same way `plugin-security`'s is: the report must
 * name the key that ACTUALLY answered, so the diagnostic and the resolution
 * can never disagree about which spelling was read.
 *
 * Imported relatively (`./master-detail.js`), i.e. from source through vitest's
 * own resolution — no `dist/` leg, so an ablation of the loud line shows up
 * here without a rebuild.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveMasterDetailRelation } from './master-detail.js';
import { SchemaRegistry } from './registry.js';

/** An object shape with one `master_detail` field spelled however the case needs. */
function detailObject(name: string, key: string, master = 'crm_account') {
    return {
        name,
        label: name,
        fields: {
            id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
            account_id: { type: 'master_detail', label: 'Account', [key]: master },
        },
    } as never;
}

describe('resolveMasterDetailRelation — the reference spelling it reads, and what it says about it', () => {
    it('canonical `reference` resolves, and says NOTHING — the quiet path stays quiet', () => {
        const warn = vi.fn();
        const rel = resolveMasterDetailRelation(detailObject('canon_detail', 'reference'), { warn });

        expect(rel).toEqual({ fk: 'account_id', master: 'crm_account' });
        expect(warn).not.toHaveBeenCalled();
    });

    it('`referenceTo` resolves TOO — the tolerance is real, not a leftover type key', () => {
        const warn = vi.fn();
        const rel = resolveMasterDetailRelation(detailObject('alias_detail', 'referenceTo'), { warn });

        expect(rel).toEqual({ fk: 'account_id', master: 'crm_account' });
    });

    it('...and it is LOUD when it does: the report names the spelling that answered', () => {
        const warn = vi.fn();
        resolveMasterDetailRelation(detailObject('loud_detail', 'referenceTo'), { warn });

        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0]?.[0]);
        // The key that answered, the field it sat on, and the object — the
        // three facts an author needs to find and rename it.
        expect(msg).toContain('`referenceTo`');
        expect(msg).toContain('"loud_detail"');
        expect(msg).toContain('"account_id"');
        // ...and the half an operator needs so they do not go hunting an
        // outage that did not happen.
        expect(msg).toContain('UNAFFECTED');
    });

    it('⛔ snake_case `reference_to` is NOT read here — the asymmetry with plugin-security is a record, not an oversight', () => {
        const warn = vi.fn();
        const rel = resolveMasterDetailRelation(detailObject('snake_detail', 'reference_to'), { warn });

        // No relation at all: this reader never had a `reference_to` arm, and
        // the conversion layer is what serves that spelling (to `reference`)
        // before a stored row ever reaches here.
        expect(rel).toBeNull();
        // ...and nothing is reported, because nothing resolved from an alias.
        expect(warn).not.toHaveBeenCalled();
    });

    it('an un-injected host still hears it — the default sink is `console.warn`', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            resolveMasterDetailRelation(detailObject('default_sink_detail', 'referenceTo'));
            expect(spy).toHaveBeenCalledTimes(1);
            expect(String(spy.mock.calls[0]?.[0])).toContain('[objectql/reference-spelling]');
        } finally {
            spy.mockRestore();
        }
    });

    it('reports ONCE per object+field+spelling — the write path must not become a noise channel', () => {
        const warn = vi.fn();
        const schema = detailObject('repeat_detail', 'referenceTo');
        for (let i = 0; i < 5; i++) resolveMasterDetailRelation(schema, { warn });

        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('canonical WINS over the alias when both are present, and stays quiet', () => {
        const warn = vi.fn();
        const rel = resolveMasterDetailRelation({
            name: 'both_detail',
            fields: {
                account_id: {
                    type: 'master_detail',
                    reference: 'crm_account',
                    referenceTo: 'crm_stale_legacy',
                },
            },
        } as never, { warn });

        expect(rel).toEqual({ fk: 'account_id', master: 'crm_account' });
        expect(warn).not.toHaveBeenCalled();
    });

    it('a present-but-EMPTY `reference` does not fall through to the alias — the `??` semantics are unchanged', () => {
        const warn = vi.fn();
        const rel = resolveMasterDetailRelation({
            name: 'empty_canon_detail',
            fields: {
                account_id: { type: 'master_detail', reference: '   ', referenceTo: 'crm_account' },
            },
        } as never, { warn });

        // `a ?? b` falls through on null/undefined ONLY, so the empty canonical
        // key still wins the read and still yields no usable name.
        expect(rel).toBeNull();
        expect(warn).not.toHaveBeenCalled();
    });

    it('two masters stay ambiguous, and report nothing — a relation that did not resolve has no spelling to name', () => {
        const warn = vi.fn();
        const rel = resolveMasterDetailRelation({
            name: 'junction_detail',
            fields: {
                left_id: { type: 'master_detail', referenceTo: 'crm_account' },
                right_id: { type: 'master_detail', referenceTo: 'crm_contact' },
            },
        } as never, { warn });

        expect(rel).toBeNull();
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('the path that makes the tolerance reachable at all', () => {
    it('a raw `registerObject` carries `referenceTo` verbatim into the registry, and this reader then resolves it', () => {
        // The reachability claim the module doc records, measured rather than
        // asserted: `registerObject` skips Zod by design, so the rejected alias
        // survives registration, and every caller of this resolver reads the
        // schema back out of this same registry.
        const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            registry.registerObject(detailObject('raw_registered_detail', 'referenceTo'));
        } finally {
            consoleWarn.mockRestore();
        }

        const served = registry.getObject('raw_registered_detail') as
            { fields?: Record<string, Record<string, unknown>> } | undefined;
        expect(served?.fields?.account_id?.referenceTo).toBe('crm_account');
        expect(served?.fields?.account_id?.reference).toBeUndefined();

        const warn = vi.fn();
        expect(resolveMasterDetailRelation(served as never, { warn })).toEqual({
            fk: 'account_id',
            master: 'crm_account',
        });
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
