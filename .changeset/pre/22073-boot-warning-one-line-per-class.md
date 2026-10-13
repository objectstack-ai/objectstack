---
"@objectstack/cli": patch
"@objectstack/plugin-auth": patch
---

The startup banner prints one line per warning class, each warning appears once, and a localhost boot no longer warns that OAuth is unencrypted.

Clause-②: no

- **One line per class.** Flows that declare a trigger but are not bound are grouped by trigger type and reason, with the flows listed: `⚠ 8 flows declare a 'schedule' trigger but are NOT bound — disabled by deployment policy — … (OS_AUTOMATION_SCHEDULED_WORK_ENABLED is unset or not truthy), so no time trigger arms …: flow_a, flow_b, …`. Before, the full reason (up to ~650 characters) printed once per flow. The banner now shows the reason's first sentence; `--log-level debug` still streams each flow's full reason. A real binding failure, or a missing trigger, keeps its own line, worded as before.
- **Printed once.** *Boot diagnostics* no longer repeats the automation plugin's per-flow `… is NOT bound` and shadowed-flow warnings, which the banner's `Flows:` list already shows. Its header counts them instead: `(8 more already listed above)`. Every other boot warning replays exactly as before. A boot that fails before the banner still replays all of them.
- **OAuth on loopback.** `OAuth is served UNENCRYPTED: …` is logged at `info` when the issuer's host is loopback (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`), so it is not shown at the default `warn` level. It stays `warn` on a private or link-local issuer. The sentence and the transport rule are unchanged.
- ⛔ Nothing you author changes. Which flows bind, the scheduled-work switch, the transport rule, the service-automation warning an embedded host reads, and every public key, export and parameter are unchanged.
