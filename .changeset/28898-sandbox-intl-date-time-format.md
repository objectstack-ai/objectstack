---
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

feat(runtime): a sandboxed body can do time-zone date maths, through `Intl.DateTimeFormat`

Clause-②: no
Metadata-protocol: none

The body sandbox (QuickJS) had no `Intl`, so a job `body` could not tell which calendar day or period an instant falls in for a named IANA zone. A job that needs that kept the deprecated `handler`. The sandbox now has `globalThis.Intl` with one member, `DateTimeFormat`, and it is the whole constructor: `new Intl.DateTimeFormat(locales, { timeZone, ... })` (or without `new`), `supportedLocalesOf`, and `format` (a bound getter), `formatToParts`, `formatRange`, `formatRangeToParts` and `resolvedOptions`. Every answer comes from the server's own `Intl`, so the output matches the server's for the same input, IANA zones and DST edges included. An invalid `timeZone` throws the server's `RangeError` text as a `RangeError` inside the body. Nothing else of `Intl` exists (`Intl.NumberFormat` is `undefined`), so test for it with `typeof Intl.DateTimeFormat === 'function'`.

**Hooks and actions too.** Hook, action and job bodies run through one sandbox runner, so all three get the same `Intl.DateTimeFormat`.

**Isolation is unchanged.** Only plain values cross the boundary: a snapshot of the locales and the options `DateTimeFormat` reads, and epoch-millisecond numbers in, one JSON string out, parsed inside the sandbox. No host object reaches a body, the bridge is not a global, and "now" for `format()` comes from the sandbox's own `Date.now()`. There is no new I/O.

**`os build` lowering (cli).** A hook or action `handler` function that uses `Intl.DateTimeFormat` now lowers to a metadata `body` instead of being bundled, and `os lint` stops reporting it under `hook-body/not-lowerable`. The rest of `Intl` is judged per member: a handler using `Intl.NumberFormat`, or the bare `Intl` name in a way the build cannot follow (`const I = Intl`, `Intl[k]`), is still refused and bundled, and the refusal names the member, for example `Intl.NumberFormat`, where it used to name `Intl`. The refusal sentence now says the sandbox provides `Intl.DateTimeFormat` only of `Intl`, and says the body "would throw" where it said "would throw ReferenceError".

**Migration text (spec).** The job `handler` description, which marks `handler` deprecated, now says time-zone date maths moves to `body` too, through `Intl.DateTimeFormat`. The accepted metadata is unchanged.
