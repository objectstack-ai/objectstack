// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 6] The save door's refusals of `ObjectStackProtocolImplementation`
 * — the item-name grammar (`refuseUngrammaticalMetaItemName`), the default
 * record page and external-binding refusals (`defaultRecordPageSaveRefusal`,
 * `externalBindingSaveRefusal` with `externalBindingDatasourceDefinition` and
 * `objectsBoundExternallyTo`), the anonymous elevated-flow pair
 * (`anonymousElevatedFlowRefusal`), the authored lock family
 * (`authoredLockFamily`), the write binding (`saveWriteBinding`) and the
 * namespace-prefix check (`objectNamespacePrefixViolation`) — moved out of
 * `protocol.ts` whole. Three members between them stay in the class:
 * `refuseUnmintableMetaType` and `metaTypeNamespaceExists`, whose
 * environment-row read `check-durability-degradation-log-level` follows through
 * `saveMetaItem`, and `viewContainerNameCollisionRefusal` (with its one helper,
 * `overlaidShippedContainerViewNames`), a `lookupArtifactItem(` site that
 * `protocol.lookup-artifact-item-call-sites.test.ts` reads in `protocol.ts`.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, made as the
 * same principal, refusing exactly where they did with the same codes and
 * messages. The module-level declarations only these bodies read
 * (`LOCK_FAMILY_KEYS`, `lockFamilyOf`, `sameLockFamily`, `withLockFamily`,
 * `authoredLockFamilyRefusal`) moved with them, also unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature — and each body is one literal of
 * exactly the {@link SaveDoorRefusalHost} members that method reads, plus a
 * `.call`. A method is handed over as a closure that calls it on the protocol
 * at call time, so a test double or spy set on the instance is still the one
 * the body reaches, and the moved bodies that call one another do so through
 * the protocol, exactly as before.
 *
 * The fields the bodies read, `engine` and `getServicesRegistry`, go as
 * GETTERS, so each read happens when the body makes it: tests replace them on
 * a constructed protocol.
 *
 * The other module-level declarations the bodies read stay in `protocol.ts`,
 * where code that did not move reads them too, and are imported from there:
 * the module cycle is evaluation-safe because every one of them is read only
 * inside a function body, never while the two modules are first evaluated.
 * `index.ts` names what it publishes from `protocol.ts` one by one, so the
 * `export` they gained for this keeps them off the published surface, and
 * nothing re-exports this module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation, MetadataIssueEntry, MetadataWriteFace } from './protocol.js';
import { overlaySchemaDeclaredKey, specValidationFindings } from './protocol.js';
// [ADR-0138 D2b] The one cross-item judge of the anonymous flow endpoint ×
// `runAs: 'system'` flow pair, and the flow-direction refusal it words — see
// `anonymousElevatedFlowRefusal`.
import {
    anonymousElevatedFlowPairs,
    elevatedFlowAnonymousEndpointsMessage,
    type AnonymousFlowDoorCandidate,
} from '@objectstack/spec/api';
import { resolveItemLock, withItemLockFamily } from './item-lock.js';
import type { ItemAddress } from './item-lock.js';
import { itemDiscriminator } from '@objectstack/metadata-core';
import { externalBindingDatasourceRefusal } from '@objectstack/spec/data';
import { METADATA_ITEM_NAME_PATTERN } from '@objectstack/spec/shared';
import { defaultRecordPageObject } from '@objectstack/spec/ui';
import { MetadataProtectionFields, validateObjectNamespacePrefix } from '@objectstack/spec/kernel';

/** The lock family `body` carries: each member with a value, and nothing else. */
function lockFamilyOf(body: unknown): Record<string, unknown> {
    const family: Record<string, unknown> = {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) return family;
    for (const key of LOCK_FAMILY_KEYS) {
        const value = (body as Record<string, unknown>)[key];
        if (value !== undefined) family[key] = value;
    }
    return family;
}

/** Do two lock families state the same members with the same values? */
function sameLockFamily(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    return LOCK_FAMILY_KEYS.every((key) => a[key] === b[key]);
}

/**
 * [ADR-0010 §3.5 and §4.1] The save door's refusal of a body whose lock family
 * would set, change or remove the item's lock: an author's write never does
 * any of the three. See {@link ObjectStackProtocolImplementation.authoredLockFamily}
 * for what is judged against what, and for the echo it accepts.
 *
 * The refusal family {@link protectionBlockRefusal} gives the `protection`
 * block, at the same position: `VALIDATION_ERROR` / 400, no code minted, the
 * prescription first because a 4xx message crosses the REST boundary bounded
 * at 500 characters with its tail truncated. It is located twice: the message
 * names every `_lock*` key the body sent, and `issues[]` carries each as a
 * path, the shape the Studio designer keys on. The remedy is to remove them —
 * a body that sends no `_lock*` key keeps the lock the item has — and the
 * door it names for a lock is the one ADR-0010 states: a code package's
 * loader, translating `protection` (Phase 4.3).
 */
function authoredLockFamilyRefusal(
    type: string,
    saveName: string,
    sent: Record<string, unknown>,
    served: Record<string, unknown>,
): Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] } {
    const keys = LOCK_FAMILY_KEYS.filter((key) => sent[key] !== undefined);
    const servedLock = served._lock ?? 'none';
    const sentLock = sent._lock ?? 'none';
    const effect = servedLock === 'none'
        ? (sentLock === 'none' ? 'add lock keys to it' : 'set a lock on it')
        : sentLock === 'none' ? 'remove its lock' : 'change its lock';
    const err = new Error(
        `Remove ${keys.map((key) => `\`${key}\``).join(', ')} from ${type} '${saveName}' and send it again. `
        + `Nothing was written. They would ${effect}, and the metadata API never sets, changes or removes a lock: `
        + 'an item saved here is authored in this system (ADR-0010 §3.5). To lock an item, declare `protection` '
        + "on it in a code package's source, where the package loader translates it into the item's lock "
        + '(ADR-0010 Phase 4.3).',
    ) as Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] };
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    err.issues = keys.map((key) => ({
        path: key,
        message: "Not accepted through the metadata API: only a code package's loader sets an item's lock. "
            + 'Sent back exactly as a read of this item serves it, the key is accepted and ignored.',
        code: 'custom',
    }));
    return err;
}

/**
 * `body` carrying exactly `family` as its lock family: every member `family`
 * states, and no other `_lock*` key. Returns `body` itself when nothing
 * changes, and a copy otherwise, so a caller's own body is never mutated.
 */
function withLockFamily(body: Record<string, unknown>, family: Record<string, unknown>): Record<string, unknown> {
    const unchanged = LOCK_FAMILY_KEYS.every((key) =>
        family[key] === undefined ? !Object.prototype.hasOwnProperty.call(body, key) : body[key] === family[key]);
    if (unchanged) return body;
    const out: Record<string, unknown> = { ...body };
    for (const key of LOCK_FAMILY_KEYS) {
        if (family[key] === undefined) delete out[key];
        else out[key] = family[key];
    }
    return out;
}

/**
 * [ADR-0010 §3.3] The lock family: the `_lock*` members of the protection
 * envelope every metadata type spreads (`MetadataProtectionFields`), read off
 * that declaration so this file keeps no list of its own.
 */
const LOCK_FAMILY_KEYS: readonly string[] = Object.freeze(
    Object.keys(MetadataProtectionFields).filter((key) => key.startsWith('_lock')),
);

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface SaveDoorRefusalHost {
    artifactLockLayerAt: ObjectStackProtocolImplementation['artifactLockLayerAt'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    externalBindingDatasourceDefinition: ObjectStackProtocolImplementation['externalBindingDatasourceDefinition'];
    getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    readonly getServicesRegistry: ObjectStackProtocolImplementation['getServicesRegistry'];
    listDrafts: ObjectStackProtocolImplementation['listDrafts'];
    objectsBoundExternallyTo: ObjectStackProtocolImplementation['objectsBoundExternallyTo'];
    overlayLockLayerAt: ObjectStackProtocolImplementation['overlayLockLayerAt'];
    readActiveOverlayRows: ObjectStackProtocolImplementation['readActiveOverlayRows'];
    readMetaItem: ObjectStackProtocolImplementation['readMetaItem'];
    rethrowUnlessMetadataStoreUnprovisioned: ObjectStackProtocolImplementation['rethrowUnlessMetadataStoreUnprovisioned'];
    storedOverlayEntries: ObjectStackProtocolImplementation['storedOverlayEntries'];
}

/** The body of `ObjectStackProtocolImplementation#refuseUngrammaticalMetaItemName`; the method's docblock there is its contract. */
export function refuseUngrammaticalMetaItemName(request: { type: string, name: string }): void {
    if (METADATA_ITEM_NAME_PATTERN.test(request.name)) return;
    const err = new Error(
        `${JSON.stringify(request.name)} is not a legal metadata item name. `
        + `Item names are lowercase snake_case segments, optionally dot-qualified — `
        + `/^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$/ — e.g. 'crm_lead' or 'crm_lead.pipeline'. `
        + `No slashes, spaces, uppercase, empty segments, or leading/trailing dots. `
        + `The compound '<section>/<name>' spelling is retired: qualify with a dot `
        + `('crm_lead.pipeline') and express containment structurally, never with a `
        + `separator inside the identity string.`,
    );
    (err as any).code = 'INVALID_REQUEST';
    (err as any).status = 400;
    throw err;
}

/** The body of `ObjectStackProtocolImplementation#defaultRecordPageSaveRefusal`; the method's docblock there is its contract. */
export async function defaultRecordPageSaveRefusal(
    this: Pick<SaveDoorRefusalHost, 'engine' | 'readActiveOverlayRows' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'storedOverlayEntries'>,
    type: string,
    item: unknown,
    saveName: string,
    verb: 'saved' | 'published' | 'restored' = 'saved',
): Promise<(Error & { code: 'DEFAULT_RECORD_PAGE_CONFLICT'; status: 422 }) | undefined> {
    if (type !== 'page') return undefined;
    const object = defaultRecordPageObject(item);
    if (object === undefined) return undefined;

    // `shipped`: a page a package ships through the registry, which no save
    // can edit; a stored row (bound to a package or not) is editable here.
    type Holder = { page: string; packageId?: string; shipped: boolean };
    const holders: Holder[] = [];
    let records: any[] = [];
    try {
        // [ADR-0131 D6] A save lands environment-wide, so the pages it meets
        // are the environment-wide rows.
        records = await this.readActiveOverlayRows({ type });
    } catch (error) {
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    const stored = this.storedOverlayEntries({ type }, records);
    const storedNames = new Set(stored.map((entry) => entry.name));
    for (const entry of stored) {
        if (entry.name === saveName || defaultRecordPageObject(entry.data) !== object) continue;
        holders.push(entry.packageId
            ? { page: entry.name, packageId: entry.packageId, shipped: false }
            : { page: entry.name, shipped: false });
    }
    const registry = this.engine.registry;
    if (typeof registry?.defaultRecordPageHoldersOf === 'function') {
        const registered = registry.defaultRecordPageHoldersOf(object) as Array<
            { kind: 'package'; packageId: string; page: string } | { kind: 'environment'; page: string }
        >;
        for (const holder of registered) {
            if (holder.page === saveName || storedNames.has(holder.page)) continue;
            holders.push(holder.kind === 'package'
                ? { page: holder.page, packageId: holder.packageId, shipped: true }
                : { page: holder.page, shipped: false });
        }
    }
    if (holders.length === 0) return undefined;

    const seen = new Set<string>();
    const unique = holders.filter((h) => {
        const key = `${h.packageId ?? ''}|${h.page}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    const describe = (h: Holder) =>
        h.packageId ? `page '${h.page}' of package '${h.packageId}'` : `page '${h.page}', authored in this system`;
    const named = unique.map(describe);
    const others = named.length === 1 ? `${named[0]} already is` : `${named.join(' and ')} already are`;
    const remedy = unique.some((h) => h.shipped)
        ? `Save '${saveName}' with \`isDefault: false\`: a page a package ships stays the default unless the `
          + `deployment is composed without that package's page.`
        : `Save '${saveName}' with \`isDefault: false\`, or first save ${unique.map((h) => `'${h.page}'`).join(' and ')} `
          + `with \`isDefault: false\` to make '${saveName}' the default instead.`;
    const err = new Error(
        `Default record page conflict: page '${saveName}' cannot be ${verb} as the default record page of object `
        + `'${object}': ${others}. ${remedy} At most one \`isDefault: true\` record page may exist for an object `
        + `in a deployment: the record view opens that page with no tie-break.`,
    ) as Error & { code: 'DEFAULT_RECORD_PAGE_CONFLICT'; status: 422; object: string; holders: readonly Holder[] };
    err.code = 'DEFAULT_RECORD_PAGE_CONFLICT';
    err.status = 422;
    err.object = object;
    err.holders = unique;
    return err;
}

/**
 * The body of `ObjectStackProtocolImplementation#permissionSetNameCollisionRefusal`;
 * the method's docblock there is its contract.
 *
 * A `permission` set's name is its identity across the whole deployment: a
 * grant (`sys_user_permission_set.permission_set`) resolves its set by that
 * name alone (ADR-0131 D4), and the security catalog answers one definition per
 * name. So a name may belong to exactly one owner, and a write that would
 * publish a SECOND set of a name an ACTIVE set already holds under a DIFFERENT
 * owner is refused here, with nothing written — a package never writes into a
 * record another owns (ADR-0086 D4).
 *
 * `owner` is the publishing package (`package_id` / `_packageId`), or `null`
 * for an environment-authored runtime set; `permission` takes no environment
 * overlay (`allowEnvironmentOverlay: false`, ADR-0005), so a name a package
 * holds is never an environment author's to re-use either, and the predicate is
 * symmetric: a write's owner that is not an active holder's owner is foreign.
 * The same-owner edit path (the owning package re-authoring its own set) is
 * untouched. The active holders are read from BOTH the stored environment rows
 * (a set published through the metadata door) and the engine registry (a set a
 * package ships in code); a registry item is counted only when it names its
 * owner, so an item of unprovable provenance never invents a rejection — the
 * stance the store-unavailable branch takes too ({@link rethrowUnlessMetadataStoreUnprovisioned}).
 */
export async function permissionSetNameCollisionRefusal(
    this: Pick<SaveDoorRefusalHost, 'engine' | 'readActiveOverlayRows' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'storedOverlayEntries'>,
    singularType: string,
    name: string,
    writePackageId: string | null | undefined,
    verb: 'save' | 'publish',
): Promise<(Error & { code: 'RESOURCE_CONFLICT'; status: 409 }) | undefined> {
    if (singularType !== 'permission') return undefined;
    const writeOwner = typeof writePackageId === 'string' && writePackageId !== '' ? writePackageId : null;

    // Every owner that already holds an ACTIVE set under this name.
    const owners = new Set<string | null>();
    let records: any[] = [];
    try {
        // [ADR-0131 D6] A save lands environment-wide, so the sets it meets are
        // the environment-wide rows. An UNPROVISIONED store counts as "no
        // stored sets"; any other read failure propagates — answering "no
        // other owner" from a read that never happened would accept the very
        // second set this exists to refuse.
        records = await this.readActiveOverlayRows({ type: singularType });
    } catch (error) {
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    for (const entry of this.storedOverlayEntries({ type: singularType }, records)) {
        if (entry.name !== name) continue;
        owners.add(entry.packageId ?? null);
    }
    const registry = this.engine.registry;
    if (typeof registry?.getItem === 'function') {
        let registered: unknown;
        try {
            registered = registry.getItem(singularType, name);
        } catch {
            registered = undefined;
        }
        if (registered && typeof registered === 'object') {
            const owner = (registered as { _packageId?: unknown })._packageId;
            // Count a registry holder only when it names its owner: an item of
            // unprovable provenance is not proof of a foreign owner.
            if (typeof owner === 'string' && owner !== '') owners.add(owner);
        }
    }

    const foreign = [...owners].filter((owner) => owner !== writeOwner);
    if (foreign.length === 0) return undefined;

    const describe = (owner: string | null) => (owner === null ? 'this environment' : `package '${owner}'`);
    const held = [...new Set(foreign.map(describe))].join(' and ');
    const mine = describe(writeOwner);
    const err = new Error(
        `A permission set named '${name}' already belongs to ${held}. ${mine} cannot ${verb === 'publish' ? 'publish' : 'save'} `
        + `a second set of that name: a permission set's name is its identity across the whole deployment — a grant resolves `
        + `its set by name alone (ADR-0131 D4), and no package writes into a record another owns (ADR-0086 D4), so one name `
        + `must resolve to exactly one set. Nothing was written. Rename this set to a name ${mine} owns (prefix it with your `
        + `own module prefix), or edit the existing set in the package that owns it and re-publish.`,
    ) as Error & { code: 'RESOURCE_CONFLICT'; status: 409 };
    err.code = 'RESOURCE_CONFLICT';
    err.status = 409;
    return err;
}

/** The body of `ObjectStackProtocolImplementation#externalBindingSaveRefusal`; the method's docblock there is its contract. */
export async function externalBindingSaveRefusal(
    this: Pick<SaveDoorRefusalHost, 'externalBindingDatasourceDefinition' | 'objectsBoundExternallyTo'>,
    singularType: string,
    item: unknown,
    name: string,
    writeFace?: MetadataWriteFace,
): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const body = item as { external?: unknown; datasource?: unknown };
    const issues: MetadataIssueEntry[] = [];
    if (singularType === 'object') {
        if (body.external === undefined || body.external === null) return undefined;
        const datasource = typeof body.datasource === 'string' && body.datasource !== '' ? body.datasource : undefined;
        const definition = datasource === undefined
            ? undefined
            : await this.externalBindingDatasourceDefinition(datasource);
        const refusal = externalBindingDatasourceRefusal(name, body.external, datasource, definition);
        if (refusal) issues.push({ path: refusal.path, message: refusal.message, code: 'custom' });
    } else if (singularType === 'datasource') {
        for (const bound of await this.objectsBoundExternallyTo(name)) {
            const refusal = externalBindingDatasourceRefusal(bound.name, bound.external, name, item as { schemaMode?: unknown });
            if (refusal?.shape === 'managed') issues.push({ path: 'schemaMode', message: refusal.message, code: 'custom' });
        }
    }
    if (issues.length === 0) return undefined;
    const err = new Error(
        `${singularType}/${name} failed spec validation: ${specValidationFindings(writeFace, issues)}`,
    ) as Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] };
    err.code = 'INVALID_METADATA';
    err.status = 422;
    err.issues = issues;
    return err;
}

/** The body of `ObjectStackProtocolImplementation#externalBindingDatasourceDefinition`; the method's docblock there is its contract. */
export async function externalBindingDatasourceDefinition(
    this: Pick<SaveDoorRefusalHost, 'readMetaItem'>,
    datasource: string,
): Promise<{ readonly schemaMode?: unknown } | undefined> {
    const definition = (await this.readMetaItem({ type: 'datasource', name: datasource }))?.item;
    return definition && typeof definition === 'object' ? definition as { schemaMode?: unknown } : undefined;
}

/**
 * The body of `ObjectStackProtocolImplementation#unknownDatasourceSaveRefusal`;
 * the method's docblock there is its contract. [#26724] Written here after the
 * cut-6 move, beside the external-binding refusal it sits next to at every
 * door, rather than moved: its reads are the same by-name read
 * (`readMetaItem`) plus the engine's registered drivers.
 */
export async function unknownDatasourceSaveRefusal(
    this: Pick<SaveDoorRefusalHost, 'engine' | 'listDrafts' | 'readMetaItem'>,
    singularType: string,
    item: unknown,
    name: string,
    pending?: 'drafts' | ReadonlySet<string>,
    writeFace?: MetadataWriteFace,
): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
    if (singularType !== 'object') return undefined;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const raw = (item as { datasource?: unknown }).datasource;
    if (typeof raw !== 'string' || raw === '' || raw === 'default') return undefined;
    const datasource = raw;
    // An engine that cannot name its registered drivers cannot say a name is
    // unknown: a driver registered at run time (a `driver.*` service, an
    // `onEnable` `drivers.register`) declares no datasource item.
    const getDriverByName = (this.engine as { getDriverByName?: unknown } | undefined)?.getDriverByName;
    if (typeof getDriverByName !== 'function') return undefined;
    if (getDriverByName.call(this.engine, datasource)) return undefined;
    // A declared datasource: the environment's stored row, else the code
    // layer's definition. Its driver may not be connected (yet, or ever);
    // that is reported where it is used, not refused here.
    if ((await this.readMetaItem({ type: 'datasource', name: datasource }))?.item) return undefined;
    // A datasource still pending: any draft, for a draft save; the batch's
    // own drafts, for a package publish.
    const pendingDraft = pending instanceof Set
        ? pending.has(datasource)
        : pending === 'drafts' && (await this.listDrafts({ type: 'datasource' })).drafts.some((d) => d.name === datasource);
    if (pendingDraft) return undefined;
    // The binding the object already holds is not this save's: a re-save, a
    // stored-row migration or a restore that keeps it is judged at the save
    // that introduced it. (A declaration boot never runs `onEnable`, so a
    // driver registered there is absent from it.)
    const current = (await this.readMetaItem({ type: 'object', name }))?.item as { datasource?: unknown } | undefined;
    if (current?.datasource === datasource) return undefined;
    const issues: MetadataIssueEntry[] = [{
        path: 'datasource',
        message: `Object '${name}' names datasource '${datasource}', and no datasource of that name exists here: `
            + `none is declared (a \`*.datasource.ts\` or a saved \`datasource\`) and no driver is registered under it. `
            + 'An object bound to it never registers, so every data call on it would answer 404. Correct the name, '
            + `declare datasource '${datasource}' first, or remove \`datasource\` to use the primary datasource ('default').`,
        code: 'custom',
    }];
    const err = new Error(
        `${singularType}/${name} failed spec validation: ${specValidationFindings(writeFace, issues)}`,
    ) as Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] };
    err.code = 'INVALID_METADATA';
    err.status = 422;
    err.issues = issues;
    return err;
}

/** The body of `ObjectStackProtocolImplementation#objectsBoundExternallyTo`; the method's docblock there is its contract. */
export async function objectsBoundExternallyTo(
    this: Pick<SaveDoorRefusalHost, 'engine' | 'readActiveOverlayRows' | 'rethrowUnlessMetadataStoreUnprovisioned' | 'storedOverlayEntries'>,
    datasource: string): Promise<Array<{ name: string; external: unknown }>> {
    const bound = new Map<string, unknown>();
    let records: any[] = [];
    try {
        records = await this.readActiveOverlayRows({ type: 'object' });
    } catch (error) {
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
    }
    const stored = this.storedOverlayEntries({ type: 'object' }, records);
    const storedNames = new Set(stored.map((entry) => entry.name));
    const take = (name: string, obj: unknown) => {
        const o = obj as { datasource?: unknown; external?: unknown } | null | undefined;
        if (o?.datasource === datasource && o.external !== undefined && o.external !== null) bound.set(name, o.external);
    };
    for (const entry of stored) take(entry.name, entry.data);
    const registry = this.engine.registry;
    if (typeof registry?.getAllObjects === 'function') {
        for (const obj of registry.getAllObjects() as Array<{ name?: unknown }>) {
            if (typeof obj?.name !== 'string' || storedNames.has(obj.name)) continue;
            take(obj.name, obj);
        }
    }
    return [...bound].map(([name, external]) => ({ name, external }));
}

/** The body of `ObjectStackProtocolImplementation#anonymousElevatedFlowRefusal`; the method's docblock there is its contract. */
export async function anonymousElevatedFlowRefusal(
    this: Pick<SaveDoorRefusalHost, 'engine' | 'getServicesRegistry'>,
    singularType: string,
    item: unknown,
    name: string,
): Promise<(Error & { code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[] }) | undefined> {
    if (singularType !== 'flow') return undefined;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    if ((item as { runAs?: unknown }).runAs !== 'system') return undefined;

    const endpoints: unknown[] = [];
    const registry = this.engine.registry;
    if (typeof registry?.listItems === 'function') {
        endpoints.push(...registry.listItems('api'));
    }
    const metadataService = this.getServicesRegistry?.()?.get('metadata');
    if (metadataService && typeof metadataService.list === 'function') {
        const listed = await metadataService.list('api');
        if (Array.isArray(listed)) endpoints.push(...listed);
    }

    const pairs = anonymousElevatedFlowPairs(
        endpoints as AnonymousFlowDoorCandidate[],
        [{ name, runAs: 'system' }],
    );
    if (pairs.length === 0) return undefined;

    const names = [...new Set(pairs.map((pair) => pair.endpoint))];
    const err = new Error(elevatedFlowAnonymousEndpointsMessage(name, names)) as Error & {
        code: 'INVALID_METADATA'; status: 422; issues: MetadataIssueEntry[];
    };
    err.code = 'INVALID_METADATA';
    err.status = 422;
    err.issues = [{
        path: 'runAs',
        message: `An anonymous endpoint (\`authRequired: false\`) triggers this flow: ${names.map((n) => `'${n}'`).join(', ')}. `
            + "No anonymous door may start a `runAs: 'system'` flow (ADR-0138 D2b).",
        code: 'custom',
    }];
    return err;
}

/** The body of `ObjectStackProtocolImplementation#authoredLockFamily`; the method's docblock there is its contract. */
export async function authoredLockFamily(
    this: Pick<SaveDoorRefusalHost, 'artifactLockLayerAt' | 'getOverlayRepo' | 'overlayLockLayerAt' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    args: {
    type: string;
    name: string;
    packageId: string | null | undefined;
    mode: 'draft' | 'publish';
    item: unknown;
}): Promise<unknown> {
    const { item } = args;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const body = item as Record<string, unknown>;
    const sent = lockFamilyOf(body);
    for (const [key, value] of Object.entries(sent)) {
        const declared = overlaySchemaDeclaredKey(args.type, key);
        if (declared !== undefined && !declared.safeParse(value).success) return item;
    }
    const repo = this.getOverlayRepo();
    const ref = { type: args.type, name: args.name, org: 'env' } as Parameters<typeof repo.headAt>[0];
    const state: 'active' | 'draft' = args.mode === 'draft' ? 'draft' : 'active';
    const member = itemDiscriminator(args.type, body);
    const target = await repo.headAt(ref, { state, packageId: args.packageId ?? null, member });
    let head = target.head;
    if (!head && state === 'draft') {
        head = (await repo.headAt(ref, { state: 'active', packageId: target.packageId, member })).head;
    }
    const stored = lockFamilyOf(head?.body);
    if (Object.keys(sent).length > 0 && !sameLockFamily(sent, stored)) {
        const address: ItemAddress = { type: args.type, name: args.name, packageId: args.packageId ?? undefined };
        let overlayLockLayer: unknown;
        try {
            overlayLockLayer = await this.overlayLockLayerAt(address, { otherSpelling: true });
        } catch (error) {
            // [#5532] A lock read that did not happen is not an unlocked item.
            this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        }
        const served = lockFamilyOf(withItemLockFamily({}, resolveItemLock({
            artifact: this.artifactLockLayerAt(address),
            overlay: overlayLockLayer,
        })));
        if (!sameLockFamily(sent, served)) throw authoredLockFamilyRefusal(args.type, args.name, sent, served);
    }
    return withLockFamily(body, stored);
}

/** The body of `ObjectStackProtocolImplementation#saveWriteBinding`; the method's docblock there is its contract. */
export async function saveWriteBinding(
    this: Pick<SaveDoorRefusalHost, 'getOverlayRepo' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    singularType: string,
    request: { name: string; item?: unknown; packageId?: string | null },
    mode: 'draft' | 'publish',
): Promise<string | null> {
    if (typeof request.packageId === 'string' && request.packageId !== '') return request.packageId;
    if (singularType !== 'permission' || mode !== 'draft') return null;
    const body = request.item;
    if (!body || typeof body !== 'object' || typeof (body as { packageId?: unknown }).packageId !== 'string') return null;
    try {
        const repo = this.getOverlayRepo();
        const ref = { type: singularType, name: request.name, org: 'env' } as Parameters<typeof repo.headAt>[0];
        const target = await repo.headAt(ref, {
            state: 'draft',
            packageId: null,
            member: itemDiscriminator(singularType, body),
        });
        return target.packageId;
    } catch (error) {
        this.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        return null;
    }
}

/** The body of `ObjectStackProtocolImplementation#objectNamespacePrefixViolation`; the method's docblock there is its contract. */
export function objectNamespacePrefixViolation(
    this: Pick<SaveDoorRefusalHost, 'engine'>,
    name: string, packageId: string | null | undefined): string | null {
    if (typeof packageId !== 'string' || packageId === '') return null;
    return validateObjectNamespacePrefix(name, this.engine?.registry?.getPackage?.(packageId)?.manifest?.namespace);
}
