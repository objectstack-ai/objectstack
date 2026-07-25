---
"@objectstack/runtime": patch
"@objectstack/cloud-connection": patch
---

fix(runtime,cloud-connection): multi-tenant seed replay covers every source, not just the first (#3453)

In multi-tenant deployments (enterprise `@objectstack/organizations`) a brand-new org
gets its own private copy of demo data by replaying the kernel's `seed-datasets` list
on the `sys_organization` insert. That list is meant to hold the union of every seed
source — every config-declared app AND every marketplace package — but two framework
traps (the same pair #3444 fixed for seed-summary) shrank it to just the first source:

- The standard `PluginContext` exposes `getService`/`registerService` but has NO
  `.kernel` handle, so `(ctx as any).kernel?.getService('seed-datasets')` always read
  `undefined`. Each source then saw "nothing registered" and overwrote the list with
  only its own datasets instead of extending it.
- `registerService` throws on a duplicate name, so the second source's re-register was
  swallowed by the surrounding try/catch — its datasets (and, for a config app, its
  replayer) silently lost.

Net effect: with two config apps, or a config app plus marketplace packages, a new org
replayed only the first app's seeds.

The fix mirrors #3444's seed-summary hardening: `seed-datasets` is now a single shared
array, registered once and mutated in place by every source through a new
`mergeSeedDatasets` helper that reads via the context's own resolver first. AppPlugin's
per-org replayer reads that live list at invoke time instead of a captured snapshot, so
it replays the full union — including datasets merged after its closure was built — and
the replayer itself is registered once and reused by later config apps.

Covered by seam-level unit tests (accumulation across app + marketplace sources; the
replayer reads the live union). True multi-tenant end-to-end coverage requires the
enterprise `@objectstack/organizations` plugin, which lives in the cloud repo.
