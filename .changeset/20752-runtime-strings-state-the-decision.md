---
'@objectstack/runtime': patch
---

Runtime refusals, boot errors and warnings no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Strings `@objectstack/runtime` shows to callers, authors and operators pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- The enablement refusal (`POST /actions/_activation/:object/:action`) adds that the switch is not scoped to the caller's organization, which is why `manage_metadata` gates it.
- The doubled post-success navigation warning (`[action-contract]`) says the contract refuses a pair of destinations rather than ranking them, and that "declared `onSuccess` wins" is the console renderer's interim precedence, not a contract.
- The legacy database notice says `dev`, `start` and `migrate` now share one default database file.
- The `BodyRunner` warning for a `log` capability with no logger says the capability writes only to the factory's logger, never to `console`.
- The seed tenancy handoff warning says what a failure leaves behind: seed and API writes on separate autonumber counters until the next boot's migration repairs it.
- The auth forwarder's sanitised-500 log line says the client's message was withheld unconditionally and that this line is where the original error is read.
- The `StandaloneStack` guard for a driver kind with no dispatch arm says falling through to SQLite would hand the caller an engine they never selected.
- The `StandaloneStack` refusals for an unsupported or URL-less database driver, the declarative-endpoint hints, the `cacheTtlSeconds` warning and the two other `BodyRunner` warnings drop their citations; each already said what it refuses and why.

Text only: no status, error code, field, route, export or control flow moves. A log filter or test that matched the old text (for example a `See #NNNN` suffix) needs the new spelling.
