// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The move door: `POST /packages/:id/move-in` (`protocol.moveIntoPackage`) —
 * move a SELECTION of loose (package-less) metadata items into one installed,
 * writable package.
 *
 * ## Why one door, and why it reuses the doors
 *
 * ADR-0084's amendment of 2026-11-26 ("Loose items stay where they are, and one
 * door moves them") and its ruling: a loose item stays where it is unless an
 * author moves it, and the move "runs each item through the save door's judges,
 * judging the selection as a set for the ADR-0150 D3 (a) cross-boundary rule".
 * The old all-at-once adoption (`reassignOrphanedMetadata`) rebound rows with a
 * bare `engine.update` and asked none of the save door's questions, which let it
 * adopt into a package nothing installed, adopt an object its target's namespace
 * prefix refuses, and leave the runtime serving the old address until a restart.
 * This door asks none of those questions itself: every item is removed from its
 * package-less address by the delete door and written into the target by the
 * save door — exactly the two steps the save door's own refusal prescribes for
 * an object held by a package-less definition (`overlayPackageMismatchError`:
 * "delete its package-less definition without dropStorage … then send this save
 * again") — so each item is refused with the save door's code, and every write
 * leaves history, a watch event and the registry write-through the save door
 * performs for every type.
 *
 * ## Whole or nothing (ADR-0067 D2)
 *
 * Three phases, the shape `publishPackageDrafts` takes:
 *
 *  0. Judge, write nothing: every item is loose; the target is installed and
 *     writable; an object's name carries the target's prefix and does not clash
 *     with a namespace, no other package owns it, and its fields keep the `__c`
 *     reservation; and the selection as a set — a moved item that names a loose
 *     item the selection leaves behind would be read from a package caller that
 *     never resolves a bare name to an environment item (ADR-0150 D3 (a)), so it
 *     is refused naming what it leaves behind.
 *  1. Objects, each through the delete door (storage kept) and the save door,
 *     OUTSIDE the transaction: an object's save runs its storage sync, which is
 *     DDL, and DDL inside the driver transaction waits forever on the lock the
 *     transaction holds (measured on SQLite; `publishPackageDrafts` defers the
 *     same DDL past its transaction for the same reason). A later refusal undoes
 *     them, newest first. A dry run judges objects in phase 0 alone.
 *  2. Every other item's delete and save inside ONE `engine.transaction()`, the
 *     package commit recorded inside it too. Any refusal rolls them back and
 *     undoes phase 1. A dry run runs the same writes and always rolls back.
 *  3. On a runtime that cannot roll back (`engineCanRollBack`), a refusal undoes
 *     every step already taken, newest first; a dry run there answers phase 0's
 *     judgement alone, because only a rollback makes a write invisible.
 *
 * After any rollback the registry is put back from the restored rows: the save
 * and delete doors mutate the in-memory registry as they go, and that cannot
 * roll back with the store.
 */

import { isPlatformRecordRow } from '@objectstack/metadata';
import { engineCanRollBack, isPackageScopedType } from '@objectstack/core';
import { ENVIRONMENT_ADDRESS_SEGMENT } from '@objectstack/spec/kernel';
import { deriveAiFaceName } from '@objectstack/spec/ai';
import type {
    MoveIntoPackageMovedItemParsed,
    MoveIntoPackageRefusedItemParsed,
    MoveIntoPackageResponseParsed,
} from '@objectstack/spec/api';
import { canonicalMetaType } from './protocol-meta-type-schema.js';
import { collectReferenceHits } from './protocol-reference-hits.js';
import { REFERENCE_SITES } from './reference-sites.js';
import { resolveCallerPackageAddress } from './protocol-exact-qualifier.js';
import { retireOverlayCacheOnRollback } from './meta-overlay-cache.js';
import { extensionFieldSuffixRefusalError, judgeExtensionFieldSuffix } from './protocol-extension-field-suffix.js';
import type { ProtocolHost } from './protocol-host.js';

/** What the door is asked, after the route parsed the body. */
export interface MoveIntoPackageRequest {
    readonly targetPackageId: string;
    readonly items: ReadonlyArray<{ readonly type: string; readonly name: string; readonly member?: string }>;
    readonly dryRun?: boolean;
    /** The signed-in caller the history rows credit; never a name the body supplies. */
    readonly actor?: string;
}

type MoveHost = Pick<ProtocolHost,
    | 'applyRegistryWriteThrough'
    | 'classifyObjectContribution'
    | 'engine'
    | 'ensureOverlayIndex'
    | 'facade'
    | 'findEnvironmentRows'
    | 'getOverlayRepo'
    | 'isArtifactBacked'
    | 'isWritablePackage'
    | 'objectNamespaceObjectNameClash'
    | 'objectNamespacePrefixViolation'
    | 'overlayPackageMismatchError'
    | 'recordPackageCommit'
    | 'refuseOrganizationScopedWrite'
    | 'saveMetaItem'
    | 'storedOverlayEntries'
    | 'uninstalledNamedBaseRefusal'
>;

/** A stored `sys_metadata` row, as the system-context read answers it. */
interface StoredRow extends Record<string, unknown> {
    readonly id?: string;
    readonly type: string;
    readonly name: string;
    readonly state?: string;
    readonly package_id?: string | null;
    readonly member?: string | null;
    readonly metadata?: unknown;
}

/** One selected item, judged loose, with its rows. */
interface LooseItem {
    readonly type: string;
    readonly name: string;
    readonly member?: string;
    readonly active?: StoredRow;
    readonly draft?: StoredRow;
}

/** The ADR-0150 D6 faces: these types are listed to AI clients by a derived name. */
const AI_FACE_TYPES: ReadonlySet<string> = new Set(['tool', 'skill', 'agent', 'action']);

/** The sentinel a dry run throws to roll its transaction back. */
const DRY_RUN_ROLLBACK = Symbol('move-in dry run');

/** Whether a stored row is bound to no package (null, empty, or the legacy `sys_metadata` sentinel). */
function isPackageLessRow(row: { package_id?: unknown }): boolean {
    return row.package_id == null || row.package_id === '' || row.package_id === 'sys_metadata';
}

function bodyOf(row: StoredRow | undefined): Record<string, unknown> | undefined {
    if (!row) return undefined;
    const raw = row.metadata;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) as Record<string, unknown>; } catch { return undefined; }
    }
    return raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
}

function keyOf(item: { type: string; name: string; member?: string | null }): string {
    return `${item.type}/${item.name}${item.member ? `#${item.member}` : ''}`;
}

/** The refusal an error thrown by a door becomes: the door's own code and words. */
function refusalOf(item: { type: string; name: string; member?: string }, e: unknown): MoveIntoPackageRefusedItemParsed {
    const err = e as { code?: unknown; message?: unknown } | undefined;
    return {
        type: item.type,
        name: item.name,
        ...(item.member ? { member: item.member } : {}),
        code: typeof err?.code === 'string' && err.code !== '' ? err.code : 'MOVE_FAILED',
        error: typeof err?.message === 'string' ? err.message : String(e),
    };
}

/** Only the namespace a package's manifest declares (`undefined` for none). */
function namespaceOf(host: Pick<ProtocolHost, 'engine'>, packageId: string): string | undefined {
    const ns = (host.engine as { registry?: { getPackage?: (id: string) => { manifest?: { namespace?: unknown } } | undefined } } | undefined)
        ?.registry?.getPackage?.(packageId)?.manifest?.namespace;
    return typeof ns === 'string' && ns !== '' ? ns : undefined;
}

/** A package's own item of a name in the registry's per-package slot, or `undefined`. */
function packageScopedItemAt(host: Pick<ProtocolHost, 'engine'>, type: string, name: string, packageId: string): unknown {
    const registry = (host.engine as { registry?: { getPackageScopedItem?: (t: string, n: string, p: string) => unknown } } | undefined)?.registry;
    return typeof registry?.getPackageScopedItem === 'function' ? registry.getPackageScopedItem(type, name, packageId) : undefined;
}

/** What a move changes in one item's addresses (ADR-0150 D5 and D6). */
function movedAnswer(item: LooseItem, namespace: string | undefined): MoveIntoPackageMovedItemParsed {
    const states: Array<'active' | 'draft'> = [];
    if (item.active) states.push('active');
    if (item.draft) states.push('draft');
    const answer: MoveIntoPackageMovedItemParsed = {
        type: item.type,
        name: item.name,
        ...(item.member ? { member: item.member } : {}),
        states,
    };
    if (isPackageScopedType(item.type) && namespace) {
        answer.environmentAddress = `${ENVIRONMENT_ADDRESS_SEGMENT}/${item.name}`;
        answer.qualifiedAddress = `${namespace}/${item.name}`;
    }
    if (AI_FACE_TYPES.has(item.type) && namespace) {
        const body = bodyOf(item.active ?? item.draft);
        // An object-bound action's face is `OBJECT-ACTION` under any holder:
        // the move does not change it.
        const objectName = item.type === 'action' && typeof body?.objectName === 'string' && body.objectName !== ''
            ? body.objectName : undefined;
        if (!objectName) {
            const before = deriveAiFaceName({ name: item.name });
            const after = deriveAiFaceName({ name: item.name, namespace });
            if (before !== after) answer.aiFaceName = { before, after };
        }
    }
    return answer;
}

export class ProtocolPackageMoveInFacet {
    /** The body of `ObjectStackProtocolImplementation#moveIntoPackage`; the method's docblock there is its contract. */
    static async moveIntoPackage(host: MoveHost, request: MoveIntoPackageRequest): Promise<MoveIntoPackageResponseParsed> {
        const target = request.targetPackageId;
        host.refuseOrganizationScopedWrite(`Package '${target}'`, request);
        // The store's lazy DDL, BEFORE the transaction, as `publishPackageDrafts`
        // runs it: the first save of a process would otherwise run it inside
        // the driver transaction, where DDL waits on the lock the transaction
        // holds (measured: a move as a fresh boot's first write never answered).
        await host.ensureOverlayIndex();
        const refused: MoveIntoPackageRefusedItemParsed[] = [];
        const refuse = (r: MoveIntoPackageRefusedItemParsed) => { refused.push(r); };
        const answerRefused = (): MoveIntoPackageResponseParsed => ({
            outcome: 'refused', targetPackageId: target, moved: [], refused,
        });

        // ── Phase 0: judge, write nothing ─────────────────────────────────
        const rows = (await host.findEnvironmentRows('sys_metadata', { where: {}, context: { isSystem: true } })) as StoredRow[];
        const looseRows = rows.filter((r) => isPackageLessRow(r) && !isPlatformRecordRow(r));
        const items: LooseItem[] = [];
        const seen = new Set<string>();
        for (const asked of request.items) {
            const type = canonicalMetaType(asked.type);
            const name = asked.name;
            const member = asked.member;
            const key = keyOf({ type, name, member });
            if (seen.has(key)) continue;
            seen.add(key);
            const mine = looseRows.filter((r) => canonicalMetaType(String(r.type)) === type && r.name === name
                && (member === undefined ? r.member == null : r.member === member));
            const active = mine.find((r) => r.state === 'active');
            const draft = mine.find((r) => r.state === 'draft');
            if (!active && !draft) {
                refuse({
                    type, name, ...(member ? { member } : {}), code: 'NOT_LOOSE',
                    error: `No loose ${type} '${name}' is stored here: the door moves only an item bound to no package. `
                        + 'An item a package holds is moved by editing that package, never by this door.',
                });
                continue;
            }
            // [#23198] An overlay of an item the deployment ships keeps its binding (ADR-0070).
            if (host.isArtifactBacked(type, name)) {
                refuse({
                    type, name, ...(member ? { member } : {}), code: 'NOT_LOOSE',
                    error: `The ${type} '${name}' is an item a package ships, and its package-less row is that item's `
                        + 'customization, not a loose item. It stays bound to the item it customizes.',
                });
                continue;
            }
            items.push({ type, name, ...(member ? { member } : {}), ...(active ? { active } : {}), ...(draft ? { draft } : {}) });
        }

        // The target, by the save door's own predicates: installed (A1) and writable.
        const probe = items[0] ?? { type: 'flow', name: '_' };
        const unbound = host.uninstalledNamedBaseRefusal({ type: probe.type, name: probe.name, packageId: target });
        if (unbound) {
            for (const item of items) refuse(refusalOf(item, unbound));
            return answerRefused();
        }
        if (!host.isWritablePackage(target)) {
            for (const item of items) {
                refuse({
                    type: item.type, name: item.name, ...(item.member ? { member: item.member } : {}),
                    code: 'WRITABLE_PACKAGE_REQUIRED',
                    error: `Package '${target}' is not writable here: its items are authored where it is built. `
                        + 'Move loose items into a package you author (or create one).',
                });
            }
            return answerRefused();
        }

        // An object, by the save door's own object judges, against the target:
        // its literal name and the target's namespace (A2, child K), the
        // package that owns the name, and the `__c` reservation. Objects are
        // judged here because phase 1 writes them before the transaction, and a
        // dry run writes none of them.
        for (const item of items) {
            if (item.type !== 'object') continue;
            const prefix = host.objectNamespacePrefixViolation(item.name, target);
            const clash = prefix ? null : host.objectNamespaceObjectNameClash(item.name, target);
            if (prefix || clash) {
                refuse({ type: item.type, name: item.name, code: prefix ? 'NAMESPACE_PREFIX' : 'NAMESPACE_CONFLICT', error: (prefix ?? clash)! });
                continue;
            }
            // The object's own loose registration is the `'sys_metadata'` owner
            // this move hands over; any other owner refuses it.
            const layer = host.classifyObjectContribution(item.name, target);
            if (layer.kind === 'mismatch' && layer.ownerPackageId !== 'sys_metadata') {
                refuse(refusalOf(item, host.overlayPackageMismatchError(item.name, target, layer.ownerPackageId)));
                continue;
            }
            const body = bodyOf(item.active ?? item.draft);
            if (body) {
                const suffix = judgeExtensionFieldSuffix({ packageId: target, objects: { [item.name]: { ...body, name: item.name } } });
                if (suffix.length > 0) refuse(refusalOf(item, extensionFieldSuffixRefusalError(suffix)));
            }
        }

        // The set rule (ADR-0150 D3 (a)): every bare name a moved item writes for
        // a type addressed by package must resolve from the target once the
        // selection has moved. A loose item it names that stays behind is read
        // from a package caller, which never resolves a bare name to an
        // environment item.
        const selected = new Set(items.map((i) => `${i.type}/${i.name}`));
        const looseBehind = looseRows.filter((r) => r.state === 'active'
            && isPackageScopedType(canonicalMetaType(String(r.type)))
            && !selected.has(`${canonicalMetaType(String(r.type))}/${r.name}`)
            && !host.isArtifactBacked(canonicalMetaType(String(r.type)), String(r.name)));
        for (const item of items) {
            const body = bodyOf(item.active ?? item.draft);
            if (!body) continue;
            const behind: Array<{ type: string; name: string }> = [];
            for (const row of looseBehind) {
                const targetType = canonicalMetaType(String(row.type));
                const properties = new Map<string, string>();
                for (const site of REFERENCE_SITES.byTarget.get(targetType) ?? []) {
                    if (site.fromType === item.type) properties.set(site.property, site.target);
                }
                if (properties.size === 0) continue;
                if (collectReferenceHits(body, properties, String(row.name)).length === 0) continue;
                // Resolved from the target, a package holder in its closure answers
                // the name; only a name no such holder has is left behind.
                let reachable = false;
                try {
                    const address = resolveCallerPackageAddress(host, { type: targetType, name: String(row.name), callerPackageId: target });
                    reachable = address.kind === 'package'
                        && packageScopedItemAt(host, targetType, String(row.name), address.packageId) !== undefined;
                } catch {
                    reachable = false;
                }
                if (!reachable) behind.push({ type: targetType, name: String(row.name) });
            }
            if (behind.length > 0) {
                refuse({
                    type: item.type, name: item.name, ...(item.member ? { member: item.member } : {}),
                    code: 'REFERENCE_LEFT_BEHIND',
                    error: `The ${item.type} '${item.name}' names ${behind.map((b) => `${b.type} '${b.name}'`).join(', ')}, `
                        + `which ${behind.length === 1 ? 'is a loose item' : 'are loose items'} this move leaves behind. `
                        + `Read from package '${target}', a bare name never resolves to a loose item (ADR-0150 D3 (a)), `
                        + 'so the reference would stop resolving. Add them to the selection to move them together.',
                    references: behind,
                });
            }
        }
        if (refused.length > 0) return answerRefused();

        const namespace = namespaceOf(host, target);
        const moved = items.map((item) => movedAnswer(item, namespace));
        const canRollBack = engineCanRollBack(host.engine);
        if (request.dryRun && !canRollBack) {
            return { outcome: 'would_move', targetPackageId: target, moved, refused: [] };
        }

        const objects = items.filter((i) => i.type === 'object');
        const others = items.filter((i) => i.type !== 'object');
        const landed: Array<{ item: LooseItem; state: 'active' | 'draft' }> = [];
        let commitId: string | undefined;
        let current: LooseItem | undefined;
        /** One item: its loose row out through the delete door (storage kept), its body into the target through the save door. */
        const moveItem = async (item: LooseItem) => {
            current = item;
            for (const state of ['active', 'draft'] as const) {
                const row = state === 'active' ? item.active : item.draft;
                const body = bodyOf(row);
                if (!row || !body) continue;
                await host.facade.deleteMetaItem({
                    type: item.type,
                    name: item.name,
                    state,
                    packageId: null,
                    dropStorage: false,
                    ...(item.member ? { member: item.member } : {}),
                    ...(request.actor ? { actor: request.actor } : {}),
                });
                landed.push({ item, state });
                await host.saveMetaItem({
                    type: item.type,
                    name: item.name,
                    item: body,
                    mode: state === 'active' ? 'publish' : 'draft',
                    packageId: target,
                    ...(item.member ? { member: item.member } : {}),
                    ...(request.actor ? { actor: request.actor } : {}),
                } as Parameters<MoveHost['saveMetaItem']>[0]);
            }
            current = undefined;
        };
        // ── Phase 2's body: every other item, then the package commit ─────
        const run = async () => {
            for (const item of others) await moveItem(item);
            const commit = await host.recordPackageCommit({
                packageId: target,
                operation: 'apply',
                message: `Move ${items.length} loose item(s) into package '${target}'`,
                ...(request.actor ? { actor: request.actor } : {}),
                items: [...objects, ...others].filter((i) => i.active).map((i) => ({
                    type: i.type, name: i.name, existedBefore: false, prevVersion: null,
                    ...(i.member ? { member: i.member } : {}),
                })),
            });
            commitId = commit?.commitId;
            if (request.dryRun) throw DRY_RUN_ROLLBACK;
        };
        const landedObjects = () => landed.filter((l) => l.item.type === 'object');
        let transacted = false;
        try {
            // ── Phase 1: objects, outside the transaction (their storage sync is DDL) ──
            if (!request.dryRun) {
                for (const item of objects) await moveItem(item);
            }
            const objectSteps = landed.length;
            // ── Phase 2: the rest, in one transaction ─────────────────────
            transacted = true;
            const engine = host.engine;
            if (engineCanRollBack(engine)) {
                try {
                    await retireOverlayCacheOnRollback(engine, () => engine.transaction(() => run()));
                } catch (e: unknown) {
                    // Rolled back in storage: what the transaction wrote is gone.
                    landed.splice(objectSteps);
                    throw e;
                }
            } else {
                await run();
            }
        } catch (e: unknown) {
            if (canRollBack) {
                if (transacted) await ProtocolPackageMoveInFacet.restoreRegistry(host, others, target);
                await ProtocolPackageMoveInFacet.undoLanded(host, landedObjects(), target, request.actor);
            } else {
                await ProtocolPackageMoveInFacet.undoLanded(host, landed, target, request.actor);
            }
            if (e === DRY_RUN_ROLLBACK) {
                return { outcome: 'would_move', targetPackageId: target, moved, refused: [] };
            }
            const cause = current ?? items[0]!;
            refuse(refusalOf(cause, e));
            return answerRefused();
        }
        return { outcome: 'moved', targetPackageId: target, moved, refused: [], ...(commitId ? { commitId } : {}) };
    }

    /**
     * After a rollback the store holds every loose row again, but the delete
     * and save doors already moved the in-memory registry: put each item back
     * at its package-less address, from its restored body.
     */
    static async restoreRegistry(host: MoveHost, items: readonly LooseItem[], target: string): Promise<void> {
        for (const item of items) {
            const body = bodyOf(item.active);
            if (!item.active || !body) continue;
            try {
                const [entry] = host.storedOverlayEntries({ type: item.type }, [item.active as never]);
                await host.applyRegistryWriteThrough({
                    type: item.type,
                    name: entry?.name ?? item.name,
                    item: entry?.data ?? body,
                    packageId: null,
                    organizationId: null,
                    reboundFrom: { packageId: target },
                });
            } catch (err: any) {
                console.error(
                    `[Protocol] moveIntoPackage: the move of ${item.type}/${item.name} into '${target}' was rolled back `
                    + `in storage, but the registry could not be put back: ${err?.message ?? err}. Until the next restart `
                    + 'the running process may serve the item at its package address although no row binds it there. '
                    + 'Fix: restart the server; the boot registers the item from its stored row.',
                );
            }
        }
    }

    /**
     * Undo each step no transaction covered, newest first — every step on a
     * runtime that cannot roll back, the objects' steps on one that can:
     * remove the row written into the target, put the loose row back as it was
     * stored, then put the registry back at the package-less address.
     */
    static async undoLanded(
        host: MoveHost,
        landed: ReadonlyArray<{ item: LooseItem; state: 'active' | 'draft' }>,
        target: string,
        actor: string | undefined,
    ): Promise<void> {
        const repo = host.getOverlayRepo();
        for (const { item, state } of [...landed].reverse()) {
            const row = state === 'active' ? item.active : item.draft;
            const body = bodyOf(row);
            try {
                try {
                    await host.facade.deleteMetaItem({
                        type: item.type, name: item.name, state, packageId: target, dropStorage: false,
                        ...(item.member ? { member: item.member } : {}),
                        ...(actor ? { actor } : {}),
                    });
                } catch {
                    // The save never wrote it: nothing to remove.
                }
                // `runtime-only`: the loose row is an item no package ships, put
                // back where it was. The default intent (`override-artifact`) is
                // refused on a type with no overlay channel, an object among them
                // (measured: refused as a sealed managed item).
                await repo.put({ type: item.type, name: item.name, org: 'env' } as never, body, {
                    state,
                    // The delete above left no head at the package-less address.
                    parentVersion: null,
                    source: 'protocol.moveIntoPackage',
                    actor: actor ?? null,
                    message: `undo the move of ${item.type}/${item.name}: the move into '${target}' was refused`,
                    intent: 'runtime-only',
                    packageId: null,
                    ...(item.member ? { member: item.member } : {}),
                } as never);
                // The registry is put back here, after the put, so the census
                // (protocol.view-expansion-reconcile-call-sites.test.ts) reads
                // the write and its write-through in one member.
                if (state === 'active') {
                    const [entry] = host.storedOverlayEntries({ type: item.type }, [row as never]);
                    await host.applyRegistryWriteThrough({
                        type: item.type,
                        name: entry?.name ?? item.name,
                        item: entry?.data ?? body,
                        packageId: null,
                        organizationId: null,
                        reboundFrom: { packageId: target },
                    });
                }
            } catch (err: any) {
                console.error(
                    `[Protocol] moveIntoPackage: the refused move of ${item.type}/${item.name} into '${target}' could `
                    + `not be undone (a write no transaction covered): ${err?.message ?? err}. The item may now be `
                    + 'stored in neither place, or in the target, although the answer says nothing moved. Fix: '
                    + `re-save ${item.type}/${item.name} from its history (GET /meta/${item.type}/${item.name}/history).`,
                );
            }
        }
    }
}
