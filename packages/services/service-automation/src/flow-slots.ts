// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, epic #31527 child B (flow)] The automation engine holds flows
 * by `(package, name)`: one SLOT per item, and every same-named flow of two
 * packages is held, armed and dispatched as its own.
 *
 * ## The slot and its key
 *
 * A slot is `(packageId, name)`. `packageId` is the package whose ITEM the
 * flow is (ADR-0150 D4 identity): the package that ships it, and for the
 * shipping package's declared `.custom` override (ADR-0146 D9) the package it
 * overrides, because the override is that package's item customized. `null`
 * is a flow no package holds: one authored in this environment, or one
 * registered straight into the engine.
 *
 * Every per-flow record the engine keeps (the flow map, the version history,
 * the status switch, the trigger binding and its decline records) is keyed by
 * the slot's KEY:
 *
 *  - while ONE slot holds a name, its key is the bare name — byte for byte
 *    the key every record had before slots, so a deployment where each name
 *    has one holder (every deployment phase 1 admits) keeps every key, log
 *    line and answer it had;
 *  - while TWO OR MORE slots hold it, each key is `PACKAGE/NAME`
 *    ({@link qualifiedFlowKey}). No name and no package id contains `/`'s
 *    meaning here: a flow name admits `[a-z0-9_]` only, so the last `/`
 *    always splits the two.
 *
 * So a key moves when a name gains or loses its second holder, and only
 * then; {@link FlowSlotTable.add} and {@link FlowSlotTable.remove} answer
 * which keys moved, and the engine moves its records with them.
 *
 * ## The invariant: a package-less slot never sits beside a package slot
 *
 * ADR-0150 D4: a package-less item that bears a package-held name is a
 * customization of that holder, never a second item, so it never arms beside
 * the item it shadows. The engine keeps that by construction: a package slot
 * arriving for a name a package-less slot holds takes that slot over
 * ({@link FlowSlotTable.adopt}), and a package-less registration of a name
 * one package slot holds lands in that slot. A bare key therefore names the
 * one slot of its name, whichever kind it is.
 */

/** One flow the engine holds: the package whose item it is, and its name. */
export interface FlowSlot {
    /** The package whose item the flow is, or `null` for a flow no package holds. */
    readonly packageId: string | null;
    /** The flow's bare name. */
    readonly name: string;
}

/** The key of a slot whose name another slot also holds. */
export function qualifiedFlowKey(packageId: string, name: string): string {
    return `${packageId}/${name}`;
}

/**
 * [#31696] No flow name contains `/`, so a "name" that does spells a slot key
 * (`PACKAGE/NAME`). A bare door never takes one: it names no flow there.
 */
export function isSlotKeySpelling(name: string): boolean {
    return name.includes('/');
}

/**
 * [#31696] The key a bare door reads a slot-key spelling under: one no slot is
 * ever filed under (it starts with a NUL), so the door finds no flow, exactly
 * as for a name it does not hold.
 */
export function unfiledFlowKey(name: string): string {
    return `\u0000${name}`;
}

/**
 * The property a run's context carries the key of the slot whose run it is,
 * so a `subflow` / `map` child, which inherits its parent's context, resolves
 * its own name from the package of the flow that names it. A symbol: copied
 * by a spread like every other key of the context, and never serialized, so it
 * reaches no store and no wire.
 */
export const FLOW_RUN_SLOT_KEY: unique symbol = Symbol.for('objectstack.automation.flowRunSlotKey');

/**
 * [ADR-0150 D8 row R8, #31696] The package whose flow a run executes, stamped
 * when the run starts ({@link stampFlowRunSlot}): the run is stored under it
 * even when its slot's key moves while the run is in flight. In-process only,
 * like {@link FLOW_RUN_SLOT_KEY}: a stored run carries its package as
 * `flowPackage` instead.
 */
const FLOW_RUN_PACKAGE: unique symbol = Symbol('objectstack.automation.flowRunPackage');

/** A key that moved: `from` is the key the records were under, `to` the key they move to. */
export interface FlowKeyMove {
    readonly from: string;
    readonly to: string;
}

/** The slots one engine holds, and the key each is filed under. */
export class FlowSlotTable {
    private readonly byKey = new Map<string, FlowSlot>();
    /** name → (package id, `''` for none) → key */
    private readonly byName = new Map<string, Map<string, string>>();

    /** The slot `key` files, or `undefined` for a key no slot holds. */
    slot(key: string): FlowSlot | undefined {
        return this.byKey.get(key);
    }

    /** Every key a slot of `name` is filed under, in arrival order. */
    keysOf(name: string): string[] {
        return [...(this.byName.get(name)?.values() ?? [])];
    }

    /** Every slot of `name`, in arrival order. */
    slotsOf(name: string): FlowSlot[] {
        return this.keysOf(name).map((key) => this.byKey.get(key)!);
    }

    /** The key of the exact slot `(packageId, name)`, or `undefined` when no slot is it. */
    keyOf(name: string, packageId: string | null): string | undefined {
        return this.byName.get(name)?.get(packageId ?? '');
    }

    /** Do two or more slots hold `name`? */
    isShared(name: string): boolean {
        return (this.byName.get(name)?.size ?? 0) > 1;
    }

    /** Every key, in arrival order. */
    keys(): string[] {
        return [...this.byKey.keys()];
    }

    /**
     * File the slot `(packageId, name)`, which no slot is yet. Answers its key
     * and the keys of the name's other slots that moved: the one slot that
     * held the name alone moves from the bare name to its qualified key.
     */
    add(slot: FlowSlot): { key: string; moved: FlowKeyMove[] } {
        const packages = this.byName.get(slot.name) ?? new Map<string, string>();
        const moved: FlowKeyMove[] = [];
        if (packages.size === 1) {
            const [[onlyPackage, onlyKey]] = [...packages];
            const to = onlyPackage === '' ? slot.name : qualifiedFlowKey(onlyPackage, slot.name);
            if (to !== onlyKey) {
                this.rekey(onlyKey, to);
                packages.set(onlyPackage, to);
                moved.push({ from: onlyKey, to });
            }
        }
        const key = packages.size === 0 || slot.packageId === null ? slot.name : qualifiedFlowKey(slot.packageId, slot.name);
        packages.set(slot.packageId ?? '', key);
        this.byName.set(slot.name, packages);
        this.byKey.set(key, slot);
        return { key, moved };
    }

    /**
     * Drop the slot `key` files. Answers the keys that moved: a name left with
     * one slot files it under the bare name again.
     */
    remove(key: string): FlowKeyMove[] {
        const slot = this.byKey.get(key);
        if (!slot) return [];
        this.byKey.delete(key);
        const packages: Map<string, string> = this.byName.get(slot.name)!;
        packages.delete(slot.packageId ?? '');
        if (packages.size === 0) {
            this.byName.delete(slot.name);
            return [];
        }
        if (packages.size !== 1) return [];
        const [[onlyPackage, onlyKey]] = [...packages];
        if (onlyKey === slot.name) return [];
        this.rekey(onlyKey, slot.name);
        packages.set(onlyPackage, slot.name);
        return [{ from: onlyKey, to: slot.name }];
    }

    /**
     * The package-less slot `key` becomes package `packageId`'s slot, under the
     * same key: the name's one holder is now that package's item, and the
     * package-less flow its customization (ADR-0150 D4). Only for the name's
     * ONE slot, so its key is the bare name either way.
     */
    adopt(key: string, packageId: string): void {
        const slot = this.byKey.get(key);
        if (!slot || slot.packageId !== null) return;
        const adopted: FlowSlot = { packageId, name: slot.name };
        this.byKey.set(key, adopted);
        const packages: Map<string, string> = this.byName.get(slot.name)!;
        packages.delete('');
        packages.set(packageId, key);
    }

    private rekey(from: string, to: string): void {
        const slot = this.byKey.get(from);
        if (!slot) return;
        this.byKey.delete(from);
        this.byKey.set(to, slot);
    }
}

/**
 * Stamp a run's own context with the key of its flow's slot
 * ({@link FLOW_RUN_SLOT_KEY}), where that key is not the name the context
 * already carries — a slot of a name two slots hold — and clear a stamp
 * inherited from a calling run otherwise, so a child reads its own slot and
 * never its parent's. `context` is the run's own copy.
 */
export function stampFlowRunSlot(context: object, key: string, packageId?: string | null): void {
    const stamped = context as { flowName?: unknown; [FLOW_RUN_SLOT_KEY]?: string; [FLOW_RUN_PACKAGE]?: string };
    if (stamped.flowName !== key) stamped[FLOW_RUN_SLOT_KEY] = key;
    else delete stamped[FLOW_RUN_SLOT_KEY];
    if (typeof packageId === 'string' && packageId !== '') stamped[FLOW_RUN_PACKAGE] = packageId;
    else delete stamped[FLOW_RUN_PACKAGE];
}

/** The package {@link stampFlowRunSlot} stamped on `context`, if any. */
export function flowRunPackage(context: unknown): string | undefined {
    const stamped = (context as { [FLOW_RUN_PACKAGE]?: unknown } | undefined)?.[FLOW_RUN_PACKAGE];
    return typeof stamped === 'string' && stamped !== '' ? stamped : undefined;
}

/**
 * [#31696] The key of the slot whose run `context` is: the stamped key
 * ({@link FLOW_RUN_SLOT_KEY}) where the run's flow has a name two slots hold,
 * else the flow name the context carries, which is then its key. `undefined`
 * for a context that is no run's.
 */
export function flowRunKey(context: unknown): string | undefined {
    const run = context as { flowName?: unknown; [FLOW_RUN_SLOT_KEY]?: unknown } | undefined;
    const stamped = run?.[FLOW_RUN_SLOT_KEY];
    if (typeof stamped === 'string' && stamped !== '') return stamped;
    return typeof run?.flowName === 'string' && run.flowName !== '' ? run.flowName : undefined;
}

/**
 * The context a continued run (a resume) carries: `context` itself where the
 * key is the name it already carries, else a copy stamped with the key — a
 * persisted context crossed JSON, which keeps no symbol.
 */
export function withFlowRunSlot<T extends object>(context: T, key: string): T {
    if ((context as { flowName?: unknown }).flowName === key) return context;
    return { ...context, [FLOW_RUN_SLOT_KEY]: key };
}
