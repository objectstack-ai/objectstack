---
'@objectstack/runtime': patch
---

fix(runtime): the bare action route serves the environment's own action on an object no holder of the name binds

Clause-②: yes (widening)
Metadata-protocol: none

When two packages hold an action of one name on other objects (for example `account` and `contact`) and the environment authors its own action of that name on a third object (`lead`), `POST /api/v1/actions/lead/NAME` answered that the action has no declaration, so the environment's action could not run there. It used to run only because the route borrowed the first holder's exact address, which no longer serves a package-less copy (#32568).

FROM no declaration TO the environment's own action, with no package, in either registration order. The route reads the environment's own item directly (its registry item and the environment's own stored row), never at a holder's exact address. Each holder's own route (`account`, `contact`) answers as before. A route that a package's action binds, a disabled package included, stays no declaration. So does a package-less item with no row in the environment's store (host or plugin code). A store read that fails answers 503 rather than no declaration.
