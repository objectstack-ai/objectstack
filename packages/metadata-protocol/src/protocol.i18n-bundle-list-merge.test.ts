// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7774] `GET /meta/<type>` keeps every member of an i18n bundle.
 *
 * ---------------------------------------------------------------------------
 * The gap this file pins
 * ---------------------------------------------------------------------------
 * `EmailTemplateDefinitionSchema` declares that "multiple rows with the same
 * `name` but different `locale` form an i18n bundle" and that a template "is
 * resolved by `(name, locale)`". #7730 taught the `SchemaRegistry` that key, so
 * `listItems('email_template')` returns EVERY member. `getMetaItems` then
 * merges that listing with two higher layers, and both merges keyed by
 * `(package, name)` with no discriminator:
 *
 *   • the MetadataService merge — `metaItemKey` in the `itemMap` loops. The
 *     second member's `Map.set` overwrote the first, so the list served one
 *     locale. This is the path the card names.
 *   • the `sys_metadata` overlay merge — `mergePackageAwareOverlay`, which
 *     bucketed by bare `name` and emitted one row per `(bucket, package)`.
 *     The card predicted this half needed NO change, on the (correct) ground
 *     that overlay ROWS are unique on `type+name+organization_id+package_id`
 *     and carry no locale column. The rows were never the problem: the BASE
 *     items are, and they are the registry's bundle. One unrelated overlay row
 *     for the type was enough to drop a locale — and the row that survived was
 *     the overlay body, whichever member it actually customizes.
 *
 * ---------------------------------------------------------------------------
 * Why there was no coverage before
 * ---------------------------------------------------------------------------
 * Both merge blocks are conditional. The MetadataService block runs only when
 * a `metadata` service is installed AND answers non-empty for the type; the
 * overlay block runs only when `sys_metadata` yields at least one active row.
 * A harness that omits either passes against the bug, which is why every case
 * below installs the precondition it needs and the first `describe` asserts
 * the precondition itself.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Restoring `metaItemKey` to its two-component `origin/main` body (dropping
 * the discriminator argument) must turn the bundle cases red naming the
 * collapse — one row where two were served — and must leave the
 * byte-identical-key guards GREEN, because those assert the behaviour of
 * UNDISCRIMINATED types, which the discriminator never touches. A guard that
 * goes red under the revert would mean this change altered a key it promised
 * not to. Measured in the PR body.
 */
import { describe, expect, it } from 'vitest';
// [#7774] The identity table's home is `@objectstack/metadata-core`, not the
// `SchemaRegistry` that first needed it: `@objectstack/objectql` depends on
// THIS package, so importing the registry's copy would close a cycle.
import { ITEM_KEY_DISCRIMINATORS } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PKG = 'com.acme.crm';

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

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

function row(partial: Partial<Row> & { name: string; type: string; metadata: unknown }): Row {
    return {
        id: `row_${partial.type}_${partial.name}_${partial.organization_id ?? 'env'}`,
        organization_id: null,
        package_id: null,
        state: 'active',
        ...partial,
        metadata: JSON.stringify(partial.metadata),
    };
}

/**
 * The registry stub answers `listItems` with the bundle exactly as the real
 * `SchemaRegistry` does since #7730 — every member, each tagged with its
 * owning `_packageId`. It deliberately omits `getArtifactItem`, so
 * `lookupArtifactItem` takes its documented partial-mock fallback.
 */
function makeEngine(opts: { items?: unknown[]; rows?: Row[] } = {}) {
    const registered: Array<{ type: string; name: string }> = [];
    return {
        registered,
        engine: {
            registry: {
                listItems: (type: string, packageId?: string) => {
                    const all = (opts.items ?? []) as any[];
                    const forType = all.filter((i) => i.__type === type);
                    return (packageId ? forType.filter((i) => i._packageId === packageId) : forType)
                        // Strip the harness-only tag so the merge sees a real body.
                        .map(({ __type, ...rest }) => rest);
                },
                isPackageDisabled: () => false,
                registerItem: (type: string, item: any) => { registered.push({ type, name: item?.name }); },
                getItem: () => undefined,
                applyNavContributions: (app: unknown) => app,
            },
            async find(table: string, q: { where: Record<string, unknown> }) {
                if (table !== 'sys_metadata') return [];
                return (opts.rows ?? []).filter((r) => {
                    for (const [k, v] of Object.entries(q.where)) {
                        if (v === undefined) continue;
                        if ((r as any)[k] !== v) return false;
                    }
                    return true;
                });
            },
            async findOne() { return null; },
        } as any,
    };
}

/** A `metadata` service that answers `list(type)` from a fixed table. */
function servicesWithMetadata(byType: Record<string, unknown[]>) {
    return () => new Map<string, any>([
        ['metadata', { list: async (type: string) => byType[type] ?? [] }],
    ]);
}

/** Every `(name, locale)` pair the list served, sorted for stable compare. */
function pairs(items: any[]): string[] {
    return items.map((i) => `${i.name}@${i.locale ?? '(none)'}`).sort();
}

describe('[#7774] the unscoped /meta list keeps every i18n bundle member', () => {
    describe('the preconditions this defect hides behind', () => {
        it('only `email_template` declares a discriminator today', () => {
            // A guard on the blast radius, mirroring objectql's own pin: every
            // other type's merge key is byte-identical to `origin/main`'s
            // precisely because it is absent from this table.
            expect(Object.keys(ITEM_KEY_DISCRIMINATORS)).toEqual(['email_template']);
        });

        it('serves the bundle when NEITHER merge block runs — the case a naive test writes', () => {
            // No `metadata` service and no sys_metadata row: both merges are
            // skipped and the registry listing passes straight through. This
            // case passes on `origin/main` too, and that is the point — it is
            // the shape of harness that made the defect invisible.
            const { engine } = makeEngine({
                items: [
                    { __type: 'email_template', ...tpl('auth.welcome', 'en-US'), _packageId: PKG },
                    { __type: 'email_template', ...tpl('auth.welcome', 'zh-CN'), _packageId: PKG },
                ],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);
            return protocol.getMetaItems({ type: 'email_template' }).then((res) => {
                expect(pairs(res.items as any[])).toEqual(['auth.welcome@en-US', 'auth.welcome@zh-CN']);
            });
        });
    });

    describe('the MetadataService merge (the path the card names)', () => {
        it('keeps both locales when a metadata service answers non-empty', async () => {
            const { engine } = makeEngine({
                items: [
                    { __type: 'email_template', ...tpl('auth.welcome', 'en-US'), _packageId: PKG },
                    { __type: 'email_template', ...tpl('auth.welcome', 'zh-CN'), _packageId: PKG },
                ],
            });
            const protocol = new ObjectStackProtocolImplementation(
                engine,
                // Non-empty for the type — without this the whole block is
                // skipped and the bug cannot reproduce.
                servicesWithMetadata({ email_template: [{ ...tpl('billing.invoice', 'en-US'), _packageId: PKG }] }),
            );

            const res = await protocol.getMetaItems({ type: 'email_template' });
            expect(pairs(res.items as any[])).toEqual([
                'auth.welcome@en-US',
                'auth.welcome@zh-CN',
                'billing.invoice@en-US',
            ]);
        });

        it('lets the service contribute a locale the registry does not ship', async () => {
            // The baseline direction of the same key: a runtime-registered
            // member of an existing bundle is an ADDITION, not a duplicate.
            const { engine } = makeEngine({
                items: [{ __type: 'email_template', ...tpl('auth.welcome', 'en-US'), _packageId: PKG }],
            });
            const protocol = new ObjectStackProtocolImplementation(
                engine,
                servicesWithMetadata({
                    email_template: [
                        { ...tpl('auth.welcome', 'en-US'), _packageId: PKG, _fromService: true },
                        { ...tpl('auth.welcome', 'ja-JP'), _packageId: PKG, _fromService: true },
                    ],
                }),
            );

            const res = await protocol.getMetaItems({ type: 'email_template' });
            expect(pairs(res.items as any[])).toEqual(['auth.welcome@en-US', 'auth.welcome@ja-JP']);
            // The registry's own en-US still wins its slot — the service is a
            // baseline under the registry, never over it.
            const enUs = (res.items as any[]).find((i) => i.locale === 'en-US');
            expect(enUs._fromService).toBeUndefined();
        });
    });

    describe('the sys_metadata overlay merge (the premise the card said needed no change)', () => {
        it('keeps every registry member when ONE overlay row exists for the type', async () => {
            // The overlay customizes zh-CN. en-US is not customized and must
            // still be served — bucketed by bare name it was not.
            const { engine } = makeEngine({
                items: [
                    { __type: 'email_template', ...tpl('auth.welcome', 'en-US'), _packageId: PKG },
                    { __type: 'email_template', ...tpl('auth.welcome', 'zh-CN'), _packageId: PKG },
                ],
                rows: [row({
                    type: 'email_template',
                    name: 'auth.welcome',
                    package_id: PKG,
                    metadata: tpl('auth.welcome', 'zh-CN', { subject: 'CUSTOMIZED zh-CN' }),
                })],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res = await protocol.getMetaItems({ type: 'email_template' });
            expect(pairs(res.items as any[])).toEqual(['auth.welcome@en-US', 'auth.welcome@zh-CN']);
            const byLocale = Object.fromEntries((res.items as any[]).map((i) => [i.locale, i]));
            // …and the overlay landed on ITS OWN member, not on the bundle.
            expect(byLocale['zh-CN'].subject).toBe('CUSTOMIZED zh-CN');
            expect(byLocale['en-US'].subject).toBe('Subject en-US');
        });

        it('does not let an overlay of one locale displace a sibling from another package', async () => {
            const { engine } = makeEngine({
                items: [
                    { __type: 'email_template', ...tpl('auth.welcome', 'en-US'), _packageId: PKG },
                    { __type: 'email_template', ...tpl('auth.welcome', 'zh-CN'), _packageId: 'com.acme.hr' },
                ],
                rows: [row({
                    type: 'email_template',
                    name: 'auth.welcome',
                    package_id: PKG,
                    metadata: tpl('auth.welcome', 'en-US', { subject: 'CUSTOMIZED en-US' }),
                })],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res = await protocol.getMetaItems({ type: 'email_template' });
            expect((res.items as any[]).length).toBe(2);
            const byPkg = Object.fromEntries((res.items as any[]).map((i) => [i._packageId, i]));
            expect(byPkg[PKG].subject).toBe('CUSTOMIZED en-US');
            expect(byPkg['com.acme.hr'].locale).toBe('zh-CN');
        });

        it('keys an env-wide row and an org row of DIFFERENT locales as different slots', async () => {
            // The store's unique index is `(type, name, organization_id,
            // package_id)`, so an org cannot hold two rows differing only by
            // body locale — but the env-wide tier and the org tier can, and
            // keying them together made the org's row displace the env-wide
            // one. Precedence within a member is unchanged; see the next case.
            const { engine } = makeEngine({
                items: [
                    { __type: 'email_template', ...tpl('auth.welcome', 'en-US'), _packageId: PKG },
                    { __type: 'email_template', ...tpl('auth.welcome', 'zh-CN'), _packageId: PKG },
                ],
                rows: [
                    row({
                        type: 'email_template', name: 'auth.welcome', package_id: PKG,
                        organization_id: null,
                        metadata: tpl('auth.welcome', 'en-US', { subject: 'ENV en-US' }),
                    }),
                    row({
                        type: 'email_template', name: 'auth.welcome', package_id: PKG,
                        organization_id: 'org_1',
                        metadata: tpl('auth.welcome', 'zh-CN', { subject: 'ORG zh-CN' }),
                    }),
                ],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res = await protocol.getMetaItems({ type: 'email_template', organizationId: 'org_1' });
            const byLocale = Object.fromEntries((res.items as any[]).map((i) => [i.locale, i]));
            expect(Object.keys(byLocale).sort()).toEqual(['en-US', 'zh-CN']);
            expect(byLocale['en-US'].subject).toBe('ENV en-US');
            expect(byLocale['zh-CN'].subject).toBe('ORG zh-CN');
        });

        it('still lets an org row override the env-wide row of the SAME locale', async () => {
            // ADR-0005 org-over-env precedence, unchanged where it was ever
            // meaningful: two rows of one member still resolve to one row.
            const { engine } = makeEngine({
                items: [{ __type: 'email_template', ...tpl('auth.welcome', 'en-US'), _packageId: PKG }],
                rows: [
                    row({
                        type: 'email_template', name: 'auth.welcome', package_id: PKG,
                        organization_id: null,
                        metadata: tpl('auth.welcome', 'en-US', { subject: 'ENV en-US' }),
                    }),
                    row({
                        type: 'email_template', name: 'auth.welcome', package_id: PKG,
                        organization_id: 'org_1',
                        metadata: tpl('auth.welcome', 'en-US', { subject: 'ORG en-US' }),
                    }),
                ],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res = await protocol.getMetaItems({ type: 'email_template', organizationId: 'org_1' });
            expect((res.items as any[]).length).toBe(1);
            expect((res.items as any[])[0].subject).toBe('ORG en-US');
        });

        it('treats a member that declares no locale as the canonical member', async () => {
            // `locale` has a schema default of `en-US`; an author who omits it
            // is authoring the canonical member, and an en-US overlay must
            // land on it rather than beside it.
            const { engine } = makeEngine({
                items: [{ __type: 'email_template', ...tpl('auth.welcome', undefined), _packageId: PKG }],
                rows: [row({
                    type: 'email_template', name: 'auth.welcome', package_id: PKG,
                    metadata: tpl('auth.welcome', 'en-US', { subject: 'CUSTOMIZED en-US' }),
                })],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res = await protocol.getMetaItems({ type: 'email_template' });
            expect((res.items as any[]).length).toBe(1);
            expect((res.items as any[])[0].subject).toBe('CUSTOMIZED en-US');
        });
    });

    describe('the draft-preview merge', () => {
        it('previews a draft of one locale without dropping its siblings', async () => {
            const { engine } = makeEngine({
                items: [
                    { __type: 'email_template', ...tpl('auth.welcome', 'en-US'), _packageId: PKG },
                    { __type: 'email_template', ...tpl('auth.welcome', 'zh-CN'), _packageId: PKG },
                ],
                rows: [row({
                    type: 'email_template', name: 'auth.welcome', package_id: PKG, state: 'draft',
                    metadata: tpl('auth.welcome', 'zh-CN', { subject: 'DRAFT zh-CN' }),
                })],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res = await protocol.getMetaItems({ type: 'email_template', previewDrafts: true });
            const byLocale = Object.fromEntries((res.items as any[]).map((i) => [i.locale, i]));
            expect(Object.keys(byLocale).sort()).toEqual(['en-US', 'zh-CN']);
            expect(byLocale['zh-CN'].subject).toBe('DRAFT zh-CN');
            expect(byLocale['zh-CN']._draft).toBe(true);
            expect(byLocale['en-US']._draft).toBeUndefined();
        });
    });

    describe('undiscriminated types keep a byte-identical key', () => {
        it('ADR-0048: two packages shipping `page/home` stay two rows through the service merge', async () => {
            const { engine } = makeEngine({
                items: [
                    { __type: 'page', name: 'home', _packageId: PKG },
                    { __type: 'page', name: 'home', _packageId: 'com.acme.hr' },
                ],
            });
            const protocol = new ObjectStackProtocolImplementation(
                engine,
                servicesWithMetadata({ page: [{ name: 'about', _packageId: PKG }] }),
            );

            const res = await protocol.getMetaItems({ type: 'page' });
            expect((res.items as any[]).map((i) => `${i._packageId}/${i.name}`).sort())
                .toEqual([`${PKG}/about`, `${PKG}/home`, 'com.acme.hr/home']);
        });

        it('ADR-0048: an overlay row still collapses onto its own package slot', async () => {
            const { engine } = makeEngine({
                items: [
                    { __type: 'page', name: 'home', _packageId: PKG, title: 'code' },
                    { __type: 'page', name: 'home', _packageId: 'com.acme.hr', title: 'code' },
                ],
                rows: [row({ type: 'page', name: 'home', package_id: PKG, metadata: { name: 'home', title: 'overlay' } })],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res = await protocol.getMetaItems({ type: 'page' });
            expect((res.items as any[]).length).toBe(2);
            const byPkg = Object.fromEntries((res.items as any[]).map((i) => [i._packageId, i.title]));
            expect(byPkg).toEqual({ [PKG]: 'overlay', 'com.acme.hr': 'code' });
        });

        it('a same-name page in one package is still ONE row, not two', async () => {
            // The complement of the bundle cases: without a discriminator two
            // same-name rows of one package are a genuine collision and must
            // still resolve to one row. A slot key that leaked into every type
            // would break exactly this.
            const { engine } = makeEngine({
                items: [
                    { __type: 'page', name: 'home', _packageId: PKG, title: 'first' },
                    { __type: 'page', name: 'home', _packageId: PKG, title: 'second' },
                ],
                rows: [row({ type: 'page', name: 'home', package_id: PKG, metadata: { name: 'home', title: 'overlay' } })],
            });
            const protocol = new ObjectStackProtocolImplementation(engine);

            const res = await protocol.getMetaItems({ type: 'page' });
            expect((res.items as any[]).length).toBe(1);
            expect((res.items as any[])[0].title).toBe('overlay');
        });
    });
});
