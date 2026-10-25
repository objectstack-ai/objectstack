/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * System View immutability layer.
 *
 * A "System View" is any UI schema authored in source code (imported `.ts`/`.json`,
 * `as const` literals, or returned from a `defineSystemView()` call). Such schemas are
 * part of the product contract and MUST NOT be mutated at runtime. Mutation
 * would cause behavior drift, break TypeScript inference, and bypass code review.
 *
 * Tenant- and user-level overrides should produce a *new* object via
 * `cloneAsOverride()` rather than mutating the source schema.
 *
 * Design notes:
 *   - Uses `Object.freeze` recursively (shallow-frozen objects can still be
 *     mutated through nested references, which would defeat the purpose).
 *   - Skips `Date`, `RegExp`, `Map`, `Set`, and class instances to avoid
 *     freezing infrastructure objects users may pass through `props`.
 *   - Tags the root with a non-enumerable Symbol so the renderer / DevTools
 *     can detect the origin without polluting JSON serialization.
 */

/**
 * Symbol marker stamped on every System View root. Non-enumerable so it
 * never appears in `JSON.stringify`, `Object.keys`, or `{...spread}`.
 */
export const SYSTEM_VIEW_MARKER = Symbol.for('@object-ui/core/system-view');

/**
 * Recursively type values as `readonly`. Equivalent to TS' built-in
 * `Readonly<T>` but applied at every depth.
 */
export type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * The inverse of `DeepReadonly<T>`: recursively strip `readonly` at every depth.
 *
 * Named `DeepMutable` rather than `Mutable` for the same reason the type above
 * is not called `Readonly` — TS' built-in `Readonly<T>` is SHALLOW, so a bare
 * `Mutable` would understate what this does by exactly the depth gap that made
 * `cloneAsOverride` wrong in the first place. A type whose name misreports its
 * own reach is the defect this pair exists to close, not a naming preference.
 *
 * Symmetric with `DeepReadonly` arm for arm, deliberately including its two
 * limits: a tuple widens to an array (`DeepReadonly` widens it the same way, so
 * an inverse that preserved tuples would not be an inverse), and `Date`,
 * `RegExp`, `Map` and `Set` are mapped as plain objects even though
 * `isFreezableObject` skips them at runtime.
 *
 * One thing it deliberately does NOT do: drop the `SYSTEM_VIEW_MARKER` key.
 * `cloneAsOverride` never copies the symbol, so a clone's marker is always
 * absent — but the key is declared optional (`?: true`), and carrying it
 * therefore states "may be absent", which is true. Excluding it needs
 * `Exclude<keyof T, typeof SYSTEM_VIEW_MARKER>`, a NON-homomorphic mapped type
 * that drops the `?` modifier from every other property and turns optional keys
 * required — a strictly worse type, and a real break for callers, traded for
 * removing a key that already reads as optional.
 */
export type DeepMutable<T> = T extends (...args: any[]) => any
  ? T
  : T extends ReadonlyArray<infer U>
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;

/**
 * A schema that has been frozen by `defineSystemView()`. The marker symbol is
 * non-enumerable and therefore invisible to consumers, but its presence
 * lets us discriminate at runtime.
 */
export type SystemView<T> = DeepReadonly<T> & {
  readonly [SYSTEM_VIEW_MARKER]?: true;
};

/**
 * Values that should NOT be frozen — they are infrastructure objects whose
 * internal mutability is required for correct operation.
 */
function isFreezableObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  if (Object.isFrozen(value)) return false;
  // Built-in types whose internals must remain mutable.
  if (value instanceof Date) return false;
  if (value instanceof RegExp) return false;
  if (value instanceof Map) return false;
  if (value instanceof Set) return false;
  if (value instanceof WeakMap) return false;
  if (value instanceof WeakSet) return false;
  if (value instanceof Promise) return false;
  if (typeof (value as any).then === 'function') return false;
  // Skip class instances (anything not a plain object or array).
  if (!Array.isArray(value)) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
  }
  return true;
}

/**
 * Recursively freeze an object graph. Cycles are tolerated via a `WeakSet`
 * guard. Returns the same reference, narrowed to `DeepReadonly<T>`.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): DeepReadonly<T> {
  if (!isFreezableObject(value)) return value as DeepReadonly<T>;
  if (seen.has(value)) return value as DeepReadonly<T>;
  seen.add(value);

  // Freeze children first so the root reflects a fully-frozen graph.
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (isFreezableObject(child)) {
      deepFreeze(child, seen);
    }
  }

  Object.freeze(value);
  return value as DeepReadonly<T>;
}

/**
 * Mark and freeze a code-loaded schema as a System View.
 *
 * Named `defineView` until objectstack#4115, which is a name `@objectstack/spec`
 * owns for something else entirely: the spec's `defineView(config)` is the
 * VIEW-DOCUMENT factory — it parses a `ViewSchema` (`{ list, form, listViews,
 * formViews }`) and returns a validated `View`. This one takes an arbitrary
 * object, stamps the System-View marker and deep-freezes it; it validates
 * nothing. An app-shell comment already conflated the two, which is precisely
 * the planted-premise failure the guard exists to stop.
 *
 * @example
 * ```ts
 * import { defineSystemView } from '@object-ui/core';
 *
 * export const userListView = defineSystemView({
 *   type: 'list',
 *   data: { object: 'User' },
 *   columns: [{ name: 'email' }],
 * });
 *
 * // Type-checked AND runtime-checked: throws in strict mode, no-op silently otherwise.
 * userListView.columns.push({ name: 'name' });
 * ```
 *
 * To produce a mutable derivative (Tenant or User View), call
 * `cloneAsOverride(userListView)`.
 */
export function defineSystemView<T extends object>(schema: T): SystemView<T> {
  if (schema == null || typeof schema !== 'object') {
    throw new TypeError('[ObjectUI] defineSystemView() expects a non-null object schema.');
  }
  // Stamp the marker on the root only — nested nodes share origin via lineage.
  // Non-enumerable keeps it out of JSON, spreads, and Object.keys.
  if (!Object.prototype.hasOwnProperty.call(schema, SYSTEM_VIEW_MARKER)) {
    Object.defineProperty(schema, SYSTEM_VIEW_MARKER, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return deepFreeze(schema) as SystemView<T>;
}

/**
 * Runtime check: was this object produced by `defineSystemView()` (or loaded from a
 * source that forwards the marker)?
 */
export function isSystemView(value: unknown): boolean {
  return (
    value != null &&
    typeof value === 'object' &&
    (value as Record<symbol, unknown>)[SYSTEM_VIEW_MARKER] === true
  );
}

/**
 * Produce a deep, mutable clone of a System View so callers can apply
 * Tenant/User overrides without touching the source schema.
 *
 * Returns `DeepMutable<T>`, not `T`. The declaration used to hand back the
 * input type unchanged, which meant cloning a `SystemView<S>` returned
 * something still typed deep-readonly even though the implementation had always
 * produced a plain mutable object — so the override flow this function exists
 * for, `draft.columns.push(...)`, did not type-check (TS2339). The return type
 * now relaxes TOWARD what the runtime already does, never away from it, which
 * is why the change adds capability to a caller's type rather than removing it.
 *
 * Implementation note: uses `structuredClone` when available (Node 17+, all
 * evergreen browsers) and falls back to a JSON round-trip. The marker
 * symbol is intentionally NOT copied — the clone is no longer a System View.
 * Neither path can copy it by accident: `structuredClone` ignores symbol keys,
 * and `JSON.stringify` never sees them.
 */
export function cloneAsOverride<T>(view: T): DeepMutable<T> {
  if (view == null || typeof view !== 'object') return view as DeepMutable<T>;
  const clone =
    typeof structuredClone === 'function'
      ? structuredClone(view)
      : (JSON.parse(JSON.stringify(view)) as T);
  return clone as DeepMutable<T>;
}
