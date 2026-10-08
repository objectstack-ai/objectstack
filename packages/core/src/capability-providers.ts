// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `requires` token → built-in provider plugin table, and the ONE rule that
 * decides whether a boot already holds a capability's provider.
 *
 * ## Why this lives in `@objectstack/core` and not in `serve`
 *
 * Two boots resolve an app's `requires` and they sit in packages that cannot
 * import each other: `os serve` (`@objectstack/cli`) and the in-process
 * verification handle (`@objectstack/verify`'s `bootStack`).
 * `@objectstack/cli` depends on `@objectstack/verify`, so the handle could
 * never read a table kept on the `Serve` command — and an app's tests booted a
 * stack that ignored the providers its `requires` names, which `serve` mounts.
 * `@objectstack/core` is already a dependency of both, so hosting the table
 * here adds NO package edge to the graph (the reason `artifact-packages.ts`
 * gives for its own home). `Serve.CAPABILITY_PROVIDERS` and
 * `Serve.providesCapability` stay as handles over THESE declarations — one
 * declaration, several readers, ⛔ never a second copy.
 *
 * What is shared is the LOOKUP: the token table and the exact identity match.
 * How each boot constructs a provider stays with that boot — `serve` reads mail,
 * SMS and storage configuration from the app and the environment; the handle
 * constructs each provider with its own defaults; the schema-migration boot
 * takes a declared posture per token.
 *
 * Pure data and one pure function: importing this module loads nothing — a
 * reader imports a provider package itself, from its own dependencies.
 */

/**
 * The IDENTITIES a capability provider registers under: full `plugin.name` ids
 * (`com.objectstack.mcp`) and/or exported class names (`MCPServerPlugin`).
 *
 * Compared EXACTLY by {@link providesCapability} — never as substrings.
 * These used to be free-form *fragments* tested with `String.includes()`; see
 * that function for the whole class of bug that spelling caused (#7652).
 */
export type CapabilityIdentities = string[];

/** One provider row of {@link CAPABILITY_PROVIDERS}. */
export type CapabilitySpec = {
  pkg: string;
  export: string;                    // named export to import
  identities: CapabilityIdentities;  // exact provider identities — see the type
  configKey?: string;                // optional config field passed as constructor arg
  extras?: Array<{ pkg: string; export: string; identities: CapabilityIdentities }>;
};

/**
 * Registry of `requires` token → built-in service-plugin provider. Keys are
 * canonical kebab-case platform capability tokens — a drift test asserts every
 * key is in the spec-owned PLATFORM_CAPABILITY_TOKENS vocabulary
 * (framework#3265). Adding a built-in capability = one entry here + its token
 * in the spec vocabulary + the provider package declared by every boot that
 * reads this table (`@objectstack/cli`, `@objectstack/verify` — each pins it).
 *
 * `identities` are matched EXACTLY (see {@link providesCapability}), so each
 * entry names the provider's real registered `plugin.name` — NOT a shortened
 * fragment of it. Before #7652 most of these name fragments were in fact dead
 * (`service-cache` never matched `com.objectstack.service.cache`: dash vs dot),
 * and the entries were carried entirely by their class name.
 */
export const CAPABILITY_PROVIDERS: Readonly<Record<string, CapabilitySpec>> = {
  automation: {
    // Self-contained: AutomationServicePlugin seeds all built-in node
    // executors itself (ADR-0018), so flows have executors with no
    // companion node-pack plugins.
    pkg: '@objectstack/service-automation',
    export: 'AutomationServicePlugin',
    identities: ['com.objectstack.service-automation', 'AutomationServicePlugin'],
  },
  analytics: {
    pkg: '@objectstack/service-analytics',
    export: 'AnalyticsServicePlugin',
    identities: ['com.objectstack.service-analytics', 'AnalyticsServicePlugin'],
    configKey: 'analyticsCubes',
  },
  audit: {
    pkg: '@objectstack/plugin-audit',
    export: 'AuditPlugin',
    identities: ['com.objectstack.audit', 'AuditPlugin'],
  },
  cache: {
    pkg: '@objectstack/service-cache',
    export: 'CacheServicePlugin',
    identities: ['com.objectstack.service.cache', 'CacheServicePlugin'],
  },
  storage: {
    pkg: '@objectstack/service-storage',
    export: 'StorageServicePlugin',
    identities: ['com.objectstack.service.storage', 'StorageServicePlugin'],
  },
  queue: {
    pkg: '@objectstack/service-queue',
    export: 'QueueServicePlugin',
    identities: ['com.objectstack.service.queue', 'QueueServicePlugin'],
  },
  job: {
    pkg: '@objectstack/service-job',
    export: 'JobServicePlugin',
    identities: ['com.objectstack.service.job', 'JobServicePlugin'],
  },
  messaging: {
    // Backs the `notify` flow node (ADR-0012): delivers to a user's
    // channels (inbox by default → `sys_inbox_message` rows). Without
    // this the notify node degrades to a logged no-op.
    pkg: '@objectstack/service-messaging',
    export: 'MessagingServicePlugin',
    identities: ['com.objectstack.service.messaging', 'MessagingServicePlugin'],
  },
  triggers: {
    // Makes autolaunched flows actually fire. The automation engine ships
    // the `FlowTrigger` wiring; these plugins are the concrete triggers:
    // record-change (ObjectQL lifecycle hooks) + schedule (cron/interval
    // via the job service — so pair `triggers` with `job`).
    pkg: '@objectstack/trigger-record-change',
    export: 'RecordChangeTriggerPlugin',
    identities: ['com.objectstack.trigger.record-change', 'RecordChangeTriggerPlugin'],
    extras: [
      {
        pkg: '@objectstack/trigger-schedule',
        export: 'ScheduleTriggerPlugin',
        identities: ['com.objectstack.trigger.schedule', 'ScheduleTriggerPlugin'],
      },
      {
        // Declarative time-relative sweep (#1874) — arms flows whose start
        // node declares `config.timeRelative` (fire daily for records whose
        // date field is within N days / at T-minus offsets). Ships in
        // @objectstack/trigger-schedule; needs the job service + ObjectQL.
        pkg: '@objectstack/trigger-schedule',
        export: 'TimeRelativeTriggerPlugin',
        identities: ['com.objectstack.trigger.time-relative', 'TimeRelativeTriggerPlugin'],
      },
      {
        // Inbound webhook/HTTP trigger (ADR-0041 Tier 1) — arms
        // `type: 'api'` flows with HMAC-verified, queue-backed hooks.
        pkg: '@objectstack/trigger-api',
        export: 'ApiTriggerPlugin',
        identities: ['com.objectstack.trigger.api', 'ApiTriggerPlugin'],
      },
    ],
  },
  realtime: {
    pkg: '@objectstack/service-realtime',
    export: 'RealtimeServicePlugin',
    identities: ['com.objectstack.service.realtime', 'RealtimeServicePlugin'],
  },
  // `feed` removed (ADR-0052 §5): `sys_comment`/`sys_activity` (durable,
  // default-loaded, UI-wired) is the canonical record collaboration +
  // timeline backend. `@objectstack/service-feed` was an in-memory,
  // non-durable, UI-unconsumed parallel implementation — retired to end
  // the split-brain. The unified typed timeline lives on `sys_activity`.
  mcp: {
    pkg: '@objectstack/mcp',
    export: 'MCPServerPlugin',
    identities: ['com.objectstack.mcp', 'MCPServerPlugin'],
  },
  marketplace: {
    pkg: '@objectstack/service-package',
    export: 'PackageServicePlugin',
    identities: ['package-service', 'PackageServicePlugin'],
  },
  // The always-on persistence half of the `marketplace` / `package-registry`
  // split (#17676 ruling A' items 1-2): `sys_packages` and its boot
  // hydration, so `protocol.installPackage` / `updatePackage` find the
  // `package` service on a stock boot. Keyed at the provider the spec's
  // PLATFORM_CAPABILITY_PROVIDERS row declares for this token — the SAME
  // package and plugin as `marketplace` above, because that is what the spec
  // map says today. Repointing `marketplace` at the browse surface starts at
  // that spec row, and this table follows it; until then an app declaring
  // `marketplace` gets ONE PackageServicePlugin, not two — see
  // `resolverMounted` in the capability resolver.
  'package-registry': {
    pkg: '@objectstack/service-package',
    export: 'PackageServicePlugin',
    identities: ['package-service', 'PackageServicePlugin'],
  },
  email: {
    pkg: '@objectstack/plugin-email',
    export: 'EmailServicePlugin',
    identities: ['com.objectstack.service.email', 'EmailServicePlugin'],
  },
  sms: {
    // #2780 — backs phone-number OTP sign-in/reset (plugin-auth) and
    // the messaging `sms` channel. Provider config lives in the `sms`
    // settings namespace (OS_SMS_* env keys win at the resolver);
    // unconfigured ⇒ dev LogSmsTransport (no real send).
    pkg: '@objectstack/service-sms',
    export: 'SmsServicePlugin',
    identities: ['com.objectstack.service.sms', 'SmsServicePlugin'],
  },
  sharing: {
    pkg: '@objectstack/plugin-sharing',
    export: 'SharingServicePlugin',
    identities: ['com.objectstack.service.sharing', 'SharingServicePlugin'],
  },
  // #2486 — auto-required above when resolveSearchPinyinEnabled()
  // (explicit env, else any configured zh-* locale) says on.
  'pinyin-search': {
    pkg: '@objectstack/plugin-pinyin-search',
    export: 'PinyinSearchPlugin',
    identities: ['com.objectstack.plugin.pinyin-search', 'PinyinSearchPlugin'],
  },
  approvals: {
    pkg: '@objectstack/plugin-approvals',
    export: 'ApprovalsServicePlugin',
    identities: ['com.objectstack.service.approvals', 'ApprovalsServicePlugin'],
  },
  settings: {
    pkg: '@objectstack/service-settings',
    export: 'SettingsServicePlugin',
    identities: ['com.objectstack.service.settings', 'SettingsServicePlugin'],
  },
  webhooks: {
    pkg: '@objectstack/plugin-webhooks',
    export: 'WebhookOutboxPlugin',
    identities: ['com.objectstack.plugin-webhook-outbox', 'WebhookOutboxPlugin'],
  },
};

/**
 * Is one of `identities` ALREADY loaded — i.e. did the app (or the boot) supply
 * this capability's provider itself, so the resolver must not load a second one?
 *
 * Compares a plugin's `name` and its constructor name against the declared
 * identities by EQUALITY. That exactness is the fix for #7652, not a detail:
 *
 * This check used to treat `identities` as free-form fragments and test them
 * with `String.includes()`. Substring matching cannot tell a capability's
 * PROVIDER from one of its CONSUMERS, because a consumer is conventionally
 * named after the thing it consumes — so any plugin whose name merely
 * CONTAINED a fragment satisfied the capability and SUPPRESSED the real
 * provider. The stock showcase hit exactly that: it loads
 * `com.objectstack.connector.mcp` (the outbound MCP *client* connector),
 * whose name contains the `mcp` fragment, so `MCPServerPlugin` never loaded
 * and the MCP endpoint the boot banner advertises answered 501.
 *
 * `mcp` was not the only fragment short enough to collide (`audit` was one
 * consumer away from the same fate, and every class-name fragment was
 * satisfied by any class merely ENDING in it, e.g. `MyAuditPlugin` for
 * `AuditPlugin`). Equality closes the class: a plugin either IS the provider
 * or it is not, and no naming convention can blur that.
 *
 * Both directions matter. Tightening the comparison must not stop a genuine
 * provider being recognised, so the registry above declares each provider's
 * REAL registered `name` (measured from its package, and pinned by the CLI's
 * `serve-capability-identity.test.ts` so a rename can't silently reintroduce
 * double-loading) alongside its exported class name.
 */
export function providesCapability(plugins: readonly unknown[], identities: readonly string[]): boolean {
  const wanted = new Set(identities.filter((id) => id !== ''));
  if (wanted.size === 0) return false;
  return plugins.some((p) => {
    const name = (p as { name?: unknown } | null | undefined)?.name;
    const ctor = (p as { constructor?: { name?: unknown } } | null | undefined)?.constructor?.name;
    return (
      (typeof name === 'string' && wanted.has(name)) ||
      (typeof ctor === 'string' && wanted.has(ctor))
    );
  });
}
