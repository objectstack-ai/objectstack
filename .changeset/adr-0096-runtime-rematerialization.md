---
'@objectstack/service-automation': minor
---

feat(connectors): ADR-0096 runtime re-materialization of declarative connectors (#2977 follow-up)

Provider-bound declarative `connectors:` instances (ADR-0096) previously
materialized only at boot — a connector published from Studio while the server
ran did not become dispatchable until a restart. `materializeDeclaredConnectors`
is now a **reconcile** run both at boot and on `metadata:reloaded`:

- **Add** newly-declared instances, **tear down** removed / newly-`enabled:false`
  ones (calling their `close`, e.g. an MCP connection), and **re-materialize**
  only instances whose signature — a stable hash of `provider` + `providerConfig`
  + `auth` + identity — changed. An unchanged MCP instance is never needlessly
  reconnected on an unrelated metadata reload.
- **Boot stays fatal** ("fail loudly"): unknown provider / invalid providerConfig
  / unresolvable credentialRef / name conflict aborts startup. **Reload is soft**:
  the same problems are logged and the offending entry skipped, so a bad publish
  never crashes a running server; a changed instance's old connector keeps
  serving until its replacement materializes successfully.

Also: `ConnectorDescriptor` (served by `GET /api/v1/automation/connectors`) now
carries an `origin` field (`'plugin' | 'declarative'`), so a designer can
distinguish a materialized declarative instance from a plugin-registered
connector.
