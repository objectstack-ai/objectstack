---
'@objectstack/runtime': patch
---

fix(runtime): a boot that composes two packages declaring one datasource name logs one error naming both, and continues

Clause-②: no
Metadata-protocol: none

One connection serves a datasource name. When two packages composed into one boot declare the same name, the connection opened from the first declaration to connect serves it, and the other package's objects bound to the name are served by that connection. The boot says so once per name, at error level, naming the datasource name, the package that holds it and the other package, with the fix: rename the datasource in one of the packages, or remove one of them from the composition, and restart. The line carries no connection configuration. The boot is not refused, and which connection serves the name is unchanged. A package that declares its own datasource twice, or is composed twice, is not a clash and logs nothing.
