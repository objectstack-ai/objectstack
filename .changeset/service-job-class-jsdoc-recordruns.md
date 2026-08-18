---
"@objectstack/service-job": patch
---

fix(services): the `DbJobAdapter` class JSDoc stops promising a `sys_job_run` row that `recordRuns: false` never writes (#9631)

`tsup` emits this comment into `packages/services/service-job/dist/index.d.ts`, so it is
the class-level editor tooltip an npm consumer of `@objectstack/service-job` reads. Its
third "persisted side effects" bullet said **every execution writes a `sys_job_run` row**;
`wrap()` gates that insert on `recordRuns`, which defaults to `true` but writes nothing at
all when set to `false`. The same emitted `index.d.ts` states the truthful field-level rule
for `recordRuns` sixty lines above, so the published declaration disagreed with itself
about one flag — a reader hovering either one got a different answer.

No runtime behaviour changes. This is a patch because the entire deliverable is text inside
a published package's `.d.ts`: with no version bump the corrected tooltip never reaches npm
and the fix is unmet in the only channel it is about.

The corrected bullet defers to `DbJobAdapterOptions.recordRuns` via `{@link}` rather than
restating the rule, so the two cannot drift apart again, and it names the one row the flag
does not govern — `replay()`'s synthetic `trigger: 'replay'` row, written either way. The
fourth bullet gains the matching negative: the `sys_job` counters are bumped
unconditionally, `recordRuns` gating only the per-attempt rows.

Five cases now pin the flag in both directions. Nothing in this package referenced
`recordRuns` before, so both corrected sentences were accurate but unenforced.
