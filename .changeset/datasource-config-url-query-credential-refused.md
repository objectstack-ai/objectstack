---
"@objectstack/spec": minor
"@objectstack/service-datasource": patch
---

feat(spec): refuse credential-bearing URL query parameters (`?authToken=` / `?password=`) in authored driver config at publish (#8337)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

The third spelling of the same secret: #7990 refused the inline credential
keys, #8082 refused the URL userinfo form (`user:password@host`), and the
query string stayed open — `libsql://x.turso.io?authToken=eyJ…` persisted the
JWT cleartext into `sys_metadata` (served back by the ordinary data API) and,
measured against the clients this tree pins, actually authenticates:
`@libsql/core@0.17.4` assigns the URL's `?authToken=` OVER the config-level
token — so the workaround also silently defeated the binder-injected secret —
and `pg-connection-string@2.14.0` copies every query parameter into the client
config, `?password=` winning over userinfo.

**What is refused** (write door, shared value-level parse
`urlCredentialQueryParams` beside #8082's `urlUserinfoPassword`): turso
`config.url` / `config.syncUrl` carrying `?authToken=`, postgres `config.url`
carrying `?password=` — matched case-insensitively on the percent-decoded key,
non-empty values only, with the #8082-template prescription (datasource secret
binder / `external.credentialsRef`; runtime-environment DSNs are unaffected).
mysql and mongo URLs are deliberately NOT narrowed: both clients were measured
ignoring `?password=`, so refusing it would widen past the measured defect.

**What stays accepted:** every credential-free URL byte-identically, benign
query parameters (`?tls=`, `?sslmode=`, …) included, and the parameter-absent
shape the read path serves — which keeps an untouched "Save" on a legacy row
working.

**Read half** (the same PR, per the card): `redactDatasourceConfig` /
`getDatasource()` now strip credential query parameters from served URLs for
every driver (new `redactUrlCredentials` / `redactUrlCredentialQueryParams`
exports), `restoreRedactedConfig` mirrors the composite so an untouched
round-trip keeps the stored token, and the credential-migration planner
refuses a query-token row with the per-row remedy instead of planning
`nothing-to-migrate` over cleartext.

## FROM → TO

```yaml
# before — parsed green; JWT stored cleartext in sys_metadata, and at connect
# it silently overrode the binder-injected secret
driver: turso
config:
  url: libsql://app-org.turso.io?authToken=eyJhbGciOiJFZERTQSJ9.x.y

# after — rejected with the binder prescription; bind the secret instead
driver: turso
config:
  url: libsql://app-org.turso.io
external:
  credentialsRef: sys_secret:01J9ZK4T2N   # or the connection form's secret field
```

There is deliberately no automatic rewrite: moving the value requires
encrypting it into `sys_secret` through a running secret binder, which a
source-file transform cannot do — stripping the parameter alone would silently
drop a live credential.

<!-- adr-0087: registered datasource-config-url-query-credential-refused -->
