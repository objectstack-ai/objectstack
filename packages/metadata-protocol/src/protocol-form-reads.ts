// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159 D5, D6 rule 11] The effective `form` read: the `form` items a
 * caller is served, resolved over BOTH types.
 *
 * Until card ⑤ every first-party form is still an old shape (a `view`
 * container's `form`, a `formViews` entry, a `viewKind: 'form'` item), and a
 * package may move its source to `forms:` while a stored `view` row still
 * stands over the form. So the `form` read is three readings, combined per
 * package address `(package, name)`:
 *
 *  1. **The generic `form` list** — the authored `form` items the registry
 *     holds and the stored `form` rows over them, merged as every type is
 *     merged ({@link ProtocolHost.readFlattenedMetaItems}).
 *  2. **The projection of the served `view` list** — at an address whose
 *     package still authors its form as an old shape, the `view` type
 *     resolves the address today, so the `view` row the served-row order
 *     serves there is the form's body. Each item of the effective `view`
 *     list is projected ({@link projectViewForms}); a projected item is
 *     marked in its envelope ({@link PROJECTED_FORM_SOURCE_KEY}). ⛔ Never
 *     parsed by `FormSchema`: the authored-only refusals do not apply to it.
 *  3. **The cross-type resolution** — at an address whose package authors
 *     the form as a `form` item it has LEFT the `view` type, so the `view`
 *     merge no longer resolves that address. The `form` read asks the
 *     served-row order itself ({@link servedOverlayRowCandidates}), at that
 *     package's address, over the stored rows of both types: the first place
 *     that holds a row of the name decides, a stored `form` row winning over
 *     a stored `view` row at the same place, an item row over a container's
 *     expansion. A `view` row there serves the form it projects; a `view` row
 *     that projects no form at the name (a list, or a body the projection
 *     cannot read) closes the address: nothing is served for the name from
 *     the package (the closed reading, fail-closed). ⛔ "Served" is asked at
 *     each package's address, never taken from the effective `view` list:
 *     one row can be the served row at one package's address and be passed
 *     over at another's.
 *
 * Inside one package and one layer an authored item shadows a projected one
 * of the same name; a package's source item never shadows the projection of
 * a stored row (step 3 runs over the stored rows first).
 *
 * Pure over what the host reads: no write, no registry mutation.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { pairsOf, type InstalledManifestLookup } from '@objectstack/metadata-core';
import { PROJECTED_FORM_SOURCE_KEY, isAggregatedViewContainer, projectViewForms, type UnreadableFormBody } from '@objectstack/spec/ui';
import { installedManifestsOfEngine } from './installed-manifests.js';
import type { ProtocolHost } from './protocol-host.js';
import { holdsServedOverlayCandidate, servedOverlayRowCandidates } from './protocol-overlay-merge.js';
import type { StoredOverlayEntry } from './protocol-stored-overlay-types.js';

/** What one stored row holds at a form's name, as the `form` read reads it. */
export type StoredHolding =
    | { readonly kind: 'form'; readonly item: Record<string, unknown> }
    | { readonly kind: 'closed'; readonly reason: 'list' | 'unreadable' };

/** One stored row of either type, with its binding and what it holds per name. */
interface StoredFormPlace {
    readonly type: 'form' | 'view';
    readonly packageId: string | undefined;
    readonly entry: StoredOverlayEntry;
    /** `item` for a row stored under the name itself, `expansion` for a container that expands it. */
    readonly grain: 'item' | 'expansion';
    readonly holds: ReadonlyMap<string, StoredHolding>;
}

/** The host members the effective `form` read reads. */
export type FormReadHost = Pick<ProtocolHost,
    'engine' | 'readFlattenedMetaItems' | 'readActiveOverlayRows' | 'storedOverlayEntries'
    | 'expandStoredViewContainers' | 'rethrowUnlessMetadataStoreUnprovisioned'>;

const keyOf = (pkg: unknown, name: unknown): string => `${typeof pkg === 'string' ? pkg : ''}\u0000${String(name)}`;

/** The hosts {@link formRequestScope} built, so a scope handed on is never scoped twice. */
const REQUEST_SCOPES = new WeakSet<object>();

/**
 * One request's reading ({@link readInFormRequest}): the scope it built over
 * each host, and whether the request is still reading. Once the request has
 * answered, a scope it built memoizes nothing: a continuation that outlives
 * the request reads the store as any read does.
 */
interface FormRequestReading {
    open: boolean;
    readonly scopes: WeakMap<object, object>;
}

const FORM_REQUEST = new AsyncLocalStorage<FormRequestReading>();

/** The two host members a {@link formRequestScope} replaces. */
type ScopableHost = Pick<FormReadHost, 'readActiveOverlayRows' | 'readFlattenedMetaItems'>;

/**
 * [ADR-0159 D5, D6] Run `read` as ONE request's reading of the two types:
 * every list read and stored-row read inside it, through any of the protocol
 * reads below, shares one {@link formRequestScope} per host. The anonymous
 * form doors read the `view` list, the `form` list, the unreadable bodies and
 * both per-package layers as five protocol calls; inside one reading they read
 * the `view` list once and each type's stored rows once, and each call answers
 * what it answers on its own. The reading ends when `read` settles.
 */
export async function readInFormRequest<T>(read: () => Promise<T>): Promise<T> {
    const reading: FormRequestReading = { open: true, scopes: new WeakMap() };
    try {
        return await FORM_REQUEST.run(reading, read);
    } finally {
        reading.open = false;
    }
}

/**
 * [ADR-0159 D5] ONE request's reading of the two types: the host the `form`
 * read reads through, over which each stored row set (`sys_metadata`, per type
 * and package binding) and each flattened list (per request, audience and
 * layer) is read once, however many of the readings below ask for it.
 *
 * The effective `form` read asks for the same rows more than once by
 * construction: the generic `form` list and step 3 both read the stored `form`
 * rows, and the `view` list and step 3 both read the stored `view` rows. A
 * form door asks the `view` list, the `form` list (which reads the `view` list
 * again), both per-package layers and the unreadable bodies, each over the
 * same stored rows. Read through one scope, the request reads each row set and
 * each list once (measured and pinned in `public-form-reads-once-37709.test.ts`,
 * `@objectstack/rest`). A list read in the scope reads its stored rows through
 * the scope too (`readFlattenedMetaItems`' row reader), so the generic lists
 * and step 3 share one reading of each type's rows.
 *
 * Inside {@link readInFormRequest} the scope is the request's own, shared by
 * every read of that request over the same host; outside one, it is the scope
 * of the one call that built it. ⛔ Never kept across requests (the
 * cross-request row cache is `meta-overlay-cache.ts`, under its own
 * invalidation). Every member the scope does not replace is the host's own,
 * read at call time.
 */
export function formRequestScope<H extends ScopableHost>(host: H): H {
    if (REQUEST_SCOPES.has(host)) return host;
    const reading = FORM_REQUEST.getStore();
    const shared = reading?.scopes.get(host) as H | undefined;
    if (shared !== undefined) return shared;
    const live = (): boolean => reading === undefined || reading.open;
    const rows = new Map<string, Promise<any[]>>();
    const lists = new Map<string, ReturnType<FormReadHost['readFlattenedMetaItems']>>();
    const readActiveOverlayRows: FormReadHost['readActiveOverlayRows'] = (request) => {
        if (!live()) return host.readActiveOverlayRows(request);
        const key = `${request.type}\u0000${request.packageId ?? ''}`;
        let read = rows.get(key);
        if (read === undefined) {
            read = host.readActiveOverlayRows(request);
            rows.set(key, read);
        }
        return read;
    };
    const readFlattenedMetaItems: FormReadHost['readFlattenedMetaItems'] = (request, audience, layer = 'effective') => {
        if (!live()) return host.readFlattenedMetaItems(request, audience, layer);
        const key = JSON.stringify([request.type, request.packageId ?? null, request.names ?? null, request.previewDrafts === true, audience, layer]);
        let read = lists.get(key);
        if (read === undefined) {
            read = host.readFlattenedMetaItems(request, audience, layer, readActiveOverlayRows);
            lists.set(key, read);
        }
        return read;
    };
    const scope = Object.create(host, {
        readActiveOverlayRows: { value: readActiveOverlayRows },
        readFlattenedMetaItems: { value: readFlattenedMetaItems },
    }) as H;
    REQUEST_SCOPES.add(scope);
    reading?.scopes.set(host, scope);
    return scope;
}

/** The scope of the request reading in progress ({@link readInFormRequest}) over `host`, or `host` outside one. */
export function inFormRequestScope<H extends ScopableHost>(host: H): H {
    return FORM_REQUEST.getStore()?.open === true ? formRequestScope(host) : host;
}

/** A listed item's package, as its envelope states it. */
function packageOf(item: unknown): string | undefined {
    const pkg = (item as { _packageId?: unknown } | null)?._packageId;
    return typeof pkg === 'string' && pkg !== '' ? pkg : undefined;
}

/** The base package a stored body declares it overrides, if any. */
function declaredOverrideOf(body: unknown): string | undefined {
    const overrides = (body as { overrides?: unknown } | null)?.overrides;
    const pkg = overrides && typeof overrides === 'object' ? (overrides as { package?: unknown }).package : undefined;
    return typeof pkg === 'string' && pkg !== '' ? pkg : undefined;
}

/**
 * [ADR-0159 D5] What a stored `view` body holds per name: a projected form, or
 * a closing holding (a list at the name, a body the projection cannot read).
 */
function viewHoldings(body: unknown): Map<string, StoredHolding> {
    const out = new Map<string, StoredHolding>();
    const projection = projectViewForms(body);
    for (const form of projection.forms) if (!out.has(form.name)) out.set(form.name, { kind: 'form', item: form });
    for (const list of projection.lists) if (!out.has(list)) out.set(list, { kind: 'closed', reason: 'list' });
    if (projection.unreadable !== undefined) {
        const name = (body as { name?: unknown } | null)?.name;
        if (typeof name === 'string' && name !== '' && !out.has(name)) out.set(name, { kind: 'closed', reason: 'unreadable' });
    }
    return out;
}

/** Read the active stored rows of one type as parsed entries; an unprovisioned store reads none. */
async function storedEntries(host: FormReadHost, type: 'form' | 'view'): Promise<StoredOverlayEntry[]> {
    try {
        const rows = await host.readActiveOverlayRows({ type });
        return rows.length === 0 ? [] : host.storedOverlayEntries({ type }, rows);
    } catch (error) {
        host.rethrowUnlessMetadataStoreUnprovisioned(error, 'sys_metadata');
        return [];
    }
}

/**
 * [ADR-0159 D5] What one stored `view` row holds per name, under the names
 * the read serves them as: an item row through the projection, a stored
 * container as the items the runtime door expands it to (the same expansion
 * the `view` list serves, {@link FormReadHost.expandStoredViewContainers}).
 * So a member of a named container on another package's object is named
 * `OBJECT.CONTAINER.KEY`, as the `view` list and the doors serve it.
 *
 * THE one naming of a stored row's forms: the `form` read
 * ({@link storedFormPlaces}) and the `form` write's old-shape row removal
 * (`oldShapeFormRowRemovals`) both ask it, so a `form` write removes only
 * the old-shape row that carries that same form.
 */
export function storedViewRowHoldings(
    host: Pick<FormReadHost, 'expandStoredViewContainers'>,
    entry: { readonly data: unknown; readonly packageId: string | undefined },
): Map<string, StoredHolding> {
    if (!isAggregatedViewContainer(entry.data)) return viewHoldings(entry.data);
    const holds = new Map<string, StoredHolding>();
    for (const { item } of host.expandStoredViewContainers('view', [entry])) {
        for (const [name, holding] of viewHoldings(item)) holds.set(name, holding);
    }
    return holds;
}

/** Every stored row of both types as a {@link StoredFormPlace}. */
async function storedFormPlaces(host: FormReadHost): Promise<StoredFormPlace[]> {
    const places: StoredFormPlace[] = [];
    for (const entry of await storedEntries(host, 'form')) {
        const name = typeof entry.data?.name === 'string' && entry.data.name !== '' ? entry.data.name : entry.name;
        if (typeof name !== 'string' || name === '') continue;
        places.push({ type: 'form', packageId: entry.packageId, entry, grain: 'item', holds: new Map([[name, { kind: 'form', item: entry.data }]]) });
    }
    const views = await storedEntries(host, 'view');
    const containers = views.filter((entry) => isAggregatedViewContainer(entry.data));
    for (const entry of views) {
        if (isAggregatedViewContainer(entry.data)) continue;
        places.push({ type: 'view', packageId: entry.packageId, entry, grain: 'item', holds: storedViewRowHoldings(host, entry) });
    }
    for (const container of containers) {
        const projection = projectViewForms(container.data);
        const holds = storedViewRowHoldings(host, container);
        // A container the projection cannot read holds nothing it can name;
        // the doors close the links it names (rule 7), the read serves nothing new.
        if (projection.unreadable !== undefined && holds.size === 0) continue;
        places.push({ type: 'view', packageId: container.packageId, entry: container, grain: 'expansion', holds });
    }
    return places;
}

/**
 * [ADR-0159 D5, rule 11] The stored row the served-row order picks for `name`
 * at `packageId`'s address, over both types: `undefined` when no place holds a
 * row of the name (the package's source item is served).
 */
export function servedFormHolding(
    places: readonly StoredFormPlace[],
    name: string,
    packageId: string,
    installed: InstalledManifestLookup,
): { holding: StoredHolding; place: StoredFormPlace; overrideOf?: string } | undefined {
    for (const candidate of servedOverlayRowCandidates({ packageId, servedOverride: true, installed })) {
        // Both spellings are read as one: the `form` read parses rows of
        // either spelling of its type, and the spelling decides nothing here.
        if (candidate.spelling === 'other') continue;
        const at = places.filter((place) => place.holds.has(name)
            && (candidate.packageId === undefined || (place.packageId ?? null) === candidate.packageId)
            && holdsServedOverlayCandidate(candidate,
                { type: place.entry.type, package_id: place.packageId ?? null, metadata: place.entry.data }, installed, undefined));
        // A stored `form` row wins over a stored `view` row at the same place;
        // an item row over a container's expansion.
        const rank = (place: StoredFormPlace): number => (place.type === 'form' ? 0 : place.grain === 'item' ? 1 : 2);
        const hit = [...at].sort((a, b) => rank(a) - rank(b))[0];
        if (hit !== undefined) {
            return candidate.overrideOf === undefined
                ? { holding: hit.holds.get(name)!, place: hit }
                : { holding: hit.holds.get(name)!, place: hit, overrideOf: candidate.overrideOf };
        }
    }
    return undefined;
}

/** A projected item, marked and served under `packageId`'s envelope. */
function projectedServed(item: Record<string, unknown>, packageId: string | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = { ...item, [PROJECTED_FORM_SOURCE_KEY]: 'view' };
    if (packageId !== undefined) out._packageId = packageId;
    else delete out._packageId;
    return out;
}

/**
 * [ADR-0159 D5] The effective `form` list ({@link FormReadHost}): the generic
 * `form` list, the projection of the served `view` list, and the cross-type
 * resolution at each address whose package authors the form as a `form` item.
 * See the module header for the three readings and how they combine.
 */
export async function readEffectiveForms(
    host: FormReadHost,
    request: { type: string; packageId?: string; names?: readonly string[]; previewDrafts?: boolean },
    audience: 'served' | 'execution',
): Promise<unknown[]> {
    return (await readEffectiveFormList(host, request, audience)).items;
}

/**
 * {@link readEffectiveForms}, with the envelope of the generic `form` list it
 * read (`type`, the served decorations): the list faces answer it without a
 * second generic read.
 *
 * - **`names` is pushed down** into both generic reads (`GetMetaItemsRequest.names`,
 *   kept once every source is merged): every reading below judges an item by
 *   its own name, and a projected form carries the name of the `view` item it
 *   is read from, so the named items resolve exactly as the whole list would.
 *   The stored rows of step 3 are read whole: a container row's `name` is not
 *   the name its expansion writes, so no row predicate can select them by the
 *   form's name. They are read ONCE per request ({@link formRequestScope}):
 *   step 3 reads the same stored rows of each type the two generic reads read,
 *   so a by-name read reads each type's stored rows once, as a form door does
 *   (measured on the pin, `public-form-reads-once-37709.test.ts`).
 * - **`packageId` is NOT pushed down**, and is applied to the resolved list:
 *   the effective `form` read is resolved per address over both types, and a
 *   list scoped to a package reads another address than its own. Step 1
 *   re-keys a declared `form` override onto its base's address from the
 *   base's projected `view` item, which a list scoped to the pair never holds,
 *   and a `view` list scoped to a package seats the package-less rows in that
 *   package's slots (#21817), which would be projected as the package's own
 *   forms ahead of the served-row order step 3 asks. Filtered after, the
 *   answer at `packageId` is the item the unscoped resolution serves there.
 */
export async function readEffectiveFormList(
    host: FormReadHost,
    request: { type: string; packageId?: string; names?: readonly string[]; previewDrafts?: boolean },
    audience: 'served' | 'execution',
): Promise<{ type: string; items: unknown[] } & Record<string, unknown>> {
    // Every reading below reads through one request scope: each stored row set once.
    host = formRequestScope(host);
    const { packageId: scope, names, ...rest } = request;
    const unscoped = { ...rest, type: 'form', ...(names !== undefined ? { names } : {}) };
    const genericList = await host.readFlattenedMetaItems(unscoped, audience) as { items: unknown[] } & Record<string, unknown>;
    const generic = genericList.items;
    const views = (await host.readFlattenedMetaItems({ ...unscoped, type: 'view' }, audience)).items as unknown[];
    const installed = installedManifestsOfEngine(host.engine);

    // The packages that author a form of each name as a `form` item: the
    // addresses that have left the `view` type (step 3).
    const authored = new Map<string, Set<string>>();
    for (const item of host.engine.registry.listItems('form') as unknown[]) {
        const name = (item as { name?: unknown } | null)?.name;
        const pkg = packageOf(item);
        if (typeof name !== 'string' || pkg === undefined) continue;
        const set = authored.get(name) ?? new Set<string>();
        set.add(pkg);
        authored.set(name, set);
    }
    const leftView = (pkg: string | undefined, name: string): boolean => pkg !== undefined && authored.get(name)?.has(pkg) === true;

    // Step 2: the projection of the served `view` list, per (package, name).
    const projected = new Map<string, Record<string, unknown>>();
    const projectedOrder: string[] = [];
    for (const view of views) {
        const pkg = packageOf(view);
        for (const form of projectViewForms(view).forms) {
            const key = keyOf(pkg, form.name);
            if (projected.has(key)) continue;
            projected.set(key, projectedServed(form, pkg));
            projectedOrder.push(key);
        }
    }

    // Step 1: the generic list, a declared override of a base that ships the
    // name only as an old shape re-keyed to its base: it is the base's item.
    const out = new Map<string, unknown>();
    const order: string[] = [];
    const put = (key: string, item: unknown): void => {
        if (!out.has(key)) order.push(key);
        out.set(key, item);
    };
    const genericByKey = new Map<string, unknown>();
    for (let item of generic) {
        const name = (item as { name?: unknown } | null)?.name;
        if (typeof name !== 'string') continue;
        let pkg = packageOf(item);
        const base = declaredOverrideOf(item);
        if (base !== undefined && pkg !== base && pairsOf(base, installed).includes(pkg ?? '')
            && projected.has(keyOf(base, name))) {
            pkg = base;
            item = { ...(item as object), _packageId: base };
        }
        genericByKey.set(keyOf(pkg, name), item);
    }

    // Step 3 needs the stored rows of both types, read only when an address
    // has left the `view` type.
    let places: StoredFormPlace[] | undefined;
    const placesOf = async (): Promise<StoredFormPlace[]> => (places ??= await storedFormPlaces(host));

    // [D5, one address holds one definition] A package's address that still
    // authors its form as an old shape is resolved by the `view` merge (step
    // 2), and a package-less stored `form` row of the name is in that
    // address's served-row order too. Such a row is judged at each of those
    // addresses below, before it is listed on its own.
    const projectedAddressesOf = new Map<string, string[]>();
    for (const key of projectedOrder) {
        const pkg = packageOf(projected.get(key));
        const name = String(projected.get(key)!.name);
        if (pkg === undefined || genericByKey.has(key) || leftView(pkg, name)) continue;
        projectedAddressesOf.set(name, [...(projectedAddressesOf.get(name) ?? []), pkg]);
    }
    const packagelessFormRows = new Map<string, { key: string; item: unknown }>();

    for (const [key, item] of genericByKey) {
        const name = String((item as { name?: unknown }).name);
        const pkg = packageOf(item);
        if (pkg === undefined && projectedAddressesOf.has(name)) {
            packagelessFormRows.set(name, { key, item });
            continue;
        }
        if (!leftView(pkg, name)) {
            put(key, item);
            continue;
        }
        const served = servedFormHolding(await placesOf(), name, pkg!, installed);
        if (served === undefined || served.place.type === 'form') {
            // No stored row, or a stored `form` row: the generic merge served
            // the same candidate order over the `form` rows alone.
            put(key, item);
            continue;
        }
        // A stored `view` row is the served row at this address.
        if (served.holding.kind === 'form') put(key, projectedServed(served.holding.item, pkg));
        // …else the closed reading: nothing is served for the name from the package.
    }
    // A package that authors the form but has no item in the generic list (its
    // item withheld) is not re-introduced here.

    // Step 2's items, where no generic item holds the same address. An
    // authored item shadows a projected one of the same package and name.
    const genericNames = new Set([...genericByKey.values()].map((item) => String((item as { name?: unknown }).name)));
    const standingIn = new Set<string>();
    for (const key of projectedOrder) {
        if (genericByKey.has(key)) continue;
        const item = projected.get(key)!;
        const pkg = packageOf(item);
        const name = String(item.name);
        // An address that has left the `view` type is resolved by step 3.
        if (leftView(pkg, name)) continue;
        // A package-less projection stands in for the addresses of the name
        // that step 1 resolved (they read it as a candidate): never listed twice.
        if (pkg === undefined && genericNames.has(name)) continue;
        // [D5] A package-less stored `form` row of the name: the served-row
        // order at this address decides between it and the `view` row the
        // projection read. A stored `form` row wins over a stored `view` row at
        // the same place, so where the order picks it the address serves its
        // body, under the address's envelope, and the projection is not served.
        const packageless = pkg !== undefined ? packagelessFormRows.get(name) : undefined;
        if (packageless !== undefined) {
            const served = servedFormHolding(await placesOf(), name, pkg!, installed);
            if (served?.place.type === 'form' && served.place.packageId === undefined) {
                put(key, { ...(packageless.item as object), _packageId: pkg });
                standingIn.add(name);
                continue;
            }
        }
        put(key, item);
    }
    // …and a package-less `form` row that stood in at no such address is
    // listed as its own item, as the generic list serves it.
    for (const [name, { key, item }] of packagelessFormRows) if (!standingIn.has(name)) put(key, item);

    let items = order.map((key) => out.get(key));
    if (scope !== undefined) items = items.filter((item) => packageOf(item) === scope);
    // The read pushed `names` down; a projection names only what its item names, kept exact here.
    if (names !== undefined) {
        const wanted = new Set(names);
        items = items.filter((item) => wanted.has(String((item as { name?: unknown }).name)));
    }
    return { ...genericList, type: 'form', items };
}

/** The rows {@link readUnreadableFormBodies} has reported, so each is said once per process. */
const REPORTED_UNREADABLE = new Set<string>();

/**
 * [ADR-0159 D6 rule 7] Every stored `view` body the projection cannot turn
 * into `form` items, with the `sharing.publicLink` slugs it names: the doors
 * close each of those links. Each such row is said ONCE at `error`, naming the
 * row (type, name, package), the links it closed, and the way out this release
 * ships: an old-shape save that repairs the body. ⛔ No command that does not
 * ship is named (the ceremony card, ⑤a, adds its name).
 */
export async function readUnreadableFormBodies(
    host: Pick<FormReadHost, 'readActiveOverlayRows' | 'storedOverlayEntries' | 'rethrowUnlessMetadataStoreUnprovisioned'>,
    report: (line: string) => void = (line) => console.error(line),
): Promise<UnreadableFormBody[]> {
    const out: UnreadableFormBody[] = [];
    for (const entry of await storedEntries(inFormRequestScope(host as FormReadHost), 'view')) {
        const projection = projectViewForms(entry.data);
        if (projection.unreadable === undefined) continue;
        const body: UnreadableFormBody = {
            type: 'view',
            name: entry.name,
            ...(entry.packageId !== undefined ? { packageId: entry.packageId } : {}),
            reason: projection.unreadable.reason,
            links: projection.unreadable.links,
        };
        out.push(body);
        const key = `${body.type}\u0000${body.name}\u0000${body.packageId ?? ''}\u0000${body.reason}\u0000${body.links.join(',')}`;
        if (REPORTED_UNREADABLE.has(key)) continue;
        REPORTED_UNREADABLE.add(key);
        const where = body.packageId !== undefined ? `package '${body.packageId}'` : 'no package';
        const closed = body.links.length > 0 ? body.links.map((l) => `/forms/${l}`).join(', ') : 'no public link';
        report(
            `[Protocol] The stored view '${body.name}' (${where}) carries form content that cannot be read: `
            + `${body.reason}. The public forms it names are closed: ${closed}. `
            + `Save the view again with its form content repaired (a \`form\` or \`formViews\` entry that is an object) to re-open them (ADR-0159 D6 rule 7).`,
        );
    }
    return out;
}
