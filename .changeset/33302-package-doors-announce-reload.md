---
'@objectstack/runtime': patch
---

fix(runtime): the package install and enable routes announce `metadata:reloaded`, so a package they bring into service is re-read without a restart

Clause-②: no
Metadata-protocol: none

`POST /api/v1/packages` and `PATCH /api/v1/packages/:id/enable` registered a package or put it back into service, but announced nothing to the running kernel. The `metadata:reloaded` subscribers therefore missed both routes until the next restart. One of them is `plugin-security`'s `renamedFrom` carry, so the holders of a position the package renamed stayed on the old name. The other subscribers are the automation engine's flow re-sync and the authored hooks, actions and translations. Both routes now announce `metadata:reloaded` with `changed: ['app/ID']`, the same spelling the marketplace install-local route uses, once the registry holds the package. The install route announces every install that lands, including one whose `enableOnInstall` switch is refused. The enable route announces only when the package was disabled, because enabling a package that is already enabled changes nothing it serves. A subscriber failure does not fail the request: the route still answers as before, and the failure is logged once at `warn` with the restart that repairs it.
