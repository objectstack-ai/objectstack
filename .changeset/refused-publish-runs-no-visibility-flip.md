---
'@objectstack/runtime': patch
---

fix(runtime): a refused package publish no longer unhides the package's app

Clause-②: no
Metadata-protocol: none

`POST /packages/:id/publish-drafts` clears the ADR-0045 `_unpublished` gate on the package's apps after the publish, and it did so whatever the publish answered. A batch refused before anything was promoted, or rolled back at a later draft, still came back with `unhiddenApps`, stored the app `_unpublished: false` and announced it, so an app the operator kept hidden showed up in every launcher after a publish that reported nothing had taken effect (ADR-0067 D2: "no partial visibility flip").

The flip now runs only when `outcome` is `published`, or `nothing_to_publish` (a materialized build with no drafts, where the flip is the publish). A `refused` answer, an outcome the declaration does not name, and an answer with no `outcome` flip nothing: the app stays hidden, `unhiddenApps` is absent and nothing is announced. Re-run the door once the refused item is fixed; it is idempotent. Publishes that refuse nothing behave exactly as before.
