---
'@objectstack/cli': patch
---

fix(cli)!: a production `os serve` that composes no organization object is refused whether or not `--server`, so `--no-server` no longer writes ownerless rows

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) A boot-time refusal in `os serve`: no key of any metadata schema is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type, flag or error code is removed or renamed; `--no-server` keeps its meaning (no HTTP server plugin) and only stops being a way round the auth refusal. The remedy is a deployment one, stated below. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this boot (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** boot-refusal narrowing (ADR-0131 D1, "NULL is not a state", and D9). It changes which production boots start, not what a metadata author can write, so it ships as `patch` with this banner.

- FROM: a production `os serve` / `os start` (no `--dev`) with `--no-server` booted the kernel when the stack's `auth` tier was on and no auth secret resolved, or when the stack mounted no auth at all (the `auth` tier off, `--preset minimal` included, with no `AuthPlugin` of its own), warning `⚠ AuthPlugin skipped — set OS_AUTH_SECRET …`. Neither boot composes an organization object, so every row it wrote, its inline seed first, landed with no organization. Measured on an 18.0.0-born store: a deleted seed row was written back with `organization_id` NULL. On a fresh store the seed failed instead, every write refused by the NOT NULL tenant column. Both refusal texts named "run with --no-server" as a remedy.
- TO: both boots are refused whether or not `--server`, before any plugin starts. That includes a production `os serve --preset minimal`: the minimal preset composes no `auth` tier, so unless the stack mounts `AuthPlugin` itself it is refused, kernel-only or not (with `--server` it already was), so nothing is written and the database is never opened. That covers a `--no-server` migrate-and-exit job (`OS_MIGRATE_AND_EXIT=1`), which runs the same kernel bootstrap. Neither refusal text offers `--no-server` any more: each says a kernel-only boot does not avoid it.

**Unchanged:** `os dev` and `--dev` (a development boot resolves its fallback secret, and a no-auth development boot is still refused only when it serves); an embedded kernel (`createStandaloneStack`, `@objectstack/objectql/core`), which never runs this command; and the cloud runtime's host kernel (`ObjectOSEnvironmentPlugin`, where auth is each project's), which keeps its warn-only path. `os start` always hands its `serve` child an auth secret, so it reaches the no-auth case only.

**The remedy.**
- Refused for the missing secret: set `OS_AUTH_SECRET` (a long random value, identical across restarts and nodes, e.g. `OS_AUTH_SECRET=$(openssl rand -hex 32)`).
- Refused because the stack mounts no auth: enable auth (add the `auth` tier, or mount `AuthPlugin` in `plugins`) and set `OS_AUTH_SECRET`. Declaring the stack's own objects `tenancy: { enabled: false }` does not lift this refusal: the platform's own system objects are tenant-scoped, so a production stack with no organization object would still write ownerless rows.
- A cloud migrate-and-exit job (`OS_MIGRATE_AND_EXIT=1`) must carry `OS_AUTH_SECRET` in production; without it the job is now refused, naming the variable.

**Release-notes correction.** The 18.0 release page says a production `os serve` with no auth secret can "serve without the data API (`--no-server`)". That remedy is withdrawn: `--no-server` is refused the same way. The pending changeset `24583-7b3-organizationless-counter-retired` is corrected in this change to match.
