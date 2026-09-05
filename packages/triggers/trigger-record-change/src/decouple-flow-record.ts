// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Decouple the flow-facing `record` / `previous` roots from the ENGINE-OWNED
 * objects they were overlaid from (#14744, measured by #15356).
 *
 * ## The leak this closes
 *
 * `buildContext` builds the flow's `record` as an overlay —
 * `{ ...previous, ...inputData, ...after }`. The top-level object is new, so a
 * flow that ASSIGNS a top-level key writes only that new object. But the spread
 * is SHALLOW: every NESTED value in it is the engine's own object, shared by
 * reference. `inputData` is `ctx.input.data`, and on a predicate (`multi: true`)
 * write ADR-0058 Addendum II D3 hands EVERY per-row context THE SAME payload
 * object — it is the SET clause of the single `driver.updateMany`.
 *
 * So a `script` node whose registered function mutated a nested value in place
 * (`automation.record.tags.push(…)`) wrote the batch payload without assigning
 * any key, and every dispatch's contribution landed on EVERY matched row —
 * including a value derived from another row's pre-image. #14099's key-set
 * refusal cannot see it: that refusal reads the set of keys each row's chain
 * ASSIGNED (via #14088's `set`-trap recorder), and an in-place mutation of a
 * nested value fires no trap, so both rows report the EMPTY key set and there is
 * nothing to diverge. Measured end to end on the memory driver and on
 * `@objectstack/driver-sql` (#15356; the pin is
 * `before-update-flow-payload-reach.test.ts`, S5 in this package).
 *
 * `ctx.previous` is the same shape of leak one seam over: the engine binds ONE
 * pre-image object and hands the SAME `HookContext` to every OTHER flow binding
 * on the write, which is why `buildContext` already refuses to materialise into
 * it. That copy was shallow too, so the refusal only held for top-level keys.
 *
 * ## Why a COPY and not a FREEZE
 *
 * The ruling names both. A freeze is not available here, and the reason is
 * measured rather than aesthetic: `service-automation`'s `expandDeclaredLookups`
 * (#3475) writes `record[field] = expanded` INTO the context this function
 * returns — its own docblock says "Mutates `record` in place (the same object
 * the run's variable map already references)" — and the expander is wired in
 * every deployment that has objectql. Under a freeze that assignment throws, the
 * best-effort `catch` swallows it, and every flow declaring `config.expand`
 * silently degrades to unexpanded scalar ids while logging "could not expand
 * lookups". A freeze also converts one unsupported write into a whole-flow
 * outage, because `RecordChangeTrigger`'s handler swallows flow failures by
 * design (error isolation — a flow must never break the CRUD write).
 *
 * A copy keeps the flow's own view live: the mutation still takes effect on the
 * snapshot the flow is holding, so `{record.tags}` later in the SAME run still
 * observes it. What it can no longer do is reach the engine's write.
 *
 * ## The boundary, stated because it is not total
 *
 * Copied: arrays, plain objects (prototype `Object.prototype` or `null`),
 * `Date`, `RegExp`, `Map`, `Set` — the mutable shapes a record value can
 * actually arrive as. Shared by reference: primitives (nothing to alias),
 * functions, and any other class instance — copying an exotic instance by
 * property assignment corrupts it worse than sharing it does (internal slots,
 * private fields), and `buildContext` must never break the flow it feeds. A
 * declared field's value is JSON-shaped by its field type, so that residue is
 * not a shape any driver produces for a record; it is named here rather than
 * left as an unknown, and `decouple-flow-record.test.ts` pins it in both
 * directions.
 *
 * Cross-realm values (a `Date` from another `vm` context) fail `instanceof` and
 * fall into the shared-by-reference arm — that is today's behaviour, so the
 * fallback can only ever be a non-improvement, never a regression.
 *
 * The `seen` map does two jobs: it terminates on cycles, and — when the SAME
 * map is passed for `record` and `previous` — it keeps substructure the two
 * roots shared with each other shared WITHIN the flow's own context, so the
 * copy changes what the flow can reach OUTWARD without rearranging what it sees
 * INWARD. It also means a repeated reference is walked once, not once per site.
 */

/**
 * Return a copy of `value` that shares no mutable object with the engine's own
 * state. Not exported from `index.ts` — module scope only, like
 * {@link materializeDeclaredFields}, so this stays off the package's published
 * API surface.
 */
export function decoupleFromEngineState<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
    return copyValue(value, seen) as T;
}

function copyValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
    // Primitives and functions: nothing to alias, or nothing safely copyable.
    if (value === null || typeof value !== 'object') return value;

    // Every value this function registers is a non-`undefined` object, so a
    // `get` miss and a stored copy are distinguishable without a second lookup.
    const already = seen.get(value);
    if (already !== undefined) return already;

    if (Array.isArray(value)) {
        const out: unknown[] = new Array(value.length);
        // Registered BEFORE the walk so a cycle resolves to this same array.
        seen.set(value, out);
        for (let i = 0; i < value.length; i += 1) out[i] = copyValue(value[i], seen);
        return out;
    }

    if (value instanceof Date) {
        const out = new Date(value.getTime());
        seen.set(value, out);
        return out;
    }

    if (value instanceof RegExp) {
        const out = new RegExp(value.source, value.flags);
        out.lastIndex = value.lastIndex;
        seen.set(value, out);
        return out;
    }

    if (value instanceof Map) {
        const out = new Map<unknown, unknown>();
        seen.set(value, out);
        for (const [k, v] of value) out.set(copyValue(k, seen), copyValue(v, seen));
        return out;
    }

    if (value instanceof Set) {
        const out = new Set<unknown>();
        seen.set(value, out);
        for (const v of value) out.add(copyValue(v, seen));
        return out;
    }

    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto === Object.prototype || proto === null) {
        const out: Record<string, unknown> = {};
        seen.set(value, out);
        for (const key of Object.keys(value)) {
            out[key] = copyValue((value as Record<string, unknown>)[key], seen);
        }
        return out;
    }

    // The documented residue: a class instance is shared, not copied.
    seen.set(value, value);
    return value;
}
