// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29985 codemod] The "Discovery, types, diagnostics, packaged bases,
 * credential carry-forward" facet of `ObjectStackProtocolImplementation`: the
 * bodies of `getProjectId`, `getMetaTypes`, `getPackagedObjectBase`,
 * `getPackagedDashboardBase`, `getPackagedViewBase`, `getPackagedReportBase`,
 * `packagedArtifactBase`, `objectRegistrationRefusal`,
 * `restoreTranslatedObjectEchoes`, `restoreInjectedColumnEchoes`,
 * `registeredTranslationBundle`, `readCodeLayerForCarryForward` moved out of
 * `protocol.ts` whole by `scripts/codemod-split-protocol.mjs`.
 *
 * [#30062] Written here from the start, beside their siblings: the page,
 * dataset, app and book packaged bases (`getPackagedPageBase`,
 * `getPackagedDatasetBase`, `getPackagedAppBase`, `getPackagedBookBase`), the
 * served-override reading of a served document (`servedOverrideBaseOf`) and the
 * pair's own translations (`getPairTranslationBundle`).
 *
 * A MOVE, not a redesign. `ProtocolDiscoveryAndBasesFacet` is a stateless facet over the host
 * (ruling 6624345766): each static method below is the body of the class
 * member of the same name as `packages/metadata-protocol/scripts/host-split.mjs`
 * moves one (ruling E, item E1), with `this.<member>` read as `host.<member>`
 * and nothing else changed. The facet holds no state: the fields stay on the
 * class, and a body reaches them through the host (`protocol-host.ts`).
 *
 * The class keeps every member as a one-line delegation. A public member
 * keeps its docblock there, which the published `.d.ts` prints; a private
 * member's docblock moved here with its body (docblock ownership).
 *
 * What a body reads from elsewhere, it imports from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import type { SysMetadataRepository } from './sys-metadata-repository.js';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL, unrecognisedMetaTypeRefusal } from '@objectstack/spec/shared';
import type { TranslationBundle } from '@objectstack/spec/system';
import { readAuthoredTranslationLayer } from '@objectstack/core';
import { restoreTranslatedEchoes } from './protocol-translated-echo.js';
import type { RestoredTranslatedSlot } from './protocol-translated-echo.js';
import {
    DEFAULT_METADATA_TYPE_REGISTRY,
    customizationPackageId,
    getMetadataCreateSeed,
    getMetadataTypeActions,
    getMetadataTypeSchema,
} from '@objectstack/spec/kernel';
import { storedBodyForCarryForward } from './protocol-credential-carry-forward.js';
import type { Equal, MetaTypesListing } from './protocol-meta-types-listing.js';
import {
    HAND_CRAFTED_SCHEMAS,
    TYPE_TO_FORM,
    canonicalMetaType,
    toJsonSchemaSafe,
} from './protocol-meta-type-schema.js';
import type { SaveMetaItemRequest } from './protocol-door-requests.js';
import type { ProtocolHost } from './protocol-host.js';
import { servedOverrideBaseOf } from './served-override.js';
import type { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * [#30062] The types whose packaged base {@link ProtocolDiscoveryAndBasesFacet.packagedArtifactBase}
 * answers: the artifact item IS the packaged declaration for each (none has an
 * extension fold, unlike the object).
 */
export type PackagedArtifactBaseType = 'dashboard' | 'view' | 'report' | 'page' | 'dataset' | 'app' | 'book';

export class ProtocolDiscoveryAndBasesFacet {
    /** The body of `ObjectStackProtocolImplementation#getProjectId`; the method's docblock there is its contract. */
    static getProjectId(host: Pick<ProtocolHost, 'environmentId'>): string | undefined {
        return host.environmentId;
    }

    /** The body of `ObjectStackProtocolImplementation#getMetaTypes`; the method's docblock there is its contract. */
    static async getMetaTypes(host: Pick<ProtocolHost, 'envWritableTypes' | 'listLiveMetadataTypes'>): Promise<MetaTypesListing> {
        const allTypes = await host.listLiveMetadataTypes();

        // Phase 3a-1: enrich response with per-type registry metadata so admin
        // UI can render directory pages, filter by domain, decide which types
        // expose write actions, etc. Existing clients keep working — the
        // `types: string[]` field is preserved alongside the new `entries`.
        //
        // Phase 3a-env-writable: `OS_METADATA_WRITABLE` env var (comma
        // separated singular type names) elevates `allowEnvironmentOverlay` on
        // listed types (`overrideSource: 'env'`). The same env var is consulted
        // by `isOverlayAllowed()` at write time — they must stay in sync — and
        // since ADR-0131 D6 it opens only items no managed package ships: a
        // managed item stays sealed whatever the hatch names
        // (`isSealedManagedItem`).
        //
        // ONE wire spelling, on BOTH arms below: the registry arm's `...base`
        // spread already carries `allowEnvironmentOverlay` at the registry
        // value, and the elevated value OVERWRITES that same key — never a
        // second field — so no entry carries `allowEnvironmentOverlay`, the spelling
        // retired in 18 (its tombstone is `MetadataTypeRegistryEntry`'s).
        const writableOverrides = host.envWritableTypes();
        const registryByType = new Map(
            DEFAULT_METADATA_TYPE_REGISTRY.map((e) => [e.type, e] as const)
        );

        const entries = allTypes.map((type) => {
            const singular = (PLURAL_TO_SINGULAR[type] ?? type) as string;
            // Phase 3a-schema: emit a JSON Schema per type so the generic
            // metadata admin UI can render real forms (no more raw-JSON
            // textareas for new resources). The canonical schema for every
            // built-in (and plugin-registered) metadata type lives in the
            // central `getMetadataTypeSchema()` registry; we delegate so
            // Studio's editor and the runtime overlay validator stay in
            // lock-step (one source of truth).
            const zodSchema = getMetadataTypeSchema(singular);
            // [#17501] `singular` is passed so the degenerate-derivation warning
            // can name the type it could not derive. A type with NO zod schema
            // never reaches the converter at all — absence is not degeneracy.
            const schema = (zodSchema ? toJsonSchemaSafe(zodSchema, singular) : undefined)
                ?? HAND_CRAFTED_SCHEMAS[singular];
            const form = TYPE_TO_FORM[singular];
            // Phase 2: the authoritative minimal create seed (single source of
            // truth in @objectstack/spec). Studio/CLI derive create defaults
            // from this via /meta/types instead of re-inventing them.
            const createSeed = getMetadataCreateSeed(singular);

            // Type-level actions: merge the registry's declarative actions
            // with any plugin-registered overlay (`registerMetadataTypeActions`).
            // This is the single accessor — a host plugin (e.g. the private
            // datasource-admin backend) contributes its `test_connection`
            // button here, co-located with the route handler it calls, so the
            // button only appears when the backend that serves it is installed.
            const typeActions = getMetadataTypeActions(singular);

            const base = registryByType.get(singular as any);
            if (base) {
                const isEnvOverridden = writableOverrides.has(singular);
                return {
                    ...base,
                    type: singular,
                    schemaId: singular, // API client expects schemaId field
                    allowEnvironmentOverlay: base.allowEnvironmentOverlay || isEnvOverridden,
                    overrideSource: isEnvOverridden && !base.allowEnvironmentOverlay
                        ? 'env' as const
                        : 'registry' as const,
                    schema,
                    form,
                    ...(createSeed !== undefined ? { createSeed } : {}),
                    // Override the spread `base.actions` with the merged view
                    // (declarative + plugin-registered). Omit when empty to
                    // preserve the prior "no actions key" response shape.
                    ...(typeActions.length ? { actions: typeActions } : {}),
                };
            }
            // Runtime-registered type with no registry entry — synthesise a
            // minimal descriptor so the UI can still surface it.
            //
            // [#8421] `allowRuntimeCreate` is DERIVED FROM THE MINT DOOR'S OWN
            // CONTRACT rather than synthesised as `true`. The two doors are the
            // same sentence read twice — this endpoint says which types a
            // caller may create, `refuseUnmintableMetaType` decides whether the
            // create is honoured — so they consult ONE predicate
            // ({@link unrecognisedMetaTypeRefusal}) instead of two
            // independently-maintained rules that drifted apart.
            //
            // What this keeps, and it is the whole point: the legitimate
            // plugin kinds with no static registry entry — `webhook`,
            // `connector`, `analytics_cube`, `rag_pipeline` — are IN the static
            // spelling contract (limb 1 of the URL map), so the predicate
            // accepts them and they stay advertised as creatable. (`theme` and
            // `sharing_rule` were two more: `theme` left the contract with its
            // carrier, and ADR-0131 D6 gave `sharing_rule` a code-only registry
            // entry, so it takes the registry arm above.)
            // `PUT /meta/theme/dark` is the operation the plugin path exists to
            // serve and this change must not touch it.
            //
            // What this withdraws: `policy`, `data`, `package`, `kind` — live
            // `SchemaRegistry` keys an ordinary `registerApp` produces, outside
            // that contract. They were advertised `allowRuntimeCreate: true` by
            // the blanket `true` below and nothing ever honoured a create on
            // them; the door has refused them since this card's first cut. The
            // read door now agrees at the honest value instead of promising a
            // write the platform will not perform (the same remedy the
            // 2026-08-07 ruling chose for `api`: withdraw the advertisement
            // rather than converge the read path onto it).
            //
            // ## The premise, and why it is a CURRENT one (maintainer, 2026-08-15)
            //
            // The blanket `true` was not careless: while a plugin could DECLARE
            // a metadata kind, a name with no registry entry might be a real
            // kind this synthesis had not heard of, so "permissive by
            // construction" was the safe reading. That premise is what expired.
            // The ruling, verbatim and untranslated:
            //
            //     暂时不考虑让插件申明新的元数据类型
            //
            // ⚠️ `暂时` is load-bearing and is recorded as such: this is the
            // platform's CURRENT posture, not a permanent architectural
            // closure. Plugin-declared metadata kinds were considered, are
            // understood, and are deferred — not ruled impossible. If they are
            // ever wanted again, this derivation and its twin
            // {@link isRuntimeCreateAllowed} are the two sites that encode the
            // deferral, and `unrecognisedMetaTypeRefusal` in `@objectstack/spec`
            // is the contract they both read; a declared-kind channel would
            // have to feed that predicate before either door could widen. Start
            // here rather than re-deriving the decision from the code's silence.
            const mintableByContract = unrecognisedMetaTypeRefusal(singular) === null;
            return {
                type: singular,
                schemaId: singular, // API client expects schemaId field
                label: singular,
                description: undefined,
                filePatterns: [],
                supportsOverlay: false,
                allowEnvironmentOverlay: writableOverrides.has(singular),
                allowRuntimeCreate: mintableByContract,
                supportsVersioning: false,
                executionPinned: false,
                loadOrder: 1000,
                domain: 'system' as const,
                overrideSource: writableOverrides.has(singular) ? 'env' as const : 'registry' as const,
                schema,
                form,
                ...(createSeed !== undefined ? { createSeed } : {}),
                // Plugin-registered actions on a type with no registry entry.
                ...(typeActions.length ? { actions: typeActions } : {}),
            };
        }).sort((a, b) => {
            if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
            return a.type.localeCompare(b.type);
        });

        const listing = { types: allTypes, entries };
        // [#29510] Compile-time pin: `false` (a type error) the moment the body and the name drift apart.
        const exact: Equal<typeof listing, MetaTypesListing> = true;
        void exact;
        return listing;
    }

    /** The body of `ObjectStackProtocolImplementation#getPackagedObjectBase`; the method's docblock there is its contract. */
    static getPackagedObjectBase(host: Pick<ProtocolHost, 'engine'>, name: string): unknown {
        if (typeof name !== 'string' || name === '') return undefined;
        const registry = (host.engine as any)?.registry;
        if (!registry) return undefined;
        try {
            if (typeof registry.getPackagedObjectBase === 'function') return registry.getPackagedObjectBase(name);
            if (typeof registry.getPackagedObjectOwner !== 'function') return undefined;
            return registry.getPackagedObjectOwner(name)?.definition;
        } catch {
            // Same rule as the fold above: a read over in-memory contributors
            // must never turn a served schema into a 5xx.
            return undefined;
        }
    }

    /** The body of `ObjectStackProtocolImplementation#getPackagedDashboardBase`; the method's docblock there is its contract. */
    static getPackagedDashboardBase(host: Pick<ProtocolHost, 'packagedArtifactBase'>, name: string): unknown {
        return host.packagedArtifactBase('dashboard', name);
    }

    /** The body of `ObjectStackProtocolImplementation#getPackagedViewBase`; the method's docblock there is its contract. */
    static getPackagedViewBase(host: Pick<ProtocolHost, 'packagedArtifactBase'>, name: string): unknown {
        return host.packagedArtifactBase('view', name);
    }

    /** The body of `ObjectStackProtocolImplementation#getPackagedReportBase`; the method's docblock there is its contract. */
    static getPackagedReportBase(host: Pick<ProtocolHost, 'packagedArtifactBase'>, name: string): unknown {
        return host.packagedArtifactBase('report', name);
    }

    /** The body of `ObjectStackProtocolImplementation#getPackagedPageBase`; the method's docblock there is its contract. */
    static getPackagedPageBase(host: Pick<ProtocolHost, 'packagedArtifactBase'>, name: string): unknown {
        return host.packagedArtifactBase('page', name);
    }

    /** The body of `ObjectStackProtocolImplementation#getPackagedDatasetBase`; the method's docblock there is its contract. */
    static getPackagedDatasetBase(host: Pick<ProtocolHost, 'packagedArtifactBase'>, name: string): unknown {
        return host.packagedArtifactBase('dataset', name);
    }

    /** The body of `ObjectStackProtocolImplementation#getPackagedAppBase`; the method's docblock there is its contract. */
    static getPackagedAppBase(host: Pick<ProtocolHost, 'packagedArtifactBase'>, name: string): unknown {
        return host.packagedArtifactBase('app', name);
    }

    /** The body of `ObjectStackProtocolImplementation#getPackagedBookBase`; the method's docblock there is its contract. */
    static getPackagedBookBase(host: Pick<ProtocolHost, 'packagedArtifactBase'>, name: string): unknown {
        return host.packagedArtifactBase('book', name);
    }

    /** The body of `ObjectStackProtocolImplementation#servedOverrideBaseOf`; the method's docblock there is its contract. */
    static servedOverrideBaseOf(type: string, document: unknown): string | undefined {
        return servedOverrideBaseOf(type, document);
    }

    /**
     * The body of `ObjectStackProtocolImplementation#getPairTranslationBundle`;
     * the method's docblock there is its contract.
     *
     * The rows are the environment's ({@link ObjectStackProtocolImplementation.findEnvironmentRows},
     * ADR-0131 D6/D7), narrowed to the pair's binding, and each is read into
     * its locale's data by `readAuthoredTranslationLayer` (`@objectstack/core`),
     * the function the i18n service's authored layer is built with: the same
     * conversions, the same locale resolution, the same bookkeeping stripped.
     * So the bundle is exactly the pair's share of the catalog the deployment
     * serves, with its package kept.
     */
    static async getPairTranslationBundle(host: Pick<ProtocolHost, 'findEnvironmentRows'>, basePackageId: string): Promise<TranslationBundle | undefined> {
        if (typeof basePackageId !== 'string' || basePackageId === '') return undefined;
        const pair = customizationPackageId(basePackageId);
        if (!pair.ok) return undefined;
        const layer = await readAuthoredTranslationLayer({
            find: (table: string, opts: { where?: Record<string, unknown>; [key: string]: unknown } = {}) =>
                host.findEnvironmentRows(table, { ...opts, where: { ...opts.where, package_id: pair.value } }),
        });
        // `null` is a read that failed: the layer's own rule is "keep what you
        // had", and a translation input has nothing to keep, so the caller
        // gets "no pair translation known" — the answer it reads as before the
        // option existed (the override's own text), never a 5xx on a read of
        // the document itself.
        if (layer === null) return undefined;
        return Object.keys(layer).length > 0 ? (layer as TranslationBundle) : undefined;
    }

    /**
     * The one body behind {@link getPackagedDashboardBase},
     * {@link getPackagedViewBase}, {@link getPackagedReportBase} and
     * [#30062] {@link getPackagedPageBase}, {@link getPackagedDatasetBase},
     * {@link getPackagedAppBase} and {@link getPackagedBookBase}:
     * {@link lookupArtifactItem}, and nothing wider, so only an item whose
     * `_packageId` marks a genuine code package answers, and an overlay
     * hydrated under the plain registry key never does.
     */
    static packagedArtifactBase(host: Pick<ProtocolHost, 'lookupArtifactItem'>, type: PackagedArtifactBaseType, name: string): unknown {
        if (typeof name !== 'string' || name === '') return undefined;
        try {
            return host.lookupArtifactItem(type, name);
        } catch {
            // A read over the in-memory registry; a failure here must never
            // turn a served document into a 5xx.
            return undefined;
        }
    }

    /**
     * [#29673] The refusal `registerObject` would throw for this object body,
     * registered as the write-through registers it
     * ({@link applyObjectRegistryMutation}: `_provenance: 'org'`, the layer's
     * package and kind) — asked of the registry's own doors
     * (`SchemaRegistry.objectRegistrationRefusal`), so a door that makes the
     * body live refuses it before the row is written instead of meeting the
     * throw after. `null` when the registry would take it, when the layer is a
     * D9.9 `mismatch` (that refusal is the caller's own, asked first), and on
     * a registry that cannot answer the question (a partial double).
     */
    static objectRegistrationRefusal(host: Pick<ProtocolHost, 'engine'>, body: unknown,
            layer: ReturnType<ObjectStackProtocolImplementation['classifyObjectContribution']>,): Error | null {
        if (layer.kind === 'mismatch') return null;
        const registry = host.engine?.registry as { objectRegistrationRefusal?: (...args: unknown[]) => Error | null } | undefined;
        if (typeof registry?.objectRegistrationRefusal !== 'function') return null;
        if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
        return registry.objectRegistrationRefusal(
            { ...(body as Record<string, unknown>), _provenance: 'org' },
            layer.packageId,
            layer.kind,
        );
    }

    /**
     * [#29673] The write-path inverse of the `/meta` read's translation, for an
     * `object` body: every label the read served translated is put back to its
     * source text before the body is stored ({@link restoreTranslatedEchoes},
     * whose module header is the contract). Its pure half,
     * {@link restoreInjectedColumnEchoes}, already ran before the served-column
     * strip; this half reads the stored row, so it runs after every refusal.
     *
     * The source is the row this save overwrites, read as the credential
     * carry-forward reads it ({@link storedBodyForCarryForward}: the row at the
     * save's own state, else the active row a first draft overlays), and with
     * no stored row the packaged base (`getPackagedObjectBase`) in place of
     * the carry-forward's code-layer read. Every read of the source is
     * translated against that packaged base, as the REST read's is, so a slot
     * the read serves untranslated is no translation's source. The locales are
     * the bundle's and the built-in system-field table's — every locale a read
     * could have answered in. Each restored slot is answered on the save's
     * `advisories` ({@link translatedEchoNotices}).
     *
     * Every save is asked, the stored-row migration included
     * (`source: 'migrate-stored'`): it re-saves a row through this door, which
     * is how a row a zh-CN session already stored is repaired. Any other
     * type's body is returned as it came. No `try`/`catch`: a failed stored-row
     * read fails the save rather than storing a body this door could not judge;
     * the packaged base is a registry lookup, so a degraded MetadataService
     * fails nothing here.
     */
    static async restoreTranslatedObjectEchoes(host: Pick<ProtocolHost, 'getPackagedObjectBase' | 'registeredTranslationBundle'>, request: SaveMetaItemRequest,
            repo: SysMetadataRepository,
            ref: Parameters<SysMetadataRepository['get']>[0],
            mode: 'draft' | 'publish',): Promise<{ item: SaveMetaItemRequest['item']; restored: RestoredTranslatedSlot[] }> {
        if (canonicalMetaType(request.type) !== 'object') return { item: request.item, restored: [] };
        if (!request.item || typeof request.item !== 'object' || Array.isArray(request.item)) {
            return { item: request.item, restored: [] };
        }
        // The packaged base the read translates against (`getPackagedObjectBase`,
        // what the REST read hands `translateObject` as `packagedBase`), and,
        // with no stored row, the source itself: the body a read of an object
        // with no overlay served. A registry lookup, never a MetadataService
        // read — so a degraded service fails no save here (a brand-new object
        // has no source beyond the platform columns the pure half handled).
        const packagedBase = host.getPackagedObjectBase(request.name);
        const source = await storedBodyForCarryForward.call(
            { readCodeLayerForCarryForward: async () => packagedBase },
            {
                type: 'object',
                repo,
                ref,
                state: mode === 'draft' ? 'draft' : 'active',
                packageId: request.packageId ?? null,
            },
        );
        return restoreTranslatedEchoes(request.item, {
            source,
            bundle: host.registeredTranslationBundle(),
            packagedBase: packagedBase ?? undefined,
        });
    }

    /**
     * [#29673] The pure half of {@link restoreTranslatedObjectEchoes}, run
     * before the served-column strip: each injected column's slots compared
     * with the platform's own definition only (no stored row, so no read).
     * A column that came back translated is the platform's definition again,
     * and the strip removes it.
     */
    static restoreInjectedColumnEchoes(host: Pick<ProtocolHost, 'registeredTranslationBundle'>, request: SaveMetaItemRequest): SaveMetaItemRequest['item'] {
        if (canonicalMetaType(request.type) !== 'object') return request.item;
        if (!request.item || typeof request.item !== 'object' || Array.isArray(request.item)) return request.item;
        return restoreTranslatedEchoes(request.item, { source: undefined, bundle: host.registeredTranslationBundle() }).item;
    }

    /**
     * [#29673] The registered i18n service's catalog as a `TranslationBundle`
     * (`locale -> data`), or `undefined` when no service or no locale is
     * registered — the bundle the `/meta` read exits translate with
     * (`translationBundleOf` in `@objectstack/rest`, built the same way).
     */
    static registeredTranslationBundle(host: Pick<ProtocolHost, 'getServicesRegistry'>): TranslationBundle | undefined {
        const service: any = host.getServicesRegistry?.().get('i18n');
        if (!service || typeof service.getLocales !== 'function' || typeof service.getTranslations !== 'function') {
            return undefined;
        }
        const bundle: Record<string, any> = {};
        for (const locale of service.getLocales() as string[]) {
            const data = service.getTranslations(locale);
            if (data && typeof data === 'object') bundle[locale] = data;
        }
        return Object.keys(bundle).length > 0 ? (bundle as TranslationBundle) : undefined;
    }

    /**
     * [#20552] The body a read served for an item with NO overlay row — the
     * CODE layer, resolved in the order `getMetaItemLayered` resolves its `code`
     * layer: the MetadataService item, else the loaded artifact's item, else the
     * SchemaRegistry item (with the plural/singular retry). The artifact lookup
     * comes before the plain registry key because an overlay hydrated into that
     * key can shadow it (see {@link lookupArtifactItem}); here there is no
     * overlay row, so a hydrated copy would be stale.
     *
     * Type-agnostic, like the carry-forward it feeds: a code-defined datasource
     * gets the same first-save protection as a code-authored flow.
     *
     * ⛔ No `try`/`catch` — the carry-forward's own rule. A MetadataService read
     * that throws fails the save, and one that reports itself degraded with
     * nothing found anywhere fails it as the same 503 the read doors answer:
     * the alternative is persisting a body whose credential this save could not
     * confirm was carried.
     */
    static async readCodeLayerForCarryForward(host: Pick<ProtocolHost, 'engine' | 'lookupArtifactItem' | 'readItemFromMetadataService' | 'throwMetadataServiceUnavailable'>, type: string,
            name: string,
            packageId: string | null,): Promise<unknown> {
        const pkg = packageId ?? undefined;
        const fromService = await host.readItemFromMetadataService(type, name, pkg);
        if (fromService.data !== undefined && fromService.data !== null) return fromService.data;
        let item: unknown = host.lookupArtifactItem(type, name, pkg) ?? host.engine.registry.getItem(type, name, pkg);
        if (item === undefined) {
            const alt = PLURAL_TO_SINGULAR[type] ?? SINGULAR_TO_PLURAL[type];
            if (alt) item = host.engine.registry.getItem(alt, name, pkg);
        }
        if (item !== undefined && item !== null) return item;
        if (fromService.degraded) host.throwMetadataServiceUnavailable(fromService.errors);
        return undefined;
    }
}
