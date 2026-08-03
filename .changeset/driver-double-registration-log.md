---
"@objectstack/objectql": patch
---

fix(objectql): a re-registered driver stops crying wolf, and a real name collision starts saying what it cost (#4773)

Every boot printed one line into `⚠ Boot diagnostics`:

```
WARN Driver already registered, skipping {"driverName":"com.objectstack.driver.sql"}
```

It was never an anomaly. The standalone `default` datasource is registered
twice, on two legs of one round trip, and traced end to end it is the **same
object instance** both times:

1. `DatasourceConnectionService.attemptConnect()` builds the default driver and
   registers it (`isDefault: true`), driven by `DefaultDatasourcePlugin.init()`;
2. that plugin republishes the instance it just read back out of the engine as
   the `driver.<name>` kernel service — the surface `os migrate` and serve's
   storage detection resolve the primary DB through — and
   `ObjectQLPlugin.start()`'s `driver.*` discovery loop bridges every such
   service into the engine, handing back the driver it already holds.

Nothing is decided and nothing is discarded, so `registerDriver` now reports
that at `debug`. A no-anomaly line on every single boot does not belong at
`warn`; it only teaches operators that `warn` means nothing.

The reason this is not a blanket downgrade: the same `warn` also covered the
case that genuinely matters — **two different driver instances claiming one
name**, where "skipping" silently drops one of two configurations (connection
string, pool, tenant scoping, capability set) while every query bound to that
name keeps working against the winner. The two are now told apart by object
identity:

- **same instance** → `debug`, nothing happened;
- **different instance under a held name** → still `warn`, now naming which
  configuration was KEPT and which was DISCARDED (with both versions) so the
  operator can tell what is actually in force;
- **same instance re-registered with `isDefault` while another driver holds
  that role** → `warn`, because the caller's intent is otherwise dropped in
  silence.

Registration behaviour is unchanged in all three cases — first registration
still wins. Only which of them is worth an operator's attention changed.
