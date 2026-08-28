---
"@objectstack/spec": minor
---

feat(spec): `IDataEngine`'s datasource-def contract catches up to the engine — `registerDatasourceDef` accepts `external.credentialsRef`, and `listDatasourceDefs` is declared (#12805)

Additive contract catch-up to declared-and-enforced engine reality (#12758),
the fourth datasource-lifecycle member under the 2026-08-25 #11833 ruling's
item-4 precedent. `registerDatasourceDef`'s parameter now admits the
`external.credentialsRef` secrets-store handle the engine has accepted and
retained since #12758 — before this, a caller typed against the published
contract was refused with TS2353 at the consumer seam for a value the runtime
keeps (the engine's own typecheck was green either way, parameter bivariance).
The new optional `listDatasourceDefs?(): EngineDatasourceDef[]` member is the
read-back of the same registry, declared so a `sys_secret` reference sweep
(#12804) can ask the engine "which code-declared datasources hold a handle"
through the `'data'` slot contract instead of naming the engine class or
re-declaring a consumer-local structural type (the #11833 pattern). Both
members share the newly exported `EngineDatasourceDef` shape and stay
optional — only engines that own a datasource registry answer. No runtime
change; existing `IDataEngine` implementers and callers are unaffected.
