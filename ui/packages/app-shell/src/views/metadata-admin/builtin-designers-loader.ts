// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Loads the built-in designers on the first READ of any of the three designer
 * registries, instead of on every page load (objectui#12187).
 *
 * The package entry used to start that load at its own module scope, so every
 * console page fetched every Preview and Inspector chunk, with the icons they
 * draw, before the page's content rendered, on routes that never read a
 * designer. The entry now passes the same loader to
 * {@link deferBuiltinDesigners}, and the loader runs when a registry is first
 * read: a reader hook subscribing, or a `get*` / `list*` call
 * (`createObservableTypeRegistry` in `./preview-registry.ts`). Importing the
 * entry still registers every built-in designer with no call from the host,
 * which is the contract Ruling A on objectui#11798 holds the entry to; only the
 * moment moves, from the entry's evaluation to the first read. A reader that
 * rendered first shows its "designer missing" state and then the designer, as
 * it already did while the chunk was loading.
 *
 * Without the entry nothing is handed over, so a module imported on its own
 * (a test of one surface) keeps empty registries until it registers something
 * itself, as before.
 *
 * ## Why a module of its own
 *
 * The entry calls {@link deferBuiltinDesigners} at its module scope, so
 * whatever module holds it is on every page's first load. Held here it costs
 * these few lines; held in `./preview-registry.ts` it put that whole registry
 * module in the eager closure, which it had not been.
 *
 * Module-internal: the package entry does not re-export either function.
 */

let loader: (() => Promise<void>) | null = null;
let wanted = false;
let requested = false;

/**
 * The package entry's half: hand over the function that loads and registers
 * the built-in designers. It runs at the first registry read, or at once if a
 * registry was read before the hand-over.
 */
export function deferBuiltinDesigners(load: () => Promise<void>): void {
  loader = load;
  if (wanted) requestBuiltinDesigners();
}

/**
 * The registries' half: called on every read, it runs the loader once, after
 * the entry has handed one over.
 */
export function requestBuiltinDesigners(): void {
  wanted = true;
  if (requested || loader === null) return;
  requested = true;
  void loader();
}
