---
'@objectstack/service-automation': patch
---

automation: a pausing node type that never declares `resumeAuthority` is now named
at registration, and the four pausing built-ins declare theirs (#5561)

`registerNodeExecutor` warns once per node type (per engine instance) when a
descriptor declares `supportsPause: true` and omits `resumeAuthority` — the state in
which the #3801 resume gate silently treats every pause that type creates as
raw-resumable through the generic resume route. The line names the two legal values
and says that declaring `'any'` explicitly silences it and changes no behaviour, so
a node whose pause really is open to the route is not pushed toward `'service'` to
quieten a log.

`screen`, `wait`, `subflow` and `map` now declare `resumeAuthority: 'any'`
explicitly. Each was already correct on its own terms — it was inheriting the value
rather than stating it — so the warning names nothing on a stock boot today and only
catches future omissions. Authority resolution is unchanged: `resolveResumeAuthority`
still resolves an absent value to `'any'`.
