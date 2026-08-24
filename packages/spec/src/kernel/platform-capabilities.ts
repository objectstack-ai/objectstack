// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Platform SERVICE capability vocabulary — the canonical tokens accepted in a
 * stack's `requires: [...]` declaration (framework#3265).
 *
 * ONE vocabulary across every runtime that resolves `requires`: the standalone
 * `os serve` / `os start` path (`@objectstack/cli`) and cloud's multi-tenant
 * `objectos-runtime` capability loader. Both loaders key their provider
 * registries by these tokens, so a stack declaration means the same thing
 * wherever it boots. (These are platform SERVICE capabilities — NOT the
 * ADR-0066 authorization capabilities declared in `capabilities: [...]`.)
 *
 * Canonical spelling is lower-case kebab-case (`ai-studio`, `pinyin-search`,
 * `hierarchy-security`). The legacy camelCase spellings (`aiStudio` / `aiSeat`)
 * that shipped transitionally were honored as deprecated aliases for one cycle
 * (framework#3265) and have been REMOVED (framework#3308) — they are now plain
 * unknown tokens, rejected by `defineStack` like any other typo.
 *
 * Growing the platform: when a new `requires`-resolvable service ships, add
 * its token HERE as well as to the runtime's provider registry — the CLI's
 * vocabulary-drift test fails if the registries and this list fall out of
 * sync. An unknown token is REJECTED by `defineStack` at authoring time
 * (framework#3265) — the vocabulary is the union of every token the framework
 * CLI and cloud's objectos-runtime resolve, so a token outside it is a typo or
 * stale reference no runtime provides (Prime Directive #12: surface producer
 * mistakes at authoring, loudly). The serve resolver still only WARNS on an
 * unknown token in a raw artifact — a pre-built/older-spec artifact must not
 * crash-boot a running server over a no-op token; authoring is the gate.
 */
export const PLATFORM_CAPABILITY_TOKENS: readonly string[] = Object.freeze([
  // Tier-gated capabilities (framework `serve.ts` CAPABILITY_TO_TIER)
  'ai',
  'ai-studio',
  'i18n',
  'ui',
  'auth',
  // Service capabilities (framework `serve.ts` CAPABILITY_PROVIDERS)
  'automation',
  'analytics',
  'audit',
  'cache',
  'storage',
  'queue',
  'job',
  'messaging',
  'triggers',
  'realtime',
  'mcp',
  'marketplace',
  'email',
  'sms',
  'sharing',
  'pinyin-search',
  'reports',
  'approvals',
  'settings',
  'webhooks',
  // Enterprise / cloud-runtime capabilities (no open-edition provider:
  // `hierarchy-security` ships in @objectstack/security-enterprise via
  // `plugins[]`; `ai-seat` / `governance` are resolved by cloud's
  // objectos-runtime loader only)
  'hierarchy-security',
  'ai-seat',
  'governance',
]);

/**
 * True when the token is part of the platform capability vocabulary. There is
 * no longer any alias canonicalization (framework#3308) — a token is known iff
 * it appears verbatim in {@link PLATFORM_CAPABILITY_TOKENS}.
 */
export function isKnownPlatformCapability(token: string): boolean {
  return PLATFORM_CAPABILITY_TOKENS.includes(token);
}

/**
 * Distribution edition that ships an *installable* provider for a capability.
 *
 *   - `open`       — a framework `@objectstack/*` package on the public registry
 *                    (bundled as a dependency of `@objectstack/cli`, so a
 *                    `requires` token backed by one resolves out of the box).
 *   - `enterprise` — a separately-licensed enterprise package the app installs
 *                    and wires in via `plugins[]` (e.g. `hierarchy-security`).
 *   - `cloud`      — realized only by a cloud runtime tier; there is **no
 *                    installable version in the open edition**. This is the
 *                    boundary framework#3366 makes legible: "add it to your
 *                    dependencies" is un-followable, so the error must say so.
 */
export type CapabilityEdition = 'open' | 'enterprise' | 'cloud';

/** How a platform SERVICE capability's runtime is provided (framework#3366). */
export interface PlatformCapabilityProvider {
  /**
   * npm package whose plugin the runtime loads to satisfy this capability, or
   * `null` when the capability is a cloud-runtime tier with no standalone
   * package to install (`ai-seat` / `governance`).
   */
  readonly package: string | null;
  /** Which edition ships an installable version of {@link package}. */
  readonly edition: CapabilityEdition;
  /**
   * Short human note on the edition boundary, surfaced verbatim inside the
   * preflight / boot error so the message carries its own context.
   */
  readonly note?: string;
}

/**
 * Every {@link PLATFORM_CAPABILITY_TOKENS} entry → the package + edition that
 * provides its runtime (framework#3366). This is the single machine-readable
 * source of truth for the knowledge `serve`'s CAPABILITY_PROVIDERS map + tier
 * gating already encode informally, lifted so a preflight can read it *before*
 * boot and report instead of aborting — and so cloud's objectos-runtime and the
 * framework CLI classify a `requires` token identically.
 *
 * A drift test (`serve-capability-vocabulary.test.ts`) asserts this map and the
 * vocabulary stay in 1:1 sync, and that every `open`-edition entry agrees with
 * the package the serve resolver actually loads — so the two can't diverge.
 *
 * One population is structurally OUTSIDE this map's key space: an out-of-repo
 * runtime wired in via `plugins[]` that backs no `requires` token has no token
 * to key a row by. {@link PLATFORM_PLUGIN_WIRED_RUNTIMES} is the sibling roster
 * that records those — same provenance shape, keyed by package name.
 */
export const PLATFORM_CAPABILITY_PROVIDERS: Readonly<Record<string, PlatformCapabilityProvider>> =
  Object.freeze({
    // ── Tier-gated capabilities (serve.ts CAPABILITY_TO_TIER) ──────────────
    // `ai` / `ai-studio` were removed from the open edition (ADR-0025): the AI
    // runtime is cloud-only, so under the open edition there is NO version to
    // install — the boundary framework#3366 exists to surface.
    ai: {
      package: '@objectstack/service-ai',
      edition: 'cloud',
      note: 'cloud-only since 11.3.0 / ADR-0025',
    },
    'ai-studio': {
      package: '@objectstack/service-ai-studio',
      edition: 'cloud',
      note: 'cloud-only AI authoring; not part of the open framework',
    },
    i18n: { package: '@objectstack/service-i18n', edition: 'open' },
    ui: { package: '@objectstack/console', edition: 'open' },
    auth: { package: '@objectstack/plugin-auth', edition: 'open' },
    // ── Service capabilities (serve.ts CAPABILITY_PROVIDERS) ───────────────
    automation: { package: '@objectstack/service-automation', edition: 'open' },
    analytics: { package: '@objectstack/service-analytics', edition: 'open' },
    audit: { package: '@objectstack/plugin-audit', edition: 'open' },
    cache: { package: '@objectstack/service-cache', edition: 'open' },
    storage: { package: '@objectstack/service-storage', edition: 'open' },
    queue: { package: '@objectstack/service-queue', edition: 'open' },
    job: { package: '@objectstack/service-job', edition: 'open' },
    messaging: { package: '@objectstack/service-messaging', edition: 'open' },
    triggers: { package: '@objectstack/trigger-record-change', edition: 'open' },
    realtime: { package: '@objectstack/service-realtime', edition: 'open' },
    mcp: { package: '@objectstack/mcp', edition: 'open' },
    marketplace: { package: '@objectstack/service-package', edition: 'open' },
    email: { package: '@objectstack/plugin-email', edition: 'open' },
    sms: { package: '@objectstack/service-sms', edition: 'open' },
    sharing: { package: '@objectstack/plugin-sharing', edition: 'open' },
    'pinyin-search': { package: '@objectstack/plugin-pinyin-search', edition: 'open' },
    reports: { package: '@objectstack/plugin-reports', edition: 'open' },
    approvals: { package: '@objectstack/plugin-approvals', edition: 'open' },
    settings: { package: '@objectstack/service-settings', edition: 'open' },
    webhooks: { package: '@objectstack/plugin-webhooks', edition: 'open' },
    // ── Enterprise / cloud-runtime capabilities ────────────────────────────
    'hierarchy-security': {
      package: '@objectstack/security-enterprise',
      edition: 'enterprise',
      note: 'ADR-0057 hierarchy scopes ship in the enterprise edition',
    },
    'ai-seat': { package: null, edition: 'cloud', note: 'cloud AI-seat tier' },
    governance: { package: null, edition: 'cloud', note: 'cloud governance tier' },
  });

/**
 * Provenance row for one out-of-repo platform runtime that reaches the kernel
 * through app `plugins[]` wiring (host-app declaration) rather than through a
 * `requires` capability token. Same provenance facts as
 * {@link PlatformCapabilityProvider} minus `package` (here the package name is
 * the KEY, so it cannot be `null` and cannot drift from a duplicate field).
 */
export interface PlatformPluginWiredRuntime {
  /**
   * Which edition ships the runtime. Never `open` — an open-edition package is
   * part of the public framework distribution and is resolved through a
   * `requires` token, so it belongs in {@link PLATFORM_CAPABILITY_PROVIDERS},
   * not here. The exclusion is type-level so a mis-filed row cannot compile.
   */
  readonly edition: Exclude<CapabilityEdition, 'open'>;
  /**
   * Short human note on where the runtime ships from and how it is loaded.
   * Required, not optional: recording that provenance is this roster's entire
   * job — a row without it answers nothing.
   */
  readonly note: string;
}

/**
 * The `plugins[]`-wired out-of-repo runtimes, keyed by npm package name — the
 * companion roster to {@link PLATFORM_CAPABILITY_PROVIDERS} for the packages
 * whose loading is NOT keyed by a `requires` token (#10921, #11263).
 *
 * Why it exists: this tree names closed-source `@objectstack/` packages it does
 * not build — `serve` prints an install instruction for one of them at
 * operators — and until this roster, "is that a real out-of-repo package or a
 * fabricated name?" was answerable only by grep-and-judgement. A fabricated
 * package name (`@objectstack/framework`) sat next to a real one
 * (`@objectstack/organizations`) in published docs for months looking identical
 * (#10921). A row here is the machine-readable declaration that the package is
 * real and where it ships from.
 *
 * What this roster deliberately is NOT: a resolution registry. It does not make
 * these packages `requires`-resolvable, adds nothing to
 * {@link PLATFORM_CAPABILITY_TOKENS}, and does not relate tenancy posture to
 * the capability vocabulary. Each runtime's load condition lives in the runtime
 * that loads it (`serve` loads `@objectstack/organizations` off the resolved
 * tenancy posture, ADR-0105; an app wires `@objectstack/security-enterprise`
 * into its own `plugins[]`) — the rows record that fact as prose provenance,
 * they do not encode it as a lookup.
 *
 * On the single-list rule (see {@link PLATFORM_ALWAYS_ON_CAPABILITIES} on why a
 * second description nobody checks is a defect): this roster's key space is
 * DISJOINT from the token-keyed map — package names, not tokens — and the one
 * fact the two can state twice (the edition of a package that also backs a
 * token, today `@objectstack/security-enterprise` behind `hierarchy-security`)
 * is drift-tested to agree, in `serve-capability-vocabulary.test.ts` alongside
 * the map's own 1:1 pins. The same test derives membership the other way too:
 * every `enterprise`-edition provider row names a `plugins[]`-wired package (by
 * {@link CapabilityEdition}'s own definition), so each must have a row here.
 *
 * Growing it: a new out-of-repo `plugins[]`-wired runtime adds its row HERE in
 * the PR that first names the package at operators or in published docs.
 */
export const PLATFORM_PLUGIN_WIRED_RUNTIMES: Readonly<Record<string, PlatformPluginWiredRuntime>> =
  Object.freeze({
    '@objectstack/organizations': {
      edition: 'enterprise',
      note:
        'closed-source multi-org runtime (ADR-0105); `serve` loads it from the host app ' +
        'when the resolved tenancy posture is `group`/`isolated` — no `requires` token; ' +
        'not on the public npm registry, distributed with an enterprise/cloud subscription',
    },
    '@objectstack/security-enterprise': {
      edition: 'enterprise',
      note:
        'closed-source enterprise security runtime; the app wires it in via `plugins[]`. ' +
        'Also backs the `hierarchy-security` token above (ADR-0057) — the drift test holds ' +
        'both rows to one edition',
    },
  });

/**
 * The foundational capability slate: what every server-side runtime is expected
 * to mount whether or not an app names it in `requires`.
 *
 * These are the services the platform assumes exist — background work, settings
 * persistence, transactional mail, file uploads, notifications, analytics — so
 * an app that never declares them still behaves the way its authors (and the
 * Studio surfaces) expect.
 *
 * Published here rather than left on `Serve.ALWAYS_ON_CAPABILITIES` for the same
 * reason {@link PLATFORM_CAPABILITY_PROVIDERS} was: **more than one runtime
 * mounts this slate.** The CLI's `serve` builds one kernel per process; cloud's
 * objectos-runtime builds one per tenant environment, from its own wiring, under
 * a CLI comment that merely said such hosts "mirror this list" — a claim nothing
 * checked. An app that works under `objectstack serve` can therefore lose
 * capabilities once hosted, silently, with no error anywhere (cloud#925,
 * framework#3786). A second description nobody checks is how that happens; one
 * exported list is how it stops.
 *
 * On the shape of that divergence, since an earlier revision of this comment got
 * it wrong: cloud does not keep a rival slate ARRAY to diff against. Its hosted
 * set is assembled from the host's `defaultRequires` plus the capability
 * loader's dependency patches, so the comparison has to be against what actually
 * mounts, not against the nearest list-shaped thing. (The array this comment
 * once cited, `mountDefaultEnvironmentPlugins`' `ORDER`, has no production call
 * site — diffing it proved nothing.) Measured against the real wiring,
 * `analytics` IS force-mounted there and was never the gap; `messaging` loads
 * only when `audit` does; `sms` has no provider package in that image at all.
 *
 * This is the FLOOR, not the ceiling: a host may mount more (cloud adds
 * `observability`), and `objectstack serve --preset minimal` opts out entirely.
 */
export const PLATFORM_ALWAYS_ON_CAPABILITIES: readonly string[] = Object.freeze([
  // Order is a CONTRACT, not a count. `queue`/`job`/`cache`/`settings` are the
  // bind TARGETS — the services other entries bind into from their own
  // `kernel:ready` hook — so every entry that is not one of them is mounted
  // after all of them. A new entry joins the tail; a new BIND TARGET joins the
  // line below. Pinned as that rule (never as a prefix length) in
  // `platform-capabilities.test.ts`.
  'queue', 'job', 'cache', 'settings',
  // `email`, `storage` and `sms` each read a settings namespace from their own
  // `kernel:ready` hook, so each is mounted after `settings` and declares the
  // edge as well (ADR-0116; `serve-settings-ordering.pin.test.ts` in the CLI).
  'email', 'storage',
  'sms',
  'sharing',
  // `messaging` is foundational post-ADR-0030: notifications flow through a
  // single ingress (`NotificationService.emit`) — collaboration `@mention` /
  // assignment (plugin-audit) and the `notify` flow node both deliver through
  // the messaging pipeline, and the Console bell reads its materialization
  // (`sys_inbox_message`). Without it those notifications silently no-op.
  'messaging',
  // `analytics` is foundational post-ADR-0021: the AnalyticsService backs the
  // dataset/cube query endpoints (`/api/v1/analytics/*`). It must exist even
  // when an app declares no `analyticsCubes`, because a `dataset` can be
  // authored/previewed inline (Studio) and compiled on the fly. Without it the
  // dataset preview + dashboard/report analytics widgets silently no-op.
  'analytics',
]);

/**
 * Outcome of classifying one `requires` token against the installed providers:
 *   - `ok`          — provider resolvable (installed); nothing to do.
 *   - `installable` — absent, but an installable version exists in this edition
 *                     (`open`/`enterprise` package) → actionable `pnpm add` hint.
 *   - `unavailable` — absent AND no installable version in this edition
 *                     (`cloud`-only, or a tier with no package) → edition error.
 *   - `unknown`     — not a platform capability token at all (a typo).
 */
export type CapabilityProviderStatus = 'ok' | 'installable' | 'unavailable' | 'unknown';

/** Structured classification of a single `requires` token (framework#3366). */
export interface CapabilityClassification {
  readonly token: string;
  readonly status: CapabilityProviderStatus;
  /** Present for every known token (absent only when `status` is `unknown`). */
  readonly provider?: PlatformCapabilityProvider;
}

/**
 * Classify one `requires` capability token by whether its provider is installed
 * and, if not, whether it *could* be in the active (open) edition — the pure
 * derivation behind both the `os build` preflight and the `os serve` boot error
 * (framework#3366). Package resolution is injected via `isInstalled` so this
 * stays side-effect-free (spec holds no I/O): callers wire it to
 * `require.resolve`. Message rendering is the caller's job — this returns only
 * the status + provider facts, so every runtime can word it in its own voice.
 */
export function classifyRequiredCapability(
  token: string,
  isInstalled: (pkg: string) => boolean,
): CapabilityClassification {
  const provider = PLATFORM_CAPABILITY_PROVIDERS[token];
  if (!provider) {
    // The drift test keeps the registry complete, so a token with no provider
    // entry is outside the vocabulary — i.e. a typo. (The `isKnown` guard is
    // defensive: a known-but-unmapped token classifies as satisfied, never as a
    // false failure.)
    return { token, status: isKnownPlatformCapability(token) ? 'ok' : 'unknown' };
  }
  if (provider.package && isInstalled(provider.package)) {
    return { token, status: 'ok', provider };
  }
  // Absent. A `cloud`-only tier (or one with no installable package) has no
  // version to add in the open edition; `open`/`enterprise` do → actionable add.
  if (provider.edition === 'cloud' || provider.package === null) {
    return { token, status: 'unavailable', provider };
  }
  return { token, status: 'installable', provider };
}
