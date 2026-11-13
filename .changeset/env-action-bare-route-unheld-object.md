---
'@objectstack/runtime': patch
---

fix(runtime): the bare action route serves the environment's own action declaration on an object no holder of the name binds

Clause-②: yes (widening)
Metadata-protocol: none

When two packages hold an action of one name on other objects (for example `account` and `contact`) and the environment has its own action of that name on a third object (`lead`), the bare route `/api/v1/actions/lead/NAME` answered that the action has no declaration. The route found the environment's item only through the first holder's exact address, and that address no longer serves a package-less copy (#32568).

FROM no declaration TO the environment's own action declaration, with no package, in either registration order. The route reads the environment's own item directly (its registry item and the environment's own stored row), never at a holder's exact address. An environment item with no object answers on `lead` too, and an item bound to `lead` comes before one with no object. Each holder's own route (`account`, `contact`) answers as before. A route that an enabled package's action binds answers that package's own action, as before. A route that a disabled package's action binds stays no declaration, which keeps main's answer there. So does a package-less item with no row in the environment's store (host or plugin code). A store read that fails answers 503 rather than no declaration.

This change serves the declaration. Whether a script-bodied action of that name then runs on a booted host is a separate binding question, tracked on its own.
