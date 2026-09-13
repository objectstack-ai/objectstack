---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

refactor(runtime,mcp): the last two admission doors classify the `tenancy` rejection through the shared `classifyAdmissionTenancyPosture` (#17114)

`@objectstack/core`'s `classifyAdmissionTenancyPosture` is the one place the
#13906 decision 1 option A classification lives: a branded "never registered"
rejection is the supported no-tenancy composition and answers a quiet
`undefined`, while every other rejection becomes
`AuthzStoreUnavailableError('tenancy', err)` — ADR-0112 `SERVICE_UNAVAILABLE` /
503 — because the posture is an authorization INPUT and admission was never
decided.

Two admission doors were still hand-writing that classification, out of the
declared scope of the fold that extracted it:

- `@objectstack/runtime`'s `resolveExecutionContext` — the REST/dispatcher
  entry-point identity resolver;
- `@objectstack/mcp`'s `resolveStdioTenancyPosture` — the stdio door's **async
  kernel** leg.

Both now call the shared function. ⛔ **No behaviour changes at either door.**
Tenancy posture decides which rows a caller may see, so a divergence between
copies would be two answers to "whose data is this", and the copies are the
stale ones by construction — the shared version is the one that will be
maintained.

**The resolution stayed at each seam, deliberately.** The extractable part is
the classification, not the resolution: each door keeps its own accessor guard
and hands its own former accessor expression in as the thunk, so the helper
never learns *how* a seam reaches the service. A helper that owned the wiring
too would be wrong for one seam or grow a flag per seam.

**One neighbouring leg is deliberately NOT folded.** The stdio door's **sync**
fallback is taken only on a `KernelBase`-shaped host with no `getServiceAsync`,
whose accessor reports its one possible fault — nothing registered under that
name — **unbranded**. Routing it through the shared classification would mint a
503 outage out of a supported composition, so its bare `catch` remains that
seam's recorded decision. A test arm now fails if that leg is ever folded.

Shipped rather than `skip-changeset`: both packages publish `files[]: ["dist"]`,
and the built `dist` of each carries the new call (2 files each, measured after
a real build, with a symbol known-absent scoring 0 and
`isServiceNotRegisteredError` scoring 4 in `runtime/dist` as the lit control).
`@objectstack/mcp`'s `dist` no longer mentions `isServiceNotRegisteredError` at
all.
