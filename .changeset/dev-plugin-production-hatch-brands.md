---
"@objectstack/plugin-dev": patch
"@objectstack/types": minor
---

fix(plugin-dev,types): the production escape hatch stops being silent (#3900)

`DevPlugin.init()` refuses to run under `NODE_ENV=production` (ADR-0115 D6), and
`OS_ALLOW_DEV_PLUGIN` overrides that refusal. As shipped, the override returned
early with **no output at all**: the process ran the development assembly while
every log line and the ready banner read like an ordinary production start.

That reproduces, one level up, the defect the guard exists to close. The guard's
own precedent says so — `OS_ALLOW_DEGRADED_TENANCY` boots degraded *and brands
it everywhere an operator looks*, and `OS_ALLOW_DRIVER_CONNECT_FAILURE`'s
contract is "logged loudly at startup". An escape hatch that says nothing leaves
the operator's only evidence of a degraded state in an env var they may not have
set themselves.

**The override now brands itself, twice.** A warning at `init()` — emitted
before any assembly work, so it survives an assembly step that later throws —
and a repeat on the ready banner, which is the surface an operator actually
reads:

```
⚠ DEV ASSEMBLY UNDER NODE_ENV=production (OS_ALLOW_DEV_PLUGIN is set) — the boot
  guard was explicitly overridden. This process is running the DEVELOPMENT
  assembly, which is not hardened for production traffic (ADR-0115 D6).
    • Auth secret is the default published inside @objectstack/plugin-dev. It is
      public, so anyone can mint a session this stack accepts. Pass `authSecret`
      explicitly.
    • Data goes to the in-memory driver with persistence disabled — every record
      is lost when this process exits.
```

Only hazards that are live for *that* configuration are named: the secret line
is suppressed when the operator passed their own `authSecret`, and the driver
line when the `driver` toggle is off. The dev-admin seed is deliberately absent
— `plugin-auth`'s `maybeSeedDevAdmin` is hard-gated to
`NODE_ENV === 'development'` and cannot fire on this path, so warning about it
would spend the attention the real hazards need.

**New export — `resolveAllowDevPlugin()` (`@objectstack/types`).** The flag moves
off a bare `process.env['OS_ALLOW_DEV_PLUGIN'] === '1'` and joins the
`OS_ALLOW_*` family's shared truthy vocabulary, next to
`resolveAllowDegradedTenancy` / `resolveAllowDriverConnectFailure`.

FROM → TO for operators: `OS_ALLOW_DEV_PLUGIN=1` keeps working unchanged.
`OS_ALLOW_DEV_PLUGIN=true` (and `on` / `yes`, case-insensitive, surrounding
whitespace ignored) **now takes effect** where the strict comparison previously
ignored it and failed the boot. That is a widening, in the direction an operator
setting the flag already intended; falsy and unrecognised values still refuse to
boot, and unset still means "fail fast". If you were relying on
`OS_ALLOW_DEV_PLUGIN=true` being inert as a way to keep the guard armed, unset
the variable instead.

No change to the refusal path, which this issue re-verified end to end:
`kernel.use()` only registers, `initPluginWithTimeout` does not catch,
`bootstrap()` rethrows, and `os serve`'s outer handler prints the message and
exits `1`. The `throw` is genuinely fatal here, so it needs none of the
`process.exit(1)` the tenancy guard required for sitting inside a broad `catch`.
