---
'@objectstack/spec': major
'@objectstack/plugin-auth': patch
---

refactor(auth)!: stop advertising `passkeys` / `magicLink` on `/api/v1/auth/config` — two flags nothing consumed (#7481, ADR-0049)

<!-- adr-0087: registered auth-config-unadvertised-reserved-features -->

**FROM → TO:** reading `config.features.passkeys` or `config.features.magicLink` off
`GET /api/v1/auth/config` → delete the read; both keys are gone from the payload and there
is no replacement flag. Neither capability was reachable by a user, so nothing a client
gated on them was ever offered. `AuthPluginConfig.plugins.passkeys` / `plugins.magicLink`
are **unchanged** — this narrows the served payload, not the server configuration.

Both flags were served from introduction and read by no client: no login UI anywhere
renders a passkey or magic-link affordance off them. So the payload advertised two sign-in
methods a user could never reach, and a deployer who set either plugin flag flipped a
switch with no observable effect — ADR-0049's enforce-or-remove, on a deployment-facing
contract. The maintainer ruled remove over keep-as-reserved on 2026-08-11: declared =
enforced, and a deployer must not be able to flip a flag that does nothing anywhere.

The two are not equally empty, and the prescriptions say so separately rather than sharing
one string:

- **`passkeys`** has nothing behind it at all — no better-auth passkey plugin is wired, so
  `/passkey/*` does not answer. There is no capability to detect.
- **`magicLink`** loses only its **advertisement**. `plugins.magicLink` still wires
  better-auth's magic-link plugin, and `/api/v1/auth/magic-link/send` + `/magic-link/verify`
  answer exactly as before — drive them from your own UI.

Both return to the payload in the change that ships the login UI (objectui#4179); until
then the standing record is `PUBLIC_AUTH_FEATURES_NOT_ADVERTISED` in
`kernel/public-auth-features.ts`, and their `PUBLIC_AUTH_FEATURES` entries — which pointed
at the now-closed objectui#2514 — are gone with them.

The retirement kit:

- **Tombstone, not deletion** (`retiredKey()`): `AuthFeaturesConfigSchema` is not
  `.strict()`, so a plain delete would let a payload carrying either key parse clean and
  lose it in silence (the ADR-0104 shape). Each key carries its own prescription.
- **ADR-0087 D3 `SemanticMigration`** (`auth-config-unadvertised-reserved-features`) plus
  the two exact `RETIRED_KEYS_BY_MAJOR` entries. No D2 conversion, deliberately: this is a
  response surface the server mints per request — nobody authors or persists an
  `AuthFeaturesConfig` — so there is no source for `os migrate meta` to rewrite. The
  `EnhancedApiError.fieldErrors` disposition.
- `requiresFeature` narrows with the registry: neither name is a gateable flag any more,
  which is what stops a spec input from being written against a capability that is not
  served.
- Generated baselines (`authorable-surface/api.json` gains two `[RETIRED]` lines,
  `authorable-defaults/api.json` loses two default lines), `spec-changes.json`, the upgrade
  guide, `export-origins/` and the reference docs regenerated.
