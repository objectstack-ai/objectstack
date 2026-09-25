---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: no shipped permission set below platform admin reads a row of `sys_verification` or `sys_jwks` — the credential rows those objects declare private (#20027)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner and the ADR-0087 disposition below, never by the level).

`sys_verification` (one-time verification and password-reset tokens) and
`sys_jwks` (JWT signing keys) declare `access: { default: 'private' }`, and the
shipped permission sets documented them as denied to every principal below
platform admin. The sets did not hold that: the read they grant on every
better-auth-managed object is an explicit per-object entry, which the `private`
posture does not govern, and neither object had a row policy behind it.

**What a principal can no longer read.** Every shipped set that grants that read
and carries row-level security — `member_default`, `viewer_readonly`,
`organization_admin` and its wall-less variant `organization_admin_no_bypass` —
now declares a row policy that admits no row on each of the two objects
(`sys_verification_none`, `sys_jwks_none`). That covers the rows the objects
declare private, including a caller's own verification row. An MCP agent acting
for a user is bounded by that user's sets and reads the same. `admin_full_access`
is unchanged and still reads every row.

**Remedy.** None is expected to be needed: no shipped product surface reads these
tables under a user context. A deployment that genuinely needs a principal below
platform admin to inspect them grants that in a permission set of its own, with
a row-level-security policy that names the rows it may see.

Unchanged: better-auth's own verification, password-reset and token-signing flows
(they read and write through its adapter under system context, which no row
policy reaches), the owner-scoped reads of the other `private` identity objects
(`sys_device_code`, `sys_oauth_access_token`, `sys_oauth_refresh_token`), and
every other managed object.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: `packages/spec` is untouched, no object definition or column changes, and the shipped permission sets are code evaluated from the in-memory declaration, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. The change is a narrowing of what the platform's own sets admit at runtime. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers it (not `registered` / `already-registered`); and it is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
