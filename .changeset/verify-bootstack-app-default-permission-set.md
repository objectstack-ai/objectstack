---
"@objectstack/plugin-security": minor
"@objectstack/verify": minor
"@objectstack/cli": patch
---

fix(verify,plugin-security,cli): `bootStack` honours the app-declared default permission set, like `serve` always did (#7001)

Two boot paths disagreed about whether an application's declared default
permission profile exists.

- **`objectstack serve` honoured it** — it read the permission set marked
  `isDefault: true` off `config.permissions` and passed the name as the
  `SecurityPlugin` `fallbackPermissionSet`.
- **`bootStack` did not** — `@objectstack/verify` constructed a vanilla
  `new SecurityPlugin()` and never read `config.permissions` at all.

So the profile an app declares was in force when a human ran the CLI and
silently absent when the app's own suite booted it: a `declared ≠ enforced`
split inside the harness that exists to catch that split. Green tests,
different production behaviour.

It was invisible until #5491. Until then the platform's `member_default`
carried an `object_permissions['*']` wildcard, so a member with no application
profile reached every object anyway and the declared fallback was never
load-bearing. #5491 removed that floor deliberately and its Migration section
prescribes exactly one consumer action — ship an app default profile via
`isDefault: true` — which `bootStack` had no way to express. Measured in
cloud's `ee-group-showcase`, adding the prescribed profile changed nothing: the
same acceptance cases still failed at the object gate.

**What changed.** The resolution now lives in one place and both boot paths call
it: `appSecurityPluginOptions(config)`, new in `@objectstack/plugin-security`
next to the existing `appDefaultPermissionSetName`. It answers the question a
booter actually has — *what do I hand the `SecurityPlugin` constructor for this
config* — rather than just the name, because the second half
(`name ? { fallbackPermissionSet: name } : undefined`) is a decision, not
formatting, and while `serve.ts` had open-coded it, `bootStack` had simply never
grown one. `serve.ts` is converged onto the same helper, so the two now agree by
construction rather than by each caller remembering.

**Behavioural change, `@objectstack/verify` only.** `bootStack(config)` on an
app that declares an `isDefault` permission set now boots with that profile as
the additive per-request baseline (ADR-0090 D5), matching `objectstack dev`. An
app that declares no such set is unaffected — the resolution yields `undefined`
and the plugin keeps deriving `member_default` from its built-in sets, exactly
as before.

A suite that deliberately wants the platform's own baseline over an app that
declares a default now says so: `bootStack(config, { security: new SecurityPlugin() })`.
A plugin passed in `opts.security` still wins whole and is never merged into —
it arrives carrying its own constructor options, and silently rewriting one of
them would be a worse surprise than the bug being fixed.

Measured blast radius across the framework's own suites: of 86 dogfood files and
524 tests, exactly one assertion moved — `me-apps-and-everyone-baseline`, which
asserts the bootstrap binds `member_default` to the `everyone` anchor and whose
header already read "Deliberately VANILLA". That dependence was real but silent,
expressed only by the harness default; it is now stated in the argument. The
showcase fixtures that needed the app profile were already hand-wiring a
`SecurityPlugin` for it (`test/showcase-security.ts`, added by #5491) — the
"custom security code" these dogfood apps exist to prove unnecessary — and are
unchanged by this release.
