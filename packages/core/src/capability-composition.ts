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
 * What lives in the provider's own package, and why: the `email`, `sms` and
 * `push` arguments are read by `resolveEmailCapabilityArg`
 * (`@objectstack/plugin-email`), `resolveSmsCapabilityArg`
 * (`@objectstack/service-sms`) and `resolvePushCapabilityArg`
 * (`@objectstack/service-push`). Each refuses exactly the configurations its
 * package's transports cannot build, so it reads that package's transport
 * vocabulary — and all three packages depend on this one, so this package
 * cannot import them. {@link resolveCapabilityArgument} reads
 * each reader from the module the provider is constructed from, which every
 * boot has already loaded to reach the provider's class.
 *
 * Pure apart from the environment reads of the storage root, the mail and SMS
 * readers: importing this module loads nothing.
 */

import { PLATFORM_ALWAYS_ON_CAPABILITIES, PLATFORM_CAPABILITY_PROVIDERS } from '@objectstack/spec/kernel';
import { readEnvWithDeprecation } from '@objectstack/types';
import { CAPABILITY_PROVIDERS, KNOWLEDGE_STORE_PROVIDERS } from './capability-providers.js';
import type { CapabilityIdentities, KnowledgeStoreSpec } from './capability-providers.js';
import { resolveStackCollection } from './stack-collections.js';

type Bag = Record<string, unknown>;

const asBag = (value: unknown): Bag | undefined =>
  value && typeof value === 'object' ? (value as Bag) : undefined;

/** The tokens a served boot mounts providers for, and which of them the stack declares. */
export interface ServedCapabilities {
  /** Every token, deduplicated, in the order a served boot mounts its provider. */
  readonly tokens: readonly string[];
  /**
   * The tokens the stack itself declares — the "required" intent
   * (#1597): under `serve` a declared token whose provider cannot be provided
   * is a hard boot error, where a token the platform appended is best-effort.
   * A token the stack's items mount ({@link stackItemCapabilities}) is
   * declared too: the items ask for their reader as `requires` would.
   */
  readonly declared: ReadonlySet<string>;
  /** The declared tokens the stack's items mount and its `requires` does not list. */
  readonly byItems: ReadonlySet<string>;
}

/**
 * [ADR-0161 K8, item 12] The capability tokens the stack's ITEMS mount: each
 * token whose provider row in `PLATFORM_CAPABILITY_PROVIDERS`
 * (`@objectstack/spec`) names a `mountedBy` collection the stack holds an item
 * of — the top level, then each package body (`resolveStackCollection`). Today
 * one row: `knowledge`, by `knowledgeSources`, so a stack shipping a
 * `knowledge_source` is served the knowledge service and the deployment's
 * store without `requires: ['knowledge']`. Through the same provider entry as
 * the token: the item adds the token, and the token's row mounts the provider.
 */
export function stackItemCapabilities(stack: unknown): string[] {
  const tokens: string[] = [];
  for (const [token, row] of Object.entries(PLATFORM_CAPABILITY_PROVIDERS)) {
    const collection = row.mountedBy?.collection;
    if (collection !== undefined && resolveStackCollection(stack, collection).length > 0) tokens.push(token);
  }
  return tokens;
}

/**
 * The tokens whose providers schedule background work (durable retries, SLA
 * escalation, auth mail), so `job` and `queue` are mounted AHEAD of them.
 */
const NEEDS_JOB_AND_QUEUE: readonly string[] = ['email', 'approvals', 'auth'];

/**
 * The capability tokens a served boot mounts providers for, in mount order,
 * given the tokens the stack DECLARES — the rule `os serve` reads, in its
 * order:
 *
 *  1. the declared tokens, deduplicated in first-seen order. A reader hands
 *     them in as it reads them: `serve` and the handle by
 *     `stackDeclaredCapabilities` (the top-level `requires`, otherwise each
 *     package body's); `os migrate plan`'s declaration boot by the same reader,
 *     or off a compiled artifact for a host config. Reading `requires` stays
 *     each boot's own step, so it is ONE call shared with the other readers of
 *     `requires`, never a second copy inside this rule;
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
  declaredTokens: readonly string[],
  opts: {
    /** `serve`'s `--preset`; `minimal` mounts no slate. */
    readonly preset?: string;
    /** The host's process-level default tokens, appended before the slate. */
    readonly hostDefaults?: readonly string[];
    /**
     * The tokens the stack's items mount ({@link stackItemCapabilities}),
     * appended after the declared ones and read as declared.
     */
    readonly itemTokens?: readonly string[];
  } = {},
): ServedCapabilities {
  const tokens = [...new Set(declaredTokens)];
  const byItems = new Set<string>();
  for (const token of opts.itemTokens ?? []) {
    if (tokens.includes(token)) continue;
    tokens.push(token);
    byItems.add(token);
  }
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
  return { tokens, declared, byItems };
}

/** What {@link resolveCapabilityArgument} reads to build one provider's argument. */
export interface CapabilityArgumentInput {
  /** The stack being booted: its `analyticsCubes` (or `cubes`), `email`, `sms`, `push` and `appName` are read. */
  readonly stack: unknown;
  /** The app's root — the directory holding its `objectstack.config.ts` — handed to `automation`. */
  readonly packageRoot: string;
  /**
   * The module the provider is constructed from. Its own configuration reader
   * is read from it for `email`, `sms` and `push` (see the module header);
   * required for those three tokens.
   */
  readonly providerModule?: Readonly<Record<string, unknown>>;
  /** The environment the mail and SMS readers read. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * The platform database this boot resolved, when it resolved one itself:
   * its driver kind (`postgres`, `sqlite`, `turso`, …) and URL. Read by the
   * `knowledge` store choice ({@link resolveKnowledgeStore}); absent, the
   * choice reads `OS_DATABASE_URL`, else `DATABASE_URL`, from `env`.
   */
  readonly database?: CapabilityDatabase;
}

/** The platform database a boot resolved, as {@link CapabilityArgumentInput.database} carries it. */
export interface CapabilityDatabase {
  readonly driver?: string;
  readonly url?: string;
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
 *  - `push`: `{ config }` from `stack.push`, parsed by `PushServiceConfigSchema`
 *    — `resolvePushCapabilityArg`, read off the provider module. It THROWS on
 *    the relay transport (an absent key reads as it), which nothing sends yet,
 *    and on a configuration the schema refuses, an inline secret included.
 *  - `storage`: the local adapter at {@link resolveStorageLocalRootEnv}'s root,
 *    else `.objectstack/data/uploads` ({@link resolveStorageCapabilityArg}).
 *  - `knowledge`: `{ deploymentAdapter }`, the adapter id of the store
 *    {@link resolveKnowledgeStore} chooses and {@link resolveCapabilityExtras}
 *    mounts beside the service — the deployment's-store mark (ADR-0161 K4): a
 *    source that names no adapter binds to it. A service option, not an
 *    adapter-contract member; the store itself is told nothing. Read from the
 *    same {@link CapabilityArgumentInput.database} as the store's choice, so
 *    the two agree.
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
  if (token === 'push') {
    const read = providerReader<[unknown]>(token, input, 'resolvePushCapabilityArg');
    return { argument: read(stack.push ?? {}).options };
  }
  if (token === 'storage') {
    const storage = resolveStorageCapabilityArg(resolveStorageLocalRootEnv());
    return { argument: storage.options, localStorageRoot: storage.localRoot };
  }
  if (token === 'knowledge') {
    return { argument: { deploymentAdapter: resolveKnowledgeStore(input).store.adapterId } };
  }
  return { argument: undefined };
}

// ── extras ────────────────────────────────────────────────────────────────

/** One extra provider a served boot mounts after a token's main provider, and what it is built with. */
export interface CapabilityExtra {
  readonly pkg: string;
  readonly export: string;
  readonly identities: CapabilityIdentities;
  /** Construct the provider with this, or with no argument when `undefined`. */
  readonly argument?: unknown;
  /**
   * The package is an optional dependency of the boots that mount it: one
   * that cannot import it warns and goes on without it, on `os serve` and on
   * the verification handle alike.
   */
  readonly optional?: boolean;
}

/**
 * The extra providers a served boot mounts for `token` after its main
 * provider, each with its constructor argument — the rule `os serve` and the
 * handle both read in place of a row's `extras`.
 *
 *  - `knowledge`: the one vector store {@link resolveKnowledgeStore} chooses
 *    for the platform database.
 *  - any other token: its row's `extras`, each with no argument.
 *
 * Each boot skips an extra it already holds (`providesCapability`), as it
 * does for a row's `extras`.
 */
export function resolveCapabilityExtras(token: string, input: CapabilityArgumentInput): CapabilityExtra[] {
  if (token === 'knowledge') {
    const { store, argument } = resolveKnowledgeStore(input);
    return [
      { pkg: store.pkg, export: store.export, identities: store.identities, argument, ...(store.optional ? { optional: true } : {}) },
    ];
  }
  return (CAPABILITY_PROVIDERS[token]?.extras ?? []).map((extra) => ({ ...extra }));
}

// ── knowledge ─────────────────────────────────────────────────────────────

/** A PostgreSQL URL, as the pgvector store reads one. */
const POSTGRES_URL = /^postgres(ql)?:\/\//i;

/**
 * The vector store `requires: ['knowledge']` mounts beside the knowledge
 * service, and what it is constructed with (ADR-0161):
 *
 *  - the platform database is PostgreSQL — its resolved driver is `postgres`,
 *    or its URL is a `postgres://` / `postgresql://` one — ⇒ `pgvector`
 *    (`@objectstack/knowledge-pgvector`), handed that URL, so the store's
 *    tables live in the platform's own database, in a schema of their own;
 *  - any other database ⇒ `turso` (`@objectstack/knowledge-turso`), a libSQL
 *    file of its own: `knowledge.db` in the directory the boot keeps the
 *    default platform database in, and never that database's file —
 *    `<OS_HOME>/data/` when `OS_HOME` is set (`os start --home` sets it),
 *    else the app's `.objectstack/data/`. A database named by URL does not
 *    move it. The operator can name another store in the `knowledge.turso_url`
 *    setting, which the store holds to that data directory and refuses when
 *    it carries a NUL byte, written out or percent-encoded, before it reaches
 *    the libSQL client. An in-memory platform database (`:memory:`, or the
 *    `memory` driver) gets an in-memory store (`:memory:`).
 *
 * The database is the one the boot resolved ({@link CapabilityArgumentInput.database});
 * a boot that resolved none (a host whose own plugin provides the driver)
 * is judged by `OS_DATABASE_URL`, else `DATABASE_URL` — the variables the
 * pgvector store reads its URL from.
 */
export function resolveKnowledgeStore(input: CapabilityArgumentInput): {
  store: KnowledgeStoreSpec;
  argument: Record<string, unknown>;
} {
  const env = input.env ?? (typeof process !== 'undefined' ? process.env : {});
  const url = input.database
    ? input.database.url?.trim()
    : (env.OS_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || undefined);
  const postgres = input.database?.driver === 'postgres' || (url !== undefined && POSTGRES_URL.test(url));
  if (postgres) {
    return {
      store: KNOWLEDGE_STORE_PROVIDERS.pgvector,
      argument: url !== undefined && POSTGRES_URL.test(url) ? { url } : {},
    };
  }
  // An in-memory platform database keeps nothing past the process, and its
  // store keeps nothing either: a file beside it would outlive every row it
  // indexes (the verification handle boots an in-memory SQLite).
  if (url === ':memory:' || input.database?.driver === 'memory') {
    return { store: KNOWLEDGE_STORE_PROVIDERS.turso, argument: { url: ':memory:' } };
  }
  const home = env.OS_HOME?.trim();
  return {
    store: KNOWLEDGE_STORE_PROVIDERS.turso,
    argument: { projectRoot: input.packageRoot, ...(home ? { stateDir: home } : {}), urlFromSettings: true },
  };
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
