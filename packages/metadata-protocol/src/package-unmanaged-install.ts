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
 * which the next save edits, and never follows an upgrade. The package's
 * protection lock is not copied, in either spelling: see "The lock is not
 * copied" below. The orchestration —
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
 * ## Translations are copied; seeds and deployment configuration are not
 *
 *  - `translations` (i18n bundles) are COPIED, converted: each locale of each
 *    bundle becomes one `translation` item named `<namespace>_<locale>` (the
 *    locale lower-cased, its hyphens underscored — `crm_zh_cn`), the bundles
 *    that declare one locale deep-merged in declaration order, as the i18n
 *    service merges bundles. A managed install's bundles reload at every boot
 *    because its install-ledger entry is replayed; an unmanaged install has no
 *    ledger entry, so its bundles live where environment translations live —
 *    in the environment ledger, reloaded at every boot by the
 *    authored-translation sync;
 *  - `data` (seed datasets) is data, never a metadata item (the artifact loader
 *    says so beside its collection map), so a copy of the metadata cannot carry
 *    it; the install door that calls this verb states what it did with it;
 *  - deployment configuration (`i18n`, `requires`, `datasourceMapping`, `api`,
 *    …) is read by the BOOT of the stack that declares it, never by an install
 *    of a package, in either mode.
 *
 * ## The lock is not copied, in either spelling, and each one dropped is named
 *
 * An item a package ships may carry an ADR-0010 protection lock in two
 * spellings: the private envelope every metadata type declares (`_lock`,
 * `_lockReason`, `_lockSource`, `_lockDocsUrl`; §3.3), and the author-facing
 * `protection: { lock, reason, docsUrl }` block the managed loader translates
 * into that envelope (Phase 4.3). The save door keeps the envelope on purpose
 * (a lock an administrator authors on an environment item binds), so a copy
 * written with it answered the next save `403 ITEM_LOCKED`, against D6's
 * "editable in Studio like anything authored there"; the block it stored
 * verbatim and bound nothing, so the vendor's lock vanished unnamed. The
 * ruling on the D6 lock fork (record 6119681934, letter A) settles both: the
 * package permitted `unmanaged` through its `installModes`, so it chose to let
 * environments take editable copies, and a lock whose source is the package
 * has nothing to stand on once the package is no longer the authority. So the
 * plan writes every item without its lock, in either spelling
 * ({@link stripUnmanagedImportLock}), and the import's answer lists each lock
 * it dropped with the package's reason (`strippedLocks`) — the lock a managed
 * install would have bound, so an administrator reads why the vendor locked an
 * item before editing it. ⛔ Not silent: a lock that binds (`no-overlay`,
 * `no-delete`, `full`) is always listed.
 *
 * Two things are left exactly as the save door judges them today, so no
 * refusal of the import changes: a lock the spec's declarations refuse (it
 * reaches the door as declared, and is refused there), and a `protection`
 * block on a type whose schema does not declare one (`action`, `hook`, `page`:
 * the door refuses it as an unrecognized key). Which types declare the block
 * is asked of the save door's own schema resolver, never of a list.
 *
 * The classification of every key is spec's
 * ({@link UNMANAGED_INSTALL_KEY_DISPOSITIONS}, `@objectstack/spec/kernel`), the
 * one table `defineStack` also reads to refuse a package that permits
 * `unmanaged` while carrying what this import refuses. Every key it does not
 * classify is refused as unrecognised: a key added to the stack later is
 * refused here, loudly, until it is classified — never silently skipped.
 */

import {
    ManifestSchema,
    manifestIdRefusal,
    deriveNamespaceFromPackageId,
    UNMANAGED_INSTALL_KEY_DISPOSITIONS,
    unmanagedInstallValueCarries,
    MetadataProtectionFields,
} from '@objectstack/spec/kernel';
import type { ImportUnmanagedPackageResponse } from '@objectstack/spec/api';
import { METADATA_ITEM_NAME_PATTERN, PLURAL_TO_SINGULAR, applyProtection } from '@objectstack/spec/shared';
import { ASSEMBLED_VIEW_ITEMS_KEY, expandViewContainer, isAggregatedViewContainer } from '@objectstack/spec/ui';
import { postureEnforcesWall, type TenancyPosture } from '@objectstack/spec/security';
import { resolveTenancyPosture } from '@objectstack/types';
import { deriveViewContainerObject } from '@objectstack/metadata/view-container';

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
    /** The body as the package declared it, less its protection lock in either spelling ({@link stripUnmanagedImportLock}). */
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
    /** Every lock the items were stripped of, in write order — the answer's `strippedLocks`. */
    strippedLocks: UnmanagedImportStrippedLock[];
}

/**
 * One protection lock an item was shipped with and its copy does not keep — an
 * entry of the answer's `strippedLocks`, typed from that one declaration
 * (`ImportUnmanagedPackageResponseSchema`), never restated here.
 */
export type UnmanagedImportStrippedLock = ImportUnmanagedPackageResponse['strippedLocks'][number];

/**
 * The ADR-0010 envelope keys an unmanaged copy does not carry, each judged by
 * the declaration every metadata type spreads (`MetadataProtectionFields`):
 * the three the ruling on the D6 lock fork names, and `_lockDocsUrl`, the
 * fourth member of the same lock family, which means nothing once `_lock` is
 * gone.
 */
const STRIPPED_ENVELOPE_KEYS = {
    _lock: MetadataProtectionFields._lock,
    _lockReason: MetadataProtectionFields._lockReason,
    _lockSource: MetadataProtectionFields._lockSource,
    _lockDocsUrl: MetadataProtectionFields._lockDocsUrl,
} as const;

/** The author-facing lock block (ADR-0010 Phase 4.3), stripped where the item's type declares it. */
const PROTECTION_KEY = 'protection';

/** The slice of a declaration the strip asks: does it admit this value? */
export interface DeclaredValueJudge {
    safeParse(value: unknown): { success: boolean };
}

/**
 * [ADR-0131 D6, ADR-0010 §3.3 and Phase 4.3] An item's body as its unmanaged
 * copy is written: without its lock in either spelling — the envelope keys
 * ({@link STRIPPED_ENVELOPE_KEYS}) and, on a type whose schema declares one,
 * the `protection` block — and the lock it dropped, when that lock binds
 * (`no-overlay`, `no-delete`, `full`).
 *
 * The lock reported is the one a MANAGED install of the same body would bind,
 * computed by the managed loader's own translation (`applyProtection`) on a
 * scratch copy of the lock keys, never re-derived here. That translation lets
 * the block win: a body carrying both `_lock` and `protection` is bound — and
 * so reported — once, with the block's `lock` and `reason`. `'none'` declares
 * no lock, so nothing is reported for it, nor for an item that carries no lock.
 *
 * Handed on UNTOUCHED, with no report, so the save door judges the body as the
 * package declared it and refuses it as before:
 *  - a lock key whose value its declaration refuses (`_lock: 'locked'`, a
 *    reason that is not a string, a malformed `protection` block);
 * and left in place:
 *  - a `protection` block on a type whose schema does not declare one
 *    (`protectionDeclaration` absent) — the door refuses it as an
 *    unrecognized key, as it always did.
 *
 * @param protectionDeclaration The schema the save door judges `protection` by
 *   on this item's type, or `undefined` when the type declares no such key.
 *
 * Returns the SAME body when there is nothing to strip.
 */
export function stripUnmanagedImportLock(
    type: string,
    name: string,
    body: Record<string, unknown>,
    protectionDeclaration?: DeclaredValueJudge,
): { body: Record<string, unknown>; stripped?: UnmanagedImportStrippedLock } {
    const envelopeKeys = (Object.keys(STRIPPED_ENVELOPE_KEYS) as Array<keyof typeof STRIPPED_ENVELOPE_KEYS>)
        .filter((key) => key in body);
    const block = protectionDeclaration !== undefined && PROTECTION_KEY in body;
    if (envelopeKeys.length === 0 && !block) return { body };
    if (!envelopeKeys.every((key) => STRIPPED_ENVELOPE_KEYS[key].safeParse(body[key]).success)) return { body };
    if (block && !protectionDeclaration.safeParse(body[PROTECTION_KEY]).success) return { body };

    // The lock a managed install would bind: the loader's own translation, run
    // on a scratch object holding only the lock keys, so nothing it stamps
    // (`_provenance`, `_lockSource`) reaches the copy.
    const scratch: Record<string, unknown> = {};
    for (const key of ['_lock', '_lockReason'] as const) if (body[key] !== undefined) scratch[key] = body[key];
    if (block && body[PROTECTION_KEY] !== undefined) scratch[PROTECTION_KEY] = body[PROTECTION_KEY];
    applyProtection(scratch);
    const lock = scratch._lock;
    const reason = scratch._lockReason;

    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
        if (key in STRIPPED_ENVELOPE_KEYS || (block && key === PROTECTION_KEY)) continue;
        rest[key] = value;
    }
    // Past the parses above, the bound lock is absent or one of the four
    // declared states, and every state but `'none'` refuses a save or a delete.
    if (lock === undefined || lock === 'none') return { body: rest };
    return {
        body: rest,
        stripped: {
            type,
            name,
            lock: lock as UnmanagedImportStrippedLock['lock'],
            ...(typeof reason === 'string' ? { reason } : {}),
        },
    };
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
        /**
         * The schema the save door judges `protection` by on a type, or
         * `undefined` when that type's schema declares no such key — read off
         * the door's own resolver, so this module keeps no list of types.
         */
        protectionDeclarationOf: (type: string) => DeclaredValueJudge | undefined;
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
        const disposition = UNMANAGED_INSTALL_KEY_DISPOSITIONS[key];
        // A refusing key that carries nothing — `functions: {}`, `plugins: []` —
        // has nothing to refuse: a refusal names content, never a spelling.
        if ((disposition === 'code' || disposition === 'uncopyable' || disposition === 'envelope')
            && !unmanagedInstallValueCarries(value)) {
            continue;
        }
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
            case 'converted':
                // Copied as `translation` items — refused whole if that type
                // ever stops being one the save door may create.
                if (unmanagedInstallValueCarries(value) && !options.isRuntimeCreatable(TRANSLATION_TYPE)) {
                    findings.push({
                        key,
                        reason: `copied as '${TRANSLATION_TYPE}' items, and the metadata-type registry declares `
                            + `'${TRANSLATION_TYPE}' runtime-uncreatable`,
                    });
                }
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

    // Each item as its copy is written: without the package's lock, every
    // lock dropped listed in write order (the D6 lock-fork ruling, record
    // 6119681934). After the sort, so the list reads in the order items land.
    const strippedLocks: UnmanagedImportStrippedLock[] = [];
    const items = enumerateItems(manifest, options.loadOrderOf, namespace).map((item) => {
        const { body, stripped } = stripUnmanagedImportLock(
            item.type, item.name, item.body, options.protectionDeclarationOf(item.type),
        );
        if (stripped) strippedLocks.push(stripped);
        return body === item.body ? item : { ...item, body };
    });
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
        strippedLocks,
    };
}

/** The metadata type a `translations` bundle's locales are copied as. */
const TRANSLATION_TYPE = 'translation';

/** A plain `{ … }` object — the shape a bundle, and each group in it, takes. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merge `later` into `earlier`, later winning per leaf — the merge the i18n
 * service applies when two bundles declare one locale, so the copied item
 * resolves exactly as the two bundles did. Arrays and scalars replace.
 */
function mergeTranslationData(earlier: Record<string, unknown>, later: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...earlier };
    for (const [key, value] of Object.entries(later)) {
        const prior = out[key];
        out[key] = isPlainRecord(prior) && isPlainRecord(value) ? mergeTranslationData(prior, value) : value;
    }
    return out;
}

/**
 * The item name a locale's translations are copied under: the package's
 * namespace, then the locale lower-cased with its hyphens underscored
 * (`crm` + `zh-CN` → `crm_zh_cn`) — a name the save door's grammar admits, and
 * one that no other package's copy of the same locale can take.
 */
export function unmanagedTranslationItemName(namespace: string, locale: string): string {
    return `${namespace}_${locale.toLowerCase().replace(/-/g, '_')}`;
}

/**
 * The `translations` bundles as `translation` items — one per locale, the
 * bundles that declare a locale merged in declaration order. Each item is the
 * locale's groups as the bundle declares them, plus `name` and `locale`: the
 * `translation` metadata type's item shape, which takes the same groups as a
 * bundle entry. Problems are reported, never skipped.
 */
function translationItems(
    value: unknown,
    namespace: string,
    problems: string[],
): Array<{ name: string; locale: string; body: Record<string, unknown> }> {
    if (!Array.isArray(value)) {
        problems.push('`translations` is not an array of translation bundles');
        return [];
    }
    const byLocale = new Map<string, Record<string, unknown>>();
    value.forEach((bundle: unknown, index) => {
        if (!isPlainRecord(bundle)) {
            problems.push(`\`translations[${index}]\` is not a translation bundle (a map of locale to translations)`);
            return;
        }
        for (const [locale, data] of Object.entries(bundle)) {
            if (!isPlainRecord(data)) {
                problems.push(`\`translations[${index}].${locale}\` is not a locale's translation data`);
                continue;
            }
            const prior = byLocale.get(locale);
            byLocale.set(locale, prior ? mergeTranslationData(prior, data) : data);
        }
    });
    return [...byLocale].map(([locale, data]) => {
        const name = unmanagedTranslationItemName(namespace, locale);
        return { name, locale, body: { ...data, name, locale } };
    });
}

/**
 * Every item of every collection, named the way the artifact loader names it
 * (a `defineView` container takes the object it binds), plus the `translation`
 * items the `translations` bundles convert into — validated, and sorted into
 * write order. Refuses a collection that is not an array, an item that is not
 * an object or has no name, a name the save door's grammar refuses, and two
 * items claiming one name.
 */
function enumerateItems(
    manifest: Record<string, unknown>,
    loadOrderOf: (type: string) => number,
    namespace: string,
): UnmanagedImportItem[] {
    const items: Array<UnmanagedImportItem & { rank: [number, number, number] }> = [];
    const problems: string[] = [];
    if (unmanagedInstallValueCarries(manifest.translations)) {
        translationItems(manifest.translations, namespace, problems).forEach(({ name, body }, index) => {
            if (!METADATA_ITEM_NAME_PATTERN.test(name)) {
                problems.push(`\`translations\` locale '${String(body.locale)}' names the item ${JSON.stringify(name)}, which is not a legal metadata item name`);
                return;
            }
            items.push({
                type: TRANSLATION_TYPE,
                name,
                key: 'translations',
                body,
                expands: [],
                rank: [loadOrderOf(TRANSLATION_TYPE), UNMANAGED_IMPORT_COLLECTIONS.length, index],
            });
        });
    }
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
