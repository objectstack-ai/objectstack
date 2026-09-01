---
"@objectstack/rest": minor
---

fix(rest): the shipped `objectQLProvider` stops collapsing "the engine is wired and broke" into "no engine is wired" (#13904)

Runtime behaviour change on a public REST door, shipped as `minor` under the
repo's launch-window convention — the same convention the #13476 family's
changeset (`engine-unresolvable-fails-loud.md`, PR #13910) and #13279's name
for the identical class of change on this same door. This change additionally
moves one row refused → served (a factory-registered engine now resolves and
serves), so it sits strictly inside the class that convention governs.

`rest-api-plugin.ts` handed `RestServer` an engine provider shaped
`try { return ctx.getService('objectql'); } catch { return undefined; }`. The
sync accessor throws for three distinguishable registry facts — never
registered (the supported no-data-plane embedder), registered as a factory
(wrong accessor for it), and a registration that failed to build — and the
catch-all answered all three with the `undefined` the seam contract reads as
"no engine is wired". So the #13476 transport repair (`wiredEngineOrLoud`,
which turns a provider REJECTION into the loud 503 outage) never fired on the
shipped single-kernel wiring: the provider absorbed one layer before the seam
could see the fact.

The provider now resolves through `kernel.getServiceAsync` →
`PluginLoader.getService` and absorbs ONLY the branded "never registered"
rejection (`isServiceNotRegisteredError`, #13905) — the registry's own
classification, never message text, closed set, loud default. Observable
changes, all in the wired-single-kernel deployment:

- an embedder that never wired a data plane keeps its quiet answer, unchanged
  and pinned (403 at the package door, as before);
- an engine registered as a service FACTORY now actually resolves and serves
  (previously the sync accessor could only throw `is async - use await`, read
  as "no engine": the door refused a wired, constructible engine);
- an engine whose registration FAILS TO BUILD now rejects loudly, so the door
  answers 503 `SERVICE_UNAVAILABLE` instead of telling an authenticated
  administrator they lack a capability.

A KernelBase-shaped host (`LiteKernel`, no async accessor, no factories) keeps
both of its answers byte-identically through the sync fallback leg.
