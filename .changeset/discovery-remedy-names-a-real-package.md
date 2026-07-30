---
'@objectstack/spec': minor
'@objectstack/runtime': patch
'@objectstack/metadata-protocol': patch
---

Discovery's "install this to enable" now names a package that exists (#4093 follow-up).

Discovery tells a consumer two things about an absent capability: that it is absent, and what to do about it. The first has been carefully honest since #2462/#4000. The second was invented from the slot name.

The dispatcher templated `Install a ${slot} plugin to enable` across twelve slots, and `metadata-protocol` carried a hand-written table in which **ten of fifteen entries named a package that does not exist** — `plugin-redis`, `plugin-bullmq`, `job-scheduler`, `plugin-notifications`, `plugin-storage`, `plugin-automation`, `ui-plugin`, plus `plugin-ai`, `plugin-search` and `plugin-workflow` for slots nothing implements at all. That value is also surfaced as discovery's `provider`.

A remedy naming a package that cannot be installed is a dead end handed to someone at the exact moment they are trying to fix their stack — and an agent reading discovery cannot tell it apart from a package it should install. It is the same `declared ≠ enforced` failure this lineage has been closing, one level over: not "does the capability exist" but "is the fix real".

`CORE_SERVICE_PROVIDER` and `serviceUnavailableMessage()` in `@objectstack/spec/system` are now the one place that sentence is written, and both discovery builders read them, so the two hosts cannot tell a consumer to install different things (the drift #4089 and #4130 closed for the `metadata` and `data` entries). Entries were verified against what actually calls `registerService` for each slot rather than against name similarity — which is how `notification` turned out to be filled by `@objectstack/service-messaging`, the one slot whose package shares no word with its name.

Four slots — `ai`, `search`, `workflow`, `graphql` — have no implementation anywhere, so they now say so instead of naming a plausible package. `ui` keeps the fuller sentence it got in #4146 (`/ui` is served by the `protocol` service; nothing registers the `ui` slot), and that sentence now reaches both builders instead of one.

`scripts/check-service-providers.mjs` (wired into the lint workflow as `check:service-providers`) fails CI when a named package is not a real workspace package, or when a `CoreServiceName` slot has no entry — so a rename or a deletion cannot leave a stale instruction behind.

FROM → TO: `services.<slot>.message` and `services.<slot>.provider` change text for most unavailable slots. Anything matching on the old `Install a <slot> plugin to enable` wording should match on `status: 'unavailable'` instead — the status field is the contract; the message is prose for humans and agents.
