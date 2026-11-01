// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D3 — the ENSURE DOOR of a base's paired customization package
 * `<base>.custom`, and the one predicate every package install asks about an
 * id shaped like a pair.
 *
 * ## The door
 *
 * {@link ensureCustomizationPackage} is the body of
 * `ObjectStackProtocolImplementation#ensureCustomizationPackage`, served over
 * HTTP as `POST /api/v1/packages/:id/ensure-customization`
 * (`@objectstack/runtime`, `domains/packages.ts`). Given an installed base it
 * answers the pair, creating it when it is absent — the ONLY creation path of
 * the pair (ADR-0146 D3: "no second door builds the pair"), and the one Studio,
 * the clone door and the migration call on a customer's first customization.
 *
 * Everything the pair is made of is the base's, through the pairing rules of
 * `@objectstack/spec/kernel` (`customization-package.ts`), ⛔ never a local
 * spelling:
 *
 *   - id — {@link customizationPackageId}: `<base>.custom`;
 *   - namespace — {@link customizationNamespace}: `<base namespace>_custom`, SET
 *     EXPLICITLY on the manifest so `installPackage`'s id-derived default
 *     (`deriveNamespaceFromPackageId('hotcrm.custom')` = `custom`) never runs
 *     (ADR-0146 D3, Q4 「全部同意」);
 *   - dependency — {@link customizationDependencyRange}: `^<major>` of the base's
 *     `manifest.version` at creation, declared on the base in
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
 *   - `404` — the base is not installed;
 *   - `409` — the base's state rules the pair out: the base is writable
 *     (customize it directly), declares no namespace, or has a namespace whose
 *     pair namespace fails the manifest grammar (longer than
 *     {@link MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH}, no truncation and no
 *     hashing); its version is not SemVer, so no range can be declared; or an
 *     installed `<base>.custom` lacks the namespace or the dependency;
 *   - `422 NAMESPACE_CONFLICT` — another package owns the pair's namespace: the
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
import { isWritablePackage } from './package-writability.js';
import { EnsureCustomizationPackageRequestSchema } from '@objectstack/spec/api';
import type {
    EnsureCustomizationPackageRequest,
    EnsureCustomizationPackageResponse,
    InstallPackageRequest,
} from '@objectstack/spec/api';
import {
    MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH,
    customizationBasePackageId,
    customizationDependencyRange,
    customizationNamespace,
    customizationPackageId,
} from '@objectstack/spec/kernel';
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
interface PairRegistry {
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
    };
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
 * Pure over the manifest and one registry lookup; it writes nothing.
 */
export function customizationPairManifestRefusal(
    manifest: unknown,
    getInstalled: (id: string) => PairPackageRow | undefined,
): string | undefined {
    const m = manifest as PairPackageRow['manifest'] | null | undefined;
    const baseId = customizationBasePackageId(m?.id);
    if (baseId === null) return undefined;
    const pairId = m!.id as string;

    const base = getInstalled(baseId);
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

    const pair = customizationPackageId(baseId);
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

/** One judgement of the registry, and the create when the pair is absent. */
async function ensurePairOnce(
    this: CustomizationPackageHost,
    registry: PairRegistry,
    baseId: string,
    pairId: string,
): Promise<EnsureCustomizationPackageResponse> {
    const base = registry.getPackage(baseId);
    if (!base) {
        throw refusal(404, `Package '${baseId}' not found: a paired customization package is ensured for an installed `
            + 'base.');
    }
    // ADR-0070 D2's one predicate. A writable base is the customer's own and
    // takes their changes directly; the pair exists for a base the customer
    // cannot author into.
    if (isWritablePackage(this.engine, baseId)) {
        throw refusal(409, `Package '${baseId}' is writable: customize it directly. A paired customization package `
            + `('${pairId}') holds the changes to a read-only base — one provided by code or an installed app `
            + '(ADR-0146 D3).');
    }
    const namespace = customizationNamespace(base.manifest?.namespace);
    if (!namespace.ok) {
        throw refusal(409, `Cannot ensure '${pairId}': ${noPairNamespaceClause(baseId, base.manifest?.namespace, namespace.reason)} `
            + '(ADR-0146 D3).');
    }

    // Idempotent: an existing pair is returned unchanged, or refused naming
    // what it lacks — ⛔ never adopted, never rewritten.
    const existing = registry.getPackage(pairId);
    if (existing) {
        const lacks: string[] = [];
        const declaredNamespace = existing.manifest?.namespace;
        if (declaredNamespace !== namespace.value) {
            lacks.push(`namespace '${namespace.value}' (it declares ${typeof declaredNamespace === 'string' && declaredNamespace !== '' ? `'${declaredNamespace}'` : 'none'})`);
        }
        const declaredRange = declaredRangeOn(existing.manifest, baseId);
        if (declaredRange === undefined) lacks.push(`a dependency on '${baseId}' in manifest.dependencies`);
        if (lacks.length > 0 || declaredRange === undefined) {
            throw refusal(409, `Package '${pairId}' is installed but is not the paired customization package of `
                + `'${baseId}': it lacks ${lacks.join(', and ')}. It is not adopted or rewritten — delete it, or `
                + 'install a manifest over it that declares both, then ensure the pair again (ADR-0146 D3).');
        }
        return {
            basePackageId: baseId,
            packageId: pairId,
            namespace: namespace.value,
            dependencyRange: declaredRange,
            created: false,
            writable: isWritablePackage(this.engine, pairId),
        };
    }

    const range = customizationDependencyRange(base.manifest?.version);
    if (!range.ok) {
        throw refusal(409, `Cannot ensure '${pairId}': package '${baseId}' is at version `
            + `'${String(base.manifest?.version)}', which is not a SemVer 2.0.0 version, so the pair's dependency `
            + 'range — the major of the base\'s version — cannot be declared (ADR-0146 D3).');
    }
    // The pair's namespace is the pair's alone: an owner other than the pair
    // is refused here, before the install, whatever co-ownership the registry
    // would read.
    const owner = registry.getNamespaceOwners?.(namespace.value)?.find((id) => id !== pairId);
    if (owner !== undefined) {
        throw refusal(422, `Cannot ensure '${pairId}': its namespace '${namespace.value}' is already owned by package `
            + `'${owner}'. The pair's namespace is the base's followed by '_custom' and has no alternative; uninstall `
            + `'${owner}' or move it off that namespace, then ensure the pair again (ADR-0146 D3).`,
        'NAMESPACE_CONFLICT');
    }

    const baseName = typeof base.manifest?.name === 'string' && base.manifest.name !== '' ? base.manifest.name : baseId;
    const manifest = {
        id: pairId,
        name: `${baseName} (custom)`,
        version: CREATED_PAIR_VERSION,
        type: CREATED_PAIR_TYPE,
        namespace: namespace.value,
        dependencies: { [baseId]: range.value },
    };
    await this.installPackage({ manifest } as InstallPackageRequest);
    return {
        basePackageId: baseId,
        packageId: pairId,
        namespace: namespace.value,
        dependencyRange: range.value,
        created: true,
        writable: isWritablePackage(this.engine, pairId),
    };
}
