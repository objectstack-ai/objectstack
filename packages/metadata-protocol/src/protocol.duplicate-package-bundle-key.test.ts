// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7932] `duplicatePackage` copies every member of an i18n bundle.
 *
 * ---------------------------------------------------------------------------
 * The gap this file pins
 * ---------------------------------------------------------------------------
 * `duplicatePackage`'s source-row scan dedups the scanned `sys_metadata` rows
 * with a `NUL`-separated key built from the row's `type` and `name` only,
 * keeping the org-scoped row over the env-wide one (#7819 tier 2 added the
 * dedup when it widened the scan to `organization_id IS NULL`). That key is
 * `(type, name)` with no discriminator, so for a type whose identity the spec
 * declares as a PAIR it collapses two rows that are two different things.
 *
 * `email_template` is such a type: `EmailTemplateDefinitionSchema` states that
 * multiple rows with the same `name` but different `locale` form an i18n
 * bundle, resolved by `(name, locale)`.
 *
 * ---------------------------------------------------------------------------
 * Why the exposure is narrow, and why it is nevertheless real
 * ---------------------------------------------------------------------------
 * `sys_metadata`'s overlay uniqueness is `idx_sys_metadata_overlay_active` =
 * `(type, name, organization_id, package_id)`, and the table has NO locale
 * column — an `email_template`'s locale lives in the `metadata` JSON body. So
 * within ONE org two rows differing only by body locale cannot exist, and no
 * collapse is possible. Across the env-wide (`organization_id IS NULL`) and org
 * tiers they can, and this scan is the one place the two tiers meet: an
 * env-wide `auth.welcome` customized in `en-US` plus an org-scoped
 * `auth.welcome` customized in `zh-CN` are two distinct bundle members, and the
 * scan kept only the org one. The duplicated package then shipped ONE locale of
 * a two-locale customization, reporting `success: true`.
 *
 * Registry-shipped (code-authored) members are unaffected — this scan reads
 * `sys_metadata` overlays only — so the exposure is limited to templates
 * customized at BOTH scopes.
 *
 * ---------------------------------------------------------------------------
 * Why there was no coverage before
 * ---------------------------------------------------------------------------
 * The dedup block is conditional on `request.organizationId`, and the collapse
 * needs a source package holding the SAME `(type, name)` at both tiers. Every
 * existing `duplicatePackage` suite drives either the no-org door (where the
 * block never runs) or a one-row-per-name fixture, so all of them pass against
 * the bug. `package-duplicate-adopt-org-scope.integration.test.ts` is the
 * closest — it drives the two tiers on a real SqlDriver — and it uses distinct
 * names per tier, which is exactly the shape that cannot see this.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Re-introducing the undiscriminated key (dropping the `disc` component, so the
 * key is `type NUL name` again) must turn the bundle cases RED naming the
 * collapse — one copied row where two were expected — and must leave the
 * byte-identical-key guards GREEN, because those assert the behaviour of
 * UNDISCRIMINATED types, which the discriminator never touches. A guard that
 * goes red under the revert would mean this change altered a key it promised
 * not to. The precedence cases must also stay GREEN: they assert org-over-env
 * for the SAME member, which both keys agree on. Measured per arm in the PR.
 */
import { describe, expect, it, vi } from 'vitest';
// [#7774] The identity table's home is `@objectstack/metadata-core`, not the
// `SchemaRegistry` that first needed it: `@objectstack/objectql` depends on
// THIS package, so importing the registry's copy would close a cycle.
import { ITEM_KEY_DISCRIMINATORS } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SRC = 'app.iojn';
const TGT = 'app.iojn2';
const ORG = 'org_acme';

/** A spec-shaped email template body; `locale` is supplied per case. */
function tpl(name: string, locale: string | undefined, extra: Record<string, unknown> = {}) {
    return {
        name,
        label: `Label ${locale ?? '(default)'}`,
        subject: `Subject ${locale ?? '(default)'}`,
        bodyHtml: `<p>${locale ?? '(default)'}</p>`,
        ...(locale === undefined ? {} : { locale }),
        ...extra,
    };
}

/**
 * `where` matcher that understands the `$or` the org-scoped scan adds — the
 * widened scope is the precondition for the collapse, so a harness that
 * silently ignored `$or` would return every row and prove nothing.
 */
function matches(r: Record<string, any>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if (k === '$or') {
            const clauses = (v ?? []) as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matches(r, c))) return false;
            continue;
        }
        if ((r[k] ?? null) !== v) return false;
    }
    return true;
}

/**
 * Protocol over a stub engine. `getPackage` answers undefined so the manifest
 * re-install branch is skipped — this suite is about the row scan, and the
 * source namespace still resolves from the package id (`app.iojn` → `iojn`).
 */
function makeProtocol(rows: Array<Record<string, any>>) {
    const seeded = rows.map((r, i) => ({
        id: `r_${i + 1}`,
        organization_id: null,
        package_id: SRC,
        state: 'active',
        checksum: `sha256:seed_${i + 1}`,
        ...r,
        metadata: typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata),
    }));
    const engine: any = {
        find: vi.fn(async (_t: string, opts?: { where?: Record<string, unknown> }) =>
            seeded.filter((r) => matches(r, opts?.where ?? {}))),
        registry: { getPackage: vi.fn(() => undefined) },
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map());
    const saveMetaItem = vi.spyOn(protocol, 'saveMetaItem' as never);
    (saveMetaItem as any).mockResolvedValue({ success: true } as never);
    return { protocol, saveMetaItem };
}

/** Every row the copy actually wrote, as `type/name@locale→scope`, sorted. */
function written(saveMetaItem: unknown): string[] {
    return ((saveMetaItem as any).mock.calls as any[])
        .map((c) => c[0])
        .map((w) => {
            const locale = (w.item as { locale?: unknown } | null)?.locale;
            return `${w.type}/${w.name}@${typeof locale === 'string' ? locale : '(none)'}`
                + `→${w.organizationId ?? 'env'}`;
        })
        .sort();
}

/** The `label` each written row carried — which BODY survived the dedup. */
function labels(saveMetaItem: unknown): string[] {
    return ((saveMetaItem as any).mock.calls as any[])
        .map((c) => (c[0].item as { label?: unknown } | null)?.label)
        .map((l) => String(l))
        .sort();
}

const duplicate = (protocol: any, organizationId?: string) => protocol.duplicatePackage({
    sourcePackageId: SRC,
    targetPackageId: TGT,
    targetNamespace: 'iojn2',
    ...(organizationId ? { organizationId } : {}),
});

describe('[#7932] duplicatePackage keeps every i18n bundle member', () => {
    describe('the preconditions this defect hides behind', () => {
        it('only `email_template` declares a discriminator today', () => {
            // A guard on the blast radius, mirroring objectql's own pin: every
            // other type's dedup key is byte-identical to `origin/main`'s
            // precisely because it is absent from this table.
            expect(Object.keys(ITEM_KEY_DISCRIMINATORS)).toEqual(['email_template']);
        });

        it('the dedup block does not run at all on the no-org door', async () => {
            // Without `organizationId` there is no `$or`, no dedup, and every
            // scanned row is copied verbatim. That door is deliberately left
            // byte-identical by this change, exactly as #7819 tier 2 left it.
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'email_template', name: 'auth.welcome', metadata: tpl('auth.welcome', 'en-US') },
                {
                    type: 'email_template', name: 'auth.welcome', organization_id: ORG,
                    metadata: tpl('auth.welcome', 'zh-CN'),
                },
            ]);

            const res = await duplicate(protocol);

            expect(res).toMatchObject({ success: true, copiedCount: 2, failedCount: 0 });
            expect(written(saveMetaItem)).toEqual([
                'email_template/auth.welcome@en-US→env',
                'email_template/auth.welcome@zh-CN→env',
            ]);
        });
    });

    describe('the defect — two tiers customizing DIFFERENT members of one bundle', () => {
        it('copies BOTH locales, each into the scope of the row it came from', async () => {
            // ⭐ The case the card measured. Before the fix this answered
            // `copiedCount: 1` — the org `zh-CN` row displaced the env-wide
            // `en-US` one, and the duplicate shipped one locale of a two-locale
            // customization while reporting success.
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'email_template', name: 'auth.welcome', metadata: tpl('auth.welcome', 'en-US') },
                {
                    type: 'email_template', name: 'auth.welcome', organization_id: ORG,
                    metadata: tpl('auth.welcome', 'zh-CN'),
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 2, failedCount: 0 });
            expect(written(saveMetaItem)).toEqual([
                'email_template/auth.welcome@en-US→env',
                `email_template/auth.welcome@zh-CN→${ORG}`,
            ]);
        });

        it('keeps a three-member bundle split across the two tiers', async () => {
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'email_template', name: 'auth.welcome', metadata: tpl('auth.welcome', 'en-US') },
                { type: 'email_template', name: 'auth.welcome', metadata: tpl('auth.welcome', 'ja-JP') },
                {
                    type: 'email_template', name: 'auth.welcome', organization_id: ORG,
                    metadata: tpl('auth.welcome', 'zh-CN'),
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 3, failedCount: 0 });
            expect(written(saveMetaItem)).toEqual([
                'email_template/auth.welcome@en-US→env',
                'email_template/auth.welcome@ja-JP→env',
                `email_template/auth.welcome@zh-CN→${ORG}`,
            ]);
        });

        it('a member with NO locale is the canonical member, not a fourth slot', async () => {
            // `itemDiscriminator` keys a declared-nothing member as `canonical`
            // (`en-US`), so the bundle-blind and bundle-aware answers agree for
            // a single-member "bundle" — an env-wide row declaring no locale and
            // an org row declaring `en-US` are the SAME member, and collapse.
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'email_template', name: 'auth.welcome', metadata: tpl('auth.welcome', undefined) },
                {
                    type: 'email_template', name: 'auth.welcome', organization_id: ORG,
                    metadata: tpl('auth.welcome', 'en-US'),
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 1, failedCount: 0 });
            expect(written(saveMetaItem)).toEqual([
                `email_template/auth.welcome@en-US→${ORG}`,
            ]);
        });
    });

    describe('precedence — unchanged everywhere it was ever meaningful', () => {
        it('the org row still overrides the env-wide row of the SAME member', async () => {
            // ⭐ The guard that catches an over-split. A key change is trivially
            // satisfiable by splitting keys that should merge; this is the case
            // that refuses that shortcut.
            const { protocol, saveMetaItem } = makeProtocol([
                {
                    type: 'email_template', name: 'auth.welcome',
                    metadata: tpl('auth.welcome', 'en-US', { label: 'ENV-WIDE' }),
                },
                {
                    type: 'email_template', name: 'auth.welcome', organization_id: ORG,
                    metadata: tpl('auth.welcome', 'en-US', { label: 'ORG-OVERRIDE' }),
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 1, failedCount: 0 });
            expect(labels(saveMetaItem)).toEqual(['ORG-OVERRIDE']);
        });

        it('overrides the matching member and leaves the others alone', async () => {
            // Both halves in one fixture: `en-US` exists at both tiers and the
            // org body wins it; `ja-JP` exists only env-wide and survives
            // untouched; `zh-CN` exists only org-side and is carried over.
            const { protocol, saveMetaItem } = makeProtocol([
                {
                    type: 'email_template', name: 'auth.welcome',
                    metadata: tpl('auth.welcome', 'en-US', { label: 'ENV-WIDE en' }),
                },
                {
                    type: 'email_template', name: 'auth.welcome',
                    metadata: tpl('auth.welcome', 'ja-JP', { label: 'ENV-WIDE ja' }),
                },
                {
                    type: 'email_template', name: 'auth.welcome', organization_id: ORG,
                    metadata: tpl('auth.welcome', 'en-US', { label: 'ORG en' }),
                },
                {
                    type: 'email_template', name: 'auth.welcome', organization_id: ORG,
                    metadata: tpl('auth.welcome', 'zh-CN', { label: 'ORG zh' }),
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 3, failedCount: 0 });
            expect(labels(saveMetaItem)).toEqual(['ENV-WIDE ja', 'ORG en', 'ORG zh']);
            expect(written(saveMetaItem)).toEqual([
                `email_template/auth.welcome@en-US→${ORG}`,
                'email_template/auth.welcome@ja-JP→env',
                `email_template/auth.welcome@zh-CN→${ORG}`,
            ]);
        });
    });

    describe('byte-identical keys for every undiscriminated type', () => {
        it('a same-name `page` at both tiers still dedups to ONE row, org winning', async () => {
            // ⭐ `page` is absent from `ITEM_KEY_DISCRIMINATORS`, so
            // `storedRowDiscriminator` returns `undefined` before any JSON work
            // and the key is the exact two-component string it has always been.
            // This case is what proves nothing was changed that was promised
            // unchanged — it must stay GREEN under the reverse-verification.
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'page', name: 'home', metadata: { name: 'home', label: 'ENV-WIDE' } },
                {
                    type: 'page', name: 'home', organization_id: ORG,
                    metadata: { name: 'home', label: 'ORG-OVERRIDE' },
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 1, failedCount: 0 });
            expect(labels(saveMetaItem)).toEqual(['ORG-OVERRIDE']);
        });

        it('a `page` carrying a locale-ish body key is STILL undiscriminated', async () => {
            // The table is declared per type rather than duck-typed off a
            // `locale` property precisely so that another type growing such a
            // field is not silently re-keyed. Two `page/home` rows collapse to
            // one even though their bodies disagree on `locale`.
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'page', name: 'home', metadata: { name: 'home', locale: 'en-US', label: 'ENV-WIDE' } },
                {
                    type: 'page', name: 'home', organization_id: ORG,
                    metadata: { name: 'home', locale: 'zh-CN', label: 'ORG-OVERRIDE' },
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 1, failedCount: 0 });
            expect(labels(saveMetaItem)).toEqual(['ORG-OVERRIDE']);
        });

        it('two DIFFERENT types sharing one name never collapse', async () => {
            // The key's FIRST component. ADR-0048's package dimension is carried
            // at this site by the scan filter rather than by the key (every
            // scanned row shares `package_id = sourcePackageId`), so `type` is
            // the separating component the dedup itself owns.
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'page', name: 'home', metadata: { name: 'home', label: 'PAGE env' } },
                {
                    type: 'page', name: 'home', organization_id: ORG,
                    metadata: { name: 'home', label: 'PAGE org' },
                },
                { type: 'dashboard', name: 'home', metadata: { name: 'home', label: 'DASHBOARD env' } },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 2, failedCount: 0 });
            expect(labels(saveMetaItem)).toEqual(['DASHBOARD env', 'PAGE org']);
        });

        it("ADR-0048 — another package's same-name row is never scanned", async () => {
            // The package dimension at this site: the scan is keyed on
            // `package_id = sourcePackageId`, so a second package shipping
            // `page/home` is out of scope for the copy entirely rather than
            // deduped against it.
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'page', name: 'home', metadata: { name: 'home', label: 'SOURCE PKG' } },
                {
                    type: 'page', name: 'home', package_id: 'app.other',
                    metadata: { name: 'home', label: 'OTHER PKG' },
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 1, failedCount: 0 });
            expect(labels(saveMetaItem)).toEqual(['SOURCE PKG']);
        });

        it('an email_template bundle and an undiscriminated type in ONE copy', async () => {
            // The two behaviours composing in a single duplication: the bundle
            // splits into its members, the `page` still collapses to one.
            const { protocol, saveMetaItem } = makeProtocol([
                { type: 'email_template', name: 'auth.welcome', metadata: tpl('auth.welcome', 'en-US') },
                {
                    type: 'email_template', name: 'auth.welcome', organization_id: ORG,
                    metadata: tpl('auth.welcome', 'zh-CN'),
                },
                { type: 'page', name: 'home', metadata: { name: 'home', label: 'ENV-WIDE' } },
                {
                    type: 'page', name: 'home', organization_id: ORG,
                    metadata: { name: 'home', label: 'ORG-OVERRIDE' },
                },
            ]);

            const res = await duplicate(protocol, ORG);

            expect(res).toMatchObject({ success: true, copiedCount: 3, failedCount: 0 });
            expect(written(saveMetaItem)).toEqual([
                'email_template/auth.welcome@en-US→env',
                `email_template/auth.welcome@zh-CN→${ORG}`,
                `page/home@(none)→${ORG}`,
            ]);
        });
    });
});
