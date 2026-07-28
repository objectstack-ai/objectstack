---
"@objectstack/service-datasource": minor
"@objectstack/objectql": minor
"@objectstack/rest": patch
"@objectstack/runtime": patch
---

feat(datasource): a datasource that is down is visible, and says why when queried (#3827, #3828)

#3816 made an explicitly-bound datasource that cannot connect refuse the boot. Two
gaps survived that fix, both in the cases that still boot — a policy denial, an
`autoConnect` datasource, or any failure the operator waved through with
`OS_ALLOW_DRIVER_CONNECT_FAILURE`:

- **It was invisible.** `DatasourceSummary.status` was the literal `'unvalidated'`
  for every row — the contract declared three states and the implementation only
  ever emitted one — so a dead datasource looked exactly like a healthy-untested
  one. `checkDriversHealth()` could not help either: it iterates registered
  drivers, and a datasource that never connected was never registered, so it is
  *absent* from the probe rather than unhealthy. The only trace was a warning
  that scrolled past at boot, which made the diagnostic procedure "restart the
  server and re-read the logs".
- **The query-time error said nothing.** `getDriver()` answered four different
  situations with one sentence, `Datasource 'x' is not registered.`: refused by
  policy, failed to connect under the escape hatch, a misspelled name, and
  `active: false`. Only the third is an authoring bug, so the other three sent
  the reader hunting for a typo that does not exist.

Both come from the same root: `connect()` already produced a `ConnectResult` for
every attempt and every caller threw it away.

- **`DatasourceConnectionService` retains the last verdict per datasource**, with a
  coarse `availability` (`available` / `blocked` / `failed` / `unattempted`) beside
  the raw status. New `getConnectionState(name)` / `listConnectionStates()`.
  `disconnect()` drops it, so a removed pool stops explaining itself.
- **`DatasourceSummary.status` tells the truth**: `ok` | `error` | `blocked` |
  `unvalidated`, with a new operator-facing `statusReason`. `blocked` is new and
  deliberate — a policy denial is a decision, not a fault, and will not clear on
  its own. Reported in **Setup → Datasources**, `GET /api/v1/datasources`, and the
  summary returned from create/update, so a "Save" whose pool failed to open is no
  longer presented as success.
- **`ERR_DATASOURCE_UNAVAILABLE` (HTTP 503)**: new `DatasourceUnavailableError`
  from `@objectstack/objectql`, thrown by `getDriver()` when the connection layer
  recorded *why* a declared datasource has no driver. An undeclared name keeps the
  original message — there is genuinely nothing to add. 503 rather than 500/400:
  nothing about the request is wrong, and the state may clear.
- **A privileged/public split for the reason.** The error **never** carries the
  underlying cause — connect failures routinely contain hosts, ports and DSNs, and
  a policy's `reason` is written for operators. Those stay in the logs and the
  (admin-gated) datasource list. `DatasourceConnectDecision` gains an opt-in
  `publicReason` for hosts that want to tell tenants something specific
  (e.g. `'External datasources require the Scale plan.'`); it is the only string
  that reaches an end user.
- **Readiness is deliberately not gated on this.** `/ready` still reflects
  registered-driver health only: an optional datasource being down must not pull an
  otherwise-working replica out of the load balancer.

Also lands a drift guard for **#3826**, and corrects ADR-0062's status while doing
it. The ADR claimed D1 ("exactly one definition → live driver path") as
implemented; only the *construction* half converged. The `default` driver is still
registered as a `driver.*` kernel service and connected by `ObjectQLEngine.init()`,
with its own failure verdict, pool teardown, and no connect policy. What blocks the
merge is an input-shape mismatch, not ordering: `connect()` takes a datasource
*definition* and builds the driver, while `default` arrives pre-built, and routing
it through the service would make `ObjectQLPlugin`'s boot depend on an optional
higher-layer service. Until that is designed, `degraded-boot-parity.test.ts` pins
both paths to the same operator-visible contract (fail-fast by default, identical
`OS_ALLOW_DRIVER_CONNECT_FAILURE` parsing, `DEGRADED BOOT` on stderr) so a change
to one that forgets the other fails CI — #3741 → #3758 was exactly that miss, and
it cost three months and a second bug report.

**Migration.** Additive. `DatasourceSummary.status` gains a `'blocked'` member: a
consumer exhaustively switching on it needs a case (the admin UI shows it as a
distinct state). Nothing that was `'ok'` or `'error'` changes meaning; rows that
were reported `'unvalidated'` now report their real state. Query-time errors for a
datasource the connection layer recorded change from a generic `Error` to
`DatasourceUnavailableError` (503 instead of the previous catch-all status);
matching on the old `is not registered` text still works for the undeclared-name
case, which is the only one that was ever accurate.
