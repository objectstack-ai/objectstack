# @objectstack/service-i18n

## 17.1.0

### Patch Changes

- 0425db9: Published READMEs link to the docs site in the one form that works on npm, on GitHub and on the docs site (#9632)
  
  **Seven docs links in these READMEs pointed nowhere.** They were spelled as a repo
  path rooted at `/` — `[Flows](/content/docs/automation/flows.mdx)` — and a README in a
  package's `files` array with `private` unset is rendered on the **npm package page** and
  on **GitHub**, not only in this repository. There a root-relative href resolves against
  `npmjs.com` and `github.com` respectively. It was not a docs-site route either:
  `apps/docs/lib/source.ts` mounts `loader({ baseUrl: '/docs' })` over `content/docs`, so
  the route for that first link is `/docs/automation/flows`, and `apps/docs/redirects.mjs`
  carries no `/content` source that would rescue the written form. Every target page
  existed and every one of them was reachable — only the links were not.
  
  All seven now use the absolute form the repo had already established in
  `create-objectstack`'s published READMEs: `https://docs.objectstack.ai/docs/...`, with
  the path taken under `content/docs` and the page extension dropped, because the route
  carries none. Each target was re-verified at the route level rather than as a file — the
  two that named a **directory** (`/content/docs/automation/`,
  `/content/docs/references/automation/`) resolve only because those directories carry an
  `index.mdx`; a directory without one is a 404, not a section.
  
  **Two more links in the same class were converted in the same pass.**
  `service-knowledge` and `knowledge-ragflow` pointed at
  `../../../content/docs/protocol/knowledge.mdx`. Those relative paths do resolve on both
  GitHub and npm, so they are a milder defect than the seven — but they land the reader on
  **raw MDX source** instead of the rendered page. They now point at the rendered page as
  well. `service-knowledge`'s link text changed with it: it was the source filename in a
  code span, which stops being an honest label once the destination is the page.
  
  No API, behaviour or type surface changes — this is the published documentation these
  packages ship.
- f01c0ee: docs: five published service READMEs stop documenting an API that does not exist (#9532)
  
  A version bump is the point, not a side effect: these five READMEs are in their
  packages' `files` arrays with `private` unset, so they are the pages npm renders —
  and a docs-only fix with no bump never reaches npm at all.
  
  Each of the five told a reader to an import of a `Service…` class from its own package
  and call a static `.configure({...})` on it. Neither has ever existed: no class in
  this repo exposes a static `configure`, and none of `ServiceAnalytics`,
  `ServiceAutomation`, `ServiceCache`, `ServiceI18n` or `ServiceJob` is exported by
  anything. A reader following any of them wrote code that could not compile. The real
  entry point in every case is a kernel plugin constructed with `new`:
  `AnalyticsServicePlugin`, `AutomationServicePlugin`, `CacheServicePlugin`,
  `I18nServicePlugin`, `JobServicePlugin`.
  
  ⛔ A name swap alone would not have been enough, and the gate landed in #9546 is what
  proves it: substituting the genuine class while keeping `.configure(...)` turns the
  import finding into a call-site finding rather than into silence. Each README is
  rewritten against the package's built type surface, and each package's entry is
  deleted from `scripts/published-readme-exports.baseline.json` in the same change
  (the baseline is reconciled in both directions, so a stale entry fails too).
  
  What was removed as fabricated, beyond the entry point:
  
  - **service-analytics** — a nine-endpoint REST surface (`/analytics/count`, `/sum`,
    `/avg`, `/min`, `/max`, `/group-by`, `/time-series`, `/metrics`, `/metrics/:name`)
    of which none exists; the real surface is `POST /analytics/query`,
    `GET /analytics/meta`, `POST /analytics/sql` and `POST /analytics/dataset/query`.
    Also removed: `defineMetric`, `getMetric`, `compare`, `funnel`,
    `executeDashboard`, `invalidateCache`, and an `AnalyticsServiceConfig` block whose
    four keys (`defaultDriver`, `enableCaching`, `cacheTTL`, `maxMemoryResults`) are
    none of the real ones.
  - **service-automation** — `executeFlow`/`getFlow`/`listFlows`/`getFlowHistory`/
    `registerTrigger` as the contract (the real contract is `execute(flowName, context?)`
    plus `listFlows()` and a set of optional members), and a five-endpoint REST list that
    matches no mounted route. The flow-authoring half of that README was already accurate
    and is kept.
  - **service-cache** — `mget`/`mset`/`del`/`delPattern`/`namespace`/`ttl`/`expire`/
    `persist`/`incr`/`incrby`/`decr`/`getOrSet`/`invalidateTag`/`resetStats`, none of
    which exist; `ICacheService` has six members. `CacheStats.keys`/`hitRate` corrected to
    `keyCount` (there is no `hitRate`), and `set(key, value, { ttl })` corrected to the
    real positional `set(key, value, ttl?)` in seconds.
  - **service-i18n** — an `await i18n.t('ns:key')` dialect with namespaces, plural
    suffixes, `context`, `returnObjects`, `setLocale`/`getLocale`, `formatDate`/
    `formatNumber`/`formatRelative`, `addLocale`/`removeLocale`/`reload`, `getCoverage`/
    `getMissingKeys`, and a `{{lng}}/{{ns}}` file layout. The real `t()` is synchronous
    and takes the locale positionally — `t(key, locale, params?)` — over one
    `{locale}.json` file per locale. The `POST /i18n/translate` endpoint does not exist.
  - **service-job** — `scheduleInterval`/`scheduleOnce`/`getJob`/`stopJob`/`resumeJob`/
    `deleteJob`/`runNow`/`getJobHistory`/`clearHistory`/`getLastExecution`, and a
    `schedule({ name, schedule, handler })` options-object call. The real `schedule` is
    positional — `schedule(name, schedule, handler, options?)` — and returns `void`.
    Retry defaults corrected to the enforced ones (`maxRetries: 0`,
    `backoffMultiplier: 1`).
  
  Two capability claims are corrected rather than deleted, because the source is what
  decides:
  
  - **service-cache** advertised Redis as production support. `RedisCacheAdapter` throws
    `RedisCacheAdapter not yet implemented` from every method, and
    `new CacheServicePlugin({ adapter: 'redis' })` throws during `init` rather than
    falling back to memory. The README now says so at the top and points at registering
    a custom `ICacheService` under the slot instead.
  - **service-job**'s `adapter: 'interval'` stores cron registrations that never fire.
    That is now stated in the adapter table rather than left for a reader to discover.
  
  No compliance claim (SOC 2 / HIPAA / GDPR or similar) was found in any of the five —
  the shape that raised `plugin-audit`'s severity in #9517 is absent here.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2d0af57]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0

## 17.0.0

### Minor Changes

- 518ca7a: fix(i18n): `GET /i18n/locales` reports the locales the app declared, not every locale a plugin happened to load (#7679)

  `GET /api/v1/i18n/locales` answered with four locale descriptors — `en`,
  `zh-CN`, `ja-JP`, `es-ES` — on the showcase app, whose artifact declares
  `i18n.supportedLocales: ['en', 'zh-CN']`. The envelope was correct (#3636); the
  **set** was a superset.

  Nothing was wrong with what had been _loaded_. Every platform plugin
  (`platform-objects`, `service-settings`, `service-storage`, `service-messaging`,
  `service-realtime`, `plugin-security`, `plugin-sharing`, `plugin-webhooks`)
  ships an `en/zh-CN/ja-JP/es-ES` bundle and pushes it at `kernel:ready`, which is
  what a platform should do. What was wrong is that the **loaded** set was
  reported as the **offered** set — two different facts owned by two different
  parties. So a locale picker built from this route, including the platform's own
  Settings > Localization select, offered `ja-JP` and `es-ES`: locales in which
  only `sys_*` objects are translated, guaranteeing a mixed-language session for
  everything the app itself owns.

  **What changed.** `II18nService` gains an optional
  `setSupportedLocales(locales)`. `AppPlugin.loadTranslations` threads the
  artifact's `i18n.supportedLocales` into it exactly the way it already threads
  `defaultLocale`, and both providers of the `i18n` slot — `createMemoryI18n` in
  `@objectstack/core` and `FileI18nAdapter` in `@objectstack/service-i18n` —
  narrow what `getLocales()` reports to that declaration. The runtime app-plugin
  layer is the only place this can originate: `getLocales()` sees what is loaded,
  and the app's declaration is not visible below it.

  The narrowing is applied as a filter at **read** time, never as a prune of what
  is stored, because the platform bundles arrive _after_ the app plugin has run.

  **Only the reported set narrows.** Bundles stay loaded and stay servable:
  `GET /i18n/translations/ja-JP` still answers on a stack that no longer
  advertises `ja-JP`, and `t()` still resolves it. Unloading those bundles buys
  nothing — `sys_*` translations for an unadvertised locale cost nothing sitting
  in the map.

  Two questions the fix had to settle, both behaviour in their own right:

  - **An app that declares no `supportedLocales` is not narrowed.** Absent means
    "no narrowing", and it keeps reporting every loaded locale — the behaviour it
    has today. Every app written before this change declared nothing, so
    narrowing an undeclared app to zero (or to its default alone) would have
    emptied the picker on every stack whose author never opted in. An
    `i18n` block carrying only a `defaultLocale`, and a `supportedLocales: []`
    that declares no usable code, are both read the same way.
  - **A declared locale with no bundle behind it is reported, not dropped.** If an
    app declares a locale the platform plugins never shipped, it appears in the
    response as declared-but-unserved rather than being silently intersected away.
    The declaration is the app's statement of intent and the client is entitled to
    see it; a quietly shortened list hides the authoring gap from both ends.
    Reporting the declaration is also the only answer that does not depend on how
    many bundles had loaded by the time the route was called. Reads for such a
    locale degrade to the default/fallback exactly as a half-translated bundle's
    missing keys already do.

  Reported locales now follow the **declared order** rather than the insertion
  order of whichever plugin loaded first, so a picker renders the ordering the app
  author wrote.

  `setSupportedLocales` is optional on the contract, like `setDefaultLocale`: a
  third-party `II18nService` that does not implement it keeps its current
  behaviour instead of failing to boot.

- 4cca74c: fix(i18n)!: the `translation` metadata type speaks the same `objects.` shape everything else does (#3778)

  A translation authored in the product saved successfully and then rendered
  nothing. Not a resolver gap — a contract split. The `translation` metadata type
  (`allowRuntimeCreate: true`, so Studio/the metadata API/an agent can author it)
  was registered against `AppTranslationBundleSchema`, an object-first shape keyed
  on `o.<object>`. Every resolver, `os i18n extract`, `os i18n check`, the objectui
  hooks, and all nine shipped bundles read `objects.<object>`. Nothing bridged the
  two, so the save path and the read path never met.

  **Why converge instead of bridge.** A converter was the obvious fix and the
  wrong one: it would be throwaway code, and it would start producing _working_
  `o.`-shaped rows — closing the migration-free window that exists precisely
  because the feature never functioned. The retired shape's real-world footprint
  was zero: all three `*.translation.ts` files in the tree (platform-objects,
  CRM and todo examples) were already `objects.`-shaped, contradicting the type's
  own registered schema. Converging is a registration fix, not a migration.

  **Breaking.** `AppTranslationBundleSchema`, `ObjectTranslationNodeSchema`, and
  their types are **deleted** — no deprecation cycle. Nothing worked end-to-end
  through them, so there is no functioning consumer to protect, and a
  deprecated-but-present schema is exactly the exemplar an AI agent copies into
  new code. The optional `II18nService.getAppBundle` / `loadAppBundle` methods go
  with them: zero implementers, so they advertised a capability the runtime never
  delivered.

  **The replacement.** `TranslationItemSchema` — one locale of the same
  `TranslationData` groups a file bundle uses, plus the `locale` it translates,
  with a `defineTranslation()` factory. An item is one entry of a
  `TranslationBundle`; that is the whole type.

  Three details are deliberate, all aimed at the failure being silent rather than
  loud:

  - **`locale` is required**, not inferred from the item name. The sync skips an
    item whose locale it cannot resolve, and a skip is invisible to whoever — or
    whatever — authored it. (The name fallback still covers rows written before
    this.)
  - **Retired keys are rejected, not stripped.** Zod drops undeclared keys
    silently, which would reproduce this bug exactly: save succeeds, nothing
    renders. A pre-parse guard turns that silence into a 422 naming the group to
    use (`'o' … — use 'objects.<object_name>'`). It runs ahead of the parse so the
    retired keys stay out of the schema itself — the generated JSON Schema and the
    Studio editor never advertise a shape that cannot work.
  - **`ObjectTranslationData.label` is now optional.** Partial translation is the
    normal state and every resolver already treats each key as independent.
    Requiring it forced authors to restate the source label just to validate,
    filling bundles with fake translations that mask real coverage gaps.

  Also in this change: the authored-translation sync warns (naming the row and the
  fix) when it meets a row still in the retired shape instead of loading it into
  nowhere, and no longer merges publish bookkeeping (`_lockReason`,
  `_packageVersion`, …) into the translation layer. `GET
/i18n/labels/:object/:locale`'s fallback now reads the nested
  `objects.<obj>.fields.<field>.label` data it is actually given — it scanned for
  flat dotted `o.<obj>.fields.<field>` keys, a third dialect no producer ever
  wrote, so it always returned `{}`.

  Migration: author every translation — file or runtime item — under `objects.`.
  `o` → `objects`, `app` → `apps`, `nav` → `apps.<app>.navigation.<id>.label`,
  `dashboard` → `dashboards`, `_globalOptions` →
  `objects.<obj>.fields.<field>.options`, `_meta.locale` → top-level `locale`,
  `_actions.confirmMessage` → `_actions.confirmText`. `reports`, `notifications`,
  `errors`, and `namespace` had no runtime consumer and have no replacement.

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- d5c75e2: fix(spec,runtime,service-i18n): the dispatcher domains and their service contracts describe the same surface (#4127)

  #4087 retired a `/storage` bridge that called `upload(key, data, options?)` as
  `upload(file, { request })` — a shape no implementation has. Sweeping the other
  dispatcher domains against `packages/spec/src/contracts/*` found the mirror-image
  gap in three places: the call site and the implementation agreed, and the
  **contract** was the thing that had never been written down. Each one was worked
  around at the call site with `typeof x.foo === 'function'` — a duck-type is what
  "the contract does not cover this" looks like when nobody fixes the contract.

  Fixed at the contract, per Prime Directive #12.

  **`INotificationService` — the inbox half.** `listInbox` / `markRead` /
  `markAllRead` now exist, with `InboxQuery` / `InboxNotification` /
  `InboxListResult` / `MarkReadResult`. Three SDK-expressed routes
  (`notifications.list` / `.markRead` / `.markAllRead`) have rested on them all
  along, implemented by `service-messaging`, while this contract described only
  `send`. The cost was not theoretical: the dev notification stub implements
  exactly `send` and `sendBatch` **because it followed the contract**, so the one
  implementation written to spec was the one the dispatcher had to duck-type past.

  They are optional, and the probe stays: an inbox needs a durable store, and a
  send-only provider (SMTP, Twilio, a Slack webhook) fills the slot legitimately
  without one. `handlerReady` cannot express that — the slot is serveable, one
  capability of it is absent. The `/notifications` domain now takes
  `INotificationService` instead of `as any`, and each write route probes its own
  method rather than riding the entry `listInbox` check (they are separately
  optional, so "has an inbox to read" never implied "has read-state to write").

  **`II18nService.getFieldLabels`.** Both serving surfaces — the dispatcher's
  `/i18n/labels/:object/:locale` and service-i18n's own mount — probed for it and
  both documented it as "optional on `II18nService`", which was not true. It is
  now. service-i18n's probe loses two casts with it (one through
  `Record<string, unknown>`, one re-declaring the signature inline).

  **`IAutomationService.getFlowRuntimeStates`** + the `FlowRuntimeState` type.
  `GET /automation/_status` (and the CLI boot summary, and the
  `kernel:bootstrapped` audit) already called it while the contract stopped at
  `listFlows(): string[]`. The dispatcher's inline cast declared it as
  `{ name, enabled, bound }` — a third copy of the shape and a narrower one than
  the engine returns, dropping the `status` / `triggerType` / `object` fields that
  say WHY a flow is unbound.

  Two runtime fixes fell out of the same sweep:

  - **`POST /automation/trigger/:name` now builds a real `AutomationContext`.**
    It passed the raw HTTP body to `execute(name, body)`, so the
    `{ recordId, objectName, params }` translation never ran and — the sharper
    half — no caller identity was forwarded. A flow's default `runAs` is `'user'`,
    and a `runAs:'user'` run whose trigger resolved no user has its data
    operations REFUSED (#3760, fail-closed), so `client.automation.trigger()`
    could not run a data-touching flow at all while `POST /:name/trigger` could.
    service-automation's own comment claims "most trigger surfaces (REST action /
    trigger endpoint) already resolve the full envelope"; for this endpoint it was
    not true. Both routes share one context builder now.
  - **The dead `automationService.trigger(...)` probe is gone.** Nothing in the
    repo has ever implemented `trigger` on the automation slot and the contract
    never declared it, so the branch was unreachable on every deployment and its
    `execute` "fallback" was the route. Declaring `trigger?` would have blessed a
    second name for `execute`; the dead branch is deleted instead.

  No migration. Every added contract member is optional, so existing
  implementations stay valid; the two runtime fixes only make routes that were
  failing or degraded behave like their working twins.

- 1d4756e: fix(i18n)!: `/i18n/labels/:object/:locale` emits the entry shape it declares —
  and stops discarding `help`/`options` (#3847)

  `GetFieldLabelsResponseSchema` has always declared each label as an object:

  ```ts
  labels: z.record(
    z.string(),
    z.object({
      label: z.string(),
      help: z.string().optional(),
      options: z.record(z.string(), z.string()).optional(),
    })
  );
  ```

  Both serving surfaces emitted `Record<string, string>` — a bare label per field.
  A client typed against `GetFieldLabelsResponse` read `labels[field].label` and
  got `undefined`, because the value was the string itself. The SDK's type was
  right the whole time; the servers were wrong.

  The cost is not only the type mismatch. `FieldTranslationSchema` carries `help`
  and `options`, bundles populate them, and the endpoint threw them away. objectui
  needs exactly those — its `spec-translations.ts` transform reads `label` **and**
  `options` (as `fieldOptions.<obj>.<fld>.<value>`) — and gets them by pulling the
  whole bundle from `/i18n/translations/:locale` and resolving client-side. The
  per-object endpoint could not have served it even if it wanted to: the data was
  being dropped at the emit site.

  Fixed at that emit site, `resolveObjectFieldLabels`, which both surfaces already
  share as of #3833 — so one change covers both. `help` and `options` are attached
  only when non-empty: an `options: {}` would claim a field has translated options
  and hand back none, and a `help: ''` would erase a caller's source help text.
  Fields with no non-empty `label` are still omitted entirely, which is what lets
  `ResolvedFieldLabel.label` be a required string.

  **The response schema is unchanged** — this moves the implementation onto the
  contract, not the contract onto the implementation. Generated docs are
  byte-identical for that reason.

  `placeholder` is deliberately left out. `FieldTranslationSchema` has it and the
  response schema does not, so emitting it would be widening the contract rather
  than satisfying it — and adding an optional response field later is additive and
  non-breaking, whereas guessing now is not.

  The regression guard is the part worth keeping: a test that builds the response
  body from the shared helper and parses it with `GetFieldLabelsResponseSchema`.
  Nothing had ever put the emitted value and the declared contract in one
  assertion, which is precisely why a bare string could sit under an object schema
  unnoticed. Third and last of the declared ≠ enforced gaps on this endpoint
  family, after #3676 (request filters no server read) and #3833 (a derivation
  scanning a retired dialect).

  BREAKING: `labels[field]` is now `{ label, help?, options? }` rather than a
  string. No consumer in this repo or objectui read it — objectui never calls this
  route, and in-repo use is the SDK method plus URL-shape tests — so the practical
  blast radius is nil, and this is the cheap moment to align it.

- 720c5ad: fix(runtime,i18n): the dispatcher's field-labels route reads the bundle shape
  producers actually write — one shared derivation (#3833)

  `GET /i18n/labels/:object/:locale` served through the dispatcher returned
  `{ labels: {} }` for every provider. Its derivation scanned for flat
  `o.<object>.fields.<field>` keys:

  ```ts
  const prefix = `o.${objectName}.fields.`;
  for (const [key, value] of Object.entries(translations)) { … }
  ```

  That dialect was retired by #3778 — no producer has ever written it, and a real
  bundle's top-level keys are the `TranslationData` groups (`objects`, `apps`,
  `messages`, …), so the prefix could not match anything. 4cca74c fixed the
  identical derivation in `service-i18n` and did not reach the dispatcher's copy.

  This is not a rare fallback. `getFieldLabels` is optional on `II18nService` and
  **nothing implements it** — not `memory-i18n`, not `file-i18n-adapter` — so the
  dedicated-method branch both surfaces check first is dead in production and this
  derivation is the only path there is. Any stack served by the dispatcher (the
  AppPlugin in-memory provider auto-registered for stacks declaring translation
  bundles) got an empty map, indistinguishable from "this object has no translated
  labels": nothing errored, nothing warned.

  Worse than the class it was found next to. #3676, which prompted the check,
  ignored a declared filter and returned the full bundle — a correct superset. This
  returned nothing and said it was fine.

  The derivation now lives once, as `resolveObjectFieldLabels` in
  `packages/spec/src/system/i18n-resolver.ts`, alongside the other resolvers that
  read `TranslationData`. Both surfaces call it. Keeping a copy each is precisely
  how one got fixed and the other did not; the next bundle-shape change now has one
  place to land. Fields carrying no non-empty `label` stay omitted rather than
  emitted blank — partial translation is the normal state, and callers merge this
  map over their source labels, where a `''` would erase them.

  ### The tests were fiction on both sides

  The dispatcher's fallback test fed flat `o.contact.fields.first_name` keys and
  asserted labels came back, so it passed on data that cannot occur while
  production returned `{}` — the same failure mode as the client test retired in
  #3676, which asserted a query string was built that no server read. It now feeds
  the nested shape, and was confirmed to fail against the pre-fix code (`expected
{} to deeply equal { first_name: 'First Name', … }`) rather than merely passing
  after it. The shared helper carries its own unit tests, including one pinning
  that the retired flat dialect resolves to `{}`.

  The same suite's mock also declared a `getFieldLabels` no shipped provider has,
  and returned flat-dialect data from `getTranslations`; both now reflect what a
  real provider does, with the divergence noted where it remains deliberate.

  Not addressed here, filed separately: `GetFieldLabelsResponseSchema` declares
  `labels` as `Record<string, { label, help?, options? }>`, but both surfaces emit
  `Record<string, string>` — a third declared ≠ enforced gap in the same endpoint,
  and a wire-shape change too breaking to fold into a correctness fix.

- 41642b0: fix(runtime,i18n)!: `/i18n/locales` answers in one shape — plus the
  success-envelope conformance gate that found it

  Follow-up to #3676 / #3833 / #3847. Those three were each a body that did not
  match the schema declaring it, and each survived a green suite because **every
  test asserted the emitted body against a hand-written literal**. Comparing
  output to a literal proves the code does what the test author believed; it
  cannot prove the code does what the contract declares. Nothing had ever put the
  emitted value and the declared schema in the same assertion.

  This adds that assertion as a suite — `i18n-success-envelope.conformance.test.ts`
  in `runtime`, the missing success-path twin of service-i18n's
  `error-envelope.conformance.test.ts` and the same pairing storage got in #3689.
  Every `/i18n` success body is parsed against `BaseResponseSchema` and against
  the schema `plugin-rest-api` names for that route (`responseSchema:
'GetLocalesResponseSchema'`, …), imported rather than restated.

  **It found a fourth gap on its first run.** `GET /i18n/locales` passed
  `getLocales()`'s raw `string[]` straight through the dispatcher, while
  `GetLocalesResponseSchema` declares `{ code, label, isDefault }[]` — and
  service-i18n, the _other_ provider of this identical route, already emitted
  descriptors. One endpoint, two shapes, decided by which plugin mounted it, with
  the dispatcher's form contradicting the SDK's own `GetLocalesResponse` type.

  That is the same split #3833 found in the field-labels derivation, one route
  over, and it happened for the same reason: two surfaces, one mapping, kept
  twice. So the mapping is now shared as `toLocaleDescriptors` in
  `packages/spec/src/system/i18n-resolver.ts`, next to `resolveObjectFieldLabels`,
  and both surfaces call it. `label` is the locale code — no display-name source
  exists in the tree and the schema requires the field; inventing an ICU
  display-name table here would be a product decision, not an implementation
  detail.

  The gate was verified the same way #3833's was: the fix was reverted and the
  suite confirmed to fail on it —

  ```
  locales body does not match its declared schema:
    [{"expected":"object","code":"invalid_type","path":["locales",0],
      "message":"Invalid input: expected object, received string"}, …]
  ```

  — rather than merely passing once written. Five existing tests pinned the bare
  `string[]`; they now assert on `.map(l => l.code)`, so the codes stay pinned
  while the shape is owned by the schema.

  BREAKING: `GET /i18n/locales` served by the dispatcher now returns
  `[{ code, label, isDefault }]` instead of `['en', …]`. Callers on the
  service-i18n mount already received this shape, and the SDK's published
  `GetLocalesResponse` type has always described it, so this ends a divergence
  rather than starting one.

  Worth generalizing beyond `/i18n`: `plugin-rest-api.zod.ts` already carries a
  `responseSchema` name on essentially every route (29 declarations across 28
  handlers), so the route → declaring-schema mapping needed to run this check
  repo-wide exists today and is unused.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- f1a8114: fix(client,service-i18n): ledger the autonomously-mounted service routes, and repair the two i18n calls that reached nothing (#3636)

  Tranche 3 of the #3563 route audit — the last un-audited server surface. The
  dispatcher ledger (#3563) and the REST ledger (#3587) each stop at their own
  package boundary, and two services mount routes outside both: they reach for
  the `http-server` service and register straight on `IHttpServer`, so neither
  `RouteManager` nor `RestServer.getRoutes()` has ever seen them. That left the
  SDK's entire storage surface, plus all of i18n, in the pre-#3563 posture:
  expressed, working, guarded by nothing.

  **Ledgers + guards.** `storage-route-ledger.ts` (10 routes) and
  `i18n-route-ledger.ts` (3) sit next to the registrars that mount them, each
  enumerated for real — the registrar runs against a capturing mock
  `IHttpServer` and its registration calls _are_ the route set, so a new route
  lands with a reviewed disposition or fails CI. The client half is
  `packages/client/src/service-route-ledger-coverage.test.ts`; ledgers cross the
  boundary as relative source imports, never a service→client package edge.

  **Two wire-level 404s fixed.** `i18n.getTranslations` sent
  `/i18n/translations?locale=xx` and `i18n.getFieldLabels` sent
  `/i18n/labels/:object?locale=xx`, while every serving surface — service-i18n's
  mounts, the dispatcher's HTTP mounts, and the `plugin-rest-api.zod.ts`
  contract — mounts only the path form. Neither call could ever be answered.
  Both had carried a green `sdk` row in the dispatcher ledger since tranche 1,
  because that guard asks whether the client _method_ exists, not whether it
  speaks a URL anything mounts. The client now sends the path dialect, the same
  resolution #3611 gave `meta.getView`, and a new suite drives the real client
  at a real router so a revert cannot pass quietly.

  **One response-shape fix.** service-i18n's success bodies omitted the
  `success` flag that `ObjectStackClient.unwrapResponse` keys on, so the SDK
  returned the raw `{ data: … }` wrapper against that provider while returning
  the declared unwrapped shape against the dispatcher — one method, two shapes,
  decided by which plugin mounted the route. Its three handlers now emit the
  `{ success: true, data }` envelope the `i18n` route group declares. `data` did
  not move, so direct body readers are unaffected.

  Storage audited clean: 7 routes SDK-expressed, 3 reviewed `server-only` (the
  browser capability URL objectql stamps into file-field payloads, and the two
  local-driver loopbacks). The chunked-upload family, flagged for triage, turned
  out fully expressed. Both ledgers ratchet `gap` and `mismatch` at zero.

  Filed, not fixed: `GET {base}/_local/file/:key` is built by three call sites
  and mounted by none (#3641); the cross-surface URL conformance guard that would
  have caught all of the above mechanically is the capstone (#3642).

- f8fe47e: feat(runtime,rest,plugin-auth,service-i18n,service-storage): route-ledger 条目类型加可选 `responseSchema` (#5791)

  #3877 的「最小首步」，维护者 2026-08-06 已批。**纯增量、零行为变更**：五个 route
  ledger 的现有条目一行未改，字段缺省即「未声明」。

  ## 为什么是这一步

  #3877 量到的洞不是「发出的和声明的不一致」，而是**大多数路由根本没有可对账的声明**：
  237 条已挂载路由里 215 条是 `sdk` 面，而携带 schema 引用的是 **0 条**。于是同一单
  里裁定了两件事——Stage C（批量补 ~190 条响应 schema）**永不排期**（一条响应 schema
  是「这个端点承诺什么」的产品决定，批量生产正是 #3676 / #3833 / #3847 / #3870 四个
  缺陷的成因），以及先把「这条路由声明了什么」变成**可查询数据**，让 Stage D 的棘轮
  将来有东西可棘。本次落地的就是后者。

  ## 字段语义

  `responseSchema` 是 `@objectstack/spec/api` 导出名，指向该路由**响应载荷**的声明：
  路由套 `{ success, data }` 信封时指 `data`，不套时指整个 body。信封本身不归它管，
  由 `pnpm check:route-envelope` 结构化守住——一个字段无法同时诚实地描述两层。

  五个 ledger 是五个各自独立声明、按约定同形的 interface，因此是五处同名同措辞的可选
  字段，**不是**新建共享类型包。三个 ledger 明确要求保持 import-free（客户端守卫按
  相对**源文件**编译它们），且 `zod` 并非每个持有 ledger 的包的依赖，故字段存的是
  **名字**而非 live schema 对象，解析放在能 import spec 的守卫里。

  ## 已填的两条（实证，不是批量）

  只填 #5682 已给出双断言覆盖（safeParse 判**值** + 键集判**键**）的 discovery 族两条，
  且刻意分处两个 ledger，以证明一个字段形状确实服务五个独立声明的条目类型：

  - `packages/runtime` `GET /discovery` → `DiscoverySchema`（走信封，指 `data`）
  - `packages/rest` `GET /api/v1/discovery` → `DiscoverySchema`（裸发，指整个 body）

  `GET /api/v1` 这条 bare-base 别名**故意不填**：它与上面那条共用同一个
  `discoveryHandler` 闭包，但 #5682 的测试只驱动 `/api/v1/discovery`，「同一个 handler
  所以同一个形状」是对代码的论证而非对代码的测量。没有覆盖就不填。

  ## 新增守卫

  - `packages/client/src/route-ledger-response-schema.test.ts` —— 五个 ledger 的并集里
    每一个 `responseSchema` 都到**活的** `@objectstack/spec/api` 导出里解析，并且真的
    调用一次 `safeParse`（spec 的 schema 是 `lazySchema()` 代理，只查属性存在会被代理
    陷阱满足）。含否定对照（少一个字母的名字、空串、导出了但不是 schema）与反空转下界。
  - `discovery-schema-conformance.test.ts`（runtime / rest 各一）—— 钉住 ledger 报的
    schema 就是该套件实际解析用的**同一个对象**，并各自测量了载荷所在的层级。

- bd68f08: fix(service-storage,service-i18n): emit the declared error envelope, not a bare `{ error }` (#3675)

  #3636 aligned the **success** bodies of the autonomously-mounted service
  routes because those were the ones breaking `ObjectStackClient.unwrapResponse`.
  The error bodies were left alone and stayed a bare `{ error: '<message>' }` —
  with the code, where one existed at all, as a _sibling_ of `error` rather than
  a field of it — against a contract (`BaseResponseSchema` + `ApiErrorSchema`)
  that declares `{ success: false, error: { code, message } }`.

  So the same SDK method returned two different error shapes depending on which
  provider mounted the route: a caller reading `body.error.message` got the real
  message from the dispatcher and `undefined` from these services. All 32 sites
  (27 in `storage-routes.ts`, 5 in `i18n-service-plugin.ts`) now go through a
  single `sendError` helper per module — the nested-`error` shape the sibling
  services already use (`settings-routes.ts`, `share-link-routes.ts`), plus the
  `success` flag those two still omit and the contract requires.

  **Codes moved, and that is the breaking part.** `AUTH_REQUIRED`,
  `ATTACHMENT_DOWNLOAD_DENIED` and `FILE_DOWNLOAD_DENIED` used to sit at
  `body.code`; they now sit at `body.error.code`. The SDK is unaffected — it
  already reads `errorBody?.code || errorBody?.error?.code`, one of the four
  shapes its error path sniffs for, which is the consumer-side shim Prime
  Directive #12 says to cure at the producer. The console's attachment panel
  was NOT: it read the top level only, so every gated download would have
  degraded from "You don't have access to download this attachment." to
  "Download failed (403)". Fixed in objectui to read both dialects, since a
  console build ships independently of the server it talks to.

  **Guarded both ways.** New `error-envelope.conformance.test.ts` in each
  service drives every distinct error branch through the real registrar and
  parses the body against the real `BaseResponseSchema` imported from
  `packages/spec` — not a local restatement of it — and scans the module source
  so a new route cannot quietly reintroduce the bare shape. The route ledgers
  (#3563 → #3656) could never have caught this: they audit which routes exist
  and whether the SDK can address them, not what comes back.

  Measured and left alone: the dispatcher does not conform either — it puts the
  HTTP status in `error.code`, where the contract declares a semantic string,
  and parks the real code in `details` to work around its own occupied field.
  That deviation is now pinned to exactly one field by a test in
  `http-dispatcher.test.ts` rather than described in prose. Also unchanged:
  service-storage's success bodies are still three shapes of their own
  (`{ data }`, bare `{ url }`, `{ ok, key }`, none with `success: true`) — a
  non-additive change that needs its own issue, not a quiet ride along with this
  one.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [32d3800]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/types@17.0.0

## 17.0.0-rc.6

### Patch Changes

- f8fe47e: feat(runtime,rest,plugin-auth,service-i18n,service-storage): route-ledger 条目类型加可选 `responseSchema` (#5791)

  #3877 的「最小首步」，维护者 2026-08-06 已批。**纯增量、零行为变更**：五个 route
  ledger 的现有条目一行未改，字段缺省即「未声明」。

  ## 为什么是这一步

  #3877 量到的洞不是「发出的和声明的不一致」，而是**大多数路由根本没有可对账的声明**：
  237 条已挂载路由里 215 条是 `sdk` 面，而携带 schema 引用的是 **0 条**。于是同一单
  里裁定了两件事——Stage C（批量补 ~190 条响应 schema）**永不排期**（一条响应 schema
  是「这个端点承诺什么」的产品决定，批量生产正是 #3676 / #3833 / #3847 / #3870 四个
  缺陷的成因），以及先把「这条路由声明了什么」变成**可查询数据**，让 Stage D 的棘轮
  将来有东西可棘。本次落地的就是后者。

  ## 字段语义

  `responseSchema` 是 `@objectstack/spec/api` 导出名，指向该路由**响应载荷**的声明：
  路由套 `{ success, data }` 信封时指 `data`，不套时指整个 body。信封本身不归它管，
  由 `pnpm check:route-envelope` 结构化守住——一个字段无法同时诚实地描述两层。

  五个 ledger 是五个各自独立声明、按约定同形的 interface，因此是五处同名同措辞的可选
  字段，**不是**新建共享类型包。三个 ledger 明确要求保持 import-free（客户端守卫按
  相对**源文件**编译它们），且 `zod` 并非每个持有 ledger 的包的依赖，故字段存的是
  **名字**而非 live schema 对象，解析放在能 import spec 的守卫里。

  ## 已填的两条（实证，不是批量）

  只填 #5682 已给出双断言覆盖（safeParse 判**值** + 键集判**键**）的 discovery 族两条，
  且刻意分处两个 ledger，以证明一个字段形状确实服务五个独立声明的条目类型：

  - `packages/runtime` `GET /discovery` → `DiscoverySchema`（走信封，指 `data`）
  - `packages/rest` `GET /api/v1/discovery` → `DiscoverySchema`（裸发，指整个 body）

  `GET /api/v1` 这条 bare-base 别名**故意不填**：它与上面那条共用同一个
  `discoveryHandler` 闭包，但 #5682 的测试只驱动 `/api/v1/discovery`，「同一个 handler
  所以同一个形状」是对代码的论证而非对代码的测量。没有覆盖就不填。

  ## 新增守卫

  - `packages/client/src/route-ledger-response-schema.test.ts` —— 五个 ledger 的并集里
    每一个 `responseSchema` 都到**活的** `@objectstack/spec/api` 导出里解析，并且真的
    调用一次 `safeParse`（spec 的 schema 是 `lazySchema()` 代理，只查属性存在会被代理
    陷阱满足）。含否定对照（少一个字母的名字、空串、导出了但不是 schema）与反空转下界。
  - `discovery-schema-conformance.test.ts`（runtime / rest 各一）—— 钉住 ledger 报的
    schema 就是该套件实际解析用的**同一个对象**，并各自测量了载荷所在的层级。

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4

## 17.0.0-rc.2

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- d5c75e2: fix(spec,runtime,service-i18n): the dispatcher domains and their service contracts describe the same surface (#4127)

  #4087 retired a `/storage` bridge that called `upload(key, data, options?)` as
  `upload(file, { request })` — a shape no implementation has. Sweeping the other
  dispatcher domains against `packages/spec/src/contracts/*` found the mirror-image
  gap in three places: the call site and the implementation agreed, and the
  **contract** was the thing that had never been written down. Each one was worked
  around at the call site with `typeof x.foo === 'function'` — a duck-type is what
  "the contract does not cover this" looks like when nobody fixes the contract.

  Fixed at the contract, per Prime Directive #12.

  **`INotificationService` — the inbox half.** `listInbox` / `markRead` /
  `markAllRead` now exist, with `InboxQuery` / `InboxNotification` /
  `InboxListResult` / `MarkReadResult`. Three SDK-expressed routes
  (`notifications.list` / `.markRead` / `.markAllRead`) have rested on them all
  along, implemented by `service-messaging`, while this contract described only
  `send`. The cost was not theoretical: the dev notification stub implements
  exactly `send` and `sendBatch` **because it followed the contract**, so the one
  implementation written to spec was the one the dispatcher had to duck-type past.

  They are optional, and the probe stays: an inbox needs a durable store, and a
  send-only provider (SMTP, Twilio, a Slack webhook) fills the slot legitimately
  without one. `handlerReady` cannot express that — the slot is serveable, one
  capability of it is absent. The `/notifications` domain now takes
  `INotificationService` instead of `as any`, and each write route probes its own
  method rather than riding the entry `listInbox` check (they are separately
  optional, so "has an inbox to read" never implied "has read-state to write").

  **`II18nService.getFieldLabels`.** Both serving surfaces — the dispatcher's
  `/i18n/labels/:object/:locale` and service-i18n's own mount — probed for it and
  both documented it as "optional on `II18nService`", which was not true. It is
  now. service-i18n's probe loses two casts with it (one through
  `Record<string, unknown>`, one re-declaring the signature inline).

  **`IAutomationService.getFlowRuntimeStates`** + the `FlowRuntimeState` type.
  `GET /automation/_status` (and the CLI boot summary, and the
  `kernel:bootstrapped` audit) already called it while the contract stopped at
  `listFlows(): string[]`. The dispatcher's inline cast declared it as
  `{ name, enabled, bound }` — a third copy of the shape and a narrower one than
  the engine returns, dropping the `status` / `triggerType` / `object` fields that
  say WHY a flow is unbound.

  Two runtime fixes fell out of the same sweep:

  - **`POST /automation/trigger/:name` now builds a real `AutomationContext`.**
    It passed the raw HTTP body to `execute(name, body)`, so the
    `{ recordId, objectName, params }` translation never ran and — the sharper
    half — no caller identity was forwarded. A flow's default `runAs` is `'user'`,
    and a `runAs:'user'` run whose trigger resolved no user has its data
    operations REFUSED (#3760, fail-closed), so `client.automation.trigger()`
    could not run a data-touching flow at all while `POST /:name/trigger` could.
    service-automation's own comment claims "most trigger surfaces (REST action /
    trigger endpoint) already resolve the full envelope"; for this endpoint it was
    not true. Both routes share one context builder now.
  - **The dead `automationService.trigger(...)` probe is gone.** Nothing in the
    repo has ever implemented `trigger` on the automation slot and the contract
    never declared it, so the branch was unreachable on every deployment and its
    `execute` "fallback" was the route. Declaring `trigger?` would have blessed a
    second name for `execute`; the dead branch is deleted instead.

  No migration. Every added contract member is optional, so existing
  implementations stay valid; the two runtime fixes only make routes that were
  failing or degraded behave like their working twins.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- 4cca74c: fix(i18n)!: the `translation` metadata type speaks the same `objects.` shape everything else does (#3778)

  A translation authored in the product saved successfully and then rendered
  nothing. Not a resolver gap — a contract split. The `translation` metadata type
  (`allowRuntimeCreate: true`, so Studio/the metadata API/an agent can author it)
  was registered against `AppTranslationBundleSchema`, an object-first shape keyed
  on `o.<object>`. Every resolver, `os i18n extract`, `os i18n check`, the objectui
  hooks, and all nine shipped bundles read `objects.<object>`. Nothing bridged the
  two, so the save path and the read path never met.

  **Why converge instead of bridge.** A converter was the obvious fix and the
  wrong one: it would be throwaway code, and it would start producing _working_
  `o.`-shaped rows — closing the migration-free window that exists precisely
  because the feature never functioned. The retired shape's real-world footprint
  was zero: all three `*.translation.ts` files in the tree (platform-objects,
  CRM and todo examples) were already `objects.`-shaped, contradicting the type's
  own registered schema. Converging is a registration fix, not a migration.

  **Breaking.** `AppTranslationBundleSchema`, `ObjectTranslationNodeSchema`, and
  their types are **deleted** — no deprecation cycle. Nothing worked end-to-end
  through them, so there is no functioning consumer to protect, and a
  deprecated-but-present schema is exactly the exemplar an AI agent copies into
  new code. The optional `II18nService.getAppBundle` / `loadAppBundle` methods go
  with them: zero implementers, so they advertised a capability the runtime never
  delivered.

  **The replacement.** `TranslationItemSchema` — one locale of the same
  `TranslationData` groups a file bundle uses, plus the `locale` it translates,
  with a `defineTranslation()` factory. An item is one entry of a
  `TranslationBundle`; that is the whole type.

  Three details are deliberate, all aimed at the failure being silent rather than
  loud:

  - **`locale` is required**, not inferred from the item name. The sync skips an
    item whose locale it cannot resolve, and a skip is invisible to whoever — or
    whatever — authored it. (The name fallback still covers rows written before
    this.)
  - **Retired keys are rejected, not stripped.** Zod drops undeclared keys
    silently, which would reproduce this bug exactly: save succeeds, nothing
    renders. A pre-parse guard turns that silence into a 422 naming the group to
    use (`'o' … — use 'objects.<object_name>'`). It runs ahead of the parse so the
    retired keys stay out of the schema itself — the generated JSON Schema and the
    Studio editor never advertise a shape that cannot work.
  - **`ObjectTranslationData.label` is now optional.** Partial translation is the
    normal state and every resolver already treats each key as independent.
    Requiring it forced authors to restate the source label just to validate,
    filling bundles with fake translations that mask real coverage gaps.

  Also in this change: the authored-translation sync warns (naming the row and the
  fix) when it meets a row still in the retired shape instead of loading it into
  nowhere, and no longer merges publish bookkeeping (`_lockReason`,
  `_packageVersion`, …) into the translation layer. `GET
/i18n/labels/:object/:locale`'s fallback now reads the nested
  `objects.<obj>.fields.<field>.label` data it is actually given — it scanned for
  flat dotted `o.<obj>.fields.<field>` keys, a third dialect no producer ever
  wrote, so it always returned `{}`.

  Migration: author every translation — file or runtime item — under `objects.`.
  `o` → `objects`, `app` → `apps`, `nav` → `apps.<app>.navigation.<id>.label`,
  `dashboard` → `dashboards`, `_globalOptions` →
  `objects.<obj>.fields.<field>.options`, `_meta.locale` → top-level `locale`,
  `_actions.confirmMessage` → `_actions.confirmText`. `reports`, `notifications`,
  `errors`, and `namespace` had no runtime consumer and have no replacement.

### Patch Changes

- 1d4756e: fix(i18n)!: `/i18n/labels/:object/:locale` emits the entry shape it declares —
  and stops discarding `help`/`options` (#3847)

  `GetFieldLabelsResponseSchema` has always declared each label as an object:

  ```ts
  labels: z.record(
    z.string(),
    z.object({
      label: z.string(),
      help: z.string().optional(),
      options: z.record(z.string(), z.string()).optional(),
    })
  );
  ```

  Both serving surfaces emitted `Record<string, string>` — a bare label per field.
  A client typed against `GetFieldLabelsResponse` read `labels[field].label` and
  got `undefined`, because the value was the string itself. The SDK's type was
  right the whole time; the servers were wrong.

  The cost is not only the type mismatch. `FieldTranslationSchema` carries `help`
  and `options`, bundles populate them, and the endpoint threw them away. objectui
  needs exactly those — its `spec-translations.ts` transform reads `label` **and**
  `options` (as `fieldOptions.<obj>.<fld>.<value>`) — and gets them by pulling the
  whole bundle from `/i18n/translations/:locale` and resolving client-side. The
  per-object endpoint could not have served it even if it wanted to: the data was
  being dropped at the emit site.

  Fixed at that emit site, `resolveObjectFieldLabels`, which both surfaces already
  share as of #3833 — so one change covers both. `help` and `options` are attached
  only when non-empty: an `options: {}` would claim a field has translated options
  and hand back none, and a `help: ''` would erase a caller's source help text.
  Fields with no non-empty `label` are still omitted entirely, which is what lets
  `ResolvedFieldLabel.label` be a required string.

  **The response schema is unchanged** — this moves the implementation onto the
  contract, not the contract onto the implementation. Generated docs are
  byte-identical for that reason.

  `placeholder` is deliberately left out. `FieldTranslationSchema` has it and the
  response schema does not, so emitting it would be widening the contract rather
  than satisfying it — and adding an optional response field later is additive and
  non-breaking, whereas guessing now is not.

  The regression guard is the part worth keeping: a test that builds the response
  body from the shared helper and parses it with `GetFieldLabelsResponseSchema`.
  Nothing had ever put the emitted value and the declared contract in one
  assertion, which is precisely why a bare string could sit under an object schema
  unnoticed. Third and last of the declared ≠ enforced gaps on this endpoint
  family, after #3676 (request filters no server read) and #3833 (a derivation
  scanning a retired dialect).

  BREAKING: `labels[field]` is now `{ label, help?, options? }` rather than a
  string. No consumer in this repo or objectui read it — objectui never calls this
  route, and in-repo use is the SDK method plus URL-shape tests — so the practical
  blast radius is nil, and this is the cheap moment to align it.

- 720c5ad: fix(runtime,i18n): the dispatcher's field-labels route reads the bundle shape
  producers actually write — one shared derivation (#3833)

  `GET /i18n/labels/:object/:locale` served through the dispatcher returned
  `{ labels: {} }` for every provider. Its derivation scanned for flat
  `o.<object>.fields.<field>` keys:

  ```ts
  const prefix = `o.${objectName}.fields.`;
  for (const [key, value] of Object.entries(translations)) { … }
  ```

  That dialect was retired by #3778 — no producer has ever written it, and a real
  bundle's top-level keys are the `TranslationData` groups (`objects`, `apps`,
  `messages`, …), so the prefix could not match anything. 4cca74c fixed the
  identical derivation in `service-i18n` and did not reach the dispatcher's copy.

  This is not a rare fallback. `getFieldLabels` is optional on `II18nService` and
  **nothing implements it** — not `memory-i18n`, not `file-i18n-adapter` — so the
  dedicated-method branch both surfaces check first is dead in production and this
  derivation is the only path there is. Any stack served by the dispatcher (the
  AppPlugin in-memory provider auto-registered for stacks declaring translation
  bundles) got an empty map, indistinguishable from "this object has no translated
  labels": nothing errored, nothing warned.

  Worse than the class it was found next to. #3676, which prompted the check,
  ignored a declared filter and returned the full bundle — a correct superset. This
  returned nothing and said it was fine.

  The derivation now lives once, as `resolveObjectFieldLabels` in
  `packages/spec/src/system/i18n-resolver.ts`, alongside the other resolvers that
  read `TranslationData`. Both surfaces call it. Keeping a copy each is precisely
  how one got fixed and the other did not; the next bundle-shape change now has one
  place to land. Fields carrying no non-empty `label` stay omitted rather than
  emitted blank — partial translation is the normal state, and callers merge this
  map over their source labels, where a `''` would erase them.

  ### The tests were fiction on both sides

  The dispatcher's fallback test fed flat `o.contact.fields.first_name` keys and
  asserted labels came back, so it passed on data that cannot occur while
  production returned `{}` — the same failure mode as the client test retired in
  #3676, which asserted a query string was built that no server read. It now feeds
  the nested shape, and was confirmed to fail against the pre-fix code (`expected
{} to deeply equal { first_name: 'First Name', … }`) rather than merely passing
  after it. The shared helper carries its own unit tests, including one pinning
  that the retired flat dialect resolves to `{}`.

  The same suite's mock also declared a `getFieldLabels` no shipped provider has,
  and returned flat-dialect data from `getTranslations`; both now reflect what a
  real provider does, with the divergence noted where it remains deliberate.

  Not addressed here, filed separately: `GetFieldLabelsResponseSchema` declares
  `labels` as `Record<string, { label, help?, options? }>`, but both surfaces emit
  `Record<string, string>` — a third declared ≠ enforced gap in the same endpoint,
  and a wire-shape change too breaking to fold into a correctness fix.

- 41642b0: fix(runtime,i18n)!: `/i18n/locales` answers in one shape — plus the
  success-envelope conformance gate that found it

  Follow-up to #3676 / #3833 / #3847. Those three were each a body that did not
  match the schema declaring it, and each survived a green suite because **every
  test asserted the emitted body against a hand-written literal**. Comparing
  output to a literal proves the code does what the test author believed; it
  cannot prove the code does what the contract declares. Nothing had ever put the
  emitted value and the declared schema in the same assertion.

  This adds that assertion as a suite — `i18n-success-envelope.conformance.test.ts`
  in `runtime`, the missing success-path twin of service-i18n's
  `error-envelope.conformance.test.ts` and the same pairing storage got in #3689.
  Every `/i18n` success body is parsed against `BaseResponseSchema` and against
  the schema `plugin-rest-api` names for that route (`responseSchema:
'GetLocalesResponseSchema'`, …), imported rather than restated.

  **It found a fourth gap on its first run.** `GET /i18n/locales` passed
  `getLocales()`'s raw `string[]` straight through the dispatcher, while
  `GetLocalesResponseSchema` declares `{ code, label, isDefault }[]` — and
  service-i18n, the _other_ provider of this identical route, already emitted
  descriptors. One endpoint, two shapes, decided by which plugin mounted it, with
  the dispatcher's form contradicting the SDK's own `GetLocalesResponse` type.

  That is the same split #3833 found in the field-labels derivation, one route
  over, and it happened for the same reason: two surfaces, one mapping, kept
  twice. So the mapping is now shared as `toLocaleDescriptors` in
  `packages/spec/src/system/i18n-resolver.ts`, next to `resolveObjectFieldLabels`,
  and both surfaces call it. `label` is the locale code — no display-name source
  exists in the tree and the schema requires the field; inventing an ICU
  display-name table here would be a product decision, not an implementation
  detail.

  The gate was verified the same way #3833's was: the fix was reverted and the
  suite confirmed to fail on it —

  ```
  locales body does not match its declared schema:
    [{"expected":"object","code":"invalid_type","path":["locales",0],
      "message":"Invalid input: expected object, received string"}, …]
  ```

  — rather than merely passing once written. Five existing tests pinned the bare
  `string[]`; they now assert on `.map(l => l.code)`, so the codes stay pinned
  while the shape is owned by the schema.

  BREAKING: `GET /i18n/locales` served by the dispatcher now returns
  `[{ code, label, isDefault }]` instead of `['en', …]`. Callers on the
  service-i18n mount already received this shape, and the SDK's published
  `GetLocalesResponse` type has always described it, so this ends a divergence
  rather than starting one.

  Worth generalizing beyond `/i18n`: `plugin-rest-api.zod.ts` already carries a
  `responseSchema` name on essentially every route (29 declarations across 28
  handlers), so the route → declaring-schema mapping needed to run this check
  repo-wide exists today and is unused.

- f1a8114: fix(client,service-i18n): ledger the autonomously-mounted service routes, and repair the two i18n calls that reached nothing (#3636)

  Tranche 3 of the #3563 route audit — the last un-audited server surface. The
  dispatcher ledger (#3563) and the REST ledger (#3587) each stop at their own
  package boundary, and two services mount routes outside both: they reach for
  the `http-server` service and register straight on `IHttpServer`, so neither
  `RouteManager` nor `RestServer.getRoutes()` has ever seen them. That left the
  SDK's entire storage surface, plus all of i18n, in the pre-#3563 posture:
  expressed, working, guarded by nothing.

  **Ledgers + guards.** `storage-route-ledger.ts` (10 routes) and
  `i18n-route-ledger.ts` (3) sit next to the registrars that mount them, each
  enumerated for real — the registrar runs against a capturing mock
  `IHttpServer` and its registration calls _are_ the route set, so a new route
  lands with a reviewed disposition or fails CI. The client half is
  `packages/client/src/service-route-ledger-coverage.test.ts`; ledgers cross the
  boundary as relative source imports, never a service→client package edge.

  **Two wire-level 404s fixed.** `i18n.getTranslations` sent
  `/i18n/translations?locale=xx` and `i18n.getFieldLabels` sent
  `/i18n/labels/:object?locale=xx`, while every serving surface — service-i18n's
  mounts, the dispatcher's HTTP mounts, and the `plugin-rest-api.zod.ts`
  contract — mounts only the path form. Neither call could ever be answered.
  Both had carried a green `sdk` row in the dispatcher ledger since tranche 1,
  because that guard asks whether the client _method_ exists, not whether it
  speaks a URL anything mounts. The client now sends the path dialect, the same
  resolution #3611 gave `meta.getView`, and a new suite drives the real client
  at a real router so a revert cannot pass quietly.

  **One response-shape fix.** service-i18n's success bodies omitted the
  `success` flag that `ObjectStackClient.unwrapResponse` keys on, so the SDK
  returned the raw `{ data: … }` wrapper against that provider while returning
  the declared unwrapped shape against the dispatcher — one method, two shapes,
  decided by which plugin mounted the route. Its three handlers now emit the
  `{ success: true, data }` envelope the `i18n` route group declares. `data` did
  not move, so direct body readers are unaffected.

  Storage audited clean: 7 routes SDK-expressed, 3 reviewed `server-only` (the
  browser capability URL objectql stamps into file-field payloads, and the two
  local-driver loopbacks). The chunked-upload family, flagged for triage, turned
  out fully expressed. Both ledgers ratchet `gap` and `mismatch` at zero.

  Filed, not fixed: `GET {base}/_local/file/:key` is built by three call sites
  and mounted by none (#3641); the cross-surface URL conformance guard that would
  have caught all of the above mechanically is the capstone (#3642).

- bd68f08: fix(service-storage,service-i18n): emit the declared error envelope, not a bare `{ error }` (#3675)

  #3636 aligned the **success** bodies of the autonomously-mounted service
  routes because those were the ones breaking `ObjectStackClient.unwrapResponse`.
  The error bodies were left alone and stayed a bare `{ error: '<message>' }` —
  with the code, where one existed at all, as a _sibling_ of `error` rather than
  a field of it — against a contract (`BaseResponseSchema` + `ApiErrorSchema`)
  that declares `{ success: false, error: { code, message } }`.

  So the same SDK method returned two different error shapes depending on which
  provider mounted the route: a caller reading `body.error.message` got the real
  message from the dispatcher and `undefined` from these services. All 32 sites
  (27 in `storage-routes.ts`, 5 in `i18n-service-plugin.ts`) now go through a
  single `sendError` helper per module — the nested-`error` shape the sibling
  services already use (`settings-routes.ts`, `share-link-routes.ts`), plus the
  `success` flag those two still omit and the contract requires.

  **Codes moved, and that is the breaking part.** `AUTH_REQUIRED`,
  `ATTACHMENT_DOWNLOAD_DENIED` and `FILE_DOWNLOAD_DENIED` used to sit at
  `body.code`; they now sit at `body.error.code`. The SDK is unaffected — it
  already reads `errorBody?.code || errorBody?.error?.code`, one of the four
  shapes its error path sniffs for, which is the consumer-side shim Prime
  Directive #12 says to cure at the producer. The console's attachment panel
  was NOT: it read the top level only, so every gated download would have
  degraded from "You don't have access to download this attachment." to
  "Download failed (403)". Fixed in objectui to read both dialects, since a
  console build ships independently of the server it talks to.

  **Guarded both ways.** New `error-envelope.conformance.test.ts` in each
  service drives every distinct error branch through the real registrar and
  parses the body against the real `BaseResponseSchema` imported from
  `packages/spec` — not a local restatement of it — and scans the module source
  so a new route cannot quietly reintroduce the bare shape. The route ledgers
  (#3563 → #3656) could never have caught this: they audit which routes exist
  and whether the SDK can address them, not what comes back.

  Measured and left alone: the dispatcher does not conform either — it puts the
  HTTP status in `error.code`, where the contract declares a semantic string,
  and parks the real code in `details` to work around its own occupied field.
  That deviation is now pinned to exactly one field by a test in
  `http-dispatcher.test.ts` rather than described in prose. Also unchanged:
  service-storage's success bodies are still three shapes of their own
  (`{ data }`, bare `{ url }`, `{ ok, key }`, none with `success: true`) — a
  non-additive change that needs its own issue, not a quiet ride along with this
  one.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/core@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/core@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/core@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/core@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/core@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0

## 12.2.0

### Patch Changes

- 4f5b791: Wire three more Studio-authored metadata surfaces at runtime (#2605 — the
  "declared but never wired" family, following the #2596 hooks template).

  **Authored actions now execute (#2605 item 1).** `engine.executeAction`'s map
  was only ever populated from the app bundle at boot, so a published `action`
  row (standalone or embedded in an authored object's `actions[]`) was stored
  and listed but never executable — before OR after a restart. Now:

  - `AppPlugin` installs a QuickJS-sandboxed default action runner at boot
    (`engine.setDefaultActionRunner`), the action-path twin of the #2596 hook
    body runner. Opt out with `OS_DISABLE_AUTHORED_ACTIONS=1`.
  - `ObjectQLPlugin` re-registers runtime-authored actions from their
    `sys_metadata` rows under `packageId: 'metadata-service'` at
    `kernel:ready`, on `metadata:reloaded`, and on `action`/`object` protocol
    mutations — saves, publishes, edits, and deletes take effect live.
    Package-artifact actions are excluded (AppPlugin owns those; re-registering
    would clobber their handlers).

  **Authored translations reach the i18n runtime (#2591).** `translation`
  metadata items (single-locale `AppTranslationBundle` payloads; locale from
  `_meta.locale`, a top-level `locale`, or a BCP-47-shaped item name) now load
  into the i18n service as a separate authored layer that overlays static
  bundles. Both adapters carry the layer — service-i18n's `FileI18nAdapter`
  AND the kernel's in-memory fallback (`createMemoryI18n`), which is what dev
  and standalone stacks actually run. The shared sync
  (`wireAuthoredTranslationSync`, exported from `@objectstack/core`, wired by
  the runtime's AppPlugin and by I18nServicePlugin with single-owner
  semantics) runs at `kernel:ready`, on `metadata:reloaded`, and on
  `translation` protocol mutations, with clear-then-reload semantics so
  deleted items/keys stop resolving instead of lingering in the deep-merged
  map.

  **Sharing rules created at runtime bind without a restart (#2592).**
  `bindRuleHooks` was boot-only, so the first rule authored at runtime for an
  object with no boot-time rule silently never evaluated (rule authoring is a
  data insert — `metadata:reloaded` never fires). The sharing plugin now binds
  afterInsert/afterUpdate/afterDelete triggers on `sys_sharing_rule` that
  unbind + re-bind the rule-hook package from a fresh `listRules()`, serialized
  so overlapping writes can't leave a stale snapshot bound, and fail-safe so a
  rebind failure never fails the rule write.

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0
- @objectstack/core@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- 772dc3f: fix i18n
  - @objectstack/spec@3.3.1
  - @objectstack/core@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- 83151bc: fix i18n
  - @objectstack/spec@3.2.6
  - @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
