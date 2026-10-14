// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23183, ADR-0048 §3.1] `getMetaItem` answers the app read keyed by PACKAGE
 * ID, as `GetMetaItemRequestSchema.name` declares.
 *
 * ADR-0048 §3.1 makes the package id the app's route key ("With the current
 * one-app-per-package invariant, the app *is* the package container"), so the
 * console addresses an app at `/apps/<packageId>`. No declared read answered an
 * app by that key: `/meta/app/com.acme.crm` asked for an app NAMED
 * `com.acme.crm` and was answered absence whether the package's app existed,
 * was withheld, or was missing.
 *
 * The producer resolves the key once (`resolveAppPackageIdKey`), so both
 * transports' item reads reach it with no code of their own; their wire
 * answers are pinned in `@objectstack/runtime`'s
 * `meta-app-package-id-key.test.ts`. This file pins the producer:
 *
 *  1. one app in the package: the package's app, under its own name, the same
 *     item the by-name read serves (the plural type spelling included);
 *  2. the by-name read is unchanged;
 *  3. no app, an unknown package, and more than one app: absence (the last
 *     told to the operator once, never answered differently);
 *  4. a `packageId` naming a different package: `400 INVALID_REQUEST`;
 *  5. a key in the package-id grammar on another type: read by name;
 *  6. drafts are in view exactly when the read reads drafts.
 *
 * The engine double is `protocol.list-slot-prefer-local.test.ts`'s: `find` /
 * `findOne` over `sys_metadata` rows, and a registry answering a
 * package-scoped lookup with that package's items only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const CRM_PKG = 'com.acme.crm';
const CRM_APP = { name: 'crm', label: 'CRM', navigation: [], _packageId: CRM_PKG, _provenance: 'package' };
/** A package that breaks ADR-0019 D3's at-most-one rule. */
const SUITE_PKG = 'com.acme.suite';
const SUITE_APPS = [
    { name: 'suite_sales', label: 'Sales', navigation: [], _packageId: SUITE_PKG, _provenance: 'package' },
    { name: 'suite_service', label: 'Service', navigation: [], _packageId: SUITE_PKG, _provenance: 'package' },
];
/** A package that ships no app. */
const LIB_PKG = 'com.acme.lib';
/** A package whose only app is a pending draft row — authored, never published. */
const DRAFT_PKG = 'com.acme.drafted';
const DRAFT_APP_NAME = 'drafted';
/**
 * A `view` whose name is in the package-id grammar (`<object>.<viewKey>`), and
 * a package of that very id shipping an app: if the arm fired on `view`, the
 * read would resolve that package and miss the view.
 */
const VIEW_KEY = 'account.pipeline';
const VIEW_ITEM = { name: VIEW_KEY, label: 'Pipeline', object: 'account', viewKind: 'list', _packageId: 'com.acme.views', _provenance: 'package' };
const SHADOW_APP = { name: 'pipeline_app', label: 'Pipeline app', navigation: [], _packageId: VIEW_KEY, _provenance: 'package' };

interface StoredRow {
    id: string;
    type: string;
    name: string;
    package_id: string | null;
    state: string;
    metadata: string;
}

const STORED: StoredRow[] = [{
    id: 'r_drafted_draft',
    type: 'app',
    name: DRAFT_APP_NAME,
    package_id: DRAFT_PKG,
    state: 'draft',
    metadata: JSON.stringify({ name: DRAFT_APP_NAME, label: 'Drafted', navigation: [] }),
}];

function harness() {
    const items: Array<Record<string, unknown> & { name: string }> = [CRM_APP, ...SUITE_APPS, VIEW_ITEM, SHADOW_APP];
    const typeOf = (item: Record<string, unknown>) => (item === VIEW_ITEM ? 'view' : 'app');
    const ofType = (asked: string, packageId?: string) =>
        items.filter((i) => typeOf(i) === asked && (!packageId || i._packageId === packageId));
    const registry = {
        getArtifactItem(asked: string, name: string, packageId?: string) {
            const hit = ofType(asked, packageId).find((i) => i.name === name);
            return hit && isCodeArtifactBody(hit) ? hit : undefined;
        },
        getItem(asked: string, name: string, packageId?: string) {
            return ofType(asked, packageId).find((i) => i.name === name);
        },
        listItems(asked: string, packageId?: string) {
            return ofType(asked, packageId);
        },
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return STORED.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
        );
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where ?? {});
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return matching(opts?.where ?? {})[0] ?? null;
        },
        async insert() {
            return {};
        },
        registry,
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_1');
}

/** The envelope's item, with nothing but its identity read off it. */
const itemName = (envelope: any): unknown => envelope?.item?.name;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('[#23183] getMetaItem answers an app keyed by its package id (ADR-0048 §3.1)', () => {
    it('one app in the package: that app, under its own name — the item the by-name read serves', async () => {
        const protocol = harness();
        const byPackage: any = await protocol.getMetaItem({ type: 'app', name: CRM_PKG });
        const byName: any = await protocol.getMetaItem({ type: 'app', name: 'crm' });

        expect(byPackage.type).toBe('app');
        // The envelope names the app by its own name: the address a save of it
        // uses, never the key it was asked by.
        expect(byPackage.name).toBe('crm');
        expect(itemName(byPackage)).toBe('crm');
        expect(byPackage.item._packageId).toBe(CRM_PKG);
        expect(byPackage.item).toEqual(byName.item);
    });

    it('the plural type spelling is folded first, so `apps` reaches the arm too', async () => {
        const protocol = harness();
        const envelope: any = await protocol.getMetaItem({ type: 'apps', name: CRM_PKG });
        expect(envelope.type).toBe('app');
        expect(itemName(envelope)).toBe('crm');
    });

    it('the by-name read is unchanged: an app name is never in the package-id grammar', async () => {
        const protocol = harness();
        const envelope: any = await protocol.getMetaItem({ type: 'app', name: 'crm' });
        expect(envelope.name).toBe('crm');
        expect(itemName(envelope)).toBe('crm');
    });

    it('a package that ships no app, and a package nobody installed: absence', async () => {
        const protocol = harness();
        for (const key of [LIB_PKG, 'com.acme.missing']) {
            const envelope: any = await protocol.getMetaItem({ type: 'app', name: key });
            expect(envelope.item, key).toBeUndefined();
        }
    });

    it('a package holding more than one app: absence, and the operator is told once, naming the package and its apps', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const protocol = harness();

        const first: any = await protocol.getMetaItem({ type: 'app', name: SUITE_PKG });
        const second: any = await protocol.getMetaItem({ type: 'app', name: SUITE_PKG });
        expect(first.item).toBeUndefined();
        expect(second.item).toBeUndefined();

        const reports = warn.mock.calls.map((args) => String(args[0])).filter((line) => line.includes(SUITE_PKG));
        expect(reports).toHaveLength(1);
        for (const app of SUITE_APPS) expect(reports[0]).toContain(app.name);
        // Each app stays readable by its own name.
        for (const app of SUITE_APPS) {
            expect(itemName(await protocol.getMetaItem({ type: 'app', name: app.name }))).toBe(app.name);
        }
    });

    it('a packageId naming a different package is refused 400 INVALID_REQUEST; the same package is the same read', async () => {
        const protocol = harness();
        await expect(protocol.getMetaItem({ type: 'app', name: CRM_PKG, packageId: SUITE_PKG }))
            .rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 });

        const same: any = await protocol.getMetaItem({ type: 'app', name: CRM_PKG, packageId: CRM_PKG });
        expect(itemName(same)).toBe('crm');
    });

    it('a key in the package-id grammar on another type is read by name, even where a package of that id ships an app', async () => {
        const protocol = harness();
        const envelope: any = await protocol.getMetaItem({ type: 'view', name: VIEW_KEY });
        expect(envelope.name).toBe(VIEW_KEY);
        expect(itemName(envelope)).toBe(VIEW_KEY);
    });

    it('drafts are in view exactly when the read reads drafts: a draft-only app resolves on the draft read, not on the plain one', async () => {
        const protocol = harness();

        const draft: any = await protocol.getMetaItem({ type: 'app', name: DRAFT_PKG, state: 'draft' });
        expect(draft.name).toBe(DRAFT_APP_NAME);
        expect(itemName(draft)).toBe(DRAFT_APP_NAME);

        const plain: any = await protocol.getMetaItem({ type: 'app', name: DRAFT_PKG });
        expect(plain.item).toBeUndefined();
    });
});
