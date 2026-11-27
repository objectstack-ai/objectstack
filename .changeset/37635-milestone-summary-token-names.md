---
'@objectstack/plugin-audit': patch
'@objectstack/spec': patch
---

fix(plugin-audit): a milestone row written before its template gained a token reads its stored sentence, not a translation with a hole

Clause-②: no
Metadata-protocol: none

A fired milestone's activity row now also stores the names of every `{token}` its template held (`names` in the row's summary code). A reader whose language translates the milestone composes the translation only when each token it names either has the row's stored value or was in the template and empty; a token the app added to the template after the row was written, or one only the translation names, leaves the row's stored sentence in place, which has no hole. A row written before this change carries no names, so it composes only when every token of the translation has a stored value.

Also: the `{token}` pattern has one exported definition (`milestoneTokenRe`, `activity-summary-message.ts`) that the writer and the reader share; a read answers each milestone's translation once and reads each object's packaged base once, instead of once per row; and two `@objectstack/spec` doc comments on `scalarOverridesPackagedBase` now name the five scalars it is asked about.
