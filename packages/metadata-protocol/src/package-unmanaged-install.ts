// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] The `unmanaged` install mode's copy-once import — the PURE half:
 * what one package body contains, what of it the import can write, and every
 * refusal that can be judged from the body alone.
 *
 * A package installs one of two ways. MANAGED: the package is the authority,
 * it upgrades, and nothing it ships may be edited. UNMANAGED (the spelling
 * ruled on the D6 execution card, 2026-10-11): every metadata item is copied
 * ONCE into the environment ledger, becomes this environment's own metadata,
 * is fully editable, and never follows an upgrade. The orchestration —
 * reading the store, minting the base, writing each item through
 * `saveMetaItem`, deleting the base when a write fails — is
 * `ObjectStackProtocolImplementation.importUnmanagedPackage` (`protocol.ts`).
 * This module holds the parts that need no store, so each is testable alone.
 *
 * ## What the import writes, and the one rule behind every refusal
 *
 * The import writes METADATA ITEMS: the elements of every manifest collection
 * (`PLURAL_TO_SINGULAR`, the one map the artifact loader and the authoring lint
 * read to decide which collections exist) plus the assembled `viewItems`
 * channel, each through the same save door a Studio edit takes. It does the
 * part of a managed install the manifest service does, and nothing more.
 *
 * The rule (the stage-0 ACCEPT's Q5 and Q7 answers): a declared mode is
 * enforced, there is no partial copy, and every refusal that can be judged is
 * raised BEFORE the base exists. So a body carrying anything the copy cannot
 * reproduce as environment rows is refused whole, naming each key:
 *
 *  - a type the registry declares runtime-uncreatable (`allowRuntimeCreate:
 *    false`) — asked of the save door's own predicate, handed in by the caller,
 *    never a list kept here. ⛔ The `OS_METADATA_WRITABLE` hatch is NOT
 *    consulted: opening it for the import would be a second write path;
 *  - code, which has no metadata form at all;
 *  - extensions of ANOTHER package's items, which the environment ledger has no
 *    row for;
 *  - the artifact envelope (`packages`, a nested `manifest`), because one
 *    import copies one package.
 *
 * ## What is deliberately NOT this verb's — and is not dropped
 *
 * Two kinds of key are left to the caller, on purpose, because a managed
 * install leaves them out of the manifest service too:
 *
 *  - `data` (seed datasets) and `translations` (i18n bundles) are SIDE EFFECTS
 *    the install door applies after registering the package, in either mode —
 *    `marketplace-install-local-plugin.ts` step 5 runs the seeds and loads the
 *    bundles. Seeds are data, never metadata items (the artifact loader says
 *    so beside its collection map), so a copy of the metadata cannot carry
 *    them; the door that calls this verb decides their fate;
 *  - deployment configuration (`i18n`, `requires`, `datasourceMapping`, `api`,
 *    …) is read by the BOOT of the stack that declares it, never by an install
 *    of a package, in either mode.
 *
 * Every other key is refused as unrecognised: a key added to the stack later
 * is refused here, loudly, until it is classified — never silently skipped.
 */

import { ManifestSchema, manifestIdRefusal, deriveNamespaceFromPackageId } from '@objectstack/spec/kernel';
import { METADATA_ITEM_NAME_PATTERN, PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { ASSEMBLED_VIEW_ITEMS_KEY, expandViewContainer, isAggregatedViewContainer } from '@objectstack/spec/ui';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { resolveTenancyPosture } from '@objectstack/types';
import { deriveViewContainerObject } from '@objectstack/metadata/view-container';

/**
 * How the import treats one top-level key of a package body that is NOT a
 * metadata collection. Collections are read off {@link UNMANAGED_IMPORT_COLLECTIONS}.
 *
 *  - `identity`  — describes the package; carried onto the new base's manifest.
 *  - `base`      — read to mint the base and never carried as written: `id` is
 *                  replaced by the target id, `namespace` is kept, `scope` is
 *                  stripped because the base is a WRITABLE package.
 *  - `code`      — refused: code, or a descriptor of a code-bearing artifact.
 *  - `uncopyable`— refused: package content the environment ledger has no row for.
 *  - `envelope`  — refused: it describes an artifact, not one package.
 *  - `door`      — not this verb's: a side effect the install door applies.
 *  - `deployment`— not this verb's: deployment configuration no install applies.
 */
export type UnmanagedImportKeyDisposition =
    | 'identity'
    | 'base'
    | 'code'
    | 'uncopyable'
    | 'envelope'
    | 'door'
    | 'deployment';

/**
 * Every non-collection key a flattened package body may carry, classified.
 * The union of `ManifestSchema`'s live keys and the stack definition's
 * non-collection keys; `package-unmanaged-install.test.ts` holds it total
 * against both schemas, so a key either schema gains reddens a test instead of
 * being refused at a door with no reason on record.
 */
export const UNMANAGED_IMPORT_KEY_DISPOSITIONS: Readonly<Record<string, UnmanagedImportKeyDisposition>> = {
    // ── The package's identity ──
    id: 'base',
    namespace: 'base',
    scope: 'base',
    name: 'identity',
    version: 'identity',
    type: 'identity',
    description: 'identity',
    // An object with no `datasource` routes to its package's default, so a
    // base that dropped this would move every such object to `default`.
    defaultDatasource: 'identity',
    dependencies: 'identity',
    engines: 'identity',
    engine: 'identity',

    // ── Code, and the descriptors of a code-bearing plugin artifact ──
    functions: 'code',
    onEnable: 'code',
    plugins: 'code',
    devPlugins: 'code',
    runtimeModule: 'code',
    main: 'code',
    runtime: 'code',
    packaging: 'code',
    integrity: 'code',

    // ── Content the environment ledger has no row for ──
    objectExtensions: 'uncopyable',
    picklistExtensions: 'uncopyable',
    navigationContributions: 'uncopyable',
    contributes: 'uncopyable',

    // ── The artifact, not one package ──
    packages: 'envelope',
    manifest: 'envelope',

    // ── The install door's side effects, in either mode ──
    data: 'door',
    translations: 'door',

    // ── Deployment configuration: read by a stack's boot, by no install ──
    i18n: 'deployment',
    datasourceMapping: 'deployment',
    api: 'deployment',
    server: 'deployment',
    appName: 'deployment',
    email: 'deployment',
    sms: 'deployment',
    requires: 'deployment',
    tiers: 'deployment',
    devHint: 'deployment',
    devLogins: 'deployment',
};

/**
 * Every collection the import copies: manifest key → metadata type. The
 * manifest-collection spelling plus the assembled `viewItems` channel, which a
 * managed install registers as `view` items too. Order is the spelling map's,
 * with `viewItems` last, so a view container is written before a standalone
 * view of the same object.
 */
export const UNMANAGED_IMPORT_COLLECTIONS: ReadonlyArray<readonly [key: string, type: string]> = [
    ...Object.entries(PLURAL_TO_SINGULAR),
    [ASSEMBLED_VIEW_ITEMS_KEY, 'view'],
];

/** One item the import writes, in write order. */
export interface UnmanagedImportItem {
    /** Canonical (singular) metadata type. */
    type: string;
    /** The name it is saved under — a view container's is the object it binds. */
    name: string;
    /** The manifest key it came from. */
    key: string;
    /** The body as the package declared it. */
    body: Record<string, unknown>;
    /** The view names a container expands into (empty for every other item). */
    expands: readonly string[];
}

/** Everything the import needs from the body, judged. */
export interface UnmanagedImportPlan {
    sourcePackageId: string;
    sourceVersion?: string;
    /** The base's namespace — the source's, declared or derived from its id. */
    namespace: string;
    targetPackageId: string;
    /** The manifest the new base is installed with. */
    baseManifest: Record<string, unknown>;
    items: UnmanagedImportItem[];
}

/** One reason a body cannot be imported, naming the key that carries it. */
export interface UnmanagedImportFinding {
    key: string;
    reason: string;
}

/** An ADR-0112 error: a registered `code`, its `status`, optional `details`. */
function refusal(code: string, status: number, message: string, details?: Record<string, unknown>): Error {
    return Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) });
}

/** A malformed request: no `code`, so a boundary answers the status-derived `VALIDATION_ERROR`. */
function invalidRequest(message: string): Error {
    return Object.assign(new Error(message), { statusCode: 400 });
}

/**
 * The deployment's REQUESTED tenancy posture, or `null` when the configured
 * value is unrecognised. Requested, never in force (the stage-0 ACCEPT's Q2):
 * a degraded walled boot reports `single` in force and would admit a copy into
 * a deployment its operator declared multi-tenant. Read per call, as
 * `resolveTenancyPosture` reads `process.env` live by contract.
 */
export function requestedTenancyPosture(): TenancyPosture | null {
    try {
        return resolveTenancyPosture();
    } catch {
        return null;
    }
}

/**
 * The walled-posture refusal, or `null` on a `single` deployment. An
 * unrecognised posture value is read as WALLED — the fail-closed direction
 * ADR-0105 argues for on exactly this input, and the one the protocol's other
 * posture gate takes.
 */
export function unmanagedInstallPostureRefusal(
    sourcePackageId: string,
    posture: TenancyPosture | null = requestedTenancyPosture(),
): Error | null {
    if (posture !== null && !postureEnforcesWall(posture)) return null;
    const named = posture === null
        ? 'an unrecognised OS_TENANCY_POSTURE value, read as walled'
        : `the '${posture}' tenancy posture`;
    return refusal(
        'UNMANAGED_INSTALL_WALLED_POSTURE',
        409,
        `Package '${sourcePackageId}' cannot be installed unmanaged on this deployment: it runs ${named}. `
        + 'An unmanaged install copies the package into ONE shared, editable environment ledger, which a '
        + 'deployment that walls organizations from each other cannot hold. Install the package managed '
        + 'instead, or install it unmanaged on a single-organization deployment.',
        { posture: posture ?? 'unrecognised' },
    );
}

/** The uncopyable refusal, naming every finding. */
export function unmanagedInstallUncopyable(sourcePackageId: string, findings: UnmanagedImportFinding[]): Error {
    const shown = findings.slice(0, 5).map((f) => `\`${f.key}\` — ${f.reason}`).join('; ');
    const more = findings.length > 5 ? ` (+${findings.length - 5} more)` : '';
    return refusal(
        'UNMANAGED_INSTALL_UNCOPYABLE',
        422,
        `Package '${sourcePackageId}' cannot be installed unmanaged: ${shown}${more}. An unmanaged install `
        + 'copies every item into the environment ledger or copies nothing, so a package carrying what '
        + 'cannot be copied is refused whole. Install it managed instead.',
        { findings },
    );
}

/** Read a string-valued key, or `undefined`. */
function stringKey(body: Record<string, unknown>, key: string): string | undefined {
    const value = body[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Judge a package body and plan its import. Throws the first refusal the body
 * alone can answer; the store-backed refusals (collisions, an existing target,
 * an owned namespace) are the caller's.
 *
 * @param isRuntimeCreatable The save door's own "may a new item of this type be
 *   created" predicate — passed in so this module never keeps a second answer.
 * @param loadOrderOf The registry's `loadOrder` for a type, so an object is
 *   written before the views and apps that name it.
 */
export function planUnmanagedImport(
    manifest: Record<string, unknown>,
    options: {
        targetPackageId?: string;
        targetName?: string;
        isRuntimeCreatable: (type: string) => boolean;
        loadOrderOf: (type: string) => number;
    },
): UnmanagedImportPlan {
    // The source id, parsed through its declaration — the sentence is the
    // declaration's, surfaced, as every package door surfaces it.
    const rawId = manifest.id;
    const declaredId = ManifestSchema.shape.id.safeParse(rawId);
    if (!declaredId.success) {
        const [issue] = declaredId.error.issues;
        throw invalidRequest(
            typeof rawId === 'string' && issue?.message ? issue.message : manifestIdRefusal('manifest.id', rawId),
        );
    }
    const sourcePackageId = declaredId.data;

    const collectionTypes = new Map(UNMANAGED_IMPORT_COLLECTIONS);
    const findings: UnmanagedImportFinding[] = [];
    const identity: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(manifest)) {
        if (value === undefined) continue;
        const type = collectionTypes.get(key);
        if (type !== undefined) {
            if (!options.isRuntimeCreatable(type) && Array.isArray(value) && value.length > 0) {
                findings.push({
                    key,
                    reason: `${value.length} '${type}' item(s); the metadata-type registry declares '${type}' `
                        + 'runtime-uncreatable, so no environment row can hold one',
                });
            }
            continue;
        }
        const disposition = UNMANAGED_IMPORT_KEY_DISPOSITIONS[key];
        switch (disposition) {
            case 'identity':
                identity[key] = value;
                break;
            case 'code':
                findings.push({ key, reason: 'code, which has no metadata form an environment row can hold' });
                break;
            case 'uncopyable':
                findings.push({
                    key,
                    reason: 'it extends items another package owns, and the environment ledger has no row for that',
                });
                break;
            case 'envelope':
                findings.push({
                    key,
                    reason: key === 'packages'
                        ? 'a release artifact carrying several packages — import each package body on its own'
                        : 'a nested manifest — flatten the bundle (its manifest fields beside its collections) first',
                });
                break;
            case 'base':
            case 'door':
            case 'deployment':
                break;
            default:
                findings.push({ key, reason: 'not a key a package body declares, so the import cannot place it' });
        }
    }
    if (findings.length > 0) throw unmanagedInstallUncopyable(sourcePackageId, findings);

    // The namespace is the SOURCE's (the stage-0 ACCEPT's Q3): every copied
    // object name carries its prefix, and the base must own that prefix for
    // the save door's namespace rule to admit them.
    const namespace = stringKey(manifest, 'namespace') ?? deriveNamespaceFromPackageId(sourcePackageId) ?? undefined;
    if (namespace === undefined) {
        throw invalidRequest(
            `Cannot determine the namespace of package '${sourcePackageId}': it declares none, and none derives `
            + 'from its id. Declare `namespace` on the package — every copied object name carries it.',
        );
    }

    // The target: a NEW base whose id differs from the source (Q3).
    const targetPackageId = options.targetPackageId ?? `${sourcePackageId}-copy`;
    const declaredTarget = ManifestSchema.shape.id.safeParse(targetPackageId);
    if (!declaredTarget.success) {
        throw invalidRequest(manifestIdRefusal('targetPackageId', targetPackageId));
    }
    if (targetPackageId === sourcePackageId) {
        throw invalidRequest(
            `\`targetPackageId\` '${targetPackageId}' is the source package's own id. An unmanaged install writes `
            + 'into a NEW base whose id differs from the source, so nothing is registered under the source id '
            + 'and a later managed install of it is refused by name. Omit `targetPackageId` for '
            + `'${sourcePackageId}-copy', or name another id.`,
        );
    }

    const items = enumerateItems(manifest, options.loadOrderOf);
    const sourceVersion = stringKey(manifest, 'version');
    const baseManifest: Record<string, unknown> = {
        ...identity,
        id: targetPackageId,
        name: options.targetName ?? stringKey(manifest, 'name') ?? sourcePackageId,
        namespace,
    };
    return {
        sourcePackageId,
        ...(sourceVersion !== undefined ? { sourceVersion } : {}),
        namespace,
        targetPackageId,
        baseManifest,
        items,
    };
}

/**
 * Every item of every collection, named the way the artifact loader names it
 * (a `defineView` container takes the object it binds), validated, and sorted
 * into write order. Refuses a collection that is not an array, an item that is
 * not an object or has no name, a name the save door's grammar refuses, and two
 * items claiming one name.
 */
function enumerateItems(
    manifest: Record<string, unknown>,
    loadOrderOf: (type: string) => number,
): UnmanagedImportItem[] {
    const items: Array<UnmanagedImportItem & { rank: [number, number, number] }> = [];
    const problems: string[] = [];
    UNMANAGED_IMPORT_COLLECTIONS.forEach(([key, type], keyIndex) => {
        const value = manifest[key];
        if (value === undefined) return;
        if (!Array.isArray(value)) {
            problems.push(`\`${key}\` is not an array of ${type} definitions`);
            return;
        }
        value.forEach((body: unknown, index) => {
            if (body === null || typeof body !== 'object' || Array.isArray(body)) {
                problems.push(`\`${key}[${index}]\` is not a ${type} definition object`);
                return;
            }
            const container = type === 'view' && isAggregatedViewContainer(body);
            const named = (body as { name?: unknown }).name;
            const name = container || (type === 'view' && !named)
                ? deriveViewContainerObject(body)
                : (typeof named === 'string' ? named : undefined);
            if (typeof name !== 'string' || name === '') {
                problems.push(`\`${key}[${index}]\` has no name`);
                return;
            }
            if (!METADATA_ITEM_NAME_PATTERN.test(name)) {
                problems.push(`\`${key}[${index}]\` is named ${JSON.stringify(name)}, which is not a legal metadata item name`);
                return;
            }
            const expands = container ? expandViewContainer(name, body).map((v) => v.name) : [];
            items.push({
                type,
                name,
                key,
                body: body as Record<string, unknown>,
                expands,
                rank: [loadOrderOf(type), keyIndex, index],
            });
        });
    });
    const seen = new Map<string, string>();
    for (const item of items) {
        const slot = `${item.type}/${item.name}`;
        const first = seen.get(slot);
        if (first !== undefined) problems.push(`two items claim ${slot} (\`${first}\` and \`${item.key}\`)`);
        else seen.set(slot, item.key);
    }
    if (problems.length > 0) {
        const shown = problems.slice(0, 5).join('; ');
        // `INVALID_REQUEST` / 400: the save door's own code for a name its
        // grammar refuses, raised here for every item at once instead of for
        // the first one after the base exists.
        throw refusal(
            'INVALID_REQUEST',
            400,
            `The package body cannot be imported as written: ${shown}`
            + `${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}.`,
        );
    }
    items.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
    return items.map(({ rank: _rank, ...item }) => item);
}
