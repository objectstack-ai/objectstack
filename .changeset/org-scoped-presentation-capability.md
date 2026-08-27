---
"@objectstack/spec": minor
"@objectstack/metadata-core": minor
"@objectstack/rest": minor
"@objectstack/runtime": minor
---

feat(security,meta): org-scoped presentation authoring capability `manage_org_presentation` (#12702)

A tenant org admin in a walled posture can now be granted org-scoped authoring
of exactly the org-overridable presentation types (ADR-0005 tier A: view /
dashboard / report / translation / email_template today — the registry is the
authority) without holding platform-wide `manage_metadata` (maintainer
direction 2026-08-27, quoted in #12701).

- **spec**: new curated `PLATFORM_CAPABILITIES` entry `manage_org_presentation`
  (`scope: 'org'`), seeded into `sys_capability` at boot like its siblings.
  Granted by NO shipped permission set — the SaaS operator grants it per
  deployment, so existing postures (`single` included) are byte-unchanged by
  its existence.
- **metadata-core**: new `metaWriteCapabilityVerdict` — the capability half of
  the `/meta` write decision, beside the existing org-scope half
  (`organizationIdForMetaWrite`). It admits `isSystem` and `manage_metadata`
  exactly as before, and `manage_org_presentation` ONLY when the target type's
  registry entry declares `allowOrgOverride: true` (registry-derived via
  `declaresOrgOverride`, never a hand-written list) AND the session has an
  active organization — the very organization the doors thread, so an admitted
  write can only land org-scoped in the caller's own partition: never tier-B,
  never env-wide, never another org's.
- **rest**: the four `/meta` item write doors (`PUT` save, `DELETE` reset,
  `POST /publish`, `POST /rollback`) run the shared verdict.
  `POST /meta/_migrate-stored` stays `manage_metadata`-only — an install-wide
  rewrite is env-wide by definition.
- **runtime**: the dispatcher `/meta` `PUT` door runs the same shared verdict
  (its `_migrate-stored` twin likewise stays `manage_metadata`-only).

Refusals keep their transports' existing envelopes (REST `403 FORBIDDEN`,
dispatcher `403 PERMISSION_DENIED`); the tier-B refusal sentence is
byte-identical to before, and the tier-A sentences name the sanctioned path
without disclosing the caller's own grants (#7450). Platform `manage_metadata`
behaviour is unchanged on every door.
