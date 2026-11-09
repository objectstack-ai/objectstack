// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D3 — the ENSURE DOOR of a base's paired customization package
 * `<base>.custom`, and the one predicate every package install asks about an
 * id shaped like a pair.
 *
 * ## The door
 *
 * The unit is the App (ADR-0146 D3 as amended, ruling record 6691022506): the
 * pair of a base is the pair of the App that carries it ({@link pairOf},
 * `@objectstack/metadata-core`), so the door asked for any package of an App
 * answers that App's one pair, `<app id>.custom` — creating it on the first
 * ask and answering it after, never `422` for a package of the same App. A
 * package that declares no App is its own unit, as before.
 *
 * {@link ensureCustomizationPackage} is the body of
 * `ObjectStackProtocolImplementation#ensureCustomizationPackage`, served over
 * HTTP as `POST /api/v1/packages/:id/ensure-customization`
 * (`@objectstack/runtime`, `domains/packages.ts`). Given an installed base it
 * answers the pair, creating it when it is absent — the ONLY creation path of
 * the pair (ADR-0146 D3: "no second door builds the pair"), and the one Studio,
 * the clone door and the migration call on a customer's first customization.
 *
 * Everything the pair is made of is its App's — the asked base's App, which
 * is the base itself for an App or an own-unit package — through the pairing
 * rules of `@objectstack/spec/kernel` (`customization-package.ts`), ⛔ never a
 * local spelling:
 *
 *   - id — `customizationPackageId`, asked through {@link pairOf}: `<app id>.custom`;
 *   - namespace — {@link customizationNamespace}: `<app namespace>_custom`, SET
 *     EXPLICITLY on the manifest so `installPackage`'s id-derived default
 *     (`deriveNamespaceFromPackageId('hotcrm.custom')` = `custom`) never runs
 *     (ADR-0146 D3, Q4 「全部同意」);
 *   - dependency — {@link customizationDependencyRange}: `^<major>` of the App's
 *     `manifest.version` at creation, declared on the App in
 *     `manifest.dependencies` (ADR-0141 D1);
 *   - writable — a scope-less authored package, the same record `POST
 *     /packages` writes for a Studio-created base.
 *
 * It creates THROUGH `installPackage`, the one install primitive, so the pair
 * lands in the registry and in `sys_packages` together, and the pre-install
 * dependency check (ADR-0141 D2) judges the range it declares.
 *
 * ## Idempotent, and one pair under concurrency
 *
 * An existing pair is returned UNCHANGED: nothing is written, whatever it
 * declares. One that does not declare the namespace and the dependency above
 * is refused, naming what it lacks — never adopted and never rewritten.
 *
 * Two calls for one pair never both create it. The registry write inside
 * `installPackage` is synchronous, but its `sys_packages` persist is not, and
 * a failed persist UNDOES the registry write (#21243). So a second call that
 * merely read the registry while the first was persisting could answer "the
 * pair is already there" for a pair that a moment later is not. Calls are
 * therefore serialized per pair id, per registry ({@link PAIR_FLIGHTS}): a
 * call that finds one in flight waits for it to settle, then judges the
 * registry afresh — so it answers the pair the first call created, or, when
 * that call failed, creates the pair itself. The serialization is in-process;
 * across nodes the shared `sys_packages` row is keyed by the pair id, so two
 * nodes racing still leave one stored pair.
 *
 * ## Refusals
 *
 * Every refusal is thrown before anything is written, as an ADR-0112 error
 * carrying its status (`resolveThrownHttpError`, `@objectstack/types`):
 *
 *   - `400` — the request is malformed, or the base id has no pair (it is
 *     itself a pair, or `<base>.custom` is not a valid package id);
 *   - `409` — the base reaches several Apps and its namespace picks none or
 *     more than one of them (ADR-0146 D3 merge question 11: no single App, so
 *     no pair, never a guess);
 *   - `404` — the base is not installed;
 *   - `409` — the base's state rules the pair out: the base is a kernel
 *     package ({@link kernelPackageScopeOf}), whose objects are not
 *     customizable in this version (ruling record 6691217245 on ADR-0146 D3);
 *     the base is writable
 *     (customize it directly), declares no namespace, or has a namespace whose
 *     pair namespace fails the manifest grammar (longer than
 *     {@link MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH}, no truncation and no
 *     hashing); its version is not SemVer, so no range can be declared; or an
 *     installed pair lacks the namespace or the dependency; or the pair's
 *     namespace is held by the per-package pair an earlier version created for
 *     a member of the same App (ADR-0146 D3 merge question 12: that pair stays
 *     served, and the App's pair waits for it to be re-identified — never
 *     `422` for a package of the same App);
 *   - `422 NAMESPACE_CONFLICT` — a package outside the App owns the pair's namespace: the
 *     code and status `SchemaRegistry.installPackage` stamps for the same
 *     condition (`@objectstack/objectql`; that package depends on this one, so
 *     the string is spelled in each).
 *
 * The caller's authority is the HTTP door's to judge (`manage_metadata`, and
 * the walled refusal), exactly as at the install door; this body judges the
 * packages.
 *
 * ## The predicate
 *
 * {@link customizationPairManifestRefusal} is item 6 of the card that built the
 * door: a package install whose id is pair-shaped must carry what the door
 * would have written — the explicit namespace and the dependency on the base —
 * or it is refused, naming the door. `installPackage` asks it (so the
 * duplicate's copy record and every in-process caller are judged), the
 * duplicate asks it before it reads a row, and `POST /packages` asks it
 * before either install limb. An exported pair that declares both still
 * installs; the ADR-0141 D2 check then judges its range against the base
 * installed there.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { isWritablePackage, READ_ONLY_PACKAGE_SCOPES } from './package-writability.js';
import { EnsureCustomizationPackageRequestSchema } from '@objectstack/spec/api';
import type {
    EnsureCustomizationPackageRequest,
    EnsureCustomizationPackageResponse,
    InstallPackageRequest,
} from '@objectstack/spec/api';
import {
    MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH,
    customizationBasePackageId,
    customizationPackageId,
    customizationDependencyRange,
    customizationNamespace,
} from '@objectstack/spec/kernel';
import { appOf, pairOf } from '@objectstack/metadata-core';
import { installedManifestsOfEngine } from './installed-manifests.js';
import type { CustomizationNamespaceRefusal } from '@objectstack/spec/kernel';

/** The HTTP route that serves the door — named by every refusal that points at it. */
export const ENSURE_CUSTOMIZATION_ROUTE_SUFFIX = '/ensure-customization';

/** The version a created pair starts at: the default `installPackage` gives a versionless package. */
const CREATED_PAIR_VERSION = '0.1.0';

/**
 * The manifest `type` of a created pair: `module`, a package that extends the
 * base it declares rather than an application of its own.
 */
const CREATED_PAIR_TYPE = 'module';

/**
 * The `ObjectStackProtocolImplementation` members the door reads, typed AS the
 * class members so a signature change on the class is a change here.
 * `engine` goes as a getter (see `protocol-package-install.ts`'s header).
 */
export interface CustomizationPackageHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    installPackage: ObjectStackProtocolImplementation['installPackage'];
}

/** The registry slice the door and the predicate read. */
export interface PairRegistry {
    getPackage(id: string): PairPackageRow | undefined;
    getNamespaceOwners?(namespace: string): string[];
}

/** A registry package row, as far as the door reads it. */
interface PairPackageRow {
    manifest?: {
        id?: unknown;
        name?: unknown;
        version?: unknown;
        namespace?: unknown;
        dependencies?: unknown;
        scope?: unknown;
    };
}

/**
 * [ADR-0146 D3, ruling record 6691217245] The kernel scope of an installed
 * package — `system` or `cloud`, the scopes the platform delivers
 * ({@link READ_ONLY_PACKAGE_SCOPES}) — or `undefined` for any other package.
 * The kernel is one suite that ships with the runtime at the runtime's version
 * (installing it whole is the goal ruling 6691022506 records), so it is no
 * customer's unit to customize: in
 * this version every kernel object is served as not customizable, and the
 * ensure door creates no pair for a kernel package. Which kernel objects a
 * later version opens to customization (a whitelist) is that version's
 * question, not this predicate's.
 */
function kernelPackageScopeOf(row: PairPackageRow | undefined): string | undefined {
    const scope = row?.manifest?.scope;
    return typeof scope === 'string' && READ_ONLY_PACKAGE_SCOPES.includes(scope) ? scope : undefined;
}

/**
 * [ruling record 6691217245] The kernel scope of `packageId` as `engine`'s
 * registry holds it ({@link kernelPackageScopeOf}), or `undefined` for a
 * package that is not a kernel package or is not installed. The door's own
 * reading, for the callers that land something in a package's pair and must
 * know beforehand that a kernel package has none (the "new similar" doors).
 */
export function kernelPackageScope(engine: unknown, packageId: string): string | undefined {
    const manifest = installedManifestsOfEngine(engine)(packageId);
    return kernelPackageScopeOf(manifest === undefined ? undefined : { manifest });
}

/**
 * The calls in flight, per registry and per pair id — see the module header,
 * "Idempotent, and one pair under concurrency". Keyed weakly by the registry,
 * so a test's throwaway registry takes its entries with it.
 */
const PAIR_FLIGHTS = new WeakMap<object, Map<string, Promise<unknown>>>();

/** An ADR-0112 refusal: the sentence, its status, and a registered code where one is stamped. */
function refusal(status: number, message: string, code?: string): Error {
    return Object.assign(new Error(message), { statusCode: status, ...(code ? { code } : {}) });
}

/** The pair's dependency on `baseId`, as `manifest.dependencies` declares it, or `undefined`. */
function declaredRangeOn(manifest: PairPackageRow['manifest'], baseId: string): string | undefined {
    const dependencies = manifest?.dependencies;
    if (typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) return undefined;
    const range = (dependencies as Record<string, unknown>)[baseId];
    return typeof range === 'string' && range !== '' ? range : undefined;
}

/** Why a base namespace has no pair namespace, as a clause naming the base. */
function noPairNamespaceClause(baseId: string, baseNamespace: unknown, reason: CustomizationNamespaceRefusal): string {
    switch (reason) {
        case 'base_namespace_missing':
            return `package '${baseId}' declares no namespace, so it has no pair namespace: the pair's namespace is `
                + 'the base\'s followed by \'_custom\', never derived from the pair\'s id';
        case 'base_namespace_too_long':
            return `package '${baseId}' has namespace '${String(baseNamespace)}' (${String(baseNamespace).length} `
                + `characters), and '${String(baseNamespace)}_custom' exceeds the 20 characters a manifest namespace `
                + `admits — a base namespace of at most ${MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH} characters has a `
                + 'pair namespace, and none is truncated or hashed';
        case 'base_namespace_invalid':
            return `package '${baseId}' has namespace '${String(baseNamespace)}', and '${String(baseNamespace)}_custom' `
                + 'is not a valid manifest namespace (2-20 characters, a lowercase letter first, then lowercase '
                + 'letters, digits and underscores)';
    }
}

/**
 * Item 6: why a package install whose id is a paired customization package id
 * is refused, or `undefined` when the install may proceed (the id is not
 * pair-shaped, or the manifest carries what the ensure door would write).
 *
 * The manifest must declare:
 *   - an explicit `namespace`, and — when the base is installed here — exactly
 *     the base's pair namespace ({@link customizationNamespace});
 *   - a dependency on the base in `manifest.dependencies`, of any range: the
 *     ADR-0141 D2 check judges the range against the installed base.
 *
 * When the base is not installed the namespace cannot be compared, and the
 * dependency check refuses the install anyway (`DEPENDENCY_MISSING`), so only
 * the presence of both is asked here.
 *
 * `getInstalled` answers the installed row for an id — a registry's
 * `getPackage` — and is read only as far as `manifest.namespace`, so a caller
 * passes its lookup as it is typed.
 *
 * Pure over the manifest and one registry lookup; it writes nothing.
 */
export function customizationPairManifestRefusal(
    manifest: unknown,
    getInstalled: (id: string) => unknown,
): string | undefined {
    const m = manifest as PairPackageRow['manifest'] | null | undefined;
    const baseId = customizationBasePackageId(m?.id);
    if (baseId === null) return undefined;
    const pairId = m!.id as string;

    const base = getInstalled(baseId) as PairPackageRow | null | undefined;
    const expected = base ? customizationNamespace(base.manifest?.namespace) : undefined;
    const lacks: string[] = [];
    const namespace = m?.namespace;
    if (expected !== undefined && !expected.ok) {
        lacks.push(`a pair namespace, which it cannot have here: ${noPairNamespaceClause(baseId, base?.manifest?.namespace, expected.reason)}`);
    } else if (typeof namespace !== 'string' || namespace === '') {
        lacks.push(expected?.ok
            ? `the explicit \`namespace: '${expected.value}'\``
            : 'an explicit `namespace` (the base\'s namespace followed by `_custom`)');
    } else if (expected?.ok && namespace !== expected.value) {
        lacks.push(`\`namespace: '${expected.value}'\` (it declares '${namespace}')`);
    }
    if (declaredRangeOn(m ?? undefined, baseId) === undefined) {
        lacks.push(`a dependency on '${baseId}' in \`manifest.dependencies\``);
    }
    if (lacks.length === 0) return undefined;
    return `Package '${pairId}' is the paired customization package of '${baseId}' (ADR-0146 D3), and its manifest `
        + `lacks ${lacks.join(', and ')}. The pair is created by its ensure door, `
        + `\`POST /api/v1/packages/${baseId}${ENSURE_CUSTOMIZATION_ROUTE_SUFFIX}\` (the protocol's `
        + '`ensureCustomizationPackage`), which writes both; an exported pair that declares both installs here, '
        + 'its range judged against the installed base.';
}

/** The body of `ObjectStackProtocolImplementation#ensureCustomizationPackage`; the method's docblock there is its contract. */
export async function ensureCustomizationPackage(
    this: CustomizationPackageHost,
    request: EnsureCustomizationPackageRequest,
): Promise<EnsureCustomizationPackageResponse> {
    // The request is the declaration's, parsed whole: a key it does not
    // declare is refused, never ignored (the request schema's docblock).
    const declared = EnsureCustomizationPackageRequestSchema.safeParse(request);
    if (!declared.success) {
        const located = declared.error.issues
            .map((issue) => `${issue.path.map(String).join('.') || '(request)'}: ${issue.message}`)
            .join('; ');
        throw refusal(400, `Invalid ensureCustomizationPackage request — ${located}`);
    }
    const baseId = declared.data.basePackageId;

    const pair = pairOf(baseId, installedManifestsOfEngine(this.engine));
    if (!pair.ok && pair.reason === 'no_single_app') {
        throw refusal(409, `Package '${baseId}' declares several Apps and its namespace picks no single one of them, `
            + 'so it has no paired customization package: a customization lands in the pair of the one App that '
            + 'carries the package, and none is chosen by guess (ADR-0146 D3).');
    }
    if (!pair.ok) {
        throw refusal(400, pair.reason === 'base_is_customization_package'
            ? `Package '${baseId}' is itself a paired customization package, and a pair is never paired again: `
                + 'customize the base it belongs to (ADR-0146 D3).'
            : pair.reason === 'base_id_missing'
                ? 'A base package id is required to ensure its paired customization package.'
                : `Package id '${baseId}' has no paired customization package: '${baseId}.custom' is not a valid `
                    + 'package id (lowercase dot-separated segments of letters, digits and inner hyphens).');
    }
    const pairId = pair.value;

    const registry = (this.engine as { registry?: PairRegistry } | undefined)?.registry;
    if (!registry || typeof registry.getPackage !== 'function') {
        throw refusal(503, 'Package service not available: no package registry to ensure a customization package in.');
    }

    let flights = PAIR_FLIGHTS.get(registry);
    if (!flights) {
        flights = new Map();
        PAIR_FLIGHTS.set(registry, flights);
    }
    // Wait out every call in flight for this pair, then judge afresh. The
    // check and the `set` below run in one turn, so no other call can slip
    // between them.
    for (let pending = flights.get(pairId); pending; pending = flights.get(pairId)) {
        await pending.catch(() => undefined);
    }
    const run = ensurePairOnce.call(this, registry, baseId, pairId);
    flights.set(pairId, run);
    try {
        return await run;
    } finally {
        if (flights.get(pairId) === run) flights.delete(pairId);
    }
}

/**
 * [ADR-0146 D11, #28576] Why the ensure door would refuse to ensure `baseId`'s
 * pair on this registry now, or `undefined` when it would answer the existing
 * pair or create it. ONE reading of the door's registry-decidable refusals:
 * {@link ensurePairOnce} throws the error this answers, and the close of the
 * package-less write (`packagelessOverlayWriteRefusal`) leaves a name's
 * package-less write open where it answers one — `os migrate
 * packageless-overlays` could not move such a row (its step 1 fails). Pure
 * over the registry; it writes nothing.
 */
export function customizationPairEnsureRefusal(
    engine: ObjectStackProtocolImplementation['engine'],
    registry: PairRegistry,
    baseId: string,
    pairId: string,
    options: {
        /**
         * `false` asks every other judgement of the door with the kernel
         * verdict left out: the overlay-write closes read it so that a
         * kernel item stays closed exactly where it was closed before the
         * verdict (`overlayPairFixOf`). The door itself always judges it.
         */
        readonly judgeKernel?: boolean;
    } = {},
): Error | undefined {
    const base = registry.getPackage(baseId);
    if (!base) {
        return refusal(404, `Package '${baseId}' not found: a paired customization package is ensured for an installed `
            + 'base.');
    }
    // [ruling record 6691217245] A kernel package has no pair in this
    // version, ensured or created — the door's verdict, before anything else
    // about the base is judged. It refuses the ENSURE only: a pair an earlier
    // version of this door created for a kernel package stays installed, and
    // the overrides inside it stay served and writable (the override gate and
    // the served-override read never ask this door).
    const kernelScope = options.judgeKernel === false ? undefined : kernelPackageScopeOf(base);
    if (kernelScope !== undefined) {
        return refusal(409, `Package '${baseId}' is a kernel package (scope '${kernelScope}'): kernel objects are not `
            + `customizable in this version, so '${baseId}' has no paired customization package and '${pairId}' is `
            + 'not ensured. A pair an earlier version created stays installed, and the overrides in it stay served '
            + '(ADR-0146 D3).');
    }
    // ADR-0070 D2's one predicate. A writable base is the customer's own and
    // takes their changes directly; the pair exists for a base the customer
    // cannot author into.
    if (isWritablePackage(engine, baseId)) {
        return refusal(409, `Package '${baseId}' is writable: customize it directly. A paired customization package `
            + `('${pairId}') holds the changes to a read-only base — one provided by code or an installed app `
            + '(ADR-0146 D3).');
    }
    // [ruling record 6691022506] The pair is its App's: its namespace, its
    // dependency and its range are read off the App (the base itself for an
    // App or an own-unit package).
    const appId = customizationBasePackageId(pairId) ?? baseId;
    const app = appId === baseId ? base : registry.getPackage(appId);
    if (!app) {
        return refusal(404, `Package '${appId}', the App that carries '${baseId}', is not installed: its paired `
            + `customization package '${pairId}' is ensured for an installed App (ADR-0146 D3).`);
    }
    const namespace = customizationNamespace(app.manifest?.namespace);
    if (!namespace.ok) {
        return refusal(409, `Cannot ensure '${pairId}': ${noPairNamespaceClause(appId, app.manifest?.namespace, namespace.reason)} `
            + '(ADR-0146 D3).');
    }
    // An existing pair is returned unchanged, or refused naming what it lacks.
    const existing = registry.getPackage(pairId);
    if (existing) {
        const lacks: string[] = [];
        const declaredNamespace = existing.manifest?.namespace;
        if (declaredNamespace !== namespace.value) {
            lacks.push(`namespace '${namespace.value}' (it declares ${typeof declaredNamespace === 'string' && declaredNamespace !== '' ? `'${declaredNamespace}'` : 'none'})`);
        }
        const declaredRange = declaredRangeOn(existing.manifest, appId);
        if (declaredRange === undefined) lacks.push(`a dependency on '${appId}' in manifest.dependencies`);
        if (lacks.length > 0) {
            return refusal(409, `Package '${pairId}' is installed but is not the paired customization package of `
                + `'${appId}': it lacks ${lacks.join(', and ')}. It is not adopted or rewritten — delete it, or `
                + 'install a manifest over it that declares both, then ensure the pair again (ADR-0146 D3).');
        }
        return undefined;
    }
    const range = customizationDependencyRange(app.manifest?.version);
    if (!range.ok) {
        return refusal(409, `Cannot ensure '${pairId}': package '${appId}' is at version `
            + `'${String(app.manifest?.version)}', which is not a SemVer 2.0.0 version, so the pair's dependency `
            + 'range — the major of the App\'s version — cannot be declared (ADR-0146 D3).');
    }
    // The pair's namespace is the pair's alone: an owner other than the pair
    // is refused here, before the install, whatever co-ownership the registry
    // would read.
    const owner = registry.getNamespaceOwners?.(namespace.value)?.find((id) => id !== pairId);
    if (owner !== undefined) {
        // [ADR-0146 D3 merge question 12] The per-package pair an earlier
        // version created for a member of this App holds the namespace: it
        // stays served as it is, and the App's pair waits for it to be
        // re-identified as the App's pair — a resource-state conflict inside
        // the App, never the `422` kept for a package outside it.
        const ownerBase = customizationBasePackageId(owner);
        const installed = installedManifestsOfEngine(engine);
        if (ownerBase !== null && customizationPackageId(ownerBase).ok && appOf(ownerBase, installed) === appId) {
            return refusal(409, `Cannot ensure '${pairId}' yet: its namespace '${namespace.value}' is held by `
                + `'${owner}', the paired customization package an earlier version created for '${ownerBase}', a `
                + `package of the App '${appId}'. That package stays installed and its customizations stay served; `
                + `'${pairId}' is created once '${owner}' is re-identified as the App's pair, and is not created `
                + 'beside it (ADR-0146 D3).');
        }
        return refusal(422, `Cannot ensure '${pairId}': its namespace '${namespace.value}' is already owned by package `
            + `'${owner}'. The pair's namespace is the App's followed by '_custom' and has no alternative; uninstall `
            + `'${owner}' or move it off that namespace, then ensure the pair again (ADR-0146 D3).`,
        'NAMESPACE_CONFLICT');
    }
    return undefined;
}

/** One judgement of the registry, and the create when the pair is absent. */
async function ensurePairOnce(
    this: CustomizationPackageHost,
    registry: PairRegistry,
    baseId: string,
    pairId: string,
): Promise<EnsureCustomizationPackageResponse> {
    // Every refusal the registry decides, read once ({@link customizationPairEnsureRefusal}).
    const refused = customizationPairEnsureRefusal(this.engine, registry, baseId, pairId);
    if (refused) throw refused;
    // The pair is its App's (the refusal above read the same App).
    const appId = customizationBasePackageId(pairId) ?? baseId;
    const app = registry.getPackage(appId)!;
    const namespace = customizationNamespace(app.manifest?.namespace);
    if (!namespace.ok) throw new Error('unreachable: the namespace was judged above');

    // Idempotent: an existing pair is returned unchanged — ⛔ never adopted,
    // never rewritten (its refusal is above).
    const existing = registry.getPackage(pairId);
    if (existing) {
        return {
            basePackageId: appId,
            packageId: pairId,
            namespace: namespace.value,
            dependencyRange: declaredRangeOn(existing.manifest, appId)!,
            created: false,
            writable: isWritablePackage(this.engine, pairId),
        };
    }

    const range = customizationDependencyRange(app.manifest?.version);
    if (!range.ok) throw new Error('unreachable: the version was judged above');
    const appName = typeof app.manifest?.name === 'string' && app.manifest.name !== '' ? app.manifest.name : appId;
    const manifest = {
        id: pairId,
        name: `${appName} (custom)`,
        version: CREATED_PAIR_VERSION,
        type: CREATED_PAIR_TYPE,
        namespace: namespace.value,
        dependencies: { [appId]: range.value },
    };
    await this.installPackage({ manifest } as InstallPackageRequest);
    return {
        basePackageId: appId,
        packageId: pairId,
        namespace: namespace.value,
        dependencyRange: range.value,
        created: true,
        writable: isWritablePackage(this.engine, pairId),
    };
}
