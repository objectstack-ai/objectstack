// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// Service method interfaces use z.function() instead of z.any() for type safety.
// Generic data fields use z.unknown() for type safety.
import { lazySchema } from '../shared/lazy-schema';
export const PluginContextSchema = lazySchema(() => z.object({
  ql: z.object({
    object: z.function().describe('Get object handle for method chaining'),
    query: z.function().describe('Execute a query'),
  }).passthrough().describe('ObjectQL Engine Interface'),

  os: z.object({
    getCurrentUser: z.function().describe('Get the current authenticated user'),
    getConfig: z.function().describe('Get platform configuration'),
  }).passthrough().describe('ObjectStack Kernel Interface'),

  logger: z.object({
    debug: z.function().describe('Log debug message'),
    info: z.function().describe('Log info message'),
    warn: z.function().describe('Log warning message'),
    error: z.function().describe('Log error message'),
  }).passthrough().describe('Logger Interface'),

  storage: z.object({
    get: z.function().describe('Get a value from storage'),
    set: z.function().describe('Set a value in storage'),
    delete: z.function().describe('Delete a value from storage'),
  }).passthrough().describe('Storage Interface'),

  i18n: z.object({
    t: z.function().describe('Translate a key'),
    getLocale: z.function().describe('Get current locale'),
  }).passthrough().describe('Internationalization Interface'),

  metadata: z.record(z.string(), z.unknown()),
  events: z.record(z.string(), z.unknown()),
  
  app: z.object({
    router: z.object({
      get: z.function().describe('Register GET route handler'),
      post: z.function().describe('Register POST route handler'),
      use: z.function().describe('Register middleware'),
    }).passthrough()
  }).passthrough().describe('App Framework Interface'),

  drivers: z.object({
    register: z.function().describe('Register a driver'),
  }).passthrough().describe('Driver Registry'),
}));

export type PluginContextData = z.input<typeof PluginContextSchema>;
export type PluginContext = PluginContextData;

// ---------------------------------------------------------------------------
// RETIRED — the `onInstall` / `onEnable` / `onDisable` / `onUninstall` /
// `onUpgrade` lifecycle family, and the `UpgradeContextSchema` that existed to
// serve `onUpgrade` (#4212, ADR-0049 enforce-or-remove).
//
// The kernel never called any of them. Its plugin contract is `init(ctx)` /
// `start(ctx)` / `destroy()` (`packages/core/src/types.ts`): `kernel.use()`
// validates and stores, `bootstrap()` runs `init` then `start`, shutdown runs
// `destroy` in reverse order. The five hooks were declared here with no
// invocation site anywhere in the runtime — their only importer repo-wide was
// this file's own test — so a plugin authoring them shipped code that never
// ran, and the docs that recommended them sent authors at a dead seam
// (the #4212 report: a plugin following the documented advice registered its
// custom metadata types into nothing, with no error saying so).
//
// What owns each concern instead:
//   - install-time work → the package-install subsystem
//     (`registry.installPackage`, `sys_packages`, the marketplace flow);
//   - boot-time code → `init`/`start`, or for authored app bundles the
//     `onEnable` STACK runtime member `AppPlugin` invokes off the bundle
//     (`STACK_RUNTIME_MEMBERS` — same name, different and real contract);
//   - teardown → `destroy()`.
//
// Plain deletion, not `retiredKey()` tombstones: nothing parses plugin
// objects through these schemas (`stack.zod` carries plugins as
// `z.array(z.unknown())`), so a tombstone prescription could never be
// received — the `plugin-runtime.zod.ts` precedent.
// ---------------------------------------------------------------------------

/**
 * Shared Plugin Types
 * These are the specialized plugin types common between Manifest (Package) and Plugin (Runtime).
 */
export const CORE_PLUGIN_TYPES = [
  'ui',         // Frontend: Serves static assets/SPA (e.g. Console, Studio)
  'driver',     // Connectivity: Database or Storage adapters (e.g. SQL, S3)
  'server',     // Protocol: HTTP/RPC Servers (e.g. Hono, GraphQL)
  'app',        // Business: Vertical Solution Bundle (Metadata + Logic)
  'theme',      // Appearance: UI Overrides & CSS Variables
  'agent',      // AI: Autonomous Agent & Tool Definitions
  'objectql'    // Core: ObjectQL Engine Data Provider
] as const;

/**
 * Consumer-installable package types — ADR-0019 (App as the consumer unit).
 *
 * The package `type` enum is unchanged; this adds a *semantic* split over it:
 * which types are the one user-visible noun a tenant browses, installs, opens,
 * and uninstalls. Today that is only `app`. Every other type
 * (`plugin`/`driver`/`server`/`ui`/`theme`/`agent`/`module`/…) is an internal
 * contribution — it ships *inside* an App or is operator-provisioned — and is
 * never independently listed or installed by a consumer.
 */
export const CONSUMER_INSTALLABLE_TYPES = ['app'] as const;

/**
 * Returns true when a package `type` is a consumer-facing installable unit
 * (ADR-0019). Use this to filter the consumer Marketplace to `type: app`.
 */
export function isConsumerInstallable(type: string | undefined): boolean {
  return type != null && (CONSUMER_INSTALLABLE_TYPES as readonly string[]).includes(type);
}

/**
 * The stable code a `PluginSchema` refusal carries when a `type: 'ui'` plugin
 * omits a key the `ui` type requires (#16334).
 *
 * `staticPath` and `slug` are described below as `(Required for type="ui")`
 * and were declared `.optional()` with nothing behind the prose. Once
 * `kernel.use()` ran the schema on the boot path (#16049) that prose became a
 * promise the runtime visibly did not keep. The `superRefine` on
 * `PluginSchema` makes it true: a `type: 'ui'` plugin missing either key is
 * refused with one issue per missing key, `path` naming the key.
 *
 * Where the code is readable — MEASURED on this tree, not assumed:
 *
 *  - At the HEAD of the issue's `message`. The one runtime caller of
 *    `PluginSchema` is `PluginLoader.validatePluginContract`
 *    (`packages/core/src/plugin-loader.ts`, #16049), which surfaces the first
 *    issue's `path` and `message` and reads nothing else, and
 *    `ObjectKernel.use()` re-wraps that into a fresh `Error` carrying only the
 *    message. So the code reaches the boot log verbatim today, with no loader
 *    change:
 *
 *      PLUGIN_CONTRACT_VIOLATION: plugin '@acme/console' is refused by the
 *      declared plugin contract at 'staticPath': PLUGIN_UI_REQUIRED_KEY_MISSING: …
 *
 *  - On the issue's `params.code` (zod's slot for custom-issue metadata), with
 *    `params.key` naming the missing key — for a reader that wants the code as
 *    a field rather than a message prefix. No reader does today; whether the
 *    loader should stamp it onto `err.code` is the boot path's seam (#16049),
 *    not this one.
 *
 * Spelled the ADR-0112 way and registered in `ERROR_CODE_LEDGER` under
 * `@objectstack/spec` (#16449, under the #16404 ruling: a code that ships in
 * `dist` is the published face, door or no door). Not wire vocabulary in the
 * door sense: it is raised at authoring / `kernel.use()`, before any HTTP
 * boundary exists, and rides `PLUGIN_CONTRACT_VIOLATION`'s envelope — the
 * ledger row records that reading.
 */
export const PLUGIN_UI_REQUIRED_KEY_MISSING = 'PLUGIN_UI_REQUIRED_KEY_MISSING';

/**
 * The keys `type: 'ui'` requires — exactly the two whose `.describe()` says
 * `(Required for type="ui")`. Module-private on purpose: the published symbol
 * is the refusal code above; the key set itself is pinned by
 * `plugin-ui-required-keys.test.ts`, one case per key.
 */
const PLUGIN_UI_REQUIRED_KEYS = ['staticPath', 'slug'] as const;

export const PluginSchema = lazySchema(() => z.object({
  id: z.string().min(1).optional().describe('Unique Plugin ID (e.g. com.example.crm)'),
  type: z.enum([
    'standard',   // Default: General purpose backend logic (Service, Hook, etc.)
    ...CORE_PLUGIN_TYPES
  ]).default('standard').optional().describe('Plugin Type categorization for runtime behavior'),
  
  staticPath: z.string().optional().describe('Absolute path to static assets (Required for type="ui")'),
  slug: z.string().regex(/^[a-z0-9-_]+$/).optional().describe('URL path segment (Required for type="ui")'),
  default: z.boolean().optional().describe('Serve at root path (Only one "ui" plugin can be default)'),
  
  // #16365 — the grammar SemVer 2.0.0 actually defines, prerelease and build
  // metadata included, which is what `describe('Semantic Version')` has said
  // without qualification all along. The regex it replaces, `/^\d+\.\d+\.\d+$/`,
  // refused `1.0.0-alpha.1` and `1.0.0+20230101` — a declaration refusing part
  // of what it declared.
  //
  // ⭐ This is `PluginLoader.isSemverShapedVersion`'s spelling character for
  // character (`packages/core/src/plugin-loader.ts`), deliberately, and not a
  // third grammar invented here. That check is the one the boot path has always
  // run, so adopting it makes the two declarations converge EXACTLY — which is
  // what let `assertPluginContract` drop the `version` exclusion it carried as a
  // stopgap, and is why nothing that loads today is refused now.
  //
  // ⚠️ MEASURED, not assumed, in both directions. It is a strict SUPERSET of the
  // regex it replaces (same three-segment core, two OPTIONAL suffix groups), so
  // the accept set only grows. It is ALSO wider than SemVer 2.0.0 itself, in a
  // fringe this change neither introduces nor widens: leading zeroes in the
  // numeric core (`01.1.1`) were accepted by BOTH spellings before this change
  // and are accepted by both after it, and the loader additionally accepts the
  // degenerate identifier forms SemVer forbids (`1.0.0-alpha..1`, `1.0.0-0123`,
  // `1.0.0+.`). Tightening to the official SemVer 2.0.0 regex would therefore
  // have NARROWED this key — refusing `01.1.1`, which it accepts today — which
  // is the one thing the #16365 ruling forbids.
  //
  // #17070 — so the DESCRIPTION moved instead, and the regex did not. With the
  // accept set frozen by #16365's ruling, the only side of the declared/enforced
  // pair still free to move is the claim, and `'Semantic Version'` — bare, with
  // no qualifier — was the false half: it named a standard this key does not
  // implement. The describe() below states the grammar actually enforced, in the
  // shape `ManifestSchema.version` already uses (`kernel/manifest.zod.ts`, whose
  // TSDoc spells `(major.minor.patch)` rather than leaning on the word SemVer),
  // so an author reading it can predict the verdict on their own string. The
  // eight forbidden forms are pinned as ACCEPTED in `plugin.test.ts` — stated
  // and enforced, not narrated — and `PluginLoader`'s predicate was renamed
  // `isSemverShapedVersion` in the same change, for the same reason.
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/).optional().describe('Version: major.minor.patch, with an optional -prerelease and an optional +build suffix. Looser than SemVer 2.0.0 — leading zeroes (01.1.1) and empty identifiers (1.0.0-alpha..1) are accepted.'),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().url().optional(),
}).superRefine((plugin, ctx) => {
  // #16334 — the `(Required for type="ui")` prose on `staticPath` / `slug`,
  // enforced. Scoped to `type === 'ui'` exactly: every other type, and a
  // plugin declaring no `type` (`.default('standard')`), owes neither key.
  // Absence only — a PRESENT value is judged by its own declaration above
  // (`slug` keeps its regex, `staticPath` stays any string), never re-judged.
  if (plugin.type !== 'ui') return;
  for (const key of PLUGIN_UI_REQUIRED_KEYS) {
    if (plugin[key] !== undefined) continue;
    ctx.addIssue({
      code: 'custom',
      path: [key],
      message:
        `${PLUGIN_UI_REQUIRED_KEY_MISSING}: a \`type: 'ui'\` plugin must declare \`${key}\` — `
        + (key === 'staticPath'
          ? 'the absolute path of the static assets it serves.'
          : 'the URL path segment it is mounted under.')
        + " Declare it, or drop `type: 'ui'` if this plugin serves no assets.",
      params: { code: PLUGIN_UI_REQUIRED_KEY_MISSING, key },
    });
  }
}));

export type PluginDefinition = z.input<typeof PluginSchema>;
