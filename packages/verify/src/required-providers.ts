// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22301] The providers an app's `requires` names, constructed for the
// verification boot by `objectstack serve`'s own lookup.
//
// `serve` turns each `requires` token into its provider plugin (its capability
// resolver, step 5). `bootStack` booted a fixed plugin set instead, so an app's
// tests ran without the services the same app gets on a real server — no
// record-change trigger fired on a write, no approval node had a service — and
// an app named the plugins by hand in `extraPlugins`. Under the maintainer's B′
// ruling an app's tests reach the real engine through this handle and nothing
// hand-built, so that list was a local stand-in for a platform gap.
//
// ## What is `serve`'s, read from where `serve` reads it
//
//   · WHICH tokens: `stackDeclaredCapabilities` (`@objectstack/core`) — the top-
//     level `requires` when the stack carries one, otherwise each package
//     body's. One reader for both boots, so a multi-package app boots one set
//     of providers under `serve` and under its tests.
//   · WHICH provider: `CAPABILITY_PROVIDERS` (`@objectstack/core`), the table
//     `Serve.CAPABILITY_PROVIDERS` is a handle over — main provider, then its
//     `extras`.
//   · WHEN NOT: `providesCapability`'s exact identity match against what this
//     boot already holds — the harness's own settings / analytics / sharing
//     services, `opts.automation`, and every `opts.extraPlugins` entry. A
//     provider already held skips its whole token, extras included: `serve`'s
//     "an explicit instance wins" rule, so a suite that passes its own
//     instance keeps it.
//   · A token with no row — a tier token (`auth`, `ui`, `i18n`, `ai`) or a
//     known token no open package provides (`hierarchy-security`) — mounts
//     nothing here, as it mounts nothing in `serve`'s resolver.
//
// ## What is this boot's own
//
//   · CONSTRUCTION. `serve` reads mail, SMS and storage transports from the app
//     and the environment; a verification boot never sends mail or SMS from a
//     test, so every provider is constructed with its own defaults — the way
//     `bootStack({ automation: true })` has always constructed the automation
//     service. The one argument kept is `automation`'s `packageRoot`, the
//     app's root, which `serve` passes for the same token (`hostRoot` here).
//   · THE HARD DEPENDENCIES of what it mounts. `serve` mounts its always-on
//     slate (`queue`, `job`, `messaging`, …) on every boot, and some providers
//     hard-depend on one of them: `triggers`' schedule extras on `job`, its API
//     trigger on `queue`, `webhooks` on `messaging`. This boot does not mount
//     the slate, so it mounts exactly the slate providers a mounted provider
//     hard-depends on — found in the same table, among the tokens a served boot
//     of this app would have mounted (its `requires` and the slate). A
//     dependency no such token supplies is left to the kernel, whose refusal
//     names it, as `serve`'s would.
//   · FAILURE. A provider this boot set out to construct and could not is a
//     thrown boot error naming the token and the package — every package in the
//     table is a dependency of `@objectstack/verify` (pinned), so a failure here
//     is a broken install or a provider that refuses to start, never an absence
//     to scroll past.

import { CAPABILITY_PROVIDERS, providesCapability, stackDeclaredCapabilities } from '@objectstack/core';
import { PLATFORM_ALWAYS_ON_CAPABILITIES } from '@objectstack/spec/kernel';

/** A plugin's registered `name`, as the kernel keys it. */
function pluginName(plugin: unknown): string | undefined {
  const name = (plugin as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' ? name : undefined;
}

/** A plugin's HARD dependencies, as the kernel orders them. */
function hardDependencies(plugin: unknown): string[] {
  const deps = (plugin as { dependencies?: unknown } | null | undefined)?.dependencies;
  return Array.isArray(deps) ? deps.filter((d): d is string => typeof d === 'string') : [];
}

/** One provider of the table, constructed with this boot's argument for its token. */
async function constructProvider(
  token: string,
  pkg: string,
  exportName: string,
  arg: unknown,
): Promise<unknown> {
  try {
    const mod = (await import(/* webpackIgnore: true */ pkg)) as Record<string, unknown>;
    const Ctor = mod[exportName] as (new (arg?: unknown) => unknown) | undefined;
    if (typeof Ctor !== 'function') throw new Error(`${pkg} does not export ${exportName}`);
    return arg === undefined ? new Ctor() : new Ctor(arg);
  } catch (e) {
    throw new Error(
      `verify: requires: ['${token}'] names ${exportName} (${pkg}), and this boot could not construct it: ` +
        `${(e as Error).message}. Every provider in the capability table is a dependency of @objectstack/verify, ` +
        'so this is a broken install or a provider that refuses to start — the boot does not continue without ' +
        'a service the app declares.',
    );
  }
}

/**
 * The provider plugins the app's `requires` names that this boot does not
 * already hold, plus the always-on providers they hard-depend on — in the order
 * to register them (dependencies first). Constructed, not registered: the
 * caller registers them in its own slot.
 *
 * @param held - Every plugin instance this boot mounts on its own or was handed
 *   (`opts.extraPlugins`, `opts.automation`'s instance, the harness's services).
 * @param isRegistered - Whether a plugin of that name is already registered on
 *   the kernel (a dependency the boot itself satisfies).
 * @param packageRoot - The app's root, handed to `automation` as `serve` does.
 */
export async function constructRequiredProviders(opts: {
  config: unknown;
  held: readonly unknown[];
  isRegistered: (name: string) => boolean;
  packageRoot: string;
}): Promise<unknown[]> {
  const declared = [...new Set(stackDeclaredCapabilities(opts.config))];
  const named: unknown[] = [];
  const dependencies: unknown[] = [];
  const all = (): unknown[] => [...opts.held, ...dependencies, ...named];

  for (const token of declared) {
    const spec = CAPABILITY_PROVIDERS[token];
    if (!spec) continue;
    if (providesCapability(all(), spec.identities)) continue;
    const arg = token === 'automation' ? { packageRoot: opts.packageRoot } : undefined;
    named.push(await constructProvider(token, spec.pkg, spec.export, arg));
    for (const extra of spec.extras ?? []) {
      if (providesCapability(all(), extra.identities)) continue;
      named.push(await constructProvider(token, extra.pkg, extra.export, undefined));
    }
  }

  // The hard dependencies of what this boot mounts, to a fixed point (a
  // dependency's own dependencies included), searched among the tokens a
  // served boot of this app would have mounted.
  const searched = [...new Set([...declared, ...PLATFORM_ALWAYS_ON_CAPABILITIES])];
  for (;;) {
    const present = new Set(all().map(pluginName).filter((n): n is string => n !== undefined));
    let next: string | undefined;
    for (const plugin of [...named, ...dependencies]) {
      for (const dependency of hardDependencies(plugin)) {
        if (present.has(dependency) || opts.isRegistered(dependency)) continue;
        next = searched.find((t) => {
          const spec = CAPABILITY_PROVIDERS[t];
          return spec !== undefined && spec.identities.includes(dependency) && !providesCapability(all(), spec.identities);
        });
        if (next) break;
      }
      if (next) break;
    }
    if (!next) break;
    const spec = CAPABILITY_PROVIDERS[next]!;
    dependencies.push(await constructProvider(next, spec.pkg, spec.export, undefined));
  }

  return [...dependencies, ...named];
}
