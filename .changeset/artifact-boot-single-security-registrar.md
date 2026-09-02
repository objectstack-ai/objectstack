---
"@objectstack/runtime": minor
---

fix(runtime): one registrar for the artifact boot's security collections — the artifact door, not `AppPlugin` (#12892 step 2)

On an artifact boot (`createStandaloneStack`: `os serve` / `os dev` / `os start` /
`os migrate` booting from `dist/objectstack.json`) the stack-declared
`positions` / `permissions` / `capabilities` / `sharingRules` used to reach the
metadata service through TWO registrars over the same bytes: the artifact door
(`MetadataPlugin`, which forward-converts, strict-parses and stamps ADR-0010
provenance) and `AppPlugin`'s ADR-0057 block (which does none of that). Because
`AppPlugin` started last its copy won, so a consumer of
`metadata.list('sharing_rule')` read a sharing rule whose `condition` was a bare
STRING where the door's copy carries `{ dialect, source }` (reading
`.condition.source` gave `undefined`), and a capability with no `scope` default
and no `_packageVersion` / `_provenance`. Which shape a reader saw depended on
plugin start order.

Maintainer ruling on #12892 (2026-08-29): the door owns the route. Now:

- `AppPlugin` takes `securityMetadataRegistrar: 'app-plugin' | 'artifact-door'`
  (constructor `opts`, default `'app-plugin'`). Under `'artifact-door'` the
  ADR-0057 block registers nothing and logs a `debug` line naming the
  collections left to the door; an unknown value is refused loudly.
- `createStandaloneStack` — the one composition that runs the door over the
  same artifact — declares `'artifact-door'` on the `AppPlugin` it composes. On
  that boot the metadata service holds exactly ONE copy of every security item:
  the door's, parsed, defaulted and provenance-stamped, in either start order.
- Every door-less composition (`new AppPlugin(config)` over a `defineStack()`
  module in `os serve` / `os migrate`, `DevPlugin`, `@objectstack/verify`'s
  `bootStack`, embedders) is unchanged: the default keeps registering all four
  collections exactly as before.

`minor` rather than `patch`: a public constructor option is added, and what the
metadata service serves for these four kinds on an artifact boot changes shape
(door copy instead of raw copy) — a fix, but one a reader of `GET /meta/<kind>`
or `metadata.list(<kind>)` on an artifact boot can observe.
