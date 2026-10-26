/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [objectui#6813] A cache React cannot discard, keyed on the IDENTITIES of the
 * inputs the cached value is derived from.
 *
 * ## Why this exists rather than `useMemo` / `useCallback`
 *
 * `useMemo` and `useCallback` carry no semantic guarantee: React is permitted
 * to throw the cache away and recompute even when the dependency list compares
 * equal. That is fine for an optimisation and wrong for a value another
 * module's CORRECTNESS rests on — and a context value is exactly that, because
 * consumers name it in dependency arrays and a moved identity re-runs their
 * effects (`ListView`'s data fetch, `DetailView`'s gatedSchema, `ObjectForm`,
 * `ModalForm`, `ObjectGrid`, `RelatedList`).
 *
 * ⚠️ This is a LATENT hazard, not a reproduction, and this file must not be
 * read as fixing a bug. Measured on this repo's pinned React 19.2.8 while
 * objectui#6724 was implemented: 51 re-renders with no provider, 51 with a
 * provider and 42 under `StrictMode` each returned ONE identity, and this repo
 * has no `Activity`/Offscreen subtree — the documented case where React does
 * throw memo caches away. So React has not exercised the licence here. What
 * this file removes is the dependency on it not doing so.
 *
 * ## Why a module-level `WeakMap` and not a `useRef`
 *
 * A ref would also survive a discard, but reading or writing `ref.current`
 * during render is the shape `react-hooks/refs` flags and that objectui#6745 /
 * #6797 were opened and closed to remove from published hooks. This costs no
 * hook at all, so there is no render-phase ref write and no render-phase state
 * adjustment to reason about — the same property objectui#6724 landed on at
 * the hook end of this chain, where a module-level `WeakMap` keyed on `ctx`
 * replaced a `useMemo` keyed on `[ctx]`.
 *
 * ## Why the whole tuple is the key, rather than a stored dependency list
 *
 * A single slot holding `{ deps, value }` and comparing deps would be shared
 * by every component instance reaching it, so two providers with different
 * inputs would evict each other and churn the identity on every render — the
 * defect this file exists to remove. Keying a nested `WeakMap` on the full
 * input tuple has no such slot to fight over: one value per distinct tuple,
 * for as long as that tuple's members are alive. Two providers given the same
 * inputs then share ONE value, which is strictly stronger than the
 * per-instance memo it replaces and is the same guarantee objectui#6724 gives
 * at the hook.
 *
 * ## Lifetime
 *
 * Every level is a `WeakMap`, so an entry is reachable only while the input
 * objects that key it are. A caller that builds a fresh array each render
 * allocates a fresh entry each render and drops the previous one — exactly
 * what a memo miss costs today, with nothing retained.
 *
 * ⚠️ Keys must be objects: `WeakMap` cannot hold a primitive. Inputs that are
 * legitimately absent (an optional prop) or primitive (a boolean) are mapped
 * to a stable module-level sentinel by the CALLER, where the mapping is
 * obvious and total — see `NO_USER` in `PermissionProvider` and `NO_DATA` /
 * `LOADED` / `NOT_LOADED` in `MePermissionsProvider`. A generic coercion here
 * could not do it safely: two distinct primitives would have to collide on one
 * sentinel and silently answer with each other's cached value.
 *
 * Internal to `@object-ui/permissions` — deliberately not exported from
 * `index.ts`. Whether this idiom should be shared repo-wide is a public-surface
 * decision, not one this file makes.
 */

/** One entry, boxed so that a legitimately falsy cached value still hits. */
interface Entry<T> {
  value: T;
}

/**
 * Create one independent cache. Each cached thing needs its OWN cache — the
 * key tuple identifies the inputs, not which value was derived from them, so
 * two different values sharing a tuple would otherwise collide.
 */
export function createDiscardProofCache<T>(): (keys: readonly object[], build: () => T) => T {
  const root = new WeakMap<object, unknown>();

  return function lookup(keys: readonly object[], build: () => T): T {
    let node = root;
    for (let i = 0; i < keys.length - 1; i++) {
      let next = node.get(keys[i]) as WeakMap<object, unknown> | undefined;
      if (next === undefined) {
        next = new WeakMap<object, unknown>();
        node.set(keys[i], next);
      }
      node = next;
    }

    const last = keys[keys.length - 1];
    let entry = node.get(last) as Entry<T> | undefined;
    if (entry === undefined) {
      entry = { value: build() };
      node.set(last, entry);
    }
    return entry.value;
  };
}
