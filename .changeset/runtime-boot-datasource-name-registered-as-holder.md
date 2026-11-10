---
'@objectstack/runtime': patch
---

fix(runtime): a datasource name two packages of one boot declare is registered as the declaration of the package that holds it

Clause-②: no
Metadata-protocol: none

One identity per datasource name in an environment. When two packages composed into one boot declare the same datasource name, the metadata registration of that name is the declaration of the package that holds it: the package whose declaration opened the connection serving the name, or, when no connection is open under it, the first package to declare it. The other declarers' declarations of that name are not registered. Setup → Datasources therefore lists the configuration that serves the name, and the install door names that same package when a later install declares the name. The registration follows the connect verdict: when the first declarer's connect fails and a later declarer's opens the name, the later declarer's declaration is the one registered. Which connection serves the name, the boot's error line naming both packages, the install door's rule and the rehydrate path are unchanged. A single package, and a package that declares its own datasource twice, register as before.
