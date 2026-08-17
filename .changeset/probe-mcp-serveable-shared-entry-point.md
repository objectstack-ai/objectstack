---
"@objectstack/rest": patch
---

fix(rest): `/discovery`'s `mcp` advertisement follows the request's environment — `probeMcpServeable` routes through the shared resolution entry point (#9120)

`RestServer.resolveRequestEnvironmentId` calls itself, in its own doc-comment,
"THE single entry point for every unscoped-route environment decision (protocol,
i18n, exec-ctx, analytics, …) so they can never disagree about which kernel a
request belongs to." Eight consumers go through it. `probeMcpServeable` — the
ninth site that needs the request's environment, and the one whose answer decides
whether `/discovery` advertises `routes.mcp` — re-derived its own:

```ts
let environmentId: string | undefined = req?.params?.environmentId;
if ((!environmentId || environmentId === ':environmentId') && this.defaultEnvironmentIdProvider) {
    try { environmentId = this.defaultEnvironmentIdProvider() || undefined; } catch { /* ignore */ }
}
```

That is the shared chain minus its first and middle steps: the host's ADR-0006
`kernel-resolver` seam (wired through `RestRequestEnvResolver`), and the legacy
hostname / `X-Environment-Id` chain beneath it.

**Single-environment boots were correct throughout** — there
`defaultEnvironmentIdProvider` is registered, and it is also step 3 of the shared
chain, so both spellings agreed. The defect is multi-tenant-only: on a
hostname-routed host an unscoped `/discovery` request carries no
`params.environmentId`, and no default provider is registered (that is
`createSingleEnvironmentPlugin`'s wiring). Neither input the probe read was
present, so it fell through to `serviceExistsProvider` — which answers for the
**host** kernel, not the request's environment. Both misadvertisement directions
were reachable, and are now pinned as regression tests:

- the host kernel has `mcp` and the request's environment does not ⇒ `/discovery`
  advertised `routes.mcp` for an environment whose `/mcp` answers 501 — the
  `declared ≠ enforced` shape the probe was added to close;
- the host kernel lacks it and the environment has it ⇒ the route was withheld
  from an environment that would have served it (`mcpServeable !== false` fails
  open only for a `null` probe, never for a confident `false` computed against
  the wrong kernel).

The probe now calls `resolveRequestEnvironmentId` like its eight siblings. The
`'platform'` guard and the `serviceExistsProvider` fallback are unchanged, and
the unsubstituted `':environmentId'` route pattern is normalised to "no id"
before the call — the entry point short-circuits on any truthy explicit value,
so passing the pattern through would have sent it to `getOrCreate`. This also
makes good the parity the probe's doc-comment already claimed with
`resolveRegisteredServices`, whose kernel arrives as `ctx.__kernel` — set
downstream of the same entry point.
