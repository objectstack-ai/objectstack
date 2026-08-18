---
"@objectstack/service-analytics": patch
"@objectstack/service-automation": patch
"@objectstack/service-cache": patch
"@objectstack/service-i18n": patch
"@objectstack/service-job": patch
---

docs: five published service READMEs stop documenting an API that does not exist (#9532)

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
