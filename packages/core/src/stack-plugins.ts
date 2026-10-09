// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE rule that turns an entry of a stack's own `plugins` array into the
 * plugin a boot registers — read by `os serve` (`@objectstack/cli`) and by the
 * verification handle (`@objectstack/verify`'s `bootStack`).
 *
 * ## Why this lives in `@objectstack/core`
 *
 * For one configuration, `bootStack` composes what `objectstack serve`
 * composes (#22301, ruling A): the providers the app's `requires` names
 * (`capability-providers.ts`, beside this file) AND the plugins in the app's
 * own `plugins` array. The two boots sit in packages that cannot import each
 * other — `@objectstack/cli` depends on `@objectstack/verify` — and both already
 * depend on this package, so the rule lives here and adds no package edge
 * (`capability-providers.ts` gives the same reason). ⛔ Never a second copy of
 * it beside a reader.
 *
 * ## What is shared, and what stays with each boot
 *
 * Shared: WHAT an entry is and what it becomes. An entry is one of three
 * shapes, and the answer per shape is the rule:
 *
 *   · a STRING is a package specifier: the module is loaded, and its default
 *     export (or, failing that, the module itself) is the plugin;
 *   · an OBJECT WITH NO `init` is a plain metadata bundle (`{ name, objects, … }`):
 *     it is wrapped into the plugin that registers a bundle — `AppPlugin`;
 *   · anything else (a plugin instance) is the plugin, as written.
 *
 * Each boot's own: HOW a specifier is loaded and HOW a bundle is wrapped
 * ({@link StackPluginLoaders}). `serve` loads a specifier host-anchored from
 * the served app's root with its own diagnostic wrapper, and wraps a bundle
 * with `@objectstack/runtime`'s `AppPlugin`; the handle loads from the
 * `hostRoot` it is given. `@objectstack/core` cannot import `AppPlugin` itself
 * (`@objectstack/runtime` depends on this package), which is why the wrap is
 * injected rather than performed here.
 *
 * Pure: importing this module loads nothing.
 */

/** How one boot loads a specifier entry and wraps a bundle entry. */
export interface StackPluginLoaders {
  /**
   * Load a string entry of `plugins` — a package specifier, resolved the way
   * this boot resolves an app-declared package — and answer the module.
   */
  importSpecifier(specifier: string): Promise<unknown>;
  /**
   * Wrap a plain bundle entry (an object with no `init`) into the plugin that
   * registers it.
   */
  wrapBundle(bundle: Record<string, unknown>): unknown | Promise<unknown>;
}

/**
 * The plugin one entry of a stack's `plugins` array stands for, by the rule in
 * this module's header. Answers the plugin to register; registering it is the
 * caller's.
 *
 * Throws whatever the injected loader throws for a specifier it cannot load —
 * each boot decides how loud that is.
 */
export async function materializeStackPlugin(entry: unknown, loaders: StackPluginLoaders): Promise<unknown> {
  let plugin: unknown = entry;
  if (typeof entry === 'string') {
    const mod = (await loaders.importSpecifier(entry)) as { default?: unknown } | null | undefined;
    plugin = mod?.default || mod;
  }
  if (plugin && typeof plugin === 'object' && !(plugin as { init?: unknown }).init) {
    plugin = await loaders.wrapBundle(plugin as Record<string, unknown>);
  }
  return plugin;
}
