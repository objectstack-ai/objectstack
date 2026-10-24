---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: the temporary auth secret is used on a development boot only; any other boot without `OS_AUTH_SECRET` refuses to start

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type, flag or error code is added, removed or renamed. What narrows is the set of environments in which `AuthManager` boots without a configured secret, and the remedy is configuration: set `OS_AUTH_SECRET`, or `NODE_ENV=development` for a local boot. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this behaviour (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the boots that start without a configured secret narrow), shipped as `patch`: it changes which environments boot, not what a metadata author can write.

With no `OS_AUTH_SECRET` (nor its legacy spellings `AUTH_SECRET` / `BETTER_AUTH_SECRET`) and no `secret` option, `AuthManager` used to fall back to a temporary development secret whenever `NODE_ENV` was anything but exactly `production`: unset, `staging`, a typo. It now does so only on a development boot (`isDevelopmentBoot` from `@objectstack/core`: `NODE_ENV=development`) or under `NODE_ENV=test`, and refuses to boot otherwise, the way `production` already did.

- **FROM:** an embedder that never set `NODE_ENV`, or set a custom value, booted with a temporary secret and a console warning.
- **TO:** the same boot throws `OS_AUTH_SECRET is required outside development`.
- **Unchanged:** `os serve` and `os start` default an unset `NODE_ENV` to `production` and `os dev` / `--dev` set `development`, so CLI boots behave as before. A configured secret is used exactly as before in every environment.
- **Fix:** set `OS_AUTH_SECRET` to a strong random value. For a local development boot, set `NODE_ENV=development`.
