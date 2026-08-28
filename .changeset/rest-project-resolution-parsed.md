---
'@objectstack/rest': minor
---

**BREAKING (accept-set tightening)**: `RestServer` now parses `api.projectResolution`
against `RestApiConfigSchema` at construction, instead of `.omit()`ing it out of that
parse.

The exemption existed because `@objectstack/runtime`'s standalone stack shipped
`projectResolution: 'none'` — a value the declared enum has never contained — and
`os serve` forwarded it straight in. Because `RestApiConfigSchema` is a non-strict
object, omitting the key meant the undeclared value arrived, was silently stripped as
an unknown key, and took `'auto'`'s branch by fallthrough, while the discovery handler
copied it verbatim into `discovery.scoping.resolution` — publishing a payload the
platform's own `DiscoverySchema` rejects, on every boot. #11999 (PR #12444) settled the
disagreement by migrating the producer onto the declared `'auto'`; this change withdraws
the exemption it justified.

**What changes for a caller:** `api.projectResolution` must now be one of the three
values the schema has always declared — `'required'`, `'optional'` or `'auto'`. Anything
else, `'none'` included, is refused at construction with a message naming the key. A
census of every `projectResolution` value in this repo found exactly those three plus
the retired one, and the retired one now survives only inside assertions that it is no
longer emitted — so no in-repo boot path is affected.

If a config of yours is refused, correct the value at its producer. Do not re-add the key
to the `.omit()`: a strategy outside the enum is wrong where it is written, not where it
is read.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed or renamed: `RestApiConfigSchema` is untouched, its enum has carried the same three members throughout, and no spec key, export or config field changes spelling. There is also no old declared spelling for the ledger to name — a conversion entry rewrites a previously-LEGAL authorable value into its new one, and `'none'` was never declared; it was accepted only because this seam skipped the parse, so `objectstack migrate meta` has nothing to rewrite. And no conversion could decide it: `'none'` read as "no scoping at all", which is the `enableProjectScoping` switch rather than the strategy, so the producer's own migration to `'auto'` (#11999) rests on an analysis that holds only when scoping is OFF — every reader short-circuits on that flag first. A third-party config that wrote `'none'` WITH scoping enabled states an intent no mechanical rewrite can pick between, exactly as with the `api.version` refusals this seam already carries. Nor is the ledger the only channel that reaches an upgrader here, which is the D7 discriminator: unlike a runtime interface with no metadata surface, this value now meets a loud schema rejection at construction naming the key and the declared rule. -->
