---
'@objectstack/spec': patch
---

automation: `ActionDescriptor.resumeAuthority` no longer defaults to `'any'` — an
omission is now a distinct, reportable fact (#5561, from #3823)

The #3801 resume gate keys on the suspended node, so it covers a pausing node type
exactly when that type's author declared who may resume it. The schema default made
that impossible to check: Zod filled the key inside `defineActionDescriptor`, so
"the author chose `'any'`" and "the author never considered it" produced
byte-identical descriptors. #3823 is what the erasure cost — ADR-0044 pointed an
approval's revise edge at a generic `wait`, `wait` is legitimately `'any'`, and the
pause standing in a service-owned position inherited a fail-open value nobody chose.

The field is now optional with no default, and absent means absent. Two seams read
it: `AutomationEngine.registerNodeExecutor` warns once per node type when a
`supportsPause` descriptor omits it, and the new `check:resume-authority-declared`
gate fails CI on an omission in this repo's own executors.

**Not a behaviour change.** The engine already resolved the value with `?? 'any'`,
so an undeclared pausing type is still raw-resumable exactly as before — loudly now
instead of silently. Nothing needs migrating: an executor that declared
`resumeAuthority` keeps its value, and one that omitted it keeps today's semantics
and gains a warning telling it to state its intent. Making omission mean
*fail-closed* is a breaking change still tracked on #5561 for a version window that
allows it; it is now a one-expression change rather than a schema migration.
