// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared `seed-datasets` registry — the multi-tenant seed-replay contract (#3453).
 *
 * In multi-tenant deployments (`@objectstack/organizations`) a brand-new
 * org gets its own private copy of every artifact's demo data by REPLAYING the
 * kernel's `seed-datasets` list on the `sys_organization` insert (Salesforce-sandbox
 * style). That list must therefore hold the UNION of every seed source: every
 * config-declared app AND every marketplace package installed at runtime.
 *
 * Two framework traps used to shrink that union down to just the first source —
 * the same pair {@link recordSeedOutcome} was hardened against for seed-summary
 * (#3444):
 *
 *   ① The standard `PluginContext` (packages/core/src/kernel.ts) exposes
 *      `getService`/`registerService` but NO `.kernel` handle, so the old
 *      `(ctx as any).kernel?.getService('seed-datasets')` read was ALWAYS
 *      `undefined`. Each source then saw "nothing registered" and overwrote the
 *      list with only its own datasets instead of extending it.
 *   ② `registerService` THROWS on a duplicate name, so the second source's
 *      re-register was swallowed by the caller's try/catch — its datasets (and,
 *      in AppPlugin's case, its replayer) silently lost.
 *
 * The fix mirrors `recordSeedOutcome`: register ONE mutable array the first time,
 * and have every later source read it back (through the context's OWN resolver
 * first, a raw kernel handle second) and push in place. The per-org replayer reads
 * {@link readSeedDatasets} at invoke time, so it always replays the full union —
 * including datasets appended AFTER its closure was built (a second config app, a
 * marketplace install).
 *
 * [#35109] A union of SOURCES, not of merges: a source that merges again — a
 * package upgraded, reinstalled, reseeded or rehydrated in a running process —
 * names itself (`owner`, the package id), and its earlier entries are replaced
 * on the same array instead of kept beside the new ones. An append-only list
 * kept the superseded version's datasets until a restart, and every
 * organization founded in between replayed both versions.
 */

/** The subset of a kernel / plugin context this module pokes at. */
interface SeedDatasetHost {
    kernel?: { getService?: (n: string) => unknown; registerService?: (n: string, v: unknown) => unknown };
    getService?: (n: string) => unknown;
    registerService?: (n: string, v: unknown) => unknown;
}

const SERVICE_NAME = 'seed-datasets';
const REPLAYER_SERVICE_NAME = 'seed-replayer';

/**
 * Read the live `seed-datasets` array. Preference order matters: the plugin
 * context's own `getService` resolves against the running kernel and is the ONLY
 * channel that works on a standard `PluginContext` (which has no `.kernel`); the
 * raw-kernel fallback covers the rare case where a bare kernel is passed as `ctx`.
 * Both throw when the service is unregistered — swallowed and reported as absent.
 */
export function readSeedDatasets(ctx: unknown): unknown[] | undefined {
    const c = ctx as SeedDatasetHost | null | undefined;
    if (typeof c?.getService === 'function') {
        try { const v = c.getService(SERVICE_NAME); if (Array.isArray(v)) return v; } catch { /* unregistered */ }
    }
    if (typeof c?.kernel?.getService === 'function') {
        try { const v = c.kernel.getService(SERVICE_NAME); if (Array.isArray(v)) return v; } catch { /* unregistered */ }
    }
    return undefined;
}

/**
 * The owner index of a shared list: each owner's entries as it last merged
 * them, by reference. It rides ON the live array, under a registry symbol, so
 * every copy of this module and the install door's inline fallback
 * (`@objectstack/cloud-connection`) read and write one index. Non-enumerable:
 * the array's length, iteration and JSON are unchanged.
 */
const OWNER_INDEX = Symbol.for('objectstack.seed-datasets.owners');

function ownerIndexOf(list: unknown[]): Map<string, unknown[]> {
    const held = (list as unknown as Record<symbol, unknown>)[OWNER_INDEX];
    if (held instanceof Map) return held as Map<string, unknown[]>;
    const index = new Map<string, unknown[]>();
    Object.defineProperty(list, OWNER_INDEX, { value: index, enumerable: false });
    return index;
}

/**
 * Replace `owner`'s entries on `list` with `datasets`, in place: its previous
 * entries are removed (by reference, one occurrence each, the latest first, so
 * an un-owned copy of the same object stays), and `datasets` go where the first
 * of them stood — at the end for an owner merging for the first time.
 */
function replaceOwnedSeedDatasets(list: unknown[], owner: string, datasets: readonly unknown[]): void {
    const index = ownerIndexOf(list);
    const stale = new Map<unknown, number>();
    for (const entry of index.get(owner) ?? []) stale.set(entry, (stale.get(entry) ?? 0) + 1);
    let at = list.length;
    for (let i = list.length - 1; i >= 0 && stale.size > 0; i--) {
        const left = stale.get(list[i]);
        if (left === undefined) continue;
        if (left > 1) stale.set(list[i], left - 1);
        else stale.delete(list[i]);
        list.splice(i, 1);
        at = i;
    }
    list.splice(at, 0, ...datasets);
    if (datasets.length > 0) index.set(owner, [...datasets]);
    else index.delete(owner);
}

/**
 * Merge `datasets` into the shared `seed-datasets` service, register-once-then-
 * mutate. Returns the live array so the caller can log the running total.
 *
 * `owner` names the source — the package id, for the install door. Given, the
 * owner's earlier entries are REPLACED on the list (an upgrade, a reinstall, a
 * reseed or a rehydrate of one package leaves exactly that package's current
 * datasets; an empty `datasets` takes them all off). Omitted, `datasets` are
 * appended, as every config app's boot merge does.
 *
 * `getService` hands back the SAME array reference, so an already-present list is
 * mutated in place and only a brand-new list is registered — the ONE way to avoid
 * the duplicate-register throw (defect ②) while still accumulating every source
 * (defect ①). Best-effort: a failed register never propagates, so a
 * banner/replay concern can't tear down boot; the caller still gets the (now
 * unregistered) list back.
 */
export function mergeSeedDatasets(ctx: unknown, datasets: readonly unknown[], owner?: string): unknown[] {
    const c = ctx as SeedDatasetHost | null | undefined;
    const current = readSeedDatasets(ctx);
    const list: unknown[] = Array.isArray(current) ? current : [];
    if (typeof owner === 'string' && owner !== '') replaceOwnedSeedDatasets(list, owner, datasets);
    else if (datasets.length > 0) list.push(...datasets);

    // Only the first source registers; every later one mutated the shared list
    // above and must NOT re-register (that is the throw defect ② guards against).
    if (!Array.isArray(current)) {
        try {
            if (typeof c?.kernel?.registerService === 'function') c.kernel.registerService(SERVICE_NAME, list);
            else if (typeof c?.registerService === 'function') c.registerService(SERVICE_NAME, list);
        } catch { /* never let seed wiring break boot */ }
    }
    return list;
}

/**
 * Register the per-org `seed-replayer` callable exactly once. Subsequent config
 * apps reuse the first replayer — which reads the live (now-appended) dataset
 * list on every call — instead of tripping the duplicate-register throw.
 *
 * Returns `true` when it newly registered, `false` when a replayer was already
 * present (so the caller can log "reused" rather than "registered"). Best-effort:
 * a lost check→register race is swallowed and reported as already-present.
 */
export function registerSeedReplayerOnce(ctx: unknown, replayer: unknown): boolean {
    const c = ctx as SeedDatasetHost | null | undefined;
    const alreadyRegistered = (): boolean => {
        if (typeof c?.getService === 'function') {
            try { return c.getService(REPLAYER_SERVICE_NAME) !== undefined; } catch { /* absent */ }
        }
        if (typeof c?.kernel?.getService === 'function') {
            try { return c.kernel.getService(REPLAYER_SERVICE_NAME) !== undefined; } catch { /* absent */ }
        }
        return false;
    };
    if (alreadyRegistered()) return false;
    try {
        if (typeof c?.kernel?.registerService === 'function') { c.kernel.registerService(REPLAYER_SERVICE_NAME, replayer); return true; }
        if (typeof c?.registerService === 'function') { c.registerService(REPLAYER_SERVICE_NAME, replayer); return true; }
    } catch { /* concurrent register — treat as already present */ }
    return false;
}
