---
"@objectstack/rest": minor
"@objectstack/client": patch
---

fix(rest,client)!: reconcile the two REST↔client mismatches the #3587 audit
ledgered (#3610, #3611)

**#3610 — `POST /api/v1/packages` publish-vs-install collision.** The REST
package registrar claimed the bare `POST /packages` for *marketplace publish*
(`{manifest, metadata}`), while the dispatcher packages domain gives the same
verb+path *install* semantics — and REST registers first in the production
stack (first-match-wins), so every `client.packages.install` call landed on
the publish handler and 400'd. Marketplace publish moves to
`POST /api/v1/packages/publish` (breaking for direct callers; a repo-wide and
objectui-wide sweep found zero). The dispatcher's `POST /packages/:id/publish`
(ADR-0033 draft publish) is two segments — different shape, no clash. The
dispatcher already writes both stores on install (`protocol.installPackage`)
and fully uninstalls on DELETE (`protocol.deletePackage`), so the remaining
REST GET/GET/DELETE shadows stay — they are compatible.

**#3611 — UI view dialect split.** `meta.getView` spoke the `?type=` query
dialect that only the dispatcher `/ui` domain understands; the REST surface
mounts only the path form `/ui/view/:object/:type`, so the query form 404'd
wherever REST serves (e.g. project-scoped bases). The client now sends the
path form both surfaces accept; a URL-pinning test keeps it that way.

REST route ledger updated: the two `mismatch` rows are resolved (packages
publish row is `server-only` publisher tooling; the ui row flips to `sdk`).
The ledger now carries zero mismatches.
