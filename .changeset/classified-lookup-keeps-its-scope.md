---
"@objectstack/runtime": patch
---

A scoped service that has no instance for your environment no longer answers as if you had forgotten to name one.

`HttpDispatcher`'s classified service lookup — the read behind the identity step, the `POST /keys` mint gate, the install-wide activation write and `POST /automation/:name/toggle` — took the scope it was handed, missed on it, and then re-resolved on the request's own kernel **without** that scope. A service registered `ServiceLifecycle.SCOPED` and resolved without a scope id is rejected by the plugin loader with `Scope ID required for scoped service '<name>'`, and that rejection is not the branded "never registered" the lookup absorbs — so it was re-raised, and each of those four doors answered `503 SERVICE_UNAVAILABLE` on a deployment where nothing was unwell. A caller that passed its environment correctly was told it had passed nothing.

Concretely: a `tenancy` factory that serves one environment and legitimately returns `undefined` for another made every one of those four doors fail for the second environment — no API key could be minted, no activation switch flipped, and the identity step itself raised the outage.

- **The scope now travels with every leg of the chain**, which is what the leg before it and the fallback tail already did. Nothing else about the resolution order changes: which registry answers is unchanged, only whether it is asked the question the caller actually asked.
- **The lookup tells its three answers apart.** "Nothing was ever registered under this name" and "this name is registered and produced no instance in the scope you passed" are two different facts. They still license the same quiet `undefined` at the door — a factory that returns `undefined` for a scope has *answered*, so it is an absent fact rather than an unread one, and ADR-0093 D4/D5 reads a scope with no tenancy service the way it reads a deployment with none — but they are no longer the same answer inside the lookup.
- **The loader's message is untouched, and so is the caller it is about.** A door that really resolves a scoped service without a scope still receives `Scope ID required for scoped service '<name>'` and still answers 503. That direction is pinned explicitly, because an implementation that answered every scoped miss with `undefined` would fix the misattribution by deleting a correct diagnostic.

No exported type changes: `DomainHandlerDeps.resolveServiceOrLoud` keeps its signature and keeps answering the service or `undefined`.
