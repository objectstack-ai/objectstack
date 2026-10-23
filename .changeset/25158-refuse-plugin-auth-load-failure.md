---
'@objectstack/cli': patch
---

fix(cli)!: a production `os serve` whose `@objectstack/plugin-auth` fails to load is refused, naming the load error, instead of booting with no organization object

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A boot-time refusal in `os serve`: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type, flag or error code is removed or renamed. The remedy is a deployment one (repair the install), stated below. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this boot (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** boot-refusal narrowing (ADR-0131 D9), the third composition beside the two the previous change refused. It changes which production boots start, not what a metadata author can write, so it ships as `patch` with this banner.

- FROM: a production `os serve` or `os start` (no `--dev`) whose stack enables the `auth` tier and resolves an auth secret, but whose `@objectstack/plugin-auth` fails to load — a missing install (silently) or a broken one (one `⚠ AuthPlugin failed to load: …` warning) — booted with no `AuthPlugin`. It composed no organization object, so every row the boot wrote landed with no organization: stored ownerless on an 18.0.0-born store (nullable columns, MongoDB), refused at NOT NULL on a fresh SQL table.
- TO: that boot is refused before any plugin starts, with or without `--server`, and the database is never opened. The refusal names the load error. The same holds when the AuthPlugin construction itself throws before it is mounted.

**Unchanged:** `os dev` and `--dev` (a development boot keeps the warning and boots without auth); the cloud runtime's host kernel (`ObjectOSEnvironmentPlugin`), whose auth is each project's; a production boot with no auth secret or with no auth at all, which is still refused by the existing refusals; and an embedded kernel, which never runs this command.

**The remedy.** Repair the install the error names: `@objectstack/plugin-auth` is a dependency of `@objectstack/cli`, so reinstall the deployment's dependencies (e.g. `npm ci` or `pnpm install --frozen-lockfile`). Running kernel-only (`--no-server`) does not avoid the refusal.
