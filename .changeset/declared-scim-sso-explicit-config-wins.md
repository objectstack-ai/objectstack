---
"@objectstack/spec": minor
"@objectstack/plugin-auth": minor
---

feat(spec,plugin-auth): declare `plugins.scim` / `plugins.sso` / `plugins.ssoDomainVerification`, and let an explicit config value win over the env var (#13439)

**Behavior change** (maintainer ruling 2026-08-31 on #13439).

Two halves of one contract gap:

- **Declaration.** `AuthPluginConfigSchema` now declares `scim`, `sso` and
  `ssoDomainVerification` as tri-state `z.boolean().optional()`, following the
  `dynamicClientRegistration` template. Previously the keys were read by
  `plugin-auth` through an `as any` cast while no schema declared them — a key
  an author could write, that typechecked only via the cast, that no
  publish-time validation would ever reject or confirm.
- **Precedence flip.** For these three keys an EXPLICIT config value now wins
  over the corresponding env var (`OS_SCIM_ENABLED` / `OS_SSO_ENABLED` /
  `OS_SSO_DOMAIN_VERIFICATION`); the env var decides only where the config
  leaves the key UNSET (absent env ⇒ off). Previously the env var always won,
  so `plugins: { scim: false }` had no effect at all whenever
  `OS_SCIM_ENABLED` was set — a line that read as a security control, passed
  review and typecheck, and did nothing. The operator per-environment override
  is preserved for every deployment that leaves the keys unset. The other
  env-paired keys (`oidcProvider`, `dynamicClientRegistration`, `twoFactor`,
  `passwordRejectBreached`) deliberately keep their documented env-wins order.

The ADR-0071 forced-admin coupling is unchanged in shape
(`admin: pluginConfig.admin ?? scimEffective`): effective SCIM still forces
the better-auth `admin` plugin on when `admin` is unset — but the flipped
resolution flows through it, so an explicit `plugins.scim: false` now also
declines the admin plugin it would have dragged in. The admin coupling itself
is out of this change's scope (#13816 tracks it).

**Known risk, named:** a deployment that writes BOTH an explicit value and the
env var and depends on the env winning will flip. The only known explicit
writer is the cloud control plane, which requires the new order (its
plan-derived `plugins.scim` must be authoritative; cloud#1265's refuse-to-build
workaround can retire once this lands).

<!-- adr-0087: not-required (no-migration-prescription) Additive declaration of three previously-undeclared optional keys plus a documented precedence flip: no key is removed, renamed or re-shaped, no tombstone exists, and nothing mechanical for `objectstack migrate meta` to rewrite. The affected quadrant (explicit value AND env var set, relying on env winning) has a measured population of one writer — the cloud control plane — which requires the new order. -->
