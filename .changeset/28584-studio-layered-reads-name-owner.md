---
"@object-ui/app-shell": patch
---

Clause-②: no
Metadata-protocol: none

fix(app-shell): Studio and Setup read an item's layered view at the package that owns it

The layered view (`GET /meta/:type/:name/layers`) naming no package is refused `409 RESOURCE_CONFLICT` for a name two
installed packages hold, naming the holders and the `?package=` remedy. Reads in Studio and Setup still asked
it naming no package, so on such a deployment the list-view inspector, the Interfaces leaf and app, the Data pillar's
object, the Automations pillar's flow, the package OWD overview, the permission-set matrix, the embedded item editor and
the item page's reset, publish and discard re-reads failed, and the permission-set matrix read the refusal as "no set
known".

Each read now names the package the caller already reads and saves at: the Studio pillar's package (a read-only base's
own package, whose read serves its declared override), the permission matrix's package door, or the owner the edit
URL names (`?package=`). Where none is known, the read still names no package, and the server's refusal sentence is
shown as the load's error; the permission matrix no longer reads it as "no set known". No holder is picked on the
client.
