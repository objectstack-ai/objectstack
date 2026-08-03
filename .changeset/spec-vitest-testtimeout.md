---
"@objectstack/spec": patch
---

fix(spec): give this package's vitest run a 60s `testTimeout` — stop evicting unrelated PRs from the merge queue (#4850)

`packages/spec/vitest.config.ts` never set `testTimeout`, so every case in the
package ran under vitest's **5000ms** default. Twelve tests in `src/` load the
TypeScript compiler inside the case and type-resolve the whole export surface —
`ts.createProgram` + `getTypeChecker`, then unalias each symbol and chase
`originOf` — which is seconds of work by construction, not a hang:

```
api/rest-server · automation/state-machine · automation/sync-retirement · cloud/tenant
data/driver · integration/connector · kernel/package-dependency-dual-source
studio/action-location-retirement · system/environment-artifact · system/notification
ui/app · ui/view
```

Measured on an idle runner the slowest of these cases takes **3.4s** against a
5000ms budget — enough margin to stay green on a PR branch, and not enough on a
merge-queue runner building several PRs' batches at once. That is exactly the
observed signature: five failures in one night, all inside the queue, none on a
PR branch, each one evicting a PR that had nothing to do with `spec` (#4755,
#4788, #4823, #4822 twice).

`testTimeout: 60_000` matches the value PR #4506 gave these same cases
case-by-case, but applied once at the config layer so all twelve are covered —
and so a thirteenth added later is covered on arrival instead of leaking through
the way the per-case list did. 60s is ~17x the slowest measured case, so it
absorbs queue contention without masking a genuine hang.

This is a **stop-the-bleeding** change, not a fix for the underlying cost: 88% of
those twelve files' test time is TypeScript compilation, ~39s of it, repeated per
run. Hoisting the export-surface resolution into a build-time artifact is tracked
separately in #4796, which stays open.

No runtime, schema or public API change — test configuration only.
