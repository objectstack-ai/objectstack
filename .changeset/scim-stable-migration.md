---
"@objectstack/plugin-auth": minor
"@objectstack/platform-objects": minor
"@objectstack/spec": minor
"@objectstack/plugin-security": minor
"@objectstack/cli": minor
"create-objectstack": minor
---

feat(auth): migrate `@better-auth/scim` from `1.7.0-rc.1` to stable `1.7.1` — the whole-model SCIM migration (#3653, epic #11632)

The stable line is the rc.2-lineage rewrite: the rc.1 `scimProvider` model,
`/scim/generate-token` endpoint and `storeSCIMToken` option no longer exist,
replaced by seven new models and a three-way connection contract. This lands
the migration atomically:

- **Seven new platform objects** back the stable models —
  `sys_scim_connection_binding`, `sys_scim_group`, `sys_scim_group_member`,
  `sys_scim_identity_tombstone`, `sys_scim_projection_grant`,
  `sys_scim_subject`, `sys_scim_user` — bridged via `AUTH_MODEL_TO_PROTOCOL`,
  registered in the platform-object-names registry, listed in
  `BETTER_AUTH_MANAGED_OBJECTS`, and column-pinned by the parity gate (whose
  `KNOWN_UNMAPPED_MODELS` shrinks to the empty set: the rc.1-era group
  provisioning gap — IdP `/Groups` pushes hitting tables that did not exist —
  is closed).
- **SCIM connections stay runtime data.** The stable constructor is satisfied
  with an application-owned `authentication.verifyBearerToken` that resolves
  the connection from a row at request time — not static boot config, and not
  the upstream `managedConnections` catalog (deliberately not adopted).
- **ObjectStack owns SCIM credentials outright** (stable upstream stores no
  credential at all): `sys_scim_connection_credential` plus
  `scim-connection-service.ts` mint/digest/verify. At rest only an
  HMAC-SHA-256 keyed by the deployment auth secret (base64url,
  domain-separated) is stored — at parity or better than the rc.1 unsalted
  SHA-256 — pinned by `credential-at-rest-posture.test.ts` including live
  401 paths for forged, revoked and expired bearers.
- **The ObjectQL better-auth adapter gains native transactions**
  (`engine.transaction`, fail-closed on drivers without `beginTransaction`),
  which stable scim requires by assertion for atomic provisioning writes.
- **Scaffold suppression retired**: the `@better-auth/scim>better-call`
  `allowedVersions` entry (CLI renderer + blank template) is gone — stable
  1.7.1 peers `better-call@1.4.0` exactly — and its presence ratchets flipped
  to absence pins. The `better-auth>better-sqlite3` and four
  `@better-auth/utils` entries stay; their retirement conditions are separate
  and unmet.
- The pin resolves **1.7.1 exactly** (not `^1.7.1`): 1.7.2 peers
  `better-auth`/`@better-auth/core` at `^1.7.2`, which only the workspace
  overrides' silencing would "satisfy" while the family is 1.7.1. Floating is
  its own follow-up.

**Semver: minor, argued.** The rc.1 SCIM surface this replaces (generate-token
endpoint, rc.1 bearer tokens, `sys_scim_provider` rows) changes incompatibly —
but that surface is default-off (`OS_SCIM_ENABLED`), was shipped with a
documented "do not let the IdP push groups" boundary, and the maintainer ruled
(2026-08-25) that SCIM has no real customers and old data need not carry: the
one binding constraint is that an existing system upgrades smoothly, which it
does — every table the installed library can write exists at this version, and
SCIM-disabled deployments see no behavior change. A major would move the whole
fixed version group for a feature surface with zero consumers. Deployments
that had SCIM enabled must mint new connection credentials (digests are not
portable from rc.1 on any path — IdP token reissue is a migration-day
operator action regardless of semver level). `sys_scim_provider` itself is
NOT removed here; its retirement is tracked separately (#11757).
