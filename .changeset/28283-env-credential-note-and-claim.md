---
'@objectstack/service-datasource': patch
---

fix(service-datasource): an unset env credential is a note after the driver's error, and a failed connect holds no claim on its variable (#28283)

Clause-②: no
Metadata-protocol: none

Two corrections to the code-defined datasource's env-credential slot (`OS_DATASOURCE_<NAME>_PASSWORD`, #27687):

- **The driver's error explains the failure.** When a code datasource's connect failed with the variable unset, the reason read `<driver error> — datasource 'x' is defined in code and reads its credential from OS_DATASOURCE_X_PASSWORD at connect, which is not set on this host` for every failure, so an unreachable host, a missing driver module or a TLS failure read as a missing password. The sentence is now a trailing note: `<driver error> (note: datasource 'x' is defined in code and reads its credential from OS_DATASOURCE_X_PASSWORD at connect, which is not set on this host)`. A login refusal still names the variable to set. The reason is operator-facing text (the connect verdict, Setup → Datasources, the fail-fast boot message); no code or status changes.
- **A failed connect releases its variable.** The guard that refuses two datasources deriving one variable recorded the owner before the build and released it only on `disconnect`, so a connect that failed kept it and a later datasource deriving the same variable was refused as a collision against one that never connected. The connect that claimed the variable now releases it when it fails. Two datasources that are both live are still refused.
