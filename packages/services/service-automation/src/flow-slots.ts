// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, epic #31527 child B (flow)] The automation engine holds flows
 * by `(package, name)`: one SLOT per item, each held, armed and dispatched as
 * its own.
 *
 * A slot is `(packageId, name)`: the package whose ITEM the flow is (the
 * shipper; for its declared `.custom` override, the package it overrides), or
 * `null` for a flow no package holds. Every per-flow record the engine keeps
 * is keyed by the slot's KEY: the bare name while ONE slot holds the name (so
 * a one-holder deployment keeps every key, log line and answer it had), and
 * `PACKAGE/NAME` ({@link qualifiedFlowKey}) while two or more do. A flow name
 * admits `[a-z0-9_]` only, so the last `/` splits the two. A key moves only
 * when a name gains or loses its second slot; {@link FlowSlotTable.add} and
 * {@link FlowSlotTable.remove} answer which keys moved.
 *
 * [#33893; seat ruling 6884403301, amendment 7] A disable is reversible and
 * moves no key. While the registry holds a name under two or more packages
 * and the others are disabled (`coHeldByDisabled`), a package's lone slot of
 * the name is filed, and stays, under its qualified key: the first holder
 * the boot pull registers beside a disabled one, and the holder a disabled
 * one's withdrawal leaves behind. Once the registry no longer holds the name
 * twice (the disabled holder uninstalled), it folds back to the bare name
 * ({@link FlowSlotTable.settle}) the first time the engine places it, fires it
 * or reads its name: one keying rule, so a name one package holds is never
 * read as shared.
 *
 * Invariant (D4): a package-less slot never sits beside a package slot. A
 * package arriving for a name a package-less slot holds takes it over
 * ({@link FlowSlotTable.adopt}), and a package-less registration of a name one
 * package slot holds lands in that slot.
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

/** [#31696] No flow name contains `/`: a "name" that does spells a slot key, which a bare door never takes. */
export function isSlotKeySpelling(name: string): boolean {
    return name.includes('/');
}

/** [#31696] A key no slot is filed under (NUL-led): a bare door reads a slot-key spelling under it and finds no flow. */
export function unfiledFlowKey(name: string): string {
    return `\u0000${name}`;
}

/**
 * The run context's slot key, so a `subflow` / `map` child resolves names from
 * its caller's package. A symbol: copied by a spread, never serialized.
 */
export const FLOW_RUN_SLOT_KEY: unique symbol = Symbol.for('objectstack.automation.flowRunSlotKey');

/**
 * [ADR-0150 D8 row R8, #31696] The package whose flow a run executes, stamped
 * at start ({@link stampFlowRunSlot}), so the run is stored under it even when
 * its key moves in flight. In-process only (stored: `flowPackage`).
 */
const FLOW_RUN_PACKAGE: unique symbol = Symbol('objectstack.automation.flowRunPackage');

/** A key that moved: `from` is the key the records were under, `to` the key they move to. */
export interface FlowKeyMove {
    readonly from: string;
    readonly to: string;
}

/** The slots one engine holds, and the key each is filed under. */
export class FlowSlotTable {
    /**
     * @param heldByMany [M1] the registry holds `name` under two or more packages (the resolver refuses it with no package).
     * @param coHeldByDisabled [#33893] it does, and at most one of them is served: a lone package slot keeps its qualified key.
     */
    constructor(
        private readonly heldByMany?: (name: string) => boolean,
        private readonly coHeldByDisabled?: (name: string) => boolean,
    ) {}

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

    /** [M1] Is `name` shared: two or more slots hold it, or one does while the registry holds it twice. Every reader asks this. */
    isShared(name: string): boolean {
        const size = this.byName.get(name)?.size ?? 0;
        return size > 1 || (size === 1 && this.heldByMany?.(name) === true);
    }

    /**
     * [#33893] The name's lone slot, filed under its qualified key beside a
     * disabled co-holder, goes back to the bare name once the registry no
     * longer holds the name twice: the move answered, or none.
     */
    settle(name: string): FlowKeyMove[] {
        const packages = this.byName.get(name);
        if (packages?.size !== 1) return [];
        const [[onlyPackage, onlyKey]] = [...packages];
        if (onlyKey === name || this.heldByMany?.(name) === true) return [];
        this.rekey(onlyKey, name);
        packages.set(onlyPackage, name);
        return [{ from: onlyKey, to: name }];
    }

    /** Every key, in arrival order. */
    keys(): string[] {
        return [...this.byKey.keys()];
    }

    /** File the slot `(packageId, name)`: its key (qualified for the first one too when `coHeldByDisabled`), and the name's lone slot's move to its qualified key, if any. */
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
        const lone = packages.size === 0 && this.coHeldByDisabled?.(slot.name) !== true;
        const key = lone || slot.packageId === null ? slot.name : qualifiedFlowKey(slot.packageId, slot.name);
        packages.set(slot.packageId ?? '', key);
        this.byName.set(slot.name, packages);
        this.byKey.set(key, slot);
        return { key, moved };
    }

    /** Drop the slot `key` files: a name left with one slot files it under the bare name again (the move answered), [#33893] unless `coHeldByDisabled`. */
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
        // [#33893] A disabled holder's slot leaving moves no key of the others.
        if (this.coHeldByDisabled?.(slot.name) === true) return [];
        this.rekey(onlyKey, slot.name);
        packages.set(onlyPackage, slot.name);
        return [{ from: onlyKey, to: slot.name }];
    }

    /** The name's one, package-less slot `key` becomes `packageId`'s under the same key (D4: the flow is its customization). */
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
 * Stamp a run's own context with its slot key where that is not the name it
 * carries, and clear an inherited stamp otherwise, so a child reads its own
 * slot, never its parent's.
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

/** [#31696] The slot key of the run `context`: the stamped key, else its flow name; `undefined` for no run. */
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
