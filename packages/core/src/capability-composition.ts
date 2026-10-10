// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a served boot MOUNTS for a stack's capabilities, and what it CONSTRUCTS
 * each provider with — the one rule `os serve` (`@objectstack/cli`) and the
 * verification handle (`@objectstack/verify`'s `bootStack`) both read.
 *
 * ## Why this lives in `@objectstack/core`
 *
 * For one configuration, `bootStack` composes what `objectstack serve`
 * composes (#22301, ruling A). `capability-providers.ts`, beside this file,
 * answers WHICH provider a `requires` token names. Two more answers decided
 * what a served boot mounts, and until #22301 both were written inside
 * `serve`'s command body, where the handle could not read them
 * (`@objectstack/cli` depends on `@objectstack/verify`):
 *
 *  - WHICH TOKENS ({@link resolveServedCapabilities}). `serve` appends the
 *    always-on slate (`PLATFORM_ALWAYS_ON_CAPABILITIES`, `@objectstack/spec`) to
 *    every app's `requires`; the handle mounted only what `requires` named, and
 *    a slate provider only where a mounted plugin hard-depended on it.
 *  - WITH WHAT ({@link resolveCapabilityArgument}). `serve` hands `analytics`
 *    the app's `analyticsCubes`, `email` and `sms` the deployment's mail and SMS
 *    configuration, `storage` its local root, and `automation` the app's root;
 *    the handle built every provider but `automation` with its own defaults.
 *
 * So an app's tests ran without the cubes, the mail configuration and the
 * services the same app's users get. Both answers are here, and both boots read
 * them: ⛔ never a second copy beside a reader.
 *
 * ## The boundary, measured
 *
 * What stays with each boot, because it is that boot's own state:
 *
 *  - `serve`'s `--preset` (a CLI flag): `minimal` mounts no slate. Passed in as
 *    `preset`; the handle takes no preset, as `os migrate plan` takes none.
 *  - The host's process-level defaults, decided by process env and passed in as
 *    `hostDefaults`: `serve`'s MCP HTTP surface (`OS_MCP_SERVER_ENABLED`) and
 *    pinyin search (`OS_SEARCH_PINYIN_ENABLED`, which `serve` stamps from the
 *    stack's locales). Neither is a slate member nor a token the app declares.
 *  - What a boot does when a provider cannot be built (`serve`: a declared
 *    token fails the boot, a slate token is logged and skipped; the handle: any
 *    one fails the boot, with its remedy), and `serve`'s production warning
 *    about a local storage root.
 *
 * What lives in the provider's own package, and why: the `email` and `sms`
 * arguments are read by `resolveEmailCapabilityArg` (`@objectstack/plugin-email`)
 * and `resolveSmsCapabilityArg` (`@objectstack/service-sms`). Each refuses
 * exactly the configurations its package's transports cannot build, so it reads
 * that package's transport vocabulary — and both packages depend on this one,
 * so this package cannot import them. {@link resolveCapabilityArgument} reads
 * each reader from the module the provider is constructed from, which every
 * boot has already loaded to reach the provider's class.
 *
 * Pure apart from the environment reads of the storage root, the mail and SMS
 * readers: importing this module loads nothing.
 */

import { PLATFORM_ALWAYS_ON_CAPABILITIES } from '@objectstack/spec/kernel';
import { readEnvWithDeprecation } from '@objectstack/types';
import { CAPABILITY_PROVIDERS } from './capability-providers.js';
import { resolveStackCollection, stackDeclaredCapabilities } from './stack-collections.js';

type Bag = Record<string, unknown>;

const asBag = (value: unknown): Bag | undefined =>
  value && typeof value === 'object' ? (value as Bag) : undefined;

/** The tokens a served boot mounts providers for, and which of them the stack declares. */
export interface ServedCapabilities {
  /** Every token, deduplicated, in the order a served boot mounts its provider. */
  readonly tokens: readonly string[];
  /**
   * The tokens the stack itself declares in `requires` — the "required" intent
   * (#1597): under `serve` a declared token whose provider cannot be provided
   * is a hard boot error, where a token the platform appended is best-effort.
   */
  readonly declared: ReadonlySet<string>;
}

/**
 * The tokens whose providers schedule background work (durable retries, SLA
 * escalation, auth mail), so `job` and `queue` are mounted AHEAD of them.
 */
const NEEDS_JOB_AND_QUEUE: readonly string[] = ['email', 'approvals', 'auth'];

/**
 * The capability tokens a served boot of `stack` mounts providers for, in
 * mount order — the rule `os serve` reads, in its order:
 *
 *  1. the tokens the stack declares in `requires`
 *     ({@link stackDeclaredCapabilities}: the top-level list, otherwise each
 *     package body's), deduplicated in first-seen order;
 *  2. `email` when `auth` is declared — auth callbacks (password reset, email
 *     verification, magic link, invitation) depend on the email service, which
 *     falls back to its log transport when no provider is configured;
 *  3. `hostDefaults`, the host's own process-level defaults (see the module
 *     header);
 *  4. the always-on slate (`PLATFORM_ALWAYS_ON_CAPABILITIES`), unless the
 *     preset is `minimal`;
 *  5. `job`, then `queue`, moved to the FRONT when a token that schedules
 *     background work is present and they are not already mounted — so their
 *     plugins load, and their `kernel:ready` hooks fire, before a consumer
 *     subscribes to a queue from its own.
 *
 * A token with no provider row (a tier token such as `auth` or `ui`) is kept:
 * which tokens mount nothing is each reader's lookup in `CAPABILITY_PROVIDERS`.
 */
export function resolveServedCapabilities(
  stack: unknown,
  opts: {
    /** `serve`'s `--preset`; `minimal` mounts no slate. */
    readonly preset?: string;
    /** The host's process-level default tokens, appended before the slate. */
    readonly hostDefaults?: readonly string[];
  } = {},
): ServedCapabilities {
  const tokens = [...new Set(stackDeclaredCapabilities(stack))];
  const declared: ReadonlySet<string> = new Set(tokens);
  if (tokens.includes('auth') && !tokens.includes('email')) tokens.push('email');
  for (const token of opts.hostDefaults ?? []) {
    if (!tokens.includes(token)) tokens.push(token);
  }
  if (opts.preset !== 'minimal') {
    for (const token of PLATFORM_ALWAYS_ON_CAPABILITIES) {
      if (!tokens.includes(token)) tokens.push(token);
    }
  }
  if (NEEDS_JOB_AND_QUEUE.some((token) => tokens.includes(token))) {
    if (!tokens.includes('queue')) tokens.unshift('queue');
    if (!tokens.includes('job')) tokens.unshift('job');
  }
  return { tokens, declared };
}

/** What {@link resolveCapabilityArgument} reads to build one provider's argument. */
export interface CapabilityArgumentInput {
  /** The stack being booted: its `analyticsCubes` (or `cubes`), `email`, `sms` and `appName` are read. */
  readonly stack: unknown;
  /** The app's root — the directory holding its `objectstack.config.ts` — handed to `automation`. */
  readonly packageRoot: string;
  /**
   * The module the provider is constructed from. Its own configuration reader
   * is read from it for `email` and `sms` (see the module header); required
   * for those two tokens.
   */
  readonly providerModule?: Readonly<Record<string, unknown>>;
  /** The environment the mail and SMS readers read. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** One provider's constructor argument. */
export interface CapabilityArgument {
  /** Construct the provider with this, or with no argument when `undefined`. */
  readonly argument: unknown;
  /**
   * `storage` only: the local root the argument names, which `serve` warns
   * about on a production boot (uploads on one pod's disk).
   */
  readonly localStorageRoot?: string;
}

/** A provider module's own configuration reader, read off the module by name. */
function providerReader<A extends unknown[]>(
  token: string,
  input: CapabilityArgumentInput,
  exportName: string,
): (...args: A) => { options: Record<string, unknown> } {
  const reader = input.providerModule?.[exportName];
  if (typeof reader !== 'function') {
    throw new Error(
      `Capability "${token}": ${CAPABILITY_PROVIDERS[token]?.pkg ?? 'its provider package'} does not export ` +
        `${exportName}, the reader that builds the provider from this deployment's configuration — install a ` +
        'version of that package released with this one.',
    );
  }
  return reader as (...args: A) => { options: Record<string, unknown> };
}

/**
 * The argument a served boot constructs `token`'s MAIN provider with — the
 * rule `os serve` reads (its capability resolver) and the handle reads too.
 * A provider's `extras` take no argument.
 *
 *  - `automation`: `{ packageRoot }` — declarative connector file refs
 *    (`providerConfig.spec: './billing-openapi.json'`) resolve from the app's
 *    root, never from the process's working directory (#3016).
 *  - a token whose row declares `configKey: 'analyticsCubes'` (`analytics`):
 *    `{ cubes }` — the stack's top-level `analyticsCubes`, then its legacy
 *    `cubes` spelling, and only then each package body's
 *    (`resolveStackCollection`): a multi-package stack carries a package's
 *    cubes in that body alone (#22288).
 *  - `email`: the mail provider's options from `stack.email`, `OS_EMAIL_*` and
 *    `stack.appName` — `resolveEmailCapabilityArg`, read off the provider
 *    module. It THROWS on a configuration no transport can deliver through.
 *  - `sms`: the SMS provider's options from `stack.sms` and `OS_SMS_*` —
 *    `resolveSmsCapabilityArg`, read off the provider module. It THROWS on a
 *    provider tag no transport can deliver through.
 *  - `storage`: the local adapter at {@link resolveStorageLocalRootEnv}'s root,
 *    else `.objectstack/data/uploads` ({@link resolveStorageCapabilityArg}).
 *  - any other token: no argument.
 *
 * A throw is the boot's to report: whether it fails the boot or is logged is
 * each reader's rule (see the module header).
 */
export function resolveCapabilityArgument(token: string, input: CapabilityArgumentInput): CapabilityArgument {
  const stack = asBag(input.stack) ?? {};
  if (token === 'automation') {
    return { argument: { packageRoot: input.packageRoot } };
  }
  if (CAPABILITY_PROVIDERS[token]?.configKey === 'analyticsCubes') {
    const cubes = stack.analyticsCubes ?? stack.cubes ?? resolveStackCollection(input.stack, 'analyticsCubes');
    return { argument: { cubes } };
  }
  const env = input.env ?? (typeof process !== 'undefined' ? process.env : {});
  if (token === 'email') {
    const read = providerReader<[unknown, unknown, unknown]>(token, input, 'resolveEmailCapabilityArg');
    return { argument: read(stack.email ?? {}, env, stack.appName).options };
  }
  if (token === 'sms') {
    const read = providerReader<[unknown, unknown]>(token, input, 'resolveSmsCapabilityArg');
    return { argument: read(stack.sms ?? {}, env).options };
  }
  if (token === 'storage') {
    const storage = resolveStorageCapabilityArg(resolveStorageLocalRootEnv());
    return { argument: storage.options, localStorageRoot: storage.localRoot };
  }
  return { argument: undefined };
}

// ── storage ───────────────────────────────────────────────────────────────
// Moved here from `@objectstack/cli`'s `serve.ts` (#22301), which re-exports
// both names, so every boot that composes what `serve` composes reads one root.

/**
 * Constructor options for `StorageServicePlugin`, plus the local root to name in
 * the production warning (absent when the host configured a backend itself).
 */
export interface StorageCapabilityArg {
  options: Record<string, unknown>;
  localRoot?: string;
}

/**
 * Resolve what `StorageServicePlugin` is constructed with (#4096).
 *
 * Storage is in the default capability slate, so a host that configures nothing
 * still gets local disk under `.objectstack/data/uploads/` and avatars /
 * attachments / report files work out of the box.
 *
 * The fallback used to be `{ driver: 'local', root }` — neither of which
 * `StorageServicePluginOptions` declares. Both were dropped on the floor, so the
 * plugin applied its OWN default (`./storage`), the storage-root env var changed
 * nothing, and uploads landed somewhere the operator never named. The `storage`
 * settings namespace then corrected the root on its first read (its manifest
 * default IS `./.objectstack/data/uploads`), which swapped the adapter and
 * warned about stranded files — on every boot of a healthy server.
 *
 * #4096 fixed the option SHAPE; the value still could not reach the settings
 * side, because the CLI and the settings service spelled the env var
 * differently. {@link resolveStorageLocalRootEnv} is the channel that closes
 * that gap (#4968) — read the root through it, never off `process.env`
 * directly.
 *
 * `config.storage` is deliberately NOT read (framework#4167). It was never a
 * stack key: `ObjectStackDefinitionSchema` does not declare it, and the schema
 * is not `.strict()`, so `defineStack` — which every documented authoring path
 * and every compiled artifact goes through — strips it before `serve` could
 * ever see it. It arrived here only from a bare-object config on the
 * config-boot path, i.e. one unreachable-in-practice combination, where it then
 * ALSO carried the `driver`/`root` spelling the plugin does not read. Honouring
 * it on that one path meant the same authoring key worked in one place and
 * vanished in every other, which is worse than not having it.
 *
 * The storage backend is a deployment concern with two real channels: the
 * `OS_STORAGE_*` env vars (below) and the `storage` settings namespace, which
 * is also the one with proper credential handling. Authors who write `storage:`
 * anyway now get told so — `lintUnknownStackKeys` reports undeclared top-level
 * keys, and `STACK_KEY_GUIDANCE` names both channels.
 */
export function resolveStorageCapabilityArg(envRoot?: string): StorageCapabilityArg {
  const rootDir = envRoot?.trim() || '.objectstack/data/uploads';
  return { options: { adapter: 'local', local: { rootDir } }, localRoot: rootDir };
}

/**
 * The ONE env channel for the local storage root (#4968).
 *
 * The CLI used to invent its own name, `OS_STORAGE_ROOT`, while the settings
 * service derives the env name for the same value from the namespace it owns:
 * `envKeyOf('storage', 'local_root')` = `OS_STORAGE_LOCAL_ROOT`. Nothing in the
 * repo ever set that name, so the two channels never met — the CLI constructed
 * an adapter at the root the operator asked for, and `StorageServicePlugin`
 * then re-resolved from settings at `kernel:ready`, found nothing but the
 * manifest's schema DEFAULT, and swapped the adapter to
 * `./.objectstack/data/uploads`.
 *
 * The consequences were not log noise:
 *
 *  - `OS_STORAGE_ROOT` took effect for exactly one value — the one that happens
 *    to equal the manifest default. Every other value (`/srv/uploads`, a
 *    `--fresh` tempdir) was constructed and then discarded, so an operator
 *    following `backup-restore.mdx` backed up an empty directory.
 *  - `dev --fresh` promised the tempdir "owns ALL persistent state for this
 *    run"; uploads actually landed under the project cwd and survived exit.
 *  - The "adapter swapped … may be unreachable" warning on every clean boot was
 *    ACCURATE — the swap really happened. It is not touched here, and it stops
 *    firing because the swap stops happening.
 *
 * So the fix is at the producer, not in a tolerant consumer: write the name the
 * settings service already declares. The legacy name is read for one more
 * release via {@link readEnvWithDeprecation} and, when it is the one that
 * supplied the value, STAMPED onto the canonical name — the settings service
 * reads `process.env` live through its own `env` reference and only ever looks
 * up `OS_STORAGE_LOCAL_ROOT`, so without the stamp a legacy deployment would
 * keep the exact bug this fixes. With it, settings resolves
 * `source: 'env'`/`locked: true` at the value the adapter was built with,
 * `needsStorageSwap` answers false, and the two channels agree by construction.
 *
 * Side-effecting on purpose, and idempotent: `readEnvWithDeprecation`
 * deduplicates its warning process-wide, and once stamped the canonical branch
 * wins on every later call.
 *
 * @returns The resolved root, or `undefined` when neither name is set (the
 *          caller then falls through to `resolveStorageCapabilityArg`'s
 *          built-in default, which matches the manifest default).
 */
export function resolveStorageLocalRootEnv(): string | undefined {
  const value = readEnvWithDeprecation('OS_STORAGE_LOCAL_ROOT', 'OS_STORAGE_ROOT');
  if (value === undefined) return undefined;
  // Bridge the legacy spelling onto the canonical one the settings service
  // reads. Guarded so we never rewrite a canonical value with itself.
  if (typeof process !== 'undefined' && process.env
    && process.env.OS_STORAGE_LOCAL_ROOT === undefined) {
    process.env.OS_STORAGE_LOCAL_ROOT = value;
  }
  return value;
}
