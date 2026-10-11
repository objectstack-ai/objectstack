// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22301] The capability providers `objectstack serve` mounts for a
// configuration, constructed for the verification boot by `serve`'s own rules.
//
// `serve` turns each `requires` token into its provider plugin (its capability
// resolver, step 5), appends the always-on slate to every app, and builds each
// provider from the app's configuration. `bootStack` booted a fixed plugin set
// instead, then the providers `requires` names built with their own defaults;
// so an app's tests ran without the services, the cubes and the mail settings
// the same app gets on a real server, and an app named plugins by hand in
// `extraPlugins`. Under the maintainer's B′ ruling an app's tests reach the
// real engine through this handle and nothing hand-built, and under ruling A
// (#22301) `bootStack` composes what `serve` composes for one configuration.
//
// ## What is `serve`'s, read from where `serve` reads it (`@objectstack/core`)
//
//   · WHICH tokens: `resolveServedCapabilities` over the tokens the app
//     declares as `stackDeclaredCapabilities` reads them (the top-level
//     `requires` when the stack carries one, otherwise each package body's) —
//     `email` for a declared `auth`, the always-on slate
//     (`PLATFORM_ALWAYS_ON_CAPABILITIES`), and `job` / `queue` ahead of the
//     tokens that schedule background work. No preset: `bootStack` takes none,
//     so the slate is always mounted, as on a `serve` with no `--preset`.
//   · WHICH provider: `CAPABILITY_PROVIDERS`, the table
//     `Serve.CAPABILITY_PROVIDERS` is a handle over — main provider, then its
//     `extras`.
//   · WITH WHAT: `resolveCapabilityArgument` — `automation` the app's root
//     (`hostRoot` here), `analytics` the app's cubes, `email` / `sms` the
//     deployment's mail and SMS configuration (from the configuration and the
//     `OS_EMAIL_*` / `OS_SMS_*` environment, by the readers their packages
//     export), `storage` its local root. An extra takes no argument.
//   · WHEN NOT: `providesCapability`'s exact identity match against what this
//     boot already holds — the harness's own settings / analytics / sharing
//     services, `opts.automation`, every `opts.extraPlugins` entry, and every
//     plugin of the app's own `plugins` array. A provider already held skips
//     its whole token, extras included: `serve`'s "an explicit instance wins"
//     rule, so an app that wires a provider itself, or a suite that passes its
//     own instance, keeps it.
//   · A token with no row — a tier token (`auth`, `ui`, `i18n`, `ai`) or a
//     known token no open package provides (`hierarchy-security`) — mounts
//     nothing here, as it mounts nothing in `serve`'s resolver.
//
// ## What is this boot's own
//
//   · THE HOST DEFAULTS. `serve` also mounts MCP (`OS_MCP_SERVER_ENABLED`, on
//     by default) and pinyin search (`OS_SEARCH_PINYIN_ENABLED`, which `serve`
//     stamps into its process environment from the stack's locales). Both are
//     decisions about a server process, not about the configuration, and this
//     boot passes none: a suite that exercises either passes the provider in
//     `extraPlugins` (the MCP and pinyin dogfood suites do).
//   · FAILURE. A provider this boot set out to construct and could not is a
//     thrown boot error naming the token and the package, whether the app
//     declared the token or the slate appended it — `serve` logs a slate
//     provider it cannot build and boots on, and a test boot that went on
//     without it would pass green on a composition production does not run.
//     Every package in the table is a dependency of `@objectstack/verify`
//     (pinned), so an import failure is a broken install; a configuration the
//     mail or SMS reader refuses names its own remedy.

import {
  CAPABILITY_PROVIDERS,
  providesCapability,
  resolveCapabilityArgument,
  resolveServedCapabilities,
  stackDeclaredCapabilities,
} from '@objectstack/core';

/** Why this boot constructs a provider, as a refusal names it. */
function reasonFor(token: string, declared: ReadonlySet<string>): string {
  return declared.has(token)
    ? `requires: ['${token}']`
    : `the always-on '${token}' capability (objectstack serve mounts it for every app)`;
}

/** One provider of the table, loaded and constructed with this configuration's argument. */
async function constructProvider(opts: {
  reason: string;
  pkg: string;
  exportName: string;
  /** The constructor argument, read off the loaded module; absent ⇒ no argument. */
  argumentFor?: (mod: Record<string, unknown>) => unknown;
}): Promise<unknown> {
  const { reason, pkg, exportName } = opts;
  type ProviderClass = new (arg?: unknown) => unknown;
  let loaded: { mod: Record<string, unknown>; Ctor: ProviderClass };
  try {
    const mod = (await import(/* webpackIgnore: true */ pkg)) as Record<string, unknown>;
    const Ctor = mod[exportName];
    if (typeof Ctor !== 'function') throw new Error(`${pkg} does not export ${exportName}`);
    loaded = { mod, Ctor: Ctor as ProviderClass };
  } catch (e) {
    throw new Error(
      `verify: ${reason} names ${exportName} (${pkg}), and this boot could not load it: ` +
        `${(e as Error).message}. Every provider in the capability table is a dependency of @objectstack/verify, ` +
        'so this is a broken install — the boot does not continue without a service objectstack serve mounts ' +
        'for this configuration.',
    );
  }
  const { mod, Ctor } = loaded;
  let arg: unknown;
  try {
    arg = opts.argumentFor?.(mod);
  } catch (e) {
    throw new Error(
      `verify: ${reason} names ${exportName} (${pkg}), and this configuration cannot build it: ` +
        `${(e as Error).message} objectstack serve refuses or skips the same configuration; the boot does not ` +
        'continue without the service.',
    );
  }
  try {
    return arg === undefined ? new Ctor() : new Ctor(arg);
  } catch (e) {
    throw new Error(
      `verify: ${reason} names ${exportName} (${pkg}), and it refused to construct: ${(e as Error).message}. ` +
        'The boot does not continue without a service objectstack serve mounts for this configuration.',
    );
  }
}

/**
 * The provider plugins `objectstack serve` mounts for this configuration that
 * this boot does not already hold — the app's `requires` and the always-on
 * slate, in `serve`'s mount order, each built from the configuration as
 * `serve` builds it. Constructed, not registered: the caller registers them in
 * its own slot.
 *
 * @param held - Every plugin instance this boot mounts on its own or was handed
 *   (`opts.extraPlugins`, `opts.automation`'s instance, the harness's services,
 *   the app's own `plugins`).
 * @param packageRoot - The app's root, handed to `automation` as `serve` does.
 */
export async function constructServedProviders(opts: {
  config: unknown;
  held: readonly unknown[];
  packageRoot: string;
}): Promise<unknown[]> {
  const { tokens, declared } = resolveServedCapabilities(stackDeclaredCapabilities(opts.config));
  const constructed: unknown[] = [];
  const all = (): unknown[] => [...opts.held, ...constructed];

  for (const token of tokens) {
    const spec = CAPABILITY_PROVIDERS[token];
    if (!spec) continue;
    if (providesCapability(all(), spec.identities)) continue;
    const reason = reasonFor(token, declared);
    constructed.push(
      await constructProvider({
        reason,
        pkg: spec.pkg,
        exportName: spec.export,
        argumentFor: (mod) =>
          resolveCapabilityArgument(token, {
            stack: opts.config,
            packageRoot: opts.packageRoot,
            providerModule: mod,
          }).argument,
      }),
    );
    for (const extra of spec.extras ?? []) {
      if (providesCapability(all(), extra.identities)) continue;
      constructed.push(await constructProvider({ reason, pkg: extra.pkg, exportName: extra.export }));
    }
  }

  return constructed;
}
