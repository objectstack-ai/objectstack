---
"@objectstack/service-automation": patch
---

fix(service-automation): a stored connector with a configuration fault never stops the platform starting

A provider-bound connector saved in the environment (through the metadata door or Studio, environment-wide or in an `authored` package) that later stops being valid, for example because the plugin offering its provider was removed, stopped the next start of the platform. The same fault met while the platform runs only skipped that connector.

Clause-②: no — no accepted value and no public surface changes: the same stored definitions are refused as before; a start now carries on past them instead of stopping.

Metadata-protocol: none

- **Before.** At start, any configuration fault of a stored connector (a provider no installed plugin offers, a host credential resolver that throws, a name a plugin connector already holds, a configuration its provider refuses) stopped the start. Only a refused package-relative ref was skipped.
- **Now.** Every configuration fault of a stored connector takes the path it takes while the platform runs: it is logged with the same record, that connector is not served, and the host's own connectors beside it serve. A connector the host's own stack declares, and an installed package's, still stop the start on a configuration fault, as before.
- **Not covered here.** A stored connector that takes a name a plugin connector registers later in the start is a separate card.
