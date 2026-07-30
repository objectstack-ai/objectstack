---
"@objectstack/runtime": patch
"@objectstack/rest": patch
---

Advertise `mcp` in `/discovery` only when it is actually serveable (#4024).

Both discovery producers gated the `/mcp` route on `isMcpServerEnabled()` alone.
The stated justification was a lockstep — `os serve` auto-loads plugin-mcp from
the same flag, so on that path advertised did imply mounted. But the lockstep is
a property of the CLI, not of the dispatcher: `@objectstack/rest` has no
`@objectstack/mcp` dependency, mounts no `/mcp` route and performs no auto-load,
so a host that embedded it without plugin-mcp advertised `/mcp` in `/discovery`
and then answered 501 on it — the `declared ≠ enforced` failure #3369 forbids,
and a broken contract for third-party clients that read `/discovery` to decide
what exists.

Both producers now require the flag AND a serveable MCP service. The runtime
dispatcher gates on the handler's own predicate (`typeof
mcp.handleHttpRequest === 'function'`), so a wrong-shaped service can't
over-promise either. `@objectstack/rest` probes via the per-request kernel or the
single-env `serviceExistsProvider`; when it genuinely cannot probe it keeps the
prior flag-only answer rather than hiding a working endpoint (fail-open,
ADR-0057 D10). The `os serve` / `os dev` path is unchanged — it loads the plugin,
so the service resolves and `/mcp` is still advertised.

Also exercises the `mcp: false` seam in `route-parity.integration.test.ts`, which
had existed unused since the file was written: `bootServe()` was only ever called
with no args or `{ notification: false }`. The one capability whose advertisement
was not service-presence gated was also the one whose absence was never tested.
