// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29180] `listDrafts` refuses a package filter that names no package.
 *
 * `GET /meta/_drafts?packageId=com.qa.nosuch` answered `200 {"drafts":[]}`, a
 * confident "nothing pending" for a package that does not exist, while the
 * diagnostics sweep refuses the same package `400 INVALID_REQUEST` (#27514).
 * The draft list now asks the sweep's own question ({@link packageIsInstalled},
 * exported from `protocol-meta-diagnostics.ts`, not copied): a draft bound to
 * the package is proof enough, and only then the installed-package listing.
 *
 * Both halves are pinned: the refusal (envelope `status` + `code`, and the
 * sentence's first clause, which names the package) beside the controls that
 * must keep answering `200` — an installed package with nothing pending, with
 * or without a `type` filter; an uninstalled package that drafts are bound to;
 * a listing that cannot be read (fail-open); and no package filter at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { listDrafts } from './protocol-drafts.js';

const INSTALLED = 'com.acme.installed';
const UNKNOWN = 'com.qa.nosuch';
/** Not installed, but a draft is bound to it — a real package being authored. */
const AUTHORING = 'com.acme.authoring';

const ROWS = [
    { type: 'dashboard', name: 'sales', label: null, packageId: AUTHORING, updatedAt: null, updatedBy: null },
];

function host(opts: { listing?: () => Promise<unknown> } = {}) {
    const repo = {
        listDrafts: vi.fn(async (q: { type?: string; packageId?: string }) => ROWS.filter((r) =>
            (q.type === undefined || r.type === q.type) && (q.packageId === undefined || r.packageId === q.packageId))),
    };
    const getMetaItems = vi.fn(opts.listing ?? (async () => ({ items: [{ manifest: { id: INSTALLED } }] })));
    const h = {
        engine: undefined,
        ensureOverlayIndex: vi.fn(async () => {}),
        getOverlayRepo: () => repo,
        getMetaItems,
    } as any;
    return { h, repo, getMetaItems };
}

describe('[#29180] listDrafts — a package filter that names no package', () => {
    it('refuses an unknown package with nothing bound to it: 400 INVALID_REQUEST naming it', async () => {
        for (const type of [undefined, 'dashboard']) {
            const { h } = host();
            const err: any = await listDrafts.call(h, { packageId: UNKNOWN, ...(type ? { type } : {}) })
                .then(() => undefined, (e: unknown) => e);
            expect(err, `type=${type}`).toBeInstanceOf(Error);
            expect(err.status).toBe(400);
            expect(err.code).toBe('INVALID_REQUEST');
            expect(String(err.message)).toMatch(new RegExp(`^'${UNKNOWN.replace(/\./g, '\\.')}' is not an installed package,`));
        }
    });

    it('keeps an installed package with nothing pending at 200 empty, with and without a type', async () => {
        for (const type of [undefined, 'dashboard', 'view']) {
            const { h } = host();
            expect(await listDrafts.call(h, { packageId: INSTALLED, ...(type ? { type } : {}) })).toEqual({ drafts: [] });
        }
    });

    it('serves an uninstalled package that drafts are bound to, and judges it on every draft under a type filter', async () => {
        const { h, getMetaItems } = host();
        expect((await listDrafts.call(h, { packageId: AUTHORING })).drafts.map((d) => d.name)).toEqual(['sales']);
        // No `view` draft, but the package is bound by its dashboard draft: empty, not refused.
        expect(await listDrafts.call(h, { packageId: AUTHORING, type: 'view' })).toEqual({ drafts: [] });
        expect(getMetaItems).not.toHaveBeenCalled();
    });

    it('fails OPEN when the installed-package listing cannot be read', async () => {
        const throwing = host({ listing: async () => { throw new Error('store down'); } });
        expect(await listDrafts.call(throwing.h, { packageId: UNKNOWN })).toEqual({ drafts: [] });
        const shapeless = host({ listing: async () => 'nothing readable' });
        expect(await listDrafts.call(shapeless.h, { packageId: UNKNOWN })).toEqual({ drafts: [] });
    });

    it('asks nothing of the package listing when no package is named', async () => {
        const { h, getMetaItems } = host();
        expect(await listDrafts.call(h, { type: 'view' })).toEqual({ drafts: [] });
        expect((await listDrafts.call(h)).drafts).toHaveLength(1);
        expect(getMetaItems).not.toHaveBeenCalled();
    });
});
