---
"@objectstack/core": patch
"@objectstack/plugin-auth": patch
"@objectstack/plugin-email": patch
"@objectstack/plugin-hono-server": patch
"@objectstack/plugin-security": patch
"@objectstack/service-storage": patch
"@objectstack/service-settings": patch
"@objectstack/service-realtime": patch
"@objectstack/service-i18n": patch
"@objectstack/service-analytics": patch
"@objectstack/service-messaging": patch
"@objectstack/service-cluster": patch
"@objectstack/service-sms": patch
"@objectstack/service-cache": patch
"@objectstack/service-queue": patch
"@objectstack/service-job": patch
"@objectstack/service-datasource": patch
"@objectstack/service-automation": patch
"@objectstack/mcp": patch
---

chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

ADR-0116 gave the kernel a declared ordering contract, but only
`ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
registers. The pre-Phase-1 ordering check can only *name a provider* for
services someone declared, so its coverage was two plugins wide.

An audit of every plugin's `init()` body (brace-matched, comments stripped,
each call classified by whether it sits inside a `try`/`if`) found 20 plugins
that register a service on every path without declaring it. All 20 now
declare `providesServices`. Purely additive: no ordering changes, no new
failure modes — a `providesServices` entry only lets the kernel say *who*
provides a service when it reports a misordering, and enriches the Phase-1
`getService` miss diagnostic.

Three needed a closer read before declaring, because they register the same
service from several branches (`cache`, `queue`, `job`): each early-return
branch plus the fallback registers it, so every path does — the declaration
is honest. ADR-0116's rule that a *conditionally* registered service must
never be declared is unchanged and was applied throughout.

The same audit found 12 plugins that hard-resolve a service during `init()`
(11 of them `manifest`) without declaring `requiresServices`. None is a live
exposure — every one already declares a hard `dependencies` entry on the
provider, so the kernel orders them correctly today. Those are tracked
separately: with a hard dependency in place, `requiresServices` mostly
restates what the kernel already enforces, and its real value is on
*soft*-dependency consumers, of which `AppPlugin` is currently the only one.
